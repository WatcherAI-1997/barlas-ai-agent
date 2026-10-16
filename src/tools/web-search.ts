import { z } from "zod";

import { parsePublicUrl, publicNetworkFetch } from "./safe-web.js";

const responseSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    content: z.string().default(""),
  })).default([]),
});

export class SearxngSearchClient {
  private readonly baseUrl: URL;

  constructor(baseUrl: string) {
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) {
      throw new Error("SearXNG URL must use HTTP or HTTPS");
    }
  }

  async search(query: string, limit: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
    const url = new URL("search", this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`));
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("safesearch", "1");

    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Barlas-AI-Agent/0.1" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 2_000_000) throw new Error("Search response exceeds 2 MB");
    const text = await response.text();
    if (Buffer.byteLength(text) > 2_000_000) throw new Error("Search response exceeds 2 MB");
    const parsed = responseSchema.parse(JSON.parse(text));
    return parsed.results.slice(0, limit).map((result) => ({
      title: result.title.slice(0, 500),
      url: result.url,
      snippet: result.content.slice(0, 2_000),
    }));
  }
}

export class DuckDuckGoSearchClient {
  constructor(
    private readonly request: (input: string | URL, init?: RequestInit) => Promise<Response> = publicNetworkFetch,
  ) {}

  async search(query: string, limit: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);
    const response = await this.request(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (compatible; Barlas-AI-Agent/0.1; +https://github.com/WatcherAI-1997/barlas-ai-agent)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Built-in search returned HTTP ${response.status}`);
    const html = await response.text();
    if (Buffer.byteLength(html) > 2_000_000) throw new Error("Search response exceeds 2 MB");
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const pattern = /<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a\b[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/giu;
    for (const match of html.matchAll(pattern)) {
      const target = normalizeDuckDuckGoTarget(match[1] ?? "");
      if (!target) continue;
      results.push({
        title: htmlText(match[2] ?? "").slice(0, 500),
        url: target,
        snippet: htmlText(match[3] ?? "").slice(0, 2_000),
      });
      if (results.length >= limit) break;
    }
    if (results.length === 0) throw new Error("Built-in search returned no readable results");
    return results;
  }
}

export class WebSearchClient {
  private readonly configured: SearxngSearchClient | undefined;
  private readonly fallback: Pick<DuckDuckGoSearchClient, "search">;

  constructor(searxngBaseUrl?: string, fallback: Pick<DuckDuckGoSearchClient, "search"> = new DuckDuckGoSearchClient()) {
    this.configured = searxngBaseUrl ? new SearxngSearchClient(searxngBaseUrl) : undefined;
    this.fallback = fallback;
  }

  async search(query: string, limit: number) {
    if (this.configured) {
      try { return await this.configured.search(query, limit); }
      catch { /* Fall back to the built-in provider when a private endpoint is unavailable. */ }
    }
    return this.fallback.search(query, limit);
  }
}

function normalizeDuckDuckGoTarget(raw: string): string | null {
  try {
    const redirect = new URL(decodeEntities(raw), "https://html.duckduckgo.com/");
    const target = redirect.searchParams.get("uddg") ?? redirect.toString();
    return parsePublicUrl(target).toString();
  } catch { return null; }
}

function htmlText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}
