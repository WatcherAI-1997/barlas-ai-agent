import { describe, expect, it, vi } from "vitest";

import { OllamaProvider } from "../src/providers/ollama-provider.js";

const request = {
  userId: "user-1",
  conversationId: "00000000-0000-4000-8000-000000000001",
  messages: [{ role: "user" as const, content: "Hello" }],
};

describe("Ollama provider", () => {
  it("generates with a free local model and maps token usage", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: "qwen3:8b",
      message: { role: "assistant", content: "Salom" },
      prompt_eval_count: 8,
      eval_count: 3,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new OllamaProvider({ model: "qwen3:8b", fetchImpl: fetchMock as typeof fetch });

    await expect(provider.generate(request)).resolves.toMatchObject({
      text: "Salom", provider: "ollama", model: "qwen3:8b",
      usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11, costUsd: 0 },
    });
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(String(calls[0]?.[0])).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({ model: "qwen3:8b", stream: false });
  });

  it("preserves local tool context across an autonomous continuation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "qwen3:8b",
        message: {
          role: "assistant", content: "",
          tool_calls: [{ function: { name: "files_read", arguments: { path: "notes.txt" } } }],
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "qwen3:8b", message: { role: "assistant", content: "Done" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new OllamaProvider({ model: "qwen3:8b", fetchImpl: fetchMock as typeof fetch });
    const first = await provider.generateWithTools({
      ...request,
      tools: [{ name: "files_read", description: "Read a file", parameters: { type: "object" } }],
    });
    const call = first.toolCalls[0]!;
    expect(call).toMatchObject({ name: "files_read", arguments: { path: "notes.txt" } });

    const second = await provider.generateWithTools({
      ...request,
      tools: [{ name: "files_read", description: "Read a file", parameters: { type: "object" } }],
      previousResponseId: first.responseId!,
      toolOutputs: [{ callId: call.callId, output: "contents" }],
    });
    expect(second.text).toBe("Done");
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const body = JSON.parse(String(calls[1]?.[1]?.body)) as { messages: Array<Record<string, unknown>> };
    expect(body.messages.at(-1)).toMatchObject({ role: "tool", content: "contents", tool_name: "files_read" });
  });
});
