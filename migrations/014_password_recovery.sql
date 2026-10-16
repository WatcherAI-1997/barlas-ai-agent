create table if not exists password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references user_accounts(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_codes_account_idx
  on password_reset_codes (account_id, expires_at desc);
create index if not exists password_reset_codes_expiry_idx
  on password_reset_codes (expires_at) where used_at is null;
