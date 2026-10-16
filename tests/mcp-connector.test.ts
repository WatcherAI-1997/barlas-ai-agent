import { describe, expect, it, vi } from "vitest";

import { McpConnector } from "../src/connectors/mcp.js";

describe("MCP connector", () => {
  it("uses an owner-scoped encrypted connection and bounds remote tool metadata", async () => {
    const close = vi.fn(async () => undefined);
    const factory = vi.fn(async () => ({
      listTools: async () => ({ tools: [{ name: "files.search", description: "Search", inputSchema: { type: "object" } }] }),
      callTool: async (name: string, args: Record<string, unknown>) => ({ content: [{ type: "text", text: `${name}:${args.query}` }] }),
      close,
    }));
    const connector = new McpConnector({
      connection: async () => ({
        record: {
          id: "connector-1", userId: "user-1", provider: "mcp_http", label: "Docs",
          metadata: { endpoint: "https://mcp.example.com/v1" }, keyVersion: 1,
          createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z",
        },
        secret: "hidden-token",
      }),
    }, factory);

    await expect(connector.listTools("user-1", "connector-1")).resolves.toEqual([
      { name: "files.search", description: "Search", inputSchema: { type: "object" } },
    ]);
    await expect(connector.callTool("user-1", "connector-1", "files.search", { query: "Barlas" }))
      .resolves.toMatchObject({ content: [{ text: "files.search:Barlas" }] });
    expect(factory).toHaveBeenCalledWith("https://mcp.example.com/v1", "hidden-token");
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("does not connect for a missing or wrong-owner MCP connection", async () => {
    const factory = vi.fn();
    const connector = new McpConnector({ connection: async () => null }, factory);
    await expect(connector.listTools("other-user", "connector-1")).rejects.toThrow(/not found/u);
    expect(factory).not.toHaveBeenCalled();
  });
});
