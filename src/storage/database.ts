import { Pool } from "pg";

import type { AccountRole, AuthStore, StoredAccount, UserAccount } from "../auth/service.js";
import type { SupportedLanguageCode } from "../i18n/languages.js";
import type { TelegramLink, TelegramLinkStore } from "../auth/telegram-link.js";
import type { SemanticMemoryStore } from "../memory/semantic.js";
import type { SkillEvaluation, SkillStore, StoredSkill } from "../skills/manager.js";
import type {
  Organization,
  OrganizationMember,
  OrganizationPlan,
  OrganizationRole,
  OrganizationStore,
} from "../organizations/service.js";
import type {
  ConnectorProvider,
  ConnectorRecord,
  ConnectorStore,
  StoredConnector,
} from "../connectors/vault.js";
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
import type { AgentSchedule } from "../schedules/types.js";
import type { ArtifactVersion, Project, ProjectResource, ProjectResourceType, ProjectStore } from "../projects/service.js";

export class Database implements AgentStore, GovernanceStore, AuthStore, AgentRunStore, TelegramLinkStore, ConnectorStore, SemanticMemoryStore, OrganizationStore, SkillStore, ProjectStore {
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

  async createProject(input: { userId: string; name: string; description: string }): Promise<Project> {
    const result = await this.pool.query<ProjectRow>(
      `insert into projects (user_id, name, description) values ($1, $2, $3)
       returning id, user_id, name, description, status, created_at, updated_at`,
      [input.userId, input.name, input.description],
    );
    return mapProject(result.rows[0]!);
  }

  async listProjects(userId: string): Promise<Project[]> {
    const result = await this.pool.query<ProjectRow>(
      `select id, user_id, name, description, status, created_at, updated_at
       from projects where user_id = $1 order by updated_at desc, id`, [userId],
    );
    return result.rows.map(mapProject);
  }

  async getProject(userId: string, id: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `select id, user_id, name, description, status, created_at, updated_at
       from projects where user_id = $1 and id = $2`, [userId, id],
    );
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  async resourceBelongsToUser(userId: string, type: Exclude<ProjectResourceType, "file">, id: string): Promise<boolean> {
    const table = { conversation: "conversations", agent_run: "agent_runs", memory: "memories" }[type];
    const result = await this.pool.query(`select 1 from ${table} where user_id = $1 and id::text = $2`, [userId, id]);
    return result.rowCount === 1;
  }

  async attachProjectResource(input: { projectId: string; userId: string; type: ProjectResourceType; resourceId: string; label: string }): Promise<ProjectResource | null> {
    const result = await this.pool.query<ProjectResourceRow>(
      `insert into project_resources (project_id, user_id, resource_type, resource_id, label)
       select id, user_id, $3, $4, $5 from projects where id = $1 and user_id = $2
       on conflict (project_id, resource_type, resource_id) do update set label = excluded.label
       returning project_id, resource_type, resource_id, label, created_at`,
      [input.projectId, input.userId, input.type, input.resourceId, input.label],
    );
    return result.rows[0] ? mapProjectResource(result.rows[0]) : null;
  }

  async listProjectResources(userId: string, projectId: string): Promise<ProjectResource[]> {
    const result = await this.pool.query<ProjectResourceRow>(
      `select resource.project_id, resource.resource_type, resource.resource_id, resource.label, resource.created_at
       from project_resources resource join projects project on project.id = resource.project_id
       where project.user_id = $1 and project.id = $2 order by resource.created_at, resource.resource_type`, [userId, projectId],
    );
    return result.rows.map(mapProjectResource);
  }

