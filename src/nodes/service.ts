import { createHash, randomBytes } from "node:crypto";

export type NodePlatform = "linux" | "macos" | "windows" | "android" | "ios";

export interface DeviceNode {
  id: string;
  accountId: string;
  name: string;
  platform: NodePlatform;
  capabilities: string[];
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface DeviceCommand {
  id: string;
  nodeId: string;
  kind: "notify" | "location.get";
  payload: { title: string; body: string } | { accuracy: "balanced" | "high"; timeoutSeconds: number };
  status: "queued" | "delivered" | "completed" | "failed" | "expired";
  result: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string;
}

export interface DeviceNodeStore {
  createNodePairingCode(input: { accountId: string; codeHash: string; expiresAt: Date }): Promise<void>;
  claimNodePairingCode(input: { codeHash: string; tokenHash: string; name: string; platform: NodePlatform; capabilities: string[] }): Promise<DeviceNode | null>;
  authenticateNode(tokenHash: string, capabilities?: string[]): Promise<DeviceNode | null>;
  listDeviceNodes(accountId: string): Promise<DeviceNode[]>;
  revokeDeviceNode(accountId: string, nodeId: string): Promise<boolean>;
  enqueueDeviceCommand(input: {
    accountId: string; nodeId: string; kind: DeviceCommand["kind"];
    payload: DeviceCommand["payload"]; requiredCapability: string; expiresAt: Date;
  }): Promise<DeviceCommand | null>;
  getDeviceCommand(accountId: string, commandId: string): Promise<DeviceCommand | null>;
  claimDeviceCommands(tokenHash: string, limit: number): Promise<DeviceCommand[]>;
  completeDeviceCommand(input: {
    tokenHash: string; commandId: string; succeeded: boolean; error?: string; result?: Record<string, unknown>;
  }): Promise<boolean>;
}

export class DeviceNodeService {
  constructor(private readonly store: DeviceNodeStore, private readonly ttlMinutes = 10) {}

  async createPairingCode(accountId: string): Promise<{ code: string; expiresAt: string }> {
    const code = `NODE-${randomBytes(12).toString("base64url").toUpperCase()}`;
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60_000);
    await this.store.createNodePairingCode({ accountId, codeHash: hash(code), expiresAt });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async pair(input: { code: string; name: string; platform: NodePlatform; capabilities: string[] }) {
    const token = `barlas_node_${randomBytes(32).toString("base64url")}`;
    const node = await this.store.claimNodePairingCode({
      codeHash: hash(input.code.trim().toUpperCase()), tokenHash: hash(token), name: input.name,
      platform: input.platform, capabilities: normalizeCapabilities(input.capabilities),
    });
    return node ? { node, token } : null;
  }

  authenticate(token: string, capabilities?: string[]) {
    return this.store.authenticateNode(hash(token), capabilities ? normalizeCapabilities(capabilities) : undefined);
  }

  list(accountId: string) { return this.store.listDeviceNodes(accountId); }
  revoke(accountId: string, nodeId: string) { return this.store.revokeDeviceNode(accountId, nodeId); }

  notify(accountId: string, nodeId: string, title: string, body: string) {
    return this.store.enqueueDeviceCommand({
      accountId, nodeId, kind: "notify", payload: { title, body }, requiredCapability: "notifications",
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  }

  requestLocation(accountId: string, nodeId: string, accuracy: "balanced" | "high", timeoutSeconds: number) {
    return this.store.enqueueDeviceCommand({
      accountId, nodeId, kind: "location.get", payload: { accuracy, timeoutSeconds }, requiredCapability: "location",
      expiresAt: new Date(Date.now() + Math.min(timeoutSeconds + 30, 150) * 1_000),
    });
  }

  command(accountId: string, commandId: string) { return this.store.getDeviceCommand(accountId, commandId); }

  poll(token: string, limit = 10) { return this.store.claimDeviceCommands(hash(token), limit); }
  complete(token: string, commandId: string, succeeded: boolean, error?: string, result?: Record<string, unknown>) {
    if (result && Buffer.byteLength(JSON.stringify(result), "utf8") > 64_000) return Promise.resolve(false);
    return this.store.completeDeviceCommand({
      tokenHash: hash(token), commandId, succeeded, ...(error ? { error } : {}), ...(result ? { result } : {}),
    });
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities.map((item) => item.trim().toLowerCase()))].filter(Boolean).sort();
}
