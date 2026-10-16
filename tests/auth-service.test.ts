import { describe, expect, it } from "vitest";

import {
  AccountConflictError,
  AuthenticationError,
  AuthService,
  type AuthStore,
  type StoredAccount,
  type UserAccount,
} from "../src/auth/service.js";

class MemoryAuthStore implements AuthStore {
  accounts: StoredAccount[] = [];
  sessions = new Map<string, string>();

  async findAccountByEmail(email: string) { return this.accounts.find((item) => item.email === email) ?? null; }
  async createAccount(input: Omit<StoredAccount, "id" | "active" | "createdAt">): Promise<UserAccount> {
    const account: StoredAccount = {
      ...input,
      id: `account-${this.accounts.length + 1}`,
      active: true,
      createdAt: "2026-10-16T00:00:00.000Z",
    };
    this.accounts.push(account);
    const { passwordHash: _hash, passwordSalt: _salt, ...publicAccount } = account;
    return publicAccount;
  }
  async listAccounts(): Promise<UserAccount[]> { return this.accounts; }
  async createSession(input: { accountId: string; tokenHash: string }) { this.sessions.set(input.tokenHash, input.accountId); }
  async findSession(tokenHash: string) {
    const id = this.sessions.get(tokenHash);
    const account = this.accounts.find((item) => item.id === id);
    if (!account) return null;
    const { passwordHash: _hash, passwordSalt: _salt, ...publicAccount } = account;
    return publicAccount;
  }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
}

describe("Barlas AI Agent authentication", () => {
  it("bootstraps an owner and authenticates an opaque server-side session", async () => {
    const store = new MemoryAuthStore();
    const auth = new AuthService(store, 1);
    const owner = await auth.bootstrapOwner({
      email: "OWNER@Example.com",
      displayName: "Owner",
      password: "very-secure-password",
    });
    expect(owner).toMatchObject({ email: "owner@example.com", role: "owner" });

    const session = await auth.login("owner@example.com", "very-secure-password");
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
    await expect(auth.authenticate(session.token)).resolves.toMatchObject({ id: owner.id, role: "owner" });
    await auth.logout(session.token);
    await expect(auth.authenticate(session.token)).resolves.toBeNull();
  });

  it("rejects invalid credentials without exposing account state", async () => {
    const store = new MemoryAuthStore();
    const auth = new AuthService(store);
    await expect(auth.login("missing@example.com", "wrong-password")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects duplicate email accounts", async () => {
    const store = new MemoryAuthStore();
    const auth = new AuthService(store);
    await auth.createAccount({
      email: "user@example.com",
      displayName: "User",
      password: "very-secure-password",
      role: "user",
    });
    await expect(auth.createAccount({
      email: "USER@example.com",
      displayName: "Other",
      password: "another-secure-password",
      role: "user",
    })).rejects.toBeInstanceOf(AccountConflictError);
  });
});
