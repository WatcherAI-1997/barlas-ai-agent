import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

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

export interface StoredAccount extends UserAccount {
  passwordHash: string;
  passwordSalt: string;
}

export interface AuthStore {
  findAccountByEmail(email: string): Promise<StoredAccount | null>;
  findAccountById(id: string): Promise<UserAccount | null>;
  createAccount(input: {
    email: string;
    displayName: string;
    role: AccountRole;
    passwordHash: string;
    passwordSalt: string;
    languageCode?: SupportedLanguageCode;
  }): Promise<UserAccount>;
  listAccounts(): Promise<UserAccount[]>;
  updateAccountLanguage(accountId: string, languageCode: SupportedLanguageCode): Promise<UserAccount | null>;
  createPasswordReset(input: { accountId: string; codeHash: string; expiresAt: Date }): Promise<boolean>;
  consumePasswordReset(input: {
    codeHash: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<boolean>;
  createSession(input: { accountId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: string): Promise<UserAccount | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export class AuthenticationError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor() {
    super("Access denied");
    this.name = "AuthorizationError";
  }
}

export class AccountConflictError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "AccountConflictError";
  }
}

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly sessionTtlHours = 168,
  ) {}

  async bootstrapOwner(input: {
    email: string;
    displayName: string;
    password: string;
    languageCode?: SupportedLanguageCode;
  }): Promise<UserAccount> {
    const email = normalizeEmail(input.email);
    const existing = await this.store.findAccountByEmail(email);
    if (existing) {
      if (existing.role !== "owner") throw new Error("Bootstrap account exists without owner role");
      if (input.languageCode && existing.languageCode !== input.languageCode) {
        const updated = await this.store.updateAccountLanguage(existing.id, input.languageCode);
        if (updated) return updated;
      }
      return publicAccount(existing);
    }
    return this.createAccount({ ...input, email, role: "owner" });
  }

  async createAccount(input: {
    email: string;
    displayName: string;
    password: string;
    role: AccountRole;
    languageCode?: SupportedLanguageCode;
  }): Promise<UserAccount> {
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    const displayName = input.displayName.trim();
    if (displayName.length < 2 || displayName.length > 100) throw new Error("Invalid display name");
    if (await this.store.findAccountByEmail(email)) throw new AccountConflictError();
    const passwordSalt = randomBytes(16).toString("base64url");
    const passwordHash = await derivePassword(input.password, passwordSalt);
    return this.store.createAccount({
      email,
      displayName,
      role: input.role,
      passwordHash,
      passwordSalt,
      ...(input.languageCode ? { languageCode: input.languageCode } : {}),
    });
  }

  getAccount(accountId: string): Promise<UserAccount | null> {
    return this.store.findAccountById(accountId);
  }

  async setLanguage(accountId: string, languageCode: string): Promise<UserAccount> {
    if (!isSupportedLanguage(languageCode)) throw new Error("Unsupported language");
    const account = await this.store.updateAccountLanguage(accountId, languageCode);
    if (!account) throw new Error("Account not found");
    return account;
  }

  async login(emailInput: string, password: string): Promise<{ token: string; account: UserAccount; expiresAt: string }> {
    const email = normalizeEmail(emailInput);
    const account = await this.store.findAccountByEmail(email);
    const actual = account
      ? await derivePassword(password, account.passwordSalt)
      : await derivePassword(password, "barlas-invalid-account");
    const expected = account?.passwordHash ?? "0".repeat(64);
    const matches = safeTextEqual(actual, expected);
    if (!account || !account.active || !matches) throw new AuthenticationError();

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1_000);
    await this.store.createSession({ accountId: account.id, tokenHash: hashToken(token), expiresAt });
    return { token, account: publicAccount(account), expiresAt: expiresAt.toISOString() };
  }

  authenticate(token: string): Promise<UserAccount | null> {
    if (token.length < 32 || token.length > 256) return Promise.resolve(null);
    return this.store.findSession(hashToken(token));
  }

  logout(token: string): Promise<void> {
    return this.store.deleteSession(hashToken(token));
  }

  listAccounts(): Promise<UserAccount[]> {
    return this.store.listAccounts();
  }

  async issuePasswordReset(accountId: string): Promise<{ code: string; expiresAt: string }> {
    const code = `BARLAS-RESET-${randomBytes(24).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const created = await this.store.createPasswordReset({
      accountId,
      codeHash: hashToken(code),
      expiresAt,
    });
    if (!created) throw new Error("Account not found");
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async resetPassword(code: string, password: string): Promise<void> {
    if (!/^BARLAS-RESET-[A-Za-z0-9_-]{20,}$/u.test(code)) throw new AuthenticationError();
    validatePassword(password);
    const passwordSalt = randomBytes(16).toString("base64url");
    const passwordHash = await derivePassword(password, passwordSalt);
    const consumed = await this.store.consumePasswordReset({
      codeHash: hashToken(code),
      passwordHash,
      passwordSalt,
    });
    if (!consumed) throw new AuthenticationError();
  }
}

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) || value.length > 254) {
    throw new Error("Invalid email address");
  }
  return value;
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Password must contain between 12 and 256 characters");
  }
}

async function derivePassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("hex"));
    });
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicAccount(account: UserAccount): UserAccount {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    active: account.active,
    languageCode: account.languageCode,
    languageConfigured: account.languageConfigured,
    createdAt: account.createdAt,
  };
}
