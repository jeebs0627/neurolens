# NeuroLens NewBiz — 연구 데이터 수집 체계

알고리즘 고도화, 규준(참고 범위) 수립, 딥러닝 학습 재료로 쓸 측정 데이터를 모으는 구조입니다.
**참가자가 첫 화면에서 ‘연구 데이터 제공’에 따로 동의한 실측 세션만** 올라갑니다. 데모·시뮬레이션 세션은 올라가지 않습니다.

## 1. 흐름

```
리포트 완성 → newbiz-research.js pack()  →  JSON → gzip → base64 → 450KB 조각
           → RPC newbiz_research_begin(consent, meta, summary)  → {session_id, code(NLR-XXXXXX), upload_token}
           → RPC newbiz_research_chunk(session, token, idx, data)  × N
           → RPC newbiz_research_finish(session, token, N, bytes, sha256)  → status = complete
철회      → RPC newbiz_research_withdraw(session, token)  (토큰은 참가자 기기에만 있음) 또는 참가 코드로 문의 → 연구자가 삭제
```

- DB: Supabase `qonoakggniupuxwvzmmw` · 마이그레이션 `supabase/migrations/20261003_newbiz_research.sql`
- 보안: 두 테이블 RLS 활성 + 정책 없음 → publishable 키로 조회·직접 삽입 불가. 쓰기는 RPC 로만, 세션 토큰(sha256 해시만 저장)이 있어야 조각 추가·완료·철회 가능. 조각 600KB·64개, 메타 32KB, 요약 256KB, 하루 5,000세션 상한. 조각 업로드는 시작 후 2시간 안에만 가능하고, 하루가 지나도 완료되지 않은 세션은 매일 정리(pg_cron).
- 읽기: service_role 키(연구자)만. `tools/newbiz_research_export.py` 로 내려받는다.

## 2. 무엇이 저장되나

| 구분 | 내용 | 비고 |
|---|---|---|
| consent | 동의 버전·연구 동의·PHQ 포함 여부·시각 | PHQ 는 별도 체크 시에만 summary 에 포함 |
| meta | 스키마·알고리즘 버전(core·battery·QC), 측정 모드·단계 상태, 화면 크기·DPR, 카메라 해상도, 평균 fps, 브라우저/OS 계열·주 버전, 시간대·현지 시각, 자극 세트 | UA 전체 문자열은 저장하지 않음 |
| summary | 체크인(지금 상태 4문항 + 수면·카페인), 통합 해석 키, 영역 점수·신뢰도, 지표 19개(값·점수·판정·신뢰도·경계·제외), QC 전체, 시선 보정 결과, 심박 요약(기준·압박·회복·호흡) | 표 분석·지도학습 라벨 |
| payload.frames | 프레임별(약 30Hz): 촬영 시각, 얼굴 인식 여부, 피부 평균색 r·g·b, 영역별(이마·양 볼) r·g·b, 피부 밝기, 얼굴 중심·폭, 눈 열림, 깜빡임·찌푸림·미소 점수, 시선 특징(홍채 u·v, 머리 yaw·pitch), 처리 지연 | 정수 양자화 — 배율은 `FRAME_COLS`(newbiz-research.js)·내보내기 스크립트에 동일 |
| payload.landmarks | 시선 보정·시선 과제 동안 눈·홍채 47점의 영상 좌표(×10000) | 이미지 아님. 홍채 10 · 눈꺼풀 윤곽 32 · 머리 자세 5 |
| payload.calibration | 표적 시각·좌표(9점·검증·영점), 추적 보정 경로 식, 선택 모델, 영점 보정, 커서 과제 결과(학습된 치우침) | 시선 모델 재학습용 정답 표적 |
| payload.freeview / saccade / pursuit | 시행별 자극 정보 + 시선 표본 [t, x, y, 원시 x, 원시 y, 깜빡임] | 화면 px |
| payload.pvt / sart / stress | 시행별 반응시간, SART 숫자, MIST 문제별 [시각, 난이도, 제한, 반응시간, 정답, 응답, 정오] | |
| payload.phases / hidden | 단계 시작·끝, 화면 이탈 구간 | |

크기: 표준 측정 한 세션 원본 약 3~6MB → gzip 약 0.7~2MB (조각 2~6개).

## 3. 저장하지 않는 것
카메라 영상·사진·얼굴 이미지, 이름·연락처·계정·IP(애플리케이션에서 수집하지 않음; 플랫폼 접근 로그는 Supabase 정책을 따름).

### CONDITION 웹캠 복원 경로 (2026-10-04)

