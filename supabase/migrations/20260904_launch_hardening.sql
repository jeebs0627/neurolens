-- =============================================================================
-- 20260904 launch hardening — 출시 전 P0/P1 서버 조치
--
--  1) chat_purge_transcripts: 로그인 사용자가 호출 가능했던 권한 회수 (크론 전용)
--  2) test_results.summary: AI 총평 1회 생성·캐시 (리포트당 1회만 Gemini 호출)
--  3) care_ops: 클라이언트 op_id 멱등 키 — outbox 재전송 시 이중 차감/중복 보관 차단
--  4) 날짜·기기 값 서버 검증 — 체크인 day/루틴 날짜/시작일을 KST 기준으로 강제
--  5) care_finish_course: 재측정 보상 + 코스 보관 + 다음 코스 + 알림톡 재예약을 한 번에
--
--  care_* RPC는 지금까지 DB에만 있었다. 이 파일부터는 저장소가 원본이다.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────── 1) 권한
revoke execute on function public.chat_purge_transcripts(integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────── 2) 총평 캐시
alter table public.test_results
  add column if not exists summary    text,
  add column if not exists summary_at timestamptz;

drop policy if exists results_update_own on public.test_results;
create policy results_update_own on public.test_results
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────── 3) 멱등 키
create table if not exists public.care_ops (
  journey_id uuid not null references public.care_journeys(id) on delete cascade,
  op_id      uuid not null,
  fn         text not null,
  created_at timestamptz not null default now(),
  primary key (journey_id, op_id)
);
comment on table public.care_ops is
  '쓰기 RPC 멱등 키. 클라이언트가 op_id(UUID)를 붙여 보내면 같은 op_id 재전송은 상태만 돌려준다.';
alter table public.care_ops enable row level security;

-- op_id가 처음이면 true, 이미 처리된 op_id면 false. op_id가 없으면 항상 true(구버전 클라이언트 호환).
create or replace function public.care_claim_op(p_journey uuid, p_op uuid, p_fn text)
returns boolean language plpgsql security definer set search_path to '' as $$
begin
  if p_op is null then return true; end if;
  insert into public.care_ops (journey_id, op_id, fn) values (p_journey, p_op, p_fn)
  on conflict do nothing;
  return found;
end $$;
revoke execute on function public.care_claim_op(uuid, uuid, text) from public, anon, authenticated;

-- 오래된 멱등 키 정리 (30일)
create or replace function public.care_purge_ops() returns integer
language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  delete from public.care_ops where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.care_purge_ops() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────── 4) 공통
create or replace function public.care_kst_today() returns date
language sql stable set search_path to '' as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

alter table public.care_journeys add column if not exists slot_time text;
comment on column public.care_journeys.slot_time is '알림 시각 HH:MM (KST). slot 은 표시용 라벨.';

