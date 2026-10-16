import type { FileWorkspace } from "../tools/file-workspace.js";
import type { MediaService, SpeechVoice } from "../tools/media.js";
import type { TelegramClient } from "./telegram.js";

const MAX_SPEECH_TEXT = 4_096;
const MAX_TELEGRAM_TEXT = 4_096;
const VOICE_FALLBACK_SUFFIX = "\n\nНе удалось отправить голосовую версию; отправлен текст.";

export function telegramVoiceFallbackText(text: string): string {
  const normalized = text.trim();
  return `${normalized.slice(0, MAX_TELEGRAM_TEXT - VOICE_FALLBACK_SUFFIX.length)}${VOICE_FALLBACK_SUFFIX}`;
}

export async function sendTelegramVoiceReply(input: {
  client: Pick<TelegramClient, "sendVoice" | "maxUploadBytes">;
  media: Pick<MediaService, "createSpeech">;
  workspace: Pick<FileWorkspace, "readBuffer">;
  userId: string;
  chatId: number;
  runId: string;
  text: string;
  voice?: SpeechVoice;
}): Promise<{ path: string; bytes: number; truncated: boolean }> {
  const normalized = input.text.trim();
  if (!normalized) throw new Error("Telegram voice reply text is empty");
  const truncated = normalized.length > MAX_SPEECH_TEXT;
  const speechText = normalized.slice(0, MAX_SPEECH_TEXT);
  const path = `telegram/voice/${input.runId}.mp3`;
  const generated = await input.media.createSpeech(
    input.userId,
    path,
    speechText,
    input.voice ?? "alloy",
  );
  const file = await input.workspace.readBuffer(input.userId, generated.path, input.client.maxUploadBytes);
  await input.client.sendVoice(input.chatId, file.content, truncated
    ? "Barlas AI Agent · голосовая версия сокращена до 4096 символов"
    : "Barlas AI Agent · голосовой ответ");
  return { path: generated.path, bytes: generated.bytes, truncated };
}
