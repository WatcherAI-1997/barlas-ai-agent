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
