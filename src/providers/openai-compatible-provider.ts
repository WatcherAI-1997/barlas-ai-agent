import type {
  AgentMessage,
  GenerateRequest,
  GenerateResult,
  GenerateToolRequest,
  GenerateToolResult,
  ModelToolOutput,
  ToolCapableModelProvider,
} from "../core/models.js";

interface CompatibleMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface CompatibleResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: CompatibleMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface CompatibleContinuation {
  messages: CompatibleMessage[];
}

const MAX_RESPONSE_BYTES = 10_000_000;
const MAX_CONTINUATION_BYTES = 2_000_000;

export class OpenAICompatibleProvider implements ToolCapableModelProvider {
  readonly name = "openai-compatible";
  private readonly endpoint: string;

  constructor(private readonly options: {
    apiKey: string;
    model: string;
    baseURL: string;
    inputUsdPerMillion?: number;
    outputUsdPerMillion?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.endpoint = `${options.baseURL.replace(/\/$/u, "")}/chat/completions`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.create(request, mapMessages(request.messages), []);
    return this.result(response);
  }

  async generateWithTools(request: GenerateToolRequest): Promise<GenerateToolResult> {
    const continuation = request.previousResponseId
      ? decodeContinuation(request.previousResponseId)
      : { messages: mapMessages(request.messages) };
    if (request.toolOutputs?.length) appendToolOutputs(continuation, request.toolOutputs);
    const response = await this.create(request, continuation.messages, request.tools);
    const message: CompatibleMessage = response.choices?.[0]?.message ?? { role: "assistant", content: "" };
    const toolCalls = (message.tool_calls ?? []).map((call) => ({
      callId: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    }));
    continuation.messages.push(message);
    return {
      ...this.result(response),
      responseId: encodeContinuation(continuation),
      toolCalls,
    };
  }

  private async create(
    request: GenerateRequest,
    messages: CompatibleMessage[],
    tools: GenerateToolRequest["tools"],
  ): Promise<CompatibleResponse> {
    const response = await (this.options.fetchImpl ?? fetch)(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        "user-agent": "Barlas-AI-Agent/0.1",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        stream: false,
        ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
        ...(tools.length ? {
          tools: tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          tool_choice: "auto",
        } : {}),
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Compatible model response exceeds 10 MB");
    if (!response.ok) throw new Error(`Compatible model API ${response.status}: ${body.slice(0, 2_000) || response.statusText}`);
    return JSON.parse(body) as CompatibleResponse;
  }

  private result(response: CompatibleResponse): GenerateResult {
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = response.usage?.total_tokens ?? inputTokens + outputTokens;
    const content = response.choices?.[0]?.message?.content;
    return {
      text: typeof content === "string" ? content : "",
      provider: this.name,
      model: response.model ?? this.options.model,
      ...(response.usage ? {
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd: (
            inputTokens * (this.options.inputUsdPerMillion ?? 0) +
            outputTokens * (this.options.outputUsdPerMillion ?? 0)
          ) / 1_000_000,
        },
      } : {}),
    };
  }
}

function mapMessages(messages: AgentMessage[]): CompatibleMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function appendToolOutputs(continuation: CompatibleContinuation, outputs: ModelToolOutput[]): void {
  const knownCalls = new Set(continuation.messages.flatMap((message) => message.tool_calls?.map((call) => call.id) ?? []));
  for (const output of outputs) {
    if (!knownCalls.has(output.callId)) throw new Error("Invalid compatible-provider tool continuation");
    continuation.messages.push({ role: "tool", content: output.output, tool_call_id: output.callId });
  }
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Compatible model returned invalid tool arguments");
  }
}

function encodeContinuation(value: CompatibleContinuation): string {
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  if (encoded.length > MAX_CONTINUATION_BYTES) throw new Error("Compatible-provider continuation is too large");
  return `compat:${encoded}`;
}

function decodeContinuation(value: string): CompatibleContinuation {
  if (!value.startsWith("compat:") || value.length > MAX_CONTINUATION_BYTES) {
    throw new Error("Invalid compatible-provider continuation");
  }
  let decoded: CompatibleContinuation;
  try {
    decoded = JSON.parse(Buffer.from(value.slice(7), "base64url").toString("utf8")) as CompatibleContinuation;
  } catch {
    throw new Error("Invalid compatible-provider continuation");
  }
  if (!decoded || !Array.isArray(decoded.messages)) throw new Error("Invalid compatible-provider continuation");
  return decoded;
}
