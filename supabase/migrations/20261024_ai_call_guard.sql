-- Atomic, server-only AI limits. No raw IPs, prompts, or plaintext reports are stored.
begin;
set local lock_timeout='5s';
create table if not exists public.ai_guard_config (
  singleton boolean primary key default true check(singleton),
  secret_sha256 text not null,
  daily_limit integer not null default 300 check(daily_limit between 1 and 100000)
);
create table if not exists public.ai_guard_sessions (
  id uuid primary key, ip_hash text not null, created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '1 day'
);
create table if not exists public.ai_guard_requests (
  session_id uuid not null references public.ai_guard_sessions(id) on delete cascade,
  request_key text not null, kind text not null, lease uuid not null,
  state text not null check(state in ('pending','done','failed')),
  response_cipher text, calls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(session_id,request_key)
);
create table if not exists public.ai_guard_calls (
  lease uuid not null, attempt integer not null, session_id uuid not null,
  ip_hash text not null, user_hash text not null, created_at timestamptz not null default now(),
  primary key(lease,attempt)
);
create index if not exists ai_guard_calls_created on public.ai_guard_calls(created_at);
alter table public.ai_guard_config enable row level security;
alter table public.ai_guard_sessions enable row level security;
alter table public.ai_guard_requests enable row level security;
alter table public.ai_guard_calls enable row level security;
revoke all on public.ai_guard_config,public.ai_guard_sessions,public.ai_guard_requests,public.ai_guard_calls from public,anon,authenticated;

create or replace function public.ai_guard(
  p_secret text,p_action text,p_session uuid,p_ip text,
  p_key text default '',p_kind text default '',p_lease uuid default null,
  p_attempt integer default 0,p_cipher text default null,p_user text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.ai_guard_config; req public.ai_guard_requests; n integer;
  today timestamptz := date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  select * into cfg from public.ai_guard_config where singleton;
  if cfg.secret_sha256 is null or length(coalesce(p_secret,''))<40
     or encode(sha256(convert_to(p_secret,'UTF8')),'hex')<>cfg.secret_sha256 then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_ip !~ '^[a-f0-9]{64}$' or p_session is null then raise exception 'invalid request'; end if;
  perform pg_advisory_xact_lock(83420934);
  -- Small bounded daily tables; expired ciphertext is removed on every session creation.
  if p_action='session' then
    delete from public.ai_guard_sessions where expires_at<now();
    delete from public.ai_guard_calls where created_at<today-interval '2 days';
    if exists(select 1 from public.ai_guard_sessions where id=p_session and expires_at>now()) then
      return jsonb_build_object('ok',true);
    end if;
    select count(*) into n from public.ai_guard_sessions where ip_hash=p_ip and created_at>now()-interval '1 hour';
    if n>=60 then return jsonb_build_object('status',429,'code','session_rate_limited'); end if;
    insert into public.ai_guard_sessions(id,ip_hash) values(p_session,p_ip);
    return jsonb_build_object('ok',true);
  end if;
  if not exists(select 1 from public.ai_guard_sessions where id=p_session and expires_at>now()) then
    return jsonb_build_object('status',401,'code','ai_session_required');
  end if;
  if p_key !~ '^[a-f0-9]{64}$' or p_kind not in ('profile','care','mbti','condition') or p_lease is null then
    raise exception 'invalid request';
  end if;
  select * into req from public.ai_guard_requests where session_id=p_session and request_key=p_key;
  if p_action='begin' then
    if req.state='done' then return jsonb_build_object('cached',req.response_cipher); end if;
    if req.state='pending' and req.updated_at>now()-interval '100 seconds' then
      return jsonb_build_object('status',202,'code','generation_pending');
    end if;
    if req.state='failed' and req.updated_at>now()-interval '15 seconds' then
      return jsonb_build_object('status',429,'code','retry_later');
    end if;
    select count(*) into n from public.ai_guard_requests where session_id=p_session and updated_at>now()-interval '1 hour';
    if n>=20 and req.session_id is null then return jsonb_build_object('status',429,'code','session_rate_limited'); end if;
    insert into public.ai_guard_requests(session_id,request_key,kind,lease,state)
      values(p_session,p_key,p_kind,p_lease,'pending')
      on conflict(session_id,request_key) do update set lease=p_lease,state='pending',response_cipher=null,calls=0,updated_at=now();
    return jsonb_build_object('ok',true);
  end if;
  if req.lease is distinct from p_lease or req.state<>'pending' then
    return jsonb_build_object('status',409,'code','generation_expired');
  end if;
  if p_action='charge' then
    if p_attempt not between 1 and 4 or p_user !~ '^[a-f0-9]{64}$' then raise exception 'invalid attempt'; end if;
    if exists(select 1 from public.ai_guard_calls where lease=p_lease and attempt=p_attempt) then return jsonb_build_object('ok',true); end if;
    select count(*) into n from public.ai_guard_calls where created_at>=today;
    if n>=cfg.daily_limit then return jsonb_build_object('status',429,'code','daily_limit_reached'); end if;
    select count(*) into n from public.ai_guard_calls where ip_hash=p_ip and created_at>now()-interval '1 hour';
    if n>=100 then return jsonb_build_object('status',429,'code','ip_rate_limited'); end if;
    select count(*) into n from public.ai_guard_calls where user_hash=p_user and created_at>=today;
    if n>=30 then return jsonb_build_object('status',429,'code','user_rate_limited'); end if;
    insert into public.ai_guard_calls(lease,attempt,session_id,ip_hash,user_hash) values(p_lease,p_attempt,p_session,p_ip,p_user);
    update public.ai_guard_requests set calls=calls+1,updated_at=now() where session_id=p_session and request_key=p_key;
    return jsonb_build_object('ok',true);
  elsif p_action in ('finish','fail') then
    if p_action='finish' and (p_cipher is null or length(p_cipher)>50000) then raise exception 'invalid response'; end if;
    update public.ai_guard_requests set state=case when p_action='finish' then 'done' else 'failed' end,
      response_cipher=case when p_action='finish' then p_cipher else null end,updated_at=now()
      where session_id=p_session and request_key=p_key;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'invalid action';
end $$;
revoke all on function public.ai_guard(text,text,uuid,text,text,text,uuid,integer,text,text) from public;
grant execute on function public.ai_guard(text,text,uuid,text,text,text,uuid,integer,text,text) to anon;
notify pgrst,'reload schema';
commit;
