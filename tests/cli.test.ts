import { describe, expect, it, vi } from "vitest";

import { BarlasApiClient, renderRows } from "../src/cli.js";

describe("Barlas CLI", () => {
  it("authenticates API requests without exposing the token in the URL", async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => (
      new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } })
    ));
    const client = new BarlasApiClient("http://127.0.0.1:17840", "secret-token", fetchMock as typeof fetch);

    await expect(client.request("/health")).resolves.toEqual({ status: "ok" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:17840/health");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("secret-token");
  });

  it("renders bounded terminal tables", () => {
    const rendered = renderRows([
      { id: "run-1", status: "completed", error: null },
      { id: "run-2", status: "failed", error: "x".repeat(100) },
    ], ["id", "status", "error"]);
    expect(rendered).toContain("run-1");
    expect(rendered).toContain("completed");
    expect(rendered).not.toContain("x".repeat(51));
  });
});
