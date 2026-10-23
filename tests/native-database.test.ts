import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../src/native-database.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("native embedded database", () => {
  it("applies every production migration without a PostgreSQL server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "barlas-pglite-"));
    temporaryDirectories.push(directory);
    const database = await PGlite.create(directory);
    try {
      await applyMigrations(database, resolve(import.meta.dirname, "..", "migrations"));
      await applyMigrations(database, resolve(import.meta.dirname, "..", "migrations"));
      const result = await database.query<{ count: string }>("select count(*)::text as count from information_schema.tables where table_schema = 'public'");
      expect(Number(result.rows[0]?.count)).toBeGreaterThan(20);
      const migrations = await database.query<{ count: string }>("select count(*)::text as count from _barlas_native_migrations");
      expect(Number(migrations.rows[0]?.count)).toBe(24);
    } finally { await database.close(); }
  });

  it("passes native Windows paths directly instead of creating a duplicated drive prefix", async () => {
    const entrypoint = await readFile(resolve(import.meta.dirname, "..", "src", "native.ts"), "utf8");
    expect(entrypoint).toContain("PGlite.create(databaseDirectory)");
    expect(entrypoint).not.toContain("pathToFileURL(databaseDirectory)");
  });
});
