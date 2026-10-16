import { describe, expect, it, vi } from "vitest";

import { ProjectService, type ArtifactVersion, type Project, type ProjectResource, type ProjectStore } from "../src/projects/service.js";

const project: Project = { id: "00000000-0000-4000-8000-000000000201", userId: "user-1", name: "Launch", description: "Ship", status: "active", createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z" };

function setup() {
  const artifacts: Array<ArtifactVersion & { content: Buffer }> = [];
  const resources: ProjectResource[] = [];
  const store: ProjectStore = {
    createProject: vi.fn(async () => project), listProjects: vi.fn(async () => [project]), getProject: vi.fn(async (userId, id) => userId === project.userId && id === project.id ? project : null),
    resourceBelongsToUser: vi.fn(async (_userId, _type, id) => id === "owned"),
    attachProjectResource: vi.fn(async (input) => {
      if (input.userId !== project.userId || input.projectId !== project.id) return null;
      const item = { projectId: input.projectId, type: input.type, id: input.resourceId, label: input.label, createdAt: project.createdAt }; resources.push(item); return item;
    }),
    listProjectResources: vi.fn(async () => resources),
    createArtifactVersion: vi.fn(async (input) => {
      if (input.userId !== project.userId || input.projectId !== project.id) return null;
      const item = { id: `00000000-0000-4000-8000-00000000020${artifacts.length + 2}`, projectId: input.projectId, path: input.path, version: artifacts.length + 1, sha256: input.sha256, bytes: input.content.byteLength, createdAt: project.createdAt, content: input.content }; artifacts.push(item); return item;
    }),
    listArtifactVersions: vi.fn(async () => artifacts.map(({ content: _content, ...item }) => item)),
    getArtifactVersion: vi.fn(async (userId, projectId, id) => userId === project.userId && projectId === project.id ? artifacts.find((item) => item.id === id) ?? null : null),
  };
  const workspace = { readBuffer: vi.fn(async () => ({ path: "results/report.md", content: Buffer.from("version one") })), writeUpload: vi.fn(async () => ({ path: "results/report.md", bytes: 11 })) };
  return { service: new ProjectService(store, workspace), store, workspace, artifacts };
}

describe("project service", () => {
  it("rejects a database resource that is not owned by the user", async () => {
    const { service } = setup();
    await expect(service.attach("user-1", project.id, "conversation", "foreign", "")).rejects.toThrow("Resource not found");
  });

  it("snapshots immutable artifact versions and restores selected content", async () => {
    const { service, workspace, artifacts } = setup();
    const first = await service.snapshot("user-1", project.id, "results/report.md");
    expect(first.version).toBe(1); expect(first.sha256).toMatch(/^[0-9a-f]{64}$/u);
    await service.restore("user-1", project.id, artifacts[0]!.id);
    expect(workspace.writeUpload).toHaveBeenCalledWith("user-1", "results/report.md", Buffer.from("version one"), true);
  });

  it("does not expose another user's project", async () => {
    const { service } = setup();
    await expect(service.detail("user-2", project.id)).resolves.toBeNull();
  });
});
