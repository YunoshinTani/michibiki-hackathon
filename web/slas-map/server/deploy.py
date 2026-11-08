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
FILES = ("index.html", "app.js", "standard.css", "style.css", "gnss_api.cgi")

REMOTE_SCRIPT = """
set -eu
destination=$1
if [ -z "$destination" ]; then
    for candidate in "$HOME"/*/michibiki; do
        [ -f "$candidate/gnss_api.cgi" ] || continue
        if [ -n "$destination" ]; then
            echo "Multiple michibiki sites found. Use --remote-dir." >&2
            exit 1
        fi
        destination=$candidate
    done
fi
if [ -z "$destination" ] || [ ! -f "$destination/gnss_api.cgi" ]; then
    echo "Existing michibiki site not found. Use --remote-dir with its absolute path." >&2
    exit 1
fi
cd "$destination"
stage=$(mktemp -d .slas-deploy.XXXXXXXX)
trap 'rm -f -- "$stage"/index.html "$stage"/app.js "$stage"/standard.css "$stage"/style.css "$stage"/gnss_api.cgi "$stage"/cgi-ready; rmdir -- "$stage"' EXIT
tar -xf - -C "$stage"
for name in index.html app.js standard.css style.css gnss_api.cgi; do
    test -s "$stage/$name"
done
shebang=$(head -n 1 gnss_api.cgi | tr -d '\\r')
case "$shebang" in
    '#!'*) ;;
    *) echo "The installed CGI has no interpreter line." >&2; exit 1 ;;
esac
{ printf '%s\\n' "$shebang"; tail -n +2 "$stage/gnss_api.cgi"; } > "$stage/cgi-ready"
chmod 644 "$stage"/index.html "$stage"/app.js "$stage"/standard.css "$stage"/style.css
chmod 755 "$stage/cgi-ready"
mv -f -- "$stage/cgi-ready" gnss_api.cgi
for name in app.js standard.css style.css index.html; do
    mv -f -- "$stage/$name" "$name"
done
printf 'Published to %s\\n' "$PWD"
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote-dir", default="", help="absolute path of the existing school website")
    args = parser.parse_args()
    if args.remote_dir and not args.remote_dir.startswith("/"):
        parser.error("--remote-dir must be an absolute Linux path")

    remote_command = "sh -c " + shlex.quote(REMOTE_SCRIPT) + " slas-deploy " + shlex.quote(args.remote_dir)
    with tempfile.TemporaryFile() as bundle:
        with tarfile.open(fileobj=bundle, mode="w") as archive:
            for name in FILES:
                path = ROOT / ("server" if name == "gnss_api.cgi" else "") / name
                data = path.read_bytes().replace(b"\r\n", b"\n")
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        bundle.seek(0)
        try:
            return subprocess.call(["ssh", "-o", "ConnectTimeout=10", HOST, remote_command], stdin=bundle)
        except FileNotFoundError:
            parser.exit(1, "OpenSSH client (ssh) was not found.\n")


if __name__ == "__main__":
    raise SystemExit(main())
