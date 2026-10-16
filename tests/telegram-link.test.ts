import { describe, expect, it, vi } from "vitest";

import { TelegramLinkService, type TelegramLinkStore } from "../src/auth/telegram-link.js";

describe("Barlas AI Agent Telegram account linking", () => {
  it("stores only a hash and claims a case-insensitive one-time code", async () => {
    let storedHash = "";
    const claimTelegramLink = vi.fn(async ({ codeHash }) => ({
      accountId: "00000000-0000-4000-8000-000000000001",
      telegramUserId: 7,
      telegramChatId: 42,
      createdAt: "2026-10-16T00:00:00.000Z",
      codeHash,
    }));
    const store = {
      createTelegramLinkCode: vi.fn(async ({ codeHash }) => { storedHash = codeHash; }),
      claimTelegramLink,
      getTelegramLink: vi.fn(async () => null),
      resolveTelegramAccount: vi.fn(async () => null),
      deleteTelegramLink: vi.fn(async () => true),
    } as TelegramLinkStore;
    const service = new TelegramLinkService(store, 10);

    const generated = await service.createCode("00000000-0000-4000-8000-000000000001");
    expect(generated.code).toMatch(/^BARLAS-[A-Z0-9_-]+$/);
    expect(storedHash).not.toContain(generated.code);
    expect(storedHash).toHaveLength(64);

    await service.claim(generated.code.toLowerCase(), 7, 42);
    expect(claimTelegramLink).toHaveBeenCalledWith(expect.objectContaining({
      codeHash: storedHash,
      telegramUserId: 7,
      telegramChatId: 42,
    }));
  });
});
