import { buildApp } from "./app.js";
import { AuthService } from "./auth/service.js";
import { TelegramLinkService } from "./auth/telegram-link.js";
import { TelegramClient } from "./channels/telegram.js";
import { GitHubConnector } from "./connectors/github.js";
import { GoogleConnector } from "./connectors/google.js";
import { McpConnector } from "./connectors/mcp.js";
import { ConnectorService, ConnectorVault } from "./connectors/vault.js";
import { loadConfig } from "./config.js";
import { ModelRouter } from "./core/model-router.js";
import { AgentLoop } from "./core/agent-loop.js";
import { SubagentCoordinator } from "./core/subagents.js";
import { PersistentAgentRuntime } from "./runs/runtime.js";
import { AgentRunWorker } from "./runs/worker.js";
import { RuntimeGovernance } from "./governance/runtime.js";
import { createAgentJobHandler } from "./jobs/agent-handler.js";
import { JobWorker } from "./jobs/worker.js";
import { createWorkflowJobHandler } from "./jobs/workflow-handler.js";
import { OpenAIEmbeddingProvider, SemanticMemory } from "./memory/semantic.js";
import { OrganizationService } from "./organizations/service.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import { Database } from "./storage/database.js";
import { createBuiltinSkillRegistry } from "./skills/registry.js";
import { SkillManager } from "./skills/manager.js";
import { createBuiltinToolRegistry } from "./tools/builtins.js";
import { ToolExecutor } from "./tools/executor.js";
import { ManagedBrowser } from "./tools/managed-browser.js";
import { CodeSandboxClient } from "./tools/code-sandbox.js";
import { FileWorkspace } from "./tools/file-workspace.js";
import { ProjectService } from "./projects/service.js";
import { MediaService, OpenAIMediaModel } from "./tools/media.js";
import { ScheduleService } from "./schedules/service.js";
import { ScheduleWorker } from "./schedules/worker.js";
import { languageInstruction } from "./i18n/languages.js";

const config = loadConfig();
const database = new Database(config.DATABASE_URL);
const authService = new AuthService(database, config.SESSION_TTL_HOURS);
const telegramLinks = new TelegramLinkService(database);
const connectors = config.CONNECTOR_VAULT_KEY
  ? new ConnectorService(
      database,
      new ConnectorVault(config.CONNECTOR_VAULT_KEY, config.CONNECTOR_VAULT_KEY_VERSION),
    )
  : undefined;
const githubConnector = connectors ? new GitHubConnector(connectors) : undefined;
const googleConnector = connectors ? new GoogleConnector(connectors) : undefined;
const mcpConnector = connectors ? new McpConnector(connectors) : undefined;
if (config.OWNER_EMAIL && config.OWNER_PASSWORD) {
  await authService.bootstrapOwner({
    email: config.OWNER_EMAIL,
    password: config.OWNER_PASSWORD,
    displayName: config.OWNER_DISPLAY_NAME,
    ...(config.OWNER_LANGUAGE ? { languageCode: config.OWNER_LANGUAGE } : {}),
  });
}
const fastProvider = new OpenAIProvider({
  apiKey: config.MODEL_API_KEY,
  model: config.MODEL_NAME,
  inputUsdPerMillion: config.MODEL_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: config.MODEL_OUTPUT_USD_PER_MILLION,
});
const deepProvider = new OpenAIProvider({
  apiKey: config.MODEL_API_KEY,
  model: config.DEEP_MODEL_NAME ?? config.MODEL_NAME,
  inputUsdPerMillion: config.DEEP_MODEL_INPUT_USD_PER_MILLION ?? config.MODEL_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: config.DEEP_MODEL_OUTPUT_USD_PER_MILLION ?? config.MODEL_OUTPUT_USD_PER_MILLION,
});
const privateProvider = config.PRIVATE_MODEL_BASE_URL &&
  config.PRIVATE_MODEL_NAME &&
  config.PRIVATE_MODEL_API_KEY
  ? new OpenAIProvider({
      apiKey: config.PRIVATE_MODEL_API_KEY,
      model: config.PRIVATE_MODEL_NAME,
      baseURL: config.PRIVATE_MODEL_BASE_URL,
      providerName: "private-openai-compatible",
      inputUsdPerMillion: config.PRIVATE_MODEL_INPUT_USD_PER_MILLION,
      outputUsdPerMillion: config.PRIVATE_MODEL_OUTPUT_USD_PER_MILLION,
    })
  : fastProvider;
const modelProvider = new ModelRouter({
  fast: fastProvider,
  deep: deepProvider,
  private: privateProvider,
});
const memory = new SemanticMemory(
  database,
  config.EMBEDDING_MODEL
    ? new OpenAIEmbeddingProvider({ apiKey: config.MODEL_API_KEY, model: config.EMBEDDING_MODEL })
    : undefined,
);
const organizations = new OrganizationService(database);
const skillRegistry = createBuiltinSkillRegistry();
const subagentCoordinator = new SubagentCoordinator(modelProvider);
const codeSandbox = config.SANDBOX_SOCKET_PATH && config.SANDBOX_SHARED_TOKEN
  ? new CodeSandboxClient(config.SANDBOX_SOCKET_PATH, config.SANDBOX_SHARED_TOKEN)
  : undefined;
