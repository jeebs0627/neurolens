"""Reviewer sign-in helper for terminal use: stores a short-lived Supabase session (access + refresh token) in training/.session.json.

Why a file: the export runs in a separate process from the terminal where the password is typed. The file lives under training/ (git- and
deploy-ignored), holds only the auth tokens (no password), is chmod 600 where supported, and `nlcolab export --session-file` deletes it after use
unless --keep-session is passed. Access tokens expire after ~1 h; the refresh token lets a long export continue."""
from __future__ import annotations

import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from .export import DEFAULT_ANON, DEFAULT_URL

SESSION_FILE = Path("training") / ".session.json"


def _grant(url: str, anon: str, grant: str, body: dict) -> dict:
    req = urllib.request.Request(url.rstrip("/") + f"/auth/v1/token?grant_type={grant}", data=json.dumps(body).encode("utf-8"), method="POST", headers={"Content-Type": "application/json", "apikey": anon})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"로그인 실패 HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}") from None


def save_session(data: dict, path: Path = SESSION_FILE) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {"access_token": data["access_token"], "refresh_token": data.get("refresh_token"), "expires_at": int(time.time()) + int(data.get("expires_in", 3600)), "user": (data.get("user") or {}).get("email"), "url": DEFAULT_URL}
    path.write_text(json.dumps(rec), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path


def load_session(path: Path = SESSION_FILE, url: str = DEFAULT_URL, anon: str = DEFAULT_ANON) -> str:
    """Return a valid access token, refreshing when it is about to expire."""
    rec = json.loads(path.read_text(encoding="utf-8"))
    if rec.get("expires_at", 0) - time.time() < 300 and rec.get("refresh_token"):
        data = _grant(url, anon, "refresh_token", {"refresh_token": rec["refresh_token"]})
        save_session(data, path)
        return data["access_token"]
    return rec["access_token"]


def main(argv=None) -> int:
    url, anon = DEFAULT_URL, DEFAULT_ANON
    email = (argv[0] if argv else None) or input("연구 관리자 이메일: ").strip()
    pw = getpass.getpass("비밀번호 (입력이 보이지 않음): ")
    data = _grant(url, anon, "password", {"email": email, "password": pw})
    del pw
    p = save_session(data)
    print(f"로그인됨: {data.get('user', {}).get('email')} · 세션 파일 {p} (약 1시간 · export 뒤 자동 삭제)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
