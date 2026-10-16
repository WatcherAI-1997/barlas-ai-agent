import { describe, expect, it } from "vitest";

import { AccountConflictError, AuthService, type AuthStore, type StoredAccount, type UserAccount } from "../src/auth/service.js";

class MemoryAuthStore implements AuthStore {
  accounts = new Map<string, StoredAccount>();
  sessions = new Map<string, string>();
  async findAccountByEmail(email: string) { return [...this.accounts.values()].find((account) => account.email === email) ?? null; }
  async findAccountById(id: string) { return this.accounts.get(id) ?? null; }
  async createAccount(input: { email: string; displayName: string; role: "owner" | "user"; languageCode?: UserAccount["languageCode"] }) {
    const account: StoredAccount = { id: `id-${this.accounts.size + 1}`, email: input.email, displayName: input.displayName, role: input.role, active: true, languageCode: input.languageCode ?? null, languageConfigured: Boolean(input.languageCode), createdAt: new Date().toISOString() };
    this.accounts.set(account.id, account); return account;
  }
  async listAccounts() { return [...this.accounts.values()]; }
  async updateAccountLanguage(id: string, languageCode: NonNullable<UserAccount["languageCode"]>) { const account = this.accounts.get(id); if (!account) return null; account.languageCode = languageCode; account.languageConfigured = true; return account; }
  async createSession(input: { accountId: string; tokenHash: string }) { this.sessions.set(input.tokenHash, input.accountId); }
  async findSession(tokenHash: string) { const id = this.sessions.get(tokenHash); return id ? this.accounts.get(id) ?? null : null; }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
  async deleteAccountSessions(accountId: string) { for (const [hash, id] of this.sessions) if (id === accountId) this.sessions.delete(hash); }
}

describe("Barlas AI Agent token authentication", () => {
  it("bootstraps the configured owner without a human password", async () => {
    const store = new MemoryAuthStore(); const auth = new AuthService(store);
    const first = await auth.bootstrapOwner({ email: "Owner@Example.com", displayName: "Owner", languageCode: "uz" });
    const second = await auth.bootstrapOwner({ email: "owner@example.com", displayName: "Ignored", languageCode: "uz" });
    expect(first).toMatchObject({ email: "owner@example.com", role: "owner", languageCode: "uz" });
    expect(second.id).toBe(first.id); expect(store.accounts).toHaveLength(1);
  });

  it("issues an opaque user token, stores only its hash, and authenticates it", async () => {
    const store = new MemoryAuthStore(); const auth = new AuthService(store, 1);
    const account = await auth.createAccount({ email: "user@example.com", displayName: "User", role: "user" });
    const access = await auth.issueAccessToken(account.id);
    expect(access.token).toMatch(/^barlas_[A-Za-z0-9_-]{40,}$/u);
    expect([...store.sessions.keys()]).not.toContain(access.token);
    await expect(auth.authenticate(access.token)).resolves.toMatchObject({ id: account.id });
  });

  it("rotates all existing tokens for an account", async () => {
    const store = new MemoryAuthStore(); const auth = new AuthService(store);
    const account = await auth.createAccount({ email: "user@example.com", displayName: "User", role: "user" });
    const first = await auth.issueAccessToken(account.id);
    const second = await auth.issueAccessToken(account.id, true);
    await expect(auth.authenticate(first.token)).resolves.toBeNull();
    await expect(auth.authenticate(second.token)).resolves.toMatchObject({ id: account.id });
  });

  it("keeps account uniqueness, language selection, and logout", async () => {
    const store = new MemoryAuthStore(); const auth = new AuthService(store);
    const account = await auth.createAccount({ email: "user@example.com", displayName: "User", role: "user" });
    await expect(auth.createAccount({ email: "user@example.com", displayName: "Again", role: "user" })).rejects.toBeInstanceOf(AccountConflictError);
    await expect(auth.setLanguage(account.id, "kk")).resolves.toMatchObject({ languageCode: "kk", languageConfigured: true });
    const access = await auth.issueAccessToken(account.id); await auth.logout(access.token);
    await expect(auth.authenticate(access.token)).resolves.toBeNull();
  });
});
