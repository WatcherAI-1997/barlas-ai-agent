import { describe, expect, it, vi } from "vitest";

import { DeviceNodeService, type DeviceNode, type DeviceNodeStore } from "../src/nodes/service.js";

function store(): DeviceNodeStore {
  const node: DeviceNode = {
    id: "00000000-0000-4000-8000-000000000021", accountId: "00000000-0000-4000-8000-000000000001",
    name: "Laptop", platform: "linux", capabilities: ["notifications"], lastSeenAt: null,
    createdAt: "2026-10-16T00:00:00.000Z", revokedAt: null,
  };
  return {
    createNodePairingCode: vi.fn(async () => undefined),
    claimNodePairingCode: vi.fn(async () => node),
    authenticateNode: vi.fn(async () => node),
    listDeviceNodes: vi.fn(async () => [node]),
    revokeDeviceNode: vi.fn(async () => true),
    enqueueDeviceCommand: vi.fn(async (input) => ({ id: "00000000-0000-4000-8000-000000000022", nodeId: input.nodeId, kind: "notify" as const, payload: input.payload, status: "queued" as const, createdAt: node.createdAt })),
    claimDeviceCommands: vi.fn(async () => []),
    completeDeviceCommand: vi.fn(async () => true),
  };
}

describe("Barlas device nodes", () => {
  it("issues one-time pairing material and stores only hashes", async () => {
    const backend = store();
    const service = new DeviceNodeService(backend);
    const pairing = await service.createPairingCode("00000000-0000-4000-8000-000000000001");
    expect(pairing.code).toMatch(/^NODE-/u);
    const storedCode = vi.mocked(backend.createNodePairingCode).mock.calls[0]?.[0];
    expect(storedCode?.codeHash).not.toContain(pairing.code);

    const paired = await service.pair({ code: pairing.code, name: "Laptop", platform: "linux", capabilities: ["Notifications", "notifications"] });
    expect(paired?.token).toMatch(/^barlas_node_/u);
    const claim = vi.mocked(backend.claimNodePairingCode).mock.calls[0]?.[0];
    expect(claim?.tokenHash).not.toContain(paired!.token);
    expect(claim?.capabilities).toEqual(["notifications"]);
  });

  it("queues only the bounded notification command through the store", async () => {
    const backend = store();
    const service = new DeviceNodeService(backend);
    const command = await service.notify("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000021", "Ready", "Task completed");
    expect(command).toMatchObject({ kind: "notify", status: "queued" });
  });
});