  async createArtifactVersion(input: { projectId: string; userId: string; path: string; sha256: string; content: Buffer }): Promise<ArtifactVersion | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.projectId}:${input.path}`]);
      const result = await client.query<ArtifactRow>(
        `insert into project_artifact_versions (project_id, user_id, path, version, sha256, size_bytes, content)
         select project.id, project.user_id, $3,
           coalesce((select max(version) + 1 from project_artifact_versions where project_id = project.id and path = $3), 1),
           $4, $5, $6 from projects project where project.id = $1 and project.user_id = $2
         returning id, project_id, path, version, sha256, size_bytes, created_at`,
        [input.projectId, input.userId, input.path, input.sha256, input.content.byteLength, input.content],
      );
      await client.query("commit");
      return result.rows[0] ? mapArtifact(result.rows[0]) : null;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async listArtifactVersions(userId: string, projectId: string): Promise<ArtifactVersion[]> {
    const result = await this.pool.query<ArtifactRow>(
      `select artifact.id, artifact.project_id, artifact.path, artifact.version, artifact.sha256, artifact.size_bytes, artifact.created_at
       from project_artifact_versions artifact join projects project on project.id = artifact.project_id
       where project.user_id = $1 and project.id = $2 order by artifact.path, artifact.version desc`, [userId, projectId],
    );
    return result.rows.map(mapArtifact);
  }

  async getArtifactVersion(userId: string, projectId: string, id: string): Promise<(ArtifactVersion & { content: Buffer }) | null> {
    const result = await this.pool.query<ArtifactRow & { content: Buffer }>(
      `select artifact.id, artifact.project_id, artifact.path, artifact.version, artifact.sha256,
              artifact.size_bytes, artifact.created_at, artifact.content
       from project_artifact_versions artifact join projects project on project.id = artifact.project_id
       where project.user_id = $1 and project.id = $2 and artifact.id = $3`, [userId, projectId, id],
    );
    const row = result.rows[0];
    return row ? { ...mapArtifact(row), content: row.content } : null;
  }

  async listSkillVersions(): Promise<StoredSkill[]> {
    const result = await this.pool.query<SkillRow>(
      `select id, version, description, instructions, allowed_tools, active, created_by, created_at
       from skill_versions order by id, created_at, version`,
    );
    return result.rows.map(mapSkill);
  }

  async insertSkill(input: {
    id: string;
    version: string;
    description: string;
    instructions: string;
    allowedTools: string[];
    createdBy: string | null;
  }): Promise<StoredSkill> {
    const result = await this.pool.query<SkillRow>(
      `insert into skill_versions
         (id, version, description, instructions, allowed_tools, created_by)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       returning id, version, description, instructions, allowed_tools, active, created_by, created_at`,
      [input.id, input.version, input.description, input.instructions, JSON.stringify(input.allowedTools), input.createdBy],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Skill insert returned no row");
    return mapSkill(row);
  }

  async saveSkillEvaluation(input: Omit<SkillEvaluation, "createdAt">): Promise<SkillEvaluation> {
    const result = await this.pool.query<SkillEvaluationRow>(
      `insert into skill_evaluations
         (id, skill_id, skill_version, passed, passed_cases, total_cases, details, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       returning id, skill_id, skill_version, passed, passed_cases, total_cases, details, created_by, created_at`,
      [
        input.id,
        input.skillId,
        input.skillVersion,
        input.passed,
        input.passedCases,
        input.totalCases,
        JSON.stringify(input.details),
        input.createdBy,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Skill evaluation insert returned no row");
    return mapSkillEvaluation(row);
  }

  async latestSkillEvaluation(skillId: string, version: string): Promise<SkillEvaluation | null> {
    const result = await this.pool.query<SkillEvaluationRow>(
      `select id, skill_id, skill_version, passed, passed_cases, total_cases, details, created_by, created_at
       from skill_evaluations where skill_id = $1 and skill_version = $2
       order by created_at desc, id desc limit 1`,
      [skillId, version],
    );
    const row = result.rows[0];
    return row ? mapSkillEvaluation(row) : null;
  }

  async activateSkill(skillId: string, version: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("update skill_versions set active = false where id = $1 and active", [skillId]);
      const result = await client.query(
        "update skill_versions set active = true where id = $1 and version = $2",
        [skillId, version],
      );
      if (result.rowCount !== 1) {
        await client.query("rollback");
        return false;
      }
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createOrganization(input: {
    name: string;
    slug: string;
    plan: OrganizationPlan;
    ownerId: string;
  }): Promise<Organization> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const created = await client.query<OrganizationRow>(
        `insert into organizations (name, slug, plan, created_by)
         values ($1, $2, $3, $4)
         returning id, name, slug, plan, created_at`,
        [input.name, input.slug, input.plan, input.ownerId],
      );
      const row = created.rows[0];
      if (!row) throw new Error("Organization insert returned no row");
      await client.query(
        `insert into organization_members (organization_id, account_id, role) values ($1, $2, 'owner')`,
        [row.id, input.ownerId],
      );
      await client.query("commit");
      return mapOrganization(row, "owner");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listOrganizations(accountId: string): Promise<Organization[]> {
    const result = await this.pool.query<OrganizationRow & { role: OrganizationRole }>(
      `select organization.id, organization.name, organization.slug, organization.plan,
              organization.created_at, membership.role
       from organization_members membership
       join organizations organization on organization.id = membership.organization_id
       where membership.account_id = $1
       order by organization.created_at, organization.id`,
      [accountId],
    );
    return result.rows.map((row) => mapOrganization(row, row.role));
  }

  async getOrganizationRole(organizationId: string, accountId: string): Promise<OrganizationRole | null> {
    const result = await this.pool.query<{ role: OrganizationRole }>(
      `select role from organization_members where organization_id = $1 and account_id = $2`,
      [organizationId, accountId],
    );
    return result.rows[0]?.role ?? null;
  }

  async listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
    const result = await this.pool.query<OrganizationMemberRow>(
      `select account.id as account_id, account.email, account.display_name,
              membership.role, membership.created_at
       from organization_members membership
       join user_accounts account on account.id = membership.account_id
       where membership.organization_id = $1
       order by membership.created_at, account.id`,
      [organizationId],
    );
    return result.rows.map(mapOrganizationMember);
  }

  async upsertOrganizationMember(input: {
    organizationId: string;
    accountId: string;
    role: Exclude<OrganizationRole, "owner">;
  }): Promise<OrganizationMember> {
    const result = await this.pool.query<OrganizationMemberRow>(
      `with membership as (
         insert into organization_members (organization_id, account_id, role)
         values ($1, $2, $3)
         on conflict (organization_id, account_id) do update set
           role = excluded.role, updated_at = now()
         returning account_id, role, created_at
       )
       select membership.account_id, account.email, account.display_name,
              membership.role, membership.created_at
       from membership join user_accounts account on account.id = membership.account_id`,
      [input.organizationId, input.accountId, input.role],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Organization member upsert returned no row");
    return mapOrganizationMember(row);
  }

  async updateOrganizationPlan(organizationId: string, plan: OrganizationPlan): Promise<void> {
    const result = await this.pool.query(
      `update organizations set plan = $2, updated_at = now() where id = $1`,
      [organizationId, plan],
    );
    if (result.rowCount !== 1) throw new Error("Organization not found");
  }

  async upsertConnector(input: {
    userId: string;
    provider: ConnectorProvider;
    label: string;
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
    keyVersion: number;
    metadata: Record<string, unknown>;
  }): Promise<ConnectorRecord> {
    const result = await this.pool.query<ConnectorRow>(
      `insert into connector_credentials
         (user_id, provider, label, ciphertext, iv, auth_tag, key_version, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (user_id, provider, label) do update set
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         auth_tag = excluded.auth_tag,
         key_version = excluded.key_version,
         metadata = excluded.metadata,
         updated_at = now()
       returning id, user_id, provider, label, metadata, key_version, created_at, updated_at`,
      [
        input.userId,
        input.provider,
        input.label,
        input.ciphertext,
        input.iv,
        input.authTag,
        input.keyVersion,
        JSON.stringify(input.metadata),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Connector upsert returned no row");
    return mapConnector(row);
  }

  async listConnectors(userId: string): Promise<ConnectorRecord[]> {
    const result = await this.pool.query<ConnectorRow>(
      `select id, user_id, provider, label, metadata, key_version, created_at, updated_at
       from connector_credentials where user_id = $1 order by updated_at desc, id`,
      [userId],
    );
    return result.rows.map(mapConnector);
  }

  async getConnector(userId: string, id: string): Promise<StoredConnector | null> {
    const result = await this.pool.query<ConnectorRow & {
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
    }>(
      `select id, user_id, provider, label, metadata, key_version, created_at, updated_at,
              ciphertext, iv, auth_tag
       from connector_credentials where user_id = $1 and id = $2`,
      [userId, id],
    );
    const row = result.rows[0];
    return row ? { ...mapConnector(row), ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag } : null;
  }

  async deleteConnector(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `delete from connector_credentials where user_id = $1 and id = $2`,
      [userId, id],
    );
    return result.rowCount === 1;
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

  async rememberEmbedded(input: {
    userId: string;
    content: string;
    category: string;
    importance: number;
    embedding: number[];
    embeddingModel: string;
  }): Promise<MemoryEntry> {
    const result = await this.pool.query<MemoryRow>(
      `insert into memories (user_id, content, category, importance, embedding, embedding_model)
       values ($1, $2, $3, $4, $5::real[], $6)
       returning id, user_id, content, category, importance, created_at`,
      [input.userId, input.content, input.category, input.importance, input.embedding, input.embeddingModel],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Semantic memory insert returned no row");
    return mapMemory(row);
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

    return result.rows.map(mapMemory);
  }

  async recallSemantic(userId: string, embedding: number[], limit: number): Promise<MemoryEntry[]> {
    const result = await this.pool.query<MemoryRow>(
      `select memory.id, memory.user_id, memory.content, memory.category,
              memory.importance, memory.created_at,
              coalesce((
                select sum(item.value * query.value) /
                  nullif(sqrt(sum(item.value * item.value)) * sqrt(sum(query.value * query.value)), 0)
                from unnest(memory.embedding) with ordinality as item(value, position)
                join unnest($2::real[]) with ordinality as query(value, position) using (position)
              ), 0) as similarity
       from memories memory
       where memory.user_id = $1
         and memory.embedding is not null
         and cardinality(memory.embedding) = cardinality($2::real[])
         and (memory.expires_at is null or memory.expires_at > now())
       order by similarity desc, memory.importance desc, memory.created_at desc
       limit $3`,
      [userId, embedding, limit],
    );
    return result.rows.map(mapMemory);
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

  async createSchedule(input: Omit<AgentSchedule, "id" | "status" | "nextRunAt" | "lastRunAt" | "lastError" | "createdAt"> & { nextRunAt: Date }): Promise<AgentSchedule> {
    const result = await this.pool.query<ScheduleRow>(
      `insert into schedules
        (user_id, name, objective, cron_expression, timezone, task_class, allowed_tools,
         max_steps, max_total_tokens, delivery_channel, next_run_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11) returning *`,
      [input.userId, input.name, input.objective, input.cronExpression, input.timezone, input.taskClass,
        input.allowedTools ? JSON.stringify(input.allowedTools) : null, input.maxSteps, input.maxTotalTokens,
        input.deliveryChannel, input.nextRunAt],
    );
    if (!result.rows[0]) throw new Error("Schedule insert returned no row");
    return this.mapSchedule(result.rows[0]);
  }

  async listSchedules(userId: string, limit: number): Promise<AgentSchedule[]> {
    const result = await this.pool.query<ScheduleRow>(
      `select * from schedules where user_id = $1 order by created_at desc limit $2`, [userId, limit],
    );
    return result.rows.map((row) => this.mapSchedule(row));
  }

  async setScheduleStatus(userId: string, id: string, status: "active" | "paused" | "disabled", nextRunAt?: Date): Promise<AgentSchedule | null> {
    const result = await this.pool.query<ScheduleRow>(
      `update schedules set status=$3, next_run_at=coalesce($4,next_run_at), worker_id=null, locked_at=null, updated_at=now()
       where id=$1 and user_id=$2 and status <> 'disabled' returning *`, [id, userId, status, nextRunAt ?? null],
    );
    return result.rows[0] ? this.mapSchedule(result.rows[0]) : null;
  }

  async claimDueSchedules(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<AgentSchedule[]> {
    const result = await this.pool.query<ScheduleRow>(
      `with candidates as (
         select id from schedules where status='active' and next_run_at <= now()
           and (locked_at is null or locked_at < now() - make_interval(secs => $3))
         order by next_run_at for update skip locked limit $2
       )
       update schedules s set worker_id=$1, locked_at=now(), updated_at=now()
       from candidates where s.id=candidates.id returning s.*`, [input.workerId, input.limit, input.leaseSeconds],
    );
    return result.rows.map((row) => this.mapSchedule(row));
  }

  async advanceSchedule(input: { id: string; workerId: string; occurrence: Date; nextRunAt: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `update schedules set last_run_at=$3, next_run_at=$4, worker_id=null, locked_at=null, last_error=null, updated_at=now()
       where id=$1 and worker_id=$2 and status='active' and next_run_at=$3`,
      [input.id, input.workerId, input.occurrence, input.nextRunAt],
    );
    return result.rowCount === 1;
  }

  async failSchedule(input: { id: string; workerId: string; error: string; retryAt: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `update schedules set next_run_at=$4, worker_id=null, locked_at=null, last_error=$3, updated_at=now()
       where id=$1 and worker_id=$2 and status='active'`, [input.id, input.workerId, input.error, input.retryAt],
    );
    return result.rowCount === 1;
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
    scheduleId?: string;
    scheduleOccurrence?: Date;
  }): Promise<AgentRunRecord> {
    const result = await this.pool.query<AgentRunRow>(
      `insert into agent_runs
        (user_id, conversation_id, status, messages, conversation_messages, delivery, task_class,
         allowed_tools, max_steps, max_total_tokens, scheduled_for, schedule_id, schedule_occurrence)
       values ($1, $2, 'queued', $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11, $12)
       on conflict (schedule_id, schedule_occurrence) where schedule_id is not null and schedule_occurrence is not null
       do update set updated_at = agent_runs.updated_at
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
        input.scheduleId ?? null,
        input.scheduleOccurrence ?? null,
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
      `select id, email, display_name, role, password_hash, password_salt, active, language_code, created_at
       from user_accounts where email = $1`,
      [email],
    );
    const row = result.rows[0];
    return row ? this.mapStoredAccount(row) : null;
  }

  async findAccountById(id: string): Promise<UserAccount | null> {
    const result = await this.pool.query<AccountRow>(
      `select id, email, display_name, role, password_hash, password_salt, active, language_code, created_at
       from user_accounts where id = $1 and active = true`,
      [id],
    );
    const row = result.rows[0];
    return row ? this.mapAccount(row) : null;
  }

  async createAccount(input: {
    email: string;
    displayName: string;
    role: AccountRole;
    passwordHash: string;
    passwordSalt: string;
    languageCode?: SupportedLanguageCode;
  }): Promise<UserAccount> {
    const result = await this.pool.query<AccountRow>(
      `insert into user_accounts (email, display_name, role, password_hash, password_salt, language_code)
       values ($1, $2, $3, $4, $5, $6)
       returning id, email, display_name, role, password_hash, password_salt, active, language_code, created_at`,
      [input.email, input.displayName, input.role, input.passwordHash, input.passwordSalt, input.languageCode ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Account insert returned no row");
    return this.mapAccount(row);
  }

  async listAccounts(): Promise<UserAccount[]> {
    const result = await this.pool.query<AccountRow>(
      `select id, email, display_name, role, password_hash, password_salt, active, language_code, created_at
       from user_accounts order by created_at`,
    );
    return result.rows.map((row) => this.mapAccount(row));
  }

  async updateAccountLanguage(accountId: string, languageCode: SupportedLanguageCode): Promise<UserAccount | null> {
    const result = await this.pool.query<AccountRow>(
      `update user_accounts set language_code = $2, updated_at = now()
       where id = $1 and active = true
       returning id, email, display_name, role, password_hash, password_salt, active, language_code, created_at`,
      [accountId, languageCode],
    );
    const row = result.rows[0];
    return row ? this.mapAccount(row) : null;
  }

  async createPasswordReset(input: { accountId: string; codeHash: string; expiresAt: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `with invalidated as (
         update password_reset_codes set used_at = now()
         where account_id = $1 and used_at is null
       )
       insert into password_reset_codes (account_id, code_hash, expires_at)
       select id, $2, $3 from user_accounts where id = $1`,
      [input.accountId, input.codeHash, input.expiresAt],
    );
    return result.rowCount === 1;
  }

  async consumePasswordReset(input: {
    codeHash: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const reset = await client.query<{ id: string; account_id: string }>(
        `select id, account_id from password_reset_codes
         where code_hash = $1 and used_at is null and expires_at > now()
         for update`,
        [input.codeHash],
      );
      const row = reset.rows[0];
      if (!row) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        `update user_accounts set password_hash = $2, password_salt = $3, updated_at = now()
         where id = $1`,
        [row.account_id, input.passwordHash, input.passwordSalt],
      );
      await client.query(`update password_reset_codes set used_at = now() where id = $1`, [row.id]);
      await client.query(`delete from user_sessions where account_id = $1`, [row.account_id]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
              account.password_hash, account.password_salt, account.active,
              account.language_code, account.created_at
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
    if (row.schedule_id) run.scheduleId = row.schedule_id;
    if (row.schedule_occurrence) run.scheduleOccurrence = row.schedule_occurrence.toISOString();
    return run;
  }

  private mapSchedule(row: ScheduleRow): AgentSchedule {
    return {
      id: row.id, userId: row.user_id, name: row.name, objective: row.objective,
      cronExpression: row.cron_expression, timezone: row.timezone, taskClass: row.task_class,
      ...(row.allowed_tools ? { allowedTools: row.allowed_tools } : {}),
      maxSteps: row.max_steps, maxTotalTokens: row.max_total_tokens,
      deliveryChannel: row.delivery_channel, status: row.status,
      nextRunAt: row.next_run_at.toISOString(), ...(row.last_run_at ? { lastRunAt: row.last_run_at.toISOString() } : {}),
      ...(row.last_error ? { lastError: row.last_error } : {}), createdAt: row.created_at.toISOString(),
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
      languageCode: row.language_code,
      languageConfigured: row.language_code !== null,
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

interface ConnectorRow {
  id: string;
  user_id: string;
  provider: ConnectorProvider;
  label: string;
  metadata: Record<string, unknown>;
  key_version: number;
  created_at: Date;
  updated_at: Date;
}

interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  category: string;
  importance: number;
  created_at: Date;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  plan: OrganizationPlan;
  created_at: Date;
}

interface OrganizationMemberRow {
  account_id: string;
  email: string;
  display_name: string;
  role: OrganizationRole;
  created_at: Date;
}

function mapOrganization(row: OrganizationRow, role: OrganizationRole): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    role,
    createdAt: row.created_at.toISOString(),
  };
}

function mapOrganizationMember(row: OrganizationMemberRow): OrganizationMember {
  return {
    accountId: row.account_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

function mapMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    category: row.category,
    importance: row.importance,
    createdAt: row.created_at.toISOString(),
  };
}

function mapConnector(row: ConnectorRow): ConnectorRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    label: row.label,
    metadata: row.metadata,
    keyVersion: row.key_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
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
  schedule_id: string | null;
  schedule_occurrence: Date | null;
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

interface ScheduleRow {
  id: string; user_id: string; name: string; objective: string; cron_expression: string; timezone: string;
  task_class: AgentSchedule["taskClass"]; allowed_tools: string[] | null; max_steps: number; max_total_tokens: number;
  delivery_channel: AgentSchedule["deliveryChannel"]; status: AgentSchedule["status"]; next_run_at: Date;
  last_run_at: Date | null; last_error: string | null; created_at: Date;
}

interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  role: AccountRole;
  password_hash: string;
  password_salt: string;
  active: boolean;
  language_code: SupportedLanguageCode | null;
  created_at: Date;
}

interface SkillRow {
  id: string;
  version: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  active: boolean;
  created_by: string | null;
  created_at: Date;
}

interface SkillEvaluationRow {
  id: string;
  skill_id: string;
  skill_version: string;
  passed: boolean;
  passed_cases: number;
  total_cases: number;
  details: SkillEvaluation["details"];
  created_by: string | null;
  created_at: Date;
}

interface ProjectRow { id: string; user_id: string; name: string; description: string; status: Project["status"]; created_at: Date; updated_at: Date }
interface ProjectResourceRow { project_id: string; resource_type: ProjectResourceType; resource_id: string; label: string; created_at: Date }
interface ArtifactRow { id: string; project_id: string; path: string; version: number; sha256: string; size_bytes: number; created_at: Date }

function mapProject(row: ProjectRow): Project {
  return { id: row.id, userId: row.user_id, name: row.name, description: row.description, status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

function mapProjectResource(row: ProjectResourceRow): ProjectResource {
  return { projectId: row.project_id, type: row.resource_type, id: row.resource_id, label: row.label, createdAt: row.created_at.toISOString() };
}

function mapArtifact(row: ArtifactRow): ArtifactVersion {
  return { id: row.id, projectId: row.project_id, path: row.path, version: row.version, sha256: row.sha256, bytes: row.size_bytes, createdAt: row.created_at.toISOString() };
}

function mapSkill(row: SkillRow): StoredSkill {
  return {
    id: row.id,
    version: row.version,
    description: row.description,
    instructions: row.instructions,
    allowedTools: row.allowed_tools,
    active: row.active,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

function mapSkillEvaluation(row: SkillEvaluationRow): SkillEvaluation {
  return {
    id: row.id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    passed: row.passed,
    passedCases: row.passed_cases,
    totalCases: row.total_cases,
    details: row.details,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}
