# -*- coding: utf-8 -*-
"""Vercel Serverless Function: GET /last-result — 폴링 보조 채널 스텁.

서버리스 함수는 호출 간 메모리를 공유하지 않으므로 마지막 결과를 저장할 수 없습니다.
Vercel 배포에서는 /rcvrslt 의 postMessage 가 결과 전달을 담당하며,
이 엔드포인트는 프런트엔드 폴링이 에러 없이 동작하도록 빈 응답을 반환합니다.
(영속 저장이 필요하면 Vercel KV/Upstash 연동으로 확장 가능)
"""
import json
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        body = json.dumps({"seq": 0, "data": None}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
