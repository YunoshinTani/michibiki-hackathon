#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Python 2.7-compatible CGI API for persistent GNSS session records."""

import fcntl
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import time
import urlparse


MAX_BODY_BYTES = 65536
TRACK_PAGE_POINTS = 5000
DEFAULT_STATE_DIR = os.path.join(os.path.expanduser("~"), ".slas-map-gnss")
STATE_DIR = os.path.dirname(os.environ.get("GNSS_STATE_FILE") or os.path.join(DEFAULT_STATE_DIR, "latest.json"))
LEGACY_STATE_FILE = os.environ.get("GNSS_STATE_FILE") or os.path.join(STATE_DIR, "latest.json")
SESSIONS_DIR = os.path.join(STATE_DIR, "sessions")
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}\Z")

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
        "session_id": None,
        "session": None,
        "received_at": None,
    }


def is_number(value):
    return isinstance(value, (int, long, float)) and not isinstance(value, bool)


def is_finite_number(value):
    return is_number(value) and not math.isnan(float(value)) and not math.isinf(float(value))


def ensure_directory(path):
    if not os.path.isdir(path):
        try:
            os.makedirs(path, 0700)
        except OSError:
            if not os.path.isdir(path):
                raise
    try:
        os.chmod(path, 0700)
    except OSError:
        pass


def atomic_json(path, value):
    directory = os.path.dirname(path)
    ensure_directory(directory)
    encoded = json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
    if isinstance(encoded, text_type):
        encoded = encoded.encode("utf-8")
    fd, temporary_path = tempfile.mkstemp(prefix="record-", suffix=".tmp", dir=directory)
    try:
        output_file = os.fdopen(fd, "wb")
        try:
            output_file.write(encoded)
        finally:
            output_file.close()
        os.chmod(temporary_path, 0600)
        os.rename(temporary_path, path)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


def read_json(path, max_bytes=MAX_BODY_BYTES):
    source = open(path, "rb")
    try:
        raw = source.read(max_bytes + 1)
    finally:
        source.close()
    if len(raw) > max_bytes:
        raise ValueError("保存データが大きすぎます")
    return json.loads(raw)


def session_directory(session_id):
    if not isinstance(session_id, basestring) or not SESSION_ID_PATTERN.match(session_id):
        raise ValueError("記録IDが正しくありません")
    return os.path.join(SESSIONS_DIR, "session-" + session_id)


def session_paths(session_id):
    directory = session_directory(session_id)
    return {
        "directory": directory,
        "meta": os.path.join(directory, "meta.json"),
        "state": os.path.join(directory, "state.json"),
        "track": os.path.join(directory, "track.jsonl"),
        "comparison": os.path.join(directory, "comparison.jsonl"),
    }


def valid_coordinate_pair(latitude, longitude):
    return (is_finite_number(latitude) and abs(latitude) <= 90
            and is_finite_number(longitude) and abs(longitude) <= 180)


def migrate_legacy_record():
    ensure_directory(SESSIONS_DIR)
    lock_file = open(os.path.join(SESSIONS_DIR, ".legacy-migration.lock"), "a")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        migrate_legacy_record_locked()
    finally:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        finally:
            lock_file.close()

def migrate_legacy_record_locked():
    """Keep the previous single-record snapshot selectable after upgrading."""
    try:
        raw_source = open(LEGACY_STATE_FILE, "rb")
        try:
            raw = raw_source.read(MAX_BODY_BYTES + 1)
        finally:
            raw_source.close()
        if len(raw) > MAX_BODY_BYTES:
            return
        old_state = json.loads(raw)
    except (IOError, ValueError, TypeError):
        return
    if not isinstance(old_state, dict) or not isinstance(old_state.get("data"), dict):
        return

    session_id = "legacy_" + hashlib.sha1(raw).hexdigest()[:20]
    paths = session_paths(session_id)
    if os.path.exists(paths["meta"]):
        return

    data = old_state.get("data", {})
    points = []
    old_trail = old_state.get("trail", [])
    if isinstance(old_trail, list):
        for point in old_trail:
            if (isinstance(point, (list, tuple)) and len(point) == 2
                    and valid_coordinate_pair(point[0], point[1])):
                pair = [float(point[0]), float(point[1])]
                if not points or points[-1] != pair:
                    points.append(pair)
    if not points and data.get("fix") and valid_coordinate_pair(data.get("latitude"), data.get("longitude")):
        points.append([float(data["latitude"]), float(data["longitude"])])

    started_at = old_state.get("last_update") or os.path.getmtime(LEGACY_STATE_FILE)
    state = dict(old_state)
    state.pop("trail", None)
    state["connected"] = False
    state["session_id"] = session_id
    state["error"] = None
    state["received_at"] = old_state.get("received_at") or started_at
    state["trail"] = []

    ensure_directory(paths["directory"])
    track_file = open(paths["track"], "wb")
    try:
        for point in points:
            track_file.write(json.dumps(point, separators=(",", ":")) + "\n")
    finally:
        track_file.close()
    try:
        os.chmod(paths["track"], 0600)
    except OSError:
        pass

    metadata = {
        "id": session_id,
        "started_at": started_at,
        "last_update": old_state.get("last_update"),
        "received_at": state["received_at"],
        "ended_at": state["received_at"],
        "connected": False,
        "point_count": len(points),
        "last_point": points[-1] if points else None,
        "legacy": True,
    }
    atomic_json(paths["state"], state)
    atomic_json(paths["meta"], metadata)


