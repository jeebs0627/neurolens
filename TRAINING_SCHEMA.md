# NeuroLens CONDITION — 학습용 schema · feature · label · split 명세

연구 패키지 `nl-research-3`(newbiz-research.js)와 그 파생물(canonical session · training record · split manifest · model manifest)의 계약입니다. 원본 JSON 은 수정하지 않고 adapter 가 canonical view 를 만듭니다(JS: `tools/colab/session_adapter.cjs`, Python: `tools/colab/nlcolab/adapter.py`).

## 1. 시간 좌표

| 항목 | 내용 |
|---|---|
| 세션 내 기준 시계 | `performance.now()` 계열 단조 시계. `event.timeStamp` 는 같은 시계(브라우저가 정밀도를 낮출 수 있음). UTC(`meta.measuredAt`, `telemetry.clock.utcAtOrigin`)는 세션 간 정렬 메타데이터 |
| canonical session clock | `payload.t0`(기록 첫 프레임의 절대 시각) 기준 ms. `payload.frames` 와 `payload.telemetry.calibrationFrames` 는 **각자 `t0`** 를 가지므로 `t_abs = block.t0 + t[i]`, `t_session = t_abs − payload.t0`. landmarks·calibration 표적·pursuit·gazeLabels·reference 는 이미 payload.t0 기준 |
| 프레임 시각 | `clockSource`: `capture`(requestVideoFrameCallback captureTime) / `callback`(없을 때 콜백 시각 — 촬영 시각으로 선언하지 않음). `captureDelayMs`·`callbackLateMs`·`mediaTimeMs`·`presentedFrames`·`intervalMs`·`lag`(추론 완료까지) 분리 기록 |
| clock segments (v3) | `telemetry.clock.segments[] {t, kind: session-start · camera-init · resume(hiddenMs) · …}` — 탭 재개·카메라 재연결은 새 구간 |
| 레이아웃 변경 (v3) | `telemetry.layout[] {t, kind: resize · visual-viewport · scroll · label-stage-remount}` — 라벨 창은 표시~확인 사이에 변경이 있으면 무효 |

## 2. 화면 좌표

표적과 포인터는 **CSS client 좌표**(`clientX/Y`, `getBoundingClientRect`)로 기록하고 viewport(`innerWidth/innerHeight`) 기준 0~1 로 정규화합니다. 카메라 px(랜드마크는 영상 정규화 좌표)·물리 화면 px 와 섞지 않습니다. DPR·visualViewport(scale/offset)·scroll·orientation·fullscreen 은 `meta.viewport`, `gazeLabels.viewport`, 표적별 `vp` 에 스냅샷으로 남깁니다. 브라우저 zoom 은 DPR 하나로 역산하지 않습니다(zoomNote). 시거리·물리 화면 크기를 재지 않았으므로 오차를 시각도(°)로 보고하지 않습니다.

## 3. 패키지 필드 (v1 → v3 추가분)

| 위치 | v3 추가 | 의미 |
|---|---|---|
| `meta` | `sessionKind` (`condition` \| `gaze-label`), `viewport`, `gazeModel{id,version,mode,sha256,loadError}`, `subjectKey`, `subjectKeySource`, `versions.labels` | 세션 종류·좌표계·검사 시작 시 고정한 전역 모델·연구용 가명 키(브라우저 로컬 무작위 = 기기 수준) |
| `payload.sampleColumns` | `… px py sx sy bx by` | px,py 모델 원출력 · rx,ry 영점/축별/잔차 보정 후(분석 좌표) · sx,sy 전역 모델 출력(shadow 기록 또는 active 적용값) · bx,by active 적용 시 보존한 기존 엔진 좌표 |
| `payload.calibration` | `targetsV2[] {id, round, kind(fix9/val/zone/fine), role, x, y, onset, offset, sampleStart, sampleEnd, samples, kept}`, `rounds[] {round,start,end,grade,errPct,outcome}`, `resid`, `snapshot`, `digests{selection, selectionKey, refitApplied, refitErr, final}`, `fine`, `pursuit{fx,fy,ax,ay,phaseY,lagMs,sampleFrom,sampleTo,weight,round}` | 표적 ID·표시 구간·재시도 round, 잔차 보정 계수, 전체 개인 파이프라인 snapshot, 선택용/최종 모델 digest(정밀 8점은 선택용에만 독립 평가), 추적 보정 메타(기록값) |
| `payload.gazeLabels` | `schema nl-gaze-label-1`, `config`, `plan{seed,counts,targets[]}`, `viewport`, `clock`, `pipeline{atStart,…}`, `events[]`(append-only), `labels[]`, `holdout{beginAt,endAt,digestBefore,digestAfter,pipelineUnchanged,proxyError}`, `summary` | 전용 라벨 수집 (§5) |
| `payload.telemetry` | `clock.segments`, `layout`, `inputs[].{x,y,pointerType,isTrusted,labelSource:'free_click_weak',coordinateSpace}` | weak 클릭은 좌표·provenance 만 보존 |
| `summary.dataset` | `sessionKind`, `gazeLabels`(요약) | `dataset_list` 만으로 라벨 수를 셀 수 있게 |

