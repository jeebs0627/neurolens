# NeuroLens CONDITION — Colab 학습 엔진 운영 가이드

수집 → 인증된 내보내기 → 불변 스냅샷 → 학습·평가 → 통과한 후보만 등록 → shadow·canary·승인 → 다음 검사부터 적용. 이 문서는 2026-10-08 구현(기준 commit `d69c755` 위)의 **사실 확인 결과, 상태 행렬, 실행 절차, 미검증 항목**을 적습니다. 코드·스키마 명세는 [TRAINING_SCHEMA.md](TRAINING_SCHEMA.md), 저장 계약은 [NEWBIZ_RESEARCH_DATA.md](NEWBIZ_RESEARCH_DATA.md), dataset 운영은 [DATASET_RUNBOOK.md](DATASET_RUNBOOK.md).

## 0. 상태 행렬 (implemented / configured / tested / deployed / real-data-validated 를 구분)

| 영역 | implemented | tested | deployed | real-data-validated |
|---|---|---|---|---|
| v3 연구 패키지(`nl-research-3`: px/py·sx/sy·bx/by 열, 표적 ID·round·구간, 잔차 보정·snapshot·digest, clock segments, weak 클릭 좌표, sessionKind/viewport/gazeModel/subjectKey) | ✔ newbiz-research.js, condition.html | ✔ node 단위 + Playwright E2E | ✔ 2026-10-08 운영 반영 | ✖ 실측 v3 세션 아직 없음 |
| 전용 시선 라벨 모드 `/condition?mode=gaze-label` (표적 계획·확인 창·거부/재시도/무효화 이벤트·holdout 전후 digest·점수 없는 결과 화면·기존 outbox 전송) | ✔ condition-labels.js, condition.html | ✔ condition-labels.test.cjs, condition-labels.browser.test.cjs(헤드리스 Edge, 합성 관측) | ✔ 운영 반영(카드 렌더 확인) | ✖ 실사용자 수집 전 |
| 전역 잔차 모델 클라이언트(registry 고정, 같은 출처 경로만, SHA-256·스키마·allowlist·버전·테스트 벡터 검증, fail-closed, 단일 in-flight 추론, shadow/active, 세션 종료 전 drain) | ✔ condition-gaze-model.js, model-registry.json | ✔ condition-gaze-model.test.cjs(주입 ORT) | ✔ 운영 반영(registry 비어 있음 → off 확인) | ✖ 등록 모델 없음 · 실기기 ORT 로드·지연 미측정 |
| 인증된 학습 export(JWT · dataset_list/dataset_detail · 끝 페이지까지 · 해시 검증 · 증분) | ✔ nlcolab/export.py | ✔ | — | ✔ 2026-10-08 실제 50건 export(§8) |
| service_role exporter 보강(Range 페이지네이션·calibrationFrames·landmarks·annotations·export_index) | ✔ tools/newbiz_research_export.py | ✔ paging 단위 테스트 | — | ✖ |
| v1/v2/v3 adapter(canonical clock, 표적 backfill 플래그, pursuit 메타 legacy 표, 랜드마크 기반 세로 특징 재계산, reference 최신 유효 연결) | ✔ session_adapter.cjs, adapter.py | ✔ session_adapter.test.cjs, test_pipeline.py | — | ✖ |
| 기존 엔진 baseline 재현(Node, snapshot/replay, fidelity) | ✔ baseline_predict.cjs | ✔ (합성: snapshot vs replay 중앙값 <3px) | — | ✖ |
| 인벤토리·적격성·라벨 등급·subject 연결 보고 | ✔ inventory.py (+ /dataset 06 pane) | ✔ | ✖ | ✖ |
| 불변 스냅샷·변경 탐지·철회 표시·`no_new_eligible_data` | ✔ snapshot.py | ✔ | — | ✖ |
| 시선 잔차 데이터셋(allowlist·창 가중·eval_only 분리)·group/time split·접근 로그 | ✔ gaze_dataset.py, splits.py | ✔ 누수 검사 테스트 | — | ✖ |
| baseline/ridge/MLP 학습·val 선택·ONNX(opset 17)·ORT parity·bootstrap·release policy gate·manifest·모델 카드·registry 패치(candidate 만) | ✔ train_gaze.py, evaluate.py, release.py | ✔ 합성 end-to-end | — | ✔ 실측 50세션 실행(§8): evaluated · 후보 없음 (정확도 검증이 아니라 ‘학습해도 baseline 을 못 넘음’의 실측 근거) |
| rPPG 기준 오차 선택기(고정 10초 epoch pairing·paired/exploratory 분리·causal 분리·abstain·risk-coverage·oracle·`insufficient_reference_labels`) | ✔ rppg_dataset.py, train_rppg.py | ✔ | — | ✔ 실측 실행: `insufficient_reference_labels` (기준 심박 0건) |
| Colab 노트북 4개(실행 화면) | ✔ notebooks/ | ✔ JSON 구조 검증만 · **Colab 실제 실행 미수행** | — | ✖ |
| /dataset 06 학습 파이프라인 pane | ✔ dataset-training.js | ✔ Playwright | ✔ 운영 반영 | — |
| 재생 도구 메타데이터 adapter(gaze_replay.cjs) | ✔ | ✔ 합성 실행 | — | ✖ 실측 13세션 재실행 미수행(원자료 접근 없음) |

