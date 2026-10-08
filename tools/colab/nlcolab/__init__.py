"""nlcolab — NeuroLens CONDITION 학습 파이프라인 (Colab 은 이 패키지를 호출하는 실행 화면이다).

구성: canonical(JS 와 동일한 digest) · safe_io(안전 로더) · adapter(v1/v2/v3 세션 → canonical) · export(인증 내보내기) ·
inventory(적격성) · baseline(Node 엔진 재현) · gaze_dataset / splits / train_gaze(시선 잔차) · rppg_dataset / train_rppg(기준 오차 선택기) ·
evaluate · release(정책·manifest·registry 패치) · snapshot(불변 스냅샷·변경 탐지) · pipeline(체크포인트 배치) · cli.
합성 fixture 는 synthetic=True 로 격리되며 운영 업로드 경로가 없다."""
__version__ = "nlcolab-0.1.0"
