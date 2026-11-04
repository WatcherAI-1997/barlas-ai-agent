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
      expect(Number(migrations.rows[0]?.count)).toBe(28);
      const personality = await database.query<{ identity_version: number }>(
        `insert into agent_profiles (user_id, slug, name, character_values, initiative_level, risk_posture, critique_style, color)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning identity_version`,
        ["owner", "strategist", "Strategist", ["foresight"], "proactive", "cautious", "challenging", "#C62828"],
      );
      expect(personality.rows[0]?.identity_version).toBe(1);
      await expect(database.query(
        `insert into agent_profiles (user_id, slug, name, character_values, color) values ($1, $2, $3, $4, $5)`,
        ["owner", "unsafe", "Unsafe", [], "red"],
      )).rejects.toThrow();
      const reminder = await database.query<{ reminder_count: number }>(
        "insert into commitments (user_id, title, next_reminder_at, reminder_interval_hours) values ($1, $2, now(), 24) returning reminder_count",
        ["owner", "Verify reminders"],
      );
      expect(reminder.rows[0]?.reminder_count).toBe(0);
      await expect(database.query(
        "insert into commitments (user_id, title, next_reminder_at, reminder_interval_hours) values ($1, $2, now(), 0)",
        ["owner", "Invalid reminder"],
      )).rejects.toThrow();
      const account = await database.query<{ id: string }>(
        "insert into user_accounts (email, display_name, role) values ($1, $2, 'owner') returning id",
        ["node-owner@example.test", "Node owner"],
      );
      const node = await database.query<{ id: string }>(
        `insert into device_nodes (account_id, name, platform, token_hash, capabilities)
         values ($1, 'Phone', 'android', 'node-token-hash', array['location']) returning id`,
        [account.rows[0]!.id],
      );
      const location = await database.query<{ kind: string; status: string; expires_at: Date }>(
        `insert into device_node_commands (node_id, account_id, kind, payload, expires_at)
         values ($1, $2, 'location.get', '{"accuracy":"balanced","timeoutSeconds":30}', now() + interval '1 minute')
         returning kind, status, expires_at`,
        [node.rows[0]!.id, account.rows[0]!.id],
      );
      expect(location.rows[0]).toMatchObject({ kind: "location.get", status: "queued" });
      await expect(database.query(
        `insert into device_node_commands (node_id, account_id, kind, payload)
         values ($1, $2, 'shell.execute', '{}')`,
        [node.rows[0]!.id, account.rows[0]!.id],
      )).rejects.toThrow();
    } finally { await database.close(); }
  });

  it("passes native Windows paths directly instead of creating a duplicated drive prefix", async () => {
    const entrypoint = await readFile(resolve(import.meta.dirname, "..", "src", "native.ts"), "utf8");
    expect(entrypoint).toContain("PGlite.create(databaseDirectory)");
    expect(entrypoint).not.toContain("pathToFileURL(databaseDirectory)");
  });

  it("accepts the database pool's parallel native connections", async () => {
    const entrypoint = await readFile(resolve(import.meta.dirname, "..", "src", "native.ts"), "utf8");
    expect(entrypoint).toContain("maxConnections: 10");
  });
});
