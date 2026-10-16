create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists projects_user_updated_idx on projects (user_id, updated_at desc);

create table if not exists project_resources (
  project_id uuid not null,
  user_id text not null,
  resource_type text not null check (resource_type in ('conversation', 'agent_run', 'memory', 'file')),
  resource_id text not null check (char_length(resource_id) between 1 and 1000),
  label text not null default '' check (char_length(label) <= 200),
  created_at timestamptz not null default now(),
  primary key (project_id, resource_type, resource_id),
  foreign key (project_id, user_id) references projects(id, user_id) on delete cascade
);

create index if not exists project_resources_user_idx on project_resources (user_id, project_id, created_at);

create table if not exists project_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id text not null,
  path text not null check (char_length(path) between 1 and 1000),
  version integer not null check (version > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes between 1 and 10000000),
  content bytea not null,
  created_at timestamptz not null default now(),
  unique (project_id, path, version),
  foreign key (project_id, user_id) references projects(id, user_id) on delete cascade
);

create index if not exists project_artifacts_user_project_idx
  on project_artifact_versions (user_id, project_id, path, version desc);
