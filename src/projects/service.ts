import { createHash } from "node:crypto";

import type { FileWorkspace } from "../tools/file-workspace.js";
import type { AgentRunRecord } from "../runs/types.js";

export type ProjectResourceType = "conversation" | "agent_run" | "memory" | "file";

export interface Project {
  id: string; userId: string; name: string; description: string; status: "active" | "archived";
  createdAt: string; updatedAt: string;
}

export interface ProjectResource {
  projectId: string; type: ProjectResourceType; id: string; label: string; createdAt: string;
}

export interface ArtifactVersion {
  id: string; projectId: string; path: string; version: number; sha256: string; bytes: number; createdAt: string;
}

export type GoalStatus = "planned" | "in_progress" | "blocked" | "completed";
export type PlanStepStatus = "pending" | "in_progress" | "blocked" | "completed" | "skipped";
export interface ProjectGoal { id: string; projectId: string; title: string; description: string; status: GoalStatus; priority: number; createdAt: string; updatedAt: string }
export interface ProjectPlanStep { id: string; projectId: string; goalId?: string; title: string; position: number; status: PlanStepStatus; createdAt: string; updatedAt: string }
export interface ProjectCheckpoint { id: string; projectId: string; goalId?: string; kind: "manual" | "agent_run"; title: string; summary: string; progress: number; agentRunId?: string; createdAt: string; updatedAt: string }

export interface ProjectStore {
  createProject(input: { userId: string; name: string; description: string }): Promise<Project>;
  listProjects(userId: string): Promise<Project[]>;
  getProject(userId: string, id: string): Promise<Project | null>;
  resourceBelongsToUser(userId: string, type: Exclude<ProjectResourceType, "file">, id: string): Promise<boolean>;
  attachProjectResource(input: { projectId: string; userId: string; type: ProjectResourceType; resourceId: string; label: string }): Promise<ProjectResource | null>;
  listProjectResources(userId: string, projectId: string): Promise<ProjectResource[]>;
  createArtifactVersion(input: { projectId: string; userId: string; path: string; sha256: string; content: Buffer }): Promise<ArtifactVersion | null>;
  listArtifactVersions(userId: string, projectId: string): Promise<ArtifactVersion[]>;
  getArtifactVersion(userId: string, projectId: string, id: string): Promise<(ArtifactVersion & { content: Buffer }) | null>;
  createProjectGoal(input: { projectId: string; userId: string; title: string; description: string; priority: number }): Promise<ProjectGoal | null>;
  updateProjectGoalStatus(input: { projectId: string; userId: string; id: string; status: GoalStatus }): Promise<ProjectGoal | null>;
  listProjectGoals(userId: string, projectId: string): Promise<ProjectGoal[]>;
  createProjectPlanStep(input: { projectId: string; userId: string; goalId?: string; title: string }): Promise<ProjectPlanStep | null>;
  updateProjectPlanStepStatus(input: { projectId: string; userId: string; id: string; status: PlanStepStatus }): Promise<ProjectPlanStep | null>;
  listProjectPlanSteps(userId: string, projectId: string): Promise<ProjectPlanStep[]>;
  saveProjectCheckpoint(input: { projectId: string; userId: string; goalId?: string; kind: "manual" | "agent_run"; title: string; summary: string; progress: number; agentRunId?: string }): Promise<ProjectCheckpoint | null>;
  listProjectCheckpoints(userId: string, projectId: string): Promise<ProjectCheckpoint[]>;
  projectIdsForResource(userId: string, type: ProjectResourceType, resourceId: string): Promise<string[]>;
}

export class ProjectService {
  constructor(
    private readonly store: ProjectStore,
    private readonly workspace: Pick<FileWorkspace, "readBuffer" | "writeUpload">,
  ) {}

  create(userId: string, name: string, description: string) { return this.store.createProject({ userId, name, description }); }
  list(userId: string) { return this.store.listProjects(userId); }

  async detail(userId: string, id: string) {
    const project = await this.store.getProject(userId, id);
    if (!project) return null;
    const [resources, artifacts, goals, steps, checkpoints] = await Promise.all([
      this.store.listProjectResources(userId, id), this.store.listArtifactVersions(userId, id),
      this.store.listProjectGoals(userId, id), this.store.listProjectPlanSteps(userId, id),
      this.store.listProjectCheckpoints(userId, id),
    ]);
    return { project, resources, artifacts, goals, steps, checkpoints };
  }

