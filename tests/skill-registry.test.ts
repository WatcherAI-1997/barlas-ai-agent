import { describe, expect, it } from "vitest";

import { createBuiltinSkillRegistry, SkillRegistry } from "../src/skills/registry.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";
import type { ProjectService } from "../src/projects/service.js";

describe("versioned skill registry", () => {
  it("keeps multiple versions and can activate an earlier safe version", () => {
    const registry = new SkillRegistry();
    registry.register({ id: "writing.test", version: "1.0.0", description: "v1", instructions: "one", allowedTools: [] });
    registry.register({ id: "writing.test", version: "1.1.0", description: "v2", instructions: "two", allowedTools: [] });

    expect(registry.get("writing.test").version).toBe("1.1.0");
    expect(registry.get("writing.test", "1.0.0").instructions).toBe("one");
    expect(registry.activate("writing.test", "1.0.0").version).toBe("1.0.0");
    expect(registry.get("writing.test").version).toBe("1.0.0");
    expect(registry.list()).toHaveLength(2);
  });
});

describe("subagent tool registration", () => {
  it("exposes bounded delegation only when a coordinator is configured", () => {
    expect(createBuiltinToolRegistry().list().some((tool) => tool.name === "agent.delegate")).toBe(false);
    const registry = createBuiltinToolRegistry({
      subagentCoordinator: { delegate: async () => ({ objective: "x", results: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 } }) },
    });
    expect(registry.list()).toContainEqual(expect.objectContaining({ name: "agent.delegate", risk: "read" }));
  });
});

describe("sandbox tool registration", () => {
  it("requires approval and is absent unless the isolated runner is configured", () => {
    expect(createBuiltinToolRegistry().list().some((tool) => tool.name === "code.run")).toBe(false);
    const registry = createBuiltinToolRegistry({
      codeSandbox: {
        run: async () => ({
          command: "node", exitCode: 0, signal: null, stdout: "", stderr: "",
          timedOut: false, outputTruncated: false, durationMs: 1,
        }),
      },
    });
    expect(registry.list()).toContainEqual(expect.objectContaining({ name: "code.run", risk: "write" }));
  });
});

describe("external mutation tool registration", () => {
  it("marks connector mutations and all remote MCP calls as approval-gated external actions", () => {
    const registry = createBuiltinToolRegistry({
      githubConnector: {
        profile: async () => ({ login: "x", name: null, avatarUrl: "https://example.com/x" }),
        repositories: async () => [],
        createBranch: async () => ({ ref: "refs/heads/x", sha: "a".repeat(40) }),
        commitFile: async () => ({ commitSha: "a".repeat(40), contentPath: "x" }),
        createPullRequest: async () => ({ number: 1, url: "https://example.com", state: "open" }),
        createIssue: async () => ({ number: 1, url: "https://example.com", state: "open" }),
      },
      mcpConnector: { listTools: async () => [], callTool: async () => ({}) },
    });
    for (const name of ["github.branch.create", "github.file.commit", "github.pull_request.create", "github.issue.create", "mcp.tools.list", "mcp.tool.call"]) {
      expect(registry.list()).toContainEqual(expect.objectContaining({ name, risk: "external" }));
    }
  });
});

describe("multimodal tool registration", () => {
  it("exposes every model-mediated media action only behind external approval", () => {
    const registry = createBuiltinToolRegistry({
      mediaService: {
        analyzeImage: async () => ({ path: "x.png", mimeType: "image/png", text: "x" }),
        analyzePdf: async () => ({ path: "x.pdf", mimeType: "application/pdf", text: "x" }),
        transcribeAudio: async () => ({ path: "x.mp3", mimeType: "audio/mpeg", text: "x" }),
        createSpeech: async () => ({ path: "x.mp3", bytes: 1, mimeType: "audio/mpeg", voice: "alloy" as const }),
      },
    });
    for (const name of ["media.image.analyze", "media.pdf.analyze", "media.audio.transcribe", "media.speech.create"]) {
      expect(registry.list()).toContainEqual(expect.objectContaining({ name, risk: "external" }));
    }
  });
});

describe("project execution tool registration", () => {
  it("keeps project reads immediate and marks every mutation as approval-gated write", () => {
    const projectService = {
      detail: async () => null,
      createGoal: async () => null,
      updateGoal: async () => null,
      createStep: async () => null,
      updateStep: async () => null,
      checkpoint: async () => null,
      snapshot: async () => ({ id: "x" }),
      restore: async () => null,
    };
    const registry = createBuiltinToolRegistry({ projectService: projectService as unknown as Pick<ProjectService, "detail" | "createGoal" | "updateGoal" | "createStep" | "updateStep" | "checkpoint" | "snapshot" | "restore"> });
    expect(registry.list()).toContainEqual(expect.objectContaining({ name: "projects.get", risk: "read" }));
    for (const name of [
      "projects.goal.create", "projects.goal.update", "projects.step.create", "projects.step.update",
      "projects.checkpoint.create", "projects.artifact.snapshot", "projects.artifact.restore",
    ]) {
      expect(registry.list()).toContainEqual(expect.objectContaining({ name, risk: "write" }));
    }
    expect(createBuiltinSkillRegistry().get("project.execution").allowedTools).toContain("projects.get");
  });
});

describe("device node tool registration", () => {
  it("exposes notifications only as an approval-gated external action", () => {
    expect(createBuiltinToolRegistry().list().some((tool) => tool.name === "nodes.notify")).toBe(false);
    const registry = createBuiltinToolRegistry({ deviceNodes: { notify: async () => null } });
    expect(registry.list()).toContainEqual(expect.objectContaining({ name: "nodes.notify", risk: "external" }));
  });
});
