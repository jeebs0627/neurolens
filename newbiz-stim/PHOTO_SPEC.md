# NeuroLens 정서 자유 보기 — AI 정서 사진 제작 명세서 (PHOTO_SPEC)

> 이 문서는 `newbiz-stim/README.md`(선정·평정 기준)를 실제 사진 210장으로 옮기기 위한 **제작 명세**입니다.
> 범주별 수량·SAM 선정 기준·manifest 형식의 최종 기준은 언제나 **README.md** 이며, 두 문서가 어긋나면 README를 따릅니다.

---

## 1. 목적과 사용법

### 1.1 이 문서는 무엇인가
- newbiz.html 의 '정서 자유 보기' 검사는 정서 사진(위협·슬픔·긍정) 한 장과 **같은 `content`(person/animal/scene/object)의 중립 사진** 한 장을 좌우에 나란히 4초 동안 보여 주고, 어느 쪽에 시선이 머무는지를 잽니다. 중립–중립 쌍(역시 같은 `content`끼리)은 사진 자체의 좌우 쏠림을 확인하는 기준 시행으로 씁니다.
- 따라서 사진은 "정서 단서 하나만 다르고 나머지(구도·크기·밝기·내용 유형)는 같게" 만들어야 합니다. 이 문서는 그 210장 각각의 장면, 생성 프롬프트, 중립 쌍둥이를 정의합니다.

### 1.2 누가 어떻게 쓰나
| 역할 | 이 문서에서 볼 곳 |
|---|---|
| AI 생성 담당 | 2장(공통 지침·마스터 프롬프트) → 4장(사진별 프롬프트)을 그대로 복사해 생성 |
| 검수자 2인 | 2.6 결함 체크리스트, 5.3 사진별 QA 체크리스트, 5.4 탈락 코드 |
| 연구 담당 | 3장(범주 정의), 5장(평정·A/B 균형·manifest 등록·파일럿) |

### 1.3 ID·파일 이름 규칙
| 구분 | ID 형식 | 파일 경로 | 예 |
|---|---|---|---|
| 정서 사진 | `{THR\|DYS\|POS}-{P\|A\|S\|O}-{nn}` | `{세트}/{thr\|dys\|pos}_{person\|animal\|scene\|object}_{nn}.jpg` | `THR-P-01` → `A/thr_person_01.jpg` |
| 중립 쌍둥이 | `NEU-{P\|A\|S\|O}-{k}{nn}` (k: 0=위협 쌍, 1=슬픔 쌍, 2=긍정 쌍) | `{세트}/neu_{content}_{k}{nn}.jpg` | `DYS-A-02` 의 쌍둥이 → `NEU-A-102` → `A/neu_animal_102.jpg` |
| 중립 채움(filler) | `NEU-{P\|A\|S\|O}-3{nn}` | `{세트}/neu_{content}_3{nn}.jpg` | `NEU-S-305` → `B/neu_scene_305.jpg` |

- 번호 `nn` 은 **세트를 넘어 이어 붙여** ID가 전체에서 유일하도록 합니다. 세트 A = 앞 번호, 세트 B = 뒷 번호.
  - person: A 01–06 / B 07–12 · animal: A 01–03 / B 04–06 · scene: A 01–04 / B 05–08 · object: A 01–02 / B 03–04
- 쌍둥이 번호는 정서 사진 번호를 그대로 물려받습니다 (`THR-S-06` ↔ `NEU-S-006`, `POS-P-11` ↔ `NEU-P-211`). README 예시의 `NEU-P-01` 은 이 문서에서 `NEU-P-001` 로 씁니다(세 자리).
- `S`는 scene, `O`는 object 입니다. 파일명은 소문자·밑줄만 씁니다.

### 1.4 manifest.json 과의 연결
- 검사는 `newbiz-stim/manifest.json` 한 개를 읽고(`loadStimuli`), `exclude: true` 가 아닌 사진을 범주별로 모읍니다. manifest 한 개 = 한 세트(`"form": "A"`)입니다. 세트 B 는 `manifest.B.json` 으로 보관했다가 재측정 시 `manifest.json` 으로 교체합니다 (운영 가정 — 6장 참고).
- `buildPhotoTrials` 는 정서 사진마다 짝을 이렇게 고릅니다: ① manifest 의 `twin` 필드에 적힌 중립 쌍둥이(아직 안 쓴 경우) → ② 같은 `content` 의 아직 안 쓴 중립 사진 → ③ 아무 중립 사진. 따라서 `twin` 을 적어 두면 쌍둥이가 실제로 나란히 제시되어 구도·밝기·색 같은 저수준 특성이 가장 잘 맞습니다. 정서 사진 쪽에만 `twin` 을 적으면 되고, 중립 쪽의 `twin` 은 추적용입니다.
- 중립–중립 시행은 첫 장을 아무 중립에서, 둘째 장을 같은 `content` 에서 고릅니다. 그래서 세트당 최종 중립 48장은 content별로 **person 20 · animal 8 · scene 12 · object 8** 이상을 권장합니다(정서 사진 content 수 + 여유).

---

## 2. 공통 AI 작업 지침

### 2.1 마스터 스타일 프롬프트 `[STYLE]`
4장의 모든 프롬프트 앞에 아래 문장을 붙입니다. 4장에서는 `[STYLE]` 로 줄여 씁니다.

```text
Photorealistic documentary-style photograph of everyday life in contemporary South Korea, shot on a full-frame camera with a 35mm lens at eye level, natural soft diffused light, moderate contrast, natural moderately saturated colours, realistic textures and skin, sharp focus on the main subject, the main subject centred and filling about 40-50% of the frame, simple uncluttered background, 4:3 landscape composition, no text, no signage, no logos, no watermark.
```

**설명 (한국어)**
- *다큐멘터리 사진*: 광고·스톡 사진의 과장된 연출을 피하고 실제 생활 장면처럼 보이게 합니다.
- *35mm, 눈높이*: 원근 왜곡·위압적 앵글(로우앵글)·내려다보는 앵글(하이앵글)이 정서를 더하지 않도록 고정합니다.
- *부드러운 확산광, 중간 대비·채도*: 조명·색으로 분위기를 만들지 않습니다. 정서는 오직 장면 속 단서 하나로만 전달합니다.
- *가운데, 화면 40–50%*: 허용 범위 30–60% 안에서 목표값을 하나로 고정해 쌍둥이·세트 간 크기 차이를 줄입니다.
- *글자·간판·로고 없음*: 글자는 읽느라 시선을 끕니다.

**도구별 붙이는 법**
| 도구 | 방법 |
|---|---|
| Midjourney (v6 이상) | 프롬프트 끝에 `--ar 4:3 --style raw --stylize 50 --no text, letters, logo, watermark, illustration` (부정 프롬프트 핵심어만) |
| SDXL / Flux (ComfyUI 등) | 1216×912 또는 1152×864 로 생성(4:3), 2.2의 부정 프롬프트를 negative 칸에. CFG·sampler·seed 를 생성 로그에 기록 |
| GPT-image 등 부정 칸 없는 도구 | 프롬프트 끝에 `Avoid: ` + 2.2 목록의 핵심어를 문장으로 덧붙임 |

### 2.2 공통 부정 프롬프트
```text
text, letters, numbers, signage, logo, brand, watermark, caption, border, frame, collage, illustration, cartoon, anime, 3d render, CGI, painting, oversaturated, HDR, neon, dramatic rim light, strong vignette, lens flare, bokeh balls, low angle, high angle, dutch angle, fisheye, motion blur, extra fingers, fused fingers, deformed hands, extra limbs, missing limbs, distorted face, asymmetric eyes, cross-eyed, deformed teeth, melted background, warped architecture, duplicated objects, blood, gore, wound, injury, bruise, corpse, nudity, sexual content, weapon touching a person, child crying, celebrity, famous person, real public figure
```

### 2.3 기술 규격
| 항목 | 규격 |
|---|---|
| 비율·크기 | 4:3 가로, 최종 **1024×768 이상** (권장 1280×960) |
| 스타일 | 사진처럼 사실적인 단일 스타일. 일러스트·만화·3D 렌더 금지 |
| 글자 | 글자·숫자·로고·워터마크·간판·화면 속 글씨 없음 (배경의 흐릿한 글자 흔적도 탈락) |
| 구도 | 주요 대상 **가운데**, 화면 면적의 **30–60%** (목표 40–50%) |
| 카메라 | **눈높이**, 35mm 상당, 기울기 없음 |
| 조명 | 자연스러운 부드러운 빛. 극적 역광·스포트라이트·강한 그림자 금지 |
| 밝기 | 평균 휘도(0–255) **110–150**, 범주별 평균 차이 **±5 이내** (README 기준) |
| 대비·채도 (권장) | 휘도 표준편차(RMS 대비) 45–65, HSV 평균 채도 0.20–0.45 — 범주 간 평균이 비슷하게 |
| 인물 | **한국인 성인**, 성별 균형(범주·세트마다 남녀 3:3), 연령 20대–60대 고르게. 유명인·실존 인물 닮음 금지 |
| 아동 | 긍정 장면의 보조 인물로만 허용(조부모와 손주 등). 괴로워하는 아동은 금지 |

### 2.4 강도 한계 (웰니스 서비스 기준)
부정 사진은 **'일상에서 마주칠 수 있는 불쾌함'**, 목표 정서가 **2.5–3.5** 입니다. IAPS 고강도 상해 사진 수준은 쓰지 않습니다.

**금지**: 피·상처·멍·시신·장례식의 실제 유해·성적 장면·실제 재난/사건 재현(특정 참사·전쟁·테러를 떠올리게 하는 장면)·사람에게 실제로 사용되는 무기(찌르기·때리기 순간)·고통받는 아동·자해 암시·동물 학대 장면.

**허용**: 위협 '신호'(노려봄, 이빨 드러냄, 칼끝이 카메라를 향함, 연기, 급류) — 해를 입는 순간이나 결과는 보이지 않게.

### 2.5 쌍둥이(twin) 원칙
모든 정서 사진은 **같은 내용 유형의 중립 쌍둥이**를 하나씩 갖습니다. 쌍둥이는 정서 단서 **하나만** 빼고 나머지를 최대한 같게 만듭니다.

1. **같은 시드·구도·인물·장소·옷·조명**: 가장 좋은 방법은 정서 사진을 만든 뒤, 정서 단서 영역만 마스크로 지정해 **인페인팅/부분 편집**(denoise 0.35–0.55)하는 것입니다. 다시 생성해야 한다면 같은 seed, 같은 프롬프트에서 단서 표현만 바꿉니다.
2. **바꾸는 것**: 표정 → 무표정(편안한 중립 얼굴), 위협 요소 → 무해한 대응물(연기 → 맑은 공기, 칼 → 나무 주걱, 그림자 인물 → 아무도 없음), 슬픔 단서 → 일상 행동, 긍정 단서 → 평범한 대응물(케이크 → 식빵).
3. **유지하는 것**: 대상 크기·위치, **시선 방향**(정면 응시 사진의 쌍둥이도 정면 응시 — 눈맞춤 자체가 시선을 끄는 변수이므로), 색조, 배경 복잡도.
4. **동물 예외**: 뱀·말벌·멧돼지처럼 종 자체가 단서인 경우, 또는 강아지·아기 고양이처럼 '귀여움'이 단서인 경우에는 같은 종의 중립화가 불가능합니다. 이때는 **같은 배경·같은 자세·비슷한 크기와 색**의 정서적으로 밋밋한 동물(비둘기·참새·닭·소·고라니·오리 등)로 바꿉니다.
5. 쌍둥이도 중립 기준(정서가 4.5–5.5, 각성가 ≤ 3.5)을 통과해야 합니다. 정서 사진이 탈락해도 쌍둥이는 중립 풀에 남을 수 있고, 쌍둥이가 탈락하면 쌍둥이만 다시 만듭니다.
6. 휘도 보정 후 쌍둥이와 원본의 평균 휘도 차이는 **±8 이내**를 권장합니다.

