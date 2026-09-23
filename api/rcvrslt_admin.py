# -*- coding: utf-8 -*-
"""Mindgaze callback for the isolated administrator check-in experiment."""
import json
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler

RUN_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
MAX_BODY = 2 * 1024 * 1024

RESULT_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>검사 결과 연결</title>
<style>body{font:16px/1.7 sans-serif;background:#f5f8ff;color:#142445;display:grid;place-items:center;min-height:90vh;text-align:center}</style></head>
<body><main><h1>검사를 완료했습니다</h1><p id="message">사전 체크인과 검사 결과를 연결하고 있습니다…</p></main>
<script>
const run=__RUN__, raw=__RAW__;
try {
  const data=JSON.parse(raw);
  if (!data || typeof data!=='object' || !(data.BIG5 || data.MBTI || data['직업흥미유형'] || data['직무적합도'])) throw Error('결과 데이터가 없습니다.');
  const key='nlAdminRun:'+run;
  const saved=JSON.parse(localStorage.getItem(key)||'null');
  if (!saved || saved.id!==run || !saved.checkin) throw Error('이 검사와 연결된 사전 체크인이 없습니다.');
  saved.result=data; saved.resultAt=Date.now();
  localStorage.setItem(key,JSON.stringify(saved));
  if (window.parent && window.parent!==window) {
    window.parent.postMessage({type:'nlAdminEngineResult',run:run,data:raw},location.origin);
  } else {
    try { if(window.opener&&!window.opener.closed)window.opener.postMessage({type:'nlAdminResultReady',run:run},location.origin); } catch(_) {}
    location.replace('resultadmin.html?run='+encodeURIComponent(run));
  }
} catch(error) {
  document.getElementById('message').textContent='결과 연결 실패: '+error.message+' 관리자 시작 페이지에서 다시 진행해 주세요.';
}
</script></body></html>"""

CANCEL_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>검사 종료</title></head>
<body><p>검사를 종료했습니다. 이 창을 닫아 주세요.</p><script>
try{if(window.parent!==window)window.parent.postMessage({type:'nlEngineCancel'},location.origin);
else if(window.opener)window.opener.postMessage({type:'nlTestCancel'},location.origin)}catch(_){}
</script></body></html>"""


class handler(BaseHTTPRequestHandler):
    def _send(self, status, html):
        data = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _query(self):
        return urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

    def do_GET(self):
        if self._query().get("cancel") == ["1"]:
            return self._send(200, CANCEL_HTML)
        self.send_response(302)
        self.send_header("Location", "/indexadmin.html")
        self.end_headers()

    def do_POST(self):
        query = self._query()
        if query.get("cancel") == ["1"]:
            return self._send(200, CANCEL_HTML)
        run = query.get("run", [""])[0]
        if not RUN_ID.fullmatch(run):
            return self._send(400, "잘못된 검사 연결 번호입니다.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self._send(413, "결과 데이터 크기를 확인해 주세요.")
            body = self.rfile.read(length).decode("utf-8")
            form_value = urllib.parse.parse_qs(body).get("resSrvyJson", [""])[0]
            raw = form_value or body
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError("not an object")
        except (UnicodeError, ValueError, json.JSONDecodeError):
            return self._send(400, "검사 결과 형식을 확인해 주세요.")
        safe_run = json.dumps(run)
        safe_raw = (json.dumps(raw, ensure_ascii=False)
                    .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
                    .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))
        self._send(200, RESULT_HTML.replace("__RUN__", safe_run).replace("__RAW__", safe_raw))
