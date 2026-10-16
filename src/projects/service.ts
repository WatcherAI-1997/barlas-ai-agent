import { createHash } from "node:crypto";

import type { FileWorkspace } from "../tools/file-workspace.js";

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
    return { project, resources: await this.store.listProjectResources(userId, id), artifacts: await this.store.listArtifactVersions(userId, id) };
  }

  async context(userId: string, id: string): Promise<string | null> {
    const detail = await this.detail(userId, id);
    if (!detail) return null;
    return [
      `Active Barlas project: ${detail.project.name}.`,
      detail.project.description ? `Project objective/context: ${detail.project.description}` : "",
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
}
