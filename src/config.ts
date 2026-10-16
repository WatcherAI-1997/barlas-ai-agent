import { z } from "zod";

import { isSupportedLanguage, type SupportedLanguageCode } from "./i18n/languages.js";

const configSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.literal("Barlas AI Agent").default("Barlas AI Agent"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1024).max(65535).default(17840),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  BARLAS_API_TOKEN: z.string().min(32),
  BARLAS_GATEWAY_TOKEN: z.string().min(32),
  MODEL_PROVIDER: z.enum(["openai", "anthropic", "ollama"]).default("openai"),
  MODEL_NAME: z.string().min(1),
  MODEL_API_KEY: z.string().default(""),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  MEDIA_API_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  VISION_MODEL: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(1).optional(),
  ),
  TRANSCRIPTION_MODEL: z.string().min(1).default("gpt-4o-mini-transcribe"),
  SPEECH_MODEL: z.string().min(1).default("gpt-4o-mini-tts"),
  EMBEDDING_MODEL: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  DEEP_MODEL_NAME: z.string().min(1).optional(),
  PRIVATE_MODEL_BASE_URL: z.string().url().optional(),
  PRIVATE_MODEL_NAME: z.string().min(1).optional(),
  PRIVATE_MODEL_API_KEY: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32).optional(),
  TELEGRAM_POLLING_ENABLED: z.stringbool().default(false),
  TELEGRAM_BOT_API_BASE_URL: z.string().url().default("https://api.telegram.org"),
  TELEGRAM_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).max(2_000_000_000).default(50_000_000),
  CONNECTOR_VAULT_KEY: z.string().optional(),
  CONNECTOR_VAULT_KEY_VERSION: z.coerce.number().int().min(1).max(1_000_000).default(1),
  JOB_WORKER_ENABLED: z.stringbool().default(true),
  JOB_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  JOB_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(32).default(4),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  WORKSPACE_ROOT: z.string().min(1).default("/var/lib/barlas/workspaces"),
  MAX_WORKSPACE_FILE_BYTES: z.coerce.number().int().min(1_000_000).max(10_000_000_000_000).default(2_000_000_000),
  SEARXNG_BASE_URL: z.string().url().optional(),
  BROWSER_WS_ENDPOINT: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(1).optional(),
  ),
  SANDBOX_SOCKET_PATH: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(1).optional(),
  ),
  SANDBOX_SHARED_TOKEN: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(32).optional(),
  ),
  DAILY_CHAT_QUOTA: z.coerce.number().int().min(1).max(100_000).default(500),
  DAILY_TOOL_QUOTA: z.coerce.number().int().min(1).max(100_000).default(1_000),
  DAILY_JOB_QUOTA: z.coerce.number().int().min(1).max(10_000).default(100),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(12).default(8),
  AGENT_MAX_TOTAL_TOKENS: z.coerce.number().int().min(1_000).max(1_000_000).default(50_000),
  AGENT_MAX_OUTPUT_TOKENS_PER_STEP: z.coerce.number().int().min(128).max(100_000).default(4_096),
  AGENT_RUN_WORKER_ENABLED: z.stringbool().default(true),
  AGENT_RUN_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  AGENT_RUN_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(16).default(2),
  AGENT_RUN_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_DISPLAY_NAME: z.string().min(2).max(100).default("Barlas Owner"),
  OWNER_LANGUAGE: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string()
      .refine(isSupportedLanguage, "OWNER_LANGUAGE is not supported")
      .transform((value) => value as SupportedLanguageCode)
      .optional(),
  ),
  WEB_ROOT: z.string().min(1).default("/app/web"),
  MODEL_INPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
  MODEL_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
  DEEP_MODEL_INPUT_USD_PER_MILLION: z.coerce.number().min(0).optional(),
  DEEP_MODEL_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).optional(),
  PRIVATE_MODEL_INPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
  PRIVATE_MODEL_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0),
}).superRefine((config, context) => {
  if (config.MODEL_PROVIDER !== "ollama" && !config.MODEL_API_KEY) {
    context.addIssue({ code: "custom", message: "MODEL_API_KEY is required for OpenAI and Anthropic" });
  }
  const telegramFields = [config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_WEBHOOK_SECRET];
  if (telegramFields.some(Boolean) && !telegramFields.every(Boolean)) {
    context.addIssue({
      code: "custom",
      message: "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be configured together",
    });
  }
  if (config.TELEGRAM_POLLING_ENABLED && !config.TELEGRAM_BOT_TOKEN) {
    context.addIssue({ code: "custom", message: "TELEGRAM_BOT_TOKEN is required when Telegram polling is enabled" });
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

  if (config.APP_ENV === "production" && !config.OWNER_EMAIL) {
    context.addIssue({ code: "custom", message: "OWNER_EMAIL is required in production" });
  }

  if (Boolean(config.SANDBOX_SOCKET_PATH) !== Boolean(config.SANDBOX_SHARED_TOKEN)) {
    context.addIssue({
      code: "custom",
      message: "SANDBOX_SOCKET_PATH and SANDBOX_SHARED_TOKEN must be configured together",
    });
  }

  if (config.APP_ENV === "production" && !config.CONNECTOR_VAULT_KEY) {
    context.addIssue({
      code: "custom",
      message: "CONNECTOR_VAULT_KEY is required in production",
    });
  }
  if (config.MODEL_PROVIDER !== "openai" && config.MEDIA_API_KEY && !config.VISION_MODEL) {
    context.addIssue({ code: "custom", message: "VISION_MODEL is required when a non-OpenAI provider uses an OpenAI media key" });
  }
  if (config.EMBEDDING_MODEL && config.MODEL_PROVIDER !== "openai" && !config.MEDIA_API_KEY) {
    context.addIssue({ code: "custom", message: "MEDIA_API_KEY is required for OpenAI embeddings with a non-OpenAI provider" });
  }
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}
