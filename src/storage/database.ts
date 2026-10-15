import { Pool } from "pg";

import type { AgentMessage, GenerateResult } from "../core/models.js";
import type { AgentStore, ApprovalRequest, DurableJob, MemoryEntry } from "./types.js";

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

  async createApproval(input: {
    userId: string;
    toolName: string;
    risk: "write" | "external" | "destructive";
    summary: string;
    toolInput: unknown;
  }): Promise<ApprovalRequest> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      tool_name: string;
      risk: ApprovalRequest["risk"];
      summary: string;
      input: unknown;
      status: ApprovalRequest["status"];
      created_at: Date;
    }>(
      `insert into approval_requests (user_id, tool_name, risk, summary, input)
       values ($1, $2, $3, $4, $5::jsonb)
       returning id, user_id, tool_name, risk, summary, input, status, created_at`,
      [input.userId, input.toolName, input.risk, input.summary, JSON.stringify(input.toolInput)],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Approval insert returned no row");
    return this.mapApproval(row);
  }

  async decideApproval(input: {
    id: string;
    userId: string;
    approved: boolean;
  }): Promise<ApprovalRequest | null> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      tool_name: string;
      risk: ApprovalRequest["risk"];
      summary: string;
      input: unknown;
      status: ApprovalRequest["status"];
      created_at: Date;
    }>(
      `update approval_requests
       set status = $3, decided_at = now()
       where id = $1 and user_id = $2 and status = 'pending'
       returning id, user_id, tool_name, risk, summary, input, status, created_at`,
      [input.id, input.userId, input.approved ? "approved" : "rejected"],
    );
    const row = result.rows[0];
    return row ? this.mapApproval(row) : null;
  }

  async markApprovalExecuted(id: string, succeeded: boolean): Promise<void> {
    await this.pool.query(
      `update approval_requests
       set status = $2, executed_at = now()
       where id = $1 and status = 'approved'`,
      [id, succeeded ? "executed" : "failed"],
    );
  }

  async appendAudit(input: {
    userId: string;
    eventType: string;
    resourceType: string;
    resourceId?: string;
    details?: unknown;
  }): Promise<void> {
    await this.pool.query(
      `insert into audit_events
        (user_id, event_type, resource_type, resource_id, details)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.userId,
        input.eventType,
        input.resourceType,
        input.resourceId ?? null,
        JSON.stringify(input.details ?? {}),
      ],
    );
  }

  async createJob(input: {
    userId: string;
    jobType: string;
    jobInput: unknown;
    scheduledFor: Date;
  }): Promise<DurableJob> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      job_type: string;
      input: unknown;
      status: DurableJob["status"];
      scheduled_for: Date;
      created_at: Date;
    }>(
      `insert into jobs (user_id, job_type, input, scheduled_for)
       values ($1, $2, $3::jsonb, $4)
       returning id, user_id, job_type, input, status, scheduled_for, created_at`,
      [input.userId, input.jobType, JSON.stringify(input.jobInput), input.scheduledFor],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Job insert returned no row");
    return this.mapJob(row);
  }

  async listJobs(userId: string, limit: number): Promise<DurableJob[]> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      job_type: string;
      input: unknown;
      status: DurableJob["status"];
      scheduled_for: Date;
      created_at: Date;
    }>(
      `select id, user_id, job_type, input, status, scheduled_for, created_at
       from jobs where user_id = $1
       order by created_at desc limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => this.mapJob(row));
  }

  private mapApproval(row: {
    id: string;
    user_id: string;
    tool_name: string;
    risk: ApprovalRequest["risk"];
    summary: string;
    input: unknown;
    status: ApprovalRequest["status"];
    created_at: Date;
  }): ApprovalRequest {
    return {
      id: row.id,
      userId: row.user_id,
      toolName: row.tool_name,
      risk: row.risk,
      summary: row.summary,
      input: row.input,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    };
  }

  private mapJob(row: {
    id: string;
    user_id: string;
    job_type: string;
    input: unknown;
    status: DurableJob["status"];
    scheduled_for: Date;
    created_at: Date;
  }): DurableJob {
    return {
      id: row.id,
      userId: row.user_id,
      jobType: row.job_type,
      input: row.input,
      status: row.status,
      scheduledFor: row.scheduled_for.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }
}
