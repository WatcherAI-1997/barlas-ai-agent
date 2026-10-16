import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface SqlExecutor {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export async function applyMigrations(database: SqlExecutor, migrationsDirectory: string): Promise<void> {
  await database.exec(`
    create table if not exists _barlas_native_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const applied = await database.query<{ name: string }>("select name from _barlas_native_migrations");
  const appliedNames = new Set(applied.rows.map((row) => row.name));
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  if (migrations.length === 0) throw new Error(`No migrations found in ${migrationsDirectory}`);
  for (const migration of migrations) {
    if (appliedNames.has(migration)) continue;
    const sql = await readFile(resolve(migrationsDirectory, migration), "utf8");
    await database.exec(`begin;\n${sql}\ninsert into _barlas_native_migrations (name) values ('${migration}');\ncommit;`);
  }
}
