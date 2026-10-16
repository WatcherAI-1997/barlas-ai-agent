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
import type { McpConnector } from "../connectors/mcp.js";
import { speechVoices, type MediaService } from "./media.js";
import type { ProjectService } from "../projects/service.js";
import type { DeviceNodeService } from "../nodes/service.js";

export function createBuiltinToolRegistry(options: {
  workspaceRoot?: string;
  searxngBaseUrl?: string;
  githubConnector?: Pick<GitHubConnector, "profile" | "repositories" | "createBranch" | "commitFile" | "createPullRequest" | "createIssue">;
  googleConnector?: Pick<GoogleConnector, "driveFiles" | "gmailMessages" | "calendarEvents" | "createDriveFile" | "updateDriveFile" | "createGmailDraft" | "sendGmail" | "createCalendarEvent" | "updateCalendarEvent">;
  mcpConnector?: Pick<McpConnector, "listTools" | "callTool">;
  managedBrowser?: Pick<ManagedBrowser, "run">;
  subagentCoordinator?: Pick<SubagentCoordinator, "delegate">;
  codeSandbox?: Pick<CodeSandboxClient, "run">;
  mediaService?: Pick<MediaService, "analyzeImage" | "analyzePdf" | "transcribeAudio" | "createSpeech">;
  projectService?: Pick<ProjectService, "detail" | "createGoal" | "updateGoal" | "createStep" | "updateStep" | "checkpoint" | "snapshot" | "restore">;
  deviceNodes?: Pick<DeviceNodeService, "notify">;
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
      description: "Extract bounded text from PDF, DOCX, XLSX, or PPTX in the current user's isolated workspace.",
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

  if (options.mediaService) {
    registry.register({
      name: "media.image.analyze",
      description: "Analyze a PNG, JPEG, GIF, or WebP image from the current user's isolated workspace with the configured vision model.",
      risk: "external",
      inputSchema: z.object({
        path: z.string().min(1).max(1_000),
        prompt: z.string().min(1).max(20_000),
        detail: z.enum(["auto", "low", "high"]).default("auto"),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { path: string; prompt: string; detail: "auto" | "low" | "high" };
        return options.mediaService!.analyzeImage(context.userId, value.path, value.prompt, value.detail);
      },
    });
    registry.register({
      name: "media.pdf.analyze",
      description: "Analyze a PDF, including scanned pages, from the current user's isolated workspace with the configured vision model.",
      risk: "external",
      inputSchema: z.object({
        path: z.string().min(1).max(1_000),
        prompt: z.string().min(1).max(20_000),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { path: string; prompt: string };
        return options.mediaService!.analyzePdf(context.userId, value.path, value.prompt);
      },
    });
    registry.register({
      name: "media.audio.transcribe",
      description: "Transcribe a supported audio file from the current user's isolated workspace.",
      risk: "external",
      inputSchema: z.object({
        path: z.string().min(1).max(1_000),
        language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u).optional(),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { path: string; language?: string };
        return options.mediaService!.transcribeAudio(context.userId, value.path, value.language);
      },
    });
    registry.register({
      name: "media.speech.create",
      description: "Generate MP3 speech in the current user's isolated workspace.",
      risk: "external",
      inputSchema: z.object({
        path: z.string().min(1).max(1_000),
        text: z.string().min(1).max(4_096),
        voice: z.enum(speechVoices).default("alloy"),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { path: string; text: string; voice: typeof speechVoices[number] };
        return options.mediaService!.createSpeech(context.userId, value.path, value.text, value.voice);
      },
    });
  }

  if (options.deviceNodes) {
    registry.register({
      name: "nodes.notify",
      description: "Queue a notification on one paired device node. The node must advertise the notifications capability.",
      risk: "external",
      inputSchema: z.object({
        nodeId: z.string().uuid(), title: z.string().min(1).max(120), body: z.string().min(1).max(2_000),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { nodeId: string; title: string; body: string };
        const command = await options.deviceNodes!.notify(context.userId, value.nodeId, value.title, value.body);
        if (!command) throw new Error("Paired node not found or notifications capability is unavailable");
        return command;
      },
    });
  }

  if (options.projectService) {
    const projectId = z.string().uuid();
    const goalId = z.string().uuid();
    const requireResult = <T>(value: T | null, message: string): T => {
      if (value === null) throw new Error(message);
      return value;
    };
    registry.register({
      name: "projects.get",
      description: "Read the current user's project, linked resources, goals, plan steps, checkpoints, and artifact version metadata.",
      risk: "read",
      inputSchema: z.object({ projectId }).strict(),
      execute: async (input, context) => requireResult(
        await options.projectService!.detail(context.userId, (input as { projectId: string }).projectId),
        "Project not found",
      ),
    });
    registry.register({
      name: "projects.goal.create",
      description: "Create a goal in one of the current user's projects.",
      risk: "write",
      inputSchema: z.object({
        projectId,
        title: z.string().min(1).max(500),
        description: z.string().max(10_000).default(""),
        priority: z.number().int().min(0).max(100).default(0),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { projectId: string; title: string; description: string; priority: number };
        return requireResult(await options.projectService!.createGoal(context.userId, value.projectId, value.title, value.description, value.priority), "Project not found");
      },
    });
    registry.register({
      name: "projects.goal.update",
      description: "Update the status of a goal in one of the current user's projects.",
      risk: "write",
      inputSchema: z.object({ projectId, goalId, status: z.enum(["planned", "in_progress", "blocked", "completed"]) }).strict(),
      execute: async (input, context) => {
        const value = input as { projectId: string; goalId: string; status: "planned" | "in_progress" | "blocked" | "completed" };
        return requireResult(await options.projectService!.updateGoal(context.userId, value.projectId, value.goalId, value.status), "Project goal not found");
      },
    });
    registry.register({
      name: "projects.step.create",
      description: "Append an ordered plan step to one of the current user's projects, optionally under a goal.",
      risk: "write",
      inputSchema: z.object({ projectId, goalId: goalId.optional(), title: z.string().min(1).max(1_000) }).strict(),
      execute: async (input, context) => {
        const value = input as { projectId: string; goalId?: string; title: string };
        return requireResult(await options.projectService!.createStep(context.userId, value.projectId, value.title, value.goalId), "Project or goal not found");
      },
    });
    registry.register({
      name: "projects.step.update",
      description: "Update the status of a plan step in one of the current user's projects.",
      risk: "write",
      inputSchema: z.object({
        projectId,
        stepId: z.string().uuid(),
        status: z.enum(["pending", "in_progress", "blocked", "completed", "skipped"]),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { projectId: string; stepId: string; status: "pending" | "in_progress" | "blocked" | "completed" | "skipped" };
        return requireResult(await options.projectService!.updateStep(context.userId, value.projectId, value.stepId, value.status), "Project step not found");
      },
    });
    registry.register({
      name: "projects.checkpoint.create",
      description: "Record a bounded progress checkpoint in one of the current user's projects.",
      risk: "write",
      inputSchema: z.object({
        projectId,
        goalId: goalId.optional(),
        title: z.string().min(1).max(500),
        summary: z.string().max(10_000).default(""),
        progress: z.number().int().min(0).max(100),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { projectId: string; goalId?: string; title: string; summary: string; progress: number };
        return requireResult(await options.projectService!.checkpoint(context.userId, value.projectId, value.title, value.summary, value.progress, value.goalId), "Project or goal not found");
      },
    });
    registry.register({
      name: "projects.artifact.snapshot",
      description: "Save an immutable version of a workspace file as a project artifact.",
      risk: "write",
      inputSchema: z.object({ projectId, path: z.string().min(1).max(1_000) }).strict(),
      execute: async (input, context) => {
        const value = input as { projectId: string; path: string };
        return options.projectService!.snapshot(context.userId, value.projectId, value.path);
      },
    });
    registry.register({
      name: "projects.artifact.restore",
      description: "Restore one immutable project artifact version to its original workspace path.",
      risk: "write",
      inputSchema: z.object({ projectId, versionId: z.string().uuid() }).strict(),
      execute: async (input, context) => {
        const value = input as { projectId: string; versionId: string };
        return requireResult(await options.projectService!.restore(context.userId, value.projectId, value.versionId), "Artifact version not found");
      },
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
    const githubBase = {
      connectorId: z.string().uuid(),
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u).max(201),
    };
    const branch = z.string().min(1).max(200).regex(/^(?!\/|.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._\/-]+$/u);
    registry.register({
      name: "github.branch.create",
      description: "Create a branch in a repository through the user's encrypted GitHub connection.",
      risk: "external",
      inputSchema: z.object({ ...githubBase, branch, fromBranch: branch }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; repository: string; branch: string; fromBranch: string };
        return options.githubConnector!.createBranch(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "github.file.commit",
      description: "Create or update one repository file as a GitHub commit.",
      risk: "external",
      inputSchema: z.object({
        ...githubBase,
        path: z.string().min(1).max(1_000),
        branch,
        message: z.string().min(1).max(500),
        content: z.string().max(1_000_000),
        sha: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; repository: string; path: string; branch: string; message: string; content: string; sha?: string };
        return options.githubConnector!.commitFile(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "github.pull_request.create",
      description: "Open a GitHub pull request.",
      risk: "external",
      inputSchema: z.object({
        ...githubBase,
        title: z.string().min(1).max(256),
        body: z.string().max(50_000).optional(),
        head: branch,
        base: branch,
        draft: z.boolean().default(false),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; repository: string; title: string; body?: string; head: string; base: string; draft?: boolean };
        return options.githubConnector!.createPullRequest(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "github.issue.create",
      description: "Create a GitHub issue with optional labels.",
      risk: "external",
      inputSchema: z.object({
        ...githubBase,
        title: z.string().min(1).max(256),
        body: z.string().max(50_000).optional(),
        labels: z.array(z.string().min(1).max(100)).max(20).optional(),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; repository: string; title: string; body?: string; labels?: string[] };
        return options.githubConnector!.createIssue(context.userId, value.connectorId, value);
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
    const connectorId = z.string().uuid();
    const mimeType = z.enum(["text/plain", "text/markdown", "text/csv"]);
    const email = z.string().email().max(320);
    const mailSchema = {
      connectorId,
      to: z.array(email).min(1).max(20),
      cc: z.array(email).max(20).optional(),
      subject: z.string().min(1).max(500),
      body: z.string().max(500_000),
    };
    const eventSchema = {
      connectorId,
      summary: z.string().min(1).max(1_000),
      description: z.string().max(20_000).optional(),
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true }),
      timeZone: z.string().min(1).max(100).optional(),
      attendees: z.array(email).max(50).optional(),
    };
    registry.register({
      name: "google_drive.file.create",
      description: "Create a bounded text, Markdown, or CSV file in Google Drive.",
      risk: "external",
      inputSchema: z.object({
        connectorId,
        name: z.string().min(1).max(500),
        content: z.string().max(1_000_000),
        mimeType,
        parentId: z.string().min(1).max(500).optional(),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; name: string; content: string; mimeType: "text/plain" | "text/markdown" | "text/csv"; parentId?: string };
        return options.googleConnector!.createDriveFile(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "google_drive.file.update",
      description: "Replace the content of a Google Drive text, Markdown, or CSV file.",
      risk: "external",
      inputSchema: z.object({ connectorId, fileId: z.string().min(1).max(500), content: z.string().max(1_000_000), mimeType }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; fileId: string; content: string; mimeType: "text/plain" | "text/markdown" | "text/csv" };
        return options.googleConnector!.updateDriveFile(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "gmail.draft.create",
      description: "Create a Gmail draft without sending it.",
      risk: "external",
      inputSchema: z.object(mailSchema).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; to: string[]; cc?: string[]; subject: string; body: string };
        return options.googleConnector!.createGmailDraft(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "gmail.send",
      description: "Send a plain-text email through Gmail.",
      risk: "external",
      inputSchema: z.object(mailSchema).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; to: string[]; cc?: string[]; subject: string; body: string };
        return options.googleConnector!.sendGmail(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "google_calendar.event.create",
      description: "Create a primary Google Calendar event.",
      risk: "external",
      inputSchema: z.object(eventSchema).strict().refine((value) => Date.parse(value.end) > Date.parse(value.start), "Event end must be after start"),
      execute: async (input, context) => {
        const value = input as { connectorId: string; summary: string; description?: string; start: string; end: string; timeZone?: string; attendees?: string[] };
        return options.googleConnector!.createCalendarEvent(context.userId, value.connectorId, value);
      },
    });
    registry.register({
      name: "google_calendar.event.update",
      description: "Update a primary Google Calendar event.",
      risk: "external",
      inputSchema: z.object({ ...eventSchema, eventId: z.string().min(1).max(500) }).strict()
        .refine((value) => Date.parse(value.end) > Date.parse(value.start), "Event end must be after start"),
      execute: async (input, context) => {
        const value = input as { connectorId: string; eventId: string; summary: string; description?: string; start: string; end: string; timeZone?: string; attendees?: string[] };
        return options.googleConnector!.updateCalendarEvent(context.userId, value.connectorId, value);
      },
    });
  }

  if (options.mcpConnector) {
    registry.register({
      name: "mcp.tools.list",
      description: "List bounded tool metadata from one of the user's encrypted remote MCP Streamable HTTP connections.",
      risk: "external",
      inputSchema: z.object({ connectorId: z.string().uuid() }).strict(),
      execute: async (input, context) => options.mcpConnector!.listTools(
        context.userId,
        (input as { connectorId: string }).connectorId,
      ),
    });
    registry.register({
      name: "mcp.tool.call",
      description: "Call one named tool on a remote MCP server. Every call requires explicit approval because remote tool effects are not trusted.",
      risk: "external",
      inputSchema: z.object({
        connectorId: z.string().uuid(),
        name: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:\/-]+$/u),
        arguments: z.record(z.string(), z.unknown()).default({}),
      }).strict(),
      execute: async (input, context) => {
        const value = input as { connectorId: string; name: string; arguments: Record<string, unknown> };
        return options.mcpConnector!.callTool(context.userId, value.connectorId, value.name, value.arguments);
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
