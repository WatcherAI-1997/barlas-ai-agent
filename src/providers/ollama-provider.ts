import { randomUUID } from "node:crypto";

import type {
  AgentMessage,
  GenerateRequest,
  GenerateResult,
  GenerateToolRequest,
  GenerateToolResult,
  ModelToolOutput,
  ToolCapableModelProvider,
} from "../core/models.js";

interface OllamaToolCall {
  function: { name: string; arguments: unknown };
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaResponse {
  model?: string;
  message?: OllamaMessage;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaContinuation {
  messages: OllamaMessage[];
  calls: Record<string, string>;
}

export class OllamaProvider implements ToolCapableModelProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;

  constructor(private readonly options: {
    model: string;
    baseURL?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.baseUrl = (options.baseURL ?? "http://127.0.0.1:11434").replace(/\/$/u, "");
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.create(request, mapMessages(request.messages), []);
    return this.result(response);
  }

  async generateWithTools(request: GenerateToolRequest): Promise<GenerateToolResult> {
    const continuation = request.previousResponseId
      ? decodeContinuation(request.previousResponseId)
      : { messages: mapMessages(request.messages), calls: {} };
    if (request.toolOutputs?.length) appendToolOutputs(continuation, request.toolOutputs);
    const response = await this.create(request, continuation.messages, request.tools);
    const toolCalls = (response.message?.tool_calls ?? []).map((call) => {
      const callId = `ollama-${randomUUID()}`;
      continuation.calls[callId] = call.function.name;
      return { callId, name: call.function.name, arguments: call.function.arguments };
    });
    continuation.messages.push(response.message ?? { role: "assistant", content: "" });
    return {
      ...this.result(response),
      responseId: encodeContinuation(continuation),
      toolCalls,
    };
  }

  private async create(
    request: GenerateRequest,
    messages: OllamaMessage[],
    tools: GenerateToolRequest["tools"],
  ): Promise<OllamaResponse> {
    const response = await (this.options.fetchImpl ?? fetch)(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Barlas-AI-Agent/0.1" },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        stream: false,
        ...(request.maxOutputTokens ? { options: { num_predict: request.maxOutputTokens } } : {}),
        ...(tools.length ? {
          tools: tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
        } : {}),
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2_000);
      throw new Error(`Ollama API ${response.status}: ${body || response.statusText}`);
    }
    return await response.json() as OllamaResponse;
  }

  private result(response: OllamaResponse): GenerateResult {
    const inputTokens = response.prompt_eval_count ?? 0;
    const outputTokens = response.eval_count ?? 0;
    return {
      text: response.message?.content ?? "",
      provider: this.name,
      model: response.model ?? this.options.model,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd: 0 },
    };
  }
}

function mapMessages(messages: AgentMessage[]): OllamaMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function appendToolOutputs(continuation: OllamaContinuation, outputs: ModelToolOutput[]): void {
  for (const output of outputs) {
    const toolName = continuation.calls[output.callId];
    if (!toolName) throw new Error("Invalid Ollama tool continuation");
    continuation.messages.push({ role: "tool", content: output.output, tool_name: toolName });
  }
}

function encodeContinuation(value: OllamaContinuation): string {
  return `ollama:${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeContinuation(value: string): OllamaContinuation {
  if (!value.startsWith("ollama:") || value.length > 2_000_000) throw new Error("Invalid Ollama continuation");
  const decoded = JSON.parse(Buffer.from(value.slice(7), "base64url").toString("utf8")) as OllamaContinuation;
  if (!decoded || !Array.isArray(decoded.messages) || typeof decoded.calls !== "object") {
    throw new Error("Invalid Ollama continuation");
  }
  return decoded;
}
