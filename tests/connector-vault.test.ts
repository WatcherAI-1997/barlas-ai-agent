import { describe, expect, it } from "vitest";

import {
  ConnectorService,
  ConnectorVault,
  type ConnectorRecord,
  type ConnectorStore,
  type StoredConnector,
} from "../src/connectors/vault.js";

class MemoryConnectorStore implements ConnectorStore {
  record: StoredConnector | null = null;

  async upsertConnector(input: Parameters<ConnectorStore["upsertConnector"]>[0]): Promise<ConnectorRecord> {
    const now = new Date().toISOString();
    this.record = {
      id: "11111111-1111-4111-8111-111111111111",
      userId: input.userId,
      provider: input.provider,
      label: input.label,
      metadata: input.metadata,
      keyVersion: input.keyVersion,
      createdAt: now,
      updatedAt: now,
      ciphertext: input.ciphertext,
      iv: input.iv,
      authTag: input.authTag,
    };
    return publicRecord(this.record);
  }

  async listConnectors(userId: string): Promise<ConnectorRecord[]> {
    return this.record?.userId === userId ? [publicRecord(this.record)] : [];
  }

  async getConnector(userId: string, id: string): Promise<StoredConnector | null> {
    return this.record?.userId === userId && this.record.id === id ? this.record : null;
  }

  async deleteConnector(userId: string, id: string): Promise<boolean> {
    if (this.record?.userId !== userId || this.record.id !== id) return false;
    this.record = null;
    return true;
  }
}

describe("connector vault", () => {
  it("encrypts at rest and decrypts only for the owning user and provider", async () => {
    const store = new MemoryConnectorStore();
    const service = new ConnectorService(store, new ConnectorVault(Buffer.alloc(32, 7).toString("base64")));
    const saved = await service.save({
      userId: "user-a",
      provider: "github",
      label: "work",
      secret: "github-secret-token",
    });

    expect(store.record?.ciphertext.toString("utf8")).not.toContain("github-secret-token");
    expect(saved).not.toHaveProperty("ciphertext");
    expect(await service.secret("user-a", saved.id, "github")).toBe("github-secret-token");
    expect(await service.secret("user-b", saved.id, "github")).toBeNull();
    expect(await service.secret("user-a", saved.id, "gmail")).toBeNull();
  });

  it("rejects tampering and invalid keys", async () => {
    expect(() => new ConnectorVault("too-short")).toThrow(/32-byte/u);
    const store = new MemoryConnectorStore();
    const service = new ConnectorService(store, new ConnectorVault(Buffer.alloc(32, 9).toString("base64")));
    const saved = await service.save({ userId: "u", provider: "github", label: "main", secret: "secret" });
    const ciphertext = store.record!.ciphertext;
    ciphertext.set([ciphertext.readUInt8(0) ^ 1], 0);
    await expect(service.secret("u", saved.id)).rejects.toThrow();
  });
});

function publicRecord(record: StoredConnector): ConnectorRecord {
  const { ciphertext: _ciphertext, iv: _iv, authTag: _authTag, ...value } = record;
  return value;
}
