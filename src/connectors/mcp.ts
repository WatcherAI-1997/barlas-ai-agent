import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { ConnectorRecord, ConnectorService } from "./vault.js";
import { assertPublicUrl, publicNetworkFetch } from "../tools/safe-web.js";

const MAX_RESULT_BYTES = 1_000_000;

interface McpSession {
  listTools(): Promise<unknown>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

type SessionFactory = (endpoint: string, token: string) => Promise<McpSession>;

export class McpConnector {
  constructor(
    private readonly connectors: Pick<ConnectorService, "connection">,
    private readonly createSession: SessionFactory = createMcpSession,
  ) {}

  async listTools(userId: string, connectorId: string): Promise<Array<{
    name: string;
    description: string | null;
    inputSchema: Record<string, unknown>;
  }>> {
    return this.withSession(userId, connectorId, async (session) => {
      const result = await session.listTools() as { tools?: unknown[] };
      if (!Array.isArray(result.tools) || result.tools.length > 200) throw new Error("MCP server returned an invalid tool list");
      return result.tools.map((value) => {
        const tool = value as Record<string, unknown>;
        if (typeof tool.name !== "string" || !tool.inputSchema || typeof tool.inputSchema !== "object") {
          throw new Error("MCP server returned an invalid tool definition");
        }
        return {
          name: tool.name.slice(0, 200),
          description: typeof tool.description === "string" ? tool.description.slice(0, 2_000) : null,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        };
      });
    });
  }

  async callTool(userId: string, connectorId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    if (Buffer.byteLength(JSON.stringify(args), "utf8") > 100_000) throw new Error("MCP tool arguments exceed 100 KB");
    const result = await this.withSession(userId, connectorId, (session) => session.callTool(name, args));
    const serialized = JSON.stringify(result);
    if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) throw new Error("MCP tool result exceeds 1 MB");
    return result;
  }

  private async withSession<T>(userId: string, connectorId: string, operation: (session: McpSession) => Promise<T>): Promise<T> {
    const connection = await this.connectors.connection(userId, connectorId, "mcp_http");
    if (!connection) throw new Error("MCP connector was not found");
    const endpoint = endpointFrom(connection.record);
    const session = await this.createSession(endpoint, connection.secret);
    try {
      return await operation(session);
    } finally {
      await session.close().catch(() => undefined);
    }
  }
}

function endpointFrom(record: ConnectorRecord): string {
  const endpoint = record.metadata.endpoint;
  if (typeof endpoint !== "string" || endpoint.length > 2_000) throw new Error("MCP connector metadata.endpoint is required");
  return endpoint;
}

async function createMcpSession(endpoint: string, token: string): Promise<McpSession> {
  const url = await assertPublicUrl(endpoint);
  if (url.protocol !== "https:") throw new Error("MCP Streamable HTTP endpoints must use HTTPS");
  const client = new Client({ name: "Barlas AI Agent", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: publicNetworkFetch,
    redirectPolicy: "same-origin",
    requestInit: {
      redirect: "error",
      headers: token === "-" ? {} : { Authorization: `Bearer ${token}` },
    },
    reconnectionOptions: {
      maxReconnectionDelay: 2_000,
      initialReconnectionDelay: 250,
      reconnectionDelayGrowFactor: 2,
      maxRetries: 1,
    },
  });
  // The SDK's published Transport types are not exactOptionalPropertyTypes-safe,
  // while the runtime implementation conforms to the same protocol contract.
  await client.connect(transport as unknown as Transport, { timeout: 15_000 });
  return {
    listTools: () => client.listTools(undefined, { timeout: 15_000 }),
    callTool: (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 }),
    close: () => client.close(),
  };
}
