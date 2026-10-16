import { describe, expect, it, vi } from "vitest";

import { DiscordClient, DiscordGatewayWorker } from "../src/channels/discord.js";

describe("Discord channel", () => {
  it("accepts DMs and explicit guild mentions but ignores bots and ambient chat", async () => {
    const deliver = vi.fn(async () => undefined);
    const worker = new DiscordGatewayWorker("token", deliver);
    worker.handle({ op: 0, t: "READY", d: { user: { id: "bot-1" } } });
    worker.handle({ op: 0, t: "MESSAGE_CREATE", d: {
      id: "m1", channel_id: "dm", content: "hello", author: { id: "u1" },
    } });
    worker.handle({ op: 0, t: "MESSAGE_CREATE", d: {
      id: "m2", channel_id: "guild", guild_id: "g1", content: "ambient", author: { id: "u1" },
    } });
    worker.handle({ op: 0, t: "MESSAGE_CREATE", d: {
      id: "m3", channel_id: "guild", guild_id: "g1", content: "<@bot-1> plan this", author: { id: "u1" },
    } });
    worker.handle({ op: 0, t: "MESSAGE_CREATE", d: {
      id: "m4", channel_id: "guild", guild_id: "g1", content: "<@bot-1> ignored", author: { id: "u2", bot: true },
    } });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2));
    expect(deliver).toHaveBeenLastCalledWith(expect.objectContaining({ content: "plan this", channelId: "guild" }));
  });

  it("sends bounded chunks and disables mention expansion", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const client = new DiscordClient("secret", "https://discord.test/api");
    await client.sendMessage("channel", "x".repeat(3_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: "Bot secret" });
    expect(JSON.parse(String(init.body))).toMatchObject({ allowed_mentions: { parse: [] } });
    fetchMock.mockRestore();
  });
});
