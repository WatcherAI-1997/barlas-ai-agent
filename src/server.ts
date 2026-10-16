import { buildApp } from "./app.js";
import { AuthService } from "./auth/service.js";
import { TelegramClient } from "./channels/telegram.js";
import { loadConfig } from "./config.js";
import { ModelRouter } from "./core/model-router.js";
import { AgentLoop } from "./core/agent-loop.js";
import { RuntimeGovernance } from "./governance/runtime.js";
import { createAgentJobHandler } from "./jobs/agent-handler.js";
import { JobWorker } from "./jobs/worker.js";
import { createWorkflowJobHandler } from "./jobs/workflow-handler.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import { Database } from "./storage/database.js";
import { createBuiltinSkillRegistry } from "./skills/registry.js";
import { createBuiltinToolRegistry } from "./tools/builtins.js";
import { ToolExecutor } from "./tools/executor.js";

const config = loadConfig();
const database = new Database(config.DATABASE_URL);
const authService = new AuthService(database, config.SESSION_TTL_HOURS);
if (config.OWNER_EMAIL && config.OWNER_PASSWORD) {
  await authService.bootstrapOwner({
    email: config.OWNER_EMAIL,
    password: config.OWNER_PASSWORD,
    displayName: config.OWNER_DISPLAY_NAME,
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
const skillRegistry = createBuiltinSkillRegistry();
const governance = new RuntimeGovernance(database, {
  chat: config.DAILY_CHAT_QUOTA,
  tool: config.DAILY_TOOL_QUOTA,
  job: config.DAILY_JOB_QUOTA,
});
const toolExecutor = new ToolExecutor(createBuiltinToolRegistry({
  workspaceRoot: config.WORKSPACE_ROOT,
  ...(config.SEARXNG_BASE_URL ? { searxngBaseUrl: config.SEARXNG_BASE_URL } : {}),
}), database, governance);
const agentLoop = new AgentLoop(
  modelProvider,
  toolExecutor,
  config.AGENT_MAX_STEPS,
  config.AGENT_MAX_TOTAL_TOKENS,
  config.AGENT_MAX_OUTPUT_TOKENS_PER_STEP,
);
const jobWorker = new JobWorker(database, {
  pollIntervalMs: config.JOB_WORKER_POLL_MS,
  batchSize: config.JOB_WORKER_BATCH_SIZE,
  leaseSeconds: config.JOB_LEASE_SECONDS,
  governance,
  onError: (error) => console.error("Barlas AI Agent job worker error", error),
});
jobWorker.register("agent.run", createAgentJobHandler(modelProvider));
jobWorker.register("agent.workflow", createWorkflowJobHandler(modelProvider, skillRegistry));
const telegram = config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_WEBHOOK_SECRET
  ? {
      webhookSecret: config.TELEGRAM_WEBHOOK_SECRET,
      client: new TelegramClient(config.TELEGRAM_BOT_TOKEN),
    }
  : undefined;
const app = await buildApp({
  apiToken: config.BARLAS_API_TOKEN,
  database,
  modelProvider,
  agentLoop,
  toolExecutor,
  skillRegistry,
  governance,
  authService,
  webRoot: config.WEB_ROOT,
  runtimeInfo: { workerEnabled: config.JOB_WORKER_ENABLED },
  ...(telegram ? { telegram } : {}),
  logger: true,
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "Barlas AI Agent is shutting down");
  await jobWorker.stop();
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
if (config.JOB_WORKER_ENABLED) jobWorker.start();