### 2.6 AI 결함 체크리스트 (하나라도 있으면 탈락 또는 재생성)
- [ ] 손: 손가락 개수·관절·겹침 이상 (가능하면 손이 화면에 크게 나오지 않게 구성)
- [ ] 치아: 개수·모양 이상, 이가 한 덩어리로 붙음 (특히 웃음·이빨 드러낸 개)
- [ ] 눈: 좌우 비대칭, 동공 모양 이상, 시선 불일치, 홍채 번짐
- [ ] 얼굴: 피부가 지나치게 매끈한 '플라스틱' 질감, 귀·머리카락 경계 녹음
- [ ] 사지·몸: 팔다리 개수·방향 이상, 몸과 사물이 붙음
- [ ] 배경: 녹아내린 건물·가구, 휘어진 직선, 반복 패턴 복제
- [ ] 글자 흔적: 간판·포장·화면·옷의 가짜 글자, 숫자 비슷한 무늬
- [ ] 동물: 다리·발가락 개수, 꼬리 위치, 털과 배경 경계
- [ ] 실존 인물·유명인을 닮음

### 2.7 후처리 절차
1. **자르기**: 4:3 유지, 주요 대상이 가운데·30–60% 가 되도록. 1280×960 (최소 1024×768) 으로 리사이즈(Lanczos).
2. **휘도·대비 정규화** (사진마다 → 범주별 확인):
   - 휘도 L = 0.299R + 0.587G + 0.114B (sRGB 0–255) 로 평균(M)과 표준편차(SD)를 잽니다.
   - 목표 M = 130, SD = 55 에 가깝게 맞추되, 사진이 부자연스러워지면 M 110–150 / SD 45–65 안에서 멈춥니다. 방법: 레벨/커브 조정 또는 선형 변환 `L' = (L − M)·(SD_t/SD) + M_t` 를 휘도 채널(Lab의 L* 또는 YCbCr의 Y)에만 적용해 색상은 유지.
   - 채도: HSV 평균 채도가 0.45 를 넘으면 낮춥니다.
   - 범주별(위협·슬픔·긍정·중립) 평균 휘도 차이가 ±5 를 넘으면, 바깥쪽 사진부터 다시 조정합니다.
3. **내보내기**: JPG 품질 **85**, **sRGB**, 크로마 서브샘플링 4:2:0, 메타데이터(EXIF·XMP·생성 도구 정보) **제거**. 파일 크기 목표 300 KB 이하(웹캠 검사 중 미리 불러오기 6초 제한).
4. 측정값(M, SD, 채도)을 생성 로그에 기록하고, 확정 후 M 을 manifest 의 `luminance` 에 적습니다.

참고 스크립트 (Python, Pillow + NumPy):
```python
from PIL import Image
import numpy as np
def stats(path):
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)
    L = 0.299*a[...,0] + 0.587*a[...,1] + 0.114*a[...,2]
    hsv = np.asarray(Image.open(path).convert('HSV'), dtype=np.float32)
    return round(L.mean(), 1), round(L.std(), 1), round(hsv[...,1].mean()/255, 3)
def normalize(src, dst, m_t=130, sd_t=55):
    ycc = np.asarray(Image.open(src).convert('YCbCr'), dtype=np.float32)
    Y = ycc[...,0]; ycc[...,0] = np.clip((Y - Y.mean()) * (sd_t / Y.std()) + m_t, 0, 255)
    Image.fromarray(ycc.astype(np.uint8), 'YCbCr').convert('RGB').save(dst, 'JPEG', quality=85)  # EXIF 미포함
```

### 2.8 생성 로그
사진마다 한 줄: `id, file, tool, model/version, seed, prompt, negative, 편집 방법(인페인팅 여부), 생성일, 담당자, M, SD, 채도, 결함 검수 결과, 탈락 코드`. 쌍둥이는 원본 ID 와 편집 방법을 함께 적습니다. 상업적 사용 근거(6장)를 증빙하는 기록이기도 합니다.

---

## 3. 범주 정의

| 범주 | 목표 정서가 (SAM 1–9) | 목표 각성가 | 반드시 있어야 할 단서 | 없어야 할 것 |
|---|---|---|---|---|
| 위협 `threat` | ≤ 3.5 (제작 목표 2.6–3.4) | ≥ 5.5 (목표 5.8–6.8) | **보는 사람에게 다가올 수 있는 위험 신호** 하나: 분노한 얼굴의 정면 응시, 공격 자세의 동물, 카메라를 향한 날, 불·연기·급류, 어둠 속 낯선 사람 | 피·상처·피해자, 혐오 요소(구더기·오물·부패), 슬픔 표정 |
| 슬픔·상실 `dysphoric` | ≤ 3.5 (목표 2.8–3.4) | 3.5–5.5, 위협보다 낮게 (목표 4.0–5.0) | **잃음·외로움·버려짐** 단서 하나: 우는/고개 숙인 혼자인 사람, 병상, 장례 꽃, 버려진 동물, 빈 자리·빈 집, 부서진 추억의 물건 | 위험·공격 단서(화난 얼굴, 어둠 속 인물), 극단적 절망(자해·시신), 아동의 고통 |
| 긍정 `positive` | ≥ 6.5 (목표 7.0–7.8) | 4.5–6.5 (목표 5.0–6.2) | **기쁨·유대·축하·귀여움** 단서 하나: 진짜 웃음(눈가 주름), 함께 웃는 사람들, 새끼 동물의 놀이, 축하 물건, 맑고 아름다운 풍경 | 성적 매력 강조, 사치·과시, 광고 같은 정지된 미소 |
| 중립 `neutral` | 4.5–5.5 | ≤ 3.5 | 평범한 일상 장면·사물, 무표정(편안한) 얼굴, 아무 일도 일어나지 않음 | 분위기를 만드는 조명·색(어둑함, 노을빛, 차가운 청색), 귀여운 동물, 미소, 고독을 암시하는 빈 공간 |

### 3.1 범주별 흔한 실패와 대처
**위협**
- *혐오로 흐름*: 뱀·말벌이 징그러운 접사가 되면 혐오(disgust)가 됩니다 → 몸 전체가 보이는 거리, 공격 자세(머리 들기, 날개 펼침)로 '위험'을 강조.
- *폭력 결과로 흐름*: 칼 사진에 피·상처가 생기거나 사람에게 닿으면 탈락 → 칼끝은 카메라만 향하고 사람 몸에는 닿지 않음.
- *실제 재난 연상*: 홍수·화재가 특정 참사(지하차도·이태원 등)를 떠올리게 하면 탈락 → 장소를 특정할 수 있는 구조물·간판·상황 배제.
- *각성 부족*: 화난 표정이 너무 약하면 '언짢음'(정서가 4점대, 각성 4점대) → 정면 응시 + 미간·턱 긴장 + 상체를 앞으로.

**슬픔·상실**
- *위협으로 흐름*: 어두운 병원 복도, 비 오는 밤 골목은 '무서움'이 됩니다 → 낮의 회색 빛, 열린 공간, 인물이 위험하지 않음을 분명히.
- *각성 과다*: 오열·절규는 각성이 6을 넘어 위협과 섞입니다 → 조용한 울음, 고개 숙임, 혼자 앉음.
- *강도 초과*: 영정 사진·관·실제 시신 금지 → 국화, 빈 의자, 상복 정도로.
- *중립과의 구분 부족*: 그냥 '혼자 있는 사람'은 중립이 됩니다 → 눈물·고개 숙임·빈 자리 같은 단서가 한눈에 보여야 함.

**긍정**
- *스톡 사진화(각성 부족)*: 카메라를 보고 정지한 미소는 정서가 6점대·각성 3점대 → 실제 웃음(눈가 주름, 입 벌림), 움직임, 사람 간 상호작용.
- *성적 매력·사치*: 수영복, 명품, 고급 차는 정서 대신 다른 동기(성·물질)를 자극 → 배제.
- *과도한 색*: 노을·쨍한 하늘은 채도·휘도 때문에 시선을 끔 → 채도 상한 지키기.

**중립**
- *조명·색으로 분위기*: 어둑하거나 푸르스름하면 '쓸쓸함', 따뜻한 노을빛이면 '포근함'이 됩니다 → 낮의 균일한 흰 빛.
- *빈 공간의 고독감*: 텅 빈 넓은 공간은 슬픔으로 평정되기도 함 → 사물·사람의 평범한 활동으로 채움.
- *귀여운 동물*: 강아지·고양이는 긍정으로 평정됨 → 소·비둘기·닭·참새·오리 등.
- *무표정이 차갑게 보임*: '무표정'이 화남·슬픔으로 읽히지 않게 입꼬리·미간을 편안하게 (`relaxed neutral expression, calm`).

---

## 4. 사진별 명세

### 4.0 수량 요약
| 범주 | 세트 A | 세트 B | 합계 | 세트당 content (person·animal·scene·object) |
|---|---|---|---|---|
| 위협 `THR` | 15 | 15 | **30** | 6 · 3 · 4 · 2 |
| 슬픔·상실 `DYS` | 15 | 15 | **30** | 6 · 3 · 4 · 2 |
| 긍정 `POS` | 15 | 15 | **30** | 6 · 3 · 4 · 2 |
| 중립 쌍둥이 `NEU-x-0nn/1nn/2nn` | 45 | 45 | **90** | 18 · 9 · 12 · 6 |
| 중립 채움 `NEU-x-3nn` | 15 | 15 | **30** | 6 · 3 · 4 · 2 |
| **합계** | **105** | **105** | **210** | 중립 소계 120 (A 60 · B 60) |

- 평정 후 세트마다 **위협 12 · 슬픔 12 · 긍정 12 · 중립 48 = 84장**(README)을 고릅니다. 정서 사진 15 → 12 선택 시 content 는 README 비율 **5·2·3·2** 를 맞춥니다(person·animal·scene 에서 1장씩 여유, object 는 여유 없음 → object 탈락 시 재생성).
- 중립 60 → 48 선택 시 content 는 person 20 · animal 8 · scene 12 · object 8 이상(1.4 참고).
- A·B 는 장면 유형이 평행(같은 종류의 단서)하지만 사람·장소·사물은 서로 다릅니다.
- 모든 쌍둥이의 목표는 **정서가 5.0 / 각성가 ≤ 3.0** 이므로 항목마다 다시 적지 않습니다.
- 프롬프트의 `[STYLE]` 은 2.1의 마스터 스타일 프롬프트, 쌍둥이의 `Δ` 는 원본에서 바꿀 내용(같은 seed·구도 기준 편집 지시)입니다.

---

### 4.1 위협 (THR) — 30장 + 쌍둥이 30장

#### 세트 A

**THR-P-01** · A · person · 목표 V 3.0 / A 6.2
- 장면: 사무실 복도에서 40대 남성이 카메라를 정면으로 노려본다.
- 단서: 찌푸린 미간·좁힌 눈·악문 턱의 분노 표정 + 정면 응시
- Prompt: `[STYLE] A Korean man in his 40s wearing a white dress shirt stands in a plain office corridor, glaring straight into the camera with furrowed brows, narrowed eyes and a clenched jaw, head slightly lowered, upper-body shot.`
- 쌍둥이 **NEU-P-001**: 같은 남성이 같은 복도에서 편안한 무표정으로 카메라를 본다. Δ `Same seed, person, shirt, corridor and framing; relaxed neutral expression, brows and jaw relaxed, still looking at the camera.`

**THR-P-02** · A · person · 목표 V 3.0 / A 6.4
- 장면: 아파트 거실에서 30대 여성이 카메라를 향해 손가락질하며 소리친다.
- 단서: 크게 벌린 입·치켜뜬 눈의 분노 + 카메라를 향한 검지
- Prompt: `[STYLE] A Korean woman in her 30s in a grey cardigan in an apartment living room, shouting angrily toward the camera, mouth open, eyes wide and brows drawn together, pointing her index finger at the camera at chest height, upper-body shot.`
- 쌍둥이 **NEU-P-002**: 같은 여성이 같은 거실에서 무표정으로 TV 리모컨을 가슴 높이로 들고 있다. Δ `Same seed, person, outfit, room and framing; closed mouth, relaxed neutral face looking at the camera, holding a TV remote at chest height instead of pointing.`

**THR-P-03** · A · person · 목표 V 2.8 / A 6.6
- 장면: 지하 주차장에서 20대 남성이 주먹을 쥐고 카메라 쪽으로 빠르게 다가온다.
- 단서: 앞으로 쏠린 상체·쥔 주먹·정면 응시의 접근 자세
- Prompt: `[STYLE] A Korean man in his 20s in a dark hoodie striding quickly toward the camera in an evenly lit underground parking garage, fists clenched at his sides, upper body leaning forward, hostile stare at the camera, full-body shot from knees up.`
- 쌍둥이 **NEU-P-003**: 같은 남성이 같은 주차장에서 차 열쇠를 들고 천천히 걸어간다. Δ `Same seed, person, hoodie, garage and framing; upright relaxed posture, walking slowly, holding a car key loosely, neutral face looking toward the camera.`

