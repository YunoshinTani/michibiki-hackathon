#!/usr/bin/env python3
"""Upload one GNSS connection session from a serial port to the SLAS Map server."""

import argparse
import getpass
import json
import math
import sys
import time
import urllib.error
import urllib.request
import uuid
from contextlib import ExitStack
from urllib.parse import urlsplit

from gnss_core import GNSSMonitor, NMEAStream
from pc_location import PCPosition

try:
    import serial
except ImportError:
    serial = None


READ_SIZE = 256
REQUEST_TIMEOUT = 5


def parse_args():
    parser = argparse.ArgumentParser(
        description="Serial GNSS receiver to HTTPS SLAS Map uploader"
    )
    parser.add_argument(
        "--url",
        required=True,
        help="HTTPS ingest API URL, for example https://example.edu/slas-map/gnss_api.cgi?action=ingest",
    )
    parser.add_argument("--port", default="COM16", help="serial port (default: COM16)")
    parser.add_argument("--baud", type=int, default=115200, help="baud rate (default: 115200)")
    comparison = parser.add_mutually_exclusive_group()
    comparison.add_argument("--pc-location", action="store_true", help="collect this PC's browser location")
    comparison.add_argument("--gps-port", help="COM port of a receiver configured for GPS only")
    parser.add_argument("--gps-baud", type=int, default=9600, help="GPS-only receiver baud rate")
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
    if not 300 <= args.gps_baud <= 4_000_000:
        parser.error("--gps-baud must be between 300 and 4000000")
    if args.gps_port and args.gps_port.casefold() == args.port.casefold():
        parser.error("--gps-port must differ from --port")
    return args


def make_opener(url, username, password):
    password_manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    password_manager.add_password(None, url, username, password)
    return urllib.request.build_opener(
        urllib.request.HTTPSHandler(),
        urllib.request.HTTPBasicAuthHandler(password_manager),
    )


def snapshot(monitor, stream, port, baud, last_update, session_id, session_started_at, connected=True):
    return {
        "connected": connected,
        "port": port,
        "baud": baud,
        "error": None,
        "last_update": last_update,
        "session_id": session_id,
        "session_started_at": session_started_at,
        "data": dict(monitor.data),
        "position_at": monitor.position_updated_at,
        "stats": dict(monitor.stats),
        "noise_bytes": stream.noise_bytes,
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
        result = json.loads(response.read(65536))
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise RuntimeError("サーバーが保存の成功を返しませんでした。送信先URLを確認してください。")


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
    last_update = None
    last_upload = 0.0
    last_error = None
    uploaded_once = False
    serial_opened = False
    session_id = None
    session_started_at = None
    pc = gps = None
    gps_monitor, gps_stream = GNSSMonitor(), NMEAStream()
    comparison_mode = "pc" if args.pc_location else "gps" if args.gps_port else None

    def current_snapshot(connected=True):
        state = snapshot(
            monitor, stream, args.port, args.baud, last_update,
            session_id, session_started_at, connected=connected,
        )
        if comparison_mode:
            state["comparison_mode"] = comparison_mode
            sample = pc.latest if pc else None
            if gps_monitor.data["fix"] and gps_monitor.position_updated_at is not None:
                sample = {
                    "latitude": gps_monitor.data["latitude"],
                    "longitude": gps_monitor.data["longitude"],
                    "timestamp": gps_monitor.position_updated_at,
                    "accuracy": None,
                }
            state["comparison"] = sample
        return state

    print(f"{args.port} ({args.baud} baud) に接続します。")
    print("停止するには Ctrl+C を押してください。")

    try:
        with ExitStack() as resources:
            device = resources.enter_context(serial.Serial(args.port, args.baud, timeout=0.2))
            if args.gps_port:
                gps = resources.enter_context(serial.Serial(args.gps_port, args.gps_baud, timeout=0))
            if args.pc_location:
                pc = resources.enter_context(PCPosition())
            session_id = uuid.uuid4().hex
            session_started_at = time.time()
            serial_opened = True
            print("接続しました。今回の接続を新しい記録として送信します。")
            while True:
                raw = device.read(READ_SIZE)
                if raw:
                    for sentence in stream.feed(raw):
                        monitor.process_sentence(sentence)
                    last_update = time.time()

                if gps:
                    for sentence in gps_stream.feed(gps.read(gps.in_waiting)):
                        gps_monitor.process_sentence(sentence)

                now = time.monotonic()
                if now - last_upload >= args.interval:
                    try:
                        upload(opener, args.url, current_snapshot())
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
        if serial_opened:
            try:
                upload(opener, args.url, current_snapshot(connected=False))
            except (OSError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError):
                pass
        print("シリアルポートを開けないか、受信中に切断されました: " + str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        if serial_opened:
            try:
                upload(opener, args.url, current_snapshot(connected=False))
            except (OSError, urllib.error.URLError, urllib.error.HTTPError, RuntimeError, ValueError):
                pass
        print("\n送信を停止しました。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