## 4. 라벨 등급과 역할

`label_source` ∈ reference_eyetracker · explicit_target_confirmed · calibration_target · free_click_weak · engine_prediction · unlabeled (문서 §4). `label_role` ∈ train · internal · holdout · eval_only · weak · excluded. explicit/calibration 라벨은 **proxy** 이며 독립 시선 정답이 아닙니다. 과거 `[t,x,y,kind]` 표적은 adapter 가 `inferred_backfill=true, uncertainty_ms=300, backfill_method` 로 구간을 추정하고 strict 평가에서 분리합니다.

## 5. 전용 라벨 수집 (gaze-label-1)

- 표적 계획: viewport 정규화 5×5 셀 + 기각 표집으로 중앙·주변·모서리를 역할(train 16 / internal 4 / holdout 5 기본, config)별로 고르게. seed 기록. holdout 은 마지막 블록.
- 확인: 화면 아무 곳 pointerdown(버튼 제외) · 스페이스바 · Enter. 라벨 좌표는 표시된 표적 중심(마우스 좌표 아님).
- 창: `[confirm−500ms, confirm−200ms] ∩ [shown+600ms, ∞)`. 최소 체류 900ms, 최소 4 프레임, fps ≥8, 깜빡임 ≥0.45 제외, 얼굴 손실·hidden·레이아웃 변경 제외, 머리 이동 ≤2.5%/100ms, 표적당 최대 12 프레임(고르게 솎음). 값은 공학적 초기값(config).
- `dwellConfidence` 는 규칙 기반 품질 점수(정답 확률 아님). 라벨 신뢰도와 모델 출력 신뢰도는 별도 필드.
- 이벤트: plan · shown · confirm · retry · invalidate · restore · holdout-begin · holdout-end (append-only). 유효 상태는 `effectiveLabels()` 로 재계산.
- holdout 보호: 블록 전후 `pipelineDigest`(model·affine·resid·drift·coreVersion·gazeModel) 동일성, 라벨 모드에서는 전역 모델이 active 로 적용되지 않음(shadow 만). `proxyError` 는 표적 proxy 기준 오차.

## 6. 학습 feature 계약

허용(`FEATURE_ALLOWLIST`): `baseX baseY u v uLeft vLeft uRight vRight qLeft qRight open yaw pitch cx cy fw blink eyeQ lag eyeMode`. 금지(`FEATURE_DENYLIST`): 표적·클릭 좌표, 라벨, 신뢰도, 확인 시각, 미래 좌표, 역할 등. baseX/baseY 는 계약(`add-residual`: 기존 affine+잔차 좌표 / `replace-residual`: affine 좌표)에 따른 baseline 을 viewport 로 정규화한 값이며 표적으로 보정되지 않은 당시 baseline 입니다. 전처리: train 통계로 표준화 → 결측 0 + mask 비트 → clip ±6. 모델 출력은 viewport-fraction 잔차. JS·Python 두 목록의 일치는 `tools/colab/tests/test_canonical.py` 가 node 실행으로 검증합니다.

## 7. Training record / split manifest / snapshot

- record (`nl-training-record-1`): `record_id session_id window_id subject_key subject_link_confidence created_at label_source label_role split_role features base{px,py,ax,ay,bx,by,mode,drift,fit} target{x,y,nx,ny,region,W,H} residual{dx,dy,dxFrac,dyFrac,contract} weight(창당 합 1) qc{inferredBackfill,uncertaintyMs,dwellConfidence,fineRefitInFit,…} versions{core,camera,schema,feature}`.
- split (`nl-split-manifest-1`): group key(subjectKey 가 모두 있으면 사람, 아니면 세션 — 주의 문구), train/val/locked_test/temporal_test/eval_only 의 그룹·세션·창·레코드 수, record/group 해시, **locked/temporal 접근 로그**.
- snapshot (`nl-dataset-snapshot-1`): 적격 세션 ID, payload SHA-256, annotation ID, raw 파일 해시, feature/exporter/policy/labels 버전, 수집 기간, 해시. 같은 해시 → `no_new_eligible_data`. 철회된 세션 목록 → 이전 스냅샷·모델 표시.

## 8. 모델 manifest (`nl-gaze-residual-manifest-1`) · registry (`nl-model-registry-1`)

manifest: id · version · parent · sha256 · bytes · contract · features · preprocessing{mean,std,mask,clip,version} · input/output(shape·dtype·units) · opset · supports{core,labelsVersion,eyeModes,browsers} · guard{zMax,maxCorrectionFrac,maxMissing} · tolerance · testVectors · training{commit,datasetSnapshot,splitManifest,environment,policyVersion} · evaluation · limitations · release{state,approvedBy,approvedAt,previousActive,rollbackTo} · signing(현재 unsigned · 전송 무결성만) · packageSha256.
registry: `active`/`shadow`/`candidates[]`/`history[]`. 브라우저는 검사 시작 시 1회 고정(`NLGazeModel.freeze`), 같은 출처의 `models/…` 경로만 허용, 해시·스키마·feature allowlist·버전 범위·테스트 벡터 검증 실패 시 fail-closed(기존 엔진).
