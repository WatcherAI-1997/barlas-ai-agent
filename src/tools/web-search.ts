import { z } from "zod";

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
