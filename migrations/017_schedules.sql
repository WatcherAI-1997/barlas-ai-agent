create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  objective text not null,
  cron_expression text not null,
  timezone text not null,
  task_class text not null check (task_class in ('fast', 'deep', 'private')),
  allowed_tools jsonb,
  max_steps integer not null check (max_steps between 1 and 12),
  max_total_tokens integer not null check (max_total_tokens between 1000 and 100000),
  delivery_channel text not null check (delivery_channel in ('web', 'telegram')),
  status text not null default 'active' check (status in ('active', 'paused', 'disabled')),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  worker_id text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedules_due_idx on schedules (status, next_run_at)
  where status = 'active';
create index if not exists schedules_user_idx on schedules (user_id, created_at desc);

alter table agent_runs
  add column if not exists schedule_id uuid references schedules(id) on delete set null,
  add column if not exists schedule_occurrence timestamptz;

create unique index if not exists agent_runs_schedule_occurrence_idx
  on agent_runs (schedule_id, schedule_occurrence)
  where schedule_id is not null and schedule_occurrence is not null;
