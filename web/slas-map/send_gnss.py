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
from urllib.parse import parse_qsl, urlencode, urlsplit

from gnss_core import GNSSMonitor, NMEAStream
from pc_location import PCPosition

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None


READ_SIZE = 256
REQUEST_TIMEOUT = 5
GPS_FIX_MAX_AGE = 10


def parse_args():
    parser = argparse.ArgumentParser(
        description="Serial GNSS receiver to HTTPS SLAS Map uploader"
    )
    parser.add_argument(
        "--url",
        help="HTTPS ingest API URL, for example https://example.edu/slas-map/gnss_api.cgi?action=ingest",
    )
    parser.add_argument("--list-ports", action="store_true", help="list serial ports and exit")
    parser.add_argument("--port", default="COM16", help="serial port (default: COM16)")
    parser.add_argument("--baud", type=int, default=115200, help="baud rate (default: 115200)")
    comparison = parser.add_mutually_exclusive_group()
    comparison.add_argument("--pc-location", action="store_true", help="collect this PC's browser location")
    comparison.add_argument("--gps-port", type=str.strip, help="COM port of a receiver configured for GPS only")
    comparison.add_argument("--iphone", action="store_true", help="pair this recording with OwnTracks on an iPhone")
    parser.add_argument("--gps-baud", type=int, default=9600, help="GPS-only receiver baud rate")
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="upload interval in seconds (default: 1.0)",
    )
    args = parser.parse_args()

    if args.list_ports:
        return args
    if not args.url:
        parser.error("--url is required when uploading")
    parsed_url = urlsplit(args.url)
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        parser.error("--url must be a complete HTTPS URL")
    if not math.isfinite(args.interval) or args.interval <= 0:
        parser.error("--interval must be greater than zero")
    if not 300 <= args.baud <= 4_000_000:
        parser.error("--baud must be between 300 and 4000000")
    if not 300 <= args.gps_baud <= 4_000_000:
        parser.error("--gps-baud must be between 300 and 4000000")
    if args.gps_port == "":
        parser.error("--gps-port must not be empty")
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


def owntracks_url(url, session_id):
    parts = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
             if key not in ("action", "id")]
    query.extend([("action", "owntracks"), ("id", session_id)])
    return parts._replace(query=urlencode(query), fragment="").geturl()


def snapshot(monitor, stream, port, baud, last_update, session_id, session_started_at, connected=True):
    return {
        "connected": connected,
        "port": port,
        "baud": baud,
        "error": None,
        "last_update": last_update,
        "session_id": session_id,
        "session_started_at": session_started_at,
        "sample_at": time.time(),
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
    if args.list_ports:
        ports = sorted(list_ports.comports())
        for port in ports:
            print(f"{port.device}: {port.description}")
        if not ports:
            print("シリアルポートが見つかりません。")
        return 0

    username = input("yahikoサーバーのBasic認証ユーザー名: ").strip()
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
    gps_has_bytes = False
    last_gps_status = None
    comparison_mode = "pc" if args.pc_location else "gps" if args.gps_port else None
    if args.iphone:
        comparison_mode = "iphone"

    def current_snapshot(connected=True):
        state = snapshot(
            monitor, stream, args.port, args.baud, last_update,
            session_id, session_started_at, connected=connected,
        )
        state["sample_fields"] = sorted(monitor.data.updated_fields)
        monitor.data.updated_fields.clear()
        if comparison_mode:
            state["comparison_mode"] = comparison_mode
            sample = pc.latest if pc else None
            gps_fix_at = gps_monitor.position_updated_at
            if (
                gps_monitor.data["fix"]
                and gps_fix_at is not None
                and 0 <= state["sample_at"] - gps_fix_at <= GPS_FIX_MAX_AGE
            ):
                sample = {
                    "latitude": gps_monitor.data["latitude"],
                    "longitude": gps_monitor.data["longitude"],
                    "timestamp": gps_fix_at,
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
                print(f"比較用受信機の {args.gps_port} ({args.gps_baud} baud) に接続します。")
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
                    gps_raw = gps.read(gps.in_waiting)
                    gps_has_bytes = gps_has_bytes or bool(gps_raw)
                    for sentence in gps_stream.feed(gps_raw):
                        gps_monitor.process_sentence(sentence)

                now = time.monotonic()
                if now - last_upload >= args.interval:
                    state = current_snapshot()
                    if gps:
                        if state["comparison"] is not None:
                            status = "測位を受信しました。"
                        elif gps_monitor.stats["valid"]:
                            status = "NMEAを受信済みです。測位を待っています。"
                        elif gps_has_bytes:
                            status = "有効なNMEAを受信できていません。通信速度と出力形式を確認してください。"
                        else:
                            status = "シリアルデータを待っています。"
                        if status != last_gps_status:
                            print(f"比較用受信機: {status}")
                            last_gps_status = status
                    try:
                        upload(opener, args.url, state)
                        if last_error is not None:
                            print("サーバーへの送信が再開しました。")
                        elif not uploaded_once:
                            print("サーバーへの初回送信に成功しました。")
                        if args.iphone and not uploaded_once:
                            print("OwnTracks の HTTP 送信先に、今回の記録の URL を設定してください。")
                            print(owntracks_url(args.url, session_id))
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
