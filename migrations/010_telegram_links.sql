create table if not exists telegram_links (
  account_id uuid primary key references user_accounts(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references user_accounts(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_codes_account_idx
  on telegram_link_codes (account_id, created_at desc);
