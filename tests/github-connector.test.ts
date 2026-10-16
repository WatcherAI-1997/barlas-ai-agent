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
});
