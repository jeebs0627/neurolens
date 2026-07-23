# Supabase 설정 가이드 (NeuroLens 회원가입/검사이력)

회원가입 · 로그인 · 검사 결과 저장 · 관리자 페이지가 동작하려면 아래 4단계만 하면 됩니다.
(약 10분 소요, 무료 플랜으로 충분)

---

## 1단계. Supabase 프로젝트 만들기

1. https://supabase.com 접속 → 가입/로그인 → **New Project**
2. 프로젝트 이름(예: `neurolens`), DB 비밀번호, 리전(**Northeast Asia (Seoul)** 권장) 선택 후 생성
3. 생성 완료까지 1~2분 대기

## 2단계. API 키를 코드에 넣기

1. 대시보드 좌측 **Settings(톱니) → API** 메뉴
2. 두 값을 복사:
   - **Project URL** (예: `https://abcdefgh.supabase.co`)
   - **anon public** key (`eyJ...` 로 시작하는 긴 문자열)
3. 프로젝트 폴더의 **`supabase-config.js`** 파일을 열어 교체:

```js
window.NL_SUPABASE = {
  url: 'https://abcdefgh.supabase.co',   // ← 내 Project URL
  anonKey: 'eyJhbGciOiJIUzI1NiIs...',    // ← 내 anon public key
};
```

> anon key는 공개되어도 되는 키입니다(브라우저용). 단, **service_role key는 절대 넣지 마세요.**

## 3단계. 테이블 + 보안정책(SQL) 실행

대시보드 좌측 **SQL Editor → New query**에 아래 SQL 전체를 붙여넣고 **Run** 한 번 실행:

```sql
-- ═══════════════ 1) 회원 프로필 테이블 ═══════════════
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  role       text not null default 'user',   -- 'user' | 'admin'
  created_at timestamptz not null default now()
);

-- 가입 시 프로필 행 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════ 2) 검사 결과 테이블 ═══════════════
create table public.test_results (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text,
  mbti       text,
  holland    text,
  result     jsonb not null,          -- 검사 결과 원본 JSON 전체
  created_at timestamptz not null default now()
);

create index test_results_user_idx on public.test_results (user_id, created_at desc);

-- ═══════════════ 3) 관리자 판별 함수 ═══════════════
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ═══════════════ 4) Row Level Security ═══════════════
alter table public.profiles     enable row level security;
alter table public.test_results enable row level security;

-- 프로필: 본인 조회 + 관리자는 전체 조회
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id or public.is_admin());
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- 검사결과: 본인 것 조회/저장 + 관리자는 전체 조회
create policy "results_select" on public.test_results
  for select using (auth.uid() = user_id or public.is_admin());
create policy "results_insert_own" on public.test_results
  for insert with check (auth.uid() = user_id);
```

## 4단계. 이메일 인증 방식 선택 (선택사항)

기본값은 "가입 → 인증 메일 클릭 → 로그인 가능"입니다.
데모/실증처럼 **인증 메일 없이 바로 로그인**되게 하려면:

- **Authentication → Sign In / Providers → Email** 에서 **Confirm email 을 OFF**

인증 메일을 쓸 경우에는 **Authentication → URL Configuration → Site URL**에
배포 주소(예: `https://neurolens.vercel.app`)를 넣어주세요. (메일의 링크가 이 주소로 돌아옵니다)

---

## 관리자 계정 만들기

1. 사이트에서 관리자로 쓸 이메일로 **일반 회원가입**을 먼저 합니다.
2. SQL Editor에서 아래 한 줄 실행:

```sql
update public.profiles set role = 'admin' where email = '관리자이메일@example.com';
```

3. 이제 그 계정으로 `admin.html` 접속 시 관리자 대시보드가 열립니다.

---

## 파일 구성 요약

| 파일 | 역할 |
|---|---|
| `supabase-config.js` | **(수정 필요)** Supabase URL/anon key |
| `auth.js` | 가입·로그인·결과저장 공통 모듈 |
| `index.html` | 메인 — 우측 상단 로그인/마이페이지, 검사 후 결과 저장 |
| `report.html` | 검사 결과 리포트 (새 창) — `?id=결과ID` 또는 직전 검사 |
| `admin.html` | 관리자 — 회원 리스트/검사 현황 |
| `result.html` | 가상 데이터 샘플 리포트 (기존 유지) |

## 동작 방식 메모

- **비로그인 검사도 가능**: 결과는 브라우저(localStorage)에만 저장되고 리포트도 열리지만, 마이페이지 이력에는 남지 않습니다.
- **로그인 후 검사**: 결과가 Supabase `test_results`에 저장되어 마이페이지 → 검사 내역에서 언제든 다시 열람할 수 있습니다.
- 보안은 Supabase RLS로 처리되어, 일반 회원은 본인 결과만 / 관리자(role='admin')만 전체 조회가 가능합니다.
