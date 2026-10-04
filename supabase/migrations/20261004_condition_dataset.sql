-- Apply after 20261003_newbiz_research.sql. No camera images, no public dataset reads.
-- Review access is a protected allowlist, independent of client-editable profile fields.
create table if not exists public.dataset_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.dataset_reviewers enable row level security;
revoke all on public.dataset_reviewers from public, anon, authenticated;

create or replace function public.dataset_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.dataset_reviewers where user_id = auth.uid());
$$;
revoke all on function public.dataset_access() from public, anon;
grant execute on function public.dataset_access() to authenticated;

alter table public.newbiz_research_sessions add column if not exists client_attempt uuid;
create unique index if not exists research_client_attempt_idx on public.newbiz_research_sessions(client_attempt) where client_attempt is not null;

-- A client-generated random token is persisted before the first request. Lost responses and
-- retries cannot create duplicate attempts or expose a different participant's receipt.
create or replace function public.dataset_research_begin(p_attempt uuid, p_token text, p_consent jsonb, p_meta jsonb, p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.newbiz_research_sessions; v_code text;
begin
  if p_attempt is null or p_token is null or p_token !~ '^[0-9a-f]{48}$'
    or coalesce(p_consent->>'research','false') <> 'true'
    or coalesce(p_meta->>'demo','false') <> 'false'
    or p_meta is null or p_summary is null
    or p_meta->>'attemptId' is distinct from p_attempt::text
    or p_summary#>>'{dataset,schema}' is distinct from 'condition-dataset-1'
    or p_summary#>>'{dataset,attemptId}' is distinct from p_attempt::text then
    raise exception 'invalid_research_attempt' using errcode='22023';
  end if;
  if pg_column_size(p_meta)>32768 or pg_column_size(p_summary)>262144 then raise exception 'payload_too_large' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_attempt::text,0));
  select * into v_row from public.newbiz_research_sessions where client_attempt=p_attempt
    or (client_attempt is null and meta->>'attemptId'=p_attempt::text and token_hash=encode(extensions.digest(p_token,'sha256'),'hex'))
    order by created_at desc limit 1 for update;
  if found then
    if v_row.token_hash<>encode(extensions.digest(p_token,'sha256'),'hex') then raise exception 'forbidden' using errcode='42501'; end if;
    update public.newbiz_research_sessions set client_attempt=p_attempt where id=v_row.id;
    -- Restart a stale partial upload under the same identity and token.
    if v_row.status='uploading' then
      delete from public.newbiz_research_chunks where session_id=v_row.id;
      update public.newbiz_research_sessions set created_at=now(),meta=p_meta,summary=p_summary,consent=p_consent where id=v_row.id;
    end if;
    return jsonb_build_object('session_id',v_row.id,'code',v_row.code,'status',v_row.status);
  end if;
  if (select count(*) from public.newbiz_research_sessions where created_at>now()-interval '1 day')>=5000 then raise exception 'daily_cap'; end if;
  v_code:='NLR-'||upper(encode(extensions.gen_random_bytes(8),'hex'));
  insert into public.newbiz_research_sessions(code,token_hash,consent,meta,summary,client_attempt)
    values(v_code,encode(extensions.digest(p_token,'sha256'),'hex'),p_consent,p_meta,p_summary,p_attempt) returning * into v_row;
  return jsonb_build_object('session_id',v_row.id,'code',v_row.code,'status',v_row.status);
end $$;
revoke all on function public.dataset_research_begin(uuid,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.dataset_research_begin(uuid,text,jsonb,jsonb,jsonb) to anon,authenticated;

create table if not exists public.dataset_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.newbiz_research_sessions(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  kind text not null check(kind in ('action','reference','replay','correction')),
  body jsonb not null
);
create index if not exists dataset_annotations_session_idx on public.dataset_annotations(session_id,created_at);
alter table public.dataset_annotations enable row level security;
revoke all on public.dataset_annotations from public,anon,authenticated;

create or replace function public.dataset_list(p_before timestamptz default null,p_before_id uuid default null,p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.dataset_access() then raise exception 'forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into v_result from (
    select s.id,s.code,s.created_at,s.meta,s.summary->'dataset' as audit,
      (select n.body->'comparison' from public.dataset_annotations n where n.session_id=s.id and n.kind='reference' order by n.created_at desc,n.id desc limit 1) as reference_review,
      (select count(*) from public.dataset_annotations n where n.session_id=s.id) as annotation_count
    from public.newbiz_research_sessions s
    where s.status='complete' and coalesce(s.consent->>'research','false')='true'
      and (p_before is null or s.created_at<p_before or (s.created_at=p_before and s.id<p_before_id))
    order by s.created_at desc,s.id desc limit greatest(1,least(coalesce(p_limit,50),100))
  ) x;
  return v_result;
end $$;

create or replace function public.dataset_detail(p_session uuid,p_payload boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.newbiz_research_sessions; v_chunks jsonb; v_notes jsonb;
begin
  if not public.dataset_access() then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_row from public.newbiz_research_sessions where id=p_session and status='complete';
  if not found then raise exception 'not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'kind',kind,'body',body) order by created_at),'[]'::jsonb)
    into v_notes from public.dataset_annotations where session_id=p_session;
  if p_payload then select coalesce(jsonb_agg(jsonb_build_object('idx',idx,'data',data) order by idx),'[]'::jsonb) into v_chunks from public.newbiz_research_chunks where session_id=p_session; end if;
  return jsonb_build_object('id',v_row.id,'code',v_row.code,'meta',v_row.meta,'audit',v_row.summary->'dataset','annotations',v_notes,
    'chunks',v_chunks,'sha256',case when p_payload then v_row.payload_sha256 else null end,'chunkCount',v_row.chunk_count);
end $$;

-- Append only. Corrections and references never overwrite the original measurement/report.
create or replace function public.dataset_annotate(p_session uuid,p_kind text,p_body jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.dataset_access() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_kind not in ('action','reference','replay','correction') or p_body is null or jsonb_typeof(p_body)<>'object'
    or pg_column_size(p_body)>524288 then raise exception 'invalid_annotation'; end if;
  if not exists(select 1 from public.newbiz_research_sessions where id=p_session and status='complete') then raise exception 'not_found'; end if;
  insert into public.dataset_annotations(session_id,author_id,kind,body) values(p_session,auth.uid(),p_kind,p_body) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.dataset_list(timestamptz,uuid,int) from public,anon;
revoke all on function public.dataset_detail(uuid,boolean) from public,anon;
revoke all on function public.dataset_annotate(uuid,text,jsonb) from public,anon;
grant execute on function public.dataset_list(timestamptz,uuid,int),public.dataset_detail(uuid,boolean),public.dataset_annotate(uuid,text,jsonb) to authenticated;

-- After checking the intended research administrator's identity, enrol their auth user UUID:
-- insert into public.dataset_reviewers(user_id) values ('RESEARCH_ADMIN_AUTH_UUID') on conflict do nothing;
-- Do not grant access based only on client-editable profile metadata.
notify pgrst, 'reload schema';
