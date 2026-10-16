import type { TelegramClient, TelegramUpdate } from "./telegram.js";

export class TelegramPollingWorker {
  private offset: number | undefined;
  private stopped = true;
  private loop: Promise<void> | undefined;

  constructor(
    private readonly client: Pick<TelegramClient, "deleteWebhook" | "getUpdates">,
    private readonly deliver: (update: TelegramUpdate) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async pollOnce(timeoutSeconds = 25): Promise<number> {
    const updates = await this.client.getUpdates(this.offset, timeoutSeconds);
    for (const update of updates) {
      await this.deliver(update);
      this.offset = update.update_id + 1;
    }
    return updates.length;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.client.deleteWebhook();
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.pollOnce();
      } catch (error) {
        if (this.stopped) break;
        this.onError(error);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }
}
