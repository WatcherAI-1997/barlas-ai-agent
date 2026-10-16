import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { CodexCliProvider } from "../src/providers/codex-cli-provider.js";

describe("CodexCliProvider", () => {
  it("maps a structured direct answer", async () => {
    const provider = new CodexCliProvider({
      model: "account-model",
      codexScript: "unused",
      runCli: async ({ outputPath }) => {
        await writeFile(outputPath, JSON.stringify({
          kind: "answer", text: "Ready", toolName: "", toolArgumentsJson: "{}",
        }));
      },
    });
    const result = await provider.generateWithTools({
      userId: "u1", conversationId: "c1", messages: [{ role: "user", content: "hello" }], tools: [],
    });
    expect(result).toMatchObject({ text: "Ready", provider: "openai-account", model: "account-model", toolCalls: [] });
  });

  it("maps one Barlas tool call and preserves bounded continuation context", async () => {
    const prompts: string[] = [];
    const provider = new CodexCliProvider({
      model: "account-model",
      codexScript: "unused",
      runCli: async ({ prompt, outputPath }) => {
        prompts.push(prompt);
        await writeFile(outputPath, JSON.stringify({
          kind: prompts.length === 1 ? "tool" : "answer",
          text: prompts.length === 1 ? "Checking" : "Done",
          toolName: prompts.length === 1 ? "web_search" : "",
          toolArgumentsJson: prompts.length === 1 ? "{\"query\":\"Barlas\"}" : "{}",
        }));
      },
    });
    const request = {
      userId: "u1", conversationId: "c1", messages: [{ role: "user" as const, content: "research" }],
      tools: [{ name: "web_search", description: "Search", parameters: { type: "object" } }],
    };
    const first = await provider.generateWithTools(request);
    expect(first.toolCalls[0]).toMatchObject({ name: "web_search", arguments: { query: "Barlas" } });
    expect(first.responseId).toBeTruthy();
    const second = await provider.generateWithTools({
      ...request, previousResponseId: first.responseId!, toolOutputs: [{ callId: first.toolCalls[0]!.callId, output: "result" }],
    });
    expect(second.text).toBe("Done");
    expect(prompts[1]).toContain("Previous requested tool");
    expect(prompts[1]).toContain("Results from that tool");
  });

  it("rejects tool names outside the advertised registry", async () => {
    const provider = new CodexCliProvider({
      model: "account-model", codexScript: "unused",
      runCli: async ({ outputPath }) => writeFile(outputPath, JSON.stringify({
        kind: "tool", text: "", toolName: "shell", toolArgumentsJson: "{}",
      })).then(() => undefined),
    });
    await expect(provider.generateWithTools({
      userId: "u1", conversationId: "c1", messages: [], tools: [],
    })).rejects.toThrow("unavailable tool");
  });
});
