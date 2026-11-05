
#!/usr/bin/env python3
"""QZ1 GNSS serial monitor."""

import argparse
import re
import sys
import time
from collections import Counter

try:
    import serial
except ImportError:
    print("pyserial がインストールされていません。")
    print("sudo apt install python3-serial")
    sys.exit(1)


class NMEAStream:
    """Serial byte streamからNMEAセンテンスを取り出す。"""

    def __init__(self):
        self.buffer = bytearray()
        self.in_sentence = False
        self.noise_bytes = 0
        self.malformed_frames = 0

    def feed(self, data):
        sentences = []

        for byte in data:
            if not self.in_sentence:
                if byte == ord("$"):
                    self.buffer = bytearray([byte])
                    self.in_sentence = True
                elif byte not in (ord("\r"), ord("\n")):
                    self.noise_bytes += 1
                continue

            if byte == ord("$"):
                # 前のセンテンスが終端前に途切れた
                self.malformed_frames += 1
                self.buffer = bytearray([byte])
                continue

            self.buffer.append(byte)

            if len(self.buffer) > 1024:
                self.malformed_frames += 1
                self.buffer.clear()
                self.in_sentence = False
                continue

            if byte == ord("\n"):
                raw = bytes(self.buffer).rstrip(b"\r\n")
                self.buffer.clear()
                self.in_sentence = False

                try:
                    sentence = raw.decode("ascii")
                    sentences.append(sentence)
                except UnicodeDecodeError:
                    self.malformed_frames += 1

        return sentences


def verify_checksum(sentence):
    """NMEAセンテンスのチェックサムを検証する。"""

    if not sentence.startswith("$"):
        return False

    star = sentence.rfind("*")

    if star < 0 or len(sentence) != star + 3:
        return False

    checksum_text = sentence[star + 1:]

    if not re.fullmatch(r"[0-9A-Fa-f]{2}", checksum_text):
        return False

    checksum = 0

    for char in sentence[1:star]:
        checksum ^= ord(char)

    return checksum == int(checksum_text, 16)


def parse_coordinate(value, direction):
    """NMEAの度分形式を10進数の緯度・経度に変換する。"""

    if not value or not direction:
        return None

    raw = float(value)
    degrees = int(raw / 100)
    minutes = raw - degrees * 100

    if minutes >= 60:
        raise ValueError("Invalid coordinate")

    result = degrees + minutes / 60

    if direction in ("S", "W"):
        result = -result
    elif direction not in ("N", "E"):
        raise ValueError("Invalid coordinate direction")

    return result


def parse_date(value):
    """DDMMYY形式の日付をYYYY-MM-DDに変換する。"""

    if len(value) != 6 or not value.isdigit():
        return None

    day = int(value[0:2])
    month = int(value[2:4])
    year = int(value[4:6])

    year += 2000 if year < 80 else 1900

    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_time(value):
    """NMEA時刻をHH:MM:SS形式に変換する。"""

    if len(value) < 6:
        return None

    return f"{value[0:2]}:{value[2:4]}:{value[4:6]}"


