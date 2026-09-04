# -*- coding: utf-8 -*-
"""Vercel Serverless Function: POST /rcvrslt — MindGaze 검사 결과 수신.

측정 엔진이 이 주소로 결과(resSrvyJson)를 POST하면, localStorage 에 저장하고 메인 창(opener)으로
postMessage 한 뒤 결과 리포트(report.html)로 이동하는 HTML을 돌려줍니다.
(엔진 common.js 의 jsOnSubmit 은 target="_top" 이라 결과 POST 는 측정 팝업의 최상위 문서로 돌아옵니다.)
?cancel=1 (엔진의 crtrn) 로 오면 취소 신호만 보내는 HTML을 돌려줍니다.
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
</head><body><div><h2>✅ 측정이 완료되었습니다.</h2><p>결과 화면으로 이동 중입니다…</p></div>
<script>
  var raw = __RESULT__;
  // 1) 같은 도메인 localStorage 에 저장 → 메인 페이지(index.html)가 storage 이벤트/폴링으로 감지 (주 전달 경로)
  try {
    localStorage.setItem('nlEngineResult', JSON.stringify({ seq: Date.now(), data: raw }));
  } catch (e) { console.error(e); }
  // 2) 측정 창(test.html)의 iframe 안이면 부모에게, 팝업 최상위면 메인 창(opener)에게 직접 전달
  //    — 같은 오리진에만 전달한다 (임의 사이트가 이 페이지를 임베드해도 결과가 새지 않게)
  var framed = false, relayed = false;
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'nlEngineResult', data: raw }, location.origin);
      framed = true;
    }
  } catch (e) { console.error(e); }
  try {
    if (!framed && window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'nlEngineResult', data: raw }, location.origin);
      relayed = true;
    }
  } catch (e) { console.error(e); }
  // 3) 메인 창이 결과 처리에 실패하면 알려 준다 → 이 창에 오류 안내
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'nlTestError') return;
    document.body.innerHTML = '<div><h2>⚠️ 결과를 처리하지 못했습니다</h2><p>' + String(e.data.msg || '').replace(/[<>&]/g, '') + '</p>'
      + '<p><button onclick="window.close()" style="font-size:14px;padding:10px 22px;border-radius:10px;border:0;background:#1E5AF0;color:#fff;cursor:pointer">창 닫기</button></p></div>';
  });
  // 4) 팝업 최상위인 경우: 메인 창이 저장(계정 연동)을 마치고 이 창을 리포트로 보낸다.
  //    메인 창이 없거나 늦으면 이 창이 직접 리포트로 이동한다. (iframe 안이면 test.html 이 처리)
  if (!framed) {
    setTimeout(function () {
      try {
        var j = JSON.parse(localStorage.getItem('nlLastResult') || 'null');
        if (j && j.ts && Date.now() - j.ts < 120000) {
          location.replace(j.savedId ? 'report.html?id=' + encodeURIComponent(j.savedId) : 'report.html');
          return;
        }
      } catch (e) {}
      var result = null;
      try { result = JSON.parse(raw); } catch (e) {}
      if (result && (result.BIG5 || result.MBTI || result['직무적합도'] || result['직업흥미유형'])) {
        try { localStorage.setItem('nlLastResult', JSON.stringify({ ts: Date.now(), savedId: null, result: result })); } catch (e) {}
        location.replace('report.html');
      } else if (!relayed) {
        try { window.close(); } catch (e) {}
      }
    }, relayed ? 12000 : 400);
  }
</script></body></html>"""


# 측정 엔진 화면의 「검사 종료」(crtrn) → 측정 창(test.html)에 취소를 알린다.
CANCEL_HTML = """<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>측정 종료</title>
<style>body{font-family:'Malgun Gothic',sans-serif;background:#0f172a;color:#e2e8f0;
display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}</style>
</head><body><div><h2>측정을 종료했습니다.</h2><p>이 창은 곧 닫힙니다…</p></div>
<script>
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'nlEngineCancel' }, location.origin);
    }
  } catch (e) {}
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'nlTestCancel' }, location.origin);
    }
  } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 800);
</script></body></html>"""


class handler(BaseHTTPRequestHandler):

    def _is_cancel(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return qs.get("cancel", [""])[0] == "1"

    def _html(self, html):
        out = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        if self._is_cancel():
            self._html(CANCEL_HTML)
            return
        # 결과는 POST 로만 들어온다 — 주소를 직접 열면 메인으로 보낸다
        self.send_response(302)
        self.send_header("Location", "/")
        self.end_headers()

    def do_POST(self):
        if self._is_cancel():
            self._html(CANCEL_HTML)
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        params = urllib.parse.parse_qs(body)
        res_json = params.get("resSrvyJson", [""])[0]
        if not res_json:  # raw JSON body로 오는 경우 대비
            res_json = body
        # json.dumps 는 '<' 를 이스케이프하지 않아 "</script>" 가 섞인 본문이 스크립트를 탈출할 수 있다.
        # <, >, & 를 \u 이스케이프로 바꿔 <script> 안에서 항상 문자열로만 해석되게 한다 (반사형 XSS 차단).
        safe = (json.dumps(res_json)
                .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
                .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))
        self._html(RESULT_HTML.replace("__RESULT__", safe))
