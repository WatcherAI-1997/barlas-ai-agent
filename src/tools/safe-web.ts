import { lookup } from "node:dns";
import { lookup as lookupAsync } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch } from "undici";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const publicNetworkAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
        const done = callback as unknown as (...args: unknown[]) => void;
        if (error) return done(error);
        const candidates = Array.isArray(addresses) ? addresses : [addresses];
        if (candidates.length === 0 || candidates.some(({ address }) => !isPublicAddress(address))) {
          return done(new Error("Local or non-public network destinations are not allowed"));
        }
        const selected = candidates[0];
        if (!selected) return done(new Error("No public network destination was found"));
        return options.all
          ? done(null, candidates)
          : done(null, selected.address, selected.family);
      });
    },
  },
});

export interface WebPage {
  url: string;
  title: string | null;
  contentType: string;
  text: string;
  truncated: boolean;
}

export class SafeWebReader {
  async open(rawUrl: string): Promise<WebPage> {
    let url = parsePublicUrl(rawUrl);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await assertPublicHost(url.hostname);
      const response = await fetch(url, {
        headers: {
          Accept: "text/html, text/plain, application/json;q=0.8",
          "User-Agent": "Barlas-AI-Agent/0.1 (+managed-reader)",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        dispatcher: publicNetworkAgent,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Web response redirected without a location");
        if (redirects === MAX_REDIRECTS) throw new Error("Web response exceeded the redirect limit");
        url = parsePublicUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`Web request failed with status ${response.status}`);

      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new Error("Web response exceeds the 2 MB limit");
      }
      const contentType = (response.headers.get("content-type") ?? "application/octet-stream").toLowerCase();
      if (!isReadableContentType(contentType)) throw new Error(`Unsupported web content type: ${contentType}`);
      const { body, truncated } = await readBounded(response);
      const decoded = new TextDecoder(charsetFor(contentType), { fatal: false }).decode(body);
      const html = contentType.includes("text/html");
      return {
        url: url.toString(),
        title: html ? extractTitle(decoded) : null,
        contentType,
        text: (html ? htmlToText(decoded) : decoded).slice(0, 100_000),
        truncated: truncated || decoded.length > 100_000,
      };
    }
    throw new Error("Web reader reached an invalid state");
  }
}

export function parsePublicUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS URLs are allowed");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  if ((url.protocol === "https:" && url.port && url.port !== "443") ||
      (url.protocol === "http:" && url.port && url.port !== "80")) {
    throw new Error("Only standard HTTP and HTTPS ports are allowed");
  }
  url.hash = "";
  return url;
}

export async function assertPublicHost(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    throw new Error("Local network destinations are not allowed");
  }
  const addresses = isIP(normalized)
    ? [{ address: normalized, family: isIP(normalized) }]
    : await lookupAsync(normalized, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Local or non-public network destinations are not allowed");
  }
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const url = parsePublicUrl(rawUrl);
  await assertPublicHost(url.hostname);
  return url;
}

export function isPublicAddress(address: string): boolean {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    return !(value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
      value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") ||
      value.startsWith("ff") || value.startsWith("2001:db8:") || value.startsWith("::ffff:"));
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0));
}

async function readBounded(response: Awaited<ReturnType<typeof fetch>>): Promise<{ body: Uint8Array; truncated: boolean }> {
  if (!response.body) return { body: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return { body: concat(chunks, total), truncated: false };
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      const allowed = value.subarray(0, value.byteLength - (total - MAX_RESPONSE_BYTES));
      chunks.push(allowed);
      return { body: concat(chunks, MAX_RESPONSE_BYTES), truncated: true };
    }
    chunks.push(value);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isReadableContentType(value: string): boolean {
  return value.includes("text/html") || value.includes("text/plain") || value.includes("application/json");
}

function charsetFor(contentType: string): "utf-8" | "windows-1252" {
  const match = /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(contentType);
  return match?.[1]?.toLowerCase() === "windows-1252" ? "windows-1252" : "utf-8";
}

function extractTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  return match ? decodeEntities(stripTags(match[1] ?? "")).trim().slice(0, 500) || null : null;
}

function htmlToText(html: string): string {
  return decodeEntities(stripTags(html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/giu, "\n")))
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n\s*\n+/gu, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)));
}
