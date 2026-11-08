"""Upload the school site's public files through the configured SSH account."""

import argparse
import io
import shlex
import subprocess
import tarfile
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = "ec36104x@yahiko.st.nagaoka-ct.ac.jp"
REMOTE_DIR = "/home/ec/ec36104x/public_html/michibiki"
STATIC_FILES = (
    "app.js", "standard.css", "style.css",
    "brand-icon.png", "favicon-32x32.png", "brand-light.png", "brand-dark.png",
    "index.html",
)

REMOTE_SCRIPT = """
set -eu
destination=$1
shift
if [ ! -f "$destination/gnss_api.cgi" ]; then
    printf 'Existing CGI not found: %s/gnss_api.cgi\\n' "$destination" >&2
    exit 1
fi
cd "$destination"
stage=$(mktemp -d .slas-deploy.XXXXXXXX)
trap 'for name in "$@" gnss_api.cgi cgi-ready; do rm -f -- "$stage/$name"; done; rmdir -- "$stage"' EXIT
tar -xf - -C "$stage"
for name in "$@" gnss_api.cgi; do
    test -s "$stage/$name"
done
shebang=$(head -n 1 gnss_api.cgi | tr -d '\\r')
case "$shebang" in
    '#!'*) ;;
    *) echo "The installed CGI has no interpreter line." >&2; exit 1 ;;
esac
{ printf '%s\\n' "$shebang"; tail -n +2 "$stage/gnss_api.cgi"; } > "$stage/cgi-ready"
for name in "$@"; do
    chmod 644 "$stage/$name"
done
chmod 755 "$stage/cgi-ready"
mv -f -- "$stage/cgi-ready" gnss_api.cgi
for name in "$@"; do
    mv -f -- "$stage/$name" "$name"
done
printf 'Published to %s\\n' "$PWD"
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote-dir", default=REMOTE_DIR, help="absolute path of the existing school website")
    args = parser.parse_args()
    if not args.remote_dir.startswith("/"):
        parser.error("--remote-dir must be an absolute Linux path")

    remote_command = shlex.join(("sh", "-c", REMOTE_SCRIPT, "slas-deploy", args.remote_dir, *STATIC_FILES))
    with tempfile.TemporaryFile() as bundle:
        with tarfile.open(fileobj=bundle, mode="w") as archive:
            for name in (*STATIC_FILES, "gnss_api.cgi"):
                path = ROOT / ("server" if name == "gnss_api.cgi" else "") / name
                data = path.read_bytes()
                if path.suffix in (".html", ".js", ".css", ".cgi"):
                    data = data.replace(b"\r\n", b"\n")
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        bundle.seek(0)
        try:
            print(f"公開先: {HOST}:{args.remote_dir}", flush=True)
            return subprocess.call(
                ["ssh", "-T", "-o", "BatchMode=no", "-o", "ConnectTimeout=10", HOST, remote_command],
                stdin=bundle,
            )
        except FileNotFoundError:
            parser.exit(1, "OpenSSH client (ssh) was not found.\n")


if __name__ == "__main__":
    raise SystemExit(main())