**THR-P-04** · A · person · 목표 V 3.1 / A 6.2
- 장면: 회의실에서 50대 남성이 책상을 내리치며 카메라 쪽으로 몸을 숙인다.
- 단서: 탁자를 내리친 주먹 + 몸을 기울인 분노 표정
- Prompt: `[STYLE] A Korean man in his 50s in a navy suit in a small meeting room, slamming his fist on the table and leaning toward the camera, angry expression with bared lower teeth and furrowed brows, waist-up shot, table edge at the bottom of the frame.`
- 쌍둥이 **NEU-P-004**: 같은 남성이 두 손을 탁자에 편히 올리고 서류를 본다. Δ `Same seed, person, suit, room and framing; sitting upright, both palms resting flat on the table beside a sheet of paper, relaxed neutral face looking at the camera.`

**THR-P-05** · A · person · 목표 V 3.2 / A 5.8
- 장면: 밤 버스 정류장에서 60대 남성이 가까이 서서 적대적으로 노려본다.
- 단서: 가까운 거리 + 적대적 응시
- Prompt: `[STYLE] A Korean man in his 60s in a beige jacket standing close to the camera at a lit bus shelter in the evening, staring hostilely into the camera, brows lowered, lips pressed tight, chin pushed forward, head-and-shoulders shot, softly lit by the shelter light.`
- 쌍둥이 **NEU-P-005**: 같은 남성이 같은 정류장에서 무표정으로 서 있다. Δ `Same seed, person, jacket, bus shelter, lighting and framing; calm relaxed neutral expression, chin level, looking at the camera.`

**THR-P-06** · A · person · 목표 V 3.3 / A 5.7
- 장면: 40대 여성이 팔짱을 끼고 현관문을 막아선 채 노려본다.
- 단서: 막아선 자세 + 경멸·분노 섞인 응시
- Prompt: `[STYLE] A Korean woman in her 40s standing in the doorway of an apartment entrance, arms crossed, blocking the door, glaring at the camera with narrowed eyes and tightened lips, waist-up shot.`
- 쌍둥이 **NEU-P-006**: 같은 여성이 같은 현관에서 머그컵을 들고 무표정으로 서 있다. Δ `Same seed, person, outfit, doorway and framing; arms uncrossed holding a plain white mug at waist height, relaxed neutral face looking at the camera.`

**THR-A-01** · A · animal · 목표 V 2.8 / A 6.6
- 장면: 마당에서 큰 개가 이빨을 드러내고 으르렁거린다.
- 단서: 드러낸 이빨·주름진 콧등·낮춘 머리
- Prompt: `[STYLE] A large black-and-tan German shepherd in a fenced dirt yard, snarling at the camera with bared teeth, wrinkled muzzle, ears pinned back, head lowered, front-facing, whole dog visible.`
- 쌍둥이 **NEU-A-001**: 같은 개가 같은 마당에 입을 다물고 편히 엎드려 있다. Δ `Same seed, dog, yard and framing; lying down calmly, mouth closed, ears relaxed, looking toward the camera.`

**THR-A-02** · A · animal · 목표 V 2.7 / A 6.5
- 장면: 숲길 바위 위에서 뱀이 몸을 말고 머리를 들어 공격 자세를 취한다.
- 단서: S자로 세운 목·벌린 입 (공격 직전)
- Prompt: `[STYLE] A brown patterned viper coiled on a flat rock beside a forest trail, head raised in an S-shaped striking pose facing the camera, mouth slightly open, whole snake visible, mid-distance, leaf litter around.`
- 쌍둥이 **NEU-A-002** (종 교체): 같은 바위 위에 참새 한 마리가 앉아 있다. Δ `Same seed, rock, trail and framing; replace the snake with a sparrow perched calmly on the rock, similar size and position in the frame.`

**THR-A-03** · A · animal · 목표 V 3.0 / A 6.0
- 장면: 처마 밑에서 큰 말벌이 날개를 펴고 카메라 쪽을 향한다.
- 단서: 크고 노란 말벌의 경계 자세(날개 펼침)
- Prompt: `[STYLE] A large hornet perched on the wooden eave of a rural house, wings spread, facing the camera, body clearly visible, moderate close-up but not macro, plain wooden background.`
- 쌍둥이 **NEU-A-003** (종 교체): 같은 처마에 평범한 갈색 나방이 날개를 접고 앉아 있다. Δ `Same seed, eave and framing; replace the hornet with a plain brown moth resting with folded wings, similar size and position.`

**THR-S-01** · A · scene · 목표 V 3.0 / A 6.0
- 장면: 해 질 녘 좁은 골목 끝에 얼굴이 보이지 않는 사람이 서 있다.
- 단서: 골목 끝의 그림자 인물 (얼굴 불명)
- Prompt: `[STYLE] A narrow residential alley at dusk with dim street lamps, a dark silhouetted figure in a hood standing still at the far end of the alley facing the camera, face not visible, alley centred with converging walls.`
- 쌍둥이 **NEU-S-001**: 같은 골목, 아무도 없음, 같은 밝기. Δ `Same seed, alley and framing; remove the figure entirely, leave a parked bicycle at that spot, keep the same light level.`

**THR-S-02** · A · scene · 목표 V 2.8 / A 6.6
- 장면: 가정집 주방 가스레인지 냄비에서 불길과 검은 연기가 솟는다.
- 단서: 냄비 위 불꽃 + 퍼지는 연기
- Prompt: `[STYLE] A home kitchen, a pot on the gas stove with orange flames rising from it and thick grey smoke spreading toward the ceiling, nobody in the room, stove centred, mid-distance shot.`
- 쌍둥이 **NEU-S-002**: 같은 주방, 냄비가 뚜껑 덮인 채 약불에 올려져 있다. Δ `Same seed, kitchen, pot and framing; no flames, no smoke, lid on the pot, small blue gas flame barely visible.`

**THR-S-03** · A · scene · 목표 V 2.9 / A 6.5
- 장면: 흙탕물이 거세게 흐르는 동네 도로에 차들이 반쯤 잠겨 있다.
- 단서: 빠르게 흐르는 흙탕 급류
- Prompt: `[STYLE] A generic small-town street flooded by a fast muddy torrent, brown water rushing across the road with waves, two parked cars submerged up to their wheels, no people, overcast light, street centred.`
- 쌍둥이 **NEU-S-003**: 같은 도로가 마른 상태, 차 두 대가 주차되어 있다. Δ `Same seed, street, cars and framing; dry road, no water, ordinary overcast daylight.`

**THR-S-04** · A · scene · 목표 V 3.1 / A 6.3
- 장면: 비 오는 좁은 도로에서 전조등을 켠 차가 카메라 쪽으로 돌진한다.
- 단서: 정면으로 다가오는 차량과 전조등
- Prompt: `[STYLE] A narrow two-lane road in light rain, a silver sedan with headlights on speeding straight toward the camera, slight spray from the wheels, car in the centre of the frame, eye-level as if standing on the road.`
- 쌍둥이 **NEU-S-004**: 같은 도로 갓길에 같은 차가 전조등을 끄고 서 있다. Δ `Same seed, road and car; car parked at the roadside, headlights off, no spray, car still occupying the centre of the frame.`

**THR-O-01** · A · object · 목표 V 3.0 / A 6.2
- 장면: 손에 쥔 부엌칼의 칼끝이 카메라를 정면으로 향한다.
- 단서: 시청자를 향한 칼끝 (사람은 다치지 않음)
- Prompt: `[STYLE] Close view of a hand gripping a kitchen knife, the blade tip pointing directly at the camera, blade sharp and in focus, plain kitchen background, no person's face visible, no blood.`
- 쌍둥이 **NEU-O-001**: 같은 손이 나무 주걱을 같은 위치에서 옆으로 들고 있다. Δ `Same seed, hand, background and framing; replace the knife with a wooden spatula held horizontally, not pointing at the camera.`

**THR-O-02** · A · object · 목표 V 3.3 / A 5.8
- 장면: 날카로운 파편이 남은 깨진 유리창 접사.
- 단서: 거미줄처럼 금 간 유리와 뾰족한 파편
- Prompt: `[STYLE] A shattered window pane in a wooden frame, spiderweb cracks radiating from a central hole, sharp jagged shards still attached, daylight behind, window centred, frontal view.`
- 쌍둥이 **NEU-O-002**: 같은 창이 멀쩡한 상태. Δ `Same seed, frame, background and framing; intact clean glass with no cracks.`

#### 세트 B

**THR-P-07** · B · person · 목표 V 3.0 / A 6.2
- 장면: 편의점 계산대 너머에서 40대 남성이 카메라를 노려본다.
- 단서: 분노 표정 + 정면 응시
- Prompt: `[STYLE] A Korean man in his 40s in a dark jacket standing at a convenience store counter (no readable labels), glaring straight at the camera with furrowed brows and tight lips, hands flat on the counter, upper-body shot.`
- 쌍둥이 **NEU-P-007**: 같은 남성이 같은 자리에서 무표정으로 카메라를 본다. Δ `Same seed, person, jacket, counter and framing; relaxed neutral face, brows relaxed, still looking at the camera.`

**THR-P-08** · B · person · 목표 V 3.1 / A 6.3
- 장면: 시장 골목에서 60대 여성이 카메라를 향해 화를 내며 소리친다.
- 단서: 크게 벌린 입·찌푸린 얼굴 + 앞으로 뻗은 손
- Prompt: `[STYLE] A Korean woman in her 60s in a quilted vest in a traditional market aisle (no signs), shouting angrily at the camera, mouth open, brows furrowed, one open hand thrust toward the camera, upper-body shot.`
- 쌍둥이 **NEU-P-008**: 같은 여성이 같은 자리에서 무표정으로 장바구니를 든다. Δ `Same seed, person, vest, market and framing; mouth closed, relaxed neutral face, hand holding a plain shopping basket at waist height.`

**THR-P-09** · B · person · 목표 V 2.8 / A 6.6
- 장면: 아파트 계단에서 30대 남성이 굳은 얼굴로 빠르게 다가온다.
- 단서: 위협적 접근 자세 + 노려봄
- Prompt: `[STYLE] A Korean man in his 30s in a black padded jacket climbing quickly up an apartment stairwell toward the camera, tense shoulders, fists clenched, staring hostilely at the camera, evenly lit stairwell, knees-up shot.`
- 쌍둥이 **NEU-P-009**: 같은 남성이 같은 계단을 장 본 봉투를 들고 천천히 오른다. Δ `Same seed, person, jacket, stairwell and framing; relaxed shoulders, slow pace, holding a plain paper grocery bag, neutral face looking at the camera.`

**THR-P-10** · B · person · 목표 V 3.1 / A 6.3
- 장면: 사무실에서 30대 여성이 화가 나 책상 위 물건을 쓸어 넘긴다.
- 단서: 분노 표정 + 날아가는 서류·물건
- Prompt: `[STYLE] A Korean woman in her 30s in a blouse at an office desk, furiously sweeping papers and a pen holder off the desk with her arm, papers flying, angry face with clenched teeth looking toward the camera, waist-up shot.`
- 쌍둥이 **NEU-P-010**: 같은 여성이 같은 책상에서 서류를 정리한다. Δ `Same seed, person, desk and framing; calmly squaring a stack of papers on the desk, nothing flying, relaxed neutral face looking at the camera.`

**THR-P-11** · B · person · 목표 V 3.2 / A 5.9
- 장면: 지하철 안에서 20대 남성이 바짝 다가서서 노려본다.
- 단서: 가까운 거리 + 적대적 응시
- Prompt: `[STYLE] A Korean man in his 20s in a grey coat standing very close to the camera inside a subway car, staring hostilely into the camera, jaw tight, brows lowered, head-and-shoulders shot, evenly lit carriage behind (no screens or text).`
- 쌍둥이 **NEU-P-011**: 같은 남성이 같은 자리에서 무표정으로 손잡이를 잡고 있다. Δ `Same seed, person, coat, carriage and framing; relaxed neutral face, holding the overhead strap, looking at the camera.`

