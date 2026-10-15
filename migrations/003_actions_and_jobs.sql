create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  tool_name text not null,
  risk text not null check (risk in ('write', 'external', 'destructive')),
  summary text not null,
  input jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz
);

create index if not exists approval_requests_user_status_idx
  on approval_requests (user_id, status, created_at desc);

create table if not exists audit_events (
  id bigserial primary key,
  user_id text not null,
  event_type text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_user_created_idx
  on audit_events (user_id, created_at desc);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  job_type text not null,
  input jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_runnable_idx
  on jobs (status, scheduled_for) where status = 'queued';
create index if not exists jobs_user_created_idx on jobs (user_id, created_at desc);

