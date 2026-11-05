#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Python 2.7-compatible CGI endpoint for the remote GNSS viewer."""

import json
import math
import os
import sys
import tempfile
import time


MAX_BODY_BYTES = 65536
MAX_TRAIL_POINTS = 500
DEFAULT_STATE_FILE = os.path.join(os.path.expanduser("~"), ".slas-map-gnss", "latest.json")
STATE_FILE = os.environ.get("GNSS_STATE_FILE") or DEFAULT_STATE_FILE
STATE_DIR = os.path.dirname(STATE_FILE)

try:
    text_type = unicode
except NameError:
    text_type = str


def blank_state():
    return {
        "connected": False,
        "port": None,
        "baud": None,
        "error": None,
        "last_update": None,
        "data": {
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
        },
        "stats": {},
        "noise_bytes": 0,
        "trail": [],
        "received_at": None,
    }


def is_number(value):
    return isinstance(value, (int, long, float)) and not isinstance(value, bool)


def is_finite_number(value):
    return is_number(value) and not math.isnan(float(value)) and not math.isinf(float(value))


def validate_state(state):
    if not isinstance(state, dict):
        raise ValueError("JSONの形式が正しくありません")
    if not isinstance(state.get("data"), dict) or not isinstance(state.get("stats"), dict):
        raise ValueError("dataまたはstatsがありません")
    if not isinstance(state.get("trail"), list) or len(state["trail"]) > MAX_TRAIL_POINTS:
        raise ValueError("trailの形式が正しくありません")

    data = state["data"]
    latitude = data.get("latitude")
    longitude = data.get("longitude")
    if latitude is not None and (not is_finite_number(latitude) or abs(latitude) > 90):
        raise ValueError("緯度が範囲外です")
    if longitude is not None and (not is_finite_number(longitude) or abs(longitude) > 180):
        raise ValueError("経度が範囲外です")

    for point in state["trail"]:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError("軌跡の座標形式が正しくありません")
        if (not is_finite_number(point[0]) or abs(point[0]) > 90
                or not is_finite_number(point[1]) or abs(point[1]) > 180):
            raise ValueError("軌跡の座標が範囲外です")

    state["trail"] = state["trail"][-MAX_TRAIL_POINTS:]
    state["received_at"] = time.time()
    # NaN / Infinityを含むJSONは受け付けない
    json.dumps(state, ensure_ascii=True, allow_nan=False)
    return state


def save_state(state):
    if not os.path.isdir(STATE_DIR):
        try:
            os.makedirs(STATE_DIR, 0700)
        except OSError:
            if not os.path.isdir(STATE_DIR):
                raise
    try:
        os.chmod(STATE_DIR, 0700)
    except OSError:
        pass

    encoded = json.dumps(state, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    if isinstance(encoded, text_type):
        encoded = encoded.encode("utf-8")
    fd, temporary_path = tempfile.mkstemp(prefix="latest-", suffix=".tmp", dir=STATE_DIR)
    try:
        output_file = os.fdopen(fd, "wb")
        try:
            output_file.write(encoded)
        finally:
            output_file.close()
        os.chmod(temporary_path, 0600)
        # Atomic replacement keeps concurrent readers from seeing a partial file.
        os.rename(temporary_path, STATE_FILE)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


def load_state():
    try:
        source = open(STATE_FILE, "rb")
        try:
            raw = source.read(MAX_BODY_BYTES + 1)
        finally:
            source.close()
        if len(raw) > MAX_BODY_BYTES:
            return blank_state()
        state = json.loads(raw)
        if not isinstance(state, dict):
            return blank_state()
        state.setdefault("received_at", None)
        return state
    except (IOError, ValueError, TypeError):
        return blank_state()


def send_json(status, body):
    encoded = json.dumps(body, ensure_ascii=True, allow_nan=False)
    if isinstance(encoded, text_type):
        encoded = encoded.encode("utf-8")
    if status != 200:
        sys.stdout.write("Status: %s\r\n" % status)
    sys.stdout.write("Content-Type: application/json; charset=utf-8\r\n")
    sys.stdout.write("Cache-Control: no-store\r\n")
    sys.stdout.write("X-Content-Type-Options: nosniff\r\n")
    sys.stdout.write("Content-Length: %d\r\n\r\n" % len(encoded))
    sys.stdout.write(encoded)


def handle_get():
    state = load_state()
    received_at = state.get("received_at")
    if (state.get("connected") and is_finite_number(received_at)
            and time.time() - received_at > 10):
        state["connected"] = False
        state["error"] = "送信元から10秒以上データが届いていません。"
    send_json(200, state)


def handle_post():
    content_type = os.environ.get("CONTENT_TYPE", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        send_json("415 Unsupported Media Type", {"error": "Content-Typeはapplication/jsonにしてください"})
        return
    try:
        length = int(os.environ.get("CONTENT_LENGTH", "0"))
    except ValueError:
        length = 0
    if length <= 0 or length > MAX_BODY_BYTES:
        send_json("413 Payload Too Large", {"error": "送信データのサイズが正しくありません"})
        return
    try:
        raw = sys.stdin.read(length)
        state = validate_state(json.loads(raw))
    except (ValueError, TypeError) as error:
        send_json("400 Bad Request", {"error": str(error)})
        return
    try:
        save_state(state)
    except (IOError, OSError):
        send_json("500 Internal Server Error", {"error": "保存先に書き込めません"})
        return
    send_json(200, {"ok": True})


def main():
    method = os.environ.get("REQUEST_METHOD", "GET").upper()
    query = os.environ.get("QUERY_STRING", "")
    route = ""
    for item in query.split("&"):
        if item.split("=", 1)[0] == "action":
            route = item.split("=", 1)[-1]
            break

    if route == "state" and method == "GET":
        handle_get()
    elif route == "ingest" and method == "POST":
        handle_post()
    elif route in ("state", "ingest"):
        send_json("405 Method Not Allowed", {"error": "HTTPメソッドが正しくありません"})
    else:
        send_json("404 Not Found", {"error": "APIが見つかりません"})


if __name__ == "__main__":
    main()
