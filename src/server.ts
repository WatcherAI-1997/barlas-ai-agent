import { buildApp } from "./app.js";
import { AuthService } from "./auth/service.js";
import { TelegramLinkService } from "./auth/telegram-link.js";
import { TelegramClient } from "./channels/telegram.js";
import { TelegramPollingWorker } from "./channels/telegram-polling.js";
import { DiscordClient, DiscordGatewayWorker } from "./channels/discord.js";
import { SlackClient, SlackSocketWorker } from "./channels/slack.js";
import { WhatsAppClient } from "./channels/whatsapp.js";
import { sendTelegramVoiceReply, telegramVoiceFallbackText } from "./channels/telegram-voice.js";
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
import { chiefBarlasInstruction } from "./agents/command.js";
import { createBuiltinExtensionCatalog } from "./extensions/catalog.js";
import { DeviceNodeService } from "./nodes/service.js";
import { createModelProvider } from "./providers/factory.js";
import { runRuntimeShutdownHook } from "./runtime-lifecycle.js";
import { AgentProfileService } from "./agents/profiles.js";
import { RuntimeControl } from "./system/runtime-control.js";

const config = loadConfig();
const runtimeControl = new RuntimeControl();
const openAIServiceApiKey = config.MEDIA_API_KEY ?? (config.MODEL_PROVIDER === "openai" ? config.MODEL_API_KEY : undefined);
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
const gatewayOwner = config.OWNER_EMAIL
  ? await authService.bootstrapOwner({
    email: config.OWNER_EMAIL,
    displayName: config.OWNER_DISPLAY_NAME,
    ...(config.OWNER_LANGUAGE ? { languageCode: config.OWNER_LANGUAGE } : {}),
  })
  : undefined;
const fastProvider = createModelProvider({
  provider: config.MODEL_PROVIDER,
  apiKey: config.MODEL_API_KEY,
  model: config.MODEL_NAME,
  ...(config.MODEL_PROVIDER === "ollama" ? { baseURL: config.OLLAMA_BASE_URL } : {}),
  ...(config.MODEL_PROVIDER === "openai_compatible" && config.MODEL_BASE_URL ? { baseURL: config.MODEL_BASE_URL } : {}),
  inputUsdPerMillion: config.MODEL_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: config.MODEL_OUTPUT_USD_PER_MILLION,
});
const deepProvider = createModelProvider({
  provider: config.MODEL_PROVIDER,
  apiKey: config.MODEL_API_KEY,
  model: config.DEEP_MODEL_NAME ?? config.MODEL_NAME,
  ...(config.MODEL_PROVIDER === "ollama" ? { baseURL: config.OLLAMA_BASE_URL } : {}),
  ...(config.MODEL_PROVIDER === "openai_compatible" && config.MODEL_BASE_URL ? { baseURL: config.MODEL_BASE_URL } : {}),
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
  config.EMBEDDING_MODEL && openAIServiceApiKey
    ? new OpenAIEmbeddingProvider({ apiKey: openAIServiceApiKey, model: config.EMBEDDING_MODEL })
    : undefined,
);
const organizations = new OrganizationService(database);
const deviceNodes = new DeviceNodeService(database);
const skillRegistry = createBuiltinSkillRegistry();
const subagentCoordinator = new SubagentCoordinator(modelProvider);
const codeSandbox = config.SANDBOX_SOCKET_PATH && config.SANDBOX_SHARED_TOKEN
  ? new CodeSandboxClient(config.SANDBOX_SOCKET_PATH, config.SANDBOX_SHARED_TOKEN)
  : undefined;
const extensionCatalog = createBuiltinExtensionCatalog({
  browser: Boolean(config.BROWSER_WS_ENDPOINT),
  github: Boolean(githubConnector),
  google: Boolean(googleConnector),
  mcp: Boolean(mcpConnector),
  sandbox: Boolean(codeSandbox),
  telegram: Boolean(config.TELEGRAM_BOT_TOKEN),
  discord: Boolean(config.DISCORD_BOT_TOKEN && config.DISCORD_GATEWAY_ENABLED),
  slack: Boolean(config.SLACK_BOT_TOKEN && config.SLACK_APP_TOKEN && config.SLACK_SOCKET_MODE_ENABLED),
  whatsapp: Boolean(config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_VERIFY_TOKEN && config.WHATSAPP_APP_SECRET),
  privateModel: Boolean(config.PRIVATE_MODEL_BASE_URL && config.PRIVATE_MODEL_NAME && config.PRIVATE_MODEL_API_KEY),
  deviceNodes: true,
  modelProvider: config.MODEL_PROVIDER,
});
const workspace = new FileWorkspace(config.WORKSPACE_ROOT);
const projects = new ProjectService(database, workspace);
const agentProfiles = new AgentProfileService(database);
const mediaService = openAIServiceApiKey ? new MediaService(
  workspace,
  new OpenAIMediaModel({
    apiKey: openAIServiceApiKey,
    visionModel: config.VISION_MODEL ?? config.MODEL_NAME,
    transcriptionModel: config.TRANSCRIPTION_MODEL,
    speechModel: config.SPEECH_MODEL,
  }),
) : undefined;
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
  ...(mediaService ? { mediaService } : {}),
  projectService: projects,
  deviceNodes,
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
      client: new TelegramClient(config.TELEGRAM_BOT_TOKEN, {
        baseUrl: config.TELEGRAM_BOT_API_BASE_URL,
        maxUploadBytes: config.TELEGRAM_MAX_UPLOAD_BYTES,
      }),
    }
  : undefined;
