# -*- coding: utf-8 -*-
"""Vercel Serverless Function: POST /rcvrslt — MindGaze 검사 결과 수신.

검사 팝업이 이 주소로 결과(resSrvyJson)를 POST하면,
부모 창(index.html)으로 postMessage 하는 HTML을 돌려줍니다.
서버리스 환경은 무상태이므로 postMessage가 유일한 전달 경로입니다.
(로컬 server.py의 /last-result 폴링은 postMessage 유실 대비용 보조 채널)
"""
import json
import urllib.parse
from http.server import BaseHTTPRequestHandler

RESULT_HTML = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>검사 결과 수신</title>
<style>body{font-family:'Malgun Gothic',sans-serif;background:#0f172a;color:#e2e8f0;
display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}</style>
</head><body><div><h2>✅ 검사 결과가 전달되었습니다.</h2><p>이 창은 닫아도 됩니다.</p></div>
<script>
  var raw = __RESULT__;
  // 1) 같은 도메인 localStorage 에 저장 → 메인 페이지가 감지 (서버리스 환경의 주 전달 경로)
  try {
    localStorage.setItem('mindgazeResult', JSON.stringify({ seq: Date.now(), data: raw }));
  } catch (e) { console.error(e); }
  // 2) 부모 창으로 직접 전달 (보조 경로)
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'mindgazeResult', data: raw }, '*');
    }
  } catch (e) { console.error(e); }
  setTimeout(function(){ window.close(); }, 1500);
</script></body></html>"""


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        params = urllib.parse.parse_qs(body)
        res_json = params.get("resSrvyJson", [""])[0]
        if not res_json:  # raw JSON body로 오는 경우 대비
            res_json = body
        html = RESULT_HTML.replace("__RESULT__", json.dumps(res_json))
        out = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)
