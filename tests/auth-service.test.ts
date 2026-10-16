import { describe, expect, it } from "vitest";

import { AccountConflictError, AuthService, AuthorizationError, type AuthStore, type StoredAccount, type UserAccount, type VerifiedExternalIdentity } from "../src/auth/service.js";

class MemoryAuthStore implements AuthStore {
  accounts = new Map<string, StoredAccount>();
  identities = new Map<string, string>();
  sessions = new Map<string, string>();
  async findAccountByEmail(email: string) { return [...this.accounts.values()].find((a) => a.email === email) ?? null; }
  async findAccountById(id: string) { return this.accounts.get(id) ?? null; }
  async findAccountByExternalIdentity(input: Pick<VerifiedExternalIdentity, "provider" | "issuer" | "clientId" | "subject">) { const id = this.identities.get(key(input)); return id ? this.accounts.get(id) ?? null : null; }
  async linkExternalIdentity(accountId: string, input: VerifiedExternalIdentity) { this.identities.set(key(input), accountId); }
  async createAccount(input: { email: string; displayName: string; role: "owner" | "user"; languageCode?: UserAccount["languageCode"] }) {
    const account: StoredAccount = { id: `id-${this.accounts.size + 1}`, email: input.email, displayName: input.displayName, role: input.role, active: true, languageCode: input.languageCode ?? null, languageConfigured: Boolean(input.languageCode), createdAt: new Date().toISOString() };
    this.accounts.set(account.id, account); return account;
  }
  async listAccounts() { return [...this.accounts.values()]; }
  async updateAccountLanguage(id: string, languageCode: NonNullable<UserAccount["languageCode"]>) { const a = this.accounts.get(id); if (!a) return null; a.languageCode = languageCode; a.languageConfigured = true; return a; }
  async createSession(input: { accountId: string; tokenHash: string }) { this.sessions.set(input.tokenHash, input.accountId); }
  async findSession(tokenHash: string) { const id = this.sessions.get(tokenHash); return id ? this.accounts.get(id) ?? null : null; }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
}

const identity = (email = "owner@example.com"): VerifiedExternalIdentity => ({ provider: "openai", issuer: "https://auth.openai.com", clientId: "oaiapp_test", subject: `sub-${email}`, email, emailVerified: true, displayName: "Owner" });
const key = (input: Pick<VerifiedExternalIdentity, "provider" | "issuer" | "clientId" | "subject">) => `${input.provider}|${input.issuer}|${input.clientId}|${input.subject}`;

describe("Barlas AI Agent passwordless authentication", () => {
  it("creates the configured first owner from a verified OpenAI identity and reuses the link", async () => {
    const store = new MemoryAuthStore(); const auth = new AuthService(store, 1);
    const first = await auth.completeExternalLogin(identity(), "owner@example.com");
    expect(first.account.role).toBe("owner"); expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
    const second = await auth.completeExternalLogin(identity(), "owner@example.com");
    expect(second.account.id).toBe(first.account.id); expect(store.accounts).toHaveLength(1);
  });

  it("rejects an uninvited identity and an unverified email", async () => {
    const auth = new AuthService(new MemoryAuthStore());
    await expect(auth.completeExternalLogin(identity("other@example.com"), "owner@example.com")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(auth.completeExternalLogin({ ...identity(), emailVerified: false }, "owner@example.com")).rejects.toThrow("not verified");
  });

  it("allows an invited passwordless account to link on first verified login", async () => {
    const store = new MemoryAuthStore(); const auth = new AuthService(store);
    const invited = await auth.createAccount({ email: "user@example.com", displayName: "User", role: "user" });
    const session = await auth.completeExternalLogin(identity("user@example.com"), "owner@example.com");
    expect(session.account.id).toBe(invited.id);
    await expect(auth.createAccount({ email: "user@example.com", displayName: "Again", role: "user" })).rejects.toBeInstanceOf(AccountConflictError);
  });

  it("keeps language selection and opaque server-side logout", async () => {
    const store = new MemoryAuthStore(); const auth = new AuthService(store);
    const session = await auth.completeExternalLogin(identity(), "owner@example.com");
    await expect(auth.setLanguage(session.account.id, "kk")).resolves.toMatchObject({ languageCode: "kk", languageConfigured: true });
    await expect(auth.authenticate(session.token)).resolves.toMatchObject({ id: session.account.id });
    await auth.logout(session.token); await expect(auth.authenticate(session.token)).resolves.toBeNull();
  });
});
