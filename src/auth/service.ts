import { createHash, randomBytes } from "node:crypto";

import { isSupportedLanguage, type SupportedLanguageCode } from "../i18n/languages.js";

export type AccountRole = "owner" | "user";

export interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  active: boolean;
  languageCode: SupportedLanguageCode | null;
  languageConfigured: boolean;
  createdAt: string;
}

export type StoredAccount = UserAccount;

export interface AuthStore {
  findAccountByEmail(email: string): Promise<StoredAccount | null>;
  findAccountById(id: string): Promise<UserAccount | null>;
  createAccount(input: { email: string; displayName: string; role: AccountRole; languageCode?: SupportedLanguageCode }): Promise<UserAccount>;
  listAccounts(): Promise<UserAccount[]>;
  updateAccountLanguage(accountId: string, languageCode: SupportedLanguageCode): Promise<UserAccount | null>;
  createSession(input: { accountId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: string): Promise<UserAccount | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteAccountSessions(accountId: string): Promise<void>;
}

export class AuthenticationError extends Error {
  constructor() { super("Invalid access token"); this.name = "AuthenticationError"; }
}
export class AuthorizationError extends Error {
  constructor() { super("Access denied"); this.name = "AuthorizationError"; }
}
export class AccountConflictError extends Error {
  constructor() { super("An account with this email already exists"); this.name = "AccountConflictError"; }
}

export class AuthService {
  constructor(private readonly store: AuthStore, private readonly sessionTtlHours = 168) {}

  async bootstrapOwner(input: { email: string; displayName: string; languageCode?: SupportedLanguageCode }): Promise<UserAccount> {
    const email = normalizeEmail(input.email);
    const existing = await this.store.findAccountByEmail(email);
    if (existing) {
      if (existing.role !== "owner") throw new Error("Bootstrap account exists without owner role");
      if (input.languageCode && existing.languageCode !== input.languageCode) {
        const updated = await this.store.updateAccountLanguage(existing.id, input.languageCode);
        if (updated) return updated;
      }
      return existing;
    }
    return this.createAccount({ ...input, email, role: "owner" });
  }

  async createAccount(input: { email: string; displayName: string; role: AccountRole; languageCode?: SupportedLanguageCode }): Promise<UserAccount> {
    const email = normalizeEmail(input.email);
    const displayName = validateDisplayName(input.displayName);
    if (await this.store.findAccountByEmail(email)) throw new AccountConflictError();
    return this.store.createAccount({ ...input, email, displayName });
  }

  getAccount(accountId: string): Promise<UserAccount | null> { return this.store.findAccountById(accountId); }
  async setLanguage(accountId: string, languageCode: string): Promise<UserAccount> {
    if (!isSupportedLanguage(languageCode)) throw new Error("Unsupported language");
    const account = await this.store.updateAccountLanguage(accountId, languageCode);
    if (!account) throw new Error("Account not found");
    return account;
  }
  authenticate(token: string): Promise<UserAccount | null> {
    if (token.length < 32 || token.length > 256) return Promise.resolve(null);
    return this.store.findSession(hashToken(token));
  }
  logout(token: string): Promise<void> { return this.store.deleteSession(hashToken(token)); }
  listAccounts(): Promise<UserAccount[]> { return this.store.listAccounts(); }

  async issueAccessToken(accountId: string, revokeExisting = false): Promise<{ token: string; expiresAt: string }> {
    const account = await this.store.findAccountById(accountId);
    if (!account?.active) throw new Error("Account not found");
    if (revokeExisting) await this.store.deleteAccountSessions(accountId);
    const token = `barlas_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1_000);
    await this.store.createSession({ accountId, tokenHash: hashToken(token), expiresAt });
    return { token, expiresAt: expiresAt.toISOString() };
  }
}

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) || value.length > 254) throw new Error("Invalid email address");
  return value;
}
function validateDisplayName(value: string): string {
  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 100) throw new Error("Invalid display name");
  return displayName;
}
function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
