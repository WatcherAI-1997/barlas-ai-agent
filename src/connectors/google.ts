import { randomUUID } from "node:crypto";

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

  async createDriveFile(userId: string, connectorId: string, input: {
    name: string;
    content: string;
    mimeType: "text/plain" | "text/markdown" | "text/csv";
    parentId?: string;
  }): Promise<{ id: string; name: string; mimeType: string }> {
    const token = await this.requireToken(userId, connectorId, "google_drive");
    const boundary = `barlas-${randomUUID()}`;
    const metadata = { name: input.name, ...(input.parentId ? { parents: [input.parentId] } : {}) };
    const body = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${input.mimeType}; charset=UTF-8\r\n\r\n${input.content}\r\n`,
      `--${boundary}--`,
    ].join("");
    const data = await googleRequest(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }) as Record<string, unknown>;
    return normalizeDriveFile(data);
  }

  async updateDriveFile(userId: string, connectorId: string, input: {
    fileId: string;
    content: string;
    mimeType: "text/plain" | "text/markdown" | "text/csv";
  }): Promise<{ id: string; name: string; mimeType: string }> {
    const token = await this.requireToken(userId, connectorId, "google_drive");
    const id = encodeURIComponent(input.fileId);
    const data = await googleRequest(token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,name,mimeType`, {
      method: "PATCH",
      headers: { "Content-Type": `${input.mimeType}; charset=UTF-8` },
      body: input.content,
    }) as Record<string, unknown>;
    return normalizeDriveFile(data);
  }

  async createGmailDraft(userId: string, connectorId: string, input: MailInput): Promise<{ id: string; messageId: string | null }> {
    const token = await this.requireToken(userId, connectorId, "gmail");
    const data = await googleRequest(token, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      body: JSON.stringify({ message: { raw: encodeMail(input) } }),
    }) as Record<string, unknown>;
    const message = data.message as Record<string, unknown> | undefined;
    if (typeof data.id !== "string") throw new Error("Gmail returned an invalid draft response");
    return { id: data.id, messageId: message && typeof message.id === "string" ? message.id : null };
  }

  async sendGmail(userId: string, connectorId: string, input: MailInput): Promise<{ id: string; threadId: string | null }> {
    const token = await this.requireToken(userId, connectorId, "gmail");
    const data = await googleRequest(token, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: encodeMail(input) }),
    }) as Record<string, unknown>;
    if (typeof data.id !== "string") throw new Error("Gmail returned an invalid send response");
    return { id: data.id, threadId: typeof data.threadId === "string" ? data.threadId : null };
  }

  async createCalendarEvent(userId: string, connectorId: string, input: CalendarEventInput): Promise<{
    id: string;
    status: string;
    htmlLink: string | null;
  }> {
    const token = await this.requireToken(userId, connectorId, "google_calendar");
    const data = await googleRequest(token, "https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify(calendarPayload(input)),
    }) as Record<string, unknown>;
    return normalizeCalendarMutation(data);
  }

  async updateCalendarEvent(userId: string, connectorId: string, input: CalendarEventInput & { eventId: string }): Promise<{
    id: string;
    status: string;
    htmlLink: string | null;
  }> {
    const token = await this.requireToken(userId, connectorId, "google_calendar");
    const data = await googleRequest(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(calendarPayload(input)),
    }) as Record<string, unknown>;
    return normalizeCalendarMutation(data);
  }

  private async requireToken(userId: string, connectorId: string, provider: GoogleProvider): Promise<string> {
    const token = await this.connectors.secret(userId, connectorId, provider);
    if (!token) throw new Error(`${provider} connector was not found`);
    return token;
  }
}

interface MailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

interface CalendarEventInput {
  summary: string;
  description?: string;
  start: string;
  end: string;
  timeZone?: string;
  attendees?: string[];
}

function encodeMail(input: MailInput): string {
  const headers = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    `Subject: ${input.subject.replace(/[\r\n]+/gu, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${input.body}`, "utf8").toString("base64url");
}

function calendarPayload(input: CalendarEventInput): Record<string, unknown> {
  return {
    summary: input.summary,
    ...(input.description ? { description: input.description } : {}),
    start: { dateTime: input.start, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
    end: { dateTime: input.end, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
    ...(input.attendees?.length ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
  };
}

function normalizeDriveFile(data: Record<string, unknown>): { id: string; name: string; mimeType: string } {
  if (typeof data.id !== "string" || typeof data.name !== "string" || typeof data.mimeType !== "string") {
    throw new Error("Google Drive returned an invalid mutation response");
  }
  return { id: data.id, name: data.name, mimeType: data.mimeType };
}

function normalizeCalendarMutation(data: Record<string, unknown>): { id: string; status: string; htmlLink: string | null } {
  if (typeof data.id !== "string" || typeof data.status !== "string") throw new Error("Google Calendar returned an invalid mutation response");
  return { id: data.id, status: data.status, htmlLink: typeof data.htmlLink === "string" ? data.htmlLink : null };
}

function eventTime(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return typeof row.dateTime === "string" ? row.dateTime : typeof row.date === "string" ? row.date : null;
}

async function googleRequest(token: string, rawUrl: string, options: {
  method?: "GET" | "POST" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
} = {}): Promise<unknown> {
  const url = new URL(rawUrl);
  if (![
    "www.googleapis.com",
    "gmail.googleapis.com",
  ].includes(url.hostname) || url.protocol !== "https:") {
    throw new Error("Google connector destination is not allowed");
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Barlas-AI-Agent",
      ...(options.body && !options.headers?.["Content-Type"] ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: options.body }),
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
