import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";

import { buildApp } from "../src/app.js";
import type { ModelProvider } from "../src/core/models.js";
import { RuntimeGovernance } from "../src/governance/runtime.js";
import type { SupportedLanguageCode } from "../src/i18n/languages.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { createBuiltinExtensionCatalog } from "../src/extensions/catalog.js";
import { createSignedSkillPackage } from "../src/skills/package.js";

const apiToken = "a".repeat(32);

function dependencies() {
  const modelProvider: ModelProvider = {
    name: "test",
    generate: vi.fn(async () => ({
      text: "Hello from Barlas AI Agent",
      provider: "test",
      model: "test-model",
      responseId: "response-test",
    })),
  };

  const database = {
    ping: vi.fn(async () => undefined),
    saveTurn: vi.fn(async () => undefined),
    remember: vi.fn(async (input: {
      userId: string;
      content: string;
      category: string;
      importance: number;
    }) => ({
      id: "00000000-0000-4000-8000-000000000001",
      ...input,
      createdAt: "2026-10-16T00:00:00.000Z",
    })),
    recall: vi.fn(async () => []),
    listConversations: vi.fn(async () => []),
    getConversation: vi.fn(async () => null),
    createApproval: vi.fn(async (input: {
      userId: string;
      toolName: string;
      risk: "write" | "external" | "destructive";
      summary: string;
      toolInput: unknown;
    }) => ({
      id: "00000000-0000-4000-8000-000000000002",
      userId: input.userId,
      toolName: input.toolName,
      risk: input.risk,
      summary: input.summary,
      input: input.toolInput,
      status: "pending" as const,
      createdAt: "2026-10-16T00:00:00.000Z",
    })),
    decideApproval: vi.fn(async () => null),
    markApprovalExecuted: vi.fn(async () => undefined),
    listApprovals: vi.fn(async () => []),
    appendAudit: vi.fn(async () => undefined),
    createJob: vi.fn(async (input: {
      userId: string;
      jobType: string;
      jobInput: unknown;
      scheduledFor: Date;
    }) => ({
      id: "00000000-0000-4000-8000-000000000003",
      userId: input.userId,
      jobType: input.jobType,
      input: input.jobInput,
      status: "queued" as const,
      scheduledFor: input.scheduledFor.toISOString(),
      attempts: 0,
      maxAttempts: 3,
      createdAt: "2026-10-16T00:00:00.000Z",
    })),
    listJobs: vi.fn(async () => []),
    cancelJob: vi.fn(async () => null),
    retryJob: vi.fn(async () => null),
    getDashboardStats: vi.fn(async () => ({
      conversations: 0,
      messages: 0,
      queuedJobs: 0,
      failedJobs: 0,
      pendingApprovals: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    })),
    claimJobs: vi.fn(async () => []),
    completeJob: vi.fn(async () => true),
    failJob: vi.fn(async () => "failed" as const),
    close: vi.fn(async () => undefined),
  };

  return { modelProvider, database };
}

