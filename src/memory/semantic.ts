import OpenAI from "openai";

import type { MemoryEntry } from "../storage/types.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<{ vector: number[]; model: string }>;
}

export interface SemanticMemoryStore {
  remember(input: { userId: string; content: string; category: string; importance: number }): Promise<MemoryEntry>;
  recall(userId: string, query: string, limit: number): Promise<MemoryEntry[]>;
  rememberEmbedded(input: {
    userId: string;
    content: string;
    category: string;
    importance: number;
    embedding: number[];
    embeddingModel: string;
  }): Promise<MemoryEntry>;
  recallSemantic(userId: string, embedding: number[], limit: number): Promise<MemoryEntry[]>;
}

export class SemanticMemory {
  constructor(private readonly store: SemanticMemoryStore, private readonly embeddings?: EmbeddingProvider) {}

  async remember(input: {
    userId: string;
    content: string;
    category: string;
    importance: number;
  }): Promise<MemoryEntry> {
    if (!this.embeddings) return this.store.remember(input);
    let embedded: { vector: number[]; model: string };
    try {
      embedded = await this.embeddings.embed(`${input.category}\n${input.content}`);
      validateVector(embedded.vector);
    } catch {
      return this.store.remember(input);
    }
    return this.store.rememberEmbedded({
      ...input,
      embedding: embedded.vector,
      embeddingModel: embedded.model,
    });
  }

  async recall(userId: string, query: string, limit: number): Promise<MemoryEntry[]> {
    const lexical = await this.store.recall(userId, query, limit);
    if (!this.embeddings || lexical.length >= limit) return lexical;
    try {
      const embedded = await this.embeddings.embed(query);
      validateVector(embedded.vector);
      const semantic = await this.store.recallSemantic(userId, embedded.vector, limit);
      const merged = new Map<string, MemoryEntry>();
      for (const memory of [...lexical, ...semantic]) merged.set(memory.id, memory);
      return [...merged.values()].slice(0, limit);
    } catch {
      return lexical;
    }
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;

  constructor(private readonly options: { apiKey: string; model: string; baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  }

  async embed(text: string): Promise<{ vector: number[]; model: string }> {
    const response = await this.client.embeddings.create({ model: this.options.model, input: text });
    const vector = response.data[0]?.embedding;
    if (!vector) throw new Error("Embedding provider returned no vector");
    validateVector(vector);
    return { vector, model: response.model };
  }
}

function validateVector(vector: number[]): void {
  if (vector.length < 1 || vector.length > 4096 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding vector is invalid");
  }
}
