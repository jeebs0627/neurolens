# NeuroLens 정서 자유 보기 — 정서 사진 세트 제작 기준

newbiz.html 의 '정서 자유 보기' 검사가 쓰는 사진 세트입니다. `manifest.json` 에 아래 기준을 통과한 사진을
등록하면 검사가 자동으로 사진 모드로 바뀝니다. 장수가 부족하면 기존 도식 자극(얼굴 그림·단어)을 씁니다.

> 사진 210장 각각의 장면 정의 · AI 생성 프롬프트 · 중립 쌍둥이 · 검수 체크리스트는 **[PHOTO_SPEC.md](PHOTO_SPEC.md)** 에 있습니다.
> manifest 의 정서 사진 항목에 `twin`(중립 쌍둥이 id)을 적으면 검사가 그 쌍둥이를 우선 짝지어 보여 줍니다.

## 1. 몇 장이 필요한가

| 범주 | 1세트(A) | 재측정용(B) | 합계 | 근거 |
|---|---|---|---|---|
| 위협 (threat) | 12 | 12 | 24 | 불안은 위협 자극 주의 편향과 관련 (Armstrong & Olatunji, 2012) |
| 슬픔·상실 (dysphoric) | 12 | 12 | 24 | 우울은 슬픔 자극에 오래 머무는 경향과 관련 (Armstrong & Olatunji, 2012; Kellough et al., 2008) |
| 긍정 (positive) | 12 | 12 | 24 | 우울에서는 긍정 자극 주의가 줄어듦 — 편향의 반대 방향 확인 |
| 중립 (neutral) | 48 | 48 | 96 | 정서 사진 36장의 짝 + 중립-중립 기준 시행 6쌍(12장) |
| **합계** | **84** | **84** | **168** | |

- **제작 수량: 범주별 약 25% 여유분을 더해 약 210장**(위협 30 · 슬픔 30 · 긍정 30 · 중립 120)을 만든 뒤,
  아래 3단계 평정으로 168장을 고릅니다. AI 생성 이미지는 평정에서 탈락하는 비율이 높습니다.
- **범주당 12장인 이유**: 자유 보기의 체류 시간 지표는 dot-probe 반응시간보다 신뢰도가 높게 보고됩니다
  (Waechter et al., 2014). 범주당 12시행(위협+슬픔 24 · 긍정 12 · 중립 6, 1시행 4초)이면 표준 측정 안에서
  약 3.3분으로, 피로 없이 범주별 평균을 안정적으로 낼 수 있는 실용적 하한입니다. 빠른 측정은 범주당 6장만 씁니다.
- **A·B 두 세트인 이유**: 같은 사진을 반복해서 보면 습관화로 편향이 줄어듭니다. 재측정(2~4주 후 케어 효과
  확인)에는 정서가·각성가가 맞춰진 다른 세트를 번갈아 씁니다.

## 2. 범주별 내용 (사진 한 장에 한 가지 장면)

내용 유형(`content`)을 정서 사진과 중립 사진이 똑같이 갖도록 만드는 것이 가장 중요합니다. 사람 사진 옆에
풍경이 나오면, 정서가 아니라 '사람이라서' 시선이 갑니다. 그래서 검사는 정서 사진마다 같은 `content` 의
중립 사진을 짝지어 보여 줍니다.

| content | 위협 (각 범주 12장 중) | 슬픔·상실 | 긍정 | 중립 (짝) |
|---|---|---|---|---|
| `person` (5) | 화난 표정으로 노려보는 사람, 위협적으로 다가오는 사람 | 우는 사람, 홀로 웅크린 사람, 병상의 노인 | 활짝 웃는 사람, 함께 웃는 친구·가족 | 무표정으로 일상 행동을 하는 사람 |
| `animal` (2) | 이빨을 드러낸 개, 뱀 | 다친·버려진 동물 | 강아지·아기 고양이 | 풀 뜯는 소, 앉아 있는 비둘기 |
| `scene` (3) | 어두운 골목의 그림자, 화재 연기, 급류 | 장례식장, 텅 빈 폐허가 된 집, 비 오는 묘지 | 햇살 비치는 해변, 축하 파티 | 평범한 사무실, 주차장, 복도 |
| `object` (2) | 겨눈 칼끝, 깨진 유리 | 깨진 액자 속 가족사진, 시든 꽃다발 | 생일 케이크, 선물 상자 | 의자, 컵, 책상 위 서류 |

**강도 한계 (웰니스 서비스 기준)**: 유혈·상해·시신·성적 장면·실제 사건 재현은 넣지 않습니다. IAPS의 고강도
상해 사진 수준이 아니라 '일상에서 마주칠 수 있는 불쾌함' 수준(정서가 2.5~3.5)으로 맞춥니다.

## 3. 생성 규격 (모든 사진 공통)

- 4:3 가로, 1024×768 이상, JPG/WebP, 사진처럼 사실적인 스타일 하나로 통일 (일러스트·만화 금지)
- 글자·로고·워터마크·숫자 없음 (글자는 읽느라 시선이 감)
- 주요 대상은 가운데, 화면의 30~60% 크기 — 정서 사진과 중립 사진의 구도·크기를 비슷하게
- **평균 밝기·대비·채도를 범주 간 맞추기**: rPPG(얼굴 피부색으로 심박 측정)가 화면 밝기 변화에 민감하고,
  밝거나 선명한 사진은 정서와 무관하게 시선을 끕니다. 생성 후 평균 휘도(0~255)가 110~150 안에 오도록
  보정하고, 범주별 평균 휘도 차이는 ±5 이내로 맞춥니다.
