import { Pool } from "pg";

import type { AgentMessage, GenerateResult } from "../core/models.js";
import type { AgentStore, MemoryEntry } from "./types.js";

export class Database implements AgentStore {
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

  async remember(input: {
    userId: string;
    content: string;
    category: string;
    importance: number;
  }): Promise<MemoryEntry> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      content: string;
      category: string;
      importance: number;
      created_at: Date;
    }>(
      `insert into memories (user_id, content, category, importance)
       values ($1, $2, $3, $4)
       returning id, user_id, content, category, importance, created_at`,
      [input.userId, input.content, input.category, input.importance],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Memory insert returned no row");
    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      category: row.category,
      importance: row.importance,
      createdAt: row.created_at.toISOString(),
    };
  }

  async recall(userId: string, query: string, limit: number): Promise<MemoryEntry[]> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      content: string;
      category: string;
      importance: number;
      created_at: Date;
    }>(
      `select id, user_id, content, category, importance, created_at
       from memories
       where user_id = $1
         and search_vector @@ plainto_tsquery('simple', $2)
         and (expires_at is null or expires_at > now())
       order by
         ts_rank(search_vector, plainto_tsquery('simple', $2)) desc,
         importance desc,
         created_at desc
       limit $3`,
      [userId, query, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      content: row.content,
      category: row.category,
      importance: row.importance,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
