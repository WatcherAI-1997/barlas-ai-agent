import type {
  AgentMessage, GenerateRequest, GenerateResult, GenerateToolRequest, GenerateToolResult,
  ModelToolOutput, ToolCapableModelProvider,
} from "../core/models.js";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
type ApiMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };
type Continuation = { messages: ApiMessage[] };

interface AnthropicResponse {
  id: string;
  model: string;
  content: ContentBlock[];
  usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements ToolCapableModelProvider {
  readonly name = "anthropic";

  constructor(private readonly options: {
    apiKey: string;
    model: string;
    baseURL?: string;
    inputUsdPerMillion?: number;
    outputUsdPerMillion?: number;
    fetchImpl?: typeof fetch;
  }) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.create(request, []);
    return this.result(response);
  }

  async generateWithTools(request: GenerateToolRequest): Promise<GenerateToolResult> {
    const history = request.previousResponseId
      ? decodeContinuation(request.previousResponseId).messages
      : mapMessages(request.messages);
    if (request.toolOutputs?.length) history.push(toolResults(request.toolOutputs));
    const response = await this.create(request, request.tools.map((tool) => ({
      name: tool.name, description: tool.description, input_schema: tool.parameters,
    })), history);
    const nextHistory = [...history, { role: "assistant" as const, content: response.content }];
    const base = this.result(response);
    return {
      ...base,
      responseId: encodeContinuation({ messages: nextHistory }),
      toolCalls: response.content.filter((block): block is Extract<ContentBlock, { type: "tool_use" }> => block.type === "tool_use")
        .map((block) => ({ callId: block.id, name: block.name, arguments: block.input })),
    };
  }

  private async create(
    request: GenerateRequest,
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
    history = mapMessages(request.messages),
  ): Promise<AnthropicResponse> {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const response = await (this.options.fetchImpl ?? fetch)(
      new URL("v1/messages", ensureTrailingSlash(this.options.baseURL ?? "https://api.anthropic.com/")),
      {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-api-key": this.options.apiKey,
          "anthropic-version": "2023-06-01", "user-agent": "Barlas-AI-Agent/0.1",
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: request.maxOutputTokens ?? 4_096,
          messages: history,
          ...(system ? { system } : {}),
          ...(tools.length ? { tools, tool_choice: { type: "auto" } } : {}),
          metadata: { user_id: request.userId.slice(0, 256) },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2_000);
      throw new Error(`Anthropic API ${response.status}: ${body || response.statusText}`);
    }
    return await response.json() as AnthropicResponse;
  }

  private result(response: AnthropicResponse): GenerateResult {
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    return {
      text: response.content.filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text").map((block) => block.text).join("\n"),
      provider: this.name,
      model: response.model || this.options.model,
      responseId: response.id,
      usage: {
        inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
        costUsd: (inputTokens * (this.options.inputUsdPerMillion ?? 0) + outputTokens * (this.options.outputUsdPerMillion ?? 0)) / 1_000_000,
      },
    };
  }
}

function mapMessages(messages: AgentMessage[]): ApiMessage[] {
  return messages.flatMap((message): ApiMessage[] => message.role === "system"
    ? []
    : [{ role: message.role, content: message.content }]);
}

function toolResults(outputs: ModelToolOutput | ModelToolOutput[]): ApiMessage {
  const values = Array.isArray(outputs) ? outputs : [outputs];
  return { role: "user", content: values.map((output) => ({ type: "tool_result" as const, tool_use_id: output.callId, content: output.output })) };
}

function encodeContinuation(value: Continuation): string {
  return `anthropic:${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

function decodeContinuation(value: string): Continuation {
  if (!value.startsWith("anthropic:") || value.length > 2_000_000) throw new Error("Invalid Anthropic continuation");
  const decoded = JSON.parse(Buffer.from(value.slice(10), "base64url").toString("utf8")) as Continuation;
  if (!decoded || !Array.isArray(decoded.messages)) throw new Error("Invalid Anthropic continuation");
  return decoded;
}

function ensureTrailingSlash(value: string): string { return value.endsWith("/") ? value : `${value}/`; }
