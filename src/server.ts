import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import { Database } from "./storage/database.js";

const config = loadConfig();
const database = new Database(config.DATABASE_URL);
const modelProvider = new OpenAIProvider(config.MODEL_API_KEY, config.MODEL_NAME);
const app = await buildApp({
  apiToken: config.BARLAS_API_TOKEN,
  database,
  modelProvider,
  logger: true,
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "Barlas AI Agent is shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });

