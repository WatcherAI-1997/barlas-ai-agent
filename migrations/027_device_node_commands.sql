alter table device_node_commands drop constraint if exists device_node_commands_kind_check;
alter table device_node_commands
  add constraint device_node_commands_kind_check check (kind in ('notify', 'location.get'));

alter table device_node_commands drop constraint if exists device_node_commands_status_check;
alter table device_node_commands
  add constraint device_node_commands_status_check check (status in ('queued', 'delivered', 'completed', 'failed', 'expired'));

alter table device_node_commands add column if not exists result jsonb;
alter table device_node_commands add column if not exists expires_at timestamptz;
update device_node_commands set expires_at = created_at + interval '10 minutes' where expires_at is null;
alter table device_node_commands alter column expires_at set not null;
alter table device_node_commands alter column expires_at set default (now() + interval '10 minutes');

create index if not exists device_node_commands_expiry_idx
  on device_node_commands (node_id, status, expires_at);
