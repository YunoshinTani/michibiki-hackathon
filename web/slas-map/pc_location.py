"""Collect browser location from a private loopback page on the sending PC."""

import json
import math
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


PAGE = """<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>PC の位置情報を送信</title>
<style>body{font:1rem/1.7 system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem}
:root{color-scheme:light dark}button{font:inherit}</style>
<h1>PC の位置情報を送信</h1>
<p>許可すると、この PC の推定位置が QZ1 の記録と一緒に学校サーバーへ送信されます。
送信中はこのページを開いておいてください。</p>
<button type="button" id="start">位置情報を許可して送信</button>
<p id="feedback" role="status">開始待ち</p>
<script>
const start = document.getElementById('start');
const feedback = document.getElementById('feedback');
function requestPosition() {
  navigator.geolocation.getCurrentPosition(async ({coords, timestamp}) => {
    try {
      const response = await fetch(location.pathname, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({latitude: coords.latitude, longitude: coords.longitude,
          accuracy: coords.accuracy, timestamp: timestamp / 1000})
      });
      if (!response.ok) throw new Error();
      feedback.textContent = 'PC の位置を送信プログラムへ渡しました。';
    } catch {
      feedback.textContent = '送信プログラムに接続できません。起動状態を確認してください。';
      start.disabled = false;
      return;
    }
    setTimeout(requestPosition, 2500);
  }, (error) => {
    feedback.textContent = '位置情報を取得できません。ブラウザーと Windows の位置情報設定を確認してください。';
    if (error.code === 1) start.disabled = false;
    else setTimeout(requestPosition, 2500);
  }, {enableHighAccuracy: true, maximumAge: 0, timeout: 10000});
}
start.onclick = () => {
  if (!navigator.geolocation) {
    feedback.textContent = 'このブラウザーでは位置情報を取得できません。';
    return;
  }
  start.disabled = true;
  feedback.textContent = '位置情報を取得しています。';
  requestPosition();
};
</script></html>
""".encode("utf-8")


class PCPosition:
    latest = None

    def __enter__(self):
        path = "/" + secrets.token_urlsafe(24)
        source = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def setup(self):
                self.request.settimeout(2)
                super().setup()

            def valid_path(self):
                return self.path == path and self.headers.get("Host") == authority

            def do_GET(self):
                if not self.valid_path():
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.end_headers()
                self.wfile.write(PAGE)

            def do_POST(self):
                if not self.valid_path() or self.headers.get("Origin") != origin:
                    self.send_error(403)
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 1024 or self.headers.get_content_type() != "application/json":
                        raise ValueError
                    data = json.loads(self.rfile.read(length))
                    limits = {"latitude": (-90, 90), "longitude": (-180, 180),
                              "accuracy": (0, math.inf), "timestamp": (0, time.time() + 5)}
                    for key, (low, high) in limits.items():
                        value = data[key]
                        if type(value) not in (int, float) or not low <= value <= high or not math.isfinite(value):
                            raise ValueError
                except (ValueError, KeyError, TypeError, OSError, OverflowError):
                    self.send_error(400)
                    return
                if source.latest is None or data["timestamp"] >= source.latest["timestamp"]:
                    source.latest = {key: data[key] for key in limits}
                self.send_response(204)
                self.end_headers()

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        authority = f"127.0.0.1:{self.server.server_port}"
        origin = f"http://{authority}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        print(f"PC の位置情報を使うには、この PC のブラウザーで開いてください。\n{origin}{path}")
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