**실제로 수행하지 않은 것**: 운영 DB 변경(마이그레이션 불필요 — 기존 RPC 재사용), 실제 참가자 데이터의 Colab 업로드·학습, Vercel 배포, 운영 모델 승인, 실기기·모바일 지연 계측, 외부 eye tracker·접촉 PPG 기준 수집. 이 문서의 어떤 수치도 사람 대상 정확도가 아닙니다.

## 1. 사실 확인 결과와 gap (기준 commit d69c755, 2026-10-08)

로컬 main 은 origin/main 보다 12 commit 뒤였고 작업 전 fast-forward 했습니다(사용자 미커밋 파일은 건드리지 않음). 확인된 gap 과 조치:

| # | 확인 | 조치 |
|---|---|---|
| 1 | calibrationFrames 는 이미 수집됨(condition.html `pushFrame`) | 수집기 중복 구현 없음. round 구간(`calibration.rounds`)으로 누적 프레임을 나눔 |
| 2 | `payload.frames.t0` 와 `telemetry.calibrationFrames.t0` 는 각자 원점; landmarks·targets·pursuit 는 payload.t0 기준 | adapter 가 canonical clock 으로 변환(JS·Python 동일 규칙, 테스트) |
| 3 | 기존 NPZ export 는 일반 frames 중심, calibrationFrames·landmarks·annotations 누락, **PostgREST 1,000행 기본 상한에 페이지네이션 없음** | exporter 에 Range 페이징·cal_/lm_ 배열·annotations·export_index 추가. 학습용은 JWT 기반 `nlcolab export` 권장 |
| 4 | 기준 CSV 는 `dataset_annotations(kind=reference).body.reference` 에만 존재 | adapter `effective_reference` 가 최신 유효 연결 + 이력 반환 |
| 5 | `[t,x,y,kind]` 만으로 응시 구간 불명확; fine 8점이 kind 'val' 로 기록됨 | v3 `targetsV2`(id·round·onset·offset·sampleStart/End·samples/kept·role). 과거는 `inferred_backfill` + uncertainty 300ms 표시 |
| 6 | gazeCursor/cursorTask 커서 보조는 표시용; 현행 `fitResidual/applyResidual`(축당 4계수 ridge bilinear, cap 12%) 존재 | 커서 자료는 학습·평가에 쓰지 않음. 전역 모델 계약 `add-residual`(기존 잔차까지 적용한 g_base + delta) 고정, `replace-residual` 은 manifest 로 선택 — 같은 잔차를 두 번 적용하지 않음 |
| 7 | 재시도 시 calibrationFrames 누적; 정밀 8점은 후보 선택 뒤 최종 refit 에 재사용(→ 최종 모델에선 독립 평가 아님) | `digests.selection`(후보 선택 모델) / `digests.final`(refit) 분리 기록. 학습 target 은 선택 모델 baseline(`replaySelection`) 우선 |
| 8 | 저장된 model/affine 만으로 분석 좌표 재현 불가(`resid` 누락, raw/display 경로 혼재) | `calibration.resid`·`snapshot`(mu·sd·wx·wy·quad·keys·zr·eyes·combine·affine·resid·drift)·digest, 표본 열 `px,py`(원출력)·`bx,by`(active 시 baseline) 추가. 합성 검증: snapshot 재현 == 기록 digest |
| 9 | gaze_replay.cjs 가 0.12/0.08Hz·12.5초·120ms 를 하드코딩; 입력 wrapper 고정 | adapter 기반으로 재작성. 주파수: 기록(v3) → path 문자열 → 버전별 legacy 표(unknown 표시). lag 는 v3 부터 기록(`lagMs`), 그 전은 `legacy-assumed-120ms` 플래그 |
| 10 | `dataset.js exportRow` 는 요약(meta/audit/annotations)만 — 원자료 아님 | import 시 `summary-only` 로 분류, 학습 자료로 쓰지 않음 |
| 11 | 카메라는 main-thread GPU 기본, worker 는 `?camworker=1` opt-in | 문서 그대로; 모델 추론은 main 비동기 단일 in-flight(캡처 비차단) |
| 12 | SQL 마이그레이션은 **필요 없음** — `dataset_research_begin/chunk/finish/withdraw`, `dataset_list/detail/annotate` 재사용, 라벨 수정은 `kind=correction`(append-only) | 운영 DB 적용 여부(`20261004_condition_dataset.sql`·reviewer 등록)는 기존 runbook 대로 확인 필요 |
| 13 | `condition-signal.test.cjs` 가 d69c755 에서 이미 실패(`recoveredFraction` 단언) | 이번 작업과 무관한 기존 실패로 기록 |

