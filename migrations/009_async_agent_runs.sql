alter table agent_runs drop constraint if exists agent_runs_status_check;
alter table agent_runs add constraint agent_runs_status_check
  check (status in ('queued', 'running', 'waiting_approval', 'completed', 'step_limit', 'budget_limit', 'cancelled', 'failed'));

alter table agent_runs
  add column if not exists conversation_messages jsonb not null default '[]'::jsonb,
  add column if not exists delivery jsonb,
  add column if not exists scheduled_for timestamptz not null default now(),
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists worker_id text,
  add column if not exists locked_at timestamptz;

create index if not exists agent_runs_runnable_idx
  on agent_runs (status, scheduled_for)
  where status in ('queued', 'running');
