import { describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "../src/providers/anthropic-provider.js";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Anthropic model provider", () => {
  it("maps messages, usage, and text without leaking the API key into the body", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => response({
      id: "msg_1", model: "claude-test", content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }));
    const provider = new AnthropicProvider({ apiKey: "secret-anthropic-key", model: "claude-test", fetchImpl });
    const result = await provider.generate({
      userId: "user-1", conversationId: "conversation-1",
      messages: [{ role: "system", content: "Be concise" }, { role: "user", content: "Hello" }],
    });
    expect(result).toMatchObject({ text: "Hello", provider: "anthropic", usage: { totalTokens: 14 } });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(JSON.parse(String(init.body))).toMatchObject({ system: "Be concise", messages: [{ role: "user", content: "Hello" }] });
    expect(String(init.body)).not.toContain("secret-anthropic-key");
  });

  it("preserves the complete tool history in an opaque continuation", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        id: "msg_1", model: "claude-test",
        content: [{ type: "tool_use", id: "tool_1", name: "system_current_time", input: {} }],
        usage: { input_tokens: 12, output_tokens: 5 },
      }))
      .mockResolvedValueOnce(response({
        id: "msg_2", model: "claude-test", content: [{ type: "text", text: "It is noon" }],
        usage: { input_tokens: 20, output_tokens: 4 },
      }));
    const provider = new AnthropicProvider({ apiKey: "test-key", model: "claude-test", fetchImpl });
    const request = {
      userId: "user-1", conversationId: "conversation-1", messages: [{ role: "user" as const, content: "Time?" }],
      tools: [{ name: "system_current_time", description: "time", parameters: { type: "object", properties: {} } }],
    };
    const first = await provider.generateWithTools(request);
    expect(first.toolCalls).toEqual([{ callId: "tool_1", name: "system_current_time", arguments: {} }]);
    expect(first.responseId).toMatch(/^anthropic:/u);
    const second = await provider.generateWithTools({
      ...request, previousResponseId: first.responseId!,
      toolOutputs: [{ callId: "tool_1", output: '{"now":"noon"}' }],
    });
    expect(second.text).toBe("It is noon");
    const secondBody = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body));
    expect(secondBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: expect.arrayContaining([expect.objectContaining({ type: "tool_use", id: "tool_1" })]) }),
      expect.objectContaining({ role: "user", content: expect.arrayContaining([expect.objectContaining({ type: "tool_result", tool_use_id: "tool_1" })]) }),
    ]));
  });
});
