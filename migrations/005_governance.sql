create table if not exists usage_counters (
  user_id text not null,
  category text not null,
  period_start date not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, category, period_start)
);

create table if not exists trace_events (
  id bigserial primary key,
  trace_id uuid not null,
  user_id text not null,
  operation text not null,
  status text not null check (status in ('started', 'completed', 'pending', 'rejected', 'failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trace_events_user_created_idx
  on trace_events (user_id, created_at desc);
create index if not exists trace_events_trace_idx
  on trace_events (trace_id, created_at);
