create table if not exists commitments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null check (char_length(title) between 1 and 500),
  details text not null default '' check (char_length(details) <= 10000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'completed', 'cancelled')),
  due_at timestamptz,
  evidence text check (evidence is null or char_length(evidence) between 1 and 10000),
  source_conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or evidence is not null)
);

create index if not exists commitments_user_status_due_idx
  on commitments (user_id, status, due_at nulls last, created_at);
