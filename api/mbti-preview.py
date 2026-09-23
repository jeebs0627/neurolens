# -*- coding: utf-8 -*-
"""Generate an administrator preview of a 16 Personalities interpretation."""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

MODEL = "gemini-2.5-flash"
VALID_MBTI = re.compile(r"^[EI][NS][TF][JP]$")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").split(":")[0].lower()
        source = self.headers.get("Origin") or self.headers.get("Referer") or ""
        if not host or (urlparse(source).hostname or "").lower() != host:
            return self._send(403, {"error": "forbidden"})

        key = os.environ.get("chatbot", "").strip()
        if not key:
            return self._send(503, {"error": "chatbot environment variable is missing"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 256:
                return self._send(413, {"error": "invalid request length"})
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            mbti = body.get("mbti", "") if isinstance(body, dict) else ""
            if not isinstance(mbti, str) or not VALID_MBTI.fullmatch(mbti):
                return self._send(400, {"error": "invalid MBTI type"})
        except (ValueError, UnicodeError):
            return self._send(400, {"error": "invalid request"})

        prompt = (
            f"16 Personalities 유형 {mbti}에 대한 한국어 상세 해설을 작성하세요. "
            "일반적인 유형 경향을 3개 문단, 총 350~500자로 설명하세요. "
            "첫 문단은 에너지와 정보 인식, 둘째 문단은 의사결정과 관계, "
            "셋째 문단은 강점을 활용하는 방법과 주의할 점을 다룹니다. "
            "점수나 시선 데이터 등 제공되지 않은 개인 측정값을 추정하지 마세요. "
            "진단이나 확정적인 능력 평가처럼 쓰지 마세요. 제목, 목록, 마크다운 없이 문단만 출력하세요."
        )
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.55, "maxOutputTokens": 900},
        }).encode("utf-8")
        request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            data=payload,
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                data = json.load(response)
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(part.get("text", "") for part in parts).strip()
            if not text:
                raise ValueError("empty model response")
            return self._send(200, {"text": text})
        except urllib.error.HTTPError as error:
            print("MBTI preview upstream HTTP", error.code)
        except Exception as error:  # noqa: BLE001
            print("MBTI preview upstream error", type(error).__name__)
        return self._send(502, {"error": "generation unavailable"})

    def _send(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
