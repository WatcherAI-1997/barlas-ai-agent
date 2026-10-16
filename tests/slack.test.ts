import { describe, expect, it, vi } from "vitest";

import { SlackClient, SlackSocketWorker } from "../src/channels/slack.js";

describe("Slack Socket Mode channel", () => {
  it("acknowledges envelopes and accepts only DMs or app mentions", async () => {
    const deliver = vi.fn(async () => undefined);
    const acknowledge = vi.fn();
    const worker = new SlackSocketWorker({ openSocket: vi.fn() }, deliver);
    worker.handleEnvelope({ envelope_id: "e1", type: "events_api", payload: {
      event_id: "event-1", event: { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "hello" },
    } }, acknowledge);
    worker.handleEnvelope({ envelope_id: "e2", type: "events_api", payload: {
      event_id: "event-2", event: { type: "message", channel_type: "channel", user: "U1", channel: "C1", text: "ambient" },
    } }, acknowledge);
    worker.handleEnvelope({ envelope_id: "e3", type: "events_api", payload: {
      event_id: "event-3", event: { type: "app_mention", user: "U1", channel: "C1", text: "<@UBOT> plan this" },
    } }, acknowledge);
    worker.handleEnvelope({ envelope_id: "e4", type: "events_api", payload: {
      event_id: "event-4", event: { type: "app_mention", bot_id: "B1", user: "U2", channel: "C1", text: "<@UBOT> ignore" },
    } }, acknowledge);
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2));
    expect(acknowledge).toHaveBeenCalledTimes(4);
    expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ content: "plan this", channelId: "C1" }));
  });

  it("opens Socket Mode with the app token and posts with the bot token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, url: "wss://socket.slack.test/link" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new SlackClient("xoxb-secret", "xapp-secret", "https://slack.test/api");
    await expect(client.openSocket()).resolves.toBe("wss://socket.slack.test/link");
    await client.sendMessage("C1", "hello");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe("Bearer xapp-secret");
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).authorization).toBe("Bearer xoxb-secret");
    fetchMock.mockRestore();
  });
});
