#!/usr/bin/env python3
"""Local GNSS dashboard backed by the bundled QZ1 NMEA parser."""

import argparse
import json
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from gnss_core import GNSSMonitor, NMEAStream

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None
    list_ports = None


ROOT = Path(__file__).resolve().parent

DEFAULT_PORT = 8765
DEFAULT_BAUD = 115200
MIN_BAUD = 300
MAX_BAUD = 4_000_000
MAX_BODY_BYTES = 4096
READ_SIZE = 256

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/standard.css": ("standard.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}


def get_ports():
    if list_ports is None:
        return []
    return [
        {"device": item.device, "description": item.description or item.device}
        for item in list_ports.comports()
    ]


def parse_baud(value):
    try:
        baud = int(value)
    except (TypeError, ValueError):
        raise ValueError("通信速度を数値で入力してください。")
    if not MIN_BAUD <= baud <= MAX_BAUD:
        raise ValueError(f"通信速度は {MIN_BAUD:,}〜{MAX_BAUD:,} の範囲で指定してください。")
    return baud


class SerialSession:
    """シリアル接続・受信スレッド・最新の測位状態をまとめて管理する。"""

    def __init__(self):
        self._lock = threading.Lock()
        self._monitor = GNSSMonitor()
        self._stream = NMEAStream()
        # (緯度, 経度) の組。接続中の軌跡をすべて保持する。
        self._trail = deque()
        self._device = None
        self._stop_event = None
        self._info = self._idle_info()

    @staticmethod
    def _idle_info():
        return {"connected": False, "port": None, "baud": None, "error": None, "last_update": None}

    def connect(self, port, baud):
        if serial is None:
            raise RuntimeError("pyserial がありません。setup.bat を実行してください。")
        if not isinstance(port, str) or not port.strip():
            raise ValueError("シリアルポートを選択してください。")
        baud = parse_baud(baud)

        with self._lock:
            if self._info["connected"]:
                raise RuntimeError("すでに接続しています。")

        try:
            device = serial.Serial(
                port=port,
                baudrate=baud,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=0.2,
            )
        except Exception as exc:
            raise RuntimeError("ポートを開けませんでした: " + str(exc))

        monitor = GNSSMonitor()
        stream = NMEAStream()
        stop_event = threading.Event()

        with self._lock:
            # ポートを開いている間に別の接続要求が通っていないか再確認する
            if self._info["connected"]:
                device.close()
                raise RuntimeError("すでに接続しています。")
            self._monitor = monitor
            self._stream = stream
            self._trail.clear()
            self._info = {**self._idle_info(), "connected": True, "port": port, "baud": baud}
            self._device = device
            self._stop_event = stop_event

        threading.Thread(
            target=self._read_loop,
            args=(device, stop_event, monitor, stream),
            daemon=True,
        ).start()

    def disconnect(self):
        with self._lock:
            device = self._device
            stop_event = self._stop_event
            self._device = None
            self._stop_event = None
            self._info.update(connected=False, port=None, baud=None)
        if stop_event is not None:
            stop_event.set()
        if device is not None:
            try:
                device.close()
            except Exception:
                pass

    def snapshot(self):
        with self._lock:
            return {
                **self._info,
                "data": dict(self._monitor.data),
                "stats": dict(self._monitor.stats),
                "noise_bytes": self._stream.noise_bytes,
                "trail": list(self._trail),
            }

    def _read_loop(self, device, stop_event, monitor, stream):
        try:
            while not stop_event.is_set():
                raw = device.read(READ_SIZE)
                if not raw:
                    continue
                sentences = stream.feed(raw)
                with self._lock:
                    if self._device is not device:
                        return
                    self._info["last_update"] = time.time()
                    for sentence in sentences:
                        monitor.process_sentence(sentence)
                        self._append_trail(monitor.data)
        except Exception as exc:
            if not stop_event.is_set():
                with self._lock:
                    self._info["error"] = str(exc)
        finally:
            try:
                device.close()
            except Exception:
                pass
            with self._lock:
                if self._device is device:
                    self._device = None
                    self._info.update(connected=False, port=None, baud=None)

    def _append_trail(self, data):
        """測位が取れている位置だけを、直前と違う場合に軌跡へ追加する。"""
        lat = data.get("latitude")
        lon = data.get("longitude")
        if not data.get("fix") or lat is None or lon is None:
            return
        point = (lat, lon)
        if not self._trail or self._trail[-1] != point:
            self._trail.append(point)


SESSION = SerialSession()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def send_json(self, body, status=200):
        encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def host_allowed(self):
        # DNS rebinding 対策: 自分宛てのホスト名以外で届いた要求は受け付けない
        return self.headers.get("Host") in self.server.allowed_hosts

    def do_GET(self):
        if not self.host_allowed():
            self.send_error(403)
            return

        path = urlsplit(self.path).path
        if path == "/api/state":
            self.send_json(SESSION.snapshot())
            return
        if path == "/api/ports":
            self.send_json({"available": serial is not None, "ports": get_ports()})
            return

        item = STATIC_FILES.get(path)
        if item is None:
            self.send_error(404)
            return
        filename, content_type = item
        try:
            content = (ROOT / filename).read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if not self.host_allowed():
            self.send_error(403)
            return

        path = urlsplit(self.path).path
        if path not in ("/api/connect", "/api/disconnect"):
            self.send_error(404)
            return
        # JSON 以外は受け付けない。他サイトからのフォーム送信を弾き、
        # ブラウザーに事前確認(プリフライト)を要求させるための制限。
        if self.headers.get_content_type() != "application/json":
            self.send_json({"error": "Content-Type は application/json にしてください。"}, 415)
            return

        try:
            if path == "/api/disconnect":
                SESSION.disconnect()
                self.send_json({"ok": True})
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= MAX_BODY_BYTES:
                self.send_json({"error": "リクエストが大きすぎます。"}, 413)
                return
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict):
                raise ValueError("リクエストの形式が正しくありません。")
            SESSION.connect(payload.get("port"), payload.get("baud", DEFAULT_BAUD))
            self.send_json({"ok": True})
        except (ValueError, RuntimeError) as exc:  # JSONDecodeError は ValueError の一種
            self.send_json({"error": str(exc)}, 400)


class DashboardServer(ThreadingHTTPServer):
    def __init__(self, port):
        super().__init__(("127.0.0.1", port), Handler)
        self.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    def handle_error(self, request, client_address):
        # ブラウザーのリロードなどで接続が切られても、黒い画面にエラーを出さない
        if isinstance(sys.exc_info()[1], ConnectionError):
            return
        super().handle_error(request, client_address)


def main():
    parser = argparse.ArgumentParser(description="Local GNSS web dashboard")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="web server port")
    args = parser.parse_args()
    server = DashboardServer(args.port)
    print("GNSS Web Dashboard: http://127.0.0.1:" + str(args.port))
    print("終了するにはこのウィンドウで Ctrl+C を押してください。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        SESSION.disconnect()
        server.server_close()


if __name__ == "__main__":
    main()