**THR-P-12** · B · person · 목표 V 3.3 / A 5.7
- 장면: 주차장에서 50대 여성이 차 문을 잡은 채 노려본다.
- 단서: 노려보는 분노 표정
- Prompt: `[STYLE] A Korean woman in her 50s in a trench coat standing beside an open car door in an outdoor parking lot, one hand on the door, glaring at the camera with narrowed eyes and pressed lips, waist-up shot.`
- 쌍둥이 **NEU-P-012**: 같은 여성이 같은 자세로 무표정하게 카메라를 본다. Δ `Same seed, person, coat, car and framing; relaxed neutral face, looking at the camera.`

**THR-A-04** · B · animal · 목표 V 2.9 / A 6.5
- 장면: 공사장 철문 앞에서 쇠사슬에 묶인 큰 개가 이빨을 드러내고 짖는다.
- 단서: 드러낸 이빨·벌린 입·앞으로 쏠린 몸
- Prompt: `[STYLE] A large tan mixed-breed guard dog on a chain in front of a metal gate at a construction site, barking aggressively at the camera, teeth bared, body leaning forward, whole dog visible.`
- 쌍둥이 **NEU-A-004**: 같은 개가 같은 자리에 입을 다물고 앉아 있다. Δ `Same seed, dog, chain, gate and framing; sitting calmly, mouth closed, ears relaxed, looking toward the camera.`

**THR-A-05** · B · animal · 목표 V 2.8 / A 6.4
- 장면: 돌담 위에서 뱀이 머리를 높이 들고 입을 벌린다.
- 단서: 세운 머리·벌린 입의 위협 자세
- Prompt: `[STYLE] A dark olive rat snake on top of a low stone wall, front of its body raised high, mouth open in a threat display facing the camera, whole snake visible, mid-distance, green garden behind.`
- 쌍둥이 **NEU-A-005** (종 교체): 같은 돌담 위의 비둘기. Δ `Same seed, stone wall, garden and framing; replace the snake with a grey pigeon standing calmly on the wall, similar size and position.`

**THR-A-06** · B · animal · 목표 V 2.9 / A 6.6
- 장면: 숲 가장자리에서 멧돼지가 카메라 쪽으로 돌진한다.
- 단서: 정면 돌진 자세의 멧돼지
- Prompt: `[STYLE] A wild boar charging out of the edge of a forest straight toward the camera, head low, tusks visible, dust kicked up, whole animal visible, mid-distance.`
- 쌍둥이 **NEU-A-006** (종 교체): 같은 숲 가장자리에 고라니가 가만히 서 있다. Δ `Same seed, forest edge and framing; replace the boar with a water deer standing still, side-on, similar size and position, no dust.`

**THR-S-05** · B · scene · 목표 V 3.0 / A 6.0
- 장면: 저녁 지하보도 안쪽에서 얼굴이 보이지 않는 사람이 이쪽을 보고 서 있다.
- 단서: 통로 끝의 정체불명 인물
- Prompt: `[STYLE] An underground pedestrian passage in the evening with dim ceiling lights, a dark figure in a long coat standing in shadow at the far end facing the camera, face not visible, passage centred with converging walls, no signs.`
- 쌍둥이 **NEU-S-005**: 같은 지하보도, 아무도 없음. Δ `Same seed, passage, light level and framing; remove the figure, place a plain mop bucket at that spot.`

**THR-S-06** · B · scene · 목표 V 2.8 / A 6.6
- 장면: 아파트 복도 현관문 틈에서 짙은 연기가 새어 나와 복도를 채운다.
- 단서: 문틈과 복도를 채운 연기
- Prompt: `[STYLE] An apartment building corridor, thick grey smoke pouring out from around a closed front door and filling the upper half of the corridor, no people, no flames visible, corridor centred.`
- 쌍둥이 **NEU-S-006**: 같은 복도, 연기 없음. Δ `Same seed, corridor, door and framing; clear air, no smoke, ordinary daylight.`

**THR-S-07** · B · scene · 목표 V 3.0 / A 6.4
- 장면: 태풍 파도가 방파제 산책로를 덮친다.
- 단서: 산책로로 넘쳐 드는 거대한 파도
- Prompt: `[STYLE] A seaside promenade with a concrete seawall during a storm, a huge grey wave crashing over the wall onto the walkway, spray in the air, no people, wall centred, overcast light.`
- 쌍둥이 **NEU-S-007**: 같은 산책로, 잔잔한 바다. Δ `Same seed, promenade, seawall and framing; calm flat sea, no waves over the wall, dry walkway, overcast light.`

**THR-S-08** · B · scene · 목표 V 3.1 / A 6.3
- 장면: 인도 위로 오토바이가 카메라 쪽으로 질주한다.
- 단서: 정면으로 다가오는 오토바이
- Prompt: `[STYLE] A city sidewalk, a delivery motorcycle with headlight on speeding along the pavement straight toward the camera, rider in a full-face helmet (no logos), motorcycle centred, eye-level.`
- 쌍둥이 **NEU-S-008**: 같은 오토바이가 인도 옆에 세워져 있다. Δ `Same seed, sidewalk, motorcycle and framing; motorcycle parked on its stand at the same spot, headlight off, no rider.`

**THR-O-03** · B · object · 목표 V 3.1 / A 6.0
- 장면: 손에 쥔 커터칼의 칼날이 길게 빠져나와 카메라를 향한다.
- 단서: 시청자를 향한 노출된 칼날
- Prompt: `[STYLE] Close view of a hand holding a box cutter with the blade fully extended, blade tip pointing at the camera, plain desk background, no face visible, no blood.`
- 쌍둥이 **NEU-O-003**: 같은 손이 형광펜을 옆으로 들고 있다. Δ `Same seed, hand, background and framing; replace the box cutter with a capped highlighter held horizontally, not pointing at the camera.`

**THR-O-04** · B · object · 목표 V 3.2 / A 6.0
- 장면: 벽 콘센트 옆 해진 전선에서 불꽃이 튄다.
- 단서: 피복이 벗겨진 전선의 스파크
- Prompt: `[STYLE] A frayed electrical cord with exposed copper wires next to a wall outlet, bright sparks and a thin wisp of smoke at the damaged spot, white wall, outlet centred, frontal view.`
- 쌍둥이 **NEU-O-004**: 같은 콘센트에 멀쩡한 전선이 꽂혀 있다. Δ `Same seed, wall, outlet and framing; intact cord plugged in, no sparks, no smoke.`

---

### 4.2 슬픔·상실 (DYS) — 30장 + 쌍둥이 30장

#### 세트 A

**DYS-P-01** · A · person · 목표 V 2.9 / A 4.6
- 장면: 30대 여성이 침대 끝에 혼자 앉아 조용히 운다.
- 단서: 볼의 눈물·내려간 입꼬리·처진 어깨
- Prompt: `[STYLE] A Korean woman in her 30s sitting alone on the edge of a bed in a small bedroom, quietly crying, tears on her cheeks, eyes red, mouth corners turned down, shoulders slumped, face visible, waist-up shot, soft daylight from a window.`
- 쌍둥이 **NEU-P-101**: 같은 여성이 같은 자리에서 빨래를 갠다. Δ `Same seed, person, bedroom and framing; no tears, upright posture, relaxed neutral face, folding a plain towel on her lap.`

**DYS-P-02** · A · person · 목표 V 2.8 / A 4.4
- 장면: 60대 여성이 병실 침대에 혼자 누워 창밖을 쓸쓸히 본다.
- 단서: 병상 + 홀로 + 슬픈 눈빛
- Prompt: `[STYLE] A Korean woman in her late 60s lying alone in a hospital bed with a plain white blanket, head propped on a pillow, looking toward the window with sad, tired eyes, no medical equipment on her body, bed centred, soft daylight.`
- 쌍둥이 **NEU-P-102**: 같은 여성이 집 안 비슷한 침대에 기대어 앉아 있다. Δ `Same seed, person, blanket and framing; ordinary home bedroom instead of a hospital room, sitting up against the pillow, relaxed neutral face.`

**DYS-P-03** · A · person · 목표 V 3.0 / A 4.5
- 장면: 50대 남성이 사무용품 상자를 옆에 두고 계단에 앉아 두 손으로 머리를 감싼다.
- 단서: 머리를 감싼 손·고개 숙임 + 짐 상자(실직 암시)
- Prompt: `[STYLE] A Korean man in his 50s in a suit sitting on outdoor stone steps of an office building, head bowed and resting in his hands, a cardboard box of office belongings beside him (no text), dejected posture, mid shot.`
- 쌍둥이 **NEU-P-103**: 같은 남성이 같은 계단에 바르게 앉아 휴대폰을 본다. Δ `Same seed, person, suit, steps, box and framing; upright posture, looking at a phone held in one hand, relaxed neutral face visible.`

**DYS-P-04** · A · person · 목표 V 3.1 / A 4.3
- 장면: 원룸 바닥에 20대 남성이 무릎을 끌어안고 눈물 고인 채 앉아 있다.
- 단서: 무릎 끌어안은 자세 + 젖은 눈
- Prompt: `[STYLE] A Korean man in his 20s sitting on the floor of a small studio apartment, hugging his knees, eyes wet and red, gaze downcast, sad expression, face visible, mid shot, soft daylight.`
- 쌍둥이 **NEU-P-104**: 같은 남성이 같은 바닥에서 책을 정리한다. Δ `Same seed, person, room and framing; sitting cross-legged, sorting a small stack of books, relaxed neutral face.`

**DYS-P-05** · A · person · 목표 V 2.9 / A 4.7
- 장면: 장례식장 복도에서 상복을 입은 40대 여성이 눈물을 닦는다.
- 단서: 상복 + 손수건으로 눈물 닦기
- Prompt: `[STYLE] A Korean woman in her 40s wearing a black traditional mourning dress in a quiet funeral hall corridor, wiping tears with a white handkerchief, grieving expression, no portraits or caskets visible, waist-up shot.`
- 쌍둥이 **NEU-P-105**: 같은 여성이 검은 정장 차림으로 로비에서 기다린다. Δ `Same seed, person and framing; black formal dress instead of mourning dress, plain office lobby, hands holding a small handbag, relaxed neutral face.`

**DYS-P-06** · A · person · 목표 V 3.1 / A 4.2
- 장면: 늦은 밤 40대 남성이 식탁에 혼자 앉아 지친 얼굴로 허공을 본다.
- 단서: 지치고 슬픈 표정 + 혼자 남은 식탁
- Prompt: `[STYLE] A Korean man in his 40s sitting alone at a kitchen table, elbows on the table, staring blankly with a sad, exhausted expression, a single untouched bowl of rice in front of him, waist-up shot, soft warm-neutral ceiling light.`
- 쌍둥이 **NEU-P-106**: 같은 남성이 같은 식탁에서 밥을 먹는다. Δ `Same seed, person, table, bowl, light and framing; eating with chopsticks, upright, relaxed neutral face.`

**DYS-A-01** · A · animal · 목표 V 2.7 / A 4.8
- 장면: 비 오는 길가 종이 상자 옆에 젖은 개가 버려진 채 올려다본다.
- 단서: 젖은 털·처진 귀·버려진 상자
- Prompt: `[STYLE] A small wet mixed-breed dog sitting next to a soggy cardboard box on a rainy sidewalk, ears drooping, looking up at the camera with sad eyes, whole dog visible, grey daylight.`
- 쌍둥이 **NEU-A-101**: 같은 개가 마른 날 같은 길가에 앉아 있다. Δ `Same seed, dog, sidewalk and framing; dry weather, dry fur, ears relaxed, no box, sitting calmly.`

**DYS-A-02** · A · animal · 목표 V 2.9 / A 4.4
- 장면: 빈 골목 구석에 마른 새끼 고양이가 혼자 웅크려 떨고 있다.
- 단서: 웅크린 자세 + 홀로 남음
- Prompt: `[STYLE] A thin grey kitten curled up alone in the corner of an empty alley next to a drainpipe, hunched and shivering, ears flat, looking at the camera, no injury, whole cat visible, grey daylight.`
- 쌍둥이 **NEU-A-102** (종 교체): 같은 골목 구석의 비둘기. Δ `Same seed, alley, drainpipe and framing; replace the kitten with a grey pigeon standing calmly, similar size and position.`

**DYS-A-03** · A · animal · 목표 V 2.8 / A 4.3
- 장면: 보호소 철장 안에 늙은 개가 혼자 엎드려 슬픈 눈으로 본다.
- 단서: 철장 + 체념한 눈빛
- Prompt: `[STYLE] An old brown dog lying alone inside a metal kennel at an animal shelter, chin on its paws, looking up at the camera with sad eyes through the bars, whole dog visible, clean concrete floor.`
- 쌍둥이 **NEU-A-103** (종 교체): 같은 구도로 외양간 짚 위에 편히 누운 소. Δ `Same seed and framing; a plain barn stall instead of a kennel, a brown cow lying calmly on straw, similar size and position, no bars.`

