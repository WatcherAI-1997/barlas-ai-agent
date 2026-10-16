import { Pool } from "pg";

import type { AccountRole, AuthStore, StoredAccount, UserAccount } from "../auth/service.js";
import type { TelegramLink, TelegramLinkStore } from "../auth/telegram-link.js";
import type { AgentMessage, GenerateResult } from "../core/models.js";
import type { GovernanceStore, QuotaCategory, TraceEvent, TraceStatus } from "../governance/runtime.js";
import type {
  AgentRunEvent,
  AgentRunRecord,
  AgentRunStatus,
  AgentRunStore,
} from "../runs/types.js";
import type {
  AgentStore,
  ApprovalRequest,
  ConversationDetail,
  ConversationSummary,
  DashboardStats,
  DurableJob,
  MemoryEntry,
} from "./types.js";

export class Database implements AgentStore, GovernanceStore, AuthStore, AgentRunStore, TelegramLinkStore {
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
        `insert into conversations (id, user_id, title)
         values ($1, $2, $3)
         on conflict (id) do update set updated_at = now()
           where conversations.user_id = excluded.user_id
         returning id`,
        [
          input.conversationId,
          input.userId,
          input.messages.find((message) => message.role === "user")?.content.slice(0, 120) ?? "New conversation",
        ],
      );
      const ownership = await client.query(
        `select 1 from conversations where id = $1 and user_id = $2`,
        [input.conversationId, input.userId],
      );
      if (ownership.rowCount !== 1) throw new Error("Conversation belongs to another user");

      for (const message of input.messages) {
        await client.query(
          `insert into messages (conversation_id, role, content)
           values ($1, $2, $3)`,
          [input.conversationId, message.role, message.content],
        );
      }

      await client.query(
        `insert into messages
          (conversation_id, role, content, provider, model, provider_response_id,
           input_tokens, output_tokens, total_tokens, cost_microusd)
         values ($1, 'assistant', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.conversationId,
          input.result.text,
          input.result.provider,
          input.result.model,
          input.result.responseId ?? null,
          input.result.usage?.inputTokens ?? null,
          input.result.usage?.outputTokens ?? null,
          input.result.usage?.totalTokens ?? null,
          input.result.usage?.costUsd === undefined
            ? null
            : Math.round(input.result.usage.costUsd * 1_000_000),
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

  async listConversations(userId: string, limit: number): Promise<ConversationSummary[]> {
    const result = await this.pool.query<ConversationRow>(
      `select conversation.id,
              coalesce(conversation.title, 'New conversation') as title,
              conversation.created_at, conversation.updated_at,
              count(message.id)::integer as message_count,
              coalesce((array_agg(message.content order by message.created_at desc, message.id desc))[1], '') as last_message
       from conversations conversation
       left join messages message on message.conversation_id = conversation.id
       where conversation.user_id = $1
       group by conversation.id
       order by conversation.updated_at desc
       limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => this.mapConversation(row));
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationDetail | null> {
    const summary = await this.pool.query<ConversationRow>(
      `select conversation.id,
              coalesce(conversation.title, 'New conversation') as title,
              conversation.created_at, conversation.updated_at,
              count(message.id)::integer as message_count,
              coalesce((array_agg(message.content order by message.created_at desc, message.id desc))[1], '') as last_message
       from conversations conversation
       left join messages message on message.conversation_id = conversation.id
       where conversation.user_id = $1 and conversation.id = $2
       group by conversation.id`,
      [userId, conversationId],
    );
    const row = summary.rows[0];
    if (!row) return null;
    const messages = await this.pool.query<{
      id: string;
      role: "system" | "user" | "assistant";
      content: string;
      provider: string | null;
      model: string | null;
      created_at: Date;
    }>(
      `select id::text, role, content, provider, model, created_at
       from messages where conversation_id = $1 order by created_at, id`,
      [conversationId],
    );
    return {
      ...this.mapConversation(row),
      messages: messages.rows.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.provider ? { provider: message.provider } : {}),
        ...(message.model ? { model: message.model } : {}),
        createdAt: message.created_at.toISOString(),
      })),
    };
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

  async markApprovalExecuted(id: string, succeeded: boolean, output?: unknown): Promise<void> {
    await this.pool.query(
      `update approval_requests
       set status = $2, executed_at = now(), output = $3::jsonb
       where id = $1 and status = 'approved'`,
      [id, succeeded ? "executed" : "failed", JSON.stringify(output ?? null)],
    );
  }

  async listApprovals(userId: string, limit: number): Promise<ApprovalRequest[]> {
    const result = await this.pool.query<ApprovalRow>(
      `select id, user_id, tool_name, risk, summary, input, status, created_at, output
       from approval_requests where user_id = $1
       order by (status = 'pending') desc, created_at desc limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => this.mapApproval(row));
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
      attempts: number;
      max_attempts: number;
      result: unknown | null;
      error: string | null;
      created_at: Date;
    }>(
      `insert into jobs (user_id, job_type, input, scheduled_for)
       values ($1, $2, $3::jsonb, $4)
       returning id, user_id, job_type, input, status, scheduled_for, attempts,
                 max_attempts, result, error, created_at`,
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
      attempts: number;
      max_attempts: number;
      result: unknown | null;
      error: string | null;
      created_at: Date;
    }>(
      `select id, user_id, job_type, input, status, scheduled_for, attempts,
              max_attempts, result, error, created_at
       from jobs where user_id = $1
       order by created_at desc limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => this.mapJob(row));
  }

  async cancelJob(userId: string, id: string): Promise<DurableJob | null> {
    const result = await this.pool.query<JobRow>(
      `update jobs set status = 'cancelled', updated_at = now()
       where id = $1 and user_id = $2 and status in ('queued', 'waiting')
       returning id, user_id, job_type, input, status, scheduled_for, attempts,
                 max_attempts, result, error, created_at`,
      [id, userId],
    );
    return result.rows[0] ? this.mapJob(result.rows[0]) : null;
  }

  async retryJob(userId: string, id: string): Promise<DurableJob | null> {
    const result = await this.pool.query<JobRow>(
      `update jobs
       set status = 'queued', scheduled_for = now(), attempts = 0,
           result = null, error = null, worker_id = null, locked_at = null, updated_at = now()
       where id = $1 and user_id = $2 and status in ('failed', 'cancelled')
       returning id, user_id, job_type, input, status, scheduled_for, attempts,
                 max_attempts, result, error, created_at`,
      [id, userId],
    );
    return result.rows[0] ? this.mapJob(result.rows[0]) : null;
  }

  async getDashboardStats(userId?: string): Promise<DashboardStats> {
    const result = await this.pool.query<{
      conversations: string;
      messages: string;
      queued_jobs: string;
      failed_jobs: string;
      pending_approvals: string;
      input_tokens: string;
      output_tokens: string;
      total_tokens: string;
      cost_microusd: string;
    }>(
      `select
         (select count(*) from conversations where ($1::text is null or user_id = $1)) as conversations,
         (select count(*) from messages message join conversations conversation on conversation.id = message.conversation_id
           where ($1::text is null or conversation.user_id = $1)) as messages,
         (select count(*) from jobs where status in ('queued', 'running', 'waiting') and ($1::text is null or user_id = $1)) as queued_jobs,
         (select count(*) from jobs where status = 'failed' and ($1::text is null or user_id = $1)) as failed_jobs,
         (select count(*) from approval_requests where status = 'pending' and ($1::text is null or user_id = $1)) as pending_approvals,
         (select coalesce(sum(message.input_tokens), 0) from messages message join conversations conversation on conversation.id = message.conversation_id
           where ($1::text is null or conversation.user_id = $1)) as input_tokens,
         (select coalesce(sum(message.output_tokens), 0) from messages message join conversations conversation on conversation.id = message.conversation_id
           where ($1::text is null or conversation.user_id = $1)) as output_tokens,
         (select coalesce(sum(message.total_tokens), 0) from messages message join conversations conversation on conversation.id = message.conversation_id
           where ($1::text is null or conversation.user_id = $1)) as total_tokens,
         (select coalesce(sum(message.cost_microusd), 0) from messages message join conversations conversation on conversation.id = message.conversation_id
           where ($1::text is null or conversation.user_id = $1)) as cost_microusd`,
      [userId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Dashboard query returned no row");
    return {
      conversations: Number(row.conversations),
      messages: Number(row.messages),
      queuedJobs: Number(row.queued_jobs),
      failedJobs: Number(row.failed_jobs),
      pendingApprovals: Number(row.pending_approvals),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      estimatedCostUsd: Number(row.cost_microusd) / 1_000_000,
    };
  }

  async claimJobs(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<DurableJob[]> {
    const result = await this.pool.query<JobRow>(
      `with exhausted as (
         update jobs
         set status = 'failed', error = 'Worker lease expired after maximum attempts',
             worker_id = null, locked_at = null, updated_at = now()
         where status = 'running'
           and locked_at < now() - make_interval(secs => $3)
           and attempts >= max_attempts
         returning id
       ), candidates as (
         select id
         from jobs
         where (
           (status = 'queued' and scheduled_for <= now())
           or (status = 'running' and locked_at < now() - make_interval(secs => $3))
         )
         and attempts < max_attempts
         order by scheduled_for, created_at
         for update skip locked
         limit $2
       )
       update jobs as job
       set status = 'running', worker_id = $1, locked_at = now(),
           attempts = job.attempts + 1, updated_at = now(), error = null
       from candidates
       where job.id = candidates.id
       returning job.id, job.user_id, job.job_type, job.input, job.status,
                 job.scheduled_for, job.attempts, job.max_attempts, job.result,
                 job.error, job.created_at`,
      [input.workerId, input.limit, input.leaseSeconds],
    );
    return result.rows.map((row) => this.mapJob(row));
  }

  async completeJob(input: { id: string; workerId: string; result: unknown }): Promise<boolean> {
    const result = await this.pool.query(
      `update jobs
       set status = 'completed', result = $3::jsonb, error = null,
           worker_id = null, locked_at = null, updated_at = now()
       where id = $1 and worker_id = $2 and status = 'running'`,
      [input.id, input.workerId, JSON.stringify(input.result ?? null)],
    );
    return result.rowCount === 1;
  }

  async failJob(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt?: Date;
  }): Promise<"queued" | "failed" | null> {
    const result = await this.pool.query<{ status: "queued" | "failed" }>(
      `update jobs
       set status = case when attempts < max_attempts and $4::timestamptz is not null
                         then 'queued' else 'failed' end,
           scheduled_for = coalesce($4::timestamptz, scheduled_for),
           error = $3, worker_id = null, locked_at = null, updated_at = now()
       where id = $1 and worker_id = $2 and status = 'running'
       returning status`,
      [input.id, input.workerId, input.error, input.retryAt ?? null],
    );
    return result.rows[0]?.status ?? null;
  }

  async createAgentRun(input: {
    userId: string;
    conversationId: string;
    messages: AgentRunRecord["messages"];
    conversationMessages?: AgentRunRecord["conversationMessages"];
    taskClass: AgentRunRecord["taskClass"];
    allowedTools?: string[];
    maxSteps: number;
    maxTotalTokens?: number;
  }): Promise<AgentRunRecord> {
    const result = await this.pool.query<AgentRunRow>(
      `insert into agent_runs
        (user_id, conversation_id, messages, conversation_messages, task_class, allowed_tools, max_steps, max_total_tokens)
       values ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7, $8)
       returning *`,
      [
        input.userId,
        input.conversationId,
        JSON.stringify(input.messages),
        JSON.stringify(input.conversationMessages ?? input.messages),
        input.taskClass,
        input.allowedTools ? JSON.stringify(input.allowedTools) : null,
        input.maxSteps,
        input.maxTotalTokens ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Agent run insert returned no row");
    return this.mapAgentRun(row);
  }

  async enqueueAgentRun(input: {
    userId: string;
    conversationId: string;
    messages: AgentRunRecord["messages"];
    conversationMessages: AgentRunRecord["conversationMessages"];
    delivery?: AgentRunRecord["delivery"];
    taskClass: AgentRunRecord["taskClass"];
    allowedTools?: string[];
    maxSteps: number;
    maxTotalTokens?: number;
    scheduledFor?: Date;
  }): Promise<AgentRunRecord> {
    const result = await this.pool.query<AgentRunRow>(
      `insert into agent_runs
        (user_id, conversation_id, status, messages, conversation_messages, delivery, task_class,
         allowed_tools, max_steps, max_total_tokens, scheduled_for)
       values ($1, $2, 'queued', $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $9, $10)
       returning *`,
      [
        input.userId,
        input.conversationId,
        JSON.stringify(input.messages),
        JSON.stringify(input.conversationMessages),
        input.delivery ? JSON.stringify(input.delivery) : null,
        input.taskClass,
        input.allowedTools ? JSON.stringify(input.allowedTools) : null,
        input.maxSteps,
        input.maxTotalTokens ?? null,
        input.scheduledFor ?? new Date(),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Agent run enqueue returned no row");
    return this.mapAgentRun(row);
  }

  async getAgentRun(userId: string, id: string): Promise<AgentRunRecord | null> {
    const result = await this.pool.query<AgentRunRow>(
      `select * from agent_runs where id = $1 and user_id = $2`,
      [id, userId],
    );
    return result.rows[0] ? this.mapAgentRun(result.rows[0]) : null;
  }

  async findAgentRunByApproval(userId: string, approvalId: string): Promise<AgentRunRecord | null> {
    const result = await this.pool.query<AgentRunRow>(
      `select * from agent_runs where pending_approval_id = $1 and user_id = $2`,
      [approvalId, userId],
    );
    return result.rows[0] ? this.mapAgentRun(result.rows[0]) : null;
  }

  async listAgentRuns(userId: string, limit: number): Promise<AgentRunRecord[]> {
    const result = await this.pool.query<AgentRunRow>(
      `select * from agent_runs where user_id = $1 order by created_at desc limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => this.mapAgentRun(row));
  }

  async updateAgentRun(input: {
    id: string;
    userId: string;
    status: AgentRunStatus;
    continuation?: AgentRunRecord["continuation"];
    pendingApprovalId?: string;
    result?: AgentRunRecord["result"];
    error?: string;
    workerId?: string;
  }): Promise<AgentRunRecord | null> {
    const result = await this.pool.query<AgentRunRow>(
      `update agent_runs
       set status = $3,
           continuation = case
             when $3 in ('running', 'waiting_approval') then coalesce($4::jsonb, continuation)
             else null end,
           pending_approval_id = case when $3 = 'waiting_approval' then $5::uuid else null end,
           result = $6::jsonb, error = $7,
           worker_id = case when $3 = 'running' then worker_id else null end,
           locked_at = case when $3 = 'running' then locked_at else null end,
           updated_at = now()
       where id = $1 and user_id = $2
         and status <> 'cancelled'
         and ($8::text is null or worker_id = $8)
         and (status = 'running' or (status = 'waiting_approval' and $3 = 'running'))
       returning *`,
      [
        input.id,
        input.userId,
        input.status,
        input.continuation ? JSON.stringify(input.continuation) : null,
        input.pendingApprovalId ?? null,
        input.result ? JSON.stringify(input.result) : null,
        input.error ?? null,
        input.workerId ?? null,
      ],
    );
    return result.rows[0] ? this.mapAgentRun(result.rows[0]) : null;
  }

  async cancelAgentRun(userId: string, id: string): Promise<AgentRunRecord | null> {
    const result = await this.pool.query<AgentRunRow>(
      `with target as (
         select id, pending_approval_id from agent_runs
         where id = $1 and user_id = $2 and status in ('queued', 'running', 'waiting_approval')
         for update
       ), rejected as (
         update approval_requests approval
         set status = 'rejected', decided_at = now()
         from target
         where approval.id = target.pending_approval_id and approval.status = 'pending'
       )
       update agent_runs run
       set status = 'cancelled', pending_approval_id = null,
           worker_id = null, locked_at = null, updated_at = now()
       from target
       where run.id = target.id
       returning run.*`,
      [id, userId],
    );
    return result.rows[0] ? this.mapAgentRun(result.rows[0]) : null;
  }

  async appendAgentRunEvent(input: {
    runId: string;
    step: number;
    eventType: string;
    details?: unknown;
  }): Promise<void> {
    await this.pool.query(
      `insert into agent_run_events (run_id, step, event_type, details)
       values ($1, $2, $3, $4::jsonb)`,
      [input.runId, input.step, input.eventType, JSON.stringify(input.details ?? {})],
    );
  }

  async listAgentRunEvents(userId: string, runId: string): Promise<AgentRunEvent[]> {
    const result = await this.pool.query<{
      id: string;
      run_id: string;
      step: number;
      event_type: string;
      details: unknown;
      created_at: Date;
    }>(
      `select event.id, event.run_id, event.step, event.event_type, event.details, event.created_at
       from agent_run_events event
       join agent_runs run on run.id = event.run_id
       where event.run_id = $1 and run.user_id = $2
       order by event.id`,
      [runId, userId],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      runId: row.run_id,
      step: row.step,
      eventType: row.event_type,
      details: row.details,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async getApprovalOutcome(userId: string, approvalId: string): Promise<{
    status: ApprovalRequest["status"];
    output?: unknown;
  } | null> {
    const result = await this.pool.query<{ status: ApprovalRequest["status"]; output: unknown | null }>(
      `select status, output from approval_requests where id = $1 and user_id = $2`,
      [approvalId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return row.output === null ? { status: row.status } : { status: row.status, output: row.output };
  }

  async listReadyAgentRuns(limit: number): Promise<AgentRunRecord[]> {
    const result = await this.pool.query<AgentRunRow>(
      `select run.*
       from agent_runs run
       join approval_requests approval on approval.id = run.pending_approval_id
       where run.status = 'waiting_approval' and approval.status in ('executed', 'rejected')
       order by run.updated_at
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => this.mapAgentRun(row));
  }

  async claimAgentRuns(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<AgentRunRecord[]> {
    const result = await this.pool.query<AgentRunRow>(
      `with exhausted as (
         update agent_runs
         set status = 'failed', error = 'Agent run lease expired after maximum attempts',
             worker_id = null, locked_at = null, updated_at = now()
         where status = 'running'
           and locked_at < now() - make_interval(secs => $3)
           and attempts >= max_attempts
       ), candidates as (
         select id from agent_runs
         where (
           (status = 'queued' and scheduled_for <= now())
           or (status = 'running' and locked_at < now() - make_interval(secs => $3))
         )
         and attempts < max_attempts
         order by scheduled_for, created_at
         for update skip locked
         limit $2
       )
       update agent_runs run
       set status = 'running', worker_id = $1, locked_at = now(),
           attempts = run.attempts + 1, error = null, updated_at = now()
       from candidates
       where run.id = candidates.id
       returning run.*`,
      [input.workerId, input.limit, input.leaseSeconds],
    );
    return result.rows.map((row) => this.mapAgentRun(row));
  }

  async failClaimedAgentRun(input: {
    id: string;
    workerId: string;
    error: string;
    retryAt?: Date;
  }): Promise<"queued" | "failed" | null> {
    const result = await this.pool.query<{ status: "queued" | "failed" }>(
      `update agent_runs
       set status = case when attempts < max_attempts and $4::timestamptz is not null
                         then 'queued' else 'failed' end,
           scheduled_for = coalesce($4::timestamptz, scheduled_for),
           error = $3, worker_id = null, locked_at = null, updated_at = now()
       where id = $1 and worker_id = $2 and status = 'running'
       returning status`,
      [input.id, input.workerId, input.error, input.retryAt ?? null],
    );
    return result.rows[0]?.status ?? null;
  }

  async consumeQuota(input: {
    userId: string;
    category: QuotaCategory;
    periodStart: string;
    limit: number;
  }): Promise<{ allowed: boolean; used: number; limit: number }> {
    const result = await this.pool.query<{ count: number; allowed: boolean }>(
      `with consumed as (
         insert into usage_counters (user_id, category, period_start, count)
         values ($1, $2, $3::date, 1)
         on conflict (user_id, category, period_start) do update
           set count = usage_counters.count + 1, updated_at = now()
           where usage_counters.count < $4
         returning count
       )
       select count, true as allowed from consumed
       union all
       select count, false as allowed
       from usage_counters
       where user_id = $1 and category = $2 and period_start = $3::date
         and not exists (select 1 from consumed)
       limit 1`,
      [input.userId, input.category, input.periodStart, input.limit],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Quota update returned no row");
    return { allowed: row.allowed, used: row.count, limit: input.limit };
  }

  async appendTrace(input: {
    traceId: string;
    userId: string;
    operation: string;
    status: TraceStatus;
    details?: unknown;
  }): Promise<void> {
    await this.pool.query(
      `insert into trace_events (trace_id, user_id, operation, status, details)
       values ($1::uuid, $2, $3, $4, $5::jsonb)`,
      [input.traceId, input.userId, input.operation, input.status, JSON.stringify(input.details ?? {})],
    );
  }

  async listTraces(userId: string, limit: number): Promise<TraceEvent[]> {
    const result = await this.pool.query<{
      trace_id: string;
      user_id: string;
      operation: string;
      status: TraceStatus;
      details: unknown;
      created_at: Date;
    }>(
      `select trace_id, user_id, operation, status, details, created_at
       from trace_events where user_id = $1 order by created_at desc limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      traceId: row.trace_id,
      userId: row.user_id,
      operation: row.operation,
      status: row.status,
      details: row.details,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async findAccountByEmail(email: string): Promise<StoredAccount | null> {
    const result = await this.pool.query<AccountRow>(
      `select id, email, display_name, role, password_hash, password_salt, active, created_at
       from user_accounts where email = $1`,
      [email],
    );
    const row = result.rows[0];
    return row ? this.mapStoredAccount(row) : null;
  }

  async createAccount(input: {
    email: string;
    displayName: string;
    role: AccountRole;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<UserAccount> {
    const result = await this.pool.query<AccountRow>(
      `insert into user_accounts (email, display_name, role, password_hash, password_salt)
       values ($1, $2, $3, $4, $5)
       returning id, email, display_name, role, password_hash, password_salt, active, created_at`,
      [input.email, input.displayName, input.role, input.passwordHash, input.passwordSalt],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Account insert returned no row");
    return this.mapAccount(row);
  }

  async listAccounts(): Promise<UserAccount[]> {
    const result = await this.pool.query<AccountRow>(
      `select id, email, display_name, role, password_hash, password_salt, active, created_at
       from user_accounts order by created_at`,
    );
    return result.rows.map((row) => this.mapAccount(row));
  }

  async createSession(input: { accountId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await this.pool.query(
      `insert into user_sessions (account_id, token_hash, expires_at) values ($1, $2, $3)`,
      [input.accountId, input.tokenHash, input.expiresAt],
    );
  }

  async findSession(tokenHash: string): Promise<UserAccount | null> {
    const result = await this.pool.query<AccountRow>(
      `with touched as (
         update user_sessions set last_seen_at = now()
         where token_hash = $1 and expires_at > now()
         returning account_id
       )
       select account.id, account.email, account.display_name, account.role,
              account.password_hash, account.password_salt, account.active, account.created_at
       from touched
       join user_accounts account on account.id = touched.account_id
       where account.active = true`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? this.mapAccount(row) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query(`delete from user_sessions where token_hash = $1`, [tokenHash]);
  }

  async createTelegramLinkCode(input: {
    accountId: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `with invalidated as (
         update telegram_link_codes set used_at = now()
         where account_id = $1 and used_at is null
       )
       insert into telegram_link_codes (account_id, code_hash, expires_at)
       values ($1, $2, $3)`,
      [input.accountId, input.codeHash, input.expiresAt],
    );
  }

  async claimTelegramLink(input: {
    codeHash: string;
    telegramUserId: number;
    telegramChatId: number;
  }): Promise<TelegramLink | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const code = await client.query<{ account_id: string }>(
        `select account_id from telegram_link_codes
         where code_hash = $1 and used_at is null and expires_at > now()
         for update`,
        [input.codeHash],
      );
      const accountId = code.rows[0]?.account_id;
      if (!accountId) {
        await client.query("rollback");
        return null;
      }
      const existing = await client.query<{ account_id: string }>(
        `select account_id from telegram_links where telegram_user_id = $1 for update`,
        [input.telegramUserId],
      );
      if (existing.rows[0] && existing.rows[0].account_id !== accountId) {
        await client.query("rollback");
        return null;
      }
      await client.query(`delete from telegram_links where account_id = $1`, [accountId]);
      const linked = await client.query<TelegramLinkRow>(
        `insert into telegram_links (account_id, telegram_user_id, telegram_chat_id)
         values ($1, $2, $3)
         returning account_id, telegram_user_id, telegram_chat_id, created_at`,
        [accountId, input.telegramUserId, input.telegramChatId],
      );
      await client.query(
        `update telegram_link_codes set used_at = now() where code_hash = $1`,
        [input.codeHash],
      );
      await client.query("commit");
      return this.mapTelegramLink(linked.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getTelegramLink(accountId: string): Promise<TelegramLink | null> {
    const result = await this.pool.query<TelegramLinkRow>(
      `select account_id, telegram_user_id, telegram_chat_id, created_at
       from telegram_links where account_id = $1`,
      [accountId],
    );
    return result.rows[0] ? this.mapTelegramLink(result.rows[0]) : null;
  }

  async resolveTelegramAccount(telegramUserId: number): Promise<string | null> {
    const result = await this.pool.query<{ account_id: string }>(
      `select account_id from telegram_links where telegram_user_id = $1`,
      [telegramUserId],
    );
    return result.rows[0]?.account_id ?? null;
  }

  async deleteTelegramLink(accountId: string): Promise<boolean> {
    const result = await this.pool.query(`delete from telegram_links where account_id = $1`, [accountId]);
    return result.rowCount === 1;
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
    output?: unknown | null;
  }): ApprovalRequest {
    const approval: ApprovalRequest = {
      id: row.id,
      userId: row.user_id,
      toolName: row.tool_name,
      risk: row.risk,
      summary: row.summary,
      input: row.input,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    };
    if (row.output !== undefined && row.output !== null) approval.output = row.output;
    return approval;
  }

  private mapAgentRun(row: AgentRunRow): AgentRunRecord {
    const run: AgentRunRecord = {
      id: row.id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      status: row.status,
      messages: row.messages,
      conversationMessages: row.conversation_messages,
      taskClass: row.task_class,
      maxSteps: row.max_steps,
      scheduledFor: row.scheduled_for.toISOString(),
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
    if (row.allowed_tools) run.allowedTools = row.allowed_tools;
    if (row.delivery) run.delivery = row.delivery;
    if (row.max_total_tokens !== null) run.maxTotalTokens = row.max_total_tokens;
    if (row.continuation) run.continuation = row.continuation;
    if (row.pending_approval_id) run.pendingApprovalId = row.pending_approval_id;
    if (row.result) run.result = row.result;
    if (row.error) run.error = row.error;
    if (row.worker_id) run.workerId = row.worker_id;
    return run;
  }

  private mapJob(row: JobRow): DurableJob {
    const job: DurableJob = {
      id: row.id,
      userId: row.user_id,
      jobType: row.job_type,
      input: row.input,
      status: row.status,
      scheduledFor: row.scheduled_for.toISOString(),
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      createdAt: row.created_at.toISOString(),
    };
    if (row.result !== null) job.result = row.result;
    if (row.error !== null) job.error = row.error;
    return job;
  }

  private mapAccount(row: AccountRow): UserAccount {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      active: row.active,
      createdAt: row.created_at.toISOString(),
    };
  }

  private mapStoredAccount(row: AccountRow): StoredAccount {
    return {
      ...this.mapAccount(row),
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
    };
  }

  private mapConversation(row: ConversationRow): ConversationSummary {
    return {
      id: row.id,
      title: row.title,
      messageCount: row.message_count,
      lastMessage: row.last_message,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapTelegramLink(row: TelegramLinkRow): TelegramLink {
    return {
      accountId: row.account_id,
      telegramUserId: Number(row.telegram_user_id),
      telegramChatId: Number(row.telegram_chat_id),
      createdAt: row.created_at.toISOString(),
    };
  }
}

interface TelegramLinkRow {
  account_id: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  created_at: Date;
}

interface ApprovalRow {
  id: string;
  user_id: string;
  tool_name: string;
  risk: ApprovalRequest["risk"];
  summary: string;
  input: unknown;
  status: ApprovalRequest["status"];
  created_at: Date;
  output?: unknown | null;
}

interface AgentRunRow {
  id: string;
  user_id: string;
  conversation_id: string;
  status: AgentRunStatus;
  messages: AgentRunRecord["messages"];
  conversation_messages: AgentRunRecord["conversationMessages"];
  delivery: AgentRunRecord["delivery"] | null;
  task_class: AgentRunRecord["taskClass"];
  allowed_tools: string[] | null;
  max_steps: number;
  max_total_tokens: number | null;
  continuation: AgentRunRecord["continuation"] | null;
  pending_approval_id: string | null;
  result: AgentRunRecord["result"] | null;
  error: string | null;
  scheduled_for: Date;
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ConversationRow {
  id: string;
  title: string;
  message_count: number;
  last_message: string;
  created_at: Date;
  updated_at: Date;
}

interface JobRow {
  id: string;
  user_id: string;
  job_type: string;
  input: unknown;
  status: DurableJob["status"];
  scheduled_for: Date;
  attempts: number;
  max_attempts: number;
  result: unknown | null;
  error: string | null;
  created_at: Date;
}

interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  role: AccountRole;
  password_hash: string;
  password_salt: string;
  active: boolean;
  created_at: Date;
}
