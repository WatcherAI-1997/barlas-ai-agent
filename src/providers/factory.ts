import type { ToolCapableModelProvider } from "../core/models.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

export type NativeModelProvider = "openai" | "anthropic";

export function createModelProvider(options: {
  provider: NativeModelProvider;
  apiKey: string;
  model: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}): ToolCapableModelProvider {
  if (options.provider === "anthropic") return new AnthropicProvider(options);
  return new OpenAIProvider(options);
}
