import type { ToolCapableModelProvider } from "../core/models.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { OllamaProvider } from "./ollama-provider.js";

export type NativeModelProvider = "openai" | "anthropic" | "ollama";

export function createModelProvider(options: {
  provider: NativeModelProvider;
  apiKey: string;
  model: string;
  baseURL?: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}): ToolCapableModelProvider {
  if (options.provider === "anthropic") return new AnthropicProvider(options);
  if (options.provider === "ollama") return new OllamaProvider(options);
  return new OpenAIProvider(options);
}
