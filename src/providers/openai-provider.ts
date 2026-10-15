import OpenAI from "openai";

import type { GenerateRequest, GenerateResult, ModelProvider } from "../core/models.js";

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.client.responses.create({
      model: this.model,
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
      model: this.model,
      responseId: response.id,
    };
  }
}

