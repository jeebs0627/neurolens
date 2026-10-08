# CONDITION 알고리즘 연구 기록

`dataset.html`은 연구 동의 세션의 **관측 근거 → 자동 검토 후보 → 연구자 조치 → 후속 검증**을 연결합니다. 일반 참가자가 다른 참가자의 데이터에 접근할 수 없습니다. `admin.html`에서 연결되며 `/dataset`도 같은 페이지로 열립니다.

## 운영 DB에 한 번 적용할 내용

1. 기존 `supabase/migrations/20261003_newbiz_research.sql` 적용 여부를 확인합니다.
2. `supabase/migrations/20261004_condition_dataset.sql`을 프로젝트 SQL Editor에서 실행합니다.
3. 연구 책임자 계정의 **auth.users UUID를 확인**한 다음 해당 계정만 등록합니다.

```sql
insert into public.dataset_reviewers(user_id)
values ('연구관리자-auth-UUID') on conflict do nothing;
```

`profiles.role`은 이 페이지의 읽기 권한 근거로 사용하지 않습니다. `dataset_reviewers`에는 브라우저가 직접 읽거나 쓸 권한이 없습니다. 등록된 계정의 로그인 JWT로만 서버의 조회·기록 RPC가 동작합니다. service_role 키를 웹페이지에 입력할 필요가 없습니다. 이 마이그레이션은 **로컬의 독립 PostgreSQL/WASM 인스턴스에서 검증**했으며 운영 DB 적용을 자동으로 의미하지 않습니다.

추가 SQL이 아직 없으면 기존 연구 저장 RPC로 자동 전환해 기존 수집을 유지합니다. 이 기록도 `summary.dataset`을 포함하므로 추가 SQL 적용 후 관리자 페이지에서 조회할 수 있습니다. 기존 저장 RPC까지 없거나 전송이 실패하면 완료 배너에 성공을 표시하지 않습니다. 동의한 자료는 이 기기의 IndexedDB 대기열에 보관하고, `dataset.html#local`에서 상태 확인·내보내기·재시도·삭제할 수 있습니다. **중앙 조회·조치 기록은 추가 SQL 적용 후에 활성화**됩니다.

## 검사 메모 → AI 개선 프롬프트 → 조치 이력

### 개발 워크스페이스와 GitHub 자동 축적

페이지는 **개발 과제 / 실측 검토 / 변경·배포 이력 / 검증·축적 지표**로 구성됩니다. 로그인하면 불러온 연구 세션의 메모·조치 이력을 자동으로 조회합니다. 실측 자동 후보와 코드 변경 후속 과제에서 **실측에 연결·AI 프롬프트**를 누르면 기존 검사에 연결 메모를 만들고 Gemini가 측정 근거를 포함한 프롬프트를 생성합니다. 같은 과제를 같은 검사에 다시 연결해도 메모는 중복 생성하지 않습니다. 실패 시 메모는 남고 기존 생성 버튼으로 재시도할 수 있습니다.

`.github/workflows/dataset-evolution.yml`은 main push, GitHub deployment_status 이벤트, 30분 주기(매시 17·47분), 수동 실행에 반응합니다. GitHub 스케줄은 지연될 수 있습니다. `tools/dataset_evolution_sync.py`가 main의 전체 커밋을 SHA별로 수집하고 `dataset-evolution-log.json`을 GitHub에 누적합니다. 이 로그만 바뀐 커밋은 후속 코드 과제로 재등록하지 않습니다. 기록에 실제 변화가 없으면 새 기록 커밋을 만들지 않습니다.

