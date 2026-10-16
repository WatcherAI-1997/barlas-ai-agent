import { createHmac, timingSafeEqual } from "node:crypto";

export interface WhatsAppInboundMessage {
  id: string;
  from: string;
  text: string;
}

export class WhatsAppClient {
  private readonly endpoint: string;

  constructor(
    private readonly accessToken: string,
    phoneNumberId: string,
    graphApiBaseUrl = "https://graph.facebook.com/v23.0",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = `${graphApiBaseUrl.replace(/\/$/u, "")}/${encodeURIComponent(phoneNumberId)}/messages`;
  }

  async sendMessage(recipientId: string, text: string): Promise<void> {
    for (const chunk of splitMessage(text, 4_096)) {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
          "user-agent": "Barlas-AI-Agent/0.1",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipientId,
          type: "text",
          text: { body: chunk, preview_url: false },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1_000);
        throw new Error(`WhatsApp sendMessage failed with status ${response.status}: ${detail}`);
      }
    }
  }
}

export function verifyWhatsAppSignature(appSecret: string, rawBody: Buffer, supplied: string): boolean {
  if (!supplied.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "ascii");
  const actual = Buffer.from(supplied.slice(7), "ascii");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function extractWhatsAppMessages(payload: unknown): WhatsAppInboundMessage[] {
  if (!isRecord(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return [];
  const messages: WhatsAppInboundMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== "messages" || !isRecord(change.value) || !Array.isArray(change.value.messages)) continue;
      for (const item of change.value.messages) {
        if (!isRecord(item) || item.type !== "text" || !isRecord(item.text)) continue;
        if (typeof item.id !== "string" || typeof item.from !== "string" || typeof item.text.body !== "string") continue;
        const text = item.text.body.trim();
        if (item.id.length > 256 || item.from.length > 64 || text.length === 0 || text.length > 20_000) continue;
        messages.push({ id: item.id, from: item.from, text });
      }
    }
  }
  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const boundary = Math.max(rest.lastIndexOf("\n", limit), rest.lastIndexOf(" ", limit));
    const cut = boundary > limit / 2 ? boundary : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
