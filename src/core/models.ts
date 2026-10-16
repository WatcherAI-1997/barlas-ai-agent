export type MessageRole = "system" | "user" | "assistant";

export interface AgentMessage {
  role: MessageRole;
  content: string;
}

export interface GenerateRequest {
  messages: AgentMessage[];
  userId: string;
  conversationId: string;
  taskClass?: "fast" | "deep" | "private";
  maxOutputTokens?: number;
}

export interface GenerateResult {
  text: string;
  provider: string;
  model: string;
  responseId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd?: number;
  };
}

export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelToolOutput {
  callId: string;
  output: string;
}

export interface GenerateToolRequest extends GenerateRequest {
  tools: ModelTool[];
  previousResponseId?: string;
  toolOutputs?: ModelToolOutput[];
}

export interface ModelToolCall {
  callId: string;
  name: string;
  arguments: unknown;
}

export interface GenerateToolResult extends GenerateResult {
  toolCalls: ModelToolCall[];
}

export interface ModelProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export interface ToolCapableModelProvider extends ModelProvider {
  generateWithTools(request: GenerateToolRequest): Promise<GenerateToolResult>;
}

export function supportsTools(provider: ModelProvider): provider is ToolCapableModelProvider {
  return "generateWithTools" in provider && typeof provider.generateWithTools === "function";
}
