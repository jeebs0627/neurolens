# -*- coding: utf-8 -*-
"""Server-side emotional wellness interpretation for the admin-only preview."""
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

MODEL = "gemini-3.6-flash"
MAX_BODY = 8 * 1024
MOODS = {"calm": "평온", "anxious": "불안", "low": "가라앉음", "flat": "무기력", "irritable": "짜증", "excited": "설렘", "tense": "긴장"}
ISSUES = {"relationship": "관계", "career": "진로·학업", "task": "학업·과업", "growth": "자기계발", "health": "건강", "finance": "재정", "change": "변화 적응", "none": "아직 모르겠음"}
ANSWERS = {"yes": "있음", "no": "없음", "unsure": "모름"}
TITLES = {
    1: "휴식·측정환경 확인", 2: "작은 실행부터 시작", 3: "진로 탐색의 초점 좁히기",
    4: "관계 속 감정 돌보기", 5: "관계 에너지 방식 확인", 6: "성장 에너지 활용",
    7: "변화에 천천히 적응", 8: "정서적 지원을 우선 살피기", 9: "오늘의 기분을 가볍게 돌보기",
    10: "원인 탐색부터 시작", 11: "기대와 에너지의 속도 맞추기", 12: "무관심 신호를 함께 살피기",
    13: "전환기 마음 정리", 14: "관계 속 내 몫도 챙기기", 15: "과업 기준을 부드럽게 조정",
    16: "새 도전의 긍정 자원", 17: "가벼운 변화로 활력 찾기", 18: "복합 감정의 속도 조절",
}


def _score(value):
    try:
        number = float(value)
        return round(number, 1) if 0 <= number <= 100 else None
    except (TypeError, ValueError):
        return None


def build_prompt(body):
    checkin = body.get("checkin")
    signals = body.get("signals")
    if not isinstance(checkin, dict) or not isinstance(signals, dict):
        raise ValueError("체크인과 검사 결과가 필요합니다.")
    moods = checkin.get("moods")
    if not isinstance(moods, list) or not 1 <= len(moods) <= 7 or any(mood not in MOODS for mood in moods):
        raise ValueError("기분 응답을 확인해 주세요.")
    issue = checkin.get("issue")
    expectation = checkin.get("expectation")
    worry = checkin.get("worry")
    energy = checkin.get("energy")
    if issue not in ISSUES or expectation not in ANSWERS or worry not in ANSWERS or type(energy) is not int or not 1 <= energy <= 5:
        raise ValueError("체크인 응답을 확인해 주세요.")
    big5 = signals.get("big5") if isinstance(signals.get("big5"), dict) else {}
    riasec = signals.get("riasec") if isinstance(signals.get("riasec"), dict) else {}
    gaze = signals.get("gaze") if isinstance(signals.get("gaze"), dict) else {}
    screening = signals.get("screening") if signals.get("screening") in ("low", "borderline", "high") else None
    gaze_clean = {key: gaze.get(key) for key in ("quality", "focus", "exploration") if gaze.get(key) in ("low", "mid", "high")}
    matched = body.get("matchedIds") if isinstance(body.get("matchedIds"), list) else []
    matched = list(dict.fromkeys(value for value in matched if type(value) is int and value in TITLES))[:18]
    # The model receives only whitelisted facts and titles, never arbitrary client-authored prose.
    facts = {
        "사전 체크인": {"기분": [MOODS[mood] for mood in moods], "고민": ISSUES[issue], "컨디션_1_5": energy,
                   "기대": ANSWERS[expectation], "걱정": ANSWERS[worry]},
        "검사 결과": {
            "BIG5_백분위": {key: value for key in ("O", "C", "E", "A", "N") if (value := _score(big5.get(key))) is not None},
            "RIASEC_점수": {key: value for key in "RIASEC" if (value := _score(riasec.get(key))) is not None},
            "시선_명시값": gaze_clean,
            "정서_선별_명시구간": screening or "제공되지 않음",
        },
        "규칙상_일치한_조합": [{"번호": value, "제목": TITLES[value]} for value in matched],
    }
    system = """너는 따뜻하고 정확한 감정 웰니스 컨설턴트다. 사전 체크인의 주관적 감정과 실제 제공된 검사 결과를 구분해서 읽고, 둘이 만나는 지점에서 실천 가능한 다음 한 걸음을 제안한다. 병원의 의사처럼 진단하거나 치료하지 않는다.
반드시 지킬 규칙:
- 현재 감정은 체크인 응답으로만 설명한다. MBTI·BIG5·RIASEC 점수만으로 현재 감정, 우울, 번아웃, 질환, 원인, 능력을 확정하지 않는다.
- 시선 집중·탐색·추적품질이 제공되지 않았다면 절대 언급하지 않는다. 추적품질 저하는 피로의 증거가 아니라 측정 환경 확인의 이유다.
- 선별 구간이 없거나 수치만 있다면 위험도를 추론하지 않는다. AUC는 개인의 점수나 경계값이 아니다.
- 조합 번호는 검토용 휴리스틱이다. 맞지 않은 조합이나 제공되지 않은 정보는 만들지 않는다. 인과관계를 주장하지 않는다.
- 선별 구간이 경계·높음이면 상담·전문기관 평가의 선택지를 셀프케어보다 먼저 제안한다. 그 구간도 진단은 아니다.
- 부드럽고 존중하는 문체로 쓴다. 끝에는 “~해볼까요?”, “오늘부터 천천히 실천해 보아요”처럼 부담 없는 제안을 둔다. 위로만 하거나 상투적인 칭찬을 반복하지 않는다.
- 한국어 JSON 객체만 반환한다. 키는 summary, direction, firstStep 세 개. summary는 2~3문단, 300~450자. direction은 가장 적절한 케어 방향 1~2문장. firstStep은 오늘 2~5분 안에 할 수 있는 구체적인 제안 1문장."""
    return system, "다음 구조화된 정보만 사용해 오늘의 감정 상태 총평을 작성하세요.\n" + json.dumps(facts, ensure_ascii=False)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").split(":")[0].lower()
        source = self.headers.get("Origin") or self.headers.get("Referer") or ""
        if not host or (urlparse(source).hostname or "").lower() != host:
            return self._send(403, {"error": "forbidden"})
        key = os.environ.get("carebot", "").strip()
        if not key:
            return self._send(503, {"error": "carebot environment variable is missing"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self._send(413, {"error": "invalid request length"})
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("invalid body")
            system, prompt = build_prompt(body)
        except (ValueError, UnicodeError) as error:
            return self._send(400, {"error": str(error)[:120]})
        payload = json.dumps({
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.55, "maxOutputTokens": 1600, "responseMimeType": "application/json"},
        }).encode("utf-8")
        request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            data=payload, headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=50) as response:
                data = json.load(response)
            output = "".join(part.get("text", "") for part in data["candidates"][0]["content"]["parts"])
            item = json.loads(output)
            if not isinstance(item, dict) or any(not isinstance(item.get(k), str) or not item[k].strip() for k in ("summary", "direction", "firstStep")):
                raise ValueError("invalid model response")
            return self._send(200, {k: item[k].strip()[:2500] for k in ("summary", "direction", "firstStep")})
        except urllib.error.HTTPError as error:
            print("care preview upstream HTTP", error.code)
            return self._send(502, {"error": "generation unavailable", "upstreamStatus": error.code})
        except Exception as error:  # noqa: BLE001
            print("care preview upstream error", type(error).__name__)
        return self._send(502, {"error": "generation unavailable"})

    def _send(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