## 2. 언제 어디서 무엇이 일어나는가

- **일반 /condition**: 동의 세션의 캘리브레이션·검사 관측을 v3 로 자동 기록(완료·중단·실패 포함). 검사 시작 시 `model-registry.json` 을 1회 읽어 전역 모델을 고정(없으면 off). shadow 면 `sx,sy` 기록만, active 면 분석 좌표에 적용(`bx,by` 에 baseline 보존), 화면 커서는 기존 엔진 그대로. 세션 중 교체 없음.
- **/condition?mode=gaze-label[&labels=16,4,5&seed=n]**: 보정 → 표적 응시·확인 → 점수 없는 수집 요약 → 같은 outbox/RPC 로 전송(`meta.sessionKind='gaze-label'`). 전역 모델은 shadow 로만 고정(라벨에 영향 없음). 마지막 holdout 블록 전후 digest 동일성 기록.
- **/dataset 06 학습 파이프라인**: 목록 meta/audit 만으로 라벨·적격성 집계, registry/policy, 다음 Colab 작업 안내. 원자료 미열람.
- **Colab(활성 런타임 배치)**: 01 감사·export·스냅샷 → 02 시선 학습 → 03 rPPG → 04 후보 패키지. 체크포인트(`work/state.json`)로 재개. 무인 스케줄러·상시 서버·keep-alive 우회 없음. 완전 무인 정기 학습은 별도 승인 환경에서 같은 CLI(`python -m nlcolab run`)를 돌리는 확장 옵션.
- **배포**: 후보 디렉터리(`models/gaze/<id>/model.onnx + manifest.json`)와 registry 변경을 **검토된 commit** 으로만. 승격(active)·rollback 은 registry 수정 commit(이력에 승인자·시각·이전 active·rollbackTo).

## 3. 실행 절차

### 로컬 (Windows · PowerShell)
```powershell
py -3 -m venv .venv-colab; .\.venv-colab\Scripts\python -m pip install -r tools\colab\requirements-colab.txt
Set-Location tools\colab
# 합성 fixture 로 전체 경로 확인 (운영 자료 아님 · 보고서에 SYNTHETIC 표기)
..\..\.venv-colab\Scripts\python -m nlcolab fixtures $env:TEMP\nl-fx --sessions=12 --seed=300 --legacy=3
..\..\.venv-colab\Scripts\python -m nlcolab import $env:TEMP\nl-raw $env:TEMP\nl-fx\sessions
..\..\.venv-colab\Scripts\python -m nlcolab run $env:TEMP\nl-raw $env:TEMP\nl-work --allow-synthetic
# 실제 자료: 연구 관리자 JWT (비밀번호 프롬프트 · 저장 안 함)
..\..\.venv-colab\Scripts\python -m nlcolab export ..\..\training\raw
..\..\.venv-colab\Scripts\python -m nlcolab run ..\..\training\raw ..\..\training\work
```
`training/`·`research_export/` 는 .gitignore/.vercelignore 에 포함(개인 연구자료 커밋·배포 금지).