- `condition-camera.js`는 영상 프레임 수집과 추론을 분리합니다. RGB는 폭 320px, 얼굴·눈 추론은 최대 640px이며 worker에는 영상 프레임 하나만 보냅니다. worker 오류 시 메인 스레드 추론으로 전환합니다. 카메라 FPS가 낮다는 이유만으로 검사 시작을 막지 않습니다.
- `faceOk`, `eyeOk`, `gazeOk`, `skinOk`, `ppgOk`를 분리합니다. 기존 `ok`는 피부 신호 호환 필드입니다. 눈 지표를 피부 신호 성공 여부로 제외하지 않습니다. 저장된 `source`, `roiAge`, `exposureGain`, `reason`과 `meta.capture`로 획득 경로를 확인할 수 있습니다.
- 밝기 보정은 얼굴 인식 입력에만 최대 2.5배 적용합니다. 맥파는 보정 전 RGB를 사용합니다. 피부 후보의 색 비율·중앙값 편차를 사용하고, 관측되지 않은 피부 영역은 `null`로 유지합니다. 얼굴 좌표 재사용 상한은 180ms입니다.
- 시선 보정은 양쪽 눈 회귀 모델을 따로 학습하고, 눈별 검증 오차와 영상 품질·눈 열림에 따라 융합합니다. 한쪽 눈만 남으면 해당 눈의 보정·검증 결과를 사용합니다. 머리 회전은 눈 기준 좌표와 회귀의 yaw/pitch 항으로 보정합니다. 표적 위치로 측정 시선을 끌어당기지 않습니다.
- rPPG의 짧은 손실은 최대 200ms까지만 보간합니다. 10초 분석창에서 손실 복원 비율이 25%를 넘으면 해당 채널 창을 제외합니다. 더 긴 손실은 파형을 끊어 별도로 필터링하며, 복원 주변 박동을 HRV에 넣지 않습니다. 정상 프레임 간격의 30Hz 재표본화와 누락 복원을 구별합니다.
- 시선은 낮은 품질의 단발성 튐만 양옆 관측값으로 보정합니다. 체류·추적의 안정된 두 관측값 사이에서 최대 120ms 손실만 복원하고 표시합니다. 깜빡임과 사카드 잠복기를 보간하지 않습니다. 원시 기록은 유지하며 분석 시 복원 결과를 계산합니다.
- 스키마 `nl-research-2`: `payload.frames.scale`에 배율을 저장합니다. `rr`는 항상 9개 위치이며 손실 성분은 `null`, `rq`는 영역별 품질 가중치입니다. 시선 표본의 기존 6개 열 뒤에 품질(×1000), 눈 모드, 추론 지연(ms)을 추가하고 `sampleColumns`로 명시합니다. 원형 추적과 눈별 모델 계수·검증 결과도 보존합니다. NPZ 내보내기는 v1/v2 모두 지원합니다.

임계값과 품질 가중치는 공학적 초기값이며 정확도 확률이 아닙니다. 성공률 향상 수치는 실사용자와 기준 센서의 동시 측정으로 검증해야 합니다. 아래 자동 검증은 합성 신호와 브라우저 구현 검증입니다.

```bash
node condition-signal.test.cjs
node condition-camera.test.cjs --real
node newbiz-core.test.js
node newbiz-battery.test.js
python tools/newbiz_research_export_test.py
```

브라우저 검증은 Playwright와 Edge를 사용합니다(`CONDITION_EDGE`로 실행 경로 지정). `--real`은 고정 버전 MediaPipe 모델의 worker 실행을 기존 자극 이미지로 확인하므로 모델 다운로드 연결이 필요합니다. 연구 서버에 데이터를 업로드하지 않습니다.

## 4. 내려받기

```bash
set SUPABASE_URL=https://qonoakggniupuxwvzmmw.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=<service_role — 커밋·배포 금지>
python tools/newbiz_research_export.py --out research_export --npz
```
`sessions.csv`(세션당 1행), `sessions/<code>.json`(전체), `frames/<code>.npz`(프레임·랜드마크 실수 배열). 조각 sha256 을 검증하고 불일치 세션은 건너뜁니다.

## 5. 활용 예
- **규준 수립**: 지표별 분포(백분위) → `INDICATORS` 기준점 재설정, 기기·브라우저·연령대 층화
- **재검사 신뢰도**: 같은 기기에서 반복된 세션(참가 코드 목록이 기기에 남음)으로 지표별 ICC
- **시선 모델**: `landmarks` + `calibration.targets` 로 릿지 회귀를 넘는 개인화·딥러닝 시선 추정 학습
- **rPPG**: 영역별 색 시계열로 융합 알고리즘 개선, 가슴 스트랩 동시 측정 세션을 정답으로 지도학습
- **자동 품질 판정**: 지표 신뢰도 r 과 원자료로 ‘측정 실패’ 분류기

## 6. 운영 체크리스트
- [ ] 마이그레이션 적용 (Supabase SQL Editor 또는 커넥터)
- [ ] 연구 계획·개인정보 처리 고지 검토 (IRB/기관 정책에 따라 — 민감정보인 PHQ 포함 여부 결정)
- [ ] 보관 5년 후 파기 절차 (예: `delete from newbiz_research_sessions where created_at < now() - interval '5 years'`)
- [ ] 철회 문의 창구(참가 코드로 삭제) 안내