class GNSSMonitor:

    def __init__(self):
        self.data = {
            "utc_date": None,
            "utc_time": None,
            "latitude": None,
            "longitude": None,
            "fix": False,
            "fix_quality": None,
            "fix_mode": None,
            "gnsa_fix_type": None,
            "satellites": None,
            "hdop": None,
            "altitude": None,
            "speed_knots": None,
            "speed_kmh": None,
            "course": None,
            "battery": None,
            "mag": None,
        }

        self.stats = Counter()

    def process_sentence(self, sentence):
        self.stats["received"] += 1

        if not verify_checksum(sentence):
            self.stats["bad_checksum"] += 1
            return

        self.stats["valid"] += 1

        try:
            body = sentence[1:sentence.rfind("*")]
            fields = body.split(",")

            identifier = fields[0]

            if len(identifier) < 3:
                raise ValueError("Invalid identifier")

            # GNGGA / GPGGA / GLGGAなどを同じ形式として扱う
            kind = identifier[-3:]

            handlers = {
                "GGA": self.parse_gga,
                "GNS": self.parse_gns,
                "RMC": self.parse_rmc,
                "GLL": self.parse_gll,
                "GSA": self.parse_gsa,
                "GSV": self.parse_gsv,
                "VTG": self.parse_vtg,
                "ZDA": self.parse_zda,
                "BAT": self.parse_bat,
                "MAG": self.parse_mag,
            }

            handler = handlers.get(kind)

            if handler is None:
                self.stats["unknown"] += 1
                return

            handler(fields)

        except (ValueError, IndexError, OverflowError):
            self.stats["malformed"] += 1

    def parse_gga(self, f):
        # GGA:
        # time, lat, N/S, lon, E/W, quality,
        # satellites, HDOP, altitude, unit, ...

        if len(f) < 10:
            raise ValueError("GGA fields missing")

        d = self.data

        if f[1]:
            d["utc_time"] = parse_time(f[1])

        if f[2] and f[4]:
            d["latitude"] = parse_coordinate(f[2], f[3])
            d["longitude"] = parse_coordinate(f[4], f[5])

        if f[6]:
            quality = int(f[6])
            d["fix_quality"] = quality
            d["fix"] = quality > 0

        if f[7]:
            d["satellites"] = int(f[7])

        if f[8]:
            d["hdop"] = float(f[8])

        if f[9] and (len(f) < 11 or f[10] == "M"):
            d["altitude"] = float(f[9])

    def parse_gns(self, f):
        # GNS:
        # time, lat, N/S, lon, E/W, mode,
        # satellites, HDOP, altitude, ...

        if len(f) < 10:
            raise ValueError("GNS fields missing")

        d = self.data

        if f[1]:
            d["utc_time"] = parse_time(f[1])

        if f[2] and f[4]:
            d["latitude"] = parse_coordinate(f[2], f[3])
            d["longitude"] = parse_coordinate(f[4], f[5])

        if f[6]:
            mode = f[6]
            d["fix_mode"] = mode
            d["fix"] = any(c != "N" for c in mode)

        if f[7]:
            d["satellites"] = int(f[7])

        if f[8]:
            d["hdop"] = float(f[8])

        if f[9]:
            d["altitude"] = float(f[9])

    def parse_rmc(self, f):
        # RMC:
        # time, status, lat, N/S, lon, E/W,
        # speed, course, date, ...

        if len(f) < 10:
            raise ValueError("RMC fields missing")

        d = self.data

        if f[1]:
            d["utc_time"] = parse_time(f[1])

        if f[2]:
            d["fix"] = f[2] == "A"

        if f[3] and f[5]:
            d["latitude"] = parse_coordinate(f[3], f[4])
            d["longitude"] = parse_coordinate(f[5], f[6])

        if f[7]:
            d["speed_knots"] = float(f[7])
            d["speed_kmh"] = d["speed_knots"] * 1.852

        if f[8]:
            d["course"] = float(f[8])

        if f[9]:
            d["utc_date"] = parse_date(f[9])

    def parse_gll(self, f):
        # GLL:
        # lat, N/S, lon, E/W, time, status, mode

        if len(f) < 7:
            raise ValueError("GLL fields missing")

        d = self.data

        if f[1] and f[3]:
            d["latitude"] = parse_coordinate(f[1], f[2])
            d["longitude"] = parse_coordinate(f[3], f[4])

        if f[5]:
            d["utc_time"] = parse_time(f[5])

        if f[6]:
            d["fix"] = f[6] == "A"

        if len(f) > 7 and f[7]:
            d["fix_mode"] = f[7]

    def parse_gsa(self, f):
        # GSA:
        # mode, fix type, satellites..., PDOP, HDOP, VDOP

        if len(f) < 18:
            raise ValueError("GSA fields missing")

        d = self.data

        if f[2]:
            fix_type = int(f[2])
            d["gnsa_fix_type"] = fix_type

        if f[-2]:
            d["hdop"] = float(f[-2])

    def parse_gsv(self, f):
        # GSV:
        # number of messages, message number,
        # satellites in view, ...

        if len(f) < 4:
            raise ValueError("GSV fields missing")

        if f[3]:
            self.data["satellites"] = int(f[3])

    def parse_vtg(self, f):
        # VTG:
        # true course, T, magnetic course, M,
        # speed knots, N, speed km/h, K

        if len(f) < 9:
            raise ValueError("VTG fields missing")

        d = self.data

        if f[1]:
            d["course"] = float(f[1])

        if f[5]:
            d["speed_knots"] = float(f[5])

        if f[7]:
            d["speed_kmh"] = float(f[7])

    def parse_zda(self, f):
        # ZDA:
        # time, day, month, year, ...

        if len(f) < 5:
            raise ValueError("ZDA fields missing")

        d = self.data

        if f[1]:
            d["utc_time"] = parse_time(f[1])

        if f[2] and f[3] and f[4]:
            d["utc_date"] = (
                f"{int(f[4]):04d}-"
                f"{int(f[3]):02d}-"
                f"{int(f[2]):02d}"
            )

    def parse_bat(self, f):
        # QZ1独自拡張と思われるセンテンス。
        # 電圧と推定しているが、マニュアルに定義はない。

        if len(f) < 2 or not f[1]:
            raise ValueError("BAT fields missing")

        self.data["battery"] = float(f[1])

    def parse_mag(self, f):
        # QZ1独自拡張と思われるセンテンス。
        # 各フィールドの意味・単位は未確認のため、そのまま保持する。

        if len(f) < 2:
            raise ValueError("MAG fields missing")

        self.data["mag"] = f[1:]

    def display(self, noise_bytes):
        d = self.data
        s = self.stats

        print("\033[2J\033[H", end="")

        print("=" * 52)
        print("              GNSS SERIAL MONITOR")
        print("=" * 52)

        print(f"Fix Status  : {'FIXED' if d['fix'] else 'NO FIX'}")
        print(f"Fix Quality : {d['fix_quality']}")
        print(f"Fix Mode    : {d['fix_mode']}")
        print("-" * 52)

        print(f"UTC Date    : {d['utc_date']}")
        print(f"UTC Time    : {d['utc_time']}")
        print("-" * 52)

        print("POSITION")

        if d["latitude"] is not None:
            print(f"Latitude    : {d['latitude']:.7f} deg")
            print(f"Longitude   : {d['longitude']:.7f} deg")

            if not d["fix"]:
                print("              (Reported position; no valid fix)")
        else:
            print("Latitude    : --")
            print("Longitude   : --")

        print(
            f"Altitude    : {d['altitude']:.2f} m"
            if d["altitude"] is not None
            else "Altitude    : --"
        )

        print("-" * 52)
        print("GNSS")

        print(f"Satellites  : {d['satellites']}")
        print(f"HDOP        : {d['hdop']}")

        if d["gnsa_fix_type"] is not None:
            fix_types = {
                1: "NO FIX",
                2: "2D",
                3: "3D",
            }
            print(
                f"GSA Fix Type: "
                f"{fix_types.get(d['gnsa_fix_type'], 'UNKNOWN')}"
            )

        print("-" * 52)
        print("MOVEMENT")

        print(
            f"Speed       : {d['speed_kmh']:.2f} km/h"
            if d["speed_kmh"] is not None
            else "Speed       : --"
        )

        print(
            f"Speed       : {d['speed_knots']:.2f} knots"
            if d["speed_knots"] is not None
            else "Speed       : --"
        )

        print(
            f"Course      : {d['course']:.2f} deg"
            if d["course"] is not None
            else "Course      : --"
        )

        print("-" * 52)
        print("DEVICE")

        print(
            f"Battery     : {d['battery']:.2f} V (inferred)"
            if d["battery"] is not None
            else "Battery     : --"
        )

        if d["mag"] is not None:
            print(f"L1MAG       : {', '.join(d['mag'])}")
        else:
            print("L1MAG       : --")

        print("-" * 52)
        print("RECEIVE STATISTICS")

        print(f"Received    : {s['received']}")
        print(f"Valid       : {s['valid']}")
        print(f"Bad checksum: {s['bad_checksum']}")
        print(f"Malformed   : {s['malformed']}")
        print(f"Binary/noise: {noise_bytes}")
        print(f"Unknown     : {s['unknown']}")

        print("=" * 52)
        print("Press Ctrl+C to exit.")


