create table if not exists skill_versions (
  id text not null check (id ~ '^[a-z][a-z0-9.-]{2,63}$'),
  version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  description text not null check (char_length(description) between 1 and 500),
  instructions text not null check (char_length(instructions) between 1 and 20000),
  allowed_tools jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (id, version),
  check (jsonb_typeof(allowed_tools) = 'array')
);

create unique index if not exists skill_versions_one_active_idx
  on skill_versions (id) where active;

create table if not exists skill_evaluations (
  id uuid primary key,
  skill_id text not null,
  skill_version text not null,
  passed boolean not null,
  passed_cases integer not null check (passed_cases >= 0),
  total_cases integer not null check (total_cases between 1 and 5),
  details jsonb not null,
  created_by uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (skill_id, skill_version) references skill_versions(id, version) on delete cascade,
  check (passed_cases <= total_cases),
  check (jsonb_typeof(details) = 'array')
);

create index if not exists skill_evaluations_lookup_idx
  on skill_evaluations (skill_id, skill_version, created_at desc);