- 인물은 한국 성인 중심, 성별·연령 균형. 실존 인물을 닮지 않게, 유명인 금지
- AI 생성 결함(손가락·눈·치아 왜곡, 녹은 배경) 있는 사진은 탈락 — 결함은 그 자체로 시선을 끄는 자극입니다

## 4. 선별 절차 (생성 → 평정 → 확정)

1. **결함 검수** — 2인이 독립적으로 AI 결함, 의도와 다른 내용을 걸러냅니다.
2. **정서 평정** — 사진 한 장당 최소 20명(가능하면 30명 이상)이 자기평가 마네킹(SAM) 9점 척도로
   정서가(불쾌–유쾌)와 각성가(차분–흥분)를 평정합니다 (Bradley & Lang, 1994; OASIS: Kurdi et al., 2017;
   NAPS: Marchewka et al., 2014 방식).
3. **선정 기준**

   | 범주 | 정서가 (1~9) | 각성가 (1~9) |
   |---|---|---|
   | 위협 | ≤ 3.5 | ≥ 5.5 |
   | 슬픔·상실 | ≤ 3.5 | 3.5 ~ 5.5 (위협보다 낮게) |
   | 긍정 | ≥ 6.5 | 4.5 ~ 6.5 |
   | 중립 | 4.5 ~ 5.5 | ≤ 3.5 |

   A·B 세트는 범주별 정서가·각성가·휘도 평균이 통계적으로 차이 없게 나눕니다.
4. **사전 검증 (파일럿)** — 20명 이상에게 웹캠으로 검사를 실시해, 중립-중립 쌍의 좌우 응시가 50%에 가깝고
   (사진 자체의 쏠림 없음) 범주별 편향의 반분 신뢰도를 확인합니다.

## 5. manifest.json 형식

```json
{
  "version": 1,
  "form": "A",
  "images": [
    { "id": "THR-P-01", "file": "A/thr_person_01.jpg", "category": "threat", "content": "person", "valence": 2.9, "arousal": 6.4, "luminance": 128 },
    { "id": "NEU-P-01", "file": "A/neu_person_01.jpg", "category": "neutral", "content": "person", "valence": 5.1, "arousal": 2.6, "luminance": 131 }
  ]
}
```

- `category`: `threat` · `dysphoric` · `positive` · `neutral`
- `content`: `person` · `animal` · `scene` · `object`
- `file`: 이 폴더 기준 경로 · `exclude: true` 로 임시 제외 가능
- 검사에 필요한 최소 수량 — 표준 측정(약 8분, 기본): 위협 4 · 슬픔 4 · 긍정 4 · 중립 18 / 정밀 측정: 위협 12 · 슬픔 12 · 긍정 12 · 중립 48

## 참고문헌

- Armstrong T, Olatunji BO. Eye tracking of attention in anxiety and depression: a meta-analytic review and synthesis. Clin Psychol Rev. 2012;32(8):704–723.
- Bradley MM, Lang PJ. Measuring emotion: the Self-Assessment Manikin and the semantic differential. J Behav Ther Exp Psychiatry. 1994;25(1):49–59.
- Kellough JL, Beevers CG, Ellis AJ, Wells TT. Time course of selective attention in clinically depressed young adults: an eye tracking study. Behav Res Ther. 2008;46(11):1238–1243.
- Kurdi B, Lozano S, Banaji MR. Introducing the Open Affective Standardized Image Set (OASIS). Behav Res Methods. 2017;49(2):457–470.
- Marchewka A, Żurawski Ł, Jednoróg K, Grabowska A. The Nencki Affective Picture System (NAPS). Behav Res Methods. 2014;46(2):596–610.
- Waechter S, Nelson AL, Wright C, Hyatt A, Oakman J. Measuring attentional bias to threat: reliability of dot probe and eye movement indices. Cognit Ther Res. 2014;38(3):313–333.

## 6. 안정 기준선 풍경 사진 (선택)

안정 기준선 단계의 배경은 기본으로 그림 풍경(SVG)을 쓰고, `manifest.json` 에 아래처럼 사진을 등록하면 그중 하나를 무작위로 씁니다.

```json
{ "version": 1, "form": "A", "baseline": ["calm/lake_01.jpg", "calm/forest_01.jpg"], "images": [] }
```

일반 풍경 사진을 써도 됩니다. 다만 기준선은 ‘아무 자극 없이 쉬는 상태’를 재는 단계라 아래 조건을 지켜 주세요 (바닐라 기준선: Jennings et al., 1992; 수중 영상 기준선: Piferi et al., 2000).

| 조건 | 이유 |
|---|---|
| 잔잔한 자연 풍경 (호수·숲·들판·하늘·잔잔한 바다) | 정서가 중립~약간 긍정이어야 심박이 오르지 않음 |
| 사람·동물·얼굴·글자·로고 없음 | 시선과 주의를 끄는 요소는 기준선을 오염시킴 |
| 강한 대비·원색·번쩍이는 빛 반사 피하기 | 화면 밝기 변화가 카메라 심박(rPPG)에 섞임 |
| 가로 16:9 이상, 1920×1080 이상, JPG 85% · 1MB 이하 | 전체 화면을 채우고 빠르게 불러오기 위해 |
| 저작권: 직접 촬영·상업 이용 가능한 라이선스(Unsplash 등)·AI 생성 | 서비스에 쓰이므로 |

코드가 사진의 평균 밝기를 재서 측정 화면과 비슷한 밝기(목표 185/255, 0.7~1.6배 범위)로 자동 보정하고, 채도와 대비를 조금 낮추며, 기준선 시간 동안 아주 천천히(5%) 확대해 정지 화면의 지루함을 줄입니다. 사진을 불러오지 못하면 그림 풍경으로 대신합니다.