**DYS-S-01** · A · scene · 목표 V 2.9 / A 4.4
- 장면: 흰 국화가 놓인 장례식장 제단 앞에 빈 의자들이 늘어서 있다.
- 단서: 흰 국화 제단 (영정·관 없음)
- Prompt: `[STYLE] A Korean funeral hall memorial room, an altar covered with white chrysanthemums and an empty black frame with no photo, rows of empty chairs in front, nobody present, altar centred, soft even light.`
- 쌍둥이 **NEU-S-101**: 같은 방이 강연장으로 꾸며져 있다. Δ `Same seed, room geometry, chairs and framing; replace the altar with a plain wooden lectern and a whiteboard, a few green potted plants, no flowers.`

**DYS-S-02** · A · scene · 목표 V 3.1 / A 3.9
- 장면: 회색 비가 내리는 텅 빈 놀이터.
- 단서: 비 + 사람 없는 놀이기구 (상실된 놀이)
- Prompt: `[STYLE] An empty apartment-complex playground in steady grey rain, a wet slide and still swings, puddles on the ground, nobody present, playground centred, flat grey daylight.`
- 쌍둥이 **NEU-S-102**: 같은 놀이터, 마른 날, 아무도 없음. Δ `Same seed, playground and framing; dry ground, no rain, no puddles, ordinary soft daylight of the same brightness.`

**DYS-S-03** · A · scene · 목표 V 3.0 / A 4.2
- 장면: 버려진 시골집 방에 벽지가 벗겨지고 먼지 쌓인 가구가 남아 있다.
- 단서: 방치·폐허 (떠난 사람의 흔적)
- Prompt: `[STYLE] Interior of an abandoned Korean countryside house, peeling floral wallpaper, a dusty overturned wooden chair and an old cabinet left behind, dust on the floor, soft daylight through a window, room centred.`
- 쌍둥이 **NEU-S-103**: 같은 방이 깔끔하게 정리되어 있다. Δ `Same seed, room, furniture and framing; clean intact wallpaper, chair upright, no dust, same soft daylight.`

**DYS-S-04** · A · scene · 목표 V 3.1 / A 4.3
- 장면: 병원 복도 한가운데 빈 휠체어가 홀로 놓여 있다.
- 단서: 빈 휠체어 + 병원 복도
- Prompt: `[STYLE] A quiet hospital corridor in daytime, an empty wheelchair standing alone in the middle of the corridor, nobody present, corridor centred with converging walls, even soft light, no signs.`
- 쌍둥이 **NEU-S-104**: 같은 구조의 사무실 복도에 청소 카트가 놓여 있다. Δ `Same seed, corridor geometry, light and framing; ordinary office corridor instead of hospital, replace the wheelchair with a plain office cleaning cart.`

**DYS-O-01** · A · object · 목표 V 3.0 / A 4.4
- 장면: 바닥에 떨어져 유리가 깨진 가족사진 액자.
- 단서: 깨진 유리 + 가족사진 (얼굴은 역광으로 식별 불가)
- Prompt: `[STYLE] A family photo frame lying on a wooden floor with its glass cracked across the picture, the photo shows four backlit silhouettes of a family (faces not identifiable), frame centred, top-down at a slight angle, soft daylight.`
- 쌍둥이 **NEU-O-101**: 같은 액자가 멀쩡한 유리로 탁자 위에 놓여 있다. Δ `Same seed, frame and framing; intact glass, photo replaced by a plain landscape of a field, lying on a wooden table.`

**DYS-O-02** · A · object · 목표 V 3.2 / A 3.8
- 장면: 꽃병 속 장미 꽃다발이 시들어 갈색으로 말랐고 꽃잎이 떨어져 있다.
- 단서: 시든 꽃 + 떨어진 꽃잎
- Prompt: `[STYLE] A glass vase on a windowsill holding a bouquet of wilted, dried brown roses with drooping heads, fallen petals scattered around the vase, vase centred, soft daylight.`
- 쌍둥이 **NEU-O-102**: 같은 꽃병에 초록 유칼립투스 가지가 꽂혀 있다. Δ `Same seed, vase, windowsill and framing; replace the roses with a few plain green eucalyptus branches, no fallen petals.`

#### 세트 B

**DYS-P-07** · B · person · 목표 V 3.0 / A 4.6
- 장면: 버스 정류장에서 20대 여성이 휴대폰을 보며 조용히 운다.
- 단서: 눈물 + 휴대폰 (나쁜 소식 암시)
- Prompt: `[STYLE] A Korean woman in her 20s at a daytime bus shelter, holding a phone, quietly crying, tears on her cheeks, lips trembling, face visible, waist-up shot, overcast light, no screens with text.`
- 쌍둥이 **NEU-P-107**: 같은 여성이 같은 자리에서 무표정으로 휴대폰을 본다. Δ `Same seed, person, shelter and framing; no tears, relaxed neutral face, looking at the phone.`

**DYS-P-08** · B · person · 목표 V 2.9 / A 4.2
- 장면: 요양원 방 창가에 60대 남성이 혼자 휠체어에 앉아 쓸쓸히 밖을 본다.
- 단서: 홀로 + 쓸쓸한 눈빛 + 요양 환경
- Prompt: `[STYLE] A Korean man in his late 60s sitting alone in a wheelchair by the window of a nursing-home room, hands in his lap, gazing outside with a lonely, sad expression, face visible in profile three-quarter, mid shot, soft daylight.`
- 쌍둥이 **NEU-P-108**: 같은 남성이 거실 안락의자에 앉아 글자가 보이지 않게 접은 신문을 든다. Δ `Same seed, person and framing; ordinary living room, sitting in an armchair instead of a wheelchair, holding a folded newspaper with no visible text, relaxed neutral face.`

**DYS-P-09** · B · person · 목표 V 2.9 / A 4.7
- 장면: 병원 앞 연석에 30대 남성이 고개를 떨군 채 눈물 고여 앉아 있다.
- 단서: 고개 떨굼 + 눈물 + 병원 앞
- Prompt: `[STYLE] A Korean man in his 30s sitting on a curb outside a hospital entrance (no signs), head bowed, eyes wet, holding a paper cup loosely, grief-stricken expression, face visible, mid shot, overcast light.`
- 쌍둥이 **NEU-P-109**: 같은 남성이 일반 건물 앞에서 컵을 들고 쉰다. Δ `Same seed, person, curb and framing; ordinary office building entrance, head up, drinking from the paper cup, relaxed neutral face.`

**DYS-P-10** · B · person · 목표 V 3.1 / A 4.1
- 장면: 50대 여성이 2인용 밥상의 빈 맞은편 자리를 내려다본다.
- 단서: 빈 맞은편 자리 + 슬픈 표정 (사별 암시)
- Prompt: `[STYLE] A Korean woman in her 50s sitting alone at a small dining table set for two, looking down at the empty chair and untouched place setting opposite her with a sad expression, face visible, waist-up shot, soft daylight.`
- 쌍둥이 **NEU-P-110**: 같은 여성이 1인 상차림에서 식사한다. Δ `Same seed, person, table and framing; single place setting, no empty chair emphasis, eating soup with a spoon, relaxed neutral face.`

**DYS-P-11** · B · person · 목표 V 2.9 / A 4.6
- 장면: 장례식장 복도에서 상복 차림의 40대 남성이 붉어진 눈으로 서 있다.
- 단서: 상복(완장) + 붉어진 눈
- Prompt: `[STYLE] A Korean man in his 40s in a black mourning suit with a plain black armband standing in a quiet funeral hall corridor, red swollen eyes, grieving expression, looking slightly down, no portraits or caskets, waist-up shot.`
- 쌍둥이 **NEU-P-111**: 같은 남성이 검은 정장 차림으로 사무실 로비에 서 있다. Δ `Same seed, person, suit and framing; no armband, plain office lobby, eyes normal, relaxed neutral face.`

**DYS-P-12** · B · person · 목표 V 3.0 / A 4.4
- 장면: 60대 여성이 오래된 사진을 들여다보며 눈물을 흘린다.
- 단서: 눈물 + 옛 사진 (그리움)
- Prompt: `[STYLE] A Korean woman in her 60s sitting on a sofa holding an old faded photograph (image not visible to viewer), a tear on her cheek, sad longing expression, face visible, waist-up shot, soft daylight.`
- 쌍둥이 **NEU-P-112**: 같은 여성이 같은 자세로 얇은 공책을 들고 본다. Δ `Same seed, person, sofa and framing; holding a plain notebook instead of the photo, no tears, relaxed neutral face.`

**DYS-A-04** · B · animal · 목표 V 2.8 / A 4.5
- 장면: 보호소 철장에 강아지가 얼굴을 대고 밖을 본다.
- 단서: 철장 + 매달리는 눈빛
- Prompt: `[STYLE] A young mixed-breed dog pressing its face against the bars of a shelter kennel, looking at the camera with pleading sad eyes, ears down, clean kennel, dog centred.`
- 쌍둥이 **NEU-A-104** (종 교체): 같은 구도로 닭장 앞에 선 암탉. Δ `Same seed and framing; a wire chicken coop door instead of the kennel, a brown hen standing calmly behind it, similar size and position.`

**DYS-A-05** · B · animal · 목표 V 3.0 / A 4.2
- 장면: 해 질 무렵 닫힌 대문 앞에서 개가 혼자 기다린다.
- 단서: 닫힌 문을 바라보는 홀로 남은 개 (기다림)
- Prompt: `[STYLE] A medium-sized white dog sitting alone in front of a closed wooden gate of a Korean house in light drizzle, head lowered, looking at the gate, whole dog visible, grey daylight.`
- 쌍둥이 **NEU-A-105** (종 교체): 같은 대문 앞의 비둘기 두 마리. Δ `Same seed, gate and framing; dry weather, replace the dog with two grey pigeons pecking the ground, similar overall size and position.`

**DYS-A-06** · B · animal · 목표 V 2.8 / A 4.4
- 장면: 분리수거장 옆 상자 안에 버려진 고양이가 웅크려 있다.
- 단서: 버려진 상자 + 웅크린 고양이
- Prompt: `[STYLE] An adult tabby cat curled up inside an open cardboard box left beside recycling bins (no labels), looking out at the camera with sad eyes, whole box visible, overcast light.`
- 쌍둥이 **NEU-A-106** (종 교체): 같은 자리에 참새 몇 마리가 앉아 있다. Δ `Same seed, recycling area and framing; no box, three sparrows on the ground at the same spot, similar total size.`

**DYS-S-05** · B · scene · 목표 V 3.0 / A 4.3
- 장면: 비 내리는 언덕 공원묘지에 비석들이 줄지어 있다.
- 단서: 묘지 + 비
- Prompt: `[STYLE] A hillside cemetery in Korea in light rain, rows of grey granite headstones without inscriptions, wet grass, a few white chrysanthemums, nobody present, overcast light, mid-distance.`
- 쌍둥이 **NEU-S-105**: 같은 언덕이 평범한 잔디 비탈과 돌계단이다. Δ `Same seed, hillside and framing; no headstones or flowers, plain grass slope with low stone steps and shrubs, dry, overcast light.`

**DYS-S-06** · B · scene · 목표 V 3.0 / A 4.0
- 장면: 빈 병실에 정리되지 않은 침대와 시든 꽃병만 남아 있다.
- 단서: 비어 버린 병상 + 시든 꽃 (떠난 사람)
- Prompt: `[STYLE] An empty single hospital room, an unmade bed with a crumpled blanket, a small vase of wilted flowers on the bedside table, nobody present, bed centred, soft window light.`
- 쌍둥이 **NEU-S-106**: 같은 배치의 평범한 객실. Δ `Same seed, room layout and framing; plain guest room bed neatly made, bedside table with a plain lamp instead of flowers.`

**DYS-S-07** · B · scene · 목표 V 3.2 / A 3.9
- 장면: 폐업한 작은 식당에 의자가 쌓이고 먼지가 앉아 있다.
- 단서: 폐업·방치의 흔적
- Prompt: `[STYLE] Interior of a small closed-down Korean restaurant, chairs stacked on dusty tables, lights off, faded walls, a pile of unopened mail on the floor (no readable text), soft daylight through the front window, room centred.`
- 쌍둥이 **NEU-S-107**: 같은 식당이 개점 전 깨끗한 상태. Δ `Same seed, restaurant and framing; clean tables, chairs neatly tucked in, no dust, no mail, lights on at the same overall brightness.`

