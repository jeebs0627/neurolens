# -*- coding: utf-8 -*-
"""Vercel Serverless Function: POST /gemini — Gemini AI 총평 프록시.

API 키는 Vercel 프로젝트 환경변수 GEMINI_API_KEY 에서 읽습니다.
(Settings → Environment Variables → GEMINI_API_KEY)
"""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            return self._send(500, {"error": "GEMINI_API_KEY 환경변수가 설정되지 않았습니다."})

        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            prompt = body.get("prompt", "")
            payload = json.dumps({
                "contents": [{"parts": [{"text": prompt}]}],
                # thinkingBudget 0: 2.5-flash의 내부 사고 토큰이 maxOutputTokens를
                # 소모해 총평이 중간에 잘리는 문제 방지
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 3072,
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            }).encode("utf-8")
            url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
                   f"{GEMINI_MODEL}:generateContent")
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=55) as res:
                data = json.loads(res.read().decode("utf-8"))
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts)
            self._send(200, {"text": text})
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                pass
            self._send(502, {"error": f"HTTP {e.code}", "detail": detail})
        except Exception as e:  # noqa: BLE001
            self._send(502, {"error": str(e)})

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
