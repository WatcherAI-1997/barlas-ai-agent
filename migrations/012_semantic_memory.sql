alter table memories
  add column if not exists embedding real[],
  add column if not exists embedding_model text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'memories_embedding_size_check'
  ) then
    alter table memories
      add constraint memories_embedding_size_check
      check (embedding is null or cardinality(embedding) between 1 and 4096);
  end if;
end $$;

create index if not exists memories_semantic_candidates_idx
  on memories (user_id, created_at desc)
  where embedding is not null;