**DYS-S-08** · B · scene · 목표 V 3.1 / A 3.8
- 장면: 흐린 빛 아래 매트리스 하나와 그릇 하나만 있는 텅 빈 원룸.
- 단서: 극도로 빈 생활 공간 (고립·외로움)
- Prompt: `[STYLE] A bare studio apartment with only a thin mattress on the floor, a single bowl and a cup beside it, bare walls, grey light from a small window, nobody present, room centred.`
- 쌍둥이 **NEU-S-108**: 같은 원룸에 평범한 가구가 있다. Δ `Same seed, room and framing; add a simple desk, chair and shelf, mattress replaced by a made bed, ordinary soft daylight of the same brightness.`

**DYS-O-03** · B · object · 목표 V 3.1 / A 3.9
- 장면: 빈 침대 옆에 노인용 슬리퍼와 지팡이가 남아 있다.
- 단서: 주인 없는 지팡이·슬리퍼 (부재)
- Prompt: `[STYLE] A pair of worn elderly person's slippers and a wooden walking cane left beside an empty neatly made bed, nobody present, objects centred, soft daylight.`
- 쌍둥이 **NEU-O-103**: 현관 신발장 앞의 슬리퍼와 우산. Δ `Same seed and framing; entrance hallway floor instead of beside a bed, slippers next to a closed folded umbrella instead of a cane.`

**DYS-O-04** · B · object · 목표 V 3.0 / A 4.0
- 장면: 빈 밥그릇 옆 고리에 주인 잃은 개 목줄이 걸려 있다.
- 단서: 쓰이지 않는 목줄·빈 밥그릇 (반려동물 상실)
- Prompt: `[STYLE] A red dog leash and collar hanging alone on a wall hook above an empty stainless steel pet bowl on the floor, a little dust on the bowl, nothing else around, objects centred, soft daylight.`
- 쌍둥이 **NEU-O-104**: 같은 고리에 에코백, 바닥에 열쇠 담은 도자기 그릇. Δ `Same seed, wall, hook and framing; a plain canvas tote bag on the hook, a plain ceramic bowl holding keys on the floor, no dust.`

---

### 4.3 긍정 (POS) — 30장 + 쌍둥이 30장

#### 세트 A

**POS-P-01** · A · person · 목표 V 7.5 / A 5.8
- 장면: 카페에서 20대 친구 세 명이 함께 크게 웃는다.
- 단서: 눈가 주름이 진 진짜 웃음 + 서로를 향한 상호작용
- Prompt: `[STYLE] Three Korean friends in their 20s (two women, one man) at a café table, laughing together genuinely, eyes crinkled, one touching another's shoulder, faces visible, waist-up group shot, no logos on cups.`
- 쌍둥이 **NEU-P-201**: 같은 세 명이 무표정으로 메뉴판을 본다. Δ `Same seed, people, café and framing; no laughing, relaxed neutral faces, each looking at a plain menu card, no touching.`

**POS-P-02** · A · person · 목표 V 7.7 / A 5.4
- 장면: 60대 할머니와 손주가 부엌에서 반죽을 하며 웃는다.
- 단서: 세대 간 따뜻한 웃음
- Prompt: `[STYLE] A Korean grandmother in her 60s and her 6-year-old grandchild in a home kitchen, kneading dough together, both smiling broadly at each other, flour on the table, faces visible, waist-up shot.`
- 쌍둥이 **NEU-P-202**: 같은 두 사람이 무표정으로 반죽을 한다. Δ `Same seed, people, kitchen and framing; both looking down at the dough with relaxed neutral expressions, not smiling.`

**POS-P-03** · A · person · 목표 V 7.4 / A 6.0
- 장면: 산 정상에서 30대 부부가 환하게 웃으며 하이파이브한다.
- 단서: 성취의 기쁨 + 하이파이브
- Prompt: `[STYLE] A Korean couple in their 30s in hiking clothes at a mountain summit, high-fiving and laughing joyfully, eyes crinkled, rocky summit and distant ridges behind, waist-up shot, clear daylight.`
- 쌍둥이 **NEU-P-203**: 같은 부부가 정상에서 지도를 본다. Δ `Same seed, people, summit and framing; hands lowered, looking at a folded paper map without text, relaxed neutral faces.`

**POS-P-04** · A · person · 목표 V 7.2 / A 6.2
- 장면: 경기장에서 40대 남성이 두 팔을 들고 환호한다.
- 단서: 환호하는 표정 + 치켜든 두 팔
- Prompt: `[STYLE] A Korean man in his 40s in a plain jersey in stadium stands, cheering with both arms raised and a big open-mouthed smile, blurred crowd behind (no text), waist-up shot, daylight.`
- 쌍둥이 **NEU-P-204**: 같은 남성이 같은 자리에 손을 무릎에 얹고 앉아 있다. Δ `Same seed, person, jersey, stands and framing; seated, hands on his knees, mouth closed, relaxed neutral face.`

**POS-P-05** · A · person · 목표 V 7.6 / A 5.3
- 장면: 60대 여성이 꽃다발을 받고 활짝 웃는다.
- 단서: 기쁨에 찬 웃음 + 선물받은 꽃다발
- Prompt: `[STYLE] A Korean woman in her 60s at home receiving a bright bouquet of flowers, beaming with a wide genuine smile, eyes crinkled, holding the bouquet at chest height, waist-up shot.`
- 쌍둥이 **NEU-P-205**: 같은 여성이 같은 자세로 종이 장바구니를 든다. Δ `Same seed, person, room and framing; holding a plain brown paper bag at chest height instead of flowers, relaxed neutral face.`

**POS-P-06** · A · person · 목표 V 7.5 / A 5.9
- 장면: 졸업식에서 20대 남성이 졸업 가운을 입고 환하게 웃으며 꽃다발을 든다.
- 단서: 졸업의 기쁨 + 웃음
- Prompt: `[STYLE] A Korean man in his 20s in a graduation gown and cap on a university campus, laughing happily while holding a bouquet, eyes crinkled, campus buildings softly blurred behind (no text), waist-up shot.`
- 쌍둥이 **NEU-P-206**: 같은 남성이 가운 차림으로 무표정하게 소매를 정리한다. Δ `Same seed, person, gown, campus and framing; no bouquet, adjusting his sleeve, relaxed neutral face.`

**POS-A-01** · A · animal · 목표 V 7.8 / A 5.6
- 장면: 잔디밭에서 골든 리트리버 강아지가 공을 물고 뛰논다.
- 단서: 새끼 동물의 놀이 + 귀여움
- Prompt: `[STYLE] A fluffy golden retriever puppy playing on a green lawn with a red ball in its mouth, mid-bounce, ears flopping, bright eyes, whole puppy visible, daylight.`
- 쌍둥이 **NEU-A-201** (종 교체): 같은 잔디밭의 닭 한 마리. Δ `Same seed, lawn and framing; replace the puppy with a brown hen standing calmly, no ball, similar size and position.`

**POS-A-02** · A · animal · 목표 V 7.7 / A 5.4
- 장면: 마당 화분 옆에서 아기 고양이가 앞발로 풀잎을 툭툭 친다.
- 단서: 새끼 고양이의 장난
- Prompt: `[STYLE] A small orange kitten in a garden playfully batting at a blade of grass with one front paw raised, curious wide eyes, whole kitten visible next to a terracotta pot, daylight.`
- 쌍둥이 **NEU-A-202** (종 교체): 같은 화분 옆의 비둘기. Δ `Same seed, garden, pot and framing; replace the kitten with a grey pigeon standing still, similar size and position.`

**POS-A-03** · A · animal · 목표 V 7.4 / A 5.2
- 장면: 연못에서 어미 오리 뒤로 새끼 오리들이 줄지어 헤엄친다.
- 단서: 새끼 오리 행렬
- Prompt: `[STYLE] A mother mallard duck swimming on a calm pond followed by a line of five fluffy ducklings, group centred, eye-level close to the water, daylight.`
- 쌍둥이 **NEU-A-203**: 같은 연못에 다 자란 청둥오리 두 마리. Δ `Same seed, pond and framing; two adult mallards floating side by side, no ducklings, similar total size.`

**POS-S-01** · A · scene · 목표 V 7.6 / A 5.4
- 장면: 맑은 날 하얀 모래사장과 투명한 바다.
- 단서: 아름다운 해변 풍경
- Prompt: `[STYLE] A sunny white-sand beach with clear turquoise water and gentle waves, a few tiny distant figures, a small rocky islet centred on the horizon, natural (not oversaturated) colours.`
- 쌍둥이 **NEU-S-201**: 같은 해안 구도의 평범한 콘크리트 부두와 잔잔한 바다. Δ `Same seed, coastline and framing; plain concrete harbour pier instead of sand, flat grey-blue water, the same islet, soft overcast light.`

**POS-S-02** · A · scene · 목표 V 7.3 / A 6.0
- 장면: 풍선과 색종이 가루가 흩날리는 생일 파티 방.
- 단서: 축하 장식 + 흩날리는 색종이
- Prompt: `[STYLE] A living room decorated for a birthday party, colourful balloons, falling confetti, a party table with snacks, blurred joyful people in the background, room centred, no text banners.`
- 쌍둥이 **NEU-S-202**: 같은 방, 장식 없는 평범한 거실. Δ `Same seed, room and framing; no balloons, confetti or people, the table holds a plain fruit bowl.`

**POS-S-03** · A · scene · 목표 V 7.5 / A 5.3
- 장면: 벚꽃이 만개한 산책로.
- 단서: 만개한 벚꽃
- Prompt: `[STYLE] A riverside walking path lined with cherry trees in full bloom, pink petals in the air, a few distant walkers, path centred and receding, soft sunlight, natural colours.`
- 쌍둥이 **NEU-S-203**: 같은 길, 꽃 없는 평범한 가로수. Δ `Same seed, path and framing; ordinary leafless-to-light-green street trees, no blossoms or petals, soft overcast light.`

**POS-S-04** · A · scene · 목표 V 7.4 / A 6.1
- 장면: 밤 강변 위로 불꽃놀이가 터지고 사람들이 실루엣으로 본다.
- 단서: 화려한 불꽃 + 축제 군중
- Prompt: `[STYLE] Fireworks bursting in gold and white over a wide river at night with a city skyline, silhouettes of a cheerful crowd on the riverbank in the foreground, fireworks centred, natural exposure without blown highlights.`
- 쌍둥이 **NEU-S-204**: 같은 강변 야경, 불꽃·군중 없음. Δ `Same seed, river, skyline and framing; no fireworks, no crowd, ordinary city lights, same overall brightness after normalization.`

**POS-O-01** · A · object · 목표 V 7.3 / A 5.2
- 장면: 촛불이 켜진 생일 케이크.
- 단서: 생일 케이크 + 촛불
- Prompt: `[STYLE] A strawberry cream birthday cake with lit candles on a white plate on a wooden table, warm candle glow, cake centred, frontal eye-level view, no text on the cake.`
- 쌍둥이 **NEU-O-201**: 같은 접시 위 식빵 한 덩이. Δ `Same seed, plate, table and framing; replace the cake with a plain loaf of white bread, no candles.`

**POS-O-02** · A · object · 목표 V 7.2 / A 5.5
- 장면: 리본 달린 선물 상자가 열리고 색종이 조각이 흩어져 있다.
- 단서: 선물·리본·색종이 (설렘)
- Prompt: `[STYLE] An open gift box with a red satin ribbon and the lid tilted aside, colourful confetti scattered around it on a table, box centred, eye-level view.`
- 쌍둥이 **NEU-O-202**: 같은 자리의 닫힌 갈색 택배 상자. Δ `Same seed, table and framing; a closed plain brown cardboard box of the same size, no ribbon, no confetti, no labels.`

#### 세트 B

**POS-P-07** · B · person · 목표 V 7.4 / A 5.6
- 장면: 회사 점심 자리에서 동료 네 명이 함께 웃는다.
- 단서: 함께 웃는 동료들
- Prompt: `[STYLE] Four Korean office colleagues (two men, two women, 30s-40s) at a lunch table in a Korean restaurant, laughing together at a shared joke, eyes crinkled, faces visible, waist-up group shot, no text.`
- 쌍둥이 **NEU-P-207**: 같은 네 명이 조용히 식사한다. Δ `Same seed, people, table and framing; eating quietly with relaxed neutral faces, not laughing.`

