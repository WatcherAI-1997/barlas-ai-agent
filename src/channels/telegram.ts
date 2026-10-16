export interface TelegramMessage {
  chatId: number;
  userId: string;
  text: string;
  messageId: number;
}

export class TelegramClient {
  constructor(private readonly botToken: string) {}

  async sendMessage(chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with status ${response.status}`);
    }
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
    if (content.byteLength === 0 || content.byteLength > 10_000_000) {
      throw new Error("Telegram voice reply must be between 1 byte and 10 MB");
    }
    const body = new FormData();
    body.set("chat_id", String(chatId));
    body.set("caption", caption.slice(0, 1_024));
    body.set(
      "voice",
      new Blob([new Uint8Array(content)], { type: "audio/mpeg" }),
      "barlas-voice.mp3",
    );
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendVoice`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Telegram sendVoice failed with status ${response.status}`);
  }

  async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Telegram answerCallbackQuery failed with status ${response.status}`);
  }
}

export function parseTelegramVoiceCommand(text: string): { prompt?: string; requested: boolean } {
  const match = /^\/(?:voice|call)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]+))?$/iu.exec(text.trim());
  if (!match) return { requested: false };
  const prompt = match[1]?.trim();
  return prompt ? { requested: true, prompt } : { requested: true };
}
