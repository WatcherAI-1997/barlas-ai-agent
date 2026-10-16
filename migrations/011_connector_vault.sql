create table connector_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_accounts(id) on delete cascade,
  provider text not null check (provider in ('github', 'google_drive', 'gmail', 'google_calendar')),
  label text not null check (char_length(label) between 1 and 100),
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_version integer not null default 1 check (key_version > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, label)
);

create index connector_credentials_user_provider_idx
  on connector_credentials (user_id, provider, updated_at desc);

comment on table connector_credentials is
  'Encrypted per-user connector credentials. Plaintext secrets must never be persisted or returned by APIs.';