describe("Barlas AI Agent API", () => {
  it("authenticates the owner with a Barlas gateway token", async () => {
    const deps = dependencies();
    const gatewayToken = "g".repeat(64);
    const gatewayOwner = { id: "00000000-0000-4000-8000-000000000099", email: "owner@example.com", displayName: "Owner", role: "owner" as const, active: true, languageCode: "uz" as const, languageConfigured: true, createdAt: "2026-10-16T00:00:00.000Z" };
    const app = await buildApp({ apiToken, gatewayToken, gatewayOwner, ...deps });
    const accepted = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${gatewayToken}` } });
    const rejected = await app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${"x".repeat(64)}` } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ authType: "gateway", principal: { id: gatewayOwner.id, role: "owner" } });
    expect(rejected.statusCode).toBe(401);
    await app.close();
  });

  it("returns branded health information", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: "Barlas AI Agent", status: "ok" });
    await app.close();
  });

  it("lists extension capabilities and configuration state", async () => {
    const deps = dependencies();
    const extensionCatalog = createBuiltinExtensionCatalog({
      browser: false, github: false, google: false, mcp: false, sandbox: true,
      telegram: true, discord: false, slack: false, privateModel: false, deviceNodes: true, modelProvider: "openai",
    });
    const app = await buildApp({ apiToken, ...deps, extensionCatalog });
    const response = await app.inject({
      method: "GET", url: "/v1/extensions", headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().extensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "channel.telegram", configured: true }),
      expect.objectContaining({ id: "channel.discord", configured: false }),
      expect.objectContaining({ id: "channel.slack", configured: false }),
      expect.objectContaining({ id: "runtime.browser", configured: false }),
    ]));
    await app.close();
  });

  it("lists languages and persists the authenticated user's choice", async () => {
    const deps = dependencies();
    let currentLanguage: SupportedLanguageCode | null = null;
    const account = {
      id: "00000000-0000-4000-8000-000000000099",
      email: "user@example.com",
      displayName: "User",
      role: "user" as const,
      active: true,
      languageCode: currentLanguage,
      languageConfigured: currentLanguage !== null,
      createdAt: "2026-10-16T00:00:00.000Z",
    };
    const authService = {
      authenticate: vi.fn(async () => ({
        ...account, languageCode: currentLanguage, languageConfigured: currentLanguage !== null,
      })),
      login: vi.fn(), logout: vi.fn(), listAccounts: vi.fn(), createAccount: vi.fn(),
      issuePasswordReset: vi.fn(), resetPassword: vi.fn(), getAccount: vi.fn(async () => ({
        ...account, languageCode: currentLanguage, languageConfigured: currentLanguage !== null,
      })),
      setLanguage: vi.fn(async (_id: string, languageCode: SupportedLanguageCode) => {
        currentLanguage = languageCode;
        return { ...account, languageCode, languageConfigured: true };
      }),
    };
    const app = await buildApp({ apiToken, ...deps, authService });
    const catalogue = await app.inject({ method: "GET", url: "/languages" });
    expect(catalogue.statusCode).toBe(200);
    expect(catalogue.json().languages.length).toBeGreaterThanOrEqual(35);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me/preferences",
      headers: { authorization: "Bearer user-session-token-which-is-long-enough" },
      payload: { languageCode: "uz" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().account).toMatchObject({ languageCode: "uz", languageConfigured: true });
    expect(authService.setLanguage).toHaveBeenCalledWith(account.id, "uz");

    const chat = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: "Bearer user-session-token-which-is-long-enough" },
      payload: { userId: account.id, messages: [{ role: "user", content: "Salom" }] },
    });
    expect(chat.statusCode).toBe(200);
    expect(vi.mocked(deps.modelProvider.generate).mock.calls[0]?.[0].messages[0]?.content).toContain("Uzbek");
    await app.close();
  });

  it("serves the branded web cabinet with strict browser security headers", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps, webRoot: resolve("web") });
    const response = await app.inject({ method: "GET", url: "/ui/index.html" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Barlas AI Agent");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    await app.close();
  });

  it("rejects chat requests without authorization", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      payload: { userId: "user-1", messages: [{ role: "user", content: "Hello" }] },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("generates and stores an authorized chat response", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { userId: "user-1", messages: [{ role: "user", content: "Hello" }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().message.content).toBe("Hello from Barlas AI Agent");
    expect(response.json().memoriesUsed).toBe(0);
    expect(deps.database.saveTurn).toHaveBeenCalledOnce();
    await app.close();
  });

  it("continues a saved conversation without duplicating client-supplied history", async () => {
    const deps = dependencies();
    const conversationId = "00000000-0000-4000-8000-000000000099";
    deps.database.getConversation.mockResolvedValue({
      id: conversationId,
      title: "Remember the name",
      messageCount: 2,
      lastMessage: "Your name is Arman",
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:01.000Z",
      messages: [
        { id: "1", role: "user", content: "My name is Arman", createdAt: "2026-10-16T00:00:00.000Z" },
        { id: "2", role: "assistant", content: "Your name is Arman", createdAt: "2026-10-16T00:00:01.000Z" },
      ],
    } as never);
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        conversationId,
        messages: [
          { role: "user", content: "My name is Arman" },
          { role: "assistant", content: "Your name is Arman" },
          { role: "user", content: "What is my name?" },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.modelProvider.generate).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      messages: [
        { role: "user", content: "My name is Arman" },
        { role: "assistant", content: "Your name is Arman" },
        { role: "user", content: "What is my name?" },
      ],
    }));
    expect(deps.database.saveTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      messages: [{ role: "user", content: "What is my name?" }],
    }));
    await app.close();
  });

  it("runs the bounded autonomous agent loop", async () => {
    const deps = dependencies();
    const agentLoop = {
      run: vi.fn(async () => ({
        status: "completed" as const,
        text: "Autonomous result",
        steps: 2,
        toolExecutions: 1,
        approvalIds: [],
        result: {
          text: "Autonomous result",
          provider: "test",
          model: "test-model",
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, costUsd: 0.02 },
        },
      })),
    };
    const app = await buildApp({ apiToken, ...deps, agentLoop });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/run",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { userId: "user-1", messages: [{ role: "user", content: "Use a tool" }], maxSteps: 4 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "completed",
      message: { content: "Autonomous result" },
      steps: 2,
      toolExecutions: 1,
      memoriesUsed: 0,
    });
    expect(agentLoop.run).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", maxSteps: 4 }));
    expect(deps.database.saveTurn).toHaveBeenCalledOnce();
    await app.close();
  });

  it("gives an autonomous follow-up the saved conversation context", async () => {
    const deps = dependencies();
    const conversationId = "00000000-0000-4000-8000-000000000098";
    deps.database.getConversation.mockResolvedValue({
      id: conversationId,
      title: "Plan",
      messageCount: 2,
      lastMessage: "I will prepare it",
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:01.000Z",
      messages: [
        { id: "1", role: "user", content: "Prepare a plan", createdAt: "2026-10-16T00:00:00.000Z" },
        { id: "2", role: "assistant", content: "I will prepare it", createdAt: "2026-10-16T00:00:01.000Z" },
      ],
    } as never);
    const agentLoop = {
      run: vi.fn(async () => ({
        status: "completed" as const,
        text: "Updated",
        steps: 1,
        toolExecutions: 0,
        approvalIds: [],
        result: { text: "Updated", provider: "test", model: "test-model" },
      })),
    };
    const app = await buildApp({ apiToken, ...deps, agentLoop });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/run",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        conversationId,
        messages: [{ role: "user", content: "Now make it shorter" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(agentLoop.run).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      messages: expect.arrayContaining([
        { role: "user", content: "Prepare a plan" },
        { role: "assistant", content: "I will prepare it" },
        { role: "user", content: "Now make it shorter" },
      ]),
    }));
    expect(deps.database.saveTurn).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: "user", content: "Now make it shorter" }],
    }));
    await app.close();
  });

  it("applies an active skill and enforces its tool allowlist", async () => {
    const deps = dependencies();
    const skillRegistry = new SkillRegistry();
    skillRegistry.register({
      id: "research.safe",
      version: "1.0.0",
      description: "Safe research",
      instructions: "Cite sources and state uncertainty.",
      allowedTools: ["web.open"],
    });
    const agentLoop = {
      run: vi.fn(async () => ({
        status: "completed" as const,
        text: "Skill result",
        steps: 1,
        toolExecutions: 0,
        approvalIds: [],
        result: { text: "Skill result", provider: "test", model: "test-model" },
      })),
    };
    const app = await buildApp({ apiToken, ...deps, agentLoop, skillRegistry });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/run",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        messages: [{ role: "user", content: "Research this" }],
        skillId: "research.safe",
        skillVersion: "1.0.0",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(agentLoop.run).toHaveBeenCalledWith(expect.objectContaining({
      allowedTools: ["web.open"],
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "system", content: expect.stringContaining("research.safe@1.0.0") }),
      ]),
    }));

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/agent/run",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        messages: [{ role: "user", content: "Research this" }],
        skillId: "research.safe",
        allowedTools: ["files.write"],
      },
    });
    expect(rejected.statusCode).toBe(400);
    await app.close();
  });

  it("exposes the owner skill candidate, evaluation, and activation lifecycle", async () => {
    const deps = dependencies();
    const installed = {
      id: "research.custom", version: "1.0.0", description: "Research", instructions: "Be precise.",
      allowedTools: ["web.open"], active: false, createdBy: null, createdAt: "2026-10-16T00:00:00.000Z",
    };
    const skillManager = {
      install: vi.fn(async () => installed),
      evaluate: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000090",
        skillId: installed.id,
        skillVersion: installed.version,
        passed: true,
        passedCases: 1,
        totalCases: 1,
        details: [{ name: "quality", passed: true, missing: [], forbidden: [] }],
        createdBy: null,
        createdAt: "2026-10-16T00:00:01.000Z",
      })),
      activate: vi.fn(async () => installed),
    };
    const app = await buildApp({ apiToken, ...deps, skillManager });
    const headers = { authorization: `Bearer ${apiToken}` };
    const created = await app.inject({
      method: "POST", url: "/v1/skills", headers,
      payload: {
        id: installed.id, version: installed.version, description: installed.description,
        instructions: installed.instructions, allowedTools: installed.allowedTools,
      },
    });
    expect(created.statusCode).toBe(201);

    const evaluated = await app.inject({
      method: "POST", url: `/v1/skills/${installed.id}/${installed.version}/evaluate`, headers,
      payload: { cases: [{ name: "quality", prompt: "Research", requiredStrings: ["source"] }] },
    });
    expect(evaluated.statusCode).toBe(200);
    expect(evaluated.json().evaluation.passed).toBe(true);

    const activated = await app.inject({
      method: "POST", url: `/v1/skills/${installed.id}/${installed.version}/activate`, headers,
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().skill).not.toHaveProperty("instructions");

    const privateKey = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;
    const signedPackage = createSignedSkillPackage({
      schemaVersion: 1,
      publisher: { name: "Test Publisher" },
      skill: {
        id: "research.signed", version: installed.version, description: installed.description,
        instructions: installed.instructions, allowedTools: installed.allowedTools,
      },
    }, privateKey);
    const signed = await app.inject({
      method: "POST", url: "/v1/skills/packages", headers,
      payload: { package: signedPackage, trustedFingerprint: signedPackage.publisher.fingerprint },
    });
    expect(signed.statusCode).toBe(201);
    expect(signed.json().publisher).toEqual({
      name: "Test Publisher", fingerprint: signedPackage.publisher.fingerprint,
    });

    const tampered = await app.inject({
      method: "POST", url: "/v1/skills/packages", headers,
      payload: {
        package: { ...signedPackage, skill: { ...signedPackage.skill, instructions: "tampered" } },
        trustedFingerprint: signedPackage.publisher.fingerprint,
      },
    });
    expect(tampered.statusCode).toBe(400);
    await app.close();
  });

  it("returns a durable run ID and binds it to the selected owned project", async () => {
    const deps = dependencies();
    const loopResult = {
      status: "completed" as const,
      text: "Durable result",
      steps: 1,
      toolExecutions: 0,
      approvalIds: [],
      result: { text: "Durable result", provider: "test", model: "test-model" },
    };
    const record = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: "user-1",
      conversationId: "00000000-0000-4000-8000-000000000001",
      status: "completed" as const,
      messages: [{ role: "user" as const, content: "Run durably" }],
      conversationMessages: [{ role: "user" as const, content: "Run durably" }],
      taskClass: "fast" as const,
      maxSteps: 8,
      scheduledFor: "2026-10-16T00:00:00.000Z",
      attempts: 0,
      maxAttempts: 3,
      result: loopResult,
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:01.000Z",
    };
    const agentRuntime = {
      start: vi.fn(async () => record),
      enqueue: vi.fn(async () => ({ ...record, status: "queued" as const })),
      resume: vi.fn(async () => record),
      resumeByApproval: vi.fn(async () => record),
      get: vi.fn(async () => record),
      list: vi.fn(async () => [record]),
      events: vi.fn(async () => []),
      cancel: vi.fn(async () => ({ ...record, status: "cancelled" as const })),
    };
    const projectId = "00000000-0000-4000-8000-000000000201";
    const projects = { create: vi.fn(), list: vi.fn(), detail: vi.fn(), context: vi.fn(async () => "Active Barlas project: Launch."), attach: vi.fn(async () => ({ projectId, type: "agent_run" as const, id: record.id, label: "Run durably", createdAt: record.createdAt })), snapshot: vi.fn(), restore: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), createStep: vi.fn(), updateStep: vi.fn(), checkpoint: vi.fn(), recordRunResult: vi.fn() };
    const app = await buildApp({ apiToken, ...deps, agentRuntime, projects });
    const response = await app.inject({
      method: "POST",
      url: "/v1/agent/run",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { userId: "user-1", projectId, messages: [{ role: "user", content: "Run durably" }] },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ runId: record.id, status: "queued" });
    expect(agentRuntime.enqueue).toHaveBeenCalledOnce();
    expect(agentRuntime.enqueue).toHaveBeenCalledWith(expect.objectContaining({ messages: expect.arrayContaining([{ role: "system", content: "Active Barlas project: Launch." }]) }));
    expect(projects.attach).toHaveBeenCalledWith("user-1", projectId, "agent_run", record.id, "Run durably");
    await app.close();
  });

  it("stores explicit long-term memory", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/memory",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        content: "The product name is Barlas AI Agent",
        category: "product",
        importance: 10,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().memory.content).toBe("The product name is Barlas AI Agent");
    expect(deps.database.remember).toHaveBeenCalledOnce();
    await app.close();
  });

  it("accepts authenticated Telegram updates", async () => {
    const deps = dependencies();
    const sendMessage = vi.fn(async () => undefined);
    const app = await buildApp({
      apiToken,
      ...deps,
      telegram: {
        webhookSecret: "t".repeat(32),
        client: { sendMessage },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/channels/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "t".repeat(32) },
      payload: {
        update_id: 1,
        message: {
          message_id: 2,
          text: "Hello",
          chat: { id: 42 },
          from: { id: 7 },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(42, "Hello from Barlas AI Agent");
    await app.close();
  });

  it("queues Telegram messages in the durable autonomous runtime", async () => {
    const deps = dependencies();
    const sendMessage = vi.fn(async () => undefined);
    const queued = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: "telegram:7",
      conversationId: "00000000-0000-4000-8000-000000000001",
      status: "queued" as const,
      messages: [{ role: "user" as const, content: "Do it" }],
      conversationMessages: [{ role: "user" as const, content: "Do it" }],
      delivery: { channel: "telegram" as const, chatId: 42 },
      taskClass: "fast" as const,
      maxSteps: 8,
      scheduledFor: "2026-10-16T00:00:00.000Z",
      attempts: 0,
      maxAttempts: 3,
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    };
    const agentRuntime = {
      start: vi.fn(),
      enqueue: vi.fn(async () => queued),
      resume: vi.fn(),
      resumeByApproval: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      events: vi.fn(),
      cancel: vi.fn(),
    };
    const app = await buildApp({
      apiToken,
      ...deps,
      agentRuntime,
      telegram: { webhookSecret: "t".repeat(32), client: { sendMessage } },
    });
    const response = await app.inject({
      method: "POST",
      url: "/channels/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "t".repeat(32) },
      payload: {
        update_id: 2,
        message: { message_id: 3, text: "Do it", chat: { id: 42 }, from: { id: 7 } },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runId).toBe(queued.id);
    expect(agentRuntime.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "telegram:7",
      delivery: { channel: "telegram", chatId: 42 },
    }));
    expect(sendMessage).toHaveBeenCalledWith(42, expect.stringContaining("Задача принята"));
    await app.close();
  });

  it("turns explicit Telegram call commands into voice-delivered agent runs", async () => {
    const deps = dependencies();
    const sendMessage = vi.fn(async () => undefined);
    const queued = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: "telegram:7",
      conversationId: "00000000-0000-4000-8000-000000000001",
      status: "queued" as const,
      messages: [{ role: "user" as const, content: "Explain the release" }],
      conversationMessages: [{ role: "user" as const, content: "Explain the release" }],
      delivery: { channel: "telegram" as const, chatId: 42, voice: true },
      taskClass: "fast" as const,
      maxSteps: 8,
      scheduledFor: "2026-10-16T00:00:00.000Z",
      attempts: 0,
      maxAttempts: 3,
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    };
    const agentRuntime = {
      start: vi.fn(), enqueue: vi.fn(async () => queued), resume: vi.fn(), resumeByApproval: vi.fn(),
      get: vi.fn(), list: vi.fn(), events: vi.fn(), cancel: vi.fn(),
    };
    const app = await buildApp({
      apiToken,
      ...deps,
      agentRuntime,
      telegram: { webhookSecret: "t".repeat(32), client: { sendMessage } },
    });

    const response = await app.inject({
      method: "POST",
      url: "/channels/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "t".repeat(32) },
      payload: { update_id: 3, message: { message_id: 4, text: "/call Explain the release", chat: { id: 42 }, from: { id: 7 } } },
    });

    expect(response.statusCode).toBe(200);
    expect(agentRuntime.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([{ role: "user", content: "Explain the release" }]),
      conversationMessages: [{ role: "user", content: "Explain the release" }],
      delivery: { channel: "telegram", chatId: 42, voice: true },
    }));
    expect(sendMessage).toHaveBeenCalledWith(42, expect.stringContaining("Голосовой ответ готовится"));
    await app.close();
  });

  it("explains the native Telegram call limitation when no voice prompt is supplied", async () => {
    const deps = dependencies();
    const sendMessage = vi.fn(async () => undefined);
    const app = await buildApp({
      apiToken,
      ...deps,
      telegram: { webhookSecret: "t".repeat(32), client: { sendMessage } },
    });
    const response = await app.inject({
      method: "POST",
      url: "/channels/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "t".repeat(32) },
      payload: { update_id: 4, message: { message_id: 5, text: "/call", chat: { id: 42 }, from: { id: 7 } } },
    });

    expect(response.json()).toMatchObject({ ok: true, voiceHelp: true });
    expect(sendMessage).toHaveBeenCalledWith(42, expect.stringContaining("не позволяет боту начать нативный звонок"));
    await app.close();
  });

  it("creates durable jobs with an audit event", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        userId: "user-1",
        jobType: "agent.run",
        input: { objective: "Research AI agents" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().job.status).toBe("queued");
    expect(deps.database.appendAudit).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns HTTP 429 when a daily quota is exhausted", async () => {
    const deps = dependencies();
    const governance = new RuntimeGovernance({
      consumeQuota: vi.fn(async ({ limit }) => ({ allowed: false, used: limit, limit })),
      appendTrace: vi.fn(async () => undefined),
      listTraces: vi.fn(async () => []),
    }, { chat: 1, tool: 1, job: 1 });
    const app = await buildApp({ apiToken, ...deps, governance });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { userId: "user-1", messages: [{ role: "user", content: "Hello" }] },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: "Quota exceeded",
      category: "chat",
      used: 1,
      limit: 1,
    });
    expect(deps.modelProvider.generate).not.toHaveBeenCalled();
    await app.close();
  });

  it("prevents a user session from accessing another user's data", async () => {
    const deps = dependencies();
    const authService = {
      authenticate: vi.fn(async () => ({
        id: "account-1",
        email: "user@example.com",
        displayName: "User",
        role: "user" as const,
        active: true,
        languageCode: null,
        languageConfigured: false,
        createdAt: "2026-10-16T00:00:00.000Z",
      })),
      login: vi.fn(),
      logout: vi.fn(async () => undefined),
      listAccounts: vi.fn(async () => []),
      createAccount: vi.fn(),
      issuePasswordReset: vi.fn(),
      resetPassword: vi.fn(async () => undefined),
      getAccount: vi.fn(async () => null),
      setLanguage: vi.fn(),
    };
    const app = await buildApp({ apiToken, ...deps, authService });
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat",
      headers: { authorization: "Bearer user-session-token-which-is-long-enough" },
      payload: { userId: "account-2", messages: [{ role: "user", content: "Hello" }] },
    });

    expect(response.statusCode).toBe(403);
    expect(deps.modelProvider.generate).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns the operations dashboard for an authenticated user", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps, runtimeInfo: { workerEnabled: true } });
    const response = await app.inject({
      method: "GET",
      url: "/v1/dashboard?userId=user-1",
      headers: { authorization: `Bearer ${apiToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      workerEnabled: true,
      stats: { conversations: 0, totalTokens: 0, estimatedCostUsd: 0 },
    });
    expect(deps.database.getDashboardStats).toHaveBeenCalledWith("user-1");
    await app.close();
  });

  it("exposes deployment metrics only to an owner or service token", async () => {
    const deps = dependencies();
    const userAccount = {
      id: "00000000-0000-4000-8000-000000000098",
      email: "user@example.com",
      displayName: "User",
      role: "user" as const,
      active: true,
      languageCode: "en" as const,
      languageConfigured: true,
      createdAt: "2026-10-16T00:00:00.000Z",
    };
    const authService = {
      authenticate: vi.fn(async (token: string) => token === "user-session-token-which-is-long-enough" ? userAccount : null),
      logout: vi.fn(),
      listAccounts: vi.fn(),
      createAccount: vi.fn(),
      getAccount: vi.fn(),
      setLanguage: vi.fn(),
    };
    const app = await buildApp({ apiToken, ...deps, authService, runtimeInfo: { workerEnabled: true } });
    const ownerResponse = await app.inject({
      method: "GET",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${apiToken}` },
    });
    const userResponse = await app.inject({
      method: "GET",
      url: "/v1/metrics",
      headers: { authorization: "Bearer user-session-token-which-is-long-enough" },
    });

    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.headers["content-type"]).toContain("text/plain");
    expect(ownerResponse.body).toContain("barlas_up 1");
    expect(ownerResponse.body).toContain("barlas_worker_enabled 1");
    expect(userResponse.statusCode).toBe(403);
    expect(deps.database.getDashboardStats).toHaveBeenCalledWith();
    await app.close();
  });

  it("lists the authenticated user's approval queue", async () => {
    const deps = dependencies();
    const app = await buildApp({ apiToken, ...deps });
    const response = await app.inject({
      method: "GET",
      url: "/v1/approvals?userId=user-1",
      headers: { authorization: `Bearer ${apiToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ approvals: [] });
    expect(deps.database.listApprovals).toHaveBeenCalledWith("user-1", 30);
    await app.close();
  });

  it("accepts one bounded multipart media upload and records metadata-only audit", async () => {
    const deps = dependencies();
    const media = {
      saveUpload: vi.fn(async () => ({
        path: "media/photo.png", bytes: 12, kind: "image" as const, mimeType: "image/png",
      })),
    };
    const app = await buildApp({ apiToken, ...deps, media });
    const boundary = "barlas-media-boundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/v1/media/upload?userId=user-1&path=media%2Fphoto.png",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ media: expect.objectContaining({ path: "media/photo.png", mimeType: "image/png" }) });
    expect(media.saveUpload).toHaveBeenCalledWith("user-1", "media/photo.png", expect.any(Buffer), "image/png");
    expect(deps.database.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1", eventType: "media.uploaded", details: expect.not.objectContaining({ content: expect.anything() }),
    }));
    await app.close();
  });

  it("lists, uploads, and downloads only through the authenticated workspace", async () => {
    const deps = dependencies();
    const workspace = {
      list: vi.fn(async () => [{ path: "projects/report.md", type: "file" as const }]),
      writeUpload: vi.fn(async () => ({ path: "projects/report.md", bytes: 6 })),
      readBuffer: vi.fn(async () => ({ path: "projects/report.md", content: Buffer.from("report") })),
    };
    const app = await buildApp({ apiToken, ...deps, workspace });
    const auth = { authorization: `Bearer ${apiToken}` };
    const listed = await app.inject({ method: "GET", url: "/v1/files?userId=user-1&path=projects", headers: auth });
    const boundary = "barlas-file-boundary";
    const uploaded = await app.inject({ method: "POST", url: "/v1/files/upload?userId=user-1&path=projects%2Freport.md&overwrite=false", headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="report.md"\r\nContent-Type: text/markdown\r\n\r\nreport\r\n--${boundary}--\r\n`) });
    const downloaded = await app.inject({ method: "GET", url: "/v1/files/download?userId=user-1&path=projects%2Freport.md", headers: auth });
    expect(listed.json()).toEqual({ files: [{ path: "projects/report.md", type: "file" }] });
    expect(uploaded.statusCode).toBe(201);
    expect(workspace.writeUpload).toHaveBeenCalledWith("user-1", "projects/report.md", Buffer.from("report"), false);
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-disposition"]).toContain("attachment;");
    expect(downloaded.rawPayload).toEqual(Buffer.from("report"));
    expect(deps.database.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "file.downloaded", details: expect.not.objectContaining({ content: expect.anything() }) }));
    await app.close();
  });

  it("creates an owned project and returns its linked resources and artifact versions", async () => {
    const deps = dependencies();
    const project = { id: "00000000-0000-4000-8000-000000000201", userId: "user-1", name: "Launch", description: "Ship", status: "active" as const, createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z" };
    const goal = { id: "00000000-0000-4000-8000-000000000202", projectId: project.id, title: "Release", description: "Closed alpha", status: "planned" as const, priority: 5, createdAt: project.createdAt, updatedAt: project.updatedAt };
    const projects = { create: vi.fn(async () => project), list: vi.fn(async () => [project]), detail: vi.fn(async () => ({ project, resources: [], artifacts: [], goals: [], steps: [], checkpoints: [] })), context: vi.fn(async () => "Active Barlas project: Launch."), attach: vi.fn(), snapshot: vi.fn(), restore: vi.fn(), createGoal: vi.fn(async () => goal), updateGoal: vi.fn(), createStep: vi.fn(), updateStep: vi.fn(), checkpoint: vi.fn(), recordRunResult: vi.fn() };
    const app = await buildApp({ apiToken, ...deps, projects }); const auth = { authorization: `Bearer ${apiToken}` };
    const created = await app.inject({ method: "POST", url: "/v1/projects", headers: auth, payload: { userId: "user-1", name: "Launch", description: "Ship" } });
    const detail = await app.inject({ method: "GET", url: `/v1/projects/${project.id}?userId=user-1`, headers: auth });
    const createdGoal = await app.inject({ method: "POST", url: `/v1/projects/${project.id}/goals`, headers: auth, payload: { userId: "user-1", title: "Release", description: "Closed alpha", priority: 5 } });
    expect(created.statusCode).toBe(201); expect(created.json()).toEqual({ project });
    expect(detail.json()).toEqual({ project, resources: [], artifacts: [], goals: [], steps: [], checkpoints: [] });
    expect(createdGoal.statusCode).toBe(201); expect(createdGoal.json()).toEqual({ goal });
    expect(deps.database.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "project.created", resourceId: project.id }));
    await app.close();
  });

  it("creates and lists an owned recurring autonomous schedule", async () => {
    const deps = dependencies();
    const schedule = {
      id: "00000000-0000-4000-8000-000000000111", userId: "user-1", name: "Brief", objective: "Prepare brief",
      cronExpression: "0 9 * * *", timezone: "Asia/Tashkent", taskClass: "deep" as const, maxSteps: 8,
      maxTotalTokens: 50_000, deliveryChannel: "web" as const, status: "active" as const,
      nextRunAt: "2026-10-17T04:00:00.000Z", createdAt: "2026-10-16T00:00:00.000Z",
    };
    const schedules = { create: vi.fn(async () => schedule), list: vi.fn(async () => [schedule]), pause: vi.fn(), resume: vi.fn(), disable: vi.fn() };
    const app = await buildApp({ apiToken, ...deps, schedules });
    const created = await app.inject({ method: "POST", url: "/v1/schedules", headers: { authorization: `Bearer ${apiToken}` }, payload: {
      userId: "user-1", name: "Brief", objective: "Prepare brief", cronExpression: "0 9 * * *", timezone: "Asia/Tashkent",
    } });
    const listed = await app.inject({ method: "GET", url: "/v1/schedules?userId=user-1", headers: { authorization: `Bearer ${apiToken}` } });
    expect(created.statusCode).toBe(201);
    expect(created.json().schedule.id).toBe(schedule.id);
    expect(listed.json()).toEqual({ schedules: [schedule] });
    expect(deps.database.appendAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "schedule.created" }));
    await app.close();
  });
});
