alter table commitments
  add column if not exists next_reminder_at timestamptz,
  add column if not exists last_reminded_at timestamptz,
  add column if not exists reminder_interval_hours integer,
  add column if not exists reminder_count integer not null default 0,
  add column if not exists reminder_lease_owner text,
  add column if not exists reminder_lease_expires_at timestamptz,
  add constraint commitments_reminder_interval_check
    check (reminder_interval_hours is null or reminder_interval_hours between 1 and 168),
  add constraint commitments_reminder_shape_check
    check ((next_reminder_at is null and reminder_interval_hours is null) or (next_reminder_at is not null and reminder_interval_hours is not null));

create index if not exists commitments_due_reminder_idx
  on commitments (next_reminder_at, reminder_lease_expires_at)
  where status in ('open', 'in_progress', 'waiting') and next_reminder_at is not null;
