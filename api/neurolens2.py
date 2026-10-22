"""IN MIND 2.0: read-only authorization boundary. Never writes production data."""
import hashlib
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

URL = "https://qonoakggniupuxwvzmmw.supabase.co"
KEY = "sb_publishable_hl6-Y_kMQelu2DByu4bE4g_V9Ru3jNo"  # Public publishable key.


class AccessError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def remote(path, token, body=None):
    req = urllib.request.Request(URL + path, data=body, headers={
        "apikey": KEY, "Authorization": "Bearer " + token,
        "Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.loads(response.read(131072))


def authorize(authorization, fetch=remote, allowed_ids=None):
    if not authorization.startswith("Bearer ") or not 20 <= len(authorization) <= 8192:
        raise AccessError(401, "authentication-required")
    # Existing profile policies may permit self-updates. An explicit server allowlist
    # is therefore required in addition to the existing admin RPC. No metadata trust.
    ids = allowed_ids if allowed_ids is not None else {
        item.strip() for item in os.environ.get("NEUROLENS2_ADMIN_IDS", "").split(",") if item.strip()}
    if not ids:
        raise AccessError(503, "admin-allowlist-not-configured")
    token = authorization[7:]
    try:
        user = fetch("/auth/v1/user", token)
        if not isinstance(user, dict) or not user.get("id"):
            raise AccessError(401, "invalid-session")
        if user["id"] not in ids:
            raise AccessError(403, "administrator-required")
        if fetch("/rest/v1/rpc/is_admin", token, b"{}") is not True:
            raise AccessError(403, "administrator-required")
    except AccessError:
        raise
    except urllib.error.HTTPError as exc:
        raise AccessError(401 if exc.code in (401, 403) else 503, "authorization-unavailable") from exc
    except Exception as exc:
        raise AccessError(503, "authorization-unavailable") from exc
    return {"authorized": True, "scope": hashlib.sha256(("nl2:" + user["id"]).encode()).hexdigest()[:24],
            "mode": "supabase-admin", "leaseSeconds": 300, "engine": "nl2-2.2.0"}


class handler(BaseHTTPRequestHandler):
    def respond(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        for key, value in {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
                           "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow"}.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        try:
            result = authorize(self.headers.get("Authorization", ""))
            self.respond(200, result)
        except AccessError as exc:
            self.respond(exc.status, {"error": exc.code})

    def do_POST(self):
        self.respond(405, {"error": "method-not-allowed"})

    do_PUT = do_DELETE = do_PATCH = do_POST
