import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../src/skills/registry.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";

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