- 코드와 배포는 별도 근거입니다. 변경 파일·증감·일부 diff, 커밋 부모, 공개 코드 출처를 보존합니다. Vercel commit status 성공은 **체크 성공**, `production_environment=true`인 실제 deployment 상태는 **운영 배포**로 구분합니다. 후속 과제에 커밋이 연결되거나 배포가 성공해도 측정 검증 완료로 바꾸지 않습니다.
- 배포 조회 범위는 최신 12개 코드 커밋과 수신한 deployment_status 이벤트입니다. 과거 전 기간 배포를 모두 확인했다고 주장하지 않습니다. 상세 diff는 24,000자 발췌이며 생략 여부를 기록합니다. API에서 파일 목록이 페이지를 넘으면 생략 표시를 남깁니다.
- 관련 코드 변경에는 즉시 규칙 기반 기본 검증 과제가 생깁니다. 한 실행에서 최신 미분석 커밋 최대 3개를 Gemini로 분석해 구체적인 요약·후속 과제·프롬프트로 보완합니다. 초기 이력은 순차 보완하므로 기본 프롬프트와 Gemini 작성본이 명확히 구분됩니다.
- 실패한 Gemini 분석은 원래 과제를 유지하고 다음 실행에서 재시도합니다. 실패 간격은 최소 1시간, 커밋별 자동 시도는 5번까지입니다. GitHub Actions의 **Run workflow → retry_failed**로 대기·실패 항목을 다시 시도할 수 있습니다. 각 호출 내부의 일시 오류 재시도는 앞서 정의한 제한을 따릅니다.
- 공급자가 429를 반환하면 해당 실행의 추가 AI 호출을 멈추고 전체 자동 분석을 1시간 대기합니다. 503은 5분 대기합니다. 코드·배포 수집은 계속됩니다. 생성 대기 시각을 화면에 표시하며 수동 retry_failed만 이 대기를 건너뜁니다.
- 기록 전용 커밋이 불필요한 Vercel 배포를 반복하지 않도록 `dataset-deploy-guard.cjs`를 적용합니다. 직전 **성공 배포 SHA** 이후 변경이 로그 JSON뿐일 때만 빌드를 건너뜁니다. 아직 배포되지 않은 코드, 확인할 수 없는 이력, 동일 커밋 수동 재배포는 빌드를 진행합니다.
- 각 과제 ID는 `evo-<원인 커밋 앞 12자>-<영역>`입니다. 생성 프롬프트는 개발 AI에게 후속 커밋 본문에 `Dataset-Task: <ID>`를 기록하도록 지시합니다. 다음 수집에서 이 표식을 연결하되 독립 검증으로 간주하지 않습니다. 실측 메모와 직접 연결한 SHA·과제 ID는 Supabase의 기존 append-only 조치 기록에 저장합니다.
- 공개 로그는 코드에서 나온 근거만 포함합니다. 실측값·참가 코드·개인 메모는 GitHub Actions/API에 보내지 않습니다. 원시 자료와 연구 검토 기록은 기존 Supabase 권한·철회 규칙을 그대로 따릅니다. 기존 수동 개발 기록은 별도 보존합니다.

자동 분석 API는 `POST /api/dataset_evolution`입니다. 호출에는 GitHub Actions OIDC 서명이 필요하며 issuer·audience·repository ID·main 브랜치·고정 workflow 경로를 검사합니다. 입력은 커밋 SHA 한 개뿐이고 서버가 고정된 저장소의 공개 변경을 다시 조회합니다. GitHub에 Gemini 키를 새로 등록할 필요가 없습니다. Vercel **neurolens_after** 키(2026-10-05 교체)로 **gemini-3.6-flash**를 사용합니다. GitHub 기본 `GITHUB_TOKEN`은 로그 파일 갱신에 사용됩니다. 추가 SQL은 없습니다.

페이지는 배포본 로그를 먼저 표시한 뒤 공개 GitHub 최신 로그를 조회하므로 기록 전용 커밋의 Vercel 배포가 지연되어도 누적 기록을 읽을 수 있습니다. 열린 페이지는 2분마다 갱신하며 **GitHub 기록 새로고침**은 이미 수집된 기록을 조회합니다. Actions 실행 자체를 브라우저에서 임의로 시작하지 않습니다.

자동화 검증: `py -3 tools/dataset_evolution_test.py` (requirements.txt 의존성 필요), `node dataset-workflow.browser.test.cjs`, 기존 dataset 회귀 검사. OIDC 서명·만료·저장소 경계, 중복 이벤트, 자기 기록 루프 방지, AI 장애 시 기본 과제 보존, 대형 로그 조회, 실측-과제 연결과 모바일 레이아웃을 검증합니다.

