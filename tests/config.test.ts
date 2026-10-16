import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgresql://barlas:barlas@database/barlas",
  BARLAS_API_TOKEN: "a".repeat(32), BARLAS_GATEWAY_TOKEN: "g".repeat(32),
  MODEL_NAME: "model-test", MODEL_API_KEY: "model-key",
};

describe("Barlas configuration", () => {
  it("accepts Anthropic as a native text and tool provider", () => {
    expect(loadConfig({ ...base, MODEL_PROVIDER: "anthropic" }).MODEL_PROVIDER).toBe("anthropic");
  });

  it("accepts keyless local Ollama models", () => {
    const config = loadConfig({ ...base, MODEL_PROVIDER: "ollama", MODEL_API_KEY: "", MODEL_NAME: "qwen3:8b" });
    expect(config.MODEL_PROVIDER).toBe("ollama");
    expect(config.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
  });

  it("still requires credentials for hosted model providers", () => {
    expect(() => loadConfig({ ...base, MODEL_PROVIDER: "openai", MODEL_API_KEY: "" })).toThrow(/MODEL_API_KEY/u);
  });

  it("requires an explicit OpenAI vision model when Anthropic media is enabled", () => {
    expect(() => loadConfig({ ...base, MODEL_PROVIDER: "anthropic", MEDIA_API_KEY: "openai-key" }))
      .toThrow(/VISION_MODEL/u);
    expect(loadConfig({ ...base, MODEL_PROVIDER: "anthropic", MEDIA_API_KEY: "openai-key", VISION_MODEL: "gpt-4.1-mini" }).MEDIA_API_KEY)
      .toBe("openai-key");
  });
});
