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

export interface ModelProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
