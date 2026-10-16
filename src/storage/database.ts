import { Pool } from "pg";

import type { AccountRole, AuthStore, StoredAccount, UserAccount } from "../auth/service.js";
import type { AgentMessage, GenerateResult } from "../core/models.js";
import type { GovernanceStore, QuotaCategory, TraceEvent, TraceStatus } from "../governance/runtime.js";
import type { AgentStore, ApprovalRequest, DurableJob, MemoryEntry } from "./types.js";

export class Database implements AgentStore, GovernanceStore, AuthStore {
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
