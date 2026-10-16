import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const connectorProviders = ["github", "google_drive", "gmail", "google_calendar"] as const;
export type ConnectorProvider = (typeof connectorProviders)[number];

export interface ConnectorRecord {
  id: string;
  userId: string;
  provider: ConnectorProvider;
  label: string;
  metadata: Record<string, unknown>;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredConnector extends ConnectorRecord {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface ConnectorStore {
  upsertConnector(input: {
    userId: string;
    provider: ConnectorProvider;
    label: string;
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
    keyVersion: number;
    metadata: Record<string, unknown>;
  }): Promise<ConnectorRecord>;
  listConnectors(userId: string): Promise<ConnectorRecord[]>;
  getConnector(userId: string, id: string): Promise<StoredConnector | null>;
  deleteConnector(userId: string, id: string): Promise<boolean>;
}

export class ConnectorVault {
  private readonly key: Buffer;

  constructor(base64Key: string, readonly keyVersion = 1) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32 || key.toString("base64") !== base64Key) {
      throw new Error("CONNECTOR_VAULT_KEY must be a canonical base64-encoded 32-byte key");
    }
    this.key = key;
  }

  encrypt(input: { userId: string; provider: ConnectorProvider; label: string; secret: string }): {
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
    keyVersion: number;
  } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad(input.userId, input.provider, input.label, this.keyVersion));
    const ciphertext = Buffer.concat([cipher.update(input.secret, "utf8"), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: this.keyVersion };
  }

  decrypt(record: StoredConnector): string {
    if (record.keyVersion !== this.keyVersion) {
      throw new Error(`Unsupported connector vault key version: ${record.keyVersion}`);
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, record.iv);
    decipher.setAAD(aad(record.userId, record.provider, record.label, record.keyVersion));
    decipher.setAuthTag(record.authTag);
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString("utf8");
  }
}

export class ConnectorService {
  constructor(private readonly store: ConnectorStore, private readonly vault: ConnectorVault) {}

  async save(input: {
    userId: string;
    provider: ConnectorProvider;
    label: string;
    secret: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConnectorRecord> {
    const label = input.label.trim();
    const encrypted = this.vault.encrypt({ ...input, label });
    return this.store.upsertConnector({
      userId: input.userId,
      provider: input.provider,
      label,
      metadata: input.metadata ?? {},
      ...encrypted,
    });
  }

  list(userId: string): Promise<ConnectorRecord[]> {
    return this.store.listConnectors(userId);
  }

  delete(userId: string, id: string): Promise<boolean> {
    return this.store.deleteConnector(userId, id);
  }

  async secret(userId: string, id: string, provider?: ConnectorProvider): Promise<string | null> {
    const record = await this.store.getConnector(userId, id);
    if (!record || (provider && record.provider !== provider)) return null;
    return this.vault.decrypt(record);
  }
}

function aad(userId: string, provider: ConnectorProvider, label: string, keyVersion: number): Buffer {
  return Buffer.from(`Barlas AI Agent\0${userId}\0${provider}\0${label}\0${keyVersion}`, "utf8");
}
