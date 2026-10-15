import { z } from "zod";

import { ToolRegistry } from "./registry.js";

export function createBuiltinToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "system.current_time",
    description: "Return the current server time in ISO 8601 format.",
    risk: "read",
    inputSchema: z.object({}).strict(),
    execute: async () => ({ now: new Date().toISOString() }),
  });

  registry.register({
    name: "text.statistics",
    description: "Count characters, words, and lines in supplied text.",
    risk: "read",
    inputSchema: z.object({ text: z.string().max(100_000) }),
    execute: async (input) => {
      const { text } = input as { text: string };
      const trimmed = text.trim();
      return {
        characters: [...text].length,
        words: trimmed ? trimmed.split(/\s+/u).length : 0,
        lines: text ? text.split(/\r?\n/u).length : 0,
      };
    },
  });

  return registry;
}

