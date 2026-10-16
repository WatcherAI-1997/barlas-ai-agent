import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

import { applyMigrations } from "./native-database.js";
import { setRuntimeShutdownHook } from "./runtime-lifecycle.js";

const root = resolve(process.env.BARLAS_NATIVE_ROOT ?? process.cwd());
const dataRoot = resolve(process.env.BARLAS_NATIVE_DATA ?? resolve(root, "data", "native"));
const databaseDirectory = resolve(dataRoot, "database");
const migrationsDirectory = resolve(root, "migrations");
const databasePort = Number.parseInt(process.env.BARLAS_NATIVE_DATABASE_PORT ?? "17841", 10);
if (!Number.isInteger(databasePort) || databasePort < 1024 || databasePort > 65535) {
  throw new Error("BARLAS_NATIVE_DATABASE_PORT must be between 1024 and 65535");
}

await mkdir(databaseDirectory, { recursive: true });
// PGlite strips the literal "file://" prefix itself. A standards-compliant
// Windows file URL is file:///C:/..., which would leave /C:/... and make
// path.resolve() produce C:\\C:\\.... Pass the already-resolved native path
// directly; PGlite's NodeFS backend supports absolute paths on every OS.
const embedded = await PGlite.create(databaseDirectory);
await applyMigrations(embedded, migrationsDirectory);
const socket = new PGLiteSocketServer({ db: embedded, host: "127.0.0.1", port: databasePort });
await socket.start();

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${databasePort}/postgres`;
setRuntimeShutdownHook(async () => {
  await socket.stop();
  await embedded.close();
});

try {
  await import("./server.js");
} catch (error) {
  await socket.stop().catch(() => undefined);
  await embedded.close().catch(() => undefined);
  throw error;
}
