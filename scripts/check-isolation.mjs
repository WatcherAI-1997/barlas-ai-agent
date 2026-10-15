import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const composePath = resolve("compose.yml");
const compose = await readFile(composePath, "utf8");
const requiredPrefix = "barlas-ai-agent";
const forbiddenNames = ["openclaw", "hermes", "security-frigate"];

if (!compose.includes(`name: ${requiredPrefix}`)) {
  throw new Error("Compose project must use the dedicated Barlas AI Agent name.");
}

for (const forbiddenName of forbiddenNames) {
  if (compose.toLowerCase().includes(forbiddenName)) {
    throw new Error(`Isolation violation: compose.yml references ${forbiddenName}.`);
  }
}

console.log("Barlas AI Agent isolation check passed.");

