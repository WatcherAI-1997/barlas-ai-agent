alter table approval_requests
  add column if not exists output jsonb;

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  conversation_id uuid not null,
  status text not null default 'running'
    check (status in ('running', 'waiting_approval', 'completed', 'step_limit', 'budget_limit', 'cancelled', 'failed')),
  messages jsonb not null,
  task_class text not null check (task_class in ('fast', 'deep', 'private')),
  allowed_tools jsonb,
  max_steps integer not null check (max_steps between 1 and 12),
  max_total_tokens integer,
  continuation jsonb,
  pending_approval_id uuid references approval_requests(id),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_runs_user_created_idx
  on agent_runs (user_id, created_at desc);
create unique index if not exists agent_runs_pending_approval_idx
  on agent_runs (pending_approval_id) where pending_approval_id is not null;

create table if not exists agent_run_events (
  id bigserial primary key,
  run_id uuid not null references agent_runs(id) on delete cascade,
  step integer not null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_run_events_run_idx
  on agent_run_events (run_id, id);
