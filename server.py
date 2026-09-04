# -*- coding: utf-8 -*-
"""
MindGaze 시선추적 웹앱 로컬 서버
- 정적 파일 서빙 (index.html)
- GET  /mg/chkmbr?mbrId=...  → https://api.mindgaze.ai/api/chkmbr 프록시 (회원확인)
- POST /rcvrslt              → MindGaze 검사 결과(resSrvyJson) 수신 후
                               부모 창(index.html)으로 postMessage 전달

실행:  python server.py   →  http://localhost:8080
"""
import json
import os
import ssl
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# api.mindgaze.ai 인증서가 도메인과 불일치(Hostname mismatch)하여 검증을 생략.
# (로컬 개발용 프록시에서 이 호스트에만 사용)
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

PORT = 8080

# Gemini AI 총평 생성용
# 키는 환경변수 GEMINI_API_KEY 또는 gitignore 처리된 gemini.key 파일에서 읽음 (GitHub 노출 방지)
def _load_gemini_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gemini.key"),
                  encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""

GEMINI_API_KEY = _load_gemini_key()
GEMINI_MODEL = "gemini-2.5-flash"

# 순서대로 시도 (앞이 실패하면 다음 주소로 폴백)
MINDGAZE_API_BASES = [
    "https://mindgaze.ai/api",            # 실서비스 도메인 (동작 확인됨)
    "https://api.mindgaze.ai/api",        # 문서상 주소 (현재 503)
    "http://211.218.126.208:38080/api",   # 관리 시스템 서버
]

os.chdir(os.path.dirname(os.path.abspath(__file__)))

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


# 측정 엔진 화면의 「검사 종료」(crtrn) → 측정 창(test.html)에 취소를 알린다 (api/rcvrslt.py 와 동일)
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

# 마지막으로 수신한 검사 결과 (메인 화면이 폴링으로 가져감)
LAST_RESULT = {"data": None, "seq": 0}


class Handler(SimpleHTTPRequestHandler):

    # ---------- 결과 수신 (rtrn) ----------
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/rcvrslt" and urllib.parse.parse_qs(parsed.query).get("cancel", [""])[0] == "1":
            self._send(200, "text/html; charset=utf-8", CANCEL_HTML.encode("utf-8"))
        elif parsed.path == "/rcvrslt":
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length).decode("utf-8", "replace")
            params = urllib.parse.parse_qs(body)
            res_json = params.get("resSrvyJson", [""])[0]
            if not res_json:  # 혹시 raw JSON body로 오는 경우 대비
                res_json = body
            print("\n[결과 수신] resSrvyJson:\n", res_json[:2000], "\n")
            LAST_RESULT["data"] = res_json
            LAST_RESULT["seq"] += 1
            html = RESULT_HTML.replace("__RESULT__", json.dumps(res_json))
            self._send(200, "text/html; charset=utf-8", html.encode("utf-8"))
        elif parsed.path == "/gemini":
            self._gemini()
        else:
            self._send(404, "application/json", b'{"error":"not found"}')

    # ---------- Gemini AI 총평 프록시 ----------
    def _gemini(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
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
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY,
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.loads(res.read().decode("utf-8"))
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts)
            out = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
            self._send(200, "application/json; charset=utf-8", out)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                pass
            print(f"[Gemini 오류] HTTP {e.code}: {detail}")
            err = json.dumps({"error": f"HTTP {e.code}", "detail": detail}).encode("utf-8")
            self._send(502, "application/json; charset=utf-8", err)
        except Exception as e:
            print(f"[Gemini 오류] {e}")
            err = json.dumps({"error": str(e)}).encode("utf-8")
            self._send(502, "application/json; charset=utf-8", err)

    # ---------- MindGaze API 프록시 (브라우저 CORS 회피) ----------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/rcvrslt":
            if urllib.parse.parse_qs(parsed.query).get("cancel", [""])[0] == "1":
                self._send(200, "text/html; charset=utf-8", CANCEL_HTML.encode("utf-8"))
            else:
                self.send_response(302); self.send_header("Location", "/"); self.end_headers()
        elif parsed.path == "/last-result":
            # 메인 화면 폴링용: 마지막 수신 결과 반환
            body = json.dumps(
                {"seq": LAST_RESULT["seq"], "data": LAST_RESULT["data"]},
                ensure_ascii=False,
            ).encode("utf-8")
            self._send(200, "application/json; charset=utf-8", body)
        elif parsed.path.startswith("/engine/") or parsed.path.startswith("/mg/"):
            # /engine/ 이 표준 경로, /mg/ 는 구버전 호환 별칭 (vercel.json 과 동일)
            prefix = "/engine/" if parsed.path.startswith("/engine/") else "/mg/"
            endpoint = parsed.path[len(prefix):]          # 예: chkmbr, getsrvyrslt
            form = dict(urllib.parse.parse_qsl(parsed.query))
            self._proxy(endpoint, form)
        else:
            super().do_GET()

    def _proxy(self, endpoint, form):
        data = urllib.parse.urlencode(form).encode("utf-8")
        errors = []
        for base in MINDGAZE_API_BASES:
            url = f"{base}/{endpoint}"
            origin = base.rsplit("/api", 1)[0]
            req = urllib.request.Request(
                url, data=data,
                headers={
                    # 일부 서버/WAF가 비브라우저 요청을 차단하므로 브라우저와 유사한 헤더 사용
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
                print(f"[프록시] POST {url} {form} -> {body[:300]!r}")
                self._send(200, "application/json; charset=utf-8", body)
                return
            except urllib.error.HTTPError as e:
                err_body = b""
                try:
                    err_body = e.read()
                except Exception:
                    pass
                msg = f"{url} -> HTTP {e.code} {e.reason}"
                print(f"[프록시 HTTP오류] {msg}\n{err_body[:500]!r}")
                errors.append(msg)
            except Exception as e:
                msg = f"{url} -> {e}"
                print(f"[프록시 오류] {msg}")
                errors.append(msg)

        err = json.dumps({"resCd": "9999", "resMsg": " / ".join(errors)}).encode("utf-8")
        self._send(502, "application/json; charset=utf-8", err)

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"MindGaze 로컬 서버 시작 → http://localhost:{PORT}")
    print("종료: Ctrl+C")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
