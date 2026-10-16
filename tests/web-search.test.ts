import { afterEach, describe, expect, it, vi } from "vitest";

import { SearxngSearchClient } from "../src/tools/web-search.js";

afterEach(() => vi.unstubAllGlobals());

describe("Barlas AI Agent web search", () => {
  it("requests bounded safe-search JSON and normalizes results", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () => new Response(JSON.stringify({
      results: [{ title: "Result", url: "https://example.com/page", content: "Snippet" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new SearxngSearchClient("https://search.example.test/");

    await expect(client.search("Barlas AI Agent", 3)).resolves.toEqual([
      { title: "Result", url: "https://example.com/page", snippet: "Snippet" },
    ]);
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("format")).toBe("json");
    expect(requested.searchParams.get("safesearch")).toBe("1");
  });

  it("rejects oversized provider responses before parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-length": "2000001" },
    })));
    const client = new SearxngSearchClient("https://search.example.test");
    await expect(client.search("query", 1)).rejects.toThrow("exceeds 2 MB");
  });
});
