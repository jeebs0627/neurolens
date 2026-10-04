# 신규 사진 210장 검수 기록

저장 위치: `C:\Users\xshon\Desktop\neurolens-main\newbiz-stim`

A 105장 / B 105장. THR 30장, DYS 30장, POS 30장, NEU 120장.

파일 기술 검사는 verification_final.json, 개별 프롬프트·측정값·예비 시각 점검은 generation_audit.json에 기록했습니다.

## 완료되지 않은 연구 검증

- 210장 모두 독립된 2명의 사람에 의한 시각 검수와 SAM 평가가 필요합니다. 현재 연구 사용 승인 상태는 미승인입니다.
- 정서 범주별 SAM 기준, 평정 표준편차, A/B 정서 통계적 동등성 및 파일럿 정확도·신뢰도를 아직 평가하지 않았습니다.
- 주피사체 면적 30–60%는 정량 측정하지 않았습니다. 새·단독 물병 등 작은 피사체와 쌍의 면적 차이를 먼저 확인하십시오.
- 도구에서 모델 버전과 시드를 제공하지 않아 동일 시드 생성 조건은 확인할 수 없습니다. 중립 쌍은 원본 이미지 참조 편집으로 생성했습니다.
- POS-P-09 / NEU-P-209는 사용자가 허용한 예외에 따라 두 이미지 모두 서로를 보는 시선을 유지했습니다.

## 명시적 보류 목록

- NEU-A-306: Provisional model visual check: single orange-white carp in clear shallow pond, slight overhead view follows individual specification. First clipping-prone export excluded, protected export selected. HOLD for independent human review of pale fish highlights and repeated patterned pond-floor texture; formal SAM/area review pending.
- POS-A-04, NEU-A-204: Selected fresh candidate 4 after rejecting sand-texture defects in edits of candidate 1; whole corgi and single frontal seagull anatomically plausible, beach/island composition retained. Shadow-protected tonal export passes numeric limits. HOLD for independent human artifact review: neutral sand in focal plane has fine curled texture; confirm ordinary sand and absence of generated glyph-like artifacts. Emotional puppy size and neutral valence require formal SAM/pilot, not performed.
- POS-O-04, NEU-O-204: Candidate3 trophy with plain gold medal and confetti, no engraving/writing. Initial gloss bottle excluded, local surface edit provides matte diffuse steel, no medal/confetti, same table/wall/framing. Technical pair checks pass1280. HOLD for independent human review of wood-grain curls in neutral table, physical diffuse metal finish and neutral bottle subject-area/width difference. Formal SAM/pilot not performed.
- POS-S-07, NEU-S-207: Candidate 4 regenerated with broad water and larger boulders after candidate 3 exceeded 300 KB at 1024/Q85; candidate 4 pair conforms at 1024. Same valley/rocks/stream framing, red-orange maple vs green foliage under overcast sky. HOLD for independent human artifact review: altered fine curled/lichen-like marks on neutral foreground and side boulders. Formal SAM especially scenic neutral valence and pilot not performed.

## 우선 확인 대상

- 중립 인물의 약한 미소·쾌적한 결혼식/해변/계곡/공원 맥락이 중립 SAM 범위를 벗어나는지 확인하십시오.
- 밤 거리·불꽃놀이/도시 및 흐린 바다의 밝기 조정 뒤 자연스러움과 감정 강도를 확인하십시오.
- 손가락·손잡이·끈·복사기 구조, 새의 발·소의 다리, 빵 껍질·바위·목재·수건·잔디 질감, 남아 있는 작은 문자/로고 모양을 확인하십시오.
- 모든 장면에서 실제 주피사체 면적·촬영 시점·한국적 맥락 및 정서 쌍의 배경/구도 일치도를 독립 검토하십시오.

기존 파일은 복사 시 overwrite=false로 보호했습니다. 원래 명세와 README는 해시로 변경 여부를 확인했습니다. 이 작업 중 발견된 A/B 밖의 calm/scape_02.jpg는 작업 대상에서 제외하고 그대로 두었습니다.

README.md는 초기 해시와 달라졌고, 현재 calm/scape_02.jpg 관련 베이스라인 설명을 포함합니다(수정 시각 UTC 2026-10-03 13:51:44). 이 사진 생성 작업에서는 README를 쓰지 않았으며 현재 파일을 보존했습니다. PHOTO_SPEC.md 해시는 초기 값과 같습니다. 원본 변경 감지 결과는 사진 210장의 기술 검사 실패와 구분하여 기록했습니다.
