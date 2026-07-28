-- =============================================================================
-- chat_alerts — 위기(high) 세션 실시간 관리자 알림 큐
--
--   기록: chat Edge Function(서비스 롤)이 send 처리 중 high 위기 신호 감지 시 INSERT
--   조회: chat_admin.html 이 30초 폴링 (RLS: is_admin() 만 SELECT/UPDATE 가능)
--   확인: 관리자가 배너에서 [확인] → ack_at/ack_by 기록, 배너에서 사라짐
--
--   preview 에는 사용자 메시지 앞 140자가 담기므로 민감정보다.
--   대화 원문 7일 파기 정책(chat-purge-transcripts)과 별개로, 필요 시
--   동일 크론에 chat_alerts 의 오래된 행 삭제를 추가할 것.
-- =============================================================================

create table if not exists public.chat_alerts (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references public.chat_sessions(id) on delete cascade,
  user_id    uuid,
  level      text not null default 'high',
  keywords   jsonb not null default '[]'::jsonb,
  preview    text,
  ack_at     timestamptz,
  ack_by     uuid,
  created_at timestamptz not null default now()
);

comment on table public.chat_alerts is
  '위기(high) 세션 실시간 알림 큐. 서비스 롤이 기록, 관리자가 확인(ack). preview는 민감정보 — 보존기간 정책 적용 대상.';

create index if not exists chat_alerts_open_idx
  on public.chat_alerts (created_at desc) where ack_at is null;

alter table public.chat_alerts enable row level security;

drop policy if exists chat_alerts_admin_select on public.chat_alerts;
create policy chat_alerts_admin_select on public.chat_alerts
  for select using (public.is_admin());

drop policy if exists chat_alerts_admin_update on public.chat_alerts;
create policy chat_alerts_admin_update on public.chat_alerts
  for update using (public.is_admin());
