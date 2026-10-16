import { z } from "zod";

const configSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.literal("Barlas AI Agent").default("Barlas AI Agent"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1024).max(65535).default(17840),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  BARLAS_API_TOKEN: z.string().min(32),
  MODEL_PROVIDER: z.enum(["openai"]).default("openai"),
  MODEL_NAME: z.string().min(1),
  MODEL_API_KEY: z.string().min(1),
  DEEP_MODEL_NAME: z.string().min(1).optional(),
  PRIVATE_MODEL_BASE_URL: z.string().url().optional(),
  PRIVATE_MODEL_NAME: z.string().min(1).optional(),
  PRIVATE_MODEL_API_KEY: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32).optional(),
  JOB_WORKER_ENABLED: z.stringbool().default(true),
  JOB_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  JOB_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(32).default(4),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  WORKSPACE_ROOT: z.string().min(1).default("/var/lib/barlas/workspaces"),
  SEARXNG_BASE_URL: z.string().url().optional(),
  DAILY_CHAT_QUOTA: z.coerce.number().int().min(1).max(100_000).default(500),
  DAILY_TOOL_QUOTA: z.coerce.number().int().min(1).max(100_000).default(1_000),
  DAILY_JOB_QUOTA: z.coerce.number().int().min(1).max(10_000).default(100),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(8),
  AGENT_MAX_TOTAL_TOKENS: z.coerce.number().int().min(1_000).max(1_000_000).default(50_000),
  AGENT_MAX_OUTPUT_TOKENS_PER_STEP: z.coerce.number().int().min(128).max(100_000).default(4_096),
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_PASSWORD: z.string().min(12).max(256).optional(),
  OWNER_DISPLAY_NAME: z.string().min(2).max(100).default("Barlas Owner"),
  WEB_ROOT: z.string().min(1).default("/app/web"),
  MODEL_INPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
  MODEL_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
  DEEP_MODEL_INPUT_USD_PER_MILLION: z.coerce.number().min(0).optional(),
  DEEP_MODEL_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).optional(),
  PRIVATE_MODEL_INPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
  PRIVATE_MODEL_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
}).superRefine((config, context) => {
  const telegramFields = [config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_WEBHOOK_SECRET];
  if (telegramFields.some(Boolean) && !telegramFields.every(Boolean)) {
    context.addIssue({
      code: "custom",
      message: "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be configured together",
    });
  }

  const privateModelFields = [
    config.PRIVATE_MODEL_BASE_URL,
    config.PRIVATE_MODEL_NAME,
    config.PRIVATE_MODEL_API_KEY,
  ];
  if (privateModelFields.some(Boolean) && !privateModelFields.every(Boolean)) {
    context.addIssue({
      code: "custom",
      message: "All private model settings must be configured together",
    });
  }

  if (Boolean(config.OWNER_EMAIL) !== Boolean(config.OWNER_PASSWORD)) {
    context.addIssue({
      code: "custom",
      message: "OWNER_EMAIL and OWNER_PASSWORD must be configured together",
    });
  }
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}
