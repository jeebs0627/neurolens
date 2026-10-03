-- NeuroLens NewBiz — 연구용 측정 데이터 수집 (newbiz.html, 참가자 별도 동의 시에만)
--
-- 저장하는 것: 측정 지표 요약(summary) + 압축된 측정 신호(chunks: 프레임별 얼굴 특징·피부색 평균·시선 특징,
--             눈·홍채 랜드마크 좌표, 시행별 시선 표본·반응, 보정 표적 기록). 카메라 영상·이미지는 저장하지 않는다.
-- 저장하지 않는 것: 이름·연락처·계정·IP. 최근 2주 기분(PHQ) 응답은 참가자가 따로 동의한 경우에만 summary 에 포함.
--
-- 보안 모델(care_* 와 같은 방식): 두 테이블 모두 RLS 활성 + 정책 없음 → publishable 키로 직접 조회·삽입 불가.
-- 쓰기는 아래 newbiz_research_* RPC(security definer)로만 가능하며, 세션마다 발급한 업로드 토큰(sha256 해시만 저장)을
-- 가진 브라우저만 그 세션에 조각을 올리거나 철회할 수 있다. 읽기는 service_role(연구자)만.

create table if not exists public.newbiz_research_sessions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                       -- 참가 코드 (철회·문의용, 예: NLR-7K2Q9M)
  token_hash    text not null,
  status        text not null default 'uploading' check (status in ('uploading', 'complete')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  consent       jsonb not null,                             -- {version, research:true, phq:bool, at}
  meta          jsonb not null,                             -- 프로토콜·알고리즘 버전, 화면·카메라·브라우저 계열, 측정 모드
  summary       jsonb not null,                             -- 영역·지표·QC·체크인(맥락 포함) — 라벨/목표값으로 쓰는 요약
  chunk_count   int,
  payload_bytes int,
  payload_sha256 text
);
create index if not exists newbiz_research_sessions_created_idx on public.newbiz_research_sessions (created_at desc);

create table if not exists public.newbiz_research_chunks (
  session_id uuid not null references public.newbiz_research_sessions (id) on delete cascade,
  idx        int  not null check (idx between 0 and 63),
  data       text not null,                                 -- base64(gzip(JSON)) 조각
  primary key (session_id, idx)
);

alter table public.newbiz_research_sessions enable row level security;
alter table public.newbiz_research_chunks enable row level security;
revoke all on public.newbiz_research_sessions from anon, authenticated;
revoke all on public.newbiz_research_chunks from anon, authenticated;

-- 1) 세션 시작: 동의·메타·요약을 받고 (session_id, code, upload_token) 반환
create or replace function public.newbiz_research_begin(p_consent jsonb, p_meta jsonb, p_summary jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_code  text;
  v_id    uuid;
  v_today int;
begin
  if p_consent is null or coalesce((p_consent ->> 'research')::boolean, false) is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if pg_column_size(p_meta) > 32768 or pg_column_size(p_summary) > 262144 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;
  select count(*) into v_today from public.newbiz_research_sessions where created_at > now() - interval '1 day';
  if v_today >= 5000 then
    raise exception 'daily_cap' using errcode = '53400';
  end if;
  loop
    v_code := 'NLR-' || upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when length(v_code) = 10 and not exists (select 1 from public.newbiz_research_sessions where code = v_code);
  end loop;
  insert into public.newbiz_research_sessions (code, token_hash, consent, meta, summary)
  values (v_code, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_consent, p_meta, p_summary)
  returning id into v_id;
  return jsonb_build_object('session_id', v_id, 'code', v_code, 'upload_token', v_token);
end $$;

-- 2) 신호 조각 업로드 (조각당 600KB 이하, 최대 64개 = 약 38MB)
create or replace function public.newbiz_research_chunk(p_session uuid, p_token text, p_idx int, p_data text)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  if length(p_data) > 600000 or p_idx < 0 or p_idx > 63 then
    raise exception 'bad_chunk' using errcode = '22023';
  end if;
  if not exists (select 1 from public.newbiz_research_sessions
                 where id = p_session and status = 'uploading'
                   and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
                   and created_at > now() - interval '2 hours') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.newbiz_research_chunks (session_id, idx, data) values (p_session, p_idx, p_data)
  on conflict (session_id, idx) do update set data = excluded.data;
  return true;
end $$;

-- 3) 완료: 조각 수·바이트·해시를 기록하고 잠근다 (이후 조각 추가 불가)
create or replace function public.newbiz_research_finish(p_session uuid, p_token text, p_chunks int, p_bytes int, p_sha256 text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_n int;
begin
  if not exists (select 1 from public.newbiz_research_sessions
                 where id = p_session and status = 'uploading'
                   and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*) into v_n from public.newbiz_research_chunks where session_id = p_session;
  if v_n <> p_chunks then
    raise exception 'chunk_mismatch' using errcode = '22023';
  end if;
  update public.newbiz_research_sessions
     set status = 'complete', completed_at = now(), chunk_count = p_chunks, payload_bytes = p_bytes, payload_sha256 = left(p_sha256, 64)
   where id = p_session;
  return true;
end $$;

-- 4) 철회: 업로드 토큰을 가진 브라우저가 언제든 자기 세션을 완전히 삭제
create or replace function public.newbiz_research_withdraw(p_session uuid, p_token text)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_n int;
begin
  delete from public.newbiz_research_sessions
   where id = p_session and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- 미완료 업로드 정리 (pg_cron 이 있으면 매일 실행)
create or replace function public.newbiz_research_purge_stale()
returns int language plpgsql security definer set search_path to '' as $$
declare v_n int;
begin
  delete from public.newbiz_research_sessions where status = 'uploading' and created_at < now() - interval '1 day';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.newbiz_research_begin(jsonb, jsonb, jsonb) from public;
revoke execute on function public.newbiz_research_chunk(uuid, text, int, text) from public;
revoke execute on function public.newbiz_research_finish(uuid, text, int, int, text) from public;
revoke execute on function public.newbiz_research_withdraw(uuid, text) from public;
revoke execute on function public.newbiz_research_purge_stale() from public, anon, authenticated;
grant execute on function public.newbiz_research_begin(jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.newbiz_research_chunk(uuid, text, int, text) to anon, authenticated;
grant execute on function public.newbiz_research_finish(uuid, text, int, int, text) to anon, authenticated;
grant execute on function public.newbiz_research_withdraw(uuid, text) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('newbiz-research-purge', '17 4 * * *', 'select public.newbiz_research_purge_stale()');
  end if;
end $$;