### Colab
`notebooks/01…04` 를 순서대로 엽니다(각 노트북 첫 셀이 저장소 clone·설치). 비밀은 `getpass` 입력으로만, 셀 출력에 남기지 않습니다. Drive `neurolens-training/{raw,work}` 가 보존 저장소입니다.

### 상태 의미
`queued · running · no_new_eligible_data · insufficient_data · insufficient_reference_labels · failed · evaluated · candidate · approved · active · rolled_back`. `evaluated` 는 학습·평가 완료(정책 미통과 또는 baseline 유지), `candidate` 는 정책 통과 후보 패키지 생성. `trained ≠ active`.

## 4. 승격·shadow·canary·rollback

1. 후보 commit(모델 + registry.candidates) → 배포.
2. registry `shadow` 지정 → /condition 에서 `meta.gazeModel`(mode·latency·guardReasons·dropped)과 `sx,sy` 기록을 /dataset 에서 확인. shadow 는 라벨 없는 정확도 검증이 아니다.
3. 저사양/모바일 1종 포함 실기기 p95 추론 ≤ 예산(5~8ms, `release_policy.json`), WASM 로드·CSP/CORS/캐시 확인.
4. 승인된 소규모 canary(사용자 동의 범위) → 회귀 없음 확인.
5. `active` 지정 commit + history(approvedBy/approvedAt/previousActive/rollbackTo). 진행 중 세션은 영향 없음.
6. rollback: `active=null`(또는 이전 항목) commit → 배포. 로드 실패·해시 불일치·NaN·지원 범위 이탈은 브라우저가 자동으로 기존 엔진으로 fail-closed.

## 5. 삭제·철회 영향 추적

참가자 철회는 기존 RPC(cascade)로 원자료·annotation 을 지웁니다. 다음 `nlcolab snapshot` 이 이전 스냅샷 대비 사라진 세션을 `withdrawn` 으로 보고하고 `snapshot-diff.json` 에 남깁니다. 이미 내려받은 `training/raw` 파일과 학습된 모델에는 자동 전파되지 않으므로, 영향받은 스냅샷·후보·active 를 표시하고 재학습 또는 모델 폐기를 운영 절차로 결정합니다(기록: registry history).

## 6. 검증 명령과 결과 (2026-10-08 로컬)

```powershell
node condition-labels.test.cjs            # 8 passed
node condition-gaze-model.test.cjs        # 7 passed
node tools\colab\session_adapter.test.cjs # 5 passed (합성 fixture · baseline_predict CLI 포함)
node condition-labels.browser.test.cjs    # 4 PASS (gaze-label E2E · 결과 화면·outbox · 모바일 · /dataset 06)
node condition-dataset.browser.test.cjs   # 5 PASS (기존 회귀)
node dataset-workflow.browser.test.cjs    # PASS (기존 회귀)
node newbiz-core.test.js; node condition-fusion.test.cjs; node condition-dataset.test.cjs   # 기존 통과
node condition-signal.test.cjs            # 기존 실패(d69c755 이전부터 · 이번 작업 무관)
py -3 tools\newbiz_research_export_test.py                  # 4 OK (페이지네이션 포함)
<venv>\python -m unittest tools\colab\tests\test_canonical.py tools\colab\tests\test_pipeline.py   # 10 OK (digest/allowlist JS 일치 · end-to-end)
```
합성 12세션 실행(`--allow-synthetic`): baseline 중앙 35.8px → ridge 33.1 → MLP 30.9 (val), parity ok, gate 실패(`minTrainGroups/minValGroups/minLockedTestGroups`) — 코드 경로 검증일 뿐 사람 성능이 아닙니다.

