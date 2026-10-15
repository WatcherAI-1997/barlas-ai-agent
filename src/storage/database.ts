import { Pool } from "pg";

import type { AgentMessage, GenerateResult } from "../core/models.js";

export class Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      application_name: "Barlas AI Agent",
      max: 10,
    });
  }

  async ping(): Promise<void> {
    await this.pool.query("select 1");
  }

  async saveTurn(input: {
    conversationId: string;
    userId: string;
    messages: AgentMessage[];
    result: GenerateResult;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into conversations (id, user_id)
         values ($1, $2)
         on conflict (id) do nothing`,
        [input.conversationId, input.userId],
      );

      for (const message of input.messages) {
        await client.query(
          `insert into messages (conversation_id, role, content)
           values ($1, $2, $3)`,
          [input.conversationId, message.role, message.content],
        );
      }

      await client.query(
        `insert into messages
          (conversation_id, role, content, provider, model, provider_response_id)
         values ($1, 'assistant', $2, $3, $4, $5)`,
        [
          input.conversationId,
          input.result.text,
          input.result.provider,
          input.result.model,
          input.result.responseId ?? null,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

