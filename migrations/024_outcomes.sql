create table if not exists outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null check (char_length(title) between 1 and 500),
  objective text not null check (char_length(objective) between 1 and 10000),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'verification_pending', 'verified', 'verification_failed', 'cancelled')),
  source_conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (id, user_id)
);

create table if not exists outcome_criteria (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references outcomes(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 2000),
  required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, outcome_id)
);

create table if not exists outcome_evidence (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references outcomes(id) on delete cascade,
  criterion_id uuid not null,
  kind text not null check (kind in ('deterministic_check', 'artifact', 'external_receipt', 'user_confirmation', 'agent_observation')),
  passed boolean not null,
  summary text not null check (char_length(summary) between 1 and 10000),
  locator text check (locator is null or char_length(locator) between 1 and 2000),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (criterion_id, outcome_id) references outcome_criteria(id, outcome_id) on delete cascade
);

create index if not exists outcomes_user_status_idx on outcomes (user_id, status, updated_at desc);
create index if not exists outcome_criteria_outcome_idx on outcome_criteria (outcome_id, created_at, id);
create index if not exists outcome_evidence_outcome_criterion_idx on outcome_evidence (outcome_id, criterion_id, observed_at desc, id desc);