const discord = config.DISCORD_BOT_TOKEN && config.DISCORD_GATEWAY_ENABLED
  ? { gatewaySecret: config.BARLAS_API_TOKEN, client: new DiscordClient(config.DISCORD_BOT_TOKEN) }
  : undefined;
const slack = config.SLACK_BOT_TOKEN && config.SLACK_APP_TOKEN && config.SLACK_SOCKET_MODE_ENABLED
  ? { socketSecret: config.BARLAS_API_TOKEN, client: new SlackClient(config.SLACK_BOT_TOKEN, config.SLACK_APP_TOKEN) }
  : undefined;
const whatsapp = config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_VERIFY_TOKEN && config.WHATSAPP_APP_SECRET
  ? {
      appSecret: config.WHATSAPP_APP_SECRET,
      verifyToken: config.WHATSAPP_VERIFY_TOKEN,
      client: new WhatsAppClient(
        config.WHATSAPP_ACCESS_TOKEN,
        config.WHATSAPP_PHONE_NUMBER_ID,
        config.WHATSAPP_GRAPH_API_BASE_URL,
      ),
    }
  : undefined;
const scheduleWorker = new ScheduleWorker(database, agentRuntime, {
  isPaused: () => runtimeControl.isPaused(),
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
      { role: "system" as const, content: [
        `You are ${config.AGENT_NAME}, the user's Barlas AI agent.`,
        config.AGENT_STYLE === "concise" ? "Prefer short, direct answers unless detail is necessary." :
          config.AGENT_STYLE === "warm" ? "Be warm, patient, and conversational while staying useful." :
            config.AGENT_STYLE === "analytical" ? "Reason carefully, surface assumptions, and favor evidence." :
              config.AGENT_STYLE === "creative" ? "Explore original approaches while remaining accurate and actionable." :
                "Be clear, practical, and appropriately detailed.",
        config.AGENT_INSTRUCTIONS,
      ].filter(Boolean).join("\n") },
      ...(language ? [{ role: "system" as const, content: language }] : []),
      { role: "system" as const, content: chiefBarlasInstruction() },
      ...(memories.length ? [{ role: "system" as const, content: [
        "Use these Barlas AI Agent user memories only when relevant:",
        ...memories.map((item) => `- [${item.category}] ${item.content}`),
      ].join("\n") }] : []),
    ];
  },
  onError: (error) => console.error("Barlas AI Agent schedule worker error", error),
});
const agentRunWorker = new AgentRunWorker(database, agentRuntime, {
  isPaused: () => runtimeControl.isPaused(),
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
      } else if (run.delivery.voice) {
        try {
          if (!mediaService) throw new Error("Voice replies require MEDIA_API_KEY with the selected model provider");
          const voice = await sendTelegramVoiceReply({
            client: telegram.client,
            media: mediaService,
            workspace,
            userId: run.userId,
            chatId: run.delivery.chatId,
            runId: run.id,
            text: run.result.text,
          });
          await database.appendAudit({
            userId: run.userId,
            eventType: "telegram.voice.sent",
            resourceType: "agent_run",
            resourceId: run.id,
            details: voice,
          });
        } catch (error) {
          await database.appendAudit({
            userId: run.userId,
            eventType: "telegram.voice.failed",
            resourceType: "agent_run",
            resourceId: run.id,
            details: { error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
          });
          await telegram.client.sendMessage(
            run.delivery.chatId,
            telegramVoiceFallbackText(run.result.text),
          );
        }
      } else {
        await telegram.client.sendMessage(run.delivery.chatId, run.result.text);
      }
    }
    if (run.delivery?.channel === "discord" && discord) {
      if (run.status === "waiting_approval" && run.pendingApprovalId) {
        await discord.client.sendMessage(
          run.delivery.channelId,
          `${run.result.text}\n\nДля решения: !approve ${run.pendingApprovalId} или !reject ${run.pendingApprovalId}`,
        );
      } else {
        await discord.client.sendMessage(run.delivery.channelId, run.result.text);
      }
    }
    if (run.delivery?.channel === "slack" && slack) {
      if (run.status === "waiting_approval" && run.pendingApprovalId) {
        await slack.client.sendMessage(run.delivery.channelId, `${run.result.text}\n\nДля решения: !approve ${run.pendingApprovalId} или !reject ${run.pendingApprovalId}`);
      } else {
        await slack.client.sendMessage(run.delivery.channelId, run.result.text);
      }
    }
    if (run.delivery?.channel === "whatsapp" && whatsapp) {
      if (run.status === "waiting_approval" && run.pendingApprovalId) {
        await whatsapp.client.sendMessage(run.delivery.recipientId, `${run.result.text}\n\nДля решения: !approve ${run.pendingApprovalId} или !reject ${run.pendingApprovalId}`);
      } else {
        await whatsapp.client.sendMessage(run.delivery.recipientId, run.result.text);
      }
    }
  },
  onError: (error) => console.error("Barlas AI Agent autonomous run worker error", error),
});
const jobWorker = new JobWorker(database, {
  isPaused: () => runtimeControl.isPaused(),
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
  gatewayToken: config.BARLAS_GATEWAY_TOKEN,
  ...(gatewayOwner ? { gatewayOwner } : {}),
  database,
  modelProvider,
  agentLoop,
  agentRuntime,
  toolExecutor,
  skillRegistry,
  skillManager,
  extensionCatalog,
  deviceNodes,
  governance,
  authService,
  telegramLinks,
  memory,
  organizations,
  ...(mediaService ? { media: mediaService } : {}),
  workspace,
  maxWorkspaceFileBytes: config.MAX_WORKSPACE_FILE_BYTES,
  projects,
  agentProfiles,
  schedules,
  ...(connectors && githubConnector && googleConnector ? { connectors, githubConnector, googleConnector } : {}),
  ...(mcpConnector ? { mcpConnector } : {}),
  webRoot: config.WEB_ROOT,
  runtimeInfo: { workerEnabled: config.JOB_WORKER_ENABLED },
  runtimeControl,
  defaultSpeechVoice: config.DEFAULT_SPEECH_VOICE,
  agentIdentity: {
    name: config.AGENT_NAME,
    style: config.AGENT_STYLE,
    ...(config.AGENT_INSTRUCTIONS ? { instructions: config.AGENT_INSTRUCTIONS } : {}),
  },
  ...(telegram ? { telegram } : {}),
  ...(discord ? { discord } : {}),
  ...(slack ? { slack } : {}),
  ...(whatsapp ? { whatsapp } : {}),
  logger: true,
});
const telegramPolling = telegram && config.TELEGRAM_POLLING_ENABLED
  ? new TelegramPollingWorker(
      telegram.client,
      async (update) => {
        const response = await app.inject({
          method: "POST",
          url: "/channels/telegram/webhook",
          headers: { "x-telegram-bot-api-secret-token": telegram.webhookSecret },
          payload: update,
        });
        if (response.statusCode >= 400) {
          throw new Error(`Local Telegram update failed with status ${response.statusCode}`);
        }
      },
      (error) => app.log.error({ error }, "Barlas AI Agent Telegram polling error"),
    )
  : undefined;
