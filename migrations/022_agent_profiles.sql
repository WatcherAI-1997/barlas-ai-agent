create table if not exists agent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{1,31}$'),
  name text not null check (char_length(name) between 1 and 80),
  style text not null default 'balanced' check (style in ('balanced', 'concise', 'warm', 'analytical', 'creative')),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  default_task_class text not null default 'fast' check (default_task_class in ('fast', 'deep', 'private')),
  project_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (id, user_id),
  foreign key (project_id, user_id) references projects(id, user_id) on delete restrict
);

create index if not exists agent_profiles_user_idx on agent_profiles (user_id, created_at, id);

create table if not exists conversation_agent_profiles (
  conversation_id uuid primary key,
  user_id text not null,
  agent_profile_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (agent_profile_id, user_id) references agent_profiles(id, user_id) on delete restrict
);

create index if not exists conversation_agent_profiles_user_idx
  on conversation_agent_profiles (user_id, agent_profile_id, created_at);