const workspace = new FileWorkspace(config.WORKSPACE_ROOT);
const projects = new ProjectService(database, workspace);
const mediaService = new MediaService(
  workspace,
  new OpenAIMediaModel({
    apiKey: config.MODEL_API_KEY,
    visionModel: config.VISION_MODEL ?? config.MODEL_NAME,
    transcriptionModel: config.TRANSCRIPTION_MODEL,
    speechModel: config.SPEECH_MODEL,
  }),
);
const governance = new RuntimeGovernance(database, {
  chat: config.DAILY_CHAT_QUOTA,
  tool: config.DAILY_TOOL_QUOTA,
  job: config.DAILY_JOB_QUOTA,
});
const toolExecutor = new ToolExecutor(createBuiltinToolRegistry({
  workspaceRoot: config.WORKSPACE_ROOT,
  ...(config.SEARXNG_BASE_URL ? { searxngBaseUrl: config.SEARXNG_BASE_URL } : {}),
  ...(config.BROWSER_WS_ENDPOINT ? { managedBrowser: new ManagedBrowser(config.BROWSER_WS_ENDPOINT) } : {}),
  subagentCoordinator,
  ...(codeSandbox ? { codeSandbox } : {}),
  ...(githubConnector ? { githubConnector } : {}),
  ...(googleConnector ? { googleConnector } : {}),
  ...(mcpConnector ? { mcpConnector } : {}),
  mediaService,
  projectService: projects,
}), database, governance);
const skillManager = new SkillManager(
  database,
  skillRegistry,
  modelProvider,
  () => toolExecutor.listTools().map((tool) => tool.name),
);
await skillManager.load();
const agentLoop = new AgentLoop(
  modelProvider,
  toolExecutor,
  config.AGENT_MAX_STEPS,
  config.AGENT_MAX_TOTAL_TOKENS,
  config.AGENT_MAX_OUTPUT_TOKENS_PER_STEP,
);
const agentRuntime = new PersistentAgentRuntime(agentLoop, database);
const schedules = new ScheduleService(database);
for (const recovered of await agentRuntime.recoverReady()) {
  if (recovered.result && recovered.status !== "waiting_approval") {
    await database.saveTurn({
      userId: recovered.userId,
      conversationId: recovered.conversationId,
      messages: [],
      result: recovered.result.result,
    });
    await projects.recordRunResult(recovered);
  }
}
const telegram = config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_WEBHOOK_SECRET
  ? {
      webhookSecret: config.TELEGRAM_WEBHOOK_SECRET,
      client: new TelegramClient(config.TELEGRAM_BOT_TOKEN),
    }
  : undefined;
const scheduleWorker = new ScheduleWorker(database, agentRuntime, {
  pollIntervalMs: config.JOB_WORKER_POLL_MS,
  batchSize: config.JOB_WORKER_BATCH_SIZE,
  leaseSeconds: config.JOB_LEASE_SECONDS,
  telegramChatForUser: async (userId) => (await telegramLinks.get(userId))?.telegramChatId ?? null,
  governance,
  contextForSchedule: async (schedule) => {
    const account = await authService.getAccount(schedule.userId);
    const language = languageInstruction(account?.languageCode);
    const memories = await memory.recall(schedule.userId, schedule.objective, 5);
    return [
      ...(language ? [{ role: "system" as const, content: language }] : []),
      ...(memories.length ? [{ role: "system" as const, content: [
        "Use these Barlas AI Agent user memories only when relevant:",
        ...memories.map((item) => `- [${item.category}] ${item.content}`),
      ].join("\n") }] : []),
    ];
  },
  onError: (error) => console.error("Barlas AI Agent schedule worker error", error),
});
const agentRunWorker = new AgentRunWorker(database, agentRuntime, {
  pollIntervalMs: config.AGENT_RUN_WORKER_POLL_MS,
  batchSize: config.AGENT_RUN_WORKER_BATCH_SIZE,
  leaseSeconds: config.AGENT_RUN_LEASE_SECONDS,
  onFinished: async (run) => {
    if (!run.result) return;
    await database.saveTurn({
      userId: run.userId,
      conversationId: run.conversationId,
      messages: run.conversationMessages,
      result: run.result.result,
    });
    await projects.recordRunResult(run);
    if (run.delivery?.channel === "telegram" && telegram) {
      if (run.status === "waiting_approval" && run.pendingApprovalId) {
        await telegram.client.sendApproval(
          run.delivery.chatId,
          run.result.text,
          run.pendingApprovalId,
        );
      } else {
        await telegram.client.sendMessage(run.delivery.chatId, run.result.text);
      }
    }
  },
  onError: (error) => console.error("Barlas AI Agent autonomous run worker error", error),
});
const jobWorker = new JobWorker(database, {
  pollIntervalMs: config.JOB_WORKER_POLL_MS,
  batchSize: config.JOB_WORKER_BATCH_SIZE,
  leaseSeconds: config.JOB_LEASE_SECONDS,
  governance,
  onError: (error) => console.error("Barlas AI Agent job worker error", error),
});
jobWorker.register("agent.run", createAgentJobHandler(modelProvider));
jobWorker.register("agent.workflow", createWorkflowJobHandler(modelProvider, skillRegistry));
const app = await buildApp({
  apiToken: config.BARLAS_API_TOKEN,
  database,
  modelProvider,
  agentLoop,
  agentRuntime,
  toolExecutor,
  skillRegistry,
  skillManager,
  governance,
  authService,
  telegramLinks,
  memory,
  organizations,
  media: mediaService,
  workspace,
  projects,
  schedules,
  ...(connectors && githubConnector && googleConnector ? { connectors, githubConnector, googleConnector } : {}),
  webRoot: config.WEB_ROOT,
  runtimeInfo: { workerEnabled: config.JOB_WORKER_ENABLED },
  ...(telegram ? { telegram } : {}),
  logger: true,
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "Barlas AI Agent is shutting down");
  await jobWorker.stop();
  await agentRunWorker.stop();
  await scheduleWorker.stop();
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
if (config.JOB_WORKER_ENABLED) jobWorker.start();
if (config.AGENT_RUN_WORKER_ENABLED) agentRunWorker.start();
if (config.JOB_WORKER_ENABLED) scheduleWorker.start();
