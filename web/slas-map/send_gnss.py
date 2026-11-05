#!/usr/bin/env python3
"""COM16 GNSS data uploader for the SLAS Map server."""

import argparse
import getpass
import json
import math
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from urllib.parse import urlsplit

from gnss_core import GNSSMonitor, NMEAStream

try:
    import serial
except ImportError:
    serial = None


MAX_TRAIL_POINTS = 500
READ_SIZE = 256
REQUEST_TIMEOUT = 5


def parse_args():
    parser = argparse.ArgumentParser(
        description="COM port GNSS receiver to HTTPS SLAS Map uploader"
    )
    parser.add_argument(
        "--url",
        required=True,
        help="HTTPS ingest API URL, for example https://example.edu/slas-map/cgi-bin/gnss_api.cgi?action=ingest",
    )
    parser.add_argument("--port", default="COM16", help="serial port (default: COM16)")
    parser.add_argument("--baud", type=int, default=115200, help="baud rate (default: 115200)")
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="upload interval in seconds (default: 1.0)",
    )
    args = parser.parse_args()

    parsed_url = urlsplit(args.url)
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        parser.error("--url must be a complete HTTPS URL")
    if not math.isfinite(args.interval) or args.interval <= 0:
        parser.error("--interval must be greater than zero")
    if not 300 <= args.baud <= 4_000_000:
        parser.error("--baud must be between 300 and 4000000")
    return args


def make_opener(url, username, password):
    password_manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    password_manager.add_password(None, url, username, password)
    return urllib.request.build_opener(
        urllib.request.HTTPSHandler(),
        urllib.request.HTTPBasicAuthHandler(password_manager),
    )


def snapshot(monitor, stream, trail, port, baud, last_update, connected=True):
    return {
        "connected": connected,
        "port": port,
        "baud": baud,
        "error": None,
        "last_update": last_update,
        "data": dict(monitor.data),
        "stats": dict(monitor.stats),
        "noise_bytes": stream.noise_bytes,
        "trail": list(trail),
    }


def upload(opener, url, state):
    body = json.dumps(state, ensure_ascii=False, allow_nan=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "Cache-Control": "no-store",
        },
        method="POST",
    )
    with opener.open(request, timeout=REQUEST_TIMEOUT) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError("server returned HTTP " + str(response.status))


def main():
    args = parse_args()
    if serial is None:
        print("pyserial がありません。setup.bat を実行してください。", file=sys.stderr)
        return 1

    username = input("学校サーバーのBasic認証ユーザー名: ").strip()
    password = getpass.getpass("Basic認証パスワード: ")
    if not username or not password:
        print("ユーザー名とパスワードを入力してください。", file=sys.stderr)
        return 2

    opener = make_opener(args.url, username, password)
    monitor = GNSSMonitor()
    stream = NMEAStream()
    trail = deque(maxlen=MAX_TRAIL_POINTS)
    last_update = None
    last_upload = 0.0
    last_error = None
    uploaded_once = False

    print(f"{args.port} ({args.baud} baud) に接続します。")
    print("停止するには Ctrl+C を押してください。")

    try:
        with serial.Serial(
            port=args.port,
            baudrate=args.baud,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.2,
        ) as device:
            print("受信を開始しました。位置データをサーバーへ送信します。")
            while True:
                raw = device.read(READ_SIZE)
                if raw:
                    sentences = stream.feed(raw)
                    for sentence in sentences:
                        monitor.process_sentence(sentence)
                        data = monitor.data
                        if (data.get("fix") and data.get("latitude") is not None
                                and data.get("longitude") is not None):
                            point = [data["latitude"], data["longitude"]]
                            if not trail or trail[-1] != point:
                                trail.append(point)
                    last_update = time.time()

                now = time.monotonic()
                if now - last_upload >= args.interval:
                    state = snapshot(monitor, stream, trail, args.port, args.baud, last_update)
                    try:
                        upload(opener, args.url, state)
                        if last_error is not None:
                            print("サーバーへの送信が再開しました。")
                        elif not uploaded_once:
                            print("サーバーへの初回送信に成功しました。")
                        last_error = None
                        uploaded_once = True
                    except (OSError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError) as exc:
                        message = str(exc)
                        if message != last_error:
                            print("送信できません。接続先とBasic認証を確認してください: " + message, file=sys.stderr)
                        last_error = message
                    last_upload = time.monotonic()
    except serial.SerialException as exc:
        final_state = snapshot(monitor, stream, trail, args.port, args.baud, last_update, connected=False)
        try:
            upload(opener, args.url, final_state)
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError):
            pass
        print("シリアルポートを開けないか、受信中に切断されました: " + str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        final_state = snapshot(monitor, stream, trail, args.port, args.baud, last_update, connected=False)
        try:
            upload(opener, args.url, final_state)
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError):
            pass
        print("\n送信を停止しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
