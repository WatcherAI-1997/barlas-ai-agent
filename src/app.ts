import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Readable, Transform } from "node:stream";

import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AccountConflictError,
  AuthenticationError,
  AuthorizationError,
  type AccountRole,
  type AuthService,
  type UserAccount,
} from "./auth/service.js";
import type { ModelProvider } from "./core/models.js";
import type { AgentLoop } from "./core/agent-loop.js";
import type { TelegramLinkService } from "./auth/telegram-link.js";
import { parseTelegramVoiceCommand } from "./channels/telegram.js";
import { sendTelegramVoiceReply, telegramVoiceFallbackText } from "./channels/telegram-voice.js";
import { extractWhatsAppMessages, verifyWhatsAppSignature } from "./channels/whatsapp.js";
import type { GitHubConnector } from "./connectors/github.js";
import type { GoogleConnector } from "./connectors/google.js";
import { connectorProviders, type ConnectorService } from "./connectors/vault.js";
import type { SemanticMemory } from "./memory/semantic.js";
import {
  getSetupPhrasePack,
  getSetupPhrasePackDescriptor,
  isSupportedLanguage,
  languageInstruction,
  setupPhrasePackCompleteness,
  setupTranslationStatus,
  supportedLanguages,
  type SupportedLanguageCode,
} from "./i18n/languages.js";
import { barlasCouncil, chiefBarlasInstruction } from "./agents/command.js";
import {
  OrganizationAuthorizationError,
  type OrganizationService,
} from "./organizations/service.js";
import type { PersistentAgentRuntime } from "./runs/runtime.js";
import { QuotaExceededError, type RuntimeGovernance } from "./governance/runtime.js";
import { agentJobSchema } from "./jobs/agent-handler.js";
import { workflowJobSchema } from "./jobs/workflow-handler.js";
import type { SkillRegistry } from "./skills/registry.js";
import type { SkillManager } from "./skills/manager.js";
import { parseSignedSkillPackageValue, verifySkillPackage } from "./skills/package.js";
import type { AgentStore } from "./storage/types.js";
import type { ToolExecutor } from "./tools/executor.js";
import { MAX_MEDIA_BYTES, speechVoices, type MediaService, type SpeechVoice } from "./tools/media.js";
import { DEFAULT_MAX_WORKSPACE_FILE_BYTES, type FileWorkspace } from "./tools/file-workspace.js";
import type { ScheduleService } from "./schedules/service.js";
import type { GoalStatus, PlanStepStatus, ProjectService, ProjectResourceType } from "./projects/service.js";
import type { ContinuityService } from "./continuity/service.js";
import type { OutcomeService } from "./outcomes/service.js";
import { renderPrometheusMetrics } from "./operations/metrics.js";
import type { ExtensionCatalog } from "./extensions/catalog.js";
import type { DeviceNodeService } from "./nodes/service.js";
import type { McpConnector } from "./connectors/mcp.js";
import {
  AgentProfileConflictError,
  agentProfileInstruction,
  type AgentProfileService,
} from "./agents/profiles.js";
import type { RuntimeControl, RuntimeControlState } from "./system/runtime-control.js";

class RuntimePausedError extends Error {}

const chatBodySchema = z.object({
  userId: z.string().min(1).max(128),
  conversationId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(100_000),
      }),
    )
    .min(1)
    .max(100),
  taskClass: z.enum(["fast", "deep", "private"]).optional(),
  agentId: z.string().uuid().optional(),
});

const agentRunBodySchema = chatBodySchema.extend({
  maxSteps: z.number().int().min(1).max(12).default(8),
  maxTotalTokens: z.number().int().min(1_000).max(100_000).optional(),
  allowedTools: z.array(z.string().min(1).max(128)).max(32).optional(),
  skillId: z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/u).optional(),
  skillVersion: z.string().regex(/^\d+\.\d+\.\d+$/u).optional(),
  projectId: z.string().uuid().optional(),
}).refine((input) => !input.skillVersion || input.skillId, {
  message: "skillVersion requires skillId",
  path: ["skillVersion"],
});

type ChatMessage = z.infer<typeof chatBodySchema>["messages"][number];

function sameMessage(left: ChatMessage, right: ChatMessage): boolean {
  return left.role === right.role && left.content === right.content;
}

function mergeConversationMessages(history: ChatMessage[], incoming: ChatMessage[]): {
  modelMessages: ChatMessage[];
  newMessages: ChatMessage[];
} {
  const boundedHistory: ChatMessage[] = [];
  let characters = 0;
  for (const message of [...history].reverse()) {
    if (boundedHistory.length >= 80 || characters + message.content.length > 80_000) break;
    boundedHistory.unshift(message);
    characters += message.content.length;
  }

  let overlap = Math.min(boundedHistory.length, incoming.length);
  while (overlap > 0) {
    const historyStart = boundedHistory.length - overlap;
    if (incoming.slice(0, overlap).every((message, index) => (
      sameMessage(message, boundedHistory[historyStart + index]!)
    ))) break;
    overlap -= 1;
  }
  const newMessages = incoming.slice(overlap);
  return { modelMessages: [...boundedHistory, ...newMessages], newMessages };
}