**POS-P-08** · B · person · 목표 V 7.7 / A 5.8
- 장면: 60대 할아버지가 손주의 자전거 타기를 도우며 둘이 함께 웃는다.
- 단서: 세대 간 웃음 + 함께하는 활동
- Prompt: `[STYLE] A Korean grandfather in his 60s holding the back of a small bicycle while his 7-year-old grandchild rides it in a park, both laughing happily, faces visible, full scene mid shot, daylight.`
- 쌍둥이 **NEU-P-208**: 같은 두 사람이 자전거 옆에 무표정으로 서 있다. Δ `Same seed, people, bicycle, park and framing; both standing beside the bicycle, relaxed neutral faces.`

**POS-P-09** · B · person · 목표 V 7.6 / A 5.7
- 장면: 결혼식 직후 20대 신랑 신부가 서로 보며 환하게 웃는다.
- 단서: 결혼의 기쁨 + 마주 보는 웃음
- Prompt: `[STYLE] A Korean bride and groom in their late 20s outside a wedding venue, laughing joyfully while looking at each other, eyes crinkled, waist-up shot, soft daylight, no text.`
- 쌍둥이 **NEU-P-209**: 같은 두 사람이 정장 차림으로 무표정하게 카메라를 본다. Δ `Same seed, people, outfits, venue and framing; standing side by side, relaxed neutral faces looking at the camera.`

**POS-P-10** · B · person · 목표 V 7.2 / A 5.9
- 장면: 30대 남성이 친구들과 보드게임을 하다 크게 웃는다.
- 단서: 놀이 중 터진 웃음
- Prompt: `[STYLE] A Korean man in his 30s laughing heartily at a board game table with friends partly visible at the frame edges, head tilted back slightly, eyes crinkled, waist-up shot, no text on the game.`
- 쌍둥이 **NEU-P-210**: 같은 남성이 무표정으로 게임 말을 옮긴다. Δ `Same seed, person, table and framing; moving a game piece, relaxed neutral face.`

**POS-P-11** · B · person · 목표 V 7.3 / A 6.0
- 장면: 50대 여성이 부엌에서 신나게 춤춘다.
- 단서: 즐거운 움직임 + 웃음
- Prompt: `[STYLE] A Korean woman in her 50s dancing joyfully in her kitchen, arms swinging, big smile with eyes crinkled, apron on, waist-up shot, soft daylight.`
- 쌍둥이 **NEU-P-211**: 같은 여성이 조리대를 닦는다. Δ `Same seed, person, apron, kitchen and framing; wiping the counter with a cloth, relaxed neutral face.`

**POS-P-12** · B · person · 목표 V 7.3 / A 5.7
- 장면: 60대 남성이 낚은 큰 물고기를 들고 활짝 웃는다.
- 단서: 성취의 웃음 + 들어 올린 물고기
- Prompt: `[STYLE] A Korean man in his 60s on a lakeside dock proudly holding up a large fish he caught, wide genuine smile, eyes crinkled, waist-up shot, daylight.`
- 쌍둥이 **NEU-P-212**: 같은 남성이 낚싯대를 들고 무표정하게 서 있다. Δ `Same seed, person, dock and framing; holding a fishing rod upright instead of the fish, relaxed neutral face.`

**POS-A-04** · B · animal · 목표 V 7.7 / A 5.9
- 장면: 해변에서 웰시코기 강아지가 귀를 펄럭이며 달려온다.
- 단서: 새끼 개의 신나는 달리기
- Prompt: `[STYLE] A corgi puppy running happily across a sandy beach toward the camera, ears flapping, tongue out, whole puppy visible, daylight.`
- 쌍둥이 **NEU-A-204** (종 교체): 같은 해변에 서 있는 갈매기. Δ `Same seed, beach and framing; replace the puppy with a seagull standing still, similar size and position.`

**POS-A-05** · B · animal · 목표 V 7.4 / A 6.1
- 장면: 공원에서 개가 공중으로 뛰어올라 원반을 문다.
- 단서: 신나는 점프 + 놀이
- Prompt: `[STYLE] A white-and-brown border collie leaping in mid-air to catch a frisbee in a green park, happy expression, whole dog visible, daylight, no logos on the frisbee.`
- 쌍둥이 **NEU-A-205** (종 교체): 같은 공원 잔디에서 걷는 비둘기 두 마리. Δ `Same seed, park and framing; two pigeons walking on the grass at the same spot, no frisbee.`

**POS-A-06** · B · animal · 목표 V 7.3 / A 5.5
- 장면: 눈 덮인 들판에서 두루미 한 쌍이 날개를 펴고 춤춘다.
- 단서: 아름다운 구애 춤
- Prompt: `[STYLE] A pair of red-crowned cranes dancing with wings spread in a snowy field, elegant poses, both birds fully visible, soft daylight.`
- 쌍둥이 **NEU-A-206**: 같은 들판에 왜가리 한 마리가 가만히 서 있다. Δ `Same seed, snowy field and framing; a single grey heron standing still, wings folded, similar total size.`

**POS-S-05** · B · scene · 목표 V 7.5 / A 5.3
- 장면: 푸른 하늘 아래 유채꽃밭 너머로 바다가 보인다.
- 단서: 아름다운 봄 풍경
- Prompt: `[STYLE] A field of yellow canola flowers in bloom with the sea and a gentle volcanic hill beyond under a clear blue sky, natural (not oversaturated) colours, field centred.`
- 쌍둥이 **NEU-S-205**: 같은 구도의 평범한 밭과 바다. Δ `Same seed, landscape and framing; plain green low crop field instead of flowers, soft overcast sky.`

**POS-S-06** · B · scene · 목표 V 7.3 / A 6.0
- 장면: 결혼식 피로연장에 꽃잎과 색종이가 흩날리고 하객이 박수 친다.
- 단서: 축하 분위기 + 흩날리는 꽃잎
- Prompt: `[STYLE] A wedding reception hall with flower petals and confetti falling, guests in the background clapping and smiling (blurred), decorated tables, hall centred, soft light, no text.`
- 쌍둥이 **NEU-S-206**: 같은 홀이 세미나용으로 비어 있다. Δ `Same seed, hall and framing; no petals, confetti or guests, tables with plain white cloths and water bottles without labels.`

**POS-S-07** · B · scene · 목표 V 7.4 / A 5.2
- 장면: 단풍이 든 산골짜기와 맑은 계곡물.
- 단서: 아름다운 가을 풍경
- Prompt: `[STYLE] A mountain valley in autumn with red and orange maple foliage, a clear stream flowing over rocks in the centre, soft sunlight, natural colours.`
- 쌍둥이 **NEU-S-207**: 같은 골짜기의 평범한 초록 숲. Δ `Same seed, valley, stream and framing; plain mid-season green foliage, soft diffused light.`

**POS-S-08** · B · scene · 목표 V 7.3 / A 5.8
- 장면: 밤거리에 형형색색 연등이 줄지어 걸려 있다.
- 단서: 축제 연등
- Prompt: `[STYLE] A street at night decorated with rows of colourful lotus lanterns overhead, a few cheerful passers-by softly blurred, street centred and receding, no text.`
- 쌍둥이 **NEU-S-208**: 같은 밤거리, 평범한 가로등. Δ `Same seed, street and framing; no lanterns, ordinary street lamps, no passers-by, same overall brightness after normalization.`

**POS-O-03** · B · object · 목표 V 7.2 / A 5.0
- 장면: 포장지에 싸인 화사한 꽃다발이 탁자에 놓여 있다.
- 단서: 선물용 꽃다발
- Prompt: `[STYLE] A fresh colourful bouquet of tulips and roses wrapped in kraft paper with a satin ribbon, lying on a wooden table, bouquet centred, eye-level view.`
- 쌍둥이 **NEU-O-203**: 같은 종이에 싸인 회색 수건 뭉치. Δ `Same seed, kraft paper, table and framing; the paper wraps a rolled plain grey towel instead of flowers, no ribbon.`

**POS-O-04** · B · object · 목표 V 7.1 / A 5.6
- 장면: 금빛 트로피와 메달 주위에 색종이가 흩어져 있다.
- 단서: 우승 트로피 (성취·축하)
- Prompt: `[STYLE] A shiny gold trophy cup and a gold medal on a ribbon on a table with scattered confetti, trophy centred, eye-level view, no engraving or text.`
- 쌍둥이 **NEU-O-204**: 같은 자리의 무광 스테인리스 물병. Δ `Same seed, table and framing; replace the trophy and medal with a plain matte steel water bottle, no confetti.`

---

### 4.4 중립 채움 (NEU-x-3nn) — 30장
중립–중립 기준 시행과 중립 풀 여유분입니다. 모두 목표 V 5.0 / A ≤ 3.0, 편안한 무표정, 균일한 낮 조명.

#### 세트 A
| ID | content | 장면 정의 | Prompt (`[STYLE]` + 아래) |
|---|---|---|---|
| NEU-P-301 | person | 30대 여성이 사무실 책상에서 노트북으로 일한다 | `A Korean woman in her 30s typing on a laptop at an office desk, relaxed neutral expression, waist-up shot, screen not visible.` |
| NEU-P-302 | person | 40대 남성이 버스 정류장에서 기다린다 | `A Korean man in his 40s in a grey jacket waiting at a daytime bus stop, hands in pockets, relaxed neutral face looking at the camera, waist-up shot, no signs.` |
| NEU-P-303 | person | 60대 남성이 공원 벤치에 앉아 있다 | `A Korean man in his 60s sitting upright on a park bench, hands on his knees, relaxed neutral face, mid shot, soft daylight.` |
| NEU-P-304 | person | 20대 남성이 택배 상자를 옮긴다 | `A Korean man in his 20s carrying a plain cardboard box in an apartment hallway, relaxed neutral face, waist-up shot, no labels.` |
| NEU-P-305 | person | 50대 여성이 베란다에서 빨래를 넌다 | `A Korean woman in her 50s hanging plain towels on a drying rack on an apartment balcony, relaxed neutral face, waist-up shot.` |
| NEU-P-306 | person | 20대 여성이 엘리베이터 안에 서 있다 | `A Korean woman in her 20s standing in a plain elevator holding a tote bag, relaxed neutral face looking at the camera, waist-up shot, no buttons with numbers visible.` |
| NEU-A-301 | animal | 목장에서 소가 풀을 뜯는다 | `A brown cow grazing in a green pasture, side view, whole animal visible, soft overcast light.` |
| NEU-A-302 | animal | 보도 위의 비둘기 | `A grey pigeon standing on a paved sidewalk, whole bird visible, eye-level close to the ground.` |
| NEU-A-303 | animal | 마당의 암탉 | `A brown hen standing in a dirt farmyard, whole bird visible, soft daylight.` |
| NEU-S-301 | scene | 평범한 사무실 | `An ordinary open-plan office with desks and chairs, nobody present, room centred, even daylight, no screens with text.` |
| NEU-S-302 | scene | 낮의 지하 주차장 | `An evenly lit underground parking garage with a few parked cars, nobody present, centred perspective.` |
| NEU-S-303 | scene | 아파트 복도 | `An apartment building corridor with closed doors, nobody present, even daylight, no numbers on doors.` |
| NEU-S-304 | scene | 마트 통로 | `A supermarket aisle with shelves of plain unlabelled boxes, nobody present, centred perspective, even light.` |
| NEU-O-301 | object | 사무용 의자 | `A plain grey office chair in front of a white wall, chair centred, eye-level view.` |
| NEU-O-302 | object | 책상 위 머그컵 | `A plain white ceramic mug on a wooden desk beside a closed notebook, mug centred, eye-level view.` |

