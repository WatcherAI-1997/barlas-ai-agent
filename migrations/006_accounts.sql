create table if not exists user_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  role text not null default 'user' check (role in ('owner', 'user')),
  password_hash text not null,
  password_salt text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email = lower(email))
);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references user_accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists user_sessions_account_idx
  on user_sessions (account_id, expires_at desc);
create index if not exists user_sessions_expiry_idx
  on user_sessions (expires_at);