## 7. 미검증·사용자 행동 필요

- 운영 DB 에 `20261004_condition_dataset.sql` 적용 여부와 reviewer 등록 확인(없으면 `dataset_list/detail` 이 403 → export 불가).
- 실제 자료 export 후 `inventory.md` 로 적격 세션·subjectKey·paired 기준 수를 확인 — 현재 보유 세션 수·독립 참가자 수·paired reference 양은 **미확인**.
- 라벨 수집 모드 실사용 테스트(데스크톱·터치 1종), ONNX Runtime Web 실기기 로드·지연(현재 등록 모델 없음 → 로드 경로는 registry 비어 있을 때 off 로만 확인).
- 과거 세션의 `payload.landmarks` 유무(없으면 core<2.3 세션은 세로 특징 재계산 불가로 제외됨).
- 모델 서명 체계 없음(해시만). 배포 신뢰 경계는 Vercel 배포 + 같은 출처 경로 제한.

## 8. 실측 자료 첫 실행 결과 (2026-10-08 · 로컬 CLI = Colab 배치와 동일)

인증 export: 연구 관리자 JWT 로 `dataset_list`(1페이지·100행 상한·마지막 페이지 50행) → `dataset_detail` 50건, 해시 불일치 0, 토큰 파일 없음. 원자료는 `training/raw`(git·배포 제외)에만 있다.

| 항목 | 값 |
|---|---|
| 세션 | 50 (2026-10-03~07 · nl-research-2 47 · nl-research-1 3 · 전부 core 2.3 이전 · 라벨 모드 0 · subjectKey 0) |
| 시선 적격 | 38 (전부 표적 구간 backfill · 세로 특징은 50건 모두 랜드마크로 재계산) · baseline 재생 36 · 803 창 · 9,084 프레임 |
| 분할(세션 단위) | train 17 · val 6 · locked 6 · temporal 7 · eval_only 0 |
| val 중앙 오차 | baseline 135px · ridge 147px(−9%) · MLP 117px(+13.7%, bootstrap 95% CI +7.6~+18%) |
| locked_test | MLP 127px vs baseline 122px (**−4% 회귀**) |
| temporal_test | MLP 191px vs baseline 168px (**−14% 회귀**) |
| 결론 | **evaluated · 후보 없음 · 기존 엔진 유지**. val 개선이 세션·시간 holdout 에서 재현되지 않음 → 사람 연결 없는 반복 세션의 개인 잔차를 학습했을 가능성 |
| rPPG | `insufficient_reference_labels` (기준 심박 0건 · 맥파 창 보유 18세션) |

정책 `2026-10-08.2`: locked/temporal test 회귀 금지 규칙은 **이 결과를 본 뒤 추가**했다(`release_policy.json.gaze_residual.lockedTestRuleHistory`). 더 좋은 점수를 위한 조정이 아니라 회귀 차단이지만, 이로써 현 locked_test 는 회귀 benchmark 가 됐고 새 일반화 주장에는 새 prospective holdout(라벨 수집 모드·subjectKey 보유 세션)이 필요하다. 사람 연결이 없는 자료로 만든 후보는 통과하더라도 `release.maxState = shadow` 까지만 허용된다.

실측 첫 실행에서 고친 코드 결함: baseline 도구 상대 경로(ENOENT), 스냅샷 저장 후 실패 시 재개 불가, 중단 세션(core 미기록) 세로 특징 미재계산, 삭제된 클릭 보정 표적(kind `click`) 미분류, integrity 검사 과엄격(레코드 없는 세션의 재현 불가를 전체 실패로 취급), 실패한 gate 뒤 이전 후보 패키지 잔존.

다음에 필요한 자료: ① `/condition?mode=gaze-label` 로 **서로 다른 사람 3명 이상**(각자 자기 브라우저 → 고유 subjectKey) 라벨 세션, ② 기준 심박(BLE 또는 CSV+동기화 검증) 동시 측정 세션 6건 이상. 그 전까지 학습 배치는 `evaluated`/`insufficient` 로 끝나는 것이 정상이다.

