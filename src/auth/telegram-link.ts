import { createHash, randomBytes } from "node:crypto";

export interface TelegramLink {
  accountId: string;
  telegramUserId: number;
  telegramChatId: number;
  createdAt: string;
}

export interface TelegramLinkStore {
  createTelegramLinkCode(input: { accountId: string; codeHash: string; expiresAt: Date }): Promise<void>;
  claimTelegramLink(input: {
    codeHash: string;
    telegramUserId: number;
    telegramChatId: number;
  }): Promise<TelegramLink | null>;
  getTelegramLink(accountId: string): Promise<TelegramLink | null>;
  resolveTelegramAccount(telegramUserId: number): Promise<string | null>;
  deleteTelegramLink(accountId: string): Promise<boolean>;
}

export class TelegramLinkService {
  constructor(
    private readonly store: TelegramLinkStore,
    private readonly ttlMinutes = 10,
  ) {}

  async createCode(accountId: string): Promise<{ code: string; expiresAt: string }> {
    const code = `BARLAS-${randomBytes(6).toString("base64url").toUpperCase()}`;
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60_000);
    await this.store.createTelegramLinkCode({ accountId, codeHash: this.hash(code), expiresAt });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  claim(code: string, telegramUserId: number, telegramChatId: number) {
    return this.store.claimTelegramLink({
      codeHash: this.hash(code.trim().toUpperCase()),
      telegramUserId,
      telegramChatId,
    });
  }

  get(accountId: string) {
    return this.store.getTelegramLink(accountId);
  }

  resolve(telegramUserId: number) {
    return this.store.resolveTelegramAccount(telegramUserId);
  }

  unlink(accountId: string) {
    return this.store.deleteTelegramLink(accountId);
  }

  private hash(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }
}