-- D1~D6 체크인 / D7 재측정 알림 예약 (begin_course · finish_course 공용)
create or replace function public.care_schedule_notifications(
  p_id uuid, p_token text, p_start date, p_slot_time text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_j    public.care_journeys;
  v_slot text;
  v_when timestamptz;
  v_msg  text;
  v_nm   text;
  v_link text;
  v_vars jsonb;
  v_kind text;
  i      int;
begin
  select * into v_j from public.care_journeys where id = p_id;
  if v_j.id is null or v_j.phone is null then return; end if;

  v_slot := case when coalesce(p_slot_time, '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                 then p_slot_time else '20:00' end;
  v_nm   := coalesce(v_j.name, '회원');
  v_link := '?care=' || p_token || '&checkin=1';

  update public.care_notifications
     set status = 'canceled'
   where journey_id = p_id and cycle = v_j.cycle and status = 'pending';

  for i in 1..7 loop
    v_when := (((p_start + i)::text || ' ' || v_slot)::timestamp) at time zone 'Asia/Seoul';
    if i <= 6 then
      v_kind := 'checkin';
      -- 카카오 템플릿 neurolens_checkin 본문과 동일해야 함
      v_msg := '[NeuroLens] ' || v_nm || '님, D' || i || ' 체크인 시간이에요 🌱' || chr(10) ||
               '감정 이모지 1탭 + 에너지 슬라이더, 30초면 끝나요.' || chr(10) ||
               '오늘의 처방 루틴도 함께 확인해 보세요.';
      v_vars := jsonb_build_object('#{name}', v_nm, '#{day}', i::text);
    else
      v_kind := 'remeasure';
      -- 카카오 템플릿 neurolens_remeasure 본문과 동일해야 함
      v_msg := '[NeuroLens] ' || v_nm || '님, 7일 케어 코스를 완주했어요 🎉' || chr(10) ||
               '1분 미니 재측정으로 변화를 확인하고 다음 코스를 열어보세요.';
      v_vars := jsonb_build_object('#{name}', v_nm);
    end if;

    insert into public.care_notifications (journey_id, cycle, kind, day, scheduled_at, phone,
                                           message, variables, link_path, template_kind)
    values (p_id, v_j.cycle, v_kind, i, v_when, v_j.phone, v_msg, v_vars, v_link, v_kind)
    on conflict (journey_id, cycle, kind, day) do update
      set scheduled_at = excluded.scheduled_at, phone = excluded.phone,
          message = excluded.message, variables = excluded.variables,
          link_path = excluded.link_path, template_kind = excluded.template_kind,
          status = 'pending', attempts = 0, error = null;
  end loop;
end $$;
revoke execute on function public.care_schedule_notifications(uuid, text, date, text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────── 5) RPC 교체
-- 시그니처가 바뀌므로(p_op_id 추가) 이전 버전을 먼저 제거한다 — 오버로드 중복 방지.
drop function if exists public.care_begin_course(text, text, text, text, date, text);
drop function if exists public.care_log_checkin(text, integer, text, integer, jsonb, text);
drop function if exists public.care_log_routine(text, text, text, date);
drop function if exists public.care_log_remeasure(text);
drop function if exists public.care_spend(text, text);
drop function if exists public.care_finish_course(text, integer, integer, integer, jsonb, jsonb, jsonb);

-- 코스 시작 (알림 채널 등록 + D1~D7 예약). 시작일은 서버 기준 오늘(±1일 기기 오차만 허용).
create or replace function public.care_begin_course(
  p_token text, p_phone text,
  p_slot_time text default '20:00', p_slot_label text default '저녁 8시',
  p_started_on date default null, p_name text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_id     uuid;
  v_start  date;
  v_today  date;
  v_digits text;
begin
  v_id := public.care_find(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not public.care_claim_op(v_id, p_op_id, 'begin_course') then
    return public.care_state(v_id) || jsonb_build_object('dup', true);
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if v_digits !~ '^01[0-9]{8,9}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  if coalesce(p_slot_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    p_slot_time := '20:00';
  end if;

  v_today := public.care_kst_today();
  v_start := case when p_started_on is not null and abs(p_started_on - v_today) <= 1
                  then p_started_on else v_today end;

  update public.care_journeys
     set phone = v_digits, slot = left(coalesce(p_slot_label, p_slot_time), 30),
         slot_time = p_slot_time, consent_at = now(), started_at = v_start,
         name = coalesce(left(p_name, 60), name), last_seen_at = now()
   where id = v_id;

  perform public.care_schedule_notifications(v_id, p_token, v_start, p_slot_time);
  return public.care_state(v_id);
end $$;

-- 데일리 체크인. day 는 서버가 시작일 기준으로 검증한다 (미래 day 거부).
create or replace function public.care_log_checkin(
  p_token text, p_day integer, p_emoji text, p_energy integer,
  p_routines jsonb default '[]'::jsonb, p_note text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_id     uuid;
  v_j      public.care_journeys;
  v_srvday int;
begin
  v_id := public.care_find(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_j from public.care_journeys where id = v_id;
  if v_j.started_at is null then
    return jsonb_build_object('ok', false, 'error', 'no_course');
  end if;
  v_srvday := public.care_kst_today() - v_j.started_at;
  if p_day is null or p_day < 1 or p_day > 6 or p_day > v_srvday then
    return public.care_state(v_id)
        || jsonb_build_object('ok', false, 'error', 'bad_day', 'serverDay', v_srvday);
  end if;
  if not public.care_claim_op(v_id, p_op_id, 'checkin') then
    return public.care_state(v_id) || jsonb_build_object('dup', true);
  end if;

  insert into public.care_checkins (journey_id, cycle, day, emoji, energy, routines, note)
  values (v_id, v_j.cycle, p_day, left(coalesce(p_emoji, '😐'), 8),
          greatest(0, least(100, coalesce(p_energy, 50))),
          coalesce(p_routines, '[]'::jsonb), left(p_note, 60))
  on conflict (journey_id, cycle, day) do update
    set emoji = excluded.emoji, energy = excluded.energy,
        routines = excluded.routines, note = excluded.note;

  -- 첫 기록일 때만 적립
  if not exists (select 1 from public.care_point_ledger
                  where journey_id = v_id and cycle = v_j.cycle and kind = 'checkin'
                    and label = 'D' || p_day || ' 데일리 체크인') then
    perform public.care_post_ledger(v_id, v_j.cycle, 'checkin',
             'D' || p_day || ' 데일리 체크인', public.care_award('checkin'));
  end if;

  -- 이미 체크인했으니 그날 알림은 보내지 않는다
  update public.care_notifications
     set status = 'canceled'
   where journey_id = v_id and cycle = v_j.cycle and kind = 'checkin'
     and day = p_day and status = 'pending';

  update public.care_journeys set last_seen_at = now() where id = v_id;
  return public.care_state(v_id);
end $$;

-- 루틴 실천. 날짜는 서버 기준 오늘(오프라인 재전송을 위해 어제까지만 허용).
create or replace function public.care_log_routine(
  p_token text, p_routine_id text, p_label text default null,
  p_done_on date default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_id    uuid;
  v_cycle int;
  v_today date;
  v_day   date;
begin
  v_id := public.care_find(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(p_routine_id, '') !~ '^[A-Za-z0-9_]{1,40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_routine');
  end if;
  if not public.care_claim_op(v_id, p_op_id, 'routine') then
    return public.care_state(v_id) || jsonb_build_object('dup', true);
  end if;

  select cycle into v_cycle from public.care_journeys where id = v_id;
  v_today := public.care_kst_today();
  v_day := case when p_done_on is not null and p_done_on between v_today - 1 and v_today
                then p_done_on else v_today end;

  insert into public.care_routine_logs (journey_id, cycle, routine_id, done_on)
  values (v_id, v_cycle, p_routine_id, v_day)
  on conflict (journey_id, routine_id, done_on) do nothing;

  if found then
    perform public.care_post_ledger(v_id, v_cycle, 'routine',
             '루틴 실천 · ' || coalesce(left(p_label, 60), p_routine_id),
             public.care_award('routine'));
  end if;

  update public.care_journeys set last_seen_at = now() where id = v_id;
  return public.care_state(v_id);
end $$;

-- 재측정 보상 (코스당 1회). 보통은 care_finish_course(p_remeasured=true) 경로를 쓴다.
create or replace function public.care_log_remeasure(p_token text, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_id    uuid;
  v_cycle int;
begin
  v_id := public.care_find(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not public.care_claim_op(v_id, p_op_id, 'remeasure') then
    return public.care_state(v_id) || jsonb_build_object('dup', true);
  end if;
  select cycle into v_cycle from public.care_journeys where id = v_id;

  if not exists (select 1 from public.care_point_ledger
                  where journey_id = v_id and cycle = v_cycle and kind = 'remeasure') then
    perform public.care_post_ledger(v_id, v_cycle, 'remeasure',
             v_cycle || '차 코스 D7 미니 재측정 완료', public.care_award('remeasure'));
  end if;

  update public.care_journeys set remeasured = true, last_seen_at = now() where id = v_id;
  update public.care_notifications
     set status = 'canceled'
   where journey_id = v_id and cycle = v_cycle and kind = 'remeasure' and status = 'pending';

  return public.care_state(v_id);
end $$;

-- 포인트 사용 (해금·교환). 가격은 care_catalog 기준, 잔액은 원장 합계.
create or replace function public.care_spend(p_token text, p_item_id text, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_id   uuid;
  v_cyc  int;
  v_item public.care_catalog;
  v_bal  int;
begin
  v_id := public.care_find(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_item from public.care_catalog where id = p_item_id and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'bad_item');
  end if;

  select cycle into v_cyc from public.care_journeys where id = v_id;

  if v_item.kind = 'report'
     and exists (select 1 from public.care_unlocks where journey_id = v_id and report_id = v_item.id) then
    return public.care_state(v_id) || jsonb_build_object('already', true);
  end if;

  v_bal := public.care_balance(v_id);
  if v_bal < v_item.cost then
    return public.care_state(v_id) || jsonb_build_object(
      'ok', false, 'error', 'insufficient', 'need', v_item.cost - v_bal, 'cost', v_item.cost);
  end if;

  -- 잔액 확인 뒤에 멱등 키를 선점한다 (부족으로 거부된 op_id 는 소모되지 않게)
  if not public.care_claim_op(v_id, p_op_id, 'spend') then
    return public.care_state(v_id) || jsonb_build_object('dup', true);
  end if;

  if v_item.kind = 'report' then
    insert into public.care_unlocks (journey_id, report_id, cost)
    values (v_id, v_item.id, v_item.cost)
    on conflict (journey_id, report_id) do nothing;
    perform public.care_post_ledger(v_id, v_cyc, 'unlock',
             '리포트 해금 · ' || v_item.name, -v_item.cost);
  else
    perform public.care_post_ledger(v_id, v_cyc, 'exchange',
             '교환 · ' || v_item.name, -v_item.cost);
  end if;

  update public.care_journeys set last_seen_at = now() where id = v_id;
  return public.care_state(v_id) || jsonb_build_object('spent', v_item.cost, 'item', v_item.name);
end $$;

-- 코스 종료 → 보관 → 다음 코스. p_remeasured=true 면 재측정 보상까지 한 트랜잭션에서 처리하고,
-- 알림 채널이 있으면 새 코스의 D1~D7 알림톡을 다시 예약한다.
create or replace function public.care_finish_course(
  p_token text,
  p_base_score integer default null, p_start_score integer default null, p_end_score integer default null,
  p_trend jsonb default '[]'::jsonb, p_days jsonb default '[]'::jsonb, p_notes jsonb default '[]'::jsonb,
  p_remeasured boolean default false, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_id    uuid;
  v_j     public.care_journeys;
  v_cks   jsonb;
  v_n     int;
  v_today date;
begin
  v_id := public.care_find(p_token);
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_j from public.care_journeys where id = v_id;
  if v_j.started_at is null then
    return public.care_state(v_id) || jsonb_build_object('ok', false, 'error', 'no_course');
  end if;
  if not public.care_claim_op(v_id, p_op_id, 'finish_course') then
    return public.care_state(v_id) || jsonb_build_object('dup', true);
  end if;

  -- 재측정 보상 (코스당 1회)
  if coalesce(p_remeasured, false) then
    if not exists (select 1 from public.care_point_ledger
                    where journey_id = v_id and cycle = v_j.cycle and kind = 'remeasure') then
      perform public.care_post_ledger(v_id, v_j.cycle, 'remeasure',
               v_j.cycle || '차 코스 D7 미니 재측정 완료', public.care_award('remeasure'));
    end if;
    v_j.remeasured := true;
  end if;

  select coalesce(jsonb_object_agg(c.day::text, jsonb_build_object(
           'emoji', c.emoji, 'energy', c.energy, 'routines', c.routines, 'note', c.note)), '{}'::jsonb),
         count(*)
    into v_cks, v_n
    from public.care_checkins c where c.journey_id = v_id and c.cycle = v_j.cycle;

  v_today := public.care_kst_today();

  insert into public.care_courses (journey_id, cycle, started_on, ended_on, base_score,
                                   start_score, end_score, delta, n_checkins, remeasured,
                                   checkins, notes, days, trend, rx)
  values (v_id, v_j.cycle, v_j.started_at, v_today,
          coalesce(p_base_score, (v_j.base->>'score')::int), p_start_score, p_end_score,
          case when p_start_score is null or p_end_score is null then null
               else p_end_score - p_start_score end,
          coalesce(v_n, 0), v_j.remeasured, v_cks,
          coalesce(p_notes, '[]'::jsonb), coalesce(p_days, '[]'::jsonb),
          coalesce(p_trend, '[]'::jsonb), v_j.rx)
  on conflict (journey_id, cycle) do update
    set ended_on = excluded.ended_on, start_score = excluded.start_score,
        end_score = excluded.end_score, delta = excluded.delta,
        n_checkins = excluded.n_checkins, remeasured = excluded.remeasured,
        checkins = excluded.checkins, notes = excluded.notes,
        days = excluded.days, trend = excluded.trend;

  update public.care_notifications
     set status = 'canceled'
   where journey_id = v_id and cycle = v_j.cycle and status = 'pending';

  -- 다음 코스 (포인트·해금·히스토리·알림 채널은 유지)
  update public.care_journeys
     set cycle = v_j.cycle + 1, started_at = v_today,
         remeasured = false, last_seen_at = now()
   where id = v_id;

  -- 알림 채널이 있으면 새 코스 알림을 이어서 예약
  if v_j.phone is not null then
    perform public.care_schedule_notifications(v_id, p_token, v_today, coalesce(v_j.slot_time, '20:00'));
  end if;

  return public.care_state(v_id);
end $$;

-- 멱등 키 정리 크론 (매일 04:30 KST = 19:30 UTC)
select cron.schedule('care-purge-ops', '30 19 * * *', $$select public.care_purge_ops();$$)
 where not exists (select 1 from cron.job where jobname = 'care-purge-ops');