자동화 근거: [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc), [GITHUB_TOKEN 이벤트 동작](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [Vercel Python 의존성](https://vercel.com/docs/functions/runtimes/python).

### 검사별 기록 사용법

`dataset.html`에서 검사를 선택하면 **내 메모와 알고리즘 개선** 영역이 표시됩니다.

1. 메모 제목, 대상 검사, 관찰한 문제, 보정 지표·기대 결과, 재검증 계획을 저장합니다.
2. **AI 개선 프롬프트 만들기**를 누릅니다. 저장된 측정 요약과 메모를 Gemini가 하나의 개발 지시문으로 구성하고 서버에 저장합니다. 프롬프트 복사 또는 텍스트 파일로 개발 AI에 전달합니다.
3. 개발 AI가 작업한 뒤 **개발 결과 등록 · AI 요약**에서 결과 원문, 실제 커밋·실험 근거, 엔진 전후 버전, 관측 지표, 후속 과제를 입력합니다. 원문을 먼저 저장하고 Gemini 조치 요약을 해당 메모에 연결합니다.
4. AI 호출이 실패해도 메모·개발 결과 원문은 유지됩니다. **조치 요약 생성·재시도**로 저장된 결과를 다시 처리할 수 있습니다.
5. **후속 검증·진행 상태 기록**에서 연구자가 적용/검증 범위와 근거를 추가합니다. AI 생성은 항상 검토 대기이며 직접 코드 실행·배포·검증하지 않습니다. 적용·검증 상태에는 근거 입력이 필수입니다. 합성 검증은 사람 대상 정확도 검증과 구분해서 기록합니다.
6. **불러온 검사 이력 집계**로 현재 불러온 세션 범위의 메모, 프롬프트, 개발 결과, 전후 지표 기재, 연구자 검증 기록과 후속 과제를 확인합니다. 기록·검토 이력 JSON 내보내기에도 모두 포함됩니다.

기존 `dataset_annotations`의 `kind=action`과 `body.workflow=dataset-improvement-1`을 사용하므로 **추가 SQL은 필요 없습니다**. `event`는 `memo`, `prompt`, `result`, `summary`, `review`입니다. 원본 메모 ID, 사용한 프롬프트 ID, 개발 결과 ID를 연결하며 이전 기록을 덮어쓰지 않습니다. 새 개발 결과를 등록하면 그 결과의 검토 상태는 다시 대기 상태입니다. 원자료 철회 시 기존 FK cascade로 연결 이력도 삭제됩니다. 다른 기기에서 동시 생성하면 이력이 중복될 수 있지만, 같은 입력의 순차 재시도는 저장된 AI 응답을 재사용합니다.

AI 요청에는 세션·원문 기록 UUID와 작업 종류만 보내며 서버가 사용자 JWT로 `dataset_detail`을 호출해 연구자 권한과 해당 세션의 기록 연결을 검사합니다. 클라이언트가 임의로 넘긴 검사 데이터나 자유 프롬프트를 실행하는 API가 아닙니다. 서버의 수치 요약, 선택 메모, 연결된 개발 결과가 Google Gemini에 전송됩니다. 원시 프레임·영상·계정 메타데이터·PHQ 응답은 전송하지 않습니다. 입력 자료는 시스템 명령과 분리됩니다. 공급자 응답/토큰/연구 원문은 서버 로그에 쓰지 않습니다.

- API: `POST /api/neurolens_dataset` (`/neurolens_dataset` 별칭)
- Vercel 환경변수: **`neurolens_dataset`** (대소문자 그대로, Gemini API 키 값). 환경변수 변경 후 해당 환경에 재배포합니다. 키는 브라우저로 보내지 않습니다. 기존 총평용 `GEMINI_API_KEY`와 별도입니다.
- 고정 모델: **`gemini-3.6-flash`**. 모델을 임의로 대체하지 않으며 접근/할당량 오류는 화면에 표시합니다.
- 일시적인 Gemini HTTP 429/500/502/503/504는 최대 2회 추가 재시도합니다. 지수 대기·jitter·Retry-After를 적용하고 생성 호출의 80초 예산과 Vercel 120초 제한 내에 저장 시간을 남깁니다. 이미 처리됐을 수 있는 네트워크 타임아웃과 400/401/403/404는 자동 반복하지 않습니다. 완료된 응답만 저장하며 모델은 변경하지 않습니다. 성공 기록의 `provenance.attempts`로 호출 횟수를 확인할 수 있습니다. 지속 실패는 `GEMINI_UNAVAILABLE`, 할당량은 `GEMINI_RATE_LIMIT`, 키 누락은 `DATASET_KEY_MISSING`으로 구분합니다.
- 출처: 모델 및 응답 모델 버전, 프롬프트 템플릿 버전, 사용량, 생성 시각, 입력 SHA-256, 측정 요약 SHA-256, 사용된 근거 스냅샷. 해시는 입력 재현을 위한 것이며 관리자 입력의 사실성이나 독립 검증을 보장하지 않습니다.
- 로컬 가져오기: 메모·검토는 JSON 내보내기로 보존합니다. AI 요청은 서버에 저장된 연구 세션에서만 가능합니다. 미저장 폼 초안은 현재 페이지 메모리에만 있으며 새로고침 시 사라집니다.

검증 명령: `py -3 tools/dataset_ai_test.py`, `node dataset-workflow.browser.test.cjs`, 기존 dataset 단위·브라우저 회귀 검사. 로컬 테스트는 모의 Gemini 응답을 사용합니다. 실제 Vercel 키·모델 접근은 배포 후 등록된 연구자 계정으로 생성 버튼을 눌러 확인해야 합니다.

공식 API 참고: [Gemini 3.6 Flash 모델](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [generateContent 및 systemInstruction](https://ai.google.dev/api/generate-content).

## 자동 기록 범위

- CONDITION의 `runSession` 시작에 고유 attempt UUID와 동의를 고정합니다. **이 시점 이후의 검사 시도**가 분모이며, 카메라 권한을 주기 전의 방문은 포함하지 않습니다.
- 완료, 사용자 중단, 측정 예외, 분석 예외를 별도 결과 상태로 기록합니다. 건너뛴 과제·꺼 둔 과제를 성공 측정으로 세지 않습니다. 데모와 연구 미동의 세션은 대기열·서버에 기록하지 않습니다.
- 검사 도중 20초마다 숫자 자료를 로컬 체크포인트로 저장합니다. 갑작스러운 종료는 마지막 체크포인트까지만 복구할 수 있습니다. 10분 이상 갱신되지 않은 초안은 다음 재시도 때 `interrupted`로 기록합니다. 기기·브라우저 저장소가 막혔거나 아직 방문하지 않은 경우 누락될 수 있으므로 인구 수준의 전체 성공률로 해석하지 않습니다.
- 같은 attempt와 무작위 비밀 토큰으로 업로드를 재시도해 중복 세션 생성을 막습니다. 전송을 마치면 로컬 원자료를 제거하고 철회용 영수증만 남깁니다. 미전송 원자료는 7일이 지나면 다음 저장소 점검 시 지웁니다. 자동 철회는 하지 않습니다.
- 기존 RPC 호환 경로에서도 발급받은 서버 세션을 재사용합니다. 기존 RPC의 완료 응답이 유실된 경우 완료 여부를 확인할 조회 함수가 없어 전송 대기로 남을 수 있습니다. 추가 SQL 적용 후 토큰으로 기존 세션을 인계해 중복 없이 완료 상태를 확인합니다. 응답 유실을 성공으로 추정하지 않습니다.
- PHQ는 별도 동의에 따릅니다. 원시 영상·사진·장비 이름·장비 식별자를 저장하지 않습니다. 연구 로그와 후속 과제에는 영상 대신 숫자 근거를 기록합니다.
- 서버 철회는 원자료·검토 이력을 FK cascade로 삭제합니다. 이미 연구자가 내려받은 파일은 기존 연구 철회 절차에 따라 별도로 관리해야 합니다.

## 기록 구조와 수정 원칙

| 위치 | 내용 |
|---|---|
| `summary.dataset` | 검사별 상태·지표·심박 근거, 획득 지연·프레임 간격·조명 변화·눈별 품질·머리 움직임, 규칙 버전과 자동 후속 과제 |
| `payload.telemetry` | 단계 시각, 자극 rAF 시각, 입력 이벤트 지연, 시선 드리프트 조정, 별도 보정 단계 프레임 |
| `payload.calibration.evaluation` | 후보 모델의 내부 검증값, 표적-예측 좌표, 눈별 검증과 affine 적용 여부 |
| `payload.reference` | 선택 연결한 BLE 기준 심박, 접촉 품질, 수신 시각, 연결 끊김 이벤트 |
| `dataset_annotations` | 연구자의 조치, 기준 CSV·동기화 근거·비교 결과, 엔진 재분석, 진단 해석 보정 제안. 원기록을 덮어쓰지 않는 추가 이력 |
| `dataset-engine-log.json` | 개발 내용·검증 상태·다음 과제. 실제 사용자 데이터와 분리된 개발 이력 |

자동 과제는 버전이 고정된 규칙으로 생성됩니다. 현재 신뢰도는 정확도 확률이 아니며, 생성된 과제가 자동으로 알고리즘을 바꾸거나 진단을 수정하지 않습니다. 적용·검증 완료 이력을 남길 때는 실험 ID나 커밋 등 근거가 필요합니다. 원엔진 점수나 자동 해석을 독립 정답 라벨로 사용하지 않습니다.

## 제안 1: 기준 측정과 동시 비교

**실시간:** CONDITION 시작 화면의 연구 제공 상세에서 `기준 심박 장비 연결`을 누릅니다. Web Bluetooth의 Heart Rate Service를 지원하는 센서가 필요합니다. 연결 후 검사 단계 동안만 저장합니다. 모든 스마트워치가 이 서비스를 외부에 공개하는 것은 아닙니다. 센서 접촉 실패·범위 밖 패킷은 정상 심박으로 채택하지 않습니다. 연결이 끊겨도 본 검사는 계속 진행합니다.

**사후 연결:** dataset에서 세션 선택 → 기준 CSV 선택 → 출처·정렬 근거·오프셋·드리프트 입력 → 비교·기록합니다. CSV는 UTF-8이며 헤더와 열은 다음과 같습니다.

```csv
t_ms,bpm,quality
0,72,1
1000,73,1
2000,74,0
```

- `quality`: 1=기준 신호 유효, 0=사용하지 않음. 행 시각은 중복 없이 증가해야 합니다.
- `session_ms = reference_ms × (1 + drift_ppm/1e6) + offset_ms`. session 0ms는 `payload.frames`의 첫 프레임입니다.
- 두 공통 표식을 사용할 경우 `NLDataset.anchors({referenceMs,sessionMs},{referenceMs,sessionMs})`로 오프셋과 드리프트를 계산할 수 있습니다. 심박 파형을 가장 잘 맞추는 오프셋을 정답으로 삼지 않습니다.
- BLE 수신 시각은 센서 내부의 측정 시각이 아닙니다. 기본 비교는 `exploratory`입니다. 기준 장비와 정렬 근거를 연구자가 확인하고 동기화 오차 상한을 기록한 경우에만 `paired`로 표시합니다. 100ms 기준은 공학적 초기값이며 임상 인증 기준이 아닙니다.
- 저장 엔진과 재분석 엔진을 **같은 10초 고정 구간**에서 비교합니다. 2.5초보다 긴 기준 신호 손실을 연결하지 않고, 구간의 기준·웹캠 관측률이 각각 80% 이상일 때 비교합니다. 기준이 있는데 웹캠 출력이 없는 구간은 활용률 분모에 남깁니다.
- MAE·RMSE·편향·절대오차 95백분위·5bpm 이내 비율·품질 문턱별 활용률과 오차를 기록합니다. 5bpm은 실험 비교용 초기값입니다. 겹치는 창을 독립 표본으로 세지 않으며 참가자 간 독립성이나 임상 진단 정확도를 보증하지 않습니다.
- 심박수 비교이며 HRV/박동 간격 검증은 포함하지 않습니다. 실물 BLE 센서와 사람 대상 정확도 검증은 별도 수행해야 합니다.

## 제안 2: 촬영·시선·반응시간 오차 계측

- `condition-camera-2`: 프레임 간격, 원본 영상 시각, 촬영 시각 제공 여부, 촬영→콜백 지연, 표시 예상 시각 대비 콜백 지연을 기록합니다. `captureTime`이 없으면 `callback`이라고 표시하고 실제 촬영 시각으로 주장하지 않습니다.
- 원본 RGB는 유지합니다. 이마·양 볼의 관측 개수·품질, 저조도 비율·밝기 급변, 추론 입력 증폭, ROI 나이, 추론 지연, 눈별 품질과 단안 관측 비율, 머리 움직임을 집계합니다.
- 시선 보정의 표적·예측·후보 모델 비교와 드리프트 조치 전후 근거를 저장합니다. 이는 모델 선택/내부 검증 자료이며 독립 시선 정답이 아닙니다. 커서 보조 결과를 독립 정확도로 주장하지 않습니다.
- 자극 시각은 rAF의 **화면 갱신 전 추정 시각**입니다. 입력 dispatch 지연을 별도 저장하고 반응시간에서 임의로 빼지 않습니다. 화면·입력 장치의 물리적 지연은 미측정 상태입니다.

## 06 학습 파이프라인 · 시선 라벨 수집 모드 (2026-10-08)

- `dataset.html#training`: 불러온 세션의 라벨 등급·적격성(목록 meta/audit 만 사용), 모델 registry(active/shadow/candidates/history)와 release policy, 다음 Colab 작업 안내, 미검증 항목. 학습 실행은 Colab/로컬 CLI(`tools/colab`, `python -m nlcolab …`)에서 일어나며 결과 파일(`model-registry.json`)만 읽습니다.
- `/condition?mode=gaze-label`: 보정 뒤 표적을 바라보고 화면 아무 곳 클릭·터치·스페이스바로 확인하는 전용 수집. 검사 결과·점수를 만들지 않고 같은 연구 저장 경로로 전송됩니다(`meta.sessionKind='gaze-label'`). 마지막 블록은 평가 전용(eval_only).
- 추가 SQL 은 없습니다. 라벨 사후 수정·무효화·복구는 기존 `dataset_annotate(kind=correction)` 에 append-only 로 기록합니다. 절차·상태 행렬·미검증 항목은 [COLAB_TRAINING_RUNBOOK.md](COLAB_TRAINING_RUNBOOK.md).

## 다음 연구 과제

1. 저조도·노출 변화·안경 반사·모자·저사양 기기별 기준 장비 동시 측정. 참가자/기기/날짜를 분리한 평가셋 구성.
2. 자동 후보의 실제 원인을 검토하고, 신호 품질 점수 대비 관측 오차를 보정. 실패 세션도 분모에 유지.
3. 개인별 재검사와 환경 변화 기록으로 반복 신뢰도 평가. 현재의 자기보고·자동 점수는 임상 정답과 구분.
4. 기준 측정 데이터가 충분해지면 예상 오차 모델과 조건별 융합 가중치 모델 개발. 버전별 같은 평가셋과 회귀 검증 유지.

## 검증 명령

```powershell
node condition-dataset.test.cjs
node condition-dataset.browser.test.cjs
node condition-camera.test.cjs --real
node condition-signal.test.cjs
py -3 tools/newbiz_research_export_test.py
# 별도 임시 설치한 @electric-sql/pglite 경로를 지정하는 경우:
$env:DATASET_PGLITE_PATH = "$env:TEMP\condition-pglite\node_modules\@electric-sql\pglite"
node tools/condition_dataset_sql_test.cjs
```

브라우저 통합 테스트는 합성 신호와 가짜 연구 RPC로 검사하며 운영 서버에 연구 데이터를 쓰지 않습니다. SQL 테스트는 독립 PostgreSQL/WASM이며 테스트용 암호 함수 대역을 사용하므로 암호학 자체를 검증하지 않습니다.

구현 참고: [Web Bluetooth API](https://developer.chrome.com/docs/capabilities/bluetooth), [비디오 프레임 시각 메타데이터](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
