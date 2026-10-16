export interface SlackInboundMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
}

export class SlackClient {
  constructor(
    private readonly botToken: string,
    private readonly appToken: string,
    private readonly apiBase = "https://slack.com/api",
  ) {}

  async openSocket(): Promise<string> {
    const response = await fetch(`${this.apiBase}/apps.connections.open`, {
      method: "POST", headers: { authorization: `Bearer ${this.appToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json() as { ok?: boolean; url?: unknown; error?: unknown };
    if (!response.ok || !body.ok || typeof body.url !== "string" || !body.url.startsWith("wss://")) {
      throw new Error(`Slack Socket Mode connection failed: ${String(body.error ?? response.status)}`);
    }
    return body.url;
  }

  async sendMessage(channelId: string, text: string): Promise<void> {
    const chunks = text.match(/[\s\S]{1,3500}/gu) ?? ["(empty response)"];
    for (const chunk of chunks) {
      const response = await fetch(`${this.apiBase}/chat.postMessage`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.botToken}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel: channelId, text: chunk, unfurl_links: false, unfurl_media: false }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json() as { ok?: boolean; error?: unknown };
      if (!response.ok || !body.ok) throw new Error(`Slack chat.postMessage failed: ${String(body.error ?? response.status)}`);
    }
  }
}

export class SlackSocketWorker {
  private socket?: WebSocket;
  private stopped = true;

  constructor(
    private readonly client: Pick<SlackClient, "openSocket">,
    private readonly deliver: (message: SlackInboundMessage) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close(1000, "shutdown");
  }

  handleEnvelope(value: unknown, acknowledge: (envelopeId: string) => void = () => undefined): void {
    if (typeof value !== "object" || value === null) return;
    const envelope = value as { envelope_id?: unknown; type?: unknown; payload?: unknown };
    if (typeof envelope.envelope_id === "string") acknowledge(envelope.envelope_id);
    if (envelope.type !== "events_api" || typeof envelope.payload !== "object" || envelope.payload === null) return;
    const payload = envelope.payload as { event_id?: unknown; event?: unknown };
    if (typeof payload.event_id !== "string" || typeof payload.event !== "object" || payload.event === null) return;
    const event = payload.event as {
      type?: unknown; subtype?: unknown; bot_id?: unknown; user?: unknown; channel?: unknown;
      channel_type?: unknown; text?: unknown; ts?: unknown;
    };
    if (event.bot_id || event.subtype || typeof event.user !== "string" || typeof event.channel !== "string" || typeof event.text !== "string") return;
    if (event.type !== "app_mention" && !(event.type === "message" && event.channel_type === "im")) return;
    const content = event.type === "app_mention" ? event.text.replace(/<@[A-Z0-9]+>/giu, "").trim() : event.text.trim();
    if (!content) return;
    void this.deliver({ id: payload.event_id, channelId: event.channel, authorId: event.user, content }).catch(this.onError);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    try {
      const socket = new WebSocket(await this.client.openSocket());
      this.socket = socket;
      socket.addEventListener("message", (event) => {
        try {
          this.handleEnvelope(JSON.parse(String(event.data)) as unknown, (envelopeId) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ envelope_id: envelopeId }));
          });
        } catch (error) { this.onError(error); }
      });
      socket.addEventListener("error", (event) => this.onError(event));
      socket.addEventListener("close", () => {
        if (!this.stopped) setTimeout(() => void this.connect(), 2_000);
      });
    } catch (error) {
      this.onError(error);
      if (!this.stopped) setTimeout(() => void this.connect(), 2_000);
    }
  }
}
