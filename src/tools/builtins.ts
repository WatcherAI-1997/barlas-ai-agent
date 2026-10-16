import { z } from "zod";

import { ToolRegistry } from "./registry.js";
import { FileWorkspace } from "./file-workspace.js";
import { RestrictedTerminal } from "./terminal.js";
import { SearxngSearchClient } from "./web-search.js";

export function createBuiltinToolRegistry(options: {
  workspaceRoot?: string;
  searxngBaseUrl?: string;
} = {}): ToolRegistry {
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

  if (options.workspaceRoot) {
    const workspace = new FileWorkspace(options.workspaceRoot);
    const terminal = new RestrictedTerminal(workspace);
    registry.register({
      name: "files.list",
      description: "List regular files and directories in the current user's isolated workspace.",
      risk: "read",
      inputSchema: z.object({ path: z.string().min(1).max(1_000).default(".") }).strict(),
      execute: async (input, context) => workspace.list(context.userId, (input as { path: string }).path),
    });
    registry.register({
      name: "files.read",
      description: "Read a UTF-8 file up to 1 MB from the current user's isolated workspace.",
      risk: "read",
      inputSchema: z.object({ path: z.string().min(1).max(1_000) }).strict(),
      execute: async (input, context) => workspace.read(context.userId, (input as { path: string }).path),
    });
    registry.register({
      name: "files.write",
      description: "Write a UTF-8 file up to 1 MB in the current user's isolated workspace.",
      risk: "write",
      inputSchema: z.object({
        path: z.string().min(1).max(1_000),
        content: z.string().max(1_000_000),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { path: string; content: string };
        return workspace.write(context.userId, value.path, value.content);
      },
    });
    registry.register({
      name: "terminal.inspect",
      description: "Run one allowlisted read-only inspection operation on a workspace file.",
      risk: "read",
      inputSchema: z.object({
        operation: z.enum(["sha256", "word_count", "head", "tail"]),
        path: z.string().min(1).max(1_000),
        lines: z.number().int().min(1).max(200).optional(),
      }).strict(),
      execute: async (input, context) => {
        const value = input as {
          operation: "sha256" | "word_count" | "head" | "tail";
          path: string;
          lines?: number;
        };
        return terminal.inspect({ userId: context.userId, ...value });
      },
    });
  }

  if (options.searxngBaseUrl) {
    const search = new SearxngSearchClient(options.searxngBaseUrl);
    registry.register({
      name: "web.search",
      description: "Search the web through the deployment's isolated SearXNG provider.",
      risk: "external",
      inputSchema: z.object({
        query: z.string().min(2).max(500),
        limit: z.number().int().min(1).max(10).default(5),
      }).strict(),
      execute: async (input) => {
        const value = input as { query: string; limit: number };
        return search.search(value.query, value.limit);
      },
    });
  }

  return registry;
}
