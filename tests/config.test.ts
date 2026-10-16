import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgresql://barlas:barlas@database/barlas",
  BARLAS_API_TOKEN: "a".repeat(32), BARLAS_GATEWAY_TOKEN: "g".repeat(32),
  MODEL_NAME: "model-test", MODEL_API_KEY: "model-key",
};

describe("Barlas configuration", () => {
  it("supports a bounded personal agent identity", () => {
    expect(loadConfig({ ...base })).toMatchObject({ AGENT_NAME: "Barlas", AGENT_STYLE: "balanced", DEFAULT_SPEECH_VOICE: "alloy" });
    expect(loadConfig({ ...base, AGENT_NAME: "Arslan", AGENT_STYLE: "analytical", AGENT_INSTRUCTIONS: "Challenge assumptions." }))
      .toMatchObject({ AGENT_NAME: "Arslan", AGENT_STYLE: "analytical", AGENT_INSTRUCTIONS: "Challenge assumptions." });
    expect(() => loadConfig({ ...base, AGENT_INSTRUCTIONS: "x".repeat(4_001) })).toThrow(/4000/u);
  });

  it("accepts Anthropic as a native text and tool provider", () => {
    expect(loadConfig({ ...base, MODEL_PROVIDER: "anthropic" }).MODEL_PROVIDER).toBe("anthropic");
  });

  it("accepts keyless local Ollama models", () => {
    const config = loadConfig({ ...base, MODEL_PROVIDER: "ollama", MODEL_API_KEY: "", MODEL_NAME: "qwen3:8b" });
    expect(config.MODEL_PROVIDER).toBe("ollama");
    expect(config.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
  });

  it("accepts a browser-authenticated OpenAI account without an API key", () => {
    const config = loadConfig({ ...base, MODEL_PROVIDER: "codex_cli", MODEL_API_KEY: "", MODEL_NAME: "gpt-5.6-sol" });
    expect(config).toMatchObject({ MODEL_PROVIDER: "codex_cli", MODEL_API_KEY: "", MODEL_NAME: "gpt-5.6-sol" });
  });

  it("still requires credentials for hosted model providers", () => {
    expect(() => loadConfig({ ...base, MODEL_PROVIDER: "openai", MODEL_API_KEY: "" })).toThrow(/MODEL_API_KEY/u);
  });

  it("accepts a portable compatible endpoint only with an explicit base URL", () => {
    expect(loadConfig({
      ...base, MODEL_PROVIDER: "openai_compatible", MODEL_BASE_URL: "https://models.example/v1",
    })).toMatchObject({ MODEL_PROVIDER: "openai_compatible", MODEL_BASE_URL: "https://models.example/v1" });
    expect(() => loadConfig({ ...base, MODEL_PROVIDER: "openai_compatible" })).toThrow(/MODEL_BASE_URL/u);
  });

  it("requires an explicit OpenAI vision model when Anthropic media is enabled", () => {
    expect(() => loadConfig({ ...base, MODEL_PROVIDER: "anthropic", MEDIA_API_KEY: "openai-key" }))
      .toThrow(/VISION_MODEL/u);
    expect(loadConfig({ ...base, MODEL_PROVIDER: "anthropic", MEDIA_API_KEY: "openai-key", VISION_MODEL: "gpt-4.1-mini" }).MEDIA_API_KEY)
      .toBe("openai-key");
  });

  it("requires a dedicated token when Discord Gateway is enabled", () => {
    expect(() => loadConfig({ ...base, DISCORD_GATEWAY_ENABLED: "true" })).toThrow(/DISCORD_BOT_TOKEN/u);
    expect(loadConfig({ ...base, DISCORD_GATEWAY_ENABLED: "true", DISCORD_BOT_TOKEN: "d".repeat(32) }))
      .toMatchObject({ DISCORD_GATEWAY_ENABLED: true, DISCORD_BOT_TOKEN: "d".repeat(32) });
  });

  it("requires both Slack tokens when Socket Mode is enabled", () => {
    expect(() => loadConfig({ ...base, SLACK_SOCKET_MODE_ENABLED: "true", SLACK_BOT_TOKEN: "xoxb-" + "b".repeat(24) }))
      .toThrow(/SLACK_APP_TOKEN/u);
    expect(loadConfig({
      ...base, SLACK_SOCKET_MODE_ENABLED: "true",
      SLACK_BOT_TOKEN: "xoxb-" + "b".repeat(24), SLACK_APP_TOKEN: "xapp-" + "a".repeat(24),
    })).toMatchObject({ SLACK_SOCKET_MODE_ENABLED: true });
  });
});