def validate_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("JSONの形式が正しくありません")
    session_id = payload.get("session_id")
    paths = session_paths(session_id)
    data = payload.get("data")
    stats = payload.get("stats")
    if not isinstance(data, dict) or not isinstance(stats, dict):
        raise ValueError("dataまたはstatsがありません")
    if not isinstance(payload.get("connected"), bool):
        raise ValueError("connectedがありません")

    latitude = data.get("latitude")
    longitude = data.get("longitude")
    if latitude is not None and not is_finite_number(latitude):
        raise ValueError("緯度が数値ではありません")
    if longitude is not None and not is_finite_number(longitude):
        raise ValueError("経度が数値ではありません")
    if latitude is not None and abs(latitude) > 90:
        raise ValueError("緯度が範囲外です")
    if longitude is not None and abs(longitude) > 180:
        raise ValueError("経度が範囲外です")

    comparison_mode = payload.get("comparison_mode")
    comparison = payload.get("comparison")
    if comparison_mode not in (None, "pc", "gps"):
        raise ValueError("比較位置の種類が正しくありません")
    if comparison is not None:
        if (comparison_mode is None or not isinstance(comparison, dict)
                or not valid_coordinate_pair(comparison.get("latitude"), comparison.get("longitude"))
                or not is_finite_number(comparison.get("timestamp"))):
            raise ValueError("比較位置の座標または時刻が正しくありません")
        accuracy = comparison.get("accuracy")
        if accuracy is not None and (not is_finite_number(accuracy) or accuracy < 0):
            raise ValueError("比較位置の推定精度が正しくありません")
        comparison = dict((key, comparison.get(key))
                          for key in ("latitude", "longitude", "timestamp", "accuracy"))

    position_at = payload.get("position_at")
    if position_at is not None and not is_finite_number(position_at):
        raise ValueError("QZ1 の測位時刻が正しくありません")

    state = {
        "connected": payload["connected"],
        "port": payload.get("port"),
        "baud": payload.get("baud"),
        "error": payload.get("error"),
        "last_update": payload.get("last_update"),
        "data": data,
        "position_at": position_at,
        "comparison_mode": comparison_mode,
        "comparison": comparison,
        "stats": stats,
        "noise_bytes": payload.get("noise_bytes", 0),
        "trail": [],
        "session_id": session_id,
        "received_at": time.time(),
    }
    json.dumps(state, ensure_ascii=True, allow_nan=False)
    return paths, state, payload.get("session_started_at")


def append_point(path, metadata, data, last_key, count_key):
    latitude = data.get("latitude")
    longitude = data.get("longitude")
    if not valid_coordinate_pair(latitude, longitude):
        return
    point = [float(latitude), float(longitude)]
    if metadata.get(last_key) == point:
        return

    encoded = json.dumps(point, separators=(",", ":")) + "\n"
    with open(path, "ab") as track_file:
        track_file.write(encoded)
    metadata[last_key] = point
    metadata[count_key] = metadata.get(count_key, 0) + 1


def save_session(paths, state, session_started_at):
    ensure_directory(paths["directory"])
    with open(os.path.join(paths["directory"], ".write.lock"), "a") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            metadata = read_json(paths["meta"])
        except IOError as error:
            if error.errno != 2:
                raise
            metadata = {
                "id": state["session_id"],
                "started_at": session_started_at if is_finite_number(session_started_at) else state["received_at"],
                "legacy": False,
            }

        if state["data"].get("fix"):
            append_point(paths["track"], metadata, state["data"], "last_point", "point_count")
        if state["comparison"] is not None:
            append_point(paths["comparison"], metadata, state["comparison"],
                         "last_comparison_point", "comparison_point_count")
        metadata.update(last_update=state["last_update"], received_at=state["received_at"],
                        connected=state["connected"],
                        ended_at=None if state["connected"] else state["received_at"])
        atomic_json(paths["state"], state)
        atomic_json(paths["meta"], metadata)
        return metadata