## 9. 학습·모델 대시보드 (`/dataset` 06) 와 공개 원장

- `training-ledger.json`(저장소 루트 · 배포됨): 학습 배치 실행 1회당 집계 1건. 세션·적격·라벨 세션·사람 키·기준 심박 수, 분할 크기, 모델별 val/locked/temporal 중앙·P95 오차, gate 결과·실패 항목, bootstrap, rPPG 상태, 현장 작동 기록(모델 모드별 세션 수·지연·shadow 출력 차이), 한계. **참가 코드·세션 ID·subjectKey·원자료는 들어가지 않는다**(ledger.py 가 금지 키를 검사).
- 배치가 끝나면 `python -m nlcolab publish-ledger <work_dir>` 가 `work/ledger-entry.json` 을 원장에 병합한다(같은 runId 는 교체). 이 파일을 commit·배포하면 대시보드가 갱신된다.
- 대시보드 카드: ① 딥러닝 모델 작동 상태(registry active/shadow/꺼짐) ② 현장 작동 기록(불러온 세션의 `meta.gazeModel` 모드·지연·추론 수) ③ 최근 학습 실행(상태·선택 모델·gate) ④ 학습 데이터 규모. 그 아래 실행별 중앙 오차(기존 엔진 vs 선택 모델, val·locked test)와 데이터 규모 차트, 실행 표, 최근 실행 상세(모델별 지표·분할·bootstrap·rPPG), 세션 집계, 다음 작업, registry.
- 읽는 법: ‘개선’은 같은 정책 아래 같은 지표의 실행 간 변화뿐이다. 실행 1회는 기준점이다. val 만 좋아지고 locked/temporal 이 나빠지면 등록되지 않는다. 오차는 표적 proxy 기준 px 이며 외부 eye tracker 정확도가 아니다. ‘작동 중’은 registry 와 현장 세션의 모드 기록으로만 판단한다.

## 10. shadow 정책 예외 기록 (2026-10-08)

연구 관리자가 "1번 먼저 진행해줘"(shadow 배포)로 **정책 예외**를 승인했다. 대상은 §8 의 MLP(`gaze-residual-a05c5d16-mlp-shadowx`, 4,770 파라미터, ONNX 19,730 bytes, opset 17). gate 실패 항목(locked/temporal 회귀), 승인자, 사유, 시각은 manifest `release.exception` 과 `model-registry.json` history(`shadow-exception-approved`)에 남겼다.

- 적용 범위: **shadow 전용**. 검사 시작 시 모델을 고정하고 추론 결과를 `sx,sy` 열에 기록할 뿐 측정 좌표·표시 커서에는 쓰지 않는다. `release.maxState = shadow`. active 승격은 subjectKey 가 있는 prospective 평가를 통과해야 한다.
- 실기기 확인(헤드리스 Edge · 로컬 서버): ONNX Runtime Web 1.22.0 WASM 로드 625 ms, 테스트 벡터 5개 일치, 추론 평균 0.09 ms · 최대 0.3 ms. 합성 입력에서는 guard 가 보정량을 15 % 상한에서 잘랐다(`capped`) — 실제 세션의 guard 사유 분포는 `meta.gazeModel.guardReasons` 로 쌓인다.
- 이 과정에서 `condition-gaze-model.js` 의 스코프 결함(UMD `root` 를 팩토리 안에서 참조 → registry 에 모델이 있을 때 항상 fail-closed)을 발견해 수정했다. registry 가 비어 있던 동안에는 드러나지 않았다.
- rollback: `model-registry.json` 의 `shadow` 를 `null` 로 되돌리는 commit → 배포. 진행 중 세션은 영향 없음.

## 11. 2026-10-08 현장 실측 4건 분석과 조치

자료: 오늘 v3 세션 4건(Windows 데스크톱 3 · Android 폰 1, 사람 키 4개). 연결된 Supabase 커넥터로 읽기 전용 조회해 해시 검증 후 `training/raw`(git·배포 제외)에 저장했다. 분석 도구: `tools/colab/field_analysis.cjs`(현장 평가) · `tools/colab/engine_bench.cjs`(엔진 설정 재생 비교) · `nlcolab/cv_select.py`(세션 단위 교차검증).

