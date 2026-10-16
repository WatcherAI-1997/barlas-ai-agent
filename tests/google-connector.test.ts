import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleConnector } from "../src/connectors/google.js";

afterEach(() => vi.unstubAllGlobals());

describe("Google connectors", () => {
  it("uses an encrypted-vault token for read-only Drive metadata", async () => {
    const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.hostname).toBe("www.googleapis.com");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer hidden-google-token");
      return new Response(JSON.stringify({ files: [{
        id: "file-1",
        name: "Plan",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-10-16T00:00:00Z",
        webViewLink: "https://docs.google.com/document/d/file-1",
      }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const connector = new GoogleConnector({ secret: async (_user, _id, provider) =>
      provider === "google_drive" ? "hidden-google-token" : null });

    const files = await connector.driveFiles("user-a", "connector-a", 10);
    expect(files).toEqual([expect.objectContaining({ id: "file-1", name: "Plan" })]);
    expect(JSON.stringify(files)).not.toContain("hidden-google-token");
  });

  it("normalizes Gmail IDs and Calendar event times", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      if (url.hostname === "gmail.googleapis.com") {
        return new Response(JSON.stringify({ messages: [{ id: "message-1", threadId: "thread-1" }] }));
      }
      return new Response(JSON.stringify({ items: [{
        id: "event-1",
        summary: "Review",
        start: { dateTime: "2026-10-17T10:00:00Z" },
        end: { dateTime: "2026-10-17T11:00:00Z" },
        status: "confirmed",
      }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const connector = new GoogleConnector({ secret: async () => "token" });

    await expect(connector.gmailMessages("user-a", "gmail-id", 5)).resolves.toEqual([
      { id: "message-1", threadId: "thread-1" },
    ]);
    await expect(connector.calendarEvents("user-a", "calendar-id", 5)).resolves.toEqual([
      expect.objectContaining({ id: "event-1", start: "2026-10-17T10:00:00Z" }),
    ]);
  });

  it("does not make a request for a missing or wrong-owner credential", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const connector = new GoogleConnector({ secret: async () => null });
    await expect(connector.driveFiles("other-user", "connector-a", 5)).rejects.toThrow(/not found/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
