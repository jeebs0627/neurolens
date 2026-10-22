"""Loopback-only research preview. The OS user receives a single-use entry ticket.

This is not the production authorization endpoint and cannot bind externally.
No request can read production pages, operating result files, or arbitrary paths.
"""
import argparse
import getpass
import hashlib
import importlib.util
import json
import mimetypes
import os
from pathlib import Path
import secrets
import socket
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nl2_gateway", ROOT / "api" / "neurolens2.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def server_bind(self):
        # Windows otherwise permits two previews to share a port and route a
        # fresh ticket to the older process, which cannot recognize it.
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def __init__(self, port=0):
        super().__init__(("127.0.0.1", port), PreviewHandler)
        self.ticket = secrets.token_urlsafe(36)
        self.ticket_expiry = time.monotonic() + 600
        self.sessions = {}
        self.lock = threading.Lock()
        self.scope = hashlib.sha256(("nl2-local:" + getpass.getuser() + str(ROOT)).encode()).hexdigest()[:24]

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server_port)


class PreviewHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log tickets, headers, or credentials.

    def allowed_host(self):
        return self.client_address[0] == "127.0.0.1" and self.headers.get("Host") == "127.0.0.1:" + str(self.server.server_port)

    def session(self):
        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie.get("nl2_local")
            if token and self.server.sessions.get(token.value, 0) > time.monotonic():
                return token.value
        except Exception:
            pass
        return None

    def send(self, code, payload, content_type="application/json; charset=utf-8", cookie=None):
        data = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
        self.send_response(code)
        for key, value in {"Content-Type": content_type, "Content-Length": str(len(data)), "Cache-Control": "no-store",
                           "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                           "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
                           "Permissions-Policy": "camera=(self), microphone=(), geolocation=()"}.items():
            self.send_header(key, value)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        if not self.allowed_host():
            return self.send(403, {"error": "loopback-host-required"})
        path = unquote(urlsplit(self.path).path)
        if path == "/api/neurolens2":
            if self.session():
                return self.send(200, {"authorized": True, "scope": self.server.scope, "mode": "local-owner", "leaseSeconds": 300, "engine": "nl2-2.2.0"})
            try:
                return self.send(200, gateway.authorize(self.headers.get("Authorization", "")))
            except gateway.AccessError as exc:
                return self.send(exc.status, {"error": exc.code})
        if path == "/":
            path = "/neurolens2.html"
        allowed = path == "/neurolens2.html" or path.startswith("/neurolens2/")
        target = (ROOT / path.lstrip("/")).resolve()
        extensions = {".html", ".js", ".mjs", ".css", ".json", ".jpg", ".png", ".wasm", ".task", ".txt"}
        if (not allowed or not target.is_relative_to(ROOT) or not target.is_file() or target.suffix not in extensions
                or ".." in path.split("/") or target.name == "operational-baseline.json"
                or (path != "/neurolens2.html" and not target.is_relative_to(ROOT / "neurolens2"))):
            return self.send(404, {"error": "not-found"})
        kind = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream"}.get(target.suffix)
        return self.send(200, target.read_bytes(), kind or mimetypes.guess_type(str(target))[0] or "application/octet-stream")

    do_HEAD = do_GET

    def do_POST(self):
        if not self.allowed_host() or self.headers.get("Origin") != self.server.origin:
            return self.send(403, {"error": "same-origin-required"})
        path = urlsplit(self.path).path
        if path == "/api/neurolens2/logout":
            token = self.session()
            if token:
                self.server.sessions.pop(token, None)
            return self.send(200, {"ok": True}, cookie="nl2_local=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
        if path != "/api/neurolens2/bootstrap":
            return self.send(405, {"error": "method-not-allowed"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 2048 or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.send(400, {"error": "invalid-request"})
            data = json.loads(self.rfile.read(size))
            ticket = data.get("ticket", "")
            with self.server.lock:
                valid = (isinstance(ticket, str) and self.server.ticket is not None
                         and time.monotonic() < self.server.ticket_expiry
                         and secrets.compare_digest(ticket, self.server.ticket))
                if not valid:
                    return self.send(403, {"error": "invalid-ticket"})
                self.server.ticket = None
                token = secrets.token_urlsafe(36)
                self.server.sessions[token] = time.monotonic() + 8 * 3600
            return self.send(200, {"ok": True}, cookie="nl2_local=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800")
        except (ValueError, TypeError, AttributeError):
            return self.send(400, {"error": "invalid-request"})

    def do_PUT(self):
        return self.send(405, {"error": "method-not-allowed"})

    do_DELETE = do_PATCH = do_PUT


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8872)
    parser.add_argument("--state-file", type=Path)
    args = parser.parse_args()
    try:
        server = PreviewServer(args.port)
    except OSError:
        server = PreviewServer(0)
    state = {"pid": os.getpid(), "port": server.server_port,
             "url": server.origin + "/neurolens2.html#local-ticket=" + server.ticket}
    if args.state_file:
        if args.state_file.resolve().is_relative_to(ROOT):
            raise SystemExit("State file must be outside the served workspace.")
        args.state_file.parent.mkdir(parents=True, exist_ok=True)
        args.state_file.write_text(json.dumps(state), encoding="utf-8")
    else:
        print(json.dumps(state), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
