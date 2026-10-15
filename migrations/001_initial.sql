create table if not exists conversations (
  id uuid primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx on conversations (user_id);

create table if not exists messages (
  id bigserial primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  provider text,
  model text,
  provider_response_id text,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx
  on messages (conversation_id, created_at);