def handle_ingest():
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
        payload = json.loads(sys.stdin.read(length))
        paths, state, session_started_at = validate_payload(payload)
    except (ValueError, TypeError, OverflowError) as error:
        send_json("400 Bad Request", {"error": str(error)})
        return
    try:
        migrate_legacy_record()
        metadata = save_session(paths, state, session_started_at)
    except (ValueError, IOError, OSError):
        send_json("500 Internal Server Error", {"error": "記録を保存できません"})
        return
    send_json(200, {"ok": True, "session_id": state["session_id"], "point_count": metadata.get("point_count", 0)})


def present_metadata(metadata):
    result = dict(metadata)
    result.pop("last_point", None)
    result.pop("last_comparison_point", None)
    received_at = result.get("received_at")
    if (result.get("connected") and is_finite_number(received_at)
            and time.time() - received_at > 10):
        result["connected"] = False
    return result


def list_sessions():
    migrate_legacy_record()
    if not os.path.isdir(SESSIONS_DIR):
        return []
    sessions = []
    for entry in os.listdir(SESSIONS_DIR):
        if not entry.startswith("session-"):
            continue
        session_id = entry[len("session-"):]
        if not SESSION_ID_PATTERN.match(session_id):
            continue
        paths = session_paths(session_id)
        try:
            metadata = read_json(paths["meta"])
        except (IOError, ValueError, TypeError):
            continue
        metadata["id"] = session_id
        sessions.append(present_metadata(metadata))
    sessions.sort(key=lambda item: item.get("started_at") or 0, reverse=True)
    return sessions


def handle_sessions():
    send_json(200, {"sessions": list_sessions()})


def handle_state(session_id):
    if not session_id:
        sessions = list_sessions()
        session_id = sessions[0]["id"] if sessions else None
    if not session_id:
        send_json(200, blank_state())
        return
    try:
        paths = session_paths(session_id)
        state = read_json(paths["state"])
        metadata = read_json(paths["meta"])
    except (ValueError, IOError, TypeError):
        send_json("404 Not Found", {"error": "記録が見つかりません"})
        return

    result = dict(state)
    result["trail"] = []
    result["session_id"] = session_id
    result["session"] = present_metadata(metadata)
    session_info = result["session"]
    if session_info.get("connected") is False and state.get("connected"):
        result["connected"] = False
        result["error"] = "送信元から10秒以上データが届いていません。"
    send_json(200, result)


def handle_track(session_id, offset_text, source):
    if source not in ("qz1", "comparison"):
        send_json("400 Bad Request", {"error": "経路の種類が正しくありません"})
        return
    try:
        paths = session_paths(session_id)
        offset = int(offset_text or "0")
        if offset < 0:
            raise ValueError("offsetが範囲外です")
        metadata = read_json(paths["meta"])
        track_path = paths["comparison" if source == "comparison" else "track"]
        count_key = "comparison_point_count" if source == "comparison" else "point_count"
        if not os.path.exists(track_path):
            send_json(200, {"id": session_id, "points": [], "next_offset": 0, "has_more": False, "total": 0})
            return
        track_file = open(track_path, "rb")
    except (ValueError, IOError, TypeError):
        send_json("404 Not Found", {"error": "経路データが見つかりません"})
        return

    points = []
    try:
        size = os.fstat(track_file.fileno()).st_size
        if offset > size:
            offset = size
        track_file.seek(offset)
        for _ in range(TRACK_PAGE_POINTS):
            line = track_file.readline()
            if not line.endswith("\n"):
                track_file.seek(-len(line), os.SEEK_CUR)
                break
            points.append(json.loads(line))
        next_offset = track_file.tell()
        has_more = bool(points) and next_offset < size
    except (ValueError, TypeError, IOError):
        track_file.close()
        send_json("500 Internal Server Error", {"error": "経路データを読み取れません"})
        return
    track_file.close()
    send_json(200, {
        "id": session_id,
        "points": points,
        "next_offset": next_offset,
        "has_more": has_more,
        "total": int(metadata.get(count_key, 0)),
    })


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


def main():
    os.umask(0077)
    query = urlparse.parse_qs(os.environ.get("QUERY_STRING", ""))
    action = query.get("action", [""])[0]
    method = os.environ.get("REQUEST_METHOD", "GET").upper()
    session_id = query.get("id", [""])[0]

    if action == "ingest" and method == "POST":
        handle_ingest()
    elif action == "sessions" and method == "GET":
        handle_sessions()
    elif action == "state" and method == "GET":
        handle_state(session_id)
    elif action == "track" and method == "GET":
        handle_track(session_id, query.get("offset", ["0"])[0], query.get("source", ["qz1"])[0])
    elif action in ("ingest", "sessions", "state", "track"):
        send_json("405 Method Not Allowed", {"error": "HTTPメソッドが正しくありません"})
    else:
        send_json("404 Not Found", {"error": "APIが見つかりません"})


if __name__ == "__main__":
    main()
