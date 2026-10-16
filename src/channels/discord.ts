export interface DiscordInboundMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
}

export class DiscordClient {
  constructor(private readonly token: string, private readonly apiBase = "https://discord.com/api/v10") {}

  async sendMessage(channelId: string, text: string): Promise<void> {
    const chunks = text.match(/[\s\S]{1,1900}/gu) ?? ["(empty response)"];
    for (const content of chunks) {
      const response = await fetch(`${this.apiBase}/channels/${encodeURIComponent(channelId)}/messages`, {
        method: "POST",
        headers: { authorization: `Bot ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Discord sendMessage failed with status ${response.status}`);
    }
  }
}

interface GatewayPayload { op: number; d?: unknown; s?: number | null; t?: string | null }

export class DiscordGatewayWorker {
  private socket?: WebSocket;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  private sequence: number | null = null;
  private botUserId?: string;

  constructor(
    private readonly token: string,
    private readonly deliver: (message: DiscordInboundMessage) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly gatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json",
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.socket?.close(1000, "shutdown");
  }

  handle(payload: GatewayPayload): void {
    if (typeof payload.s === "number") this.sequence = payload.s;
    if (payload.op === 10) {
      const interval = Number((payload.d as { heartbeat_interval?: unknown } | undefined)?.heartbeat_interval);
      if (!Number.isFinite(interval) || interval < 1_000) throw new Error("Discord Gateway sent an invalid heartbeat interval");
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this.send({ op: 1, d: this.sequence }), interval);
      this.send({ op: 2, d: {
        token: this.token,
        intents: 37_376,
        properties: { os: process.platform, browser: "barlas", device: "barlas" },
      } });
      return;
    }
    if (payload.op === 7 || payload.op === 9) {
      this.socket?.close(4000, "reconnect");
      return;
    }
    if (payload.op !== 0) return;
    if (payload.t === "READY") {
      const id = (payload.d as { user?: { id?: unknown } } | undefined)?.user?.id;
      if (typeof id === "string") this.botUserId = id;
      return;
    }
    if (payload.t !== "MESSAGE_CREATE") return;
    const event = payload.d as {
      id?: unknown; channel_id?: unknown; guild_id?: unknown; content?: unknown;
      author?: { id?: unknown; bot?: unknown };
    };
    if (event.author?.bot || typeof event.id !== "string" || typeof event.channel_id !== "string" ||
      typeof event.author?.id !== "string" || typeof event.content !== "string") return;
    let content = event.content.trim();
    if (event.guild_id !== undefined) {
      if (!this.botUserId) return;
      const mention = new RegExp(`<@!?${this.botUserId}>`, "gu");
      if (!mention.test(content)) return;
      content = content.replace(mention, "").trim();
    }
    if (!content) return;
    void this.deliver({ id: event.id, channelId: event.channel_id, authorId: event.author.id, content })
      .catch(this.onError);
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(this.gatewayUrl);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      try { this.handle(JSON.parse(String(event.data)) as GatewayPayload); } catch (error) { this.onError(error); }
    });
    socket.addEventListener("error", (event) => this.onError(event));
    socket.addEventListener("close", () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      if (!this.stopped) setTimeout(() => this.connect(), 2_000);
    });
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }
}
