alter table jobs
  add column if not exists max_attempts integer not null default 3
    check (max_attempts between 1 and 10),
  add column if not exists worker_id text,
  add column if not exists locked_at timestamptz;

create index if not exists jobs_lease_idx
  on jobs (status, locked_at)
  where status = 'running';
