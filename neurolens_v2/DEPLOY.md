# NeuroLens — GitHub + Vercel 배포 가이드

## 프로젝트 구조 (배포 준비 완료)

```
mindgaze/
├── index.html          # 메인 페이지 (정적 서빙)
├── vercel.json         # /gemini, /rcvrslt, /mg/* → api/ 함수 라우팅
├── api/
│   ├── gemini.py       # POST /gemini    — AI 총평 (환경변수 GEMINI_API_KEY 사용)
│   ├── rcvrslt.py      # POST /rcvrslt   — 검사 결과 수신 → postMessage
│   ├── last-result.py  # GET  /last-result — 폴링 스텁 (서버리스는 무상태)
│   └── mg.py           # GET  /mg/*      — MindGaze API 프록시
├── .gitignore          # gemini.key 등 비밀키 제외
├── server.py           # (로컬 개발용 — 배포에는 사용되지 않음)
├── start.bat           # (로컬 개발용)
└── gemini.key          # 로컬용 API 키 — git에 올라가지 않음
```

## 1. GitHub에 올리기

Git이 설치되어 있다면, 이 폴더에서:

```bash
git init
git add .
git commit -m "NeuroLens landing + Vercel serverless"
```

GitHub에서 새 저장소(예: `neurolens`)를 만든 뒤:

```bash
git remote add origin https://github.com/<계정명>/neurolens.git
git branch -M main
git push -u origin main
```

> 확인: `git status` 에 `gemini.key` 가 보이지 않아야 합니다 (.gitignore 처리됨).

## 2. Vercel 배포

1. https://vercel.com → **Add New → Project** → 방금 만든 GitHub 저장소 **Import**
2. Framework Preset: **Other** (그대로 두면 됨), Build 설정 변경 불필요
3. **Environment Variables** 에 추가:
   - `GEMINI_API_KEY` = (gemini.key 파일 안의 키 값)
4. **Deploy** 클릭 → `https://<프로젝트명>.vercel.app` 발급

## 3. 배포 후 확인 사항

- 검사하기 버튼 → 팝업 → 검사 완료 → 결과 리포트 표시 (postMessage 경로)
- AI 총평 생성 여부 (`/gemini` 함수 + 환경변수 확인)
- MindGaze 측 설정에 리턴 URL 도메인 제한이 있다면, 발급된
  `https://<프로젝트명>.vercel.app` 도메인을 허용 목록에 추가해야 할 수 있음

## 로컬 개발 (기존과 동일)

`start.bat` 실행 → http://localhost:8080
(server.py 는 gemini.key 파일에서 키를 읽음)

## 주의

- **API 키를 코드에 다시 하드코딩하지 마세요.** 커밋 이력에 한 번 올라가면 삭제해도 남습니다.
- `last-result` 폴링은 서버리스에서 항상 빈 값을 반환합니다(무상태).
  결과 전달은 postMessage로 정상 동작하며, 폴링까지 복원하려면 Vercel KV 연동이 필요합니다.
