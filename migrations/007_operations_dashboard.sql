alter table conversations
  add column if not exists title text;

alter table messages
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists total_tokens integer,
  add column if not exists cost_microusd bigint;

create index if not exists conversations_user_updated_idx
  on conversations (user_id, updated_at desc);
create index if not exists approval_requests_user_created_idx
  on approval_requests (user_id, created_at desc);
