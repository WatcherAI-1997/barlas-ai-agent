import type { AgentMessage, GenerateResult } from "../core/models.js";

export interface MemoryEntry {
  id: string;
  userId: string;
  content: string;
  category: string;
  importance: number;
  createdAt: string;
}

export interface AgentStore {
  ping(): Promise<void>;
  saveTurn(input: {
    conversationId: string;
    userId: string;
    messages: AgentMessage[];
    result: GenerateResult;
  }): Promise<void>;
  remember(input: {
    userId: string;
    content: string;
    category: string;
    importance: number;
  }): Promise<MemoryEntry>;
  recall(userId: string, query: string, limit: number): Promise<MemoryEntry[]>;
  close(): Promise<void>;
}
