import OpenAI from "openai";

import type {
  GenerateRequest,
  GenerateResult,
  GenerateToolRequest,
  GenerateToolResult,
  ToolCapableModelProvider,
} from "../core/models.js";

export class OpenAIProvider implements ToolCapableModelProvider {
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
      ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
    });

    const usage = this.mapUsage(response.usage);
    return {
      text: response.output_text,
      provider: this.name,
      model: this.options.model,
      responseId: response.id,
      ...(usage ? { usage } : {}),
    };
  }

  async generateWithTools(request: GenerateToolRequest): Promise<GenerateToolResult> {
    const input = request.toolOutputs?.length
      ? request.toolOutputs.map((item) => ({
          type: "function_call_output" as const,
          call_id: item.callId,
          output: item.output,
        }))
      : request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));
    const response = await this.client.responses.create({
      model: this.options.model,
      input,
      tools: request.tools.map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false,
      })),
      parallel_tool_calls: false,
      ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
      ...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
      metadata: {
        product: "Barlas AI Agent",
        user_id: request.userId,
        conversation_id: request.conversationId,
      },
    });
    const toolCalls = response.output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        callId: item.call_id,
        name: item.name,
        arguments: JSON.parse(item.arguments) as unknown,
      }));
    const usage = this.mapUsage(response.usage);
    return {
      text: response.output_text,
      provider: this.name,
      model: this.options.model,
      responseId: response.id,
      toolCalls,
      ...(usage ? { usage } : {}),
    };
  }

  private mapUsage(usage: { input_tokens: number; output_tokens: number; total_tokens: number } | undefined) {
    return usage
      ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          totalTokens: usage.total_tokens,
          costUsd: (
            usage.input_tokens * (this.options.inputUsdPerMillion ?? 0) +
            usage.output_tokens * (this.options.outputUsdPerMillion ?? 0)
          ) / 1_000_000,
        }
      : undefined;
  }
}