  async context(userId: string, id: string): Promise<string | null> {
    const detail = await this.detail(userId, id);
    if (!detail) return null;
    return [
      `Active Barlas project: ${detail.project.name}.`,
      `Active project ID for project tools: ${detail.project.id}.`,
      detail.project.description ? `Project objective/context: ${detail.project.description}` : "",
      ...detail.goals.filter((goal) => goal.status !== "completed").slice(0, 25).map((goal) => `Goal [${goal.status}, priority ${goal.priority}]: ${goal.title}`),
      ...detail.steps.filter((step) => !["completed", "skipped"].includes(step.status)).slice(0, 50).map((step) => `Plan step ${step.position} [${step.status}]: ${step.title}`),
      ...detail.resources.slice(0, 100).map((resource) => `Linked ${resource.type}: ${resource.label || resource.id}`),
    ].filter(Boolean).join("\n").slice(0, 20_000);
  }

  async attach(userId: string, projectId: string, type: ProjectResourceType, resourceId: string, label: string) {
    if (type === "file") await this.workspace.readBuffer(userId, resourceId, 10_000_000);
    else if (!(await this.store.resourceBelongsToUser(userId, type, resourceId))) throw new Error("Resource not found");
    return this.store.attachProjectResource({ projectId, userId, type, resourceId, label });
  }

  async snapshot(userId: string, projectId: string, path: string) {
    if (!(await this.store.getProject(userId, projectId))) throw new Error("Project not found");
    const file = await this.workspace.readBuffer(userId, path, 10_000_000);
    if (file.content.byteLength === 0) throw new Error("Artifact file is empty");
    const artifact = await this.store.createArtifactVersion({
      projectId, userId, path: file.path,
      sha256: createHash("sha256").update(file.content).digest("hex"), content: file.content,
    });
    if (!artifact) throw new Error("Project not found");
    await this.store.attachProjectResource({ projectId, userId, type: "file", resourceId: file.path, label: "" });
    return artifact;
  }

  async restore(userId: string, projectId: string, versionId: string) {
    const version = await this.store.getArtifactVersion(userId, projectId, versionId);
    if (!version) return null;
    await this.workspace.writeUpload(userId, version.path, version.content, true);
    const { content: _content, ...metadata } = version;
    return metadata;
  }

  createGoal(userId: string, projectId: string, title: string, description: string, priority: number) { return this.store.createProjectGoal({ userId, projectId, title, description, priority }); }
  updateGoal(userId: string, projectId: string, id: string, status: GoalStatus) { return this.store.updateProjectGoalStatus({ userId, projectId, id, status }); }
  createStep(userId: string, projectId: string, title: string, goalId?: string) { return this.store.createProjectPlanStep({ userId, projectId, title, ...(goalId ? { goalId } : {}) }); }
  updateStep(userId: string, projectId: string, id: string, status: PlanStepStatus) { return this.store.updateProjectPlanStepStatus({ userId, projectId, id, status }); }
  checkpoint(userId: string, projectId: string, title: string, summary: string, progress: number, goalId?: string) {
    return this.store.saveProjectCheckpoint({ userId, projectId, title, summary, progress, kind: "manual", ...(goalId ? { goalId } : {}) });
  }

  async recordRunResult(run: AgentRunRecord): Promise<void> {
    if (!run.result || run.status === "waiting_approval" || run.status === "running" || run.status === "queued") return;
    const projectIds = await this.store.projectIdsForResource(run.userId, "agent_run", run.id);
    const progress = run.status === "completed" ? 100 : run.status === "step_limit" || run.status === "budget_limit" ? 75 : 0;
    await Promise.all(projectIds.map((projectId) => this.store.saveProjectCheckpoint({
      projectId, userId: run.userId, kind: "agent_run", agentRunId: run.id,
      title: `Agent run ${run.status}`, summary: run.result!.text.slice(0, 10_000) || `Run ended with status ${run.status}`,
      progress,
    })));
  }
}
