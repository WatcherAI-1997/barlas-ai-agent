import { afterEach, describe, expect, it, vi } from "vitest";

import { TelegramClient, parseTelegramVoiceCommand } from "../src/channels/telegram.js";
import { sendTelegramVoiceReply, telegramVoiceFallbackText } from "../src/channels/telegram-voice.js";

afterEach(() => vi.unstubAllGlobals());

describe("Telegram voice replies", () => {
  it("recognizes explicit voice and call commands without changing normal messages", () => {
    expect(parseTelegramVoiceCommand("/voice Explain the plan")).toEqual({ requested: true, prompt: "Explain the plan" });
    expect(parseTelegramVoiceCommand("/call@BarlasBot   Привет")).toEqual({ requested: true, prompt: "Привет" });
    expect(parseTelegramVoiceCommand("/voice")).toEqual({ requested: true });
    expect(parseTelegramVoiceCommand("ordinary prompt")).toEqual({ requested: false });
  });

  it("uploads bounded MP3 bytes through the official Bot API sendVoice method", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => (
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ));
    vi.stubGlobal("fetch", fetchMock);
    const client = new TelegramClient("test-telegram-bot-token-without-secret-format");

    await client.sendVoice(42, Buffer.from("ID3voice"), "Voice caption");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/sendVoice");
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe("POST");
    const body = options.body as FormData;
    expect(body.get("chat_id")).toBe("42");
    expect(body.get("caption")).toBe("Voice caption");
    expect(body.get("voice")).toBeInstanceOf(Blob);
  });

  it("generates voice in the owned workspace and reports safe metadata", async () => {
    const createSpeech = vi.fn(async () => ({ path: "telegram/voice/run-1.mp3", bytes: 8, mimeType: "audio/mpeg", voice: "alloy" as const }));
    const readBuffer = vi.fn(async () => ({ path: "telegram/voice/run-1.mp3", content: Buffer.from("ID3voice") }));
    const sendVoice = vi.fn(async () => undefined);

    const result = await sendTelegramVoiceReply({
      client: { sendVoice },
      media: { createSpeech },
      workspace: { readBuffer },
      userId: "user-1",
      chatId: 42,
      runId: "run-1",
      text: "x".repeat(5_000),
    });

    expect(createSpeech).toHaveBeenCalledWith("user-1", "telegram/voice/run-1.mp3", "x".repeat(4_096), "alloy");
    expect(readBuffer).toHaveBeenCalledWith("user-1", "telegram/voice/run-1.mp3", 10_000_000);
    expect(sendVoice).toHaveBeenCalledWith(42, Buffer.from("ID3voice"), expect.stringContaining("сокращена"));
    expect(result).toEqual({ path: "telegram/voice/run-1.mp3", bytes: 8, truncated: true });
  });

  it("keeps the text fallback inside Telegram's message limit", () => {
    const fallback = telegramVoiceFallbackText("x".repeat(10_000));
    expect(fallback.length).toBeLessThanOrEqual(4_096);
    expect(fallback).toContain("Не удалось отправить голосовую версию");
  });
});
