# -*- coding: utf-8 -*-
"""Vercel Serverless Function: GET /mg/{endpoint} — MindGaze API 프록시 (CORS 회피).

vercel.json 의 rewrite 로 /mg/chkmbr → /api/mg?endpoint=chkmbr 형태로 전달됩니다.
"""
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

# api.mindgaze.ai 인증서가 도메인과 불일치하여 검증 생략 (이 호스트 프록시에만 사용)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# 순서대로 시도 (앞이 실패하면 다음 주소로 폴백)
MINDGAZE_API_BASES = [
    "https://mindgaze.ai/api",            # 실서비스 도메인 (동작 확인됨)
    "https://api.mindgaze.ai/api",        # 문서상 주소
    "http://211.218.126.208:38080/api",   # 관리 시스템 서버
]

ALLOWED_ENDPOINTS = {"chkmbr", "getsrvyrslt"}  # 필요 시 추가


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = dict(urllib.parse.parse_qsl(parsed.query))
        endpoint = qs.pop("endpoint", "")
        if not endpoint or endpoint not in ALLOWED_ENDPOINTS:
            return self._send(404, {"resCd": "9998", "resMsg": "unknown endpoint"})

        data = urllib.parse.urlencode(qs).encode("utf-8")
        errors = []
        for base in MINDGAZE_API_BASES:
            url = f"{base}/{endpoint}"
            origin = base.rsplit("/api", 1)[0]
            req = urllib.request.Request(
                url, data=data,
                headers={
                    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                                   "Chrome/126.0.0.0 Safari/537.36"),
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "ko-KR,ko;q=0.9",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Origin": origin,
                    "Referer": origin + "/",
                    "X-Requested-With": "XMLHttpRequest",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as res:
                    body = res.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            except urllib.error.HTTPError as e:
                errors.append(f"{url} -> HTTP {e.code} {e.reason}")
            except Exception as e:  # noqa: BLE001
                errors.append(f"{url} -> {e}")

        self._send(502, {"resCd": "9999", "resMsg": " / ".join(errors)})

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
