alter table approval_requests
  drop constraint if exists approval_requests_status_check;

alter table approval_requests
  add constraint approval_requests_status_check
  check (status in ('pending', 'approved', 'executing', 'rejected', 'executed', 'failed'));

alter table approval_requests
  add column if not exists execution_token text,
  add column if not exists execution_started_at timestamptz,
  add column if not exists execution_error text;

-- Older releases could crash after approving an action but before recording its
-- result. Treat those rows as indeterminate instead of risking a duplicate.
update approval_requests
set status = 'executing',
    execution_started_at = coalesce(decided_at, created_at),
    execution_error = 'Migrated legacy approved action; reconcile before continuing'
where status = 'approved';

create index if not exists approval_requests_executing_idx
  on approval_requests (execution_started_at)
  where status = 'executing';
