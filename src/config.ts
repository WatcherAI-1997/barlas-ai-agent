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
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}

