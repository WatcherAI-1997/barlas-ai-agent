import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubConnector } from "../src/connectors/github.js";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub connector", () => {
  it("uses the server-side token and returns normalized repositories", async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer hidden-token");
      return new Response(JSON.stringify([{
        id: 7,
        name: "agent",
        full_name: "barlas/agent",
        private: true,
        html_url: "https://github.com/barlas/agent",
        default_branch: "main",
        updated_at: "2026-10-16T00:00:00Z",
      }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const connector = new GitHubConnector({ secret: async () => "hidden-token" });

    const repositories = await connector.repositories("user-a", "connector-a", 10);

    expect(repositories).toEqual([{
      id: 7,
      name: "agent",
      fullName: "barlas/agent",
      private: true,
      url: "https://github.com/barlas/agent",
      defaultBranch: "main",
      updatedAt: "2026-10-16T00:00:00Z",
    }]);
    expect(JSON.stringify(repositories)).not.toContain("hidden-token");
  });

  it("does not call GitHub for a missing or wrong-owner connector", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const connector = new GitHubConnector({ secret: async () => null });
    await expect(connector.profile("other-user", "connector-a")).rejects.toThrow(/not found/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates branches, commits, pull requests, and issues with server-side credentials", async () => {
    const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer hidden-token");
      if (url.pathname.endsWith("/git/ref/heads/main")) return new Response(JSON.stringify({ object: { sha: "a".repeat(40) } }));
      if (url.pathname.endsWith("/git/refs")) return new Response(JSON.stringify({ ref: body.ref }));
      if (url.pathname.includes("/contents/")) return new Response(JSON.stringify({ commit: { sha: "b".repeat(40) }, content: { path: "docs/plan.md" } }));
      if (url.pathname.endsWith("/pulls")) return new Response(JSON.stringify({ number: 3, html_url: "https://github.com/barlas/agent/pull/3", state: "open" }));
      return new Response(JSON.stringify({ number: 4, html_url: "https://github.com/barlas/agent/issues/4", state: "open" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const connector = new GitHubConnector({ secret: async () => "hidden-token" });
    await expect(connector.createBranch("u", "c", { repository: "barlas/agent", branch: "feat/mcp", fromBranch: "main" }))
      .resolves.toEqual({ ref: "refs/heads/feat/mcp", sha: "a".repeat(40) });
    await expect(connector.commitFile("u", "c", {
      repository: "barlas/agent", path: "docs/plan.md", branch: "feat/mcp", message: "Add plan", content: "hello",
    })).resolves.toEqual({ commitSha: "b".repeat(40), contentPath: "docs/plan.md" });
    await expect(connector.createPullRequest("u", "c", {
      repository: "barlas/agent", title: "MCP", head: "feat/mcp", base: "main",
    })).resolves.toMatchObject({ number: 3 });
    await expect(connector.createIssue("u", "c", { repository: "barlas/agent", title: "Review" }))
      .resolves.toMatchObject({ number: 4 });
    const commitCall = fetchMock.mock.calls.find(([url]) => (url as URL).pathname.includes("/contents/"));
    expect(JSON.parse(String(commitCall?.[1]?.body))).toMatchObject({ content: Buffer.from("hello").toString("base64") });
  });
});
