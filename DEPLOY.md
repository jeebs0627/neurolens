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

- 검사하기 버튼 → 새 창(test.html · NeuroLens 바 아래 엔진 iframe) → 측정 완료 → 그 창이 결과 리포트(report.html)로 전환 (localStorage + postMessage 경로)
- AI 총평 생성 여부 (`/gemini` 함수 + 환경변수 확인)
- MindGaze 측 설정에 리턴 URL 도메인 제한이 있다면, 발급된
  `https://<프로젝트명>.vercel.app` 도메인을 허용 목록에 추가해야 할 수 있음

## 로컬 개발 (기존과 동일)

`start.bat` 실행 → http://localhost:8080
(server.py 는 gemini.key 파일에서 키를 읽음)

## 주의

- **API 키를 코드에 다시 하드코딩하지 마세요.** 커밋 이력에 한 번 올라가면 삭제해도 남습니다.
  GitHub 웹 업로드("Add files via upload")는 `.gitignore`를 적용하지 않으므로 `gemini.key`가 함께 올라갑니다.
  반드시 `git push`로 배포하세요. (2026-09-04: 노출된 키는 폐기·재발급 대상)
- `.vercelignore` 가 문서(*.md)·로컬 스크립트·PRD·`supabase/` 를 배포본에서 제외합니다.
  Vercel은 저장소의 모든 파일을 공개 URL로 서빙하므로 내부 문서를 루트에 두면 그대로 노출됩니다.
- `/gemini` 는 프롬프트가 아니라 구조화된 결과 필드만 받습니다(서버에서 프롬프트 조립). 같은 사이트에서 온
  요청만 처리하며, 총평은 리포트당 1회 생성해 `test_results.summary` 에 저장됩니다.
- `/last-result` 폴링 엔드포인트는 제거했습니다. 결과 전달은 `/rcvrslt` → localStorage + postMessage 입니다.
- DB 함수(care_* RPC)의 원본은 `supabase/migrations/` 입니다. Supabase 대시보드에서 직접 고치지 말고
  마이그레이션 파일을 추가한 뒤 적용하세요.