**관찰**
| 항목 | 결과 |
|---|---|
| 보정 정밀 8점 held-out | 3.5 · 7.6 · 12.1 · 16.0 %W (폰 16.0). 데스크톱 오차는 **세로가 주원인**(세로 11~14%H vs 가로 3%W) |
| 세로 이득 | 원형 추적에서 엔진 세로 이득 0.45~0.73(가로 0.85~0.95), 정지 표적에서도 0.77 → 세로 홍채 특징 잡음에 의한 회귀 희석 |
| 세션 중 치우침 | 지시 응시 기록 기준 p90 가로 21%W · 세로 23%H. 폰은 가로 −41%W(지시 응시 3회 모두 엔진이 거부 — 측정값 자체가 손떨림으로 불안정해 거부가 맞았음을 재생으로 확인) |
| 머리 자세로 치우침 설명 | 세션 내 선형(LOO) 개선 폰 34%/21%, 데스크톱 −9~18% → 일관되지 않아 엔진에 넣지 않음 |
| 커서 과제 축 보정 | 한 세션에서 원형 추적 가로 오차 6.4→4.5%W 로 도움 → 유지 |
| shadow 모델(현장) | 같은 표본에서 가로 8.3→5.5%W 개선, 세로 8.9→10.9%H 악화(세션별 혼재). 세션 단위 교차검증에서 이 구조(64-32 MLP)는 기존 엔진보다 나쁨(169.6 vs 146.4px) |
| 타이밍 | rAF 시각이 요청보다 앞선 자극 26~91%(최대 92ms) → 반응시간·잠복기 과대 |
| 카메라 | 데스크톱 약 15.7fps · 추론 지연 51~61ms, 폰 10.5fps · 109ms. 폰 노출·색온도 고정 실패(“colorTemperature setting out of range”) |
| 연구 기록 결함 | `meta.gazeModel` 에 지연·추론 수·guard 사유 누락, `calibration.viewport` 누락, 암묵 응시는 받아들인 경우만 기록(라벨 편향) |

**조치 (코드)**
- `condition.html`: 자극 onset = max(rAF, 요청 시각)(원래 값 `rafTs` 보존) · 카메라 고정 시 장치 범위 밖 값 제외 후 재시도 · 암묵 응시 거부 시도도 기록(사유·tx/ty·MAD) · 지시 응시에 창 길이·표적 좌표 기록.
- `newbiz-research.js`: `meta.gazeModel` 에 지연·추론·건너뜀·오류·guard 사유·로드 시간, `calibration.viewport` 저장.
- 학습: 지시 응시(가운데 점) 52건을 시간 분산 라벨 `instructed_fixation` 으로 추가(엔진 수락 여부와 무관하게 기록된 것만), 잔차 target 을 브라우저 적용식(base + Δ − drift)과 일치시킴, 세션 단위 5-fold 교차검증으로 val 단일 분할 우연을 차단, 현장 평가를 원장에 집계.
- 엔진(`newbiz-core.js`): 특징별 수축·축별 기울기 상한 **옵션만** 추가(기본값 동일). 재생 벤치 33세션에서 세로 수축 완화·상한 확대·표적별 집계 모두 held-out 오차를 줄이지 못해(집계는 이득 0.77→0.85 대신 오차 11.3→11.9%) 기본값을 바꾸지 않았다.

**학습 결과(실행 2, 54세션)**: MLP val +14.5% 였으나 locked +4%·temporal +25% 악화, bootstrap 하한 음수, 교차검증 미확인 → evaluated · 후보 없음. 결론: 현재 특징·자료 규모에서 **세션 간 전이되는 전역 잔차 모델은 근거가 없다**. 오차의 대부분은 세션별 보정 품질과 세션 중 치우침이며, 이를 줄이려면 사람·기기가 다양한 라벨 수집 세션과(같은 사람의 반복 포함) 세션 중 지시 응시 라벨이 더 필요하다.

**shadow 모델**: 측정에 쓰이지 않으므로 그대로 두어 현장 지연·출력 자료를 계속 모은다. 교차검증 결과상 active 후보가 될 수 없음을 registry 이력과 원장에 남겼다.