const discordGateway = discord && config.DISCORD_BOT_TOKEN
  ? new DiscordGatewayWorker(
      config.DISCORD_BOT_TOKEN,
      async (message) => {
        const response = await app.inject({
          method: "POST", url: "/channels/discord/message",
          headers: { "x-barlas-discord-secret": discord.gatewaySecret }, payload: message,
        });
        if (response.statusCode >= 400) throw new Error(`Local Discord message failed with status ${response.statusCode}`);
      },
      (error) => app.log.error({ error }, "Barlas AI Agent Discord Gateway error"),
    )
  : undefined;
const slackSocket = slack
  ? new SlackSocketWorker(
      slack.client,
      async (message) => {
        const response = await app.inject({
          method: "POST", url: "/channels/slack/message",
          headers: { "x-barlas-slack-secret": slack.socketSecret }, payload: message,
        });
        if (response.statusCode >= 400) throw new Error(`Local Slack message failed with status ${response.statusCode}`);
      },
      (error) => app.log.error({ error }, "Barlas AI Agent Slack Socket Mode error"),
    )
  : undefined;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "Barlas AI Agent is shutting down");
  await telegramPolling?.stop();
  discordGateway?.stop();
  slackSocket?.stop();
  await jobWorker.stop();
  await agentRunWorker.stop();
  await scheduleWorker.stop();
  await app.close();
  await runRuntimeShutdownHook();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
await telegramPolling?.start();
discordGateway?.start();
await slackSocket?.start();
if (config.JOB_WORKER_ENABLED) jobWorker.start();
if (config.AGENT_RUN_WORKER_ENABLED) agentRunWorker.start();
if (config.JOB_WORKER_ENABLED) scheduleWorker.start();
