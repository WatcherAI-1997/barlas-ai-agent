import { z } from "zod";

import { ToolRegistry } from "./registry.js";
import { FileWorkspace } from "./file-workspace.js";
import { RestrictedTerminal } from "./terminal.js";
import { SearxngSearchClient } from "./web-search.js";
import { SafeWebReader } from "./safe-web.js";
import { DocumentReader, DocumentWriter } from "./documents.js";
import type { ManagedBrowser } from "./managed-browser.js";
import type { SubagentCoordinator } from "../core/subagents.js";
import type { CodeSandboxClient } from "./code-sandbox.js";
import type { GitHubConnector } from "../connectors/github.js";
import type { GoogleConnector } from "../connectors/google.js";

export function createBuiltinToolRegistry(options: {
  workspaceRoot?: string;
  searxngBaseUrl?: string;
  githubConnector?: Pick<GitHubConnector, "profile" | "repositories">;
  googleConnector?: Pick<GoogleConnector, "driveFiles" | "gmailMessages" | "calendarEvents">;
  managedBrowser?: Pick<ManagedBrowser, "run">;
  subagentCoordinator?: Pick<SubagentCoordinator, "delegate">;
  codeSandbox?: Pick<CodeSandboxClient, "run">;
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
    const documents = new DocumentWriter(workspace);
    const documentReader = new DocumentReader(workspace);
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
    registry.register({
      name: "documents.create",
      description: "Create a Markdown, plain-text, or CSV document in the current user's isolated workspace.",
      risk: "write",
      inputSchema: z.discriminatedUnion("format", [
        z.object({
          format: z.literal("markdown"),
          path: z.string().min(1).max(1_000),
          content: z.string().max(1_000_000),
        }).strict(),
        z.object({
          format: z.literal("text"),
          path: z.string().min(1).max(1_000),
          content: z.string().max(1_000_000),
        }).strict(),
        z.object({
          format: z.literal("csv"),
          path: z.string().min(1).max(1_000),
          rows: z.array(z.array(z.string().max(10_000)).max(50)).max(1_000),
        }).strict(),
        z.object({
          format: z.literal("docx"),
          path: z.string().min(1).max(1_000),
          content: z.string().max(1_000_000),
        }).strict(),
      ]),
      execute: async (input, context) => documents.create({
        userId: context.userId,
        ...(input as { path: string; format: "markdown" | "text" | "csv" | "docx"; content?: string; rows?: string[][] }),
      }),
    });
    registry.register({
      name: "documents.extract",
      description: "Extract bounded plain text from a PDF or DOCX document in the current user's isolated workspace.",
      risk: "read",
      inputSchema: z.object({ path: z.string().min(1).max(1_000) }).strict(),
      execute: async (input, context) => documentReader.extract(context.userId, (input as { path: string }).path),
    });
  }

  const webReader = new SafeWebReader();
  registry.register({
    name: "browser.open",
    description: "Read a public HTTP or HTTPS page as bounded plain text without scripts, cookies, or browser state.",
    risk: "external",
    inputSchema: z.object({ url: z.string().url().max(2_000) }).strict(),
    execute: async (input) => webReader.open((input as { url: string }).url),
  });

  if (options.subagentCoordinator) {
    registry.register({
      name: "agent.delegate",
      description: "Run up to three independent analytical subagents in parallel, without tools or recursive delegation, and return their bounded findings.",
      risk: "read",
      inputSchema: z.object({
        objective: z.string().min(1).max(20_000),
        taskClass: z.enum(["fast", "deep", "private"]).default("deep"),
        tasks: z.array(z.object({
          name: z.string().min(1).max(100),
          instruction: z.string().min(1).max(10_000),
          context: z.string().max(30_000).optional(),
        }).strict()).min(1).max(3),
      }).strict(),
      execute: async (input, context) => options.subagentCoordinator!.delegate({
        userId: context.userId,
        ...(input as {
          objective: string;
          taskClass: "fast" | "deep" | "private";
          tasks: Array<{ name: string; instruction: string; context?: string }>;
        }),
      }),
    });
  }

  if (options.codeSandbox) {
    registry.register({
      name: "code.run",
      description: "Run Python, Node.js, Git, or npm inside the user's isolated workspace sandbox. The sandbox has no network, host mounts, Docker socket, or shell expansion.",
      risk: "write",
      inputSchema: z.object({
        command: z.enum(["python", "node", "git", "npm"]),
        args: z.array(z.string().max(500)).max(64).default([]),
        cwd: z.string().min(1).max(1_000).default("."),
        timeoutSeconds: z.number().int().min(1).max(60).default(30),
      }).strict(),
      execute: async (input, context) => options.codeSandbox!.run({
        userId: context.userId,
        ...(input as {
          command: "python" | "node" | "git" | "npm";
          args: string[];
          cwd: string;
          timeoutSeconds: number;
        }),
      }),
    });
  }

  if (options.managedBrowser) {
    const actionSchema = z.discriminatedUnion("type", [
      z.object({ type: z.literal("navigate"), url: z.string().url().max(2_000) }).strict(),
      z.object({ type: z.literal("click"), selector: z.string().min(1).max(1_000) }).strict(),
      z.object({ type: z.literal("fill"), selector: z.string().min(1).max(1_000), value: z.string().max(10_000) }).strict(),
      z.object({ type: z.literal("select"), selector: z.string().min(1).max(1_000), value: z.string().max(1_000) }).strict(),
      z.object({
        type: z.literal("press"),
        selector: z.string().min(1).max(1_000),
        key: z.enum(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"]),
      }).strict(),
      z.object({ type: z.literal("wait"), milliseconds: z.number().int().min(0).max(5_000) }).strict(),
    ]);
    registry.register({
      name: "browser.interact",
      description: "Open and interact with a public JavaScript website in an ephemeral browser. Credentials, downloads, popups, local networks, and nonstandard ports are blocked.",
      risk: "external",
      inputSchema: z.object({
        url: z.string().url().max(2_000),
        actions: z.array(actionSchema).max(8).default([]),
      }).strict(),
      execute: async (input) => options.managedBrowser!.run(input as {
        url: string;
        actions: import("./managed-browser.js").BrowserAction[];
      }),
    });
  }

  if (options.githubConnector) {
    registry.register({
      name: "github.repositories",
      description: "List repository metadata from one of the current user's encrypted GitHub connections.",
      risk: "external",
      inputSchema: z.object({ connectorId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(30) }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; limit: number };
        return options.githubConnector!.repositories(context.userId, value.connectorId, value.limit);
      },
    });
  }

  if (options.googleConnector) {
    const schema = z.object({ connectorId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(30) }).strict();
    registry.register({
      name: "google_drive.files",
      description: "List recent file metadata from one of the current user's encrypted Google Drive connections.",
      risk: "external",
      inputSchema: schema,
      execute: async (input, context) => {
        const value = input as { connectorId: string; limit: number };
        return options.googleConnector!.driveFiles(context.userId, value.connectorId, value.limit);
      },
    });
    registry.register({
      name: "gmail.messages",
      description: "List recent message IDs from one of the current user's encrypted Gmail connections.",
      risk: "external",
      inputSchema: schema,
      execute: async (input, context) => {
        const value = input as { connectorId: string; limit: number };
        return options.googleConnector!.gmailMessages(context.userId, value.connectorId, value.limit);
      },
    });
    registry.register({
      name: "google_calendar.events",
      description: "List upcoming events from one of the current user's encrypted Google Calendar connections.",
      risk: "external",
      inputSchema: schema,
      execute: async (input, context) => {
        const value = input as { connectorId: string; limit: number };
        return options.googleConnector!.calendarEvents(context.userId, value.connectorId, value.limit);
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