#### 세트 B
| ID | content | 장면 정의 | Prompt (`[STYLE]` + 아래) |
|---|---|---|---|
| NEU-P-307 | person | 30대 남성이 횡단보도 앞에서 신호를 기다린다 | `A Korean man in his 30s waiting at a crosswalk on a city street, holding a backpack strap, relaxed neutral face looking at the camera, waist-up shot, no signs.` |
| NEU-P-308 | person | 40대 여성이 지하철 좌석에 앉아 있다 | `A Korean woman in her 40s sitting on a subway seat with a handbag on her lap, relaxed neutral face, waist-up shot, no screens or text.` |
| NEU-P-309 | person | 50대 남성이 설거지를 한다 | `A Korean man in his 50s washing dishes at a kitchen sink, relaxed neutral face, waist-up shot, soft daylight.` |
| NEU-P-310 | person | 60대 여성이 채소를 다듬는다 | `A Korean woman in her 60s trimming green onions at a kitchen table, relaxed neutral face, waist-up shot.` |
| NEU-P-311 | person | 20대 남성이 운동화 끈을 맨다 | `A Korean man in his 20s sitting on a bench tying the laces of plain white sneakers, relaxed neutral face, mid shot, no logos.` |
| NEU-P-312 | person | 30대 여성이 복사기를 쓴다 | `A Korean woman in her 30s using a photocopier in an office, relaxed neutral face, waist-up shot, no display text.` |
| NEU-A-304 | animal | 들판의 염소 | `A white goat standing in a grassy field, side view, whole animal visible, soft daylight.` |
| NEU-A-305 | animal | 나뭇가지 위 참새 | `A sparrow perched on a bare branch, whole bird visible, plain soft background.` |
| NEU-A-306 | animal | 연못의 잉어 | `A single orange-and-white carp swimming near the surface of a clear pond, whole fish visible, top-down slight angle.` |
| NEU-S-305 | scene | 도서관 서가 통로 | `A library aisle between tall bookshelves with plain spines (no readable text), nobody present, centred perspective, even light.` |
| NEU-S-306 | scene | 빨래방 | `A self-service laundromat with a row of washing machines, nobody present, even daylight, no text.` |
| NEU-S-307 | scene | 낮의 기차 승강장 | `A train station platform in daytime with no train, nobody present, centred perspective, no signs.` |
| NEU-S-308 | scene | 학교 복도 | `A school corridor with windows and closed classroom doors, nobody present, even daylight, no text.` |
| NEU-O-303 | object | 스테이플러와 종이 더미 | `A grey stapler on a neat stack of blank paper on a desk, centred, eye-level view.` |
| NEU-O-304 | object | 탁자 위 접이식 우산 | `A closed navy folding umbrella lying on a light wooden table, centred, eye-level view.` |

---

## 5. 제작 순서와 검수 체크리스트

### 5.1 제작 순서
| 단계 | 내용 | 산출물 / 통과 기준 |
|---|---|---|
| 1. 생성 | 4장 프롬프트로 정서 사진 생성(후보 3–4장 중 1장 선택) → 2.5 원칙으로 쌍둥이 편집 → 채움 사진 생성 | 210장 + 생성 로그 |
| 2. 결함 검수 | **2인이 독립적으로** 2.6·5.3 체크리스트 적용. 한 명이라도 탈락이면 재생성. 의견 불일치는 제3자 판정 | 탈락 코드 기록, 재생성 반복 |
| 3. 휘도·대비 정규화 | 2.7 절차. 범주별 평균 휘도 차 ±5, 쌍둥이 차 ±8 확인 | M·SD·채도 표 |
| 4. SAM 평정 | 사진당 **최소 20명(가능하면 30명 이상)**, 정서가·각성가 9점 SAM (README 4장). 무작위 순서, 한 번에 60장 이하, 중간 휴식. 평정자에게 불쾌 사진 포함 고지·중단 권리 안내 | 사진별 평균·SD |
| 5. 선정 | README 선정 기준 적용(위협 V≤3.5·A≥5.5 / 슬픔 V≤3.5·A 3.5–5.5 / 긍정 V≥6.5·A 4.5–6.5 / 중립 V 4.5–5.5·A≤3.5). 평정 SD > 2.2 인 사진은 해석이 갈리므로 우선 제외 | 통과 목록 |
| 6. A/B 균형 | 범주·content 별로 통과 사진을 정서가 순으로 정렬해 A-B-B-A 로 번갈아 배정 → 범주별 정서가·각성가·휘도 평균의 A–B 차이를 비교(독립 t검정 p > .20, 그리고 \|Δ정서가\| < 0.3, \|Δ각성가\| < 0.3, \|Δ휘도\| < 3). 맞지 않으면 1–2장 교환 | 세트당 위협 12 · 슬픔 12 · 긍정 12 · 중립 48 |
| 7. manifest 등록 | 5.2 형식으로 등록. 여분은 `exclude: true` 로 남겨 두면 교체가 쉬움 | `manifest.json`(A), `manifest.B.json` |
| 8. 파일럿 | 20명 이상 웹캠 실측. 중립–중립 쌍 좌우 응시 50%±5% 근처, 범주별 편향의 반분 신뢰도 확인. 특정 사진에서 체류가 비정상적으로 큰 경우(결함·글자 의심) 재검수 | 파일럿 보고, 최종 확정 |

> AI 생성 사진은 4–5단계 탈락률이 높습니다. 210장(약 25% 여유)으로 부족하면 같은 장면 정의로 재생성하되, ID 는 새 번호를 이어서 씁니다(재사용 금지).

### 5.2 manifest.json 예시
```json
{
  "version": 1,
  "form": "A",
  "images": [
    { "id": "THR-P-01", "file": "A/thr_person_01.jpg", "category": "threat", "content": "person",
      "valence": 2.9, "arousal": 6.4, "luminance": 128, "twin": "NEU-P-001" },
    { "id": "NEU-P-001", "file": "A/neu_person_001.jpg", "category": "neutral", "content": "person",
      "valence": 5.1, "arousal": 2.6, "luminance": 131, "twin": "THR-P-01" },
    { "id": "DYS-A-02", "file": "A/dys_animal_02.jpg", "category": "dysphoric", "content": "animal",
      "valence": 3.2, "arousal": 4.1, "luminance": 124, "twin": "NEU-A-102" },
    { "id": "POS-O-02", "file": "A/pos_object_02.jpg", "category": "positive", "content": "object",
      "valence": 6.7, "arousal": 4.9, "luminance": 140, "twin": "NEU-O-202",
      "exclude": true, "note": "파일럿에서 좌우 쏠림 — 재검토" }
  ]
}
```
- 필수: `id`, `file`, `category`, `content`. 권장: `valence`, `arousal`, `luminance`(평정·보정 결과). 선택: `twin`, `note`, `exclude`.
- `exclude: true` 인 항목은 검사가 읽지 않습니다(`loadStimuli` 의 `!x.exclude`). 등록된 사진 수가 최소 수량(표준 12·12·12·48 / 빠른 6·6·6·26)보다 적으면 검사는 도식 자극으로 돌아가므로, `exclude` 처리 후 수량을 반드시 다시 셉니다.
- 사진 하나라도 불러오기에 실패하면 검사 전체가 도식 자극으로 바뀝니다(`preload`). 등록 후 파일 경로 대소문자·확장자를 확인합니다.

### 5.3 사진별 QA 체크리스트
**생성 직후 (검수자 2인 각각)**
- [ ] 장면 정의와 핵심 단서가 이 문서와 일치한다 (단서가 **하나**, 한눈에 보인다)
- [ ] 범주가 흐르지 않았다 (위협→혐오, 슬픔→위협, 긍정→스톡 미소, 중립→분위기)
- [ ] 강도 한계 안이다 (피·상처·시신·성적 요소·실제 사건 연상·고통받는 아동 없음)
- [ ] 2.6 AI 결함 항목에 해당 없음
- [ ] 글자·숫자·로고·워터마크 없음 (확대해서 배경까지 확인)
- [ ] 인물: 한국인 성인, 문서의 성별·연령대와 일치, 실존 인물·유명인과 닮지 않음
- [ ] 구도: 대상이 가운데, 화면의 30–60%, 눈높이, 기울기 없음
- [ ] 조명·색이 과장되지 않음 (역광·노을·네온·HDR 없음)

**쌍둥이 확인**
- [ ] 같은 content, 같은 구도·크기·위치·배경
- [ ] 바뀐 것은 정서 단서 하나뿐 (인물이면 같은 사람·옷, 시선 방향 동일)
- [ ] 쌍둥이 자체에 미소·슬픔·위협 흔적이 남지 않음

**후처리 후**
- [ ] 4:3, 1024×768 이상, JPG q85, sRGB, EXIF 제거
- [ ] 평균 휘도 110–150, 쌍둥이와 차이 ±8 이내, 채도 0.45 이하
- [ ] 파일명·ID 가 1.3 규칙과 일치, 생성 로그 기록 완료

### 5.4 탈락 사유 코드
| 코드 | 사유 |
|---|---|
| D1 | 손·손가락 결함 |
| D2 | 얼굴·눈 결함 (비대칭, 동공·시선 이상, 플라스틱 피부) |
| D3 | 치아 결함 |
| D4 | 몸·사지 결함 (개수·방향·융합), 동물 해부 이상 |
| D5 | 배경 녹음·왜곡·반복 복제 |
| D6 | 글자·숫자·로고·워터마크 흔적 |
| D7 | 실존 인물·유명인 닮음 |
| C1 | 범주 이탈 (예: 위협이 혐오로, 슬픔이 위협으로, 중립에 분위기) |
| C2 | 강도 초과 (2.4 금지 항목) |
| C3 | 단서 불명확 또는 단서 둘 이상 |
| C4 | 쌍둥이 불일치 (구도·인물·크기 다름, 단서 잔존) |
| C5 | content 불일치 또는 인물 구성(성별·연령) 불일치 |
| C6 | 문화적 부적합·고정관념 (특정 지역·직업·집단 비하 암시 등) |
| T1 | 휘도·대비·채도 기준 밖 (보정 시 부자연스러움) |
| T2 | 해상도·비율·구도(크기 30–60%, 눈높이) 기준 밖 |
| T3 | 파일 형식·EXIF·파일명 오류 |
| R1 | SAM 평정 범주 기준 미달 |
| R2 | 평정 분산 과다 (SD > 2.2) |
| R3 | A/B 균형 맞추기에서 제외 (여분으로 `exclude: true` 보관) |
| R4 | 파일럿 이상 (중립 쌍 쏠림, 비정상 체류) |

---

## 6. 윤리·법적 고지

- **AI 생성 고지**: 모든 사진은 AI 로 생성된 합성 이미지입니다. 검사 안내 또는 리포트의 참고 영역에 "정서 자유 보기에 쓰인 사진은 AI 로 생성한 것으로, 실제 인물·사건이 아닙니다" 문구를 넣습니다(앱 문구 반영은 별도 작업). 평정 참여자에게도 같은 내용을 알립니다.
- **실존 인물 닮음 금지**: 프롬프트에 실존 인물·유명인 이름, 특정 인물 사진을 참조 이미지로 넣지 않습니다. 검수에서 닮음이 의심되면(D7) 탈락시킵니다. 장소도 특정 실제 장소·참사 현장을 알아볼 수 있게 만들지 않습니다.
- **생성 도구 라이선스**: 상업 서비스에 쓰므로, 생성 시점의 이용약관에서 **상업적 이용이 허용된 플랜·모델**만 씁니다(예: Midjourney 유료 플랜, OpenAI 이미지 API 약관, SDXL 의 CreativeML Open RAIL++-M, Flux 는 상업 허용 버전(예: schnell, pro/API) — **FLUX.1 [dev] 기본 라이선스는 비상업용**이므로 쓰지 않음). 도구·버전·약관 확인일을 생성 로그에 남기고, 약관 스크린샷/PDF 를 함께 보관합니다. 최종 판단은 법무 검토를 따릅니다.
- **참여자 보호**: 앱은 이미 시작 동의 문구("정서 검사에는 일부 불쾌감을 줄 수 있는 사진이 포함되며 언제든 건너뛸 수 있습니다")와 단계 안내("불편하면 언제든 '이 단계 건너뛰기'를 누르세요")를 보여 주고, 측정 화면 오른쪽 위의 **'이 단계 건너뛰기'** 로 언제든 넘어갈 수 있습니다. 사진 세트는 이 고지 범위(일상적 불쾌감, 2.4 강도 한계)를 넘지 않아야 합니다.
- **건너뛰기 권리**: 건너뛴 단계는 '건너뜀'으로 표시되어 판정에서 빠지며 불이익이 없습니다. 평정 연구 참여자에게도 언제든 중단할 권리를 보장합니다.
- **운영 가정**: 세트 A/B 교체는 manifest 파일 교체로 한다고 가정했습니다(현재 코드는 manifest 하나만 읽음). 자동 교대가 필요하면 코드 변경이 별도로 필요합니다.
