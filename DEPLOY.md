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

- 검사하기 버튼 → 새 창(test.html · NeuroLens 바 아래 엔진 iframe) → 「검사시작」부터는 엔진이 target="_top" 으로
  팝업 전체를 차지함(엔진 로고 노출 · MindGaze 측 수정 필요) → 측정 완료 → /rcvrslt 가 결과 리포트(report.html)로 전환 (localStorage + postMessage 경로)
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

## AI 호출 통제 및 검사 로그인

- `supabase/migrations/20261024_ai_call_guard.sql`은 프롬프트·실제 IP·평문 리포트 없이 공유 호출 한도와
  암호화된 응답 캐시를 관리합니다. 전체 외부 AI 호출은 한국 시간 자정 기준 하루 300회이며 재시도도 포함합니다.
  회원당(비회원은 서버 세션당) 하루 30회, IP당 시간당 100회, 한 요청에서 외부 재시도는 최대 4회입니다.
- 배포 전에 40자 이상 무작위 `AI_GUARD_SECRET`을 Vercel 서버 환경변수에 설정하고, 동일 문자열의 SHA-256
  해시만 `public.ai_guard_config.secret_sha256`에 설정해야 합니다. 원문을 Git·브라우저 코드·SQL 기록에 넣지 않습니다.
  설정 누락이나 한도 저장소 장애 시 외부 AI를 호출하지 않으며, 측정 결과와 기본 해설은 계속 표시됩니다.
- `api/ai-session`은 Secure·HttpOnly·SameSite 쿠키를 발급합니다. Gemini·MBTI·감정 해설은 서버 세션이,
  컨디션 해설은 추가로 유효한 Supabase 로그인이 필요합니다. `probe` 진단 요청은 관리자만 실행할 수 있습니다.
- 마인드컨디션 실제 검사·대화형 체험은 로그인 후 진행합니다. 공개 합성 샘플 리포트에는 카메라나 연구 전송이 없습니다.
- 호출 제한은 이 네 AI 해설 API에 적용합니다. 별도 Supabase 챗봇과 연구자 데이터 분석 함수의 쿼터는 별도입니다.
- 비용은 호출 횟수와 요청당 출력·재시도 상한으로 제한합니다. 300회는 금액 한도가 아니며 모델별 실제 요금은 다릅니다.

## 배포 전 자동 검사

- `npm ci --prefix ci`, `python -m pip install -r requirements.txt` 후 `python -B ci/check.py`를 실행합니다.
  Windows에서는 설치된 Edge를, Linux에서는 `node ci/node_modules/playwright/cli.js install chromium --only-shell`로
  설치한 브라우저를 사용합니다. Vercel은 기본 OS에 브라우저 시스템 라이브러리가 없어 빌드 전용
  `@sparticuz/chromium`을 사용하며 이 패키지는 공개 자산·서버 함수에 포함하지 않습니다.
  검사에 실제 AI 키·회원 데이터는 사용하지 않습니다.
- Vercel의 `buildCommand`도 같은 검사를 실행하며 하나라도 실패하면 배포 빌드가 실패합니다.
  모든 검사를 통과한 뒤에만 `.site` 정적 배포 폴더를 생성합니다. API는 기존 경로에서 서버 함수로 유지합니다.
- 테스트·빌드 도구는 빌드에 필요해 업로드될 수 있지만 `.site`에 포함되지 않아 공개 URL로 제공되지 않습니다.
  `.vercelignore`와 `ci/public_files.py`의 역할은 각각 업로드 경계와 정적 공개 경계입니다.
- GitHub Actions도 같은 검사를 실행합니다. 기존 데이터 변경 기록 워크플로는 그대로 유지합니다.

## 대표 주소 유지

- 대표 주소는 `https://www.neurolens.me` 입니다. 메인·컨디션 canonical, 공유 이미지, JSON-LD,
  `robots.txt`의 Sitemap, `sitemap.xml`을 함께 유지합니다. API·콜백의 호스트와 기존 접근 주소는 변경하지 않습니다.
- `.vercelignore`는 웹 자산·API·서버 의존성과 검증에 필요한 빌드 입력만 허용합니다.
  출원 초안과 연구 원자료는 업로드하지 않고, 테스트와 빌드 도구는 정적 공개 폴더에서 제외합니다.
- 배포 전 `python -B tools/deployment_safety_test.py`를 실행해 제외 대상과 서비스 의존 파일·대표 주소의
  일관성을 확인합니다. 별도 패키지 설치나 서비스 인증 정보는 필요하지 않습니다.
- 새 자산 폴더나 서버 의존성을 추가할 때는 `.vercelignore`와 위 검사의 허용 경로도 함께 갱신합니다.
  운영 반영 후 서비스 자산은 200, 제외 파일은 404인지 확인합니다. 기존 과거 배포 URL은 별도 관리 대상입니다.
