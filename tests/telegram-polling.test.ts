import { describe, expect, it, vi } from "vitest";

import { TelegramPollingWorker } from "../src/channels/telegram-polling.js";

describe("Telegram local polling", () => {
  it("delivers updates in order and advances the offset only after delivery", async () => {
    const getUpdates = vi.fn(async () => [{ update_id: 10 }, { update_id: 12 }]);
    const deliver = vi.fn(async (_update: { update_id: number }) => undefined);
    const worker = new TelegramPollingWorker(
      { deleteWebhook: vi.fn(async () => undefined), getUpdates },
      deliver,
    );

    await expect(worker.pollOnce(0)).resolves.toBe(2);
    await worker.pollOnce(0);

    expect(deliver.mock.calls.map(([update]) => update.update_id)).toEqual([10, 12, 10, 12]);
    expect(getUpdates.mock.calls).toEqual([[undefined, 0], [13, 0]]);
  });

  it("does not acknowledge an update whose local delivery failed", async () => {
    const getUpdates = vi.fn(async () => [{ update_id: 7 }]);
    const deliver = vi.fn(async (_update: { update_id: number }) => { throw new Error("delivery failed"); });
    const worker = new TelegramPollingWorker(
      { deleteWebhook: vi.fn(async () => undefined), getUpdates },
      deliver,
    );

    await expect(worker.pollOnce(0)).rejects.toThrow("delivery failed");
    await expect(worker.pollOnce(0)).rejects.toThrow("delivery failed");
    expect(getUpdates.mock.calls).toEqual([[undefined, 0], [undefined, 0]]);
  });
});
