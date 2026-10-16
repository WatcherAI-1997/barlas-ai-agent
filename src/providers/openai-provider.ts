import OpenAI from "openai";

import type { GenerateRequest, GenerateResult, ModelProvider } from "../core/models.js";

export class OpenAIProvider implements ModelProvider {
  readonly name: string;
  private readonly client: OpenAI;

  constructor(private readonly options: {
    apiKey: string;
    model: string;
    baseURL?: string;
    providerName?: string;
    inputUsdPerMillion?: number;
    outputUsdPerMillion?: number;
  }) {
    this.name = options.providerName ?? "openai";
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.responses.create({
      model: this.options.model,
      input: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      metadata: {
        product: "Barlas AI Agent",
        user_id: request.userId,
        conversation_id: request.conversationId,
      },
    });

    const usage = response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
          costUsd: (
            response.usage.input_tokens * (this.options.inputUsdPerMillion ?? 0) +
            response.usage.output_tokens * (this.options.outputUsdPerMillion ?? 0)
          ) / 1_000_000,
        }
      : undefined;
    return {
      text: response.output_text,
      provider: this.name,
      model: this.options.model,
      responseId: response.id,
      ...(usage ? { usage } : {}),
    };
  }
}