function channelConversationId(channel: string, userId: string, chatId: string): string {
  const bytes = createHash("sha256").update(`${channel}\0${userId}\0${chatId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const rememberBodySchema = z.object({
  userId: z.string().min(1).max(128),
  content: z.string().min(1).max(20_000),
  category: z.string().min(1).max(64).default("general"),
  importance: z.number().int().min(1).max(10).default(5),
});

const recallQuerySchema = z.object({
  userId: z.string().min(1).max(128),
  query: z.string().min(1).max(2_000),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      text: z.string().min(1).max(20_000),
      chat: z.object({ id: z.number().int() }),
      from: z.object({ id: z.number().int() }).optional(),
    })
    .optional(),
  callback_query: z.object({
    id: z.string().min(1).max(256),
    data: z.string().min(1).max(64),
    from: z.object({ id: z.number().int() }),
    message: z.object({ chat: z.object({ id: z.number().int() }) }).optional(),
  }).optional(),
});
const socketChannelMessageSchema = z.object({
  id: z.string().min(1).max(64), channelId: z.string().min(1).max(64),
  authorId: z.string().min(1).max(64), content: z.string().trim().min(1).max(20_000),
}).strict();

const toolExecutionSchema = z.object({
  userId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  toolInput: z.unknown(),
  summary: z.string().min(1).max(500),
});

const mediaUploadQuerySchema = z.object({
  userId: z.string().min(1).max(128),
  path: z.string().min(1).max(1_000),
}).strict();
const voiceTurnQuerySchema = z.object({
  userId: z.string().min(1).max(128),
  conversationId: z.string().uuid().optional(),
  taskClass: z.enum(["fast", "deep", "private"]).optional(),
  agentId: z.string().uuid().optional(),
  voice: z.enum(speechVoices).optional(),
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u).optional(),
  consent: z.literal("true"),
}).strict();
const fileQuerySchema = z.object({
  userId: z.string().min(1).max(128), path: z.string().min(1).max(1_000).default("."),
}).strict();
const fileUploadQuerySchema = fileQuerySchema.extend({ overwrite: z.enum(["true", "false"]).default("false") });
const projectBodySchema = z.object({ userId: z.string().min(1).max(128), name: z.string().min(1).max(120), description: z.string().max(4_000).default("") }).strict();
const agentProfileBodySchema = z.object({
  userId: z.string().min(1).max(128),
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/u),
  name: z.string().min(1).max(80),
  style: z.enum(["balanced", "concise", "warm", "analytical", "creative"]).default("balanced"),
  instructions: z.string().max(4_000).default(""),
  defaultTaskClass: z.enum(["fast", "deep", "private"]).default("fast"),
  projectId: z.string().uuid().optional(),
}).strict();
const projectQuerySchema = z.object({ userId: z.string().min(1).max(128) }).strict();
const projectParamsSchema = z.object({ id: z.string().uuid() });
const agentProfileParamsSchema = z.object({ id: z.string().uuid() });
const projectResourceSchema = z.object({
  userId: z.string().min(1).max(128), type: z.enum(["conversation", "agent_run", "memory", "file"]),
  resourceId: z.string().min(1).max(1_000), label: z.string().max(200).default(""),
}).strict();
const artifactSchema = z.object({ userId: z.string().min(1).max(128), path: z.string().min(1).max(1_000) }).strict();
const artifactParamsSchema = z.object({ id: z.string().uuid(), versionId: z.string().uuid() });
const projectGoalSchema = z.object({ userId: z.string().min(1).max(128), title: z.string().min(1).max(200), description: z.string().max(4_000).default(""), priority: z.number().int().min(1).max(5).default(3) }).strict();
const projectGoalParamsSchema = z.object({ id: z.string().uuid(), goalId: z.string().uuid() });
const projectGoalStatusSchema = z.object({ userId: z.string().min(1).max(128), status: z.enum(["planned", "in_progress", "blocked", "completed"]) }).strict();
const projectStepSchema = z.object({ userId: z.string().min(1).max(128), title: z.string().min(1).max(300), goalId: z.string().uuid().optional() }).strict();
const projectStepParamsSchema = z.object({ id: z.string().uuid(), stepId: z.string().uuid() });
const projectStepStatusSchema = z.object({ userId: z.string().min(1).max(128), status: z.enum(["pending", "in_progress", "blocked", "completed", "skipped"]) }).strict();
const projectCheckpointSchema = z.object({ userId: z.string().min(1).max(128), title: z.string().min(1).max(200), summary: z.string().min(1).max(10_000), progress: z.number().int().min(0).max(100), goalId: z.string().uuid().optional() }).strict();

function fileSystemCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function isWorkspaceInputError(error: unknown): boolean {
  return error instanceof Error && /^(Path must be relative|Path escapes|Unsafe workspace path|Only regular files|Uploaded file is empty|File exceeds)/u.test(error.message);
}

const approvalParamsSchema = z.object({ id: z.string().uuid() });
const approvalDecisionSchema = z.object({
  userId: z.string().min(1).max(128),
  approved: z.boolean(),
});

const createJobSchema = z.discriminatedUnion("jobType", [
  z.object({
    userId: z.string().min(1).max(128),
    jobType: z.literal("agent.run"),
    input: agentJobSchema,
    scheduledFor: z.string().datetime().optional(),
  }),
  z.object({
    userId: z.string().min(1).max(128),
    jobType: z.literal("agent.workflow"),
    input: workflowJobSchema,
    scheduledFor: z.string().datetime().optional(),
  }),
]);

const listJobsSchema = z.object({
  userId: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const listTracesSchema = z.object({
  userId: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const userListSchema = z.object({
  userId: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const conversationParamsSchema = z.object({ id: z.string().uuid() });
const jobParamsSchema = z.object({ id: z.string().uuid() });
const agentRunParamsSchema = z.object({ id: z.string().uuid() });
const dashboardQuerySchema = z.object({ userId: z.string().min(1).max(128).optional() });
const connectorParamsSchema = z.object({ id: z.string().uuid() });
const connectorListSchema = z.object({ userId: z.string().min(1).max(128) });
const connectorCreateSchema = z.object({
  userId: z.string().min(1).max(128),
  provider: z.enum(connectorProviders),
  label: z.string().trim().min(1).max(100),
  secret: z.string().min(1).max(20_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  if (value.provider !== "mcp_http") return;
  const endpoint = value.metadata?.endpoint;
  if (typeof endpoint !== "string") {
    context.addIssue({ code: "custom", path: ["metadata", "endpoint"], message: "MCP HTTPS endpoint is required" });
    return;
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error();
  } catch {
    context.addIssue({ code: "custom", path: ["metadata", "endpoint"], message: "Invalid MCP HTTPS endpoint" });
  }
});
const githubRepositoriesSchema = z.object({
  userId: z.string().min(1).max(128),
  connectorId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const googleListSchema = githubRepositoriesSchema;
const organizationParamsSchema = z.object({ id: z.string().uuid() });
const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(3).max(64),
  plan: z.enum(["private_alpha", "team", "business"]).default("private_alpha"),
}).strict();
const organizationMemberSchema = z.object({
  accountId: z.string().uuid(),
  role: z.enum(["admin", "member", "viewer"]),
}).strict();
const organizationPlanSchema = z.object({
  plan: z.enum(["private_alpha", "team", "business"]),
}).strict();
const accountParamsSchema = z.object({ id: z.string().uuid() });
const skillParamsSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
});
const skillInstallSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(20_000),
  allowedTools: z.array(z.string().min(1).max(128)).max(32),
  provenance: z.object({
    format: z.literal("agentskills.io"),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  }).strict().optional(),
}).strict();
const skillEvaluationSchema = z.object({
  cases: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    prompt: z.string().min(1).max(10_000),
    requiredStrings: z.array(z.string().min(1).max(500)).min(1).max(10),
    forbiddenStrings: z.array(z.string().min(1).max(500)).max(10).default([]),
  }).strict()).min(1).max(5),
}).strict();
const signedSkillInstallSchema = z.object({
  package: z.unknown(),
  trustedFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();
const scheduleParamsSchema = z.object({ id: z.string().uuid() });
const scheduleCreateSchema = z.object({
  userId: z.string().min(1).max(128), name: z.string().trim().min(1).max(100),
  objective: z.string().min(1).max(20_000), cronExpression: z.string().min(5).max(100),
  timezone: z.string().min(1).max(100), taskClass: z.enum(["fast", "deep", "private"]).default("deep"),
  allowedTools: z.array(z.string().min(1).max(128)).max(32).optional(),
  maxSteps: z.number().int().min(1).max(12).default(8),
  maxTotalTokens: z.number().int().min(1_000).max(100_000).default(50_000),
  deliveryChannel: z.enum(["web", "telegram"]).default("web"),
}).strict();

const createUserSchema = z.object({
  email: z.string().min(3).max(254),
  displayName: z.string().min(2).max(100),
  role: z.enum(["owner", "user"]).default("user"),
  languageCode: z.string()
    .refine(isSupportedLanguage, "Unsupported language")
    .transform((value) => value as SupportedLanguageCode)
    .optional(),
}).strict();

const languagePreferenceSchema = z.object({
  languageCode: z.string()
    .refine(isSupportedLanguage, "Unsupported language")
    .transform((value) => value as SupportedLanguageCode),
}).strict();
const nodeUserSchema = z.object({ userId: z.string().uuid() }).strict();
const nodeParamsSchema = z.object({ id: z.string().uuid() }).strict();
const nodePairSchema = z.object({
  code: z.string().min(16).max(128), name: z.string().min(1).max(120),
  platform: z.enum(["linux", "macos", "windows", "android", "ios"]),
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/u)).max(32).default([]),
}).strict();
const nodeHeartbeatSchema = z.object({
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9._-]{1,63}$/u)).max(32).optional(),
}).strict();
const nodeResultSchema = z.object({ succeeded: z.boolean(), error: z.string().max(1_000).optional() }).strict();
const nodeCommandParamsSchema = z.object({ id: z.string().uuid() }).strict();

interface Principal {
  userId: string;
  role: AccountRole;
  authType: "service" | "gateway" | "session";
  account?: UserAccount;
  token?: string;
}

export interface AppDependencies {
  apiToken: string;
  gatewayToken?: string;
  gatewayOwner?: UserAccount;
  database: AgentStore;
  modelProvider: ModelProvider;
  agentLoop?: Pick<AgentLoop, "run">;
  agentRuntime?: Pick<PersistentAgentRuntime, "start" | "enqueue" | "resume" | "resumeByApproval" | "get" | "list" | "events" | "cancel">;
  toolExecutor?: Pick<ToolExecutor, "listTools" | "execute" | "decide">;
  skillRegistry?: Pick<SkillRegistry, "list" | "get" | "isActive">;
  skillManager?: Pick<SkillManager, "install" | "evaluate" | "activate">;
  extensionCatalog?: Pick<ExtensionCatalog, "list" | "get">;
  deviceNodes?: Pick<DeviceNodeService, "createPairingCode" | "pair" | "authenticate" | "list" | "revoke" | "poll" | "complete">;
  governance?: RuntimeGovernance;
  authService?: Pick<AuthService,
    "authenticate" | "logout" | "listAccounts" | "createAccount" | "getAccount" | "setLanguage"
  > & Partial<Pick<AuthService, "issueAccessToken">>;
  telegramLinks?: Pick<TelegramLinkService, "createCode" | "claim" | "get" | "resolve" | "unlink">;
  connectors?: Pick<ConnectorService, "save" | "list" | "delete">;
  githubConnector?: Pick<GitHubConnector, "profile" | "repositories">;
  googleConnector?: Pick<GoogleConnector, "driveFiles" | "gmailMessages" | "calendarEvents">;
  mcpConnector?: Pick<McpConnector, "listTools">;
  memory?: Pick<SemanticMemory, "remember" | "recall">;
  organizations?: Pick<OrganizationService, "create" | "list" | "members" | "addMember" | "changePlan">;
  media?: Pick<MediaService, "saveUpload"> & Partial<Pick<MediaService, "createSpeech" | "transcribeUpload" | "createSpeechBuffer">>;
  workspace?: Pick<FileWorkspace, "list" | "readBuffer" | "writeUpload"> & Partial<Pick<FileWorkspace, "streamForRead" | "writeUploadStream">>;
  maxWorkspaceFileBytes?: number;
  projects?: Pick<ProjectService, "create" | "list" | "detail" | "context" | "attach" | "snapshot" | "restore" | "createGoal" | "updateGoal" | "createStep" | "updateStep" | "checkpoint" | "recordRunResult">;
  continuity?: Pick<ContinuityService, "context">;
  outcomes?: Pick<OutcomeService, "context">;
  agentProfiles?: Pick<AgentProfileService, "create" | "list" | "get" | "delete" | "resolve">;
  schedules?: Pick<ScheduleService, "create" | "list" | "pause" | "resume" | "disable">;
  webRoot?: string;
  runtimeInfo?: { workerEnabled: boolean };
  runtimeControl?: Pick<RuntimeControl, "state" | "isPaused" | "pause" | "resume">;
  defaultSpeechVoice?: SpeechVoice;
  agentIdentity?: {
    name: string;
    style: "balanced" | "concise" | "warm" | "analytical" | "creative";
    instructions?: string;
  };
  telegram?: {
    webhookSecret: string;
    client: {
      maxUploadBytes?: number;
      sendMessage(chatId: number, text: string): Promise<void>;
      sendChatAction?(chatId: number, action?: "typing" | "record_voice"): Promise<void>;
      sendVoice?(chatId: number, content: Buffer, caption?: string): Promise<void>;
      sendApproval?(chatId: number, text: string, approvalId: string): Promise<void>;
      answerCallbackQuery?(callbackQueryId: string, text: string): Promise<void>;
    };
  };
  discord?: {
    gatewaySecret: string;
    client: { sendMessage(channelId: string, text: string): Promise<void> };
  };
  slack?: {
    socketSecret: string;
    client: { sendMessage(channelId: string, text: string): Promise<void> };
  };
  whatsapp?: {
    appSecret: string;
    verifyToken: string;
    client: { sendMessage(recipientId: string, text: string): Promise<void> };
  };
  logger?: boolean;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function preferredLanguageContext(
  userId: string,
  authService: AppDependencies["authService"],
): Promise<Array<{ role: "system"; content: string }>> {
  if (!authService || !z.string().uuid().safeParse(userId).success) return [];
  const account = await authService.getAccount(userId);
  const instruction = languageInstruction(account?.languageCode);
  return instruction ? [{ role: "system", content: instruction }] : [];
}

async function continuityContext(
  userId: string,
  continuity: AppDependencies["continuity"],
): Promise<Array<{ role: "system"; content: string }>> {
  if (!continuity) return [];
  const content = await continuity.context(userId);
  return content ? [{ role: "system", content }] : [];
}

async function outcomeContext(
  userId: string,
  outcomes: AppDependencies["outcomes"],
): Promise<Array<{ role: "system"; content: string }>> {
  if (!outcomes) return [];
  const content = await outcomes.context(userId);
  return content ? [{ role: "system", content }] : [];
}

function agentIdentityContext(
  identity: AppDependencies["agentIdentity"],
): Array<{ role: "system"; content: string }> {
  if (!identity) return [];
  const styleInstructions = {
    balanced: "Be clear, practical, and appropriately detailed.",
    concise: "Prefer short, direct answers unless detail is necessary.",
    warm: "Be warm, patient, and conversational while staying useful.",
    analytical: "Reason carefully, surface assumptions, and favor evidence.",
    creative: "Explore original approaches while remaining accurate and actionable.",
  } as const;
  return [{
    role: "system",
    content: [
      `You are ${identity.name}, the user's Barlas AI agent.`,
      chiefBarlasInstruction(),
      styleInstructions[identity.style],
      identity.instructions?.trim(),
    ].filter(Boolean).join("\n"),
  }];
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: dependencies.logger ?? false });
  const memory = dependencies.memory ?? dependencies.database;
  const seenDiscordMessages = new Set<string>();
  const seenSlackMessages = new Set<string>();
  const seenWhatsAppMessages = new Set<string>();
  const rawWhatsAppBodies = new WeakMap<FastifyRequest, Buffer>();
  const maxWorkspaceFileBytes = dependencies.maxWorkspaceFileBytes ?? DEFAULT_MAX_WORKSPACE_FILE_BYTES;
  await app.register(sensible);
  await app.register(multipart, {
    limits: { fileSize: maxWorkspaceFileBytes + 1, files: 1, fields: 0, parts: 1 },
  });
  app.addHook("preParsing", (request, _reply, payload, done) => {
    if (request.method !== "POST" || !request.url.startsWith("/channels/whatsapp/webhook")) {
      done(null, payload);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const collector = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.byteLength;
        collector.receivedEncodedLength += value.byteLength;
        if (size <= 2_000_000) chunks.push(value);
        callback(null, chunk);
      },
      flush(callback) {
        if (size <= 2_000_000) rawWhatsAppBodies.set(request, Buffer.concat(chunks));
        callback();
      },
    }) as Transform & { receivedEncodedLength: number };
    collector.receivedEncodedLength = 0;
    done(null, payload.pipe(collector));
  });
  if (dependencies.webRoot) {
    const packagedBrandRoot = resolve(dependencies.webRoot, "brand");
    const sourceBrandRoot = resolve(dependencies.webRoot, "..", "assets", "brand");
    const brandRoot = existsSync(packagedBrandRoot) ? packagedBrandRoot : sourceBrandRoot;
    if (existsSync(brandRoot)) {
      await app.register(fastifyStatic, { root: brandRoot, prefix: "/ui/brand/", decorateReply: false });
    }
    await app.register(fastifyStatic, { root: dependencies.webRoot, prefix: "/ui/" });
    app.get("/", async (_request, reply) => reply.redirect("/ui/index.html"));
  }

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    if (request.url.startsWith("/v1/")) {
      reply.header("Cache-Control", "no-store");
    }
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof QuotaExceededError) {
      return reply.code(429).send({
        error: "Quota exceeded",
        category: error.category,
        used: error.used,
        limit: error.limit,
      });
    }
    if (error instanceof AuthenticationError) {
      return reply.code(401).send({ error: error.message });
    }
    if (error instanceof AuthorizationError) {
      return reply.code(403).send({ error: error.message });
    }
    if (error instanceof AgentProfileConflictError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof AccountConflictError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof OrganizationAuthorizationError) {
      return reply.code(403).send({ error: error.message });
    }
    if (error instanceof RuntimePausedError) {
      return reply.code(503).send({ error: error.message, paused: true });
    }
    return reply.send(error);
  });

  const principals = new WeakMap<FastifyRequest, Principal>();

  app.get("/health", async () => ({
    name: "Barlas AI Agent",
    status: "ok",
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await dependencies.database.ping();
      return { name: "Barlas AI Agent", status: "ready" };
    } catch {
      return reply.serviceUnavailable("Database is not ready");
    }
  });

  app.get("/languages", async () => ({
    languages: supportedLanguages.map((language) => ({
      ...language,
      setupTranslationStatus: setupTranslationStatus(language.code),
      setupPhrases: getSetupPhrasePack(language.code),
      setupTranslation: (() => {
        const pack = getSetupPhrasePackDescriptor(language.code);
        return {
          schemaVersion: pack.schemaVersion,
          revision: pack.revision,
          requestedLanguage: language.code,
          effectiveLanguage: pack.language,
          status: setupTranslationStatus(language.code),
          author: pack.author,
          reviewer: pack.reviewer,
          reviewedAt: pack.reviewedAt,
          completeness: setupPhrasePackCompleteness(language.code),
        };
      })(),
    })),
  }));

  app.post("/nodes/pair", async (request, reply) => {
    if (!dependencies.deviceNodes) return reply.notFound();
    const parsed = nodePairSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid node pairing request");
    const paired = await dependencies.deviceNodes.pair(parsed.data);
    if (!paired) return reply.unauthorized("Pairing code is invalid or expired");
    return reply.code(201).send({ node: paired.node, token: paired.token });
  });

  const nodeToken = (request: FastifyRequest): string => {
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  };

  app.post("/nodes/heartbeat", async (request, reply) => {
    if (!dependencies.deviceNodes) return reply.notFound();
    const parsed = nodeHeartbeatSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.badRequest("Invalid node heartbeat");
    const node = await dependencies.deviceNodes.authenticate(nodeToken(request), parsed.data.capabilities);
    if (!node) return reply.unauthorized("Invalid or revoked node token");
    return { node };
  });

  app.get("/nodes/commands", async (request, reply) => {
    if (!dependencies.deviceNodes) return reply.notFound();
    const token = nodeToken(request);
    if (!await dependencies.deviceNodes.authenticate(token)) return reply.unauthorized("Invalid or revoked node token");
    return { commands: await dependencies.deviceNodes.poll(token, 10) };
  });

  app.post("/nodes/commands/:id/result", async (request, reply) => {
    if (!dependencies.deviceNodes) return reply.notFound();
    const params = nodeCommandParamsSchema.safeParse(request.params);
    const body = nodeResultSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid node command result");
    const accepted = await dependencies.deviceNodes.complete(nodeToken(request), params.data.id, body.data.succeeded, body.data.error);
    if (!accepted) return reply.notFound("Node command not found");
    return { accepted: true };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;
    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (tokenMatches(dependencies.apiToken, suppliedToken)) {
      principals.set(request, { userId: "service", role: "owner", authType: "service" });
      return;
    }
    if (dependencies.gatewayToken && dependencies.gatewayOwner && tokenMatches(dependencies.gatewayToken, suppliedToken)) {
      principals.set(request, {
        userId: dependencies.gatewayOwner.id,
        role: "owner",
        authType: "gateway",
        account: dependencies.gatewayOwner,
        token: suppliedToken,
      });
      return;
    }
    const account = dependencies.authService && suppliedToken
      ? await dependencies.authService.authenticate(suppliedToken)
      : null;
    if (!account) return reply.unauthorized("Invalid or expired access token");
    principals.set(request, {
      userId: account.id,
      role: account.role,
      authType: "session",
      account,
      token: suppliedToken,
    });
  });

  const principalFor = (request: FastifyRequest): Principal => {
    const principal = principals.get(request);
    if (!principal) throw new AuthenticationError();
    return principal;
  };

  const authorizeUser = (request: FastifyRequest, requestedUserId: string): string => {
    const principal = principalFor(request);
    if (principal.authType === "service" || principal.role === "owner") return requestedUserId;
    if (principal.userId !== requestedUserId) throw new AuthorizationError();
    return principal.userId;
  };

  const dashboardUser = (request: FastifyRequest, requestedUserId?: string): string | undefined => {
    const principal = principalFor(request);
    if (principal.authType === "service" || principal.role === "owner") return requestedUserId;
    if (requestedUserId && requestedUserId !== principal.userId) throw new AuthorizationError();
    return principal.userId;
  };

  const requireOwner = (request: FastifyRequest): Principal => {
    const principal = principalFor(request);
    if (principal.authType !== "service" && principal.role !== "owner") throw new AuthorizationError();
    return principal;
  };

  const assertRuntimeActive = async (): Promise<void> => {
    if (await dependencies.runtimeControl?.isPaused()) {
      throw new RuntimePausedError("Barlas is paused by its owner");
    }
  };

  app.get("/v1/system/control", async (request) => {
    requireOwner(request);
    return await dependencies.runtimeControl?.state() ?? { paused: false } satisfies RuntimeControlState;
  });

  app.post("/v1/system/pause", async (request, reply) => {
    requireOwner(request);
    if (!dependencies.runtimeControl) return reply.notFound();
    const parsed = z.object({ reason: z.string().trim().max(500).default("Paused by owner") }).strict().safeParse(request.body ?? {});
    if (!parsed.success) return reply.badRequest("Invalid pause request");
    return await dependencies.runtimeControl.pause(parsed.data.reason);
  });

  app.post("/v1/system/resume", async (request, reply) => {
    requireOwner(request);
    if (!dependencies.runtimeControl) return reply.notFound();
    return await dependencies.runtimeControl.resume();
  });

  app.get("/v1/me", async (request) => {
    const principal = principalFor(request);
    return {
      principal: principal.account ?? {
        id: principal.userId,
        email: null,
        displayName: principal.authType === "gateway" ? "Barlas Owner" : "Service API",
        role: principal.role,
        active: true,
        languageCode: null,
        languageConfigured: false,
      },
      authType: principal.authType,
    };
  });

  app.patch("/v1/me/preferences", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.authService) return reply.notFound();
    const parsed = languagePreferenceSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid language preference");
    const account = await dependencies.authService.setLanguage(
      principal.account.id,
      parsed.data.languageCode,
    );
    await dependencies.database.appendAudit({
      userId: account.id,
      eventType: "account.language.changed",
      resourceType: "account",
      resourceId: account.id,
      details: { languageCode: account.languageCode },
    });
    return { account };
  });

  app.post("/v1/media/upload", async (request, reply) => {
    if (!dependencies.media) return reply.notFound();
    const query = mediaUploadQuerySchema.safeParse(request.query);
    if (!query.success) return reply.badRequest("Invalid media upload query");
    const userId = authorizeUser(request, query.data.userId);
    if (!request.isMultipart()) return reply.badRequest("Expected multipart media upload");
    const part = await request.file({ limits: { fileSize: MAX_MEDIA_BYTES + 1, files: 1, fields: 0, parts: 1 } });
    if (!part) return reply.badRequest("Media file is required");
    const content = await part.toBuffer();
    if (part.file.truncated || content.byteLength > MAX_MEDIA_BYTES) {
      return reply.payloadTooLarge("Media file exceeds the 10 MB limit");
    }
    const stored = await dependencies.media.saveUpload(
      userId,
      query.data.path,
      content,
      part.mimetype,
    );
    await dependencies.database.appendAudit({
      userId,
      eventType: "media.uploaded",
      resourceType: "workspace_file",
      resourceId: stored.path,
      details: { path: stored.path, bytes: stored.bytes, kind: stored.kind, mimeType: stored.mimeType },
    });
    return reply.code(201).send({ media: stored });
  });

  app.get("/v1/files", async (request, reply) => {
    if (!dependencies.workspace) return reply.notFound();
    const query = fileQuerySchema.safeParse(request.query);
    if (!query.success) return reply.badRequest("Invalid file list query");
    try {
      return { files: await dependencies.workspace.list(authorizeUser(request, query.data.userId), query.data.path) };
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(fileSystemCode(error) ?? "")) return reply.notFound("Workspace path was not found");
      if (isWorkspaceInputError(error)) return reply.badRequest("Invalid workspace path");
      throw error;
    }
  });

  app.get("/v1/files/download", async (request, reply) => {
    if (!dependencies.workspace) return reply.notFound();
    const query = fileQuerySchema.safeParse(request.query);
    if (!query.success || query.data.path === ".") return reply.badRequest("Invalid file download query");
    const userId = authorizeUser(request, query.data.userId);
    let file: { path: string; bytes: number; stream: Readable } | undefined;
    try {
      if (dependencies.workspace.streamForRead) {
        file = await dependencies.workspace.streamForRead(userId, query.data.path, maxWorkspaceFileBytes);
      } else {
        const buffered = await dependencies.workspace.readBuffer(userId, query.data.path, maxWorkspaceFileBytes);
        file = { path: buffered.path, bytes: buffered.content.byteLength, stream: Readable.from(buffered.content) };
      }
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes(fileSystemCode(error) ?? "")) return reply.notFound("Workspace file was not found");
      if (isWorkspaceInputError(error)) return reply.badRequest("Invalid workspace file");
      throw error;
    }
    const filename = basename(file.path).replace(/[\r\n"\\]/gu, "_");
    await dependencies.database.appendAudit({ userId, eventType: "file.downloaded", resourceType: "workspace_file", resourceId: file.path, details: { path: file.path, bytes: file.bytes } });
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Length", String(file.bytes))
      .header("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(file.stream);
  });

  app.post("/v1/files/upload", async (request, reply) => {
    if (!dependencies.workspace) return reply.notFound();
    const query = fileUploadQuerySchema.safeParse(request.query);
    if (!query.success || query.data.path === ".") return reply.badRequest("Invalid file upload query");
    const userId = authorizeUser(request, query.data.userId);
    if (!request.isMultipart()) return reply.badRequest("Expected multipart file upload");
    const part = await request.file({ limits: { fileSize: maxWorkspaceFileBytes + 1, files: 1, fields: 0, parts: 1 } });
    if (!part) return reply.badRequest("File is required");
    try {
      const stored = dependencies.workspace.writeUploadStream
        ? await dependencies.workspace.writeUploadStream(
          userId,
          query.data.path,
          part.file,
          maxWorkspaceFileBytes,
          query.data.overwrite === "true",
        )
        : await dependencies.workspace.writeUpload(
          userId,
          query.data.path,
          await part.toBuffer(),
          query.data.overwrite === "true",
        );
      if (part.file.truncated) return reply.payloadTooLarge("File exceeds the configured workspace limit");
      await dependencies.database.appendAudit({ userId, eventType: "file.uploaded", resourceType: "workspace_file", resourceId: stored.path, details: { path: stored.path, bytes: stored.bytes, overwritten: query.data.overwrite === "true" } });
      return reply.code(201).send({ file: stored });
    } catch (error) {
      if (fileSystemCode(error) === "EEXIST") return reply.conflict("File already exists; explicit overwrite is required");
      if (error instanceof Error && error.message.startsWith("File exceeds")) {
        return reply.payloadTooLarge("File exceeds the configured workspace limit");
      }
      if (isWorkspaceInputError(error)) return reply.badRequest("Invalid workspace file");
      throw error;
    }
  });

  app.post("/v1/projects", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const parsed = projectBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid project request");
    const userId = authorizeUser(request, parsed.data.userId);
    const project = await dependencies.projects.create(userId, parsed.data.name, parsed.data.description);
    await dependencies.database.appendAudit({ userId, eventType: "project.created", resourceType: "project", resourceId: project.id, details: { name: project.name } });
    return reply.code(201).send({ project });
  });

  app.get("/v1/agents/council", async () => ({
    chief: {
      id: "chief",
      name: "Chief Barlas",
      mandate: "Single accountable voice that serves the owner, commands the Council, reconciles dissent, and owns the final result.",
    },
    members: barlasCouncil,
  }));

  app.post("/v1/agents", async (request, reply) => {
    if (!dependencies.agentProfiles) return reply.notFound();
    const parsed = agentProfileBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid agent profile request");
    const userId = authorizeUser(request, parsed.data.userId);
    try {
      const profile = await dependencies.agentProfiles.create({
        userId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        style: parsed.data.style,
        instructions: parsed.data.instructions,
        defaultTaskClass: parsed.data.defaultTaskClass,
        ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {}),
      });
      await dependencies.database.appendAudit({
        userId, eventType: "agent_profile.created", resourceType: "agent_profile", resourceId: profile.id,
        details: { slug: profile.slug, style: profile.style, defaultTaskClass: profile.defaultTaskClass, projectId: profile.projectId },
      });
      return reply.code(201).send({ profile });
    } catch (error) {
      if (error instanceof Error && error.message === "Agent workspace project not found") return reply.notFound(error.message);
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.conflict("Agent slug already exists");
      }
      throw error;
    }
  });

  app.get("/v1/agents", async (request, reply) => {
    if (!dependencies.agentProfiles) return reply.notFound();
    const parsed = projectQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid agent profiles query");
    return { profiles: await dependencies.agentProfiles.list(authorizeUser(request, parsed.data.userId)) };
  });

  app.delete("/v1/agents/:id", async (request, reply) => {
    if (!dependencies.agentProfiles) return reply.notFound();
    const params = agentProfileParamsSchema.safeParse(request.params);
    const query = projectQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.badRequest("Invalid agent profile request");
    const userId = authorizeUser(request, query.data.userId);
    if (!(await dependencies.agentProfiles.get(userId, params.data.id))) return reply.notFound("Agent profile not found");
    if (!(await dependencies.agentProfiles.delete(userId, params.data.id))) return reply.conflict("Agent profile has bound conversations and cannot be deleted");
    await dependencies.database.appendAudit({ userId, eventType: "agent_profile.deleted", resourceType: "agent_profile", resourceId: params.data.id });
    return reply.code(204).send();
  });

  app.get("/v1/projects", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const parsed = projectQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid projects query");
    return { projects: await dependencies.projects.list(authorizeUser(request, parsed.data.userId)) };
  });

  app.get("/v1/projects/:id", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectParamsSchema.safeParse(request.params); const query = projectQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.badRequest("Invalid project query");
    const detail = await dependencies.projects.detail(authorizeUser(request, query.data.userId), params.data.id);
    return detail ? detail : reply.notFound("Project not found");
  });

  app.post("/v1/projects/:id/resources", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectParamsSchema.safeParse(request.params); const parsed = projectResourceSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid project resource request");
    const userId = authorizeUser(request, parsed.data.userId);
    try {
      const resource = await dependencies.projects.attach(userId, params.data.id, parsed.data.type as ProjectResourceType, parsed.data.resourceId, parsed.data.label);
      if (!resource) return reply.notFound("Project not found");
      await dependencies.database.appendAudit({ userId, eventType: "project.resource.attached", resourceType: "project", resourceId: params.data.id, details: { type: resource.type, resourceId: resource.id } });
      return reply.code(201).send({ resource });
    } catch (error) {
      if (error instanceof Error && error.message === "Resource not found") return reply.notFound("Resource not found");
      if (isWorkspaceInputError(error) || ["ENOENT", "ENOTDIR"].includes(fileSystemCode(error) ?? "")) return reply.notFound("Resource not found");
      throw error;
    }
  });

  app.post("/v1/projects/:id/artifacts", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectParamsSchema.safeParse(request.params); const parsed = artifactSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid artifact request");
    const userId = authorizeUser(request, parsed.data.userId);
    let artifact;
    try {
      artifact = await dependencies.projects.snapshot(userId, params.data.id, parsed.data.path);
    } catch (error) {
      if (error instanceof Error && error.message === "Project not found") return reply.notFound("Project not found");
      if (error instanceof Error && error.message === "Artifact file is empty") return reply.badRequest(error.message);
      if (isWorkspaceInputError(error) || ["ENOENT", "ENOTDIR"].includes(fileSystemCode(error) ?? "")) return reply.notFound("Workspace file not found");
      throw error;
    }
    await dependencies.database.appendAudit({ userId, eventType: "project.artifact.snapshotted", resourceType: "project", resourceId: params.data.id, details: { path: artifact.path, version: artifact.version, sha256: artifact.sha256, bytes: artifact.bytes } });
    return reply.code(201).send({ artifact });
  });

  app.post("/v1/projects/:id/artifacts/:versionId/restore", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = artifactParamsSchema.safeParse(request.params); const parsed = projectQuerySchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid artifact restore request");
    const userId = authorizeUser(request, parsed.data.userId);
    const artifact = await dependencies.projects.restore(userId, params.data.id, params.data.versionId);
    if (!artifact) return reply.notFound("Artifact version not found");
    await dependencies.database.appendAudit({ userId, eventType: "project.artifact.restored", resourceType: "project", resourceId: params.data.id, details: { path: artifact.path, version: artifact.version, sha256: artifact.sha256, bytes: artifact.bytes } });
    return { artifact };
  });

  app.post("/v1/projects/:id/goals", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectParamsSchema.safeParse(request.params); const parsed = projectGoalSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid project goal request");
    const userId = authorizeUser(request, parsed.data.userId);
    const goal = await dependencies.projects.createGoal(userId, params.data.id, parsed.data.title, parsed.data.description, parsed.data.priority);
    if (!goal) return reply.notFound("Project not found");
    await dependencies.database.appendAudit({ userId, eventType: "project.goal.created", resourceType: "project", resourceId: params.data.id, details: { goalId: goal.id, priority: goal.priority } });
    return reply.code(201).send({ goal });
  });

  app.patch("/v1/projects/:id/goals/:goalId", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectGoalParamsSchema.safeParse(request.params); const parsed = projectGoalStatusSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid project goal update");
    const userId = authorizeUser(request, parsed.data.userId);
    const goal = await dependencies.projects.updateGoal(userId, params.data.id, params.data.goalId, parsed.data.status as GoalStatus);
    if (!goal) return reply.notFound("Project goal not found");
    await dependencies.database.appendAudit({ userId, eventType: "project.goal.updated", resourceType: "project", resourceId: params.data.id, details: { goalId: goal.id, status: goal.status } });
    return { goal };
  });

  app.post("/v1/projects/:id/steps", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectParamsSchema.safeParse(request.params); const parsed = projectStepSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid project plan step");
    const userId = authorizeUser(request, parsed.data.userId);
    const step = await dependencies.projects.createStep(userId, params.data.id, parsed.data.title, parsed.data.goalId);
    if (!step) return reply.notFound("Project or goal not found");
    await dependencies.database.appendAudit({ userId, eventType: "project.step.created", resourceType: "project", resourceId: params.data.id, details: { stepId: step.id, position: step.position } });
    return reply.code(201).send({ step });
  });

  app.patch("/v1/projects/:id/steps/:stepId", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectStepParamsSchema.safeParse(request.params); const parsed = projectStepStatusSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid project step update");
    const userId = authorizeUser(request, parsed.data.userId);
    const step = await dependencies.projects.updateStep(userId, params.data.id, params.data.stepId, parsed.data.status as PlanStepStatus);
    if (!step) return reply.notFound("Project step not found");
    await dependencies.database.appendAudit({ userId, eventType: "project.step.updated", resourceType: "project", resourceId: params.data.id, details: { stepId: step.id, status: step.status } });
    return { step };
  });

  app.post("/v1/projects/:id/checkpoints", async (request, reply) => {
    if (!dependencies.projects) return reply.notFound();
    const params = projectParamsSchema.safeParse(request.params); const parsed = projectCheckpointSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid project checkpoint");
    const userId = authorizeUser(request, parsed.data.userId);
    const checkpoint = await dependencies.projects.checkpoint(userId, params.data.id, parsed.data.title, parsed.data.summary, parsed.data.progress, parsed.data.goalId);
    if (!checkpoint) return reply.notFound("Project or goal not found");
    await dependencies.database.appendAudit({ userId, eventType: "project.checkpoint.created", resourceType: "project", resourceId: params.data.id, details: { checkpointId: checkpoint.id, progress: checkpoint.progress } });
    return reply.code(201).send({ checkpoint });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const principal = principalFor(request);
    if (principal.authType === "session" && principal.token && dependencies.authService) {
      await dependencies.authService.logout(principal.token);
    }
    return { ok: true };
  });

  app.get("/v1/me/telegram", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.telegramLinks) return reply.notFound();
    return { link: await dependencies.telegramLinks.get(principal.account.id) };
  });

  app.post("/v1/me/telegram/code", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.telegramLinks) return reply.notFound();
    return dependencies.telegramLinks.createCode(principal.account.id);
  });

  app.delete("/v1/me/telegram", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.telegramLinks) return reply.notFound();
    return { unlinked: await dependencies.telegramLinks.unlink(principal.account.id) };
  });

  app.get("/v1/admin/users", async (request, reply) => {
    const principal = principalFor(request);
    if (principal.role !== "owner" || !dependencies.authService) return reply.forbidden();
    return { users: await dependencies.authService.listAccounts() };
  });

  app.post("/v1/admin/users", async (request, reply) => {
    const principal = principalFor(request);
    if (principal.role !== "owner" || !dependencies.authService?.issueAccessToken) return reply.forbidden();
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid user request");
    const user = await dependencies.authService.createAccount({
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      ...(parsed.data.languageCode ? { languageCode: parsed.data.languageCode } : {}),
    });
    await dependencies.database.appendAudit({
      userId: principal.userId,
      eventType: "account.created",
      resourceType: "account",
      resourceId: user.id,
      details: { email: user.email, role: user.role },
    });
    const access = await dependencies.authService.issueAccessToken(user.id);
    return reply.code(201).send({ user, access });
  });

  app.post("/v1/admin/users/:id/access-token", async (request, reply) => {
    const principal = principalFor(request);
    if (principal.role !== "owner" || !dependencies.authService?.issueAccessToken) return reply.forbidden();
    const params = accountParamsSchema.safeParse(request.params);
    if (!params.success) return reply.badRequest("Invalid account request");
    const access = await dependencies.authService.issueAccessToken(params.data.id, true);
    await dependencies.database.appendAudit({
      userId: principal.userId,
      eventType: "account.access_token.rotated",
      resourceType: "account",
      resourceId: params.data.id,
      details: { expiresAt: access.expiresAt },
    });
    return access;
  });

  app.get("/v1/organizations", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.organizations) return reply.notFound();
    return { organizations: await dependencies.organizations.list(principal.account.id) };
  });

  app.post("/v1/organizations", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.organizations) return reply.notFound();
    const parsed = organizationCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid organization request");
    const organization = await dependencies.organizations.create({
      ...parsed.data,
      ownerId: principal.account.id,
    });
    await dependencies.database.appendAudit({
      userId: principal.account.id,
      eventType: "organization.created",
      resourceType: "organization",
      resourceId: organization.id,
      details: { slug: organization.slug, plan: organization.plan },
    });
    return reply.code(201).send({ organization });
  });

  app.get("/v1/organizations/:id/members", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.organizations) return reply.notFound();
    const params = organizationParamsSchema.safeParse(request.params);
    if (!params.success) return reply.badRequest("Invalid organization request");
    return { members: await dependencies.organizations.members(params.data.id, principal.account.id) };
  });

  app.post("/v1/organizations/:id/members", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.organizations) return reply.notFound();
    const params = organizationParamsSchema.safeParse(request.params);
    const body = organizationMemberSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid organization member request");
    const member = await dependencies.organizations.addMember({
      organizationId: params.data.id,
      actorId: principal.account.id,
      ...body.data,
    });
    await dependencies.database.appendAudit({
      userId: principal.account.id,
      eventType: "organization.member.updated",
      resourceType: "organization",
      resourceId: params.data.id,
      details: { accountId: member.accountId, role: member.role },
    });
    return reply.code(201).send({ member });
  });

  app.patch("/v1/organizations/:id/plan", async (request, reply) => {
    const principal = principalFor(request);
    if (!principal.account || !dependencies.organizations) return reply.notFound();
    const params = organizationParamsSchema.safeParse(request.params);
    const body = organizationPlanSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid organization plan request");
    await dependencies.organizations.changePlan({
      organizationId: params.data.id,
      actorId: principal.account.id,
      plan: body.data.plan,
    });
    await dependencies.database.appendAudit({
      userId: principal.account.id,
      eventType: "organization.plan.changed",
      resourceType: "organization",
      resourceId: params.data.id,
      details: { plan: body.data.plan },
    });
    return { updated: true };
  });

  app.get("/v1/connectors", async (request, reply) => {
    if (!dependencies.connectors) return reply.notFound();
    const parsed = connectorListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid connectors query");
    const userId = authorizeUser(request, parsed.data.userId);
    return { connectors: await dependencies.connectors.list(userId) };
  });

  app.post("/v1/connectors", async (request, reply) => {
    if (!dependencies.connectors) return reply.notFound();
    const parsed = connectorCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid connector request");
    const userId = authorizeUser(request, parsed.data.userId);
    const connector = await dependencies.connectors.save({
      userId,
      provider: parsed.data.provider,
      label: parsed.data.label,
      secret: parsed.data.secret,
      ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
    });
    await dependencies.database.appendAudit({
      userId,
      eventType: "connector.saved",
      resourceType: "connector",
      resourceId: connector.id,
      details: { provider: connector.provider, label: connector.label },
    });
    return reply.code(201).send({ connector });
  });

  app.delete("/v1/connectors/:id", async (request, reply) => {
    if (!dependencies.connectors) return reply.notFound();
    const params = connectorParamsSchema.safeParse(request.params);
    const body = connectorListSchema.strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid connector deletion request");
    const userId = authorizeUser(request, body.data.userId);
    const deleted = await dependencies.connectors.delete(userId, params.data.id);
    if (!deleted) return reply.notFound("Connector not found");
    await dependencies.database.appendAudit({
      userId,
      eventType: "connector.deleted",
      resourceType: "connector",
      resourceId: params.data.id,
    });
    return { deleted: true };
  });

  app.get("/v1/integrations/github/profile", async (request, reply) => {
    if (!dependencies.githubConnector) return reply.notFound();
    const parsed = githubRepositoriesSchema.omit({ limit: true }).safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid GitHub profile request");
    const userId = authorizeUser(request, parsed.data.userId);
    return { profile: await dependencies.githubConnector.profile(userId, parsed.data.connectorId) };
  });

  app.get("/v1/integrations/github/repositories", async (request, reply) => {
    if (!dependencies.githubConnector) return reply.notFound();
    const parsed = githubRepositoriesSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid GitHub repositories request");
    const userId = authorizeUser(request, parsed.data.userId);
    return {
      repositories: await dependencies.githubConnector.repositories(
        userId,
        parsed.data.connectorId,
        parsed.data.limit,
      ),
    };
  });

  app.get("/v1/integrations/google-drive/files", async (request, reply) => {
    if (!dependencies.googleConnector) return reply.notFound();
    const parsed = googleListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid Google Drive request");
    const userId = authorizeUser(request, parsed.data.userId);
    return { files: await dependencies.googleConnector.driveFiles(userId, parsed.data.connectorId, parsed.data.limit) };
  });

  app.get("/v1/integrations/gmail/messages", async (request, reply) => {
    if (!dependencies.googleConnector) return reply.notFound();
    const parsed = googleListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid Gmail request");
    const userId = authorizeUser(request, parsed.data.userId);
    return { messages: await dependencies.googleConnector.gmailMessages(userId, parsed.data.connectorId, parsed.data.limit) };
  });

  app.get("/v1/integrations/google-calendar/events", async (request, reply) => {
    if (!dependencies.googleConnector) return reply.notFound();
    const parsed = googleListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid Google Calendar request");
    const userId = authorizeUser(request, parsed.data.userId);
    return { events: await dependencies.googleConnector.calendarEvents(userId, parsed.data.connectorId, parsed.data.limit) };
  });

  app.get("/v1/integrations/mcp/tools", async (request, reply) => {
    if (!dependencies.mcpConnector) return reply.notFound();
    const parsed = githubRepositoriesSchema.omit({ limit: true }).safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid MCP tools request");
    const userId = authorizeUser(request, parsed.data.userId);
    return { tools: await dependencies.mcpConnector.listTools(userId, parsed.data.connectorId) };
  });

  const runChat = async (input: z.infer<typeof chatBodySchema>) => {
    await assertRuntimeActive();
    await dependencies.governance?.consume(input.userId, "chat");
    const conversationId = input.conversationId ?? randomUUID();
    const selectedProfile = dependencies.agentProfiles
      ? await dependencies.agentProfiles.resolve(input.userId, conversationId, input.agentId)
      : null;
    const effectiveTaskClass = input.taskClass ?? selectedProfile?.defaultTaskClass ?? "fast";
    const traceId = dependencies.governance?.newTraceId();
    if (traceId) {
      await dependencies.governance?.trace({
        traceId,
        userId: input.userId,
        operation: "chat.generate",
        status: "started",
        details: { taskClass: effectiveTaskClass, agentProfileId: selectedProfile?.id },
      });
    }
    const existingConversation = input.conversationId
      ? await dependencies.database.getConversation(input.userId, input.conversationId)
      : null;
    const conversation = mergeConversationMessages(
      existingConversation?.messages.map(({ role, content }) => ({ role, content })) ?? [],
      input.messages,
    );
    const latestUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
    const memories = latestUserMessage
      ? await memory.recall(input.userId, latestUserMessage.content, 5)
      : [];
    const memoryContext = memories.length > 0
      ? [{
          role: "system" as const,
          content: [
            "You are Barlas AI Agent. Use these user memories only when relevant:",
            ...memories.map((memory) => `- [${memory.category}] ${memory.content}`),
          ].join("\n"),
        }]
      : [];
    const identityContext = selectedProfile
      ? [{ role: "system" as const, content: agentProfileInstruction(selectedProfile) }]
      : agentIdentityContext(dependencies.agentIdentity);
    const [languageContext, commitmentsContext, outcomesContext] = await Promise.all([
      preferredLanguageContext(input.userId, dependencies.authService),
      continuityContext(input.userId, dependencies.continuity),
      outcomeContext(input.userId, dependencies.outcomes),
    ]);
    let projectContext: Array<{ role: "system"; content: string }> = [];
    if (selectedProfile?.projectId) {
      if (!dependencies.projects) throw new AgentProfileConflictError("Agent workspace is unavailable");
      const context = await dependencies.projects.context(input.userId, selectedProfile.projectId);
      if (!context) throw new AgentProfileConflictError("Agent workspace project not found");
      projectContext = [{ role: "system", content: context }];
    }
    try {
      const result = await dependencies.modelProvider.generate({
        userId: input.userId,
        conversationId,
        messages: [...identityContext, ...languageContext, ...commitmentsContext, ...outcomesContext, ...projectContext, ...memoryContext, ...conversation.modelMessages],
        taskClass: effectiveTaskClass,
      });

      await dependencies.database.saveTurn({
        userId: input.userId,
        conversationId,
        messages: conversation.newMessages,
        result,
      });
      if (traceId) {
        await dependencies.governance?.trace({
          traceId,
          userId: input.userId,
          operation: "chat.generate",
          status: "completed",
          details: { provider: result.provider, model: result.model, memoriesUsed: memories.length },
        });
      }
      return { conversationId, result, memoriesUsed: memories.length, traceId, selectedProfile };
    } catch (error) {
      if (traceId) {
        await dependencies.governance?.trace({
          traceId,
          userId: input.userId,
          operation: "chat.generate",
          status: "failed",
          details: { error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
        });
      }
      throw error;
    }
  };

  app.post("/v1/chat", async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest("Invalid chat request");
    }

    const userId = authorizeUser(request, parsed.data.userId);
    const { conversationId, result, memoriesUsed, traceId, selectedProfile } = await runChat({ ...parsed.data, userId });

    return {
      conversationId,
      message: {
        role: "assistant",
        content: result.text,
      },
      model: {
        provider: result.provider,
        name: result.model,
      },
      memoriesUsed,
      agent: selectedProfile ? { id: selectedProfile.id, slug: selectedProfile.slug, name: selectedProfile.name } : null,
      traceId,
    };
  });

  app.get("/v1/voice/status", async () => ({
    available: Boolean(dependencies.media?.transcribeUpload && dependencies.media.createSpeechBuffer),
    mode: "push-to-talk",
    microphoneConsent: "explicit",
    recordingRetention: "none",
    defaultVoice: dependencies.defaultSpeechVoice ?? "alloy",
  }));

  app.post("/v1/voice/turn", async (request, reply) => {
    if (!dependencies.media?.transcribeUpload || !dependencies.media.createSpeechBuffer) return reply.notFound();
    const query = voiceTurnQuerySchema.safeParse(request.query);
    if (!query.success) return reply.badRequest("Voice requires explicit microphone consent and valid settings");
    const userId = authorizeUser(request, query.data.userId);
    if (!request.isMultipart()) return reply.badRequest("Expected multipart audio recording");
    const part = await request.file({ limits: { fileSize: MAX_MEDIA_BYTES + 1, files: 1, fields: 0, parts: 1 } });
    if (!part) return reply.badRequest("Audio recording is required");
    const content = await part.toBuffer();
    if (part.file.truncated || content.byteLength > MAX_MEDIA_BYTES) {
      return reply.payloadTooLarge("Audio recording exceeds the 10 MB limit");
    }
    const transcript = await dependencies.media.transcribeUpload(
      content,
      part.filename,
      part.mimetype,
      query.data.language,
    );
    const text = transcript.text.trim();
    if (!text) return reply.badRequest("No speech was detected");
    const chat = await runChat({
      userId,
      ...(query.data.conversationId ? { conversationId: query.data.conversationId } : {}),
      ...(query.data.agentId ? { agentId: query.data.agentId } : {}),
      messages: [{ role: "user", content: text }],
      taskClass: query.data.taskClass,
    });
    const spokenText = chat.result.text.slice(0, 4_096);
    const speech = await dependencies.media.createSpeechBuffer(
      spokenText,
      query.data.voice ?? dependencies.defaultSpeechVoice ?? "alloy",
    );
    await dependencies.database.appendAudit({
      userId,
      eventType: "voice.turn.completed",
      resourceType: "conversation",
      resourceId: chat.conversationId,
      details: {
        inputBytes: content.byteLength,
        inputMimeType: transcript.mimeType,
        outputBytes: speech.content.byteLength,
        voice: speech.voice,
        truncated: spokenText.length < chat.result.text.length,
      },
    });
    return {
      conversationId: chat.conversationId,
      transcript: text,
      message: { role: "assistant", content: chat.result.text },
      audio: {
        mimeType: speech.mimeType,
        base64: speech.content.toString("base64"),
        voice: speech.voice,
        truncated: spokenText.length < chat.result.text.length,
      },
    };
  });

  app.post("/v1/agent/run", async (request, reply) => {
    await assertRuntimeActive();
    if (!dependencies.agentRuntime && !dependencies.agentLoop) return reply.notFound();
    const parsed = agentRunBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid agent run request");
    const userId = authorizeUser(request, parsed.data.userId);
    await dependencies.governance?.consume(userId, "chat");
    const conversationId = parsed.data.conversationId ?? randomUUID();
    const selectedProfile = dependencies.agentProfiles
      ? await dependencies.agentProfiles.resolve(userId, conversationId, parsed.data.agentId)
      : null;
    const effectiveTaskClass = parsed.data.taskClass ?? selectedProfile?.defaultTaskClass ?? "fast";
    const existingConversation = parsed.data.conversationId
      ? await dependencies.database.getConversation(userId, parsed.data.conversationId)
      : null;
    const conversation = mergeConversationMessages(
      existingConversation?.messages.map(({ role, content }) => ({ role, content })) ?? [],
      parsed.data.messages,
    );
    const latestUserMessage = [...parsed.data.messages].reverse().find((message) => message.role === "user");
    const memories = latestUserMessage
      ? await memory.recall(userId, latestUserMessage.content, 5)
      : [];
    const memoryContext = memories.length > 0
      ? [{
          role: "system" as const,
          content: [
            "Use these Barlas AI Agent user memories only when relevant:",
            ...memories.map((memory) => `- [${memory.category}] ${memory.content}`),
          ].join("\n"),
        }]
      : [];
    const identityContext = selectedProfile
      ? [{ role: "system" as const, content: agentProfileInstruction(selectedProfile) }]
      : agentIdentityContext(dependencies.agentIdentity);
    const [languageContext, commitmentsContext, outcomesContext] = await Promise.all([
      preferredLanguageContext(userId, dependencies.authService),
      continuityContext(userId, dependencies.continuity),
      outcomeContext(userId, dependencies.outcomes),
    ]);
    let projectContext: Array<{ role: "system"; content: string }> = [];
    if (selectedProfile?.projectId && parsed.data.projectId && selectedProfile.projectId !== parsed.data.projectId) {
      return reply.conflict("Agent profile is bound to a different workspace project");
    }
    const effectiveProjectId = selectedProfile?.projectId ?? parsed.data.projectId;
    if (effectiveProjectId) {
      if (!dependencies.projects) return reply.badRequest("Projects are not available");
      const context = await dependencies.projects.context(userId, effectiveProjectId);
      if (!context) return reply.notFound("Project not found");
      projectContext = [{ role: "system", content: context }];
    }
    let skillContext: Array<{ role: "system"; content: string }> = [];
    let allowedTools = parsed.data.allowedTools;
    let selectedSkill: { id: string; version: string } | undefined;
    if (parsed.data.skillId) {
      if (!dependencies.skillRegistry) return reply.badRequest("Skills are not available");
      let skill;
      try {
        skill = dependencies.skillRegistry.get(parsed.data.skillId, parsed.data.skillVersion);
      } catch {
        return reply.badRequest("Unknown skill or version");
      }
      if (!dependencies.skillRegistry.isActive(skill.id, skill.version)) {
        return reply.badRequest("Only an active evaluated skill can be used");
      }
      const skillTools = new Set(skill.allowedTools);
      if (allowedTools?.some((tool) => !skillTools.has(tool))) {
        return reply.badRequest("Requested tools exceed the selected skill permissions");
      }
      allowedTools = allowedTools ?? skill.allowedTools;
      selectedSkill = { id: skill.id, version: skill.version };
      skillContext = [{
        role: "system",
        content: [
          `Apply Barlas AI Agent skill ${skill.id}@${skill.version}.`,
          skill.instructions,
          `This skill permits only these tools: ${skill.allowedTools.join(", ") || "none"}.`,
        ].join(" "),
      }];
    }
    const traceId = dependencies.governance?.newTraceId();
    if (traceId) {
      await dependencies.governance?.trace({
        traceId,
        userId,
        operation: "agent.loop",
        status: "started",
        details: { taskClass: effectiveTaskClass, maxSteps: parsed.data.maxSteps, selectedSkill, agentProfileId: selectedProfile?.id },
      });
    }
    try {
      const loopInput = {
        userId,
        conversationId,
        messages: [...identityContext, ...languageContext, ...commitmentsContext, ...outcomesContext, ...projectContext, ...skillContext, ...memoryContext, ...conversation.modelMessages],
        taskClass: effectiveTaskClass,
        maxSteps: parsed.data.maxSteps,
        ...(parsed.data.maxTotalTokens ? { maxTotalTokens: parsed.data.maxTotalTokens } : {}),
        ...(allowedTools ? { allowedTools } : {}),
      };
      if (dependencies.agentRuntime) {
        const run = await dependencies.agentRuntime.enqueue({
          ...loopInput,
          conversationMessages: conversation.newMessages,
        });
        if (effectiveProjectId && dependencies.projects) {
          await dependencies.projects.attach(userId, effectiveProjectId, "agent_run", run.id, latestUserMessage?.content.slice(0, 200) ?? "Agent run");
        }
        if (traceId) {
          await dependencies.governance?.trace({
            traceId,
            userId,
            operation: "agent.loop",
            status: "pending",
            details: { runId: run.id, agentStatus: run.status },
          });
        }
        return reply.code(202).send({
          runId: run.id,
          conversationId,
          status: run.status,
          message: { role: "assistant", content: "Задача принята и выполняется в фоне." },
          memoriesUsed: memories.length,
          agent: selectedProfile ? { id: selectedProfile.id, slug: selectedProfile.slug, name: selectedProfile.name } : null,
          traceId,
        });
      }
      const result = await dependencies.agentLoop!.run(loopInput);
      await dependencies.database.saveTurn({
        userId,
        conversationId,
        messages: conversation.newMessages,
        result: result.result,
      });
      if (effectiveProjectId && dependencies.projects) {
        await dependencies.projects.attach(userId, effectiveProjectId, "conversation", conversationId, latestUserMessage?.content.slice(0, 200) ?? "Conversation");
      }
      if (traceId) {
        await dependencies.governance?.trace({
          traceId,
          userId,
          operation: "agent.loop",
          status: result.status === "completed" ? "completed" : "pending",
          details: {
            agentStatus: result.status,
            steps: result.steps,
            toolExecutions: result.toolExecutions,
            approvalIds: result.approvalIds,
          },
        });
      }
      return {
        conversationId,
        status: result.status,
        message: { role: "assistant", content: result.text },
        steps: result.steps,
        toolExecutions: result.toolExecutions,
        approvalIds: result.approvalIds,
        model: { provider: result.result.provider, name: result.result.model },
        usage: result.result.usage,
        memoriesUsed: memories.length,
        traceId,
      };
    } catch (error) {
      if (traceId) {
        await dependencies.governance?.trace({
          traceId,
          userId,
          operation: "agent.loop",
          status: "failed",
          details: { error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
        });
      }
      throw error;
    }
  });

  app.get("/v1/agent-runs", async (request, reply) => {
    if (!dependencies.agentRuntime) return reply.notFound();
    const parsed = userListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid agent runs query");
    return { runs: await dependencies.agentRuntime.list(authorizeUser(request, parsed.data.userId), parsed.data.limit) };
  });

  app.get("/v1/agent-runs/:id", async (request, reply) => {
    if (!dependencies.agentRuntime) return reply.notFound();
    const params = agentRunParamsSchema.safeParse(request.params);
    const query = z.object({ userId: z.string().min(1).max(128) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.badRequest("Invalid agent run request");
    const userId = authorizeUser(request, query.data.userId);
    const run = await dependencies.agentRuntime.get(userId, params.data.id);
    if (!run) return reply.notFound("Agent run not found");
    return { run };
  });

  app.get("/v1/agent-runs/:id/events", async (request, reply) => {
    if (!dependencies.agentRuntime) return reply.notFound();
    const params = agentRunParamsSchema.safeParse(request.params);
    const query = z.object({ userId: z.string().min(1).max(128) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.badRequest("Invalid agent run events request");
    const userId = authorizeUser(request, query.data.userId);
    const run = await dependencies.agentRuntime.get(userId, params.data.id);
    if (!run) return reply.notFound("Agent run not found");
    return { events: await dependencies.agentRuntime.events(userId, run.id) };
  });

  app.post("/v1/agent-runs/:id/cancel", async (request, reply) => {
    if (!dependencies.agentRuntime) return reply.notFound();
    const params = agentRunParamsSchema.safeParse(request.params);
    const body = z.object({ userId: z.string().min(1).max(128) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid agent run cancellation");
    const userId = authorizeUser(request, body.data.userId);
    const run = await dependencies.agentRuntime.cancel(userId, params.data.id);
    if (!run) return reply.conflict("Only running or waiting agent runs can be cancelled");
    await dependencies.database.appendAudit({
      userId,
      eventType: "agent_run.cancelled",
      resourceType: "agent_run",
      resourceId: run.id,
    });
    return { run };
  });

  app.post("/v1/agent-runs/:id/resume", async (request, reply) => {
    if (!dependencies.agentRuntime) return reply.notFound();
    const params = agentRunParamsSchema.safeParse(request.params);
    const body = z.object({ userId: z.string().min(1).max(128) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid agent run resume request");
    const userId = authorizeUser(request, body.data.userId);
    const existing = await dependencies.agentRuntime.get(userId, params.data.id);
    if (!existing) return reply.notFound("Agent run not found");
    if (existing.status !== "waiting_approval") return reply.conflict("Only a waiting agent run can be resumed");
    const run = await dependencies.agentRuntime.resume(userId, params.data.id);
    if (!run) return reply.conflict("Agent run could not be resumed");
    if (run.result && run.status !== "waiting_approval") {
      await dependencies.database.saveTurn({
        userId,
        conversationId: run.conversationId,
        messages: [],
        result: run.result.result,
      });
      await dependencies.projects?.recordRunResult(run);
    }
    return { run };
  });

  app.post("/v1/memory", async (request, reply) => {
    const parsed = rememberBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid memory request");
    const savedMemory = await memory.remember({
      ...parsed.data,
      userId: authorizeUser(request, parsed.data.userId),
    });
    return reply.code(201).send({ memory: savedMemory });
  });

  app.get("/v1/memory/search", async (request, reply) => {
    const parsed = recallQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid memory search query");
    const memories = await memory.recall(
      authorizeUser(request, parsed.data.userId),
      parsed.data.query,
      parsed.data.limit,
    );
    return { memories };
  });

  app.get("/v1/conversations", async (request, reply) => {
    const parsed = userListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid conversations query");
    return {
      conversations: await dependencies.database.listConversations(
        authorizeUser(request, parsed.data.userId),
        parsed.data.limit,
      ),
    };
  });

  app.get("/v1/conversations/:id", async (request, reply) => {
    const params = conversationParamsSchema.safeParse(request.params);
    const query = z.object({ userId: z.string().min(1).max(128) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.badRequest("Invalid conversation request");
    const conversation = await dependencies.database.getConversation(
      authorizeUser(request, query.data.userId),
      params.data.id,
    );
    if (!conversation) return reply.notFound("Conversation not found");
    return { conversation };
  });

  app.get("/v1/tools", async (_request, reply) => {
    if (!dependencies.toolExecutor) return reply.notFound();
    return { tools: dependencies.toolExecutor.listTools() };
  });

  app.get("/v1/extensions", async (_request, reply) => {
    if (!dependencies.extensionCatalog) return reply.notFound();
    return { extensions: dependencies.extensionCatalog.list() };
  });

  app.post("/v1/nodes/pairing-code", async (request, reply) => {
    if (!dependencies.deviceNodes) return reply.notFound();
    const parsed = nodeUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid node pairing request");
    return dependencies.deviceNodes.createPairingCode(authorizeUser(request, parsed.data.userId));
  });

  app.get("/v1/nodes", async (request, reply) => {
    if (!dependencies.deviceNodes) return reply.notFound();
    const parsed = nodeUserSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid node query");
    return { nodes: await dependencies.deviceNodes.list(authorizeUser(request, parsed.data.userId)) };
  });

  app.delete("/v1/nodes/:id", async (request, reply) => {
    if (!dependencies.deviceNodes) return reply.notFound();
    const params = nodeParamsSchema.safeParse(request.params);
    const parsed = nodeUserSchema.safeParse(request.query);
    if (!params.success || !parsed.success) return reply.badRequest("Invalid node revoke request");
    const revoked = await dependencies.deviceNodes.revoke(authorizeUser(request, parsed.data.userId), params.data.id);
    if (!revoked) return reply.notFound("Node not found");
    return { revoked: true };
  });

  app.get("/v1/skills", async (_request, reply) => {
    if (!dependencies.skillRegistry) return reply.notFound();
    return { skills: dependencies.skillRegistry.list() };
  });

  app.post("/v1/skills", async (request, reply) => {
    if (!dependencies.skillManager) return reply.notFound();
    const principal = requireOwner(request);
    const parsed = skillInstallSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid skill definition");
    const { provenance, ...definition } = parsed.data;
    const skill = await dependencies.skillManager.install(definition, principal.account?.id ?? null);
    await dependencies.database.appendAudit({
      userId: principal.userId,
      eventType: "skill.installed",
      resourceType: "skill",
      resourceId: `${skill.id}@${skill.version}`,
      details: { allowedTools: skill.allowedTools, ...(provenance ? { provenance } : {}) },
    });
    return reply.code(201).send({ skill });
  });

  app.post("/v1/skills/packages", async (request, reply) => {
    if (!dependencies.skillManager) return reply.notFound();
    const principal = requireOwner(request);
    const body = signedSkillInstallSchema.safeParse(request.body);
    if (!body.success) return reply.badRequest("Invalid signed skill package request");
    let skillPackage;
    let fingerprint: string;
    try {
      skillPackage = parseSignedSkillPackageValue(body.data.package);
      fingerprint = verifySkillPackage(skillPackage, body.data.trustedFingerprint);
    } catch (error) {
      return reply.badRequest(error instanceof Error ? error.message : "Invalid signed skill package");
    }
    const skill = await dependencies.skillManager.install(skillPackage.skill, principal.account?.id ?? null);
    await dependencies.database.appendAudit({
      userId: principal.userId,
      eventType: "skill.package.installed",
      resourceType: "skill",
      resourceId: `${skill.id}@${skill.version}`,
      details: {
        allowedTools: skill.allowedTools,
        publisher: skillPackage.publisher.name,
        publisherFingerprint: fingerprint,
        signed: true,
      },
    });
    return reply.code(201).send({
      skill,
      publisher: { name: skillPackage.publisher.name, fingerprint },
      evaluation: skillPackage.evaluation ?? null,
    });
  });

  app.post("/v1/skills/:id/:version/evaluate", async (request, reply) => {
    if (!dependencies.skillManager) return reply.notFound();
    const principal = requireOwner(request);
    const params = skillParamsSchema.safeParse(request.params);
    const body = skillEvaluationSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid skill evaluation request");
    await dependencies.governance?.consume(principal.userId, "chat");
    const evaluation = await dependencies.skillManager.evaluate({
      skillId: params.data.id,
      version: params.data.version,
      cases: body.data.cases,
      createdBy: principal.account?.id ?? null,
    });
    await dependencies.database.appendAudit({
      userId: principal.userId,
      eventType: "skill.evaluated",
      resourceType: "skill",
      resourceId: `${evaluation.skillId}@${evaluation.skillVersion}`,
      details: { passed: evaluation.passed, passedCases: evaluation.passedCases, totalCases: evaluation.totalCases },
    });
    return { evaluation };
  });

  app.post("/v1/skills/:id/:version/activate", async (request, reply) => {
    if (!dependencies.skillManager) return reply.notFound();
    const principal = requireOwner(request);
    const params = skillParamsSchema.safeParse(request.params);
    if (!params.success) return reply.badRequest("Invalid skill activation request");
    const skill = await dependencies.skillManager.activate(params.data.id, params.data.version);
    await dependencies.database.appendAudit({
      userId: principal.userId,
      eventType: "skill.activated",
      resourceType: "skill",
      resourceId: `${skill.id}@${skill.version}`,
    });
    const { instructions: _instructions, ...metadata } = skill;
    return { skill: metadata };
  });

  app.get("/v1/traces", async (request, reply) => {
    if (!dependencies.governance) return reply.notFound();
    const parsed = listTracesSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid traces query");
    return {
      traces: await dependencies.governance.list(
        authorizeUser(request, parsed.data.userId),
        parsed.data.limit,
      ),
    };
  });

  app.post("/v1/tools/execute", async (request, reply) => {
    if (!dependencies.toolExecutor) return reply.notFound();
    const parsed = toolExecutionSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid tool request");
    return dependencies.toolExecutor.execute({
      ...parsed.data,
      userId: authorizeUser(request, parsed.data.userId),
    });
  });

  app.post("/v1/approvals/:id/decision", async (request, reply) => {
    if (!dependencies.toolExecutor) return reply.notFound();
    const params = approvalParamsSchema.safeParse(request.params);
    const body = approvalDecisionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid approval decision");
    try {
      const decision = await dependencies.toolExecutor.decide({
        approvalId: params.data.id,
        userId: authorizeUser(request, body.data.userId),
        approved: body.data.approved,
      });
      const userId = authorizeUser(request, body.data.userId);
      const resumedRun = dependencies.agentRuntime
        ? await dependencies.agentRuntime.resumeByApproval({
            userId,
            approvalId: params.data.id,
            output: decision.status === "completed" ? decision.output : null,
            rejected: decision.status === "rejected",
          })
        : null;
      if (resumedRun?.result && resumedRun.status !== "waiting_approval") {
        await dependencies.database.saveTurn({
          userId,
          conversationId: resumedRun.conversationId,
          messages: [],
          result: resumedRun.result.result,
        });
        await dependencies.projects?.recordRunResult(resumedRun);
      }
      return { ...decision, resumedRun };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return reply.notFound(error.message);
      }
      throw error;
    }
  });

  app.get("/v1/approvals", async (request, reply) => {
    const parsed = userListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid approvals query");
    return {
      approvals: await dependencies.database.listApprovals(
        authorizeUser(request, parsed.data.userId),
        parsed.data.limit,
      ),
    };
  });

  app.post("/v1/jobs", async (request, reply) => {
    await assertRuntimeActive();
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid job request");
    const userId = authorizeUser(request, parsed.data.userId);
    await dependencies.governance?.consume(userId, "job");
    const traceId = dependencies.governance?.newTraceId();
    const job = await dependencies.database.createJob({
      userId,
      jobType: parsed.data.jobType,
      jobInput: parsed.data.input,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : new Date(),
    });
    await dependencies.database.appendAudit({
      userId,
      eventType: "job.created",
      resourceType: "job",
      resourceId: job.id,
      details: { jobType: job.jobType, scheduledFor: job.scheduledFor },
    });
    if (traceId) {
      await dependencies.governance?.trace({
        traceId,
        userId,
        operation: `job:${job.jobType}`,
        status: "pending",
        details: { jobId: job.id, scheduledFor: job.scheduledFor },
      });
    }
    return reply.code(201).send({ job, traceId });
  });

  app.get("/v1/jobs", async (request, reply) => {
    const parsed = listJobsSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid jobs query");
    const jobs = await dependencies.database.listJobs(
      authorizeUser(request, parsed.data.userId),
      parsed.data.limit,
    );
    return { jobs };
  });

  app.post("/v1/schedules", async (request, reply) => {
    await assertRuntimeActive();
    if (!dependencies.schedules) return reply.notFound();
    const parsed = scheduleCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid schedule request");
    const userId = authorizeUser(request, parsed.data.userId);
    if (parsed.data.deliveryChannel === "telegram") {
      const link = await dependencies.telegramLinks?.get(userId);
      if (!link) return reply.badRequest("Link Telegram before enabling schedule delivery");
    }
    await dependencies.governance?.consume(userId, "job");
    const schedule = await dependencies.schedules.create({
      userId, name: parsed.data.name, objective: parsed.data.objective,
      cronExpression: parsed.data.cronExpression, timezone: parsed.data.timezone,
      taskClass: parsed.data.taskClass, maxSteps: parsed.data.maxSteps,
      maxTotalTokens: parsed.data.maxTotalTokens, deliveryChannel: parsed.data.deliveryChannel,
      ...(parsed.data.allowedTools ? { allowedTools: parsed.data.allowedTools } : {}),
    });
    await dependencies.database.appendAudit({ userId, eventType: "schedule.created", resourceType: "schedule", resourceId: schedule.id, details: { cronExpression: schedule.cronExpression, timezone: schedule.timezone, deliveryChannel: schedule.deliveryChannel } });
    return reply.code(201).send({ schedule });
  });

  app.get("/v1/schedules", async (request, reply) => {
    if (!dependencies.schedules) return reply.notFound();
    const parsed = userListSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid schedules query");
    return { schedules: await dependencies.schedules.list(authorizeUser(request, parsed.data.userId), parsed.data.limit) };
  });

  for (const [action, status] of [["pause", "paused"], ["resume", "active"], ["disable", "disabled"]] as const) {
    app.post(`/v1/schedules/:id/${action}`, async (request, reply) => {
      if (!dependencies.schedules) return reply.notFound();
      const params = scheduleParamsSchema.safeParse(request.params);
      const body = z.object({ userId: z.string().min(1).max(128) }).strict().safeParse(request.body);
      if (!params.success || !body.success) return reply.badRequest("Invalid schedule action");
      const userId = authorizeUser(request, body.data.userId);
      const schedule = action === "pause" ? await dependencies.schedules.pause(userId, params.data.id)
        : action === "resume" ? await dependencies.schedules.resume(userId, params.data.id)
          : await dependencies.schedules.disable(userId, params.data.id);
      if (!schedule) return reply.notFound("Schedule not found or transition is invalid");
      await dependencies.database.appendAudit({ userId, eventType: `schedule.${status}`, resourceType: "schedule", resourceId: schedule.id });
      return { schedule };
    });
  }

  app.post("/v1/jobs/:id/cancel", async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    const body = z.object({ userId: z.string().min(1).max(128) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid job cancellation");
    const userId = authorizeUser(request, body.data.userId);
    const job = await dependencies.database.cancelJob(userId, params.data.id);
    if (!job) return reply.conflict("Only queued or waiting jobs can be cancelled");
    await dependencies.database.appendAudit({
      userId,
      eventType: "job.cancelled",
      resourceType: "job",
      resourceId: job.id,
    });
    return { job };
  });

  app.post("/v1/jobs/:id/retry", async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    const body = z.object({ userId: z.string().min(1).max(128) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.badRequest("Invalid job retry");
    const userId = authorizeUser(request, body.data.userId);
    const job = await dependencies.database.retryJob(userId, params.data.id);
    if (!job) return reply.conflict("Only failed or cancelled jobs can be retried");
    await dependencies.database.appendAudit({
      userId,
      eventType: "job.retried",
      resourceType: "job",
      resourceId: job.id,
    });
    return { job };
  });

  app.get("/v1/dashboard", async (request, reply) => {
    const parsed = dashboardQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Invalid dashboard query");
    const stats = await dependencies.database.getDashboardStats(
      dashboardUser(request, parsed.data.userId),
    );
    return {
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      workerEnabled: dependencies.runtimeInfo?.workerEnabled ?? false,
      stats,
    };
  });

  app.get("/v1/metrics", async (request, reply) => {
    requireOwner(request);
    const stats = await dependencies.database.getDashboardStats();
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(renderPrometheusMetrics({
        uptimeSeconds: process.uptime(),
        workerEnabled: dependencies.runtimeInfo?.workerEnabled ?? false,
        stats,
      }));
  });

  app.get("/channels/whatsapp/webhook", async (request, reply) => {
    if (!dependencies.whatsapp) return reply.notFound();
    const parsed = z.object({
      "hub.mode": z.literal("subscribe"),
      "hub.verify_token": z.string().min(1),
      "hub.challenge": z.string().min(1).max(1_000),
    }).passthrough().safeParse(request.query);
    if (!parsed.success || !tokenMatches(dependencies.whatsapp.verifyToken, parsed.data["hub.verify_token"])) {
      return reply.forbidden("Invalid WhatsApp verification token");
    }
    return reply.type("text/plain").send(parsed.data["hub.challenge"]);
  });

  app.post("/channels/whatsapp/webhook", async (request, reply) => {
    if (!dependencies.whatsapp) return reply.notFound();
    const suppliedSignature = request.headers["x-hub-signature-256"];
    const rawBody = rawWhatsAppBodies.get(request);
    if (typeof suppliedSignature !== "string" || !rawBody ||
      !verifyWhatsAppSignature(dependencies.whatsapp.appSecret, rawBody, suppliedSignature)) {
      return reply.unauthorized("Invalid WhatsApp webhook signature");
    }
    const messages = extractWhatsAppMessages(request.body);
    if (messages.length === 0) return { ok: true, ignored: true };
    if (!dependencies.agentRuntime) return reply.serviceUnavailable("Agent runtime is unavailable");
    const accepted: string[] = [];
    for (const message of messages.slice(0, 20)) {
      if (seenWhatsAppMessages.has(message.id)) continue;
      seenWhatsAppMessages.add(message.id);
      if (seenWhatsAppMessages.size > 2_000) seenWhatsAppMessages.delete(seenWhatsAppMessages.values().next().value!);
      const userId = `whatsapp:${message.from}`;
      const decision = /^!(approve|reject)\s+([0-9a-f-]{36})$/iu.exec(message.text);
      if (decision && dependencies.toolExecutor) {
        try {
          const outcome = await dependencies.toolExecutor.decide({
            approvalId: decision[2]!, userId, approved: decision[1] === "approve",
          });
          const resumed = await dependencies.agentRuntime.resumeByApproval({
            userId, approvalId: decision[2]!,
            output: outcome.status === "completed" ? outcome.output : null,
            rejected: outcome.status === "rejected",
          });
          await dependencies.whatsapp.client.sendMessage(message.from, resumed?.result?.text ?? "Решение принято.");
          if (resumed) await dependencies.projects?.recordRunResult(resumed);
        } catch (error) {
          await dependencies.whatsapp.client.sendMessage(message.from, error instanceof Error ? error.message.slice(0, 500) : "Ошибка");
        }
        accepted.push(message.id);
        continue;
      }
      const memories = await memory.recall(userId, message.text, 5);
      const run = await dependencies.agentRuntime.enqueue({
        userId,
        conversationId: randomUUID(),
        messages: [
          ...(memories.length ? [{ role: "system" as const, content: ["Use these Barlas AI Agent user memories only when relevant:", ...memories.map((item) => `- [${item.category}] ${item.content}`)].join("\n") }] : []),
          { role: "user" as const, content: message.text },
        ],
        conversationMessages: [{ role: "user", content: message.text }],
        delivery: { channel: "whatsapp", recipientId: message.from },
        taskClass: "fast",
        maxSteps: 8,
      });
      accepted.push(message.id);
      await dependencies.database.appendAudit({
        userId,
        eventType: "whatsapp.message.accepted",
        resourceType: "agent_run",
        resourceId: run.id,
        details: { messageId: message.id },
      });
    }
    return { ok: true, accepted };
  });

  app.post("/channels/slack/message", async (request, reply) => {
    if (!dependencies.slack) return reply.notFound();
    const suppliedSecret = request.headers["x-barlas-slack-secret"];
    if (typeof suppliedSecret !== "string" || !tokenMatches(dependencies.slack.socketSecret, suppliedSecret)) {
      return reply.unauthorized("Invalid Slack socket secret");
    }
    const parsed = socketChannelMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid Slack message");
    if (seenSlackMessages.has(parsed.data.id)) return { ok: true, duplicate: true };
    seenSlackMessages.add(parsed.data.id);
    if (seenSlackMessages.size > 1_000) seenSlackMessages.delete(seenSlackMessages.values().next().value!);
    const userId = `slack:${parsed.data.authorId}`;
    const decision = /^!(approve|reject)\s+([0-9a-f-]{36})$/iu.exec(parsed.data.content);
    if (decision && dependencies.toolExecutor) {
      try {
        const outcome = await dependencies.toolExecutor.decide({ approvalId: decision[2]!, userId, approved: decision[1] === "approve" });
        const resumed = dependencies.agentRuntime ? await dependencies.agentRuntime.resumeByApproval({
          userId, approvalId: decision[2]!, output: outcome.status === "completed" ? outcome.output : null,
          rejected: outcome.status === "rejected",
        }) : null;
        await dependencies.slack.client.sendMessage(parsed.data.channelId, resumed?.result?.text ?? "Решение принято.");
        if (resumed) await dependencies.projects?.recordRunResult(resumed);
      } catch (error) {
        await dependencies.slack.client.sendMessage(parsed.data.channelId, error instanceof Error ? error.message.slice(0, 500) : "Ошибка");
      }
      return { ok: true };
    }
    if (!dependencies.agentRuntime) return reply.serviceUnavailable("Agent runtime is unavailable");
    const memories = await memory.recall(userId, parsed.data.content, 5);
    const run = await dependencies.agentRuntime.enqueue({
      userId, conversationId: randomUUID(),
      messages: [
        ...(memories.length ? [{ role: "system" as const, content: ["Use these Barlas AI Agent user memories only when relevant:", ...memories.map((item) => `- [${item.category}] ${item.content}`)].join("\n") }] : []),
        { role: "user" as const, content: parsed.data.content },
      ],
      conversationMessages: [{ role: "user", content: parsed.data.content }],
      delivery: { channel: "slack", channelId: parsed.data.channelId }, taskClass: "fast", maxSteps: 8,
    });
    await dependencies.slack.client.sendMessage(parsed.data.channelId, `Задача принята. Запуск ${run.id.slice(0, 8)}.`);
    return { ok: true, runId: run.id };
  });

  app.post("/channels/discord/message", async (request, reply) => {
    if (!dependencies.discord) return reply.notFound();
    const suppliedSecret = request.headers["x-barlas-discord-secret"];
    if (typeof suppliedSecret !== "string" || !tokenMatches(dependencies.discord.gatewaySecret, suppliedSecret)) {
      return reply.unauthorized("Invalid Discord gateway secret");
    }
    const parsed = socketChannelMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid Discord message");
    if (seenDiscordMessages.has(parsed.data.id)) return { ok: true, duplicate: true };
    seenDiscordMessages.add(parsed.data.id);
    if (seenDiscordMessages.size > 1_000) seenDiscordMessages.delete(seenDiscordMessages.values().next().value!);
    const userId = `discord:${parsed.data.authorId}`;
    const decision = /^!(approve|reject)\s+([0-9a-f-]{36})$/iu.exec(parsed.data.content);
    if (decision && dependencies.toolExecutor) {
      try {
        const outcome = await dependencies.toolExecutor.decide({
          approvalId: decision[2]!, userId, approved: decision[1] === "approve",
        });
        const resumed = dependencies.agentRuntime ? await dependencies.agentRuntime.resumeByApproval({
          userId, approvalId: decision[2]!, output: outcome.status === "completed" ? outcome.output : null,
          rejected: outcome.status === "rejected",
        }) : null;
        await dependencies.discord.client.sendMessage(parsed.data.channelId, resumed?.result?.text ?? "Решение принято.");
        if (resumed) await dependencies.projects?.recordRunResult(resumed);
      } catch (error) {
        await dependencies.discord.client.sendMessage(parsed.data.channelId, error instanceof Error ? error.message.slice(0, 500) : "Ошибка");
      }
      return { ok: true };
    }
    if (!dependencies.agentRuntime) return reply.serviceUnavailable("Agent runtime is unavailable");
    const memories = await memory.recall(userId, parsed.data.content, 5);
    const run = await dependencies.agentRuntime.enqueue({
      userId, conversationId: randomUUID(),
      messages: [
        ...(memories.length ? [{ role: "system" as const, content: ["Use these Barlas AI Agent user memories only when relevant:", ...memories.map((item) => `- [${item.category}] ${item.content}`)].join("\n") }] : []),
        { role: "user" as const, content: parsed.data.content },
      ],
      conversationMessages: [{ role: "user", content: parsed.data.content }],
      delivery: { channel: "discord", channelId: parsed.data.channelId },
      taskClass: "fast", maxSteps: 8,
    });
    await dependencies.discord.client.sendMessage(parsed.data.channelId, `Задача принята. Запуск ${run.id.slice(0, 8)}.`);
    return { ok: true, runId: run.id };
  });

  app.post("/channels/telegram/webhook", async (request, reply) => {
    if (!dependencies.telegram) return reply.notFound();
    const suppliedSecret = request.headers["x-telegram-bot-api-secret-token"];
    if (
      typeof suppliedSecret !== "string" ||
      !tokenMatches(dependencies.telegram.webhookSecret, suppliedSecret)
    ) {
      return reply.unauthorized("Invalid Telegram webhook secret");
    }

    const parsed = telegramUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.badRequest("Invalid Telegram update");
    if (parsed.data.callback_query) {
      const callback = parsed.data.callback_query;
      const match = /^(approve|reject):([0-9a-f-]{36})$/i.exec(callback.data);
      if (!match || !dependencies.toolExecutor) return { ok: true, ignored: true };
      const userId = await dependencies.telegramLinks?.resolve(callback.from.id) ?? `telegram:${callback.from.id}`;
      try {
        const decision = await dependencies.toolExecutor.decide({
          approvalId: match[2]!,
          userId,
          approved: match[1] === "approve",
        });
        const resumed = dependencies.agentRuntime
          ? await dependencies.agentRuntime.resumeByApproval({
              userId,
              approvalId: match[2]!,
              output: decision.status === "completed" ? decision.output : null,
              rejected: decision.status === "rejected",
            })
          : null;
        await dependencies.telegram.client.answerCallbackQuery?.(callback.id, "Решение принято");
        if (callback.message && resumed?.result) {
          await dependencies.telegram.client.sendMessage(callback.message.chat.id, resumed.result.text);
        }
        if (resumed) await dependencies.projects?.recordRunResult(resumed);
        return { ok: true };
      } catch (error) {
        await dependencies.telegram.client.answerCallbackQuery?.(
          callback.id,
          error instanceof Error ? error.message.slice(0, 150) : "Ошибка",
        );
        return { ok: true };
      }
    }
    if (!parsed.data.message) return { ok: true, ignored: true };

    const message = parsed.data.message;
    const voiceCommand = parseTelegramVoiceCommand(message.text);
    if (voiceCommand.requested && !voiceCommand.prompt) {
      await dependencies.telegram.client.sendMessage(
        message.chat.id,
        "Telegram Bot API не позволяет боту начать нативный звонок. Используйте /voice ваш вопрос или /call ваш вопрос — Barlas ответит голосовым сообщением.",
      );
      return { ok: true, voiceHelp: true };
    }
    const prompt = voiceCommand.prompt ?? message.text;
    const linkCommand = /^\/link\s+(BARLAS-[A-Z0-9_-]+)$/i.exec(message.text.trim());
    if (linkCommand && dependencies.telegramLinks) {
      const link = await dependencies.telegramLinks.claim(
        linkCommand[1]!,
        message.from?.id ?? message.chat.id,
        message.chat.id,
      );
      await dependencies.telegram.client.sendMessage(
        message.chat.id,
        link ? "Telegram успешно привязан к Barlas AI Agent." : "Код недействителен, истёк или уже использован.",
      );
      return { ok: true, linked: Boolean(link) };
    }
    if (dependencies.agentRuntime) {
      const telegramUserId = message.from?.id ?? message.chat.id;
      const userId = await dependencies.telegramLinks?.resolve(telegramUserId) ?? `telegram:${telegramUserId}`;
      const conversationId = channelConversationId("telegram", userId, String(message.chat.id));
      const existingConversation = await dependencies.database.getConversation(userId, conversationId);
      const incomingMessages = [{ role: "user" as const, content: prompt }];
      const conversation = mergeConversationMessages(
        existingConversation?.messages.map(({ role, content }) => ({ role, content })) ?? [],
        incomingMessages,
      );
      const memories = await memory.recall(userId, prompt, 5);
      const memoryContext = memories.length > 0 ? [{
        role: "system" as const,
        content: ["Use these Barlas AI Agent user memories only when relevant:", ...memories.map((item) => `- [${item.category}] ${item.content}`)].join("\n"),
      }] : [];
      const [languageContext, commitmentsContext, outcomesContext] = await Promise.all([
        preferredLanguageContext(userId, dependencies.authService),
        continuityContext(userId, dependencies.continuity),
        outcomeContext(userId, dependencies.outcomes),
      ]);
      const identityContext = agentIdentityContext(dependencies.agentIdentity);
      const persistedImmediately = dependencies.database.appendConversationMessages
        ? await dependencies.database.appendConversationMessages({
            userId,
            conversationId,
            messages: conversation.newMessages,
          }).then(() => true)
        : false;
      const run = await dependencies.agentRuntime.enqueue({
        userId, conversationId,
        messages: [...identityContext, ...languageContext, ...commitmentsContext, ...outcomesContext, ...memoryContext, ...conversation.modelMessages],
        conversationMessages: persistedImmediately ? [] : conversation.newMessages,
        delivery: { channel: "telegram", chatId: message.chat.id, ...(voiceCommand.requested ? { voice: true } : {}) },
        taskClass: "fast",
        maxSteps: 8,
      });
      // Keep ordinary conversation natural: the durable run ID remains available
      // through run/status commands instead of appearing before every answer.
      await dependencies.telegram.client.sendChatAction?.(
        message.chat.id,
        voiceCommand.requested ? "record_voice" : "typing",
      );
      return { ok: true, runId: run.id };
    }
    const { result } = await runChat({
      userId: `telegram:${message.from?.id ?? message.chat.id}`,
      messages: [{ role: "user", content: prompt }],
      taskClass: "fast",
    });
    if (voiceCommand.requested && dependencies.telegram.client.sendVoice && dependencies.media?.createSpeech && dependencies.workspace) {
      const userId = `telegram:${message.from?.id ?? message.chat.id}`;
      const runId = randomUUID();
      try {
        const voice = await sendTelegramVoiceReply({
          client: {
            sendVoice: dependencies.telegram.client.sendVoice.bind(dependencies.telegram.client),
            maxUploadBytes: dependencies.telegram.client.maxUploadBytes ?? 50_000_000,
          },
          media: { createSpeech: dependencies.media.createSpeech.bind(dependencies.media) },
          workspace: dependencies.workspace,
          userId,
          chatId: message.chat.id,
          runId,
          text: result.text,
        });
        await dependencies.database.appendAudit({
          userId,
          eventType: "telegram.voice.sent",
          resourceType: "direct_chat",
          resourceId: runId,
          details: voice,
        });
      } catch (error) {
        await dependencies.database.appendAudit({
          userId,
          eventType: "telegram.voice.failed",
          resourceType: "direct_chat",
          resourceId: runId,
          details: { error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
        });
        await dependencies.telegram.client.sendMessage(message.chat.id, telegramVoiceFallbackText(result.text));
      }
    } else {
      await dependencies.telegram.client.sendMessage(message.chat.id, result.text);
    }
    return { ok: true };
  });

  app.addHook("onClose", async () => {
    await dependencies.database.close();
  });

  return app;
}
