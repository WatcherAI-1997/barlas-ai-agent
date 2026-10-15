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

    return {
      text: response.output_text,
      provider: this.name,
      model: this.options.model,
      responseId: response.id,
    };
  }
}
