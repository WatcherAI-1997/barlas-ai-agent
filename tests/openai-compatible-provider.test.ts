import { describe, expect, it, vi } from "vitest";

import { OpenAICompatibleProvider } from "../src/providers/openai-compatible-provider.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OpenAI-compatible model provider", () => {
  it("uses the configured endpoint and maps text and usage", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response({
      id: "chatcmpl-1", model: "portable-model",
      choices: [{ message: { role: "assistant", content: "Portable answer" } }],
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    }));
    const provider = new OpenAICompatibleProvider({
      apiKey: "compatible-secret", model: "portable-model", baseURL: "https://models.example/v1/", fetchImpl,
    });
    const result = await provider.generate({
      userId: "user-1", conversationId: "conversation-1", maxOutputTokens: 512,
      messages: [{ role: "system", content: "Be precise" }, { role: "user", content: "Hello" }],
    });

    expect(result).toMatchObject({ text: "Portable answer", provider: "openai-compatible", model: "portable-model", usage: { totalTokens: 11 } });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://models.example/v1/chat/completions");
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({ authorization: "Bearer compatible-secret" });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "portable-model", max_tokens: 512, stream: false });
    expect(String(init.body)).not.toContain("compatible-secret");
  });

  it("preserves tool calls and outputs in a bounded continuation", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        model: "portable-model",
        choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "system_current_time", arguments: "{}" } }],
        } }],
      }))
      .mockResolvedValueOnce(response({
        model: "portable-model", choices: [{ message: { role: "assistant", content: "It is noon" } }],
      }));
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key", model: "portable-model", baseURL: "https://models.example/v1", fetchImpl,
    });
    const request = {
      userId: "user-1", conversationId: "conversation-1", messages: [{ role: "user" as const, content: "Time?" }],
      tools: [{ name: "system_current_time", description: "time", parameters: { type: "object", properties: {} } }],
    };

    const first = await provider.generateWithTools(request);
    expect(first.toolCalls).toEqual([{ callId: "call_1", name: "system_current_time", arguments: {} }]);
    expect(first.responseId).toMatch(/^compat:/u);
    const second = await provider.generateWithTools({
      ...request, previousResponseId: first.responseId!,
      toolOutputs: [{ callId: "call_1", output: "{\"now\":\"noon\"}" }],
    });

    expect(second.text).toBe("It is noon");
    const secondBody = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body));
    expect(secondBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", tool_calls: [expect.objectContaining({ id: "call_1" })] }),
      { role: "tool", content: "{\"now\":\"noon\"}", tool_call_id: "call_1" },
    ]));
  });

  it("rejects malformed tool arguments and unknown continuations", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      choices: [{ message: {
        role: "assistant", content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "broken", arguments: "{" } }],
      } }],
    }));
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key", model: "portable-model", baseURL: "https://models.example/v1", fetchImpl,
    });
    await expect(provider.generateWithTools({
      userId: "user-1", conversationId: "conversation-1", messages: [{ role: "user", content: "Run" }],
      tools: [{ name: "broken", description: "broken", parameters: {} }],
    })).rejects.toThrow(/invalid tool arguments/u);
    await expect(provider.generateWithTools({
      userId: "user-1", conversationId: "conversation-1", messages: [], tools: [], previousResponseId: "not-compatible",
    })).rejects.toThrow(/Invalid compatible-provider continuation/u);
  });
});
