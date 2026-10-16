import { describe, expect, it, vi } from "vitest";

import { SemanticMemory, type SemanticMemoryStore } from "../src/memory/semantic.js";
import type { MemoryEntry } from "../src/storage/types.js";

const lexical: MemoryEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "user-a",
  content: "Prefers concise reports",
  category: "preference",
  importance: 8,
  createdAt: "2026-10-16T00:00:00.000Z",
};
const semantic: MemoryEntry = {
  ...lexical,
  id: "22222222-2222-4222-8222-222222222222",
  content: "The user's favorite writing style is brief",
};

function store(): SemanticMemoryStore {
  return {
    remember: vi.fn(async (input) => ({ ...lexical, ...input })),
    recall: vi.fn(async () => [lexical]),
    rememberEmbedded: vi.fn(async (input) => ({ ...lexical, ...input })),
    recallSemantic: vi.fn(async () => [semantic]),
  };
}

describe("semantic memory", () => {
  it("stores embeddings and merges semantic results after lexical results", async () => {
    const database = store();
    const embeddings = { embed: vi.fn(async () => ({ vector: [0.2, 0.4], model: "embed-test" })) };
    const memory = new SemanticMemory(database, embeddings);

    await memory.remember({ userId: "user-a", content: "Brief answers", category: "preference", importance: 8 });
    const recalled = await memory.recall("user-a", "writing style", 5);

    expect(database.rememberEmbedded).toHaveBeenCalledWith(expect.objectContaining({
      embedding: [0.2, 0.4],
      embeddingModel: "embed-test",
    }));
    expect(recalled.map((item) => item.id)).toEqual([lexical.id, semantic.id]);
  });

  it("falls back to lexical memory when embeddings fail", async () => {
    const database = store();
    const memory = new SemanticMemory(database, { embed: async () => { throw new Error("offline"); } });

    await memory.remember({ userId: "user-a", content: "Brief answers", category: "preference", importance: 8 });
    expect(database.remember).toHaveBeenCalledOnce();
    expect(await memory.recall("user-a", "style", 5)).toEqual([lexical]);
    expect(database.recallSemantic).not.toHaveBeenCalled();
  });
});
