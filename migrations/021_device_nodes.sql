create table if not exists device_node_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references user_accounts(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists device_nodes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references user_accounts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  platform text not null check (platform in ('linux', 'macos', 'windows', 'android', 'ios')),
  token_hash text not null unique,
  capabilities text[] not null default '{}',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists device_node_commands (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references device_nodes(id) on delete cascade,
  account_id uuid not null references user_accounts(id) on delete cascade,
  kind text not null check (kind in ('notify')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'delivered', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  completed_at timestamptz,
  error text
);

create index if not exists device_nodes_account_idx on device_nodes (account_id, created_at desc);
create index if not exists device_node_commands_delivery_idx on device_node_commands (node_id, status, created_at);
