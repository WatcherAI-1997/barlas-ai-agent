import type { ConnectorProvider, ConnectorService } from "./vault.js";

type GoogleProvider = Extract<ConnectorProvider, "google_drive" | "gmail" | "google_calendar">;

export class GoogleConnector {
  constructor(private readonly connectors: Pick<ConnectorService, "secret">) {}

  async driveFiles(userId: string, connectorId: string, limit: number): Promise<Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string | null;
    webViewLink: string | null;
  }>> {
    const token = await this.requireToken(userId, connectorId, "google_drive");
    const query = new URLSearchParams({
      pageSize: String(limit),
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    });
    const data = await googleRequest(token, `https://www.googleapis.com/drive/v3/files?${query}`) as Record<string, unknown>;
    const files = Array.isArray(data.files) ? data.files : [];
    return files.map((value) => {
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.mimeType !== "string") {
        throw new Error("Google Drive returned an invalid file entry");
      }
      return {
        id: row.id,
        name: row.name,
        mimeType: row.mimeType,
        modifiedTime: typeof row.modifiedTime === "string" ? row.modifiedTime : null,
        webViewLink: typeof row.webViewLink === "string" ? row.webViewLink : null,
      };
    });
  }

  async gmailMessages(userId: string, connectorId: string, limit: number): Promise<Array<{
    id: string;
    threadId: string;
  }>> {
    const token = await this.requireToken(userId, connectorId, "gmail");
    const query = new URLSearchParams({ maxResults: String(limit), includeSpamTrash: "false" });
    const data = await googleRequest(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`) as Record<string, unknown>;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return messages.map((value) => {
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.threadId !== "string") {
        throw new Error("Gmail returned an invalid message entry");
      }
      return { id: row.id, threadId: row.threadId };
    });
  }

  async calendarEvents(userId: string, connectorId: string, limit: number): Promise<Array<{
    id: string;
    summary: string;
    start: string | null;
    end: string | null;
    status: string;
  }>> {
    const token = await this.requireToken(userId, connectorId, "google_calendar");
    const query = new URLSearchParams({
      maxResults: String(limit),
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: new Date().toISOString(),
    });
    const data = await googleRequest(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`) as Record<string, unknown>;
    const events = Array.isArray(data.items) ? data.items : [];
    return events.map((value) => {
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string") throw new Error("Google Calendar returned an invalid event entry");
      return {
        id: row.id,
        summary: typeof row.summary === "string" ? row.summary : "(untitled)",
        start: eventTime(row.start),
        end: eventTime(row.end),
        status: typeof row.status === "string" ? row.status : "unknown",
      };
    });
  }

  private async requireToken(userId: string, connectorId: string, provider: GoogleProvider): Promise<string> {
    const token = await this.connectors.secret(userId, connectorId, provider);
    if (!token) throw new Error(`${provider} connector was not found`);
    return token;
  }
}

function eventTime(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return typeof row.dateTime === "string" ? row.dateTime : typeof row.date === "string" ? row.date : null;
}

async function googleRequest(token: string, rawUrl: string): Promise<unknown> {
  const url = new URL(rawUrl);
  if (![
    "www.googleapis.com",
    "gmail.googleapis.com",
  ].includes(url.hostname) || url.protocol !== "https:") {
    throw new Error("Google connector destination is not allowed");
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": "Barlas-AI-Agent" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Google API request failed with status ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) throw new Error("Google API response is too large");
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > 2 * 1024 * 1024) throw new Error("Google API response is too large");
  return JSON.parse(body) as unknown;
}
