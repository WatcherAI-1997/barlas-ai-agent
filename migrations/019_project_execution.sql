create table if not exists project_goals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id text not null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'blocked', 'completed')),
  priority smallint not null default 3 check (priority between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id, user_id),
  foreign key (project_id, user_id) references projects(id, user_id) on delete cascade
);

create index if not exists project_goals_project_idx on project_goals (user_id, project_id, status, priority desc, created_at);

create table if not exists project_plan_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id text not null,
  goal_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  position integer not null check (position between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'blocked', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position),
  foreign key (project_id, user_id) references projects(id, user_id) on delete cascade,
  foreign key (goal_id, project_id, user_id) references project_goals(id, project_id, user_id) on delete cascade
);

create index if not exists project_steps_project_idx on project_plan_steps (user_id, project_id, position);

create table if not exists project_checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id text not null,
  goal_id uuid,
  kind text not null check (kind in ('manual', 'agent_run')),
  title text not null check (char_length(title) between 1 and 200),
  summary text not null check (char_length(summary) between 1 and 10000),
  progress smallint not null check (progress between 0 and 100),
  agent_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, user_id) references projects(id, user_id) on delete cascade,
  foreign key (goal_id, project_id, user_id) references project_goals(id, project_id, user_id) on delete cascade
);

create unique index if not exists project_checkpoints_run_idx
  on project_checkpoints (project_id, agent_run_id) where agent_run_id is not null;
create index if not exists project_checkpoints_project_idx
  on project_checkpoints (user_id, project_id, created_at desc);

create or replace function touch_project_from_child() returns trigger language plpgsql as $$
begin
  update projects set updated_at = now() where id = new.project_id and user_id = new.user_id;
  return new;
end $$;

drop trigger if exists project_resources_touch_project on project_resources;
create trigger project_resources_touch_project after insert or update on project_resources
  for each row execute function touch_project_from_child();
drop trigger if exists project_artifacts_touch_project on project_artifact_versions;
create trigger project_artifacts_touch_project after insert or update on project_artifact_versions
  for each row execute function touch_project_from_child();
drop trigger if exists project_goals_touch_project on project_goals;
create trigger project_goals_touch_project after insert or update on project_goals
  for each row execute function touch_project_from_child();
drop trigger if exists project_steps_touch_project on project_plan_steps;
create trigger project_steps_touch_project after insert or update on project_plan_steps
  for each row execute function touch_project_from_child();
drop trigger if exists project_checkpoints_touch_project on project_checkpoints;
create trigger project_checkpoints_touch_project after insert or update on project_checkpoints
  for each row execute function touch_project_from_child();
