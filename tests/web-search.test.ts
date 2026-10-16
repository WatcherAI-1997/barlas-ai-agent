import { afterEach, describe, expect, it, vi } from "vitest";

import { DuckDuckGoSearchClient, SearxngSearchClient, WebSearchClient } from "../src/tools/web-search.js";

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

  it("provides bounded built-in search without a key or separate service", async () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews&amp;rut=ignored">Example &amp; News</a>
        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews">A <b>verified</b> result.</a>
      </div>`;
    const request = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    );
    const client = new DuckDuckGoSearchClient(request);

    await expect(client.search("latest example", 5)).resolves.toEqual([{
      title: "Example & News",
      url: "https://example.com/news",
      snippet: "A verified result.",
    }]);
    expect(new URL(String(request.mock.calls[0]?.[0])).searchParams.get("q")).toBe("latest example");
  });

  it("falls back when a configured private provider is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const fallback = { search: vi.fn(async () => [{ title: "Fallback", url: "https://example.com", snippet: "ok" }]) };
    const client = new WebSearchClient("https://search.example.test", fallback);
    await expect(client.search("query", 1)).resolves.toEqual([{ title: "Fallback", url: "https://example.com", snippet: "ok" }]);
    expect(fallback.search).toHaveBeenCalledWith("query", 1);
  });
});
