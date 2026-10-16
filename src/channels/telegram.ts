export interface TelegramMessage {
  chatId: number;
  userId: string;
  text: string;
  messageId: number;
}

export interface TelegramUpdate {
  update_id: number;
  [key: string]: unknown;
}

export const TELEGRAM_PUBLIC_UPLOAD_BYTES = 50_000_000;

export interface TelegramClientOptions {
  baseUrl?: string;
  maxUploadBytes?: number;
}

export class TelegramClient {
  readonly maxUploadBytes: number;
  private readonly baseUrl: string;

  constructor(
    private readonly botToken: string,
    options: TelegramClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? "https://api.telegram.org").replace(/\/$/u, "");
    this.maxUploadBytes = options.maxUploadBytes ?? TELEGRAM_PUBLIC_UPLOAD_BYTES;
  }

  private endpoint(method: string): string {
    return `${this.baseUrl}/bot${this.botToken}/${method}`;
  }

  async sendMessage(chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
    const response = await fetch(this.endpoint("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with status ${response.status}`);
    }
  }

  async sendChatAction(chatId: number, action: "typing" | "record_voice" = "typing"): Promise<void> {
    const response = await fetch(this.endpoint("sendChatAction"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Telegram sendChatAction failed with status ${response.status}`);
  }

  sendApproval(chatId: number, text: string, approvalId: string): Promise<void> {
    return this.sendMessage(chatId, text, {
      inline_keyboard: [[
        { text: "Разрешить", callback_data: `approve:${approvalId}` },
        { text: "Отклонить", callback_data: `reject:${approvalId}` },
      ]],
    });
  }

  async sendVoice(chatId: number, content: Buffer, caption = "Barlas AI Agent"): Promise<void> {
    if (content.byteLength === 0 || content.byteLength > this.maxUploadBytes) {
      throw new Error(`Telegram voice reply must be between 1 byte and ${this.maxUploadBytes} bytes`);
    }
    const body = new FormData();
    body.set("chat_id", String(chatId));
    body.set("caption", caption.slice(0, 1_024));
    body.set(
      "voice",
      new Blob([new Uint8Array(content)], { type: "audio/mpeg" }),
      "barlas-voice.mp3",
    );
    const response = await fetch(this.endpoint("sendVoice"), {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Telegram sendVoice failed with status ${response.status}`);
  }

  async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    const response = await fetch(this.endpoint("answerCallbackQuery"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Telegram answerCallbackQuery failed with status ${response.status}`);
  }

  async deleteWebhook(): Promise<void> {
    const response = await fetch(this.endpoint("deleteWebhook"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Telegram deleteWebhook failed with status ${response.status}`);
  }

  async getUpdates(offset?: number, timeoutSeconds = 25): Promise<TelegramUpdate[]> {
    const response = await fetch(this.endpoint("getUpdates"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(offset === undefined ? {} : { offset }),
        timeout: timeoutSeconds,
        allowed_updates: ["message", "callback_query"],
      }),
      signal: AbortSignal.timeout((timeoutSeconds + 10) * 1_000),
    });
    if (!response.ok) throw new Error(`Telegram getUpdates failed with status ${response.status}`);
    const payload = await response.json() as { ok?: boolean; result?: unknown };
    if (!payload.ok || !Array.isArray(payload.result)) throw new Error("Telegram getUpdates returned an invalid response");
    return payload.result.filter((item): item is TelegramUpdate => (
      typeof item === "object" && item !== null && Number.isInteger((item as TelegramUpdate).update_id)
    ));
  }
}

export function parseTelegramVoiceCommand(text: string): { prompt?: string; requested: boolean } {
  const match = /^\/(?:voice|call)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]+))?$/iu.exec(text.trim());
  if (!match) return { requested: false };
  const prompt = match[1]?.trim();
  return prompt ? { requested: true, prompt } : { requested: true };
}
