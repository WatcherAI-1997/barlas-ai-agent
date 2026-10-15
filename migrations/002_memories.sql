create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  content text not null,
  category text not null default 'general',
  importance smallint not null default 5 check (importance between 1 and 10),
  search_vector tsvector generated always as
    (to_tsvector('simple', coalesce(category, '') || ' ' || coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists memories_user_id_idx on memories (user_id);
create index if not exists memories_search_idx on memories using gin (search_vector);
create index if not exists memories_user_importance_idx
  on memories (user_id, importance desc, created_at desc);
