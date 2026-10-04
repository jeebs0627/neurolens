-- 검사 종류 구분: 시선추적 성향검사(trait) · 마인드 컨디션 검사(condition). 기존 행은 모두 trait.
alter table public.test_results add column if not exists kind text not null default 'trait';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'test_results_kind_check') then
    alter table public.test_results add constraint test_results_kind_check check (kind in ('trait', 'condition'));
  end if;
end $$;
create index if not exists test_results_user_kind_idx on public.test_results (user_id, kind, created_at desc);
