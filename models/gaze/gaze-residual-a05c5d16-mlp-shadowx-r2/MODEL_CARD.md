# Model card · gaze-residual-a05c5d16-mlp-shadowx-r2 v2026.10.10

- 종류: gaze-residual · 계약: `add-residual` · 출력 단위: viewport-fraction
- SHA-256: `2d434f626cb34808de95f08c2aa22bfc60c7149867ba1181314562c40ab4c141` · 크기 19730 bytes · opset 17
- 학습 commit: `674b963946acc70a87c36ac643a5337f773044d4` · 데이터셋 snapshot: `a05c5d1632214f00514ea72711d4c9ae54e8f158d23cbf5f328c5a32d67f2238` · split: `7177e5d0226eca924aa437180cc24a884be710d71f2745cbeae8297f91383e3c`
- 상태: **shadow-exception** (trained ≠ active · 승인 전)

## 평가 (표적 proxy 오차 · 외부 시선 추적기 정확도가 아님)
```json
{
  "val": {
    "split": "val",
    "n": 1862,
    "medianPx": 116.58554978520307,
    "meanPx": 157.4057356504754,
    "rmsePx": 217.585731707222,
    "p90Px": 286.5394294260294,
    "p95Px": 439.4173004612335,
    "biasXPx": -3.072241817219509,
    "biasYPx": 5.620821341490513,
    "medianPctW": 6.072164051312659,
    "windows": 156,
    "sessions": 6,
    "groups": 6,
    "byRegion": {
      "corner": {
        "n": 288,
        "medianPx": 158.10850300805558,
        "meanPx": 215.47906102501798,
        "rmsePx": 299.57474768100525,
        "p90Px": 523.7282287928265,
        "p95Px": 777.7659435462058,
        "biasXPx": -39.26556330749182,
        "biasYPx": -13.905215548593034,
        "medianPctW": 8.234817865002894
      },
      "periphery": {
        "n": 1433,
        "medianPx": 113.08519952639227,
        "meanPx": 148.9660440137943,
        "rmsePx": 203.50692587771914,
        "p90Px": 273.13002655530573,
        "p95Px": 391.2082554317624,
        "biasXPx": 2.401125664629035,
        "biasYPx": 7.930828861007075,
        "medianPctW": 5.889854141999598
      },
      "center": {
        "n": 141,
        "medianPx": 108.76766145396911,
        "meanPx": 125.65600126820128,
        "rmsePx": 147.73425687734994,
        "p90Px": 246.92331902833385,
        "p95Px": 266.828120983083,
        "biasXPx": 14.580726344839663,
        "biasYPx": 21.57281992649195,
        "medianPctW": 5.664982367394222
      }
    },
    "byLabelSource": {
      "calibration_target": {
        "n": 1862,
        "medianPx": 116.58554978520307,
        "meanPx": 157.4057356504754,
        "rmsePx": 217.585731707222,
        "p90Px": 286.5394294260294,
        "p95Px": 439.4173004612335,
        "biasXPx": -3.072241817219509,
        "biasYPx": 5.620821341490513,
        "medianPctW": 6.072164051312659
      }
    },
    "byEyeMode": {
      "both": {
        "n": 1862,
        "medianPx": 116.58554978520307,
        "meanPx": 157.4057356504754,
        "rmsePx": 217.585731707222,
        "p90Px": 286.5394294260294,
        "p95Px": 439.4173004612335,
        "biasXPx": -3.072241817219509,
        "biasYPx": 5.620821341490513,
        "medianPctW": 6.072164051312659
      }
    },
    "bySession": {
      "05cf7f85-cd21-4179-b9fb-cad8c2403759": {
        "n": 312,
        "medianPx": 83.39249265081907,
        "meanPx": 129.53817675601786,
        "rmsePx": 200.7504632229342,
        "p90Px": 237.49467545323932,
        "p95Px": 387.4300487156331,
        "biasXPx": -32.52727060515697,
        "biasYPx": -27.30886372341987,
        "medianPctW": 4.343358992230159
      },
      "2d453ce7-6300-4eeb-bd56-7348aee0659d": {
        "n": 307,
        "medianPx": 110.16836766575946,
        "meanPx": 148.79734608832607,
        "rmsePx": 206.53438964955836,
        "p90Px": 276.38096761264524,
        "p95Px": 429.3573738253468,
        "biasXPx": -28.4263964741981,
        "biasYPx": 4.6730987972172695,
        "medianPctW": 5.737935815924971
      },
      "35b1fef7-8cc8-4228-8fd0-edad6c348ea5": {
        "n": 312,
        "medianPx": 144.95584854038563,
        "meanPx": 173.90638120417435,
        "rmsePx": 226.00740670386105,
        "p90Px": 286.5394294260294,
        "p95Px": 454.1404287187367,
        "biasXPx": 74.4407356389862,
        "biasYPx": 55.50979394247137,
        "medianPctW": 7.549783778145085
      },
      "85d89765-15ca-415b-88ba-ee8633ee65af": {
        "n": 312,
        "medianPx": 132.06122543712436,
        "meanPx": 162.9138181224332,
        "rmsePx": 226.24243078102668,
        "p90Px": 245.30565728116377,
        "p95Px": 439.4173004612335,
        "biasXPx": -34.456430789339194,
        "biasYPx": -8.094484816614116,
        "medianPctW": 6.878188824850226
      },
      "930d17a2-f276-4d6d-8fcd-c08c58ccf2d7": {
        "n": 310,
        "medianPx": 109.38866696730233,
        "meanPx": 150.09253750917168,
        "rmsePx": 205.87706767074621,
        "p90Px": 269.12903521505893,
        "p95Px": 435.340784
```

## 한계
- Labels are target-proxy (intended fixation) and calibration targets; no external eye-tracker reference exists, so 'accuracy' here is target-proxy error.
- Errors are reported in CSS pixels and % of viewport width; viewing distance/physical screen size were not measured, so no degrees of visual angle.
- Saccade latency / pursuit lag accuracy improvements are unverified without an external dynamic gaze reference.
- Frames within a window are not independent; counts of windows/sessions/groups are reported alongside frames.
- reference_eyetracker labels: none.
- Some sessions lack a subject key: session-level split only; cross-person generalisation is not demonstrated.

## 지원 범위
- 특징: gaze-features-2.3 · core: ['In_mind core 2.3', 'In_mind core 2.4', 'In_mind core 2.5', 'In_mind core 2.6'] · 브라우저: ['chromium-desktop (tested)', 'others: unverified']

_정책 2026-10-08.2 · 생성 2026-10-10T13:42:36.256698+00:00_