def main():
    parser = argparse.ArgumentParser(
        description="QZ1 GNSS serial monitor"
    )

    parser.add_argument(
        "--port",
        default="/dev/ttyUSB0",
        help="Serial port (default: /dev/ttyUSB0)"
    )

    parser.add_argument(
        "--baud",
        type=int,
        default=115200,
        help="Baud rate (default: 115200)"
    )

    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Display refresh interval in seconds"
    )

    args = parser.parse_args()

    monitor = GNSSMonitor()
    stream = NMEAStream()

    print(f"Connecting to {args.port} at {args.baud} baud...")

    try:
        with serial.Serial(
            port=args.port,
            baudrate=args.baud,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.2,
        ) as ser:

            print("Connected.")
            time.sleep(0.5)

            last_display = 0.0

            while True:
                raw = ser.read(256)

                if raw:
                    sentences = stream.feed(raw)

                    for sentence in sentences:
                        monitor.process_sentence(sentence)

                now = time.monotonic()

                if now - last_display >= args.interval:
                    monitor.display(
                        stream.noise_bytes
                    )
                    last_display = now

    except serial.SerialException as e:
        print(f"\nSerial error: {e}")
        sys.exit(1)

    except KeyboardInterrupt:
        print("\n\nStopped by user.")
        print("Final statistics:")
        print(dict(monitor.stats))
        print(f"Binary/noise bytes: {stream.noise_bytes}")


if __name__ == "__main__":
    main()
