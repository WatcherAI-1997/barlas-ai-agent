drop table if exists password_reset_codes;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_accounts' and column_name = 'password_hash'
  ) then
    delete from user_sessions;
    alter table user_accounts drop column password_hash;
    alter table user_accounts drop column password_salt;
  end if;
end
$$;

create table if not exists external_identities (
  provider text not null,
  issuer text not null,
  client_id text not null,
  subject text not null,
  account_id uuid not null references user_accounts(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (provider, issuer, client_id, subject),
  unique (account_id, provider)
);

create table if not exists oidc_transactions (
  state_hash text primary key,
  browser_hash text not null,
  code_verifier text not null,
  nonce text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oidc_transactions_expiry_idx on oidc_transactions (expires_at);
