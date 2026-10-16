import type { ToolCapableModelProvider } from "../core/models.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { CodexCliProvider } from "./codex-cli-provider.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

export type NativeModelProvider = "codex_cli" | "openai" | "anthropic" | "ollama" | "openai_compatible";

export function createModelProvider(options: {
  provider: NativeModelProvider;
  apiKey: string;
  model: string;
  baseURL?: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}): ToolCapableModelProvider {
  if (options.provider === "codex_cli") return new CodexCliProvider({ model: options.model });
  if (options.provider === "anthropic") return new AnthropicProvider(options);
  if (options.provider === "ollama") return new OllamaProvider(options);
  if (options.provider === "openai_compatible") {
    if (!options.baseURL) throw new Error("baseURL is required for an OpenAI-compatible provider");
    return new OpenAICompatibleProvider({ ...options, baseURL: options.baseURL });
  }
  return new OpenAIProvider(options);
}
