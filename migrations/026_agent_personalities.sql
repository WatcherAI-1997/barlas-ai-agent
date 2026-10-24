alter table agent_profiles
  add column if not exists character_values text[] not null default array['helpfulness', 'honesty', 'respect']::text[],
  add column if not exists strengths text[] not null default array[]::text[],
  add column if not exists communication_voice text not null default '',
  add column if not exists initiative_level text not null default 'balanced',
  add column if not exists risk_posture text not null default 'balanced',
  add column if not exists critique_style text not null default 'direct',
  add column if not exists color text not null default '#C62828',
  add column if not exists avatar text,
  add column if not exists identity_version integer not null default 1;

alter table agent_profiles
  add constraint agent_profiles_values_size check (cardinality(character_values) between 1 and 8),
  add constraint agent_profiles_strengths_size check (cardinality(strengths) <= 8),
  add constraint agent_profiles_voice_size check (char_length(communication_voice) <= 500),
  add constraint agent_profiles_initiative_check check (initiative_level in ('directed', 'balanced', 'proactive')),
  add constraint agent_profiles_risk_check check (risk_posture in ('cautious', 'balanced', 'bold')),
  add constraint agent_profiles_critique_check check (critique_style in ('gentle', 'direct', 'challenging')),
  add constraint agent_profiles_color_check check (color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint agent_profiles_avatar_size check (avatar is null or char_length(avatar) <= 1000),
  add constraint agent_profiles_identity_version_check check (identity_version >= 1);

create table if not exists agent_profile_revisions (
  agent_profile_id uuid not null,
  user_id text not null,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  primary key (agent_profile_id, version),
  foreign key (agent_profile_id, user_id) references agent_profiles(id, user_id) on delete cascade
);

insert into agent_profile_revisions (agent_profile_id, user_id, version, snapshot, reason)
select id, user_id, identity_version,
  jsonb_build_object(
    'id', id, 'userId', user_id, 'slug', slug, 'name', name, 'style', style,
    'instructions', instructions, 'defaultTaskClass', default_task_class,
    'character', jsonb_build_object(
      'values', character_values, 'strengths', strengths, 'voice', communication_voice,
      'initiativeLevel', initiative_level, 'riskPosture', risk_posture,
      'critiqueStyle', critique_style, 'color', color, 'avatar', avatar
    ),
    'identityVersion', identity_version, 'projectId', project_id
  ),
  'Initial identity card'
from agent_profiles
on conflict (agent_profile_id, version) do nothing;
