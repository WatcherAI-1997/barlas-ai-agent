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
