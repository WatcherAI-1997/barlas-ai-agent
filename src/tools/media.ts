import { extname } from "node:path";

import OpenAI, { toFile } from "openai";

import { FileWorkspace } from "./file-workspace.js";

export const MAX_MEDIA_BYTES = 10_000_000;

type MediaKind = "image" | "pdf" | "audio";

export interface DetectedMedia {
  kind: MediaKind;
  mimeType: string;
  extensions: readonly string[];
}

export interface MediaModel {
  analyzeImage(input: {
    content: Buffer;
    mimeType: string;
    prompt: string;
    detail: "auto" | "low" | "high";
  }): Promise<string>;
  analyzePdf(input: { content: Buffer; filename: string; prompt: string }): Promise<string>;
  transcribeAudio(input: {
    content: Buffer;
    filename: string;
    mimeType: string;
    language?: string;
  }): Promise<string>;
  createSpeech(input: { text: string; voice: SpeechVoice }): Promise<Buffer>;
}

export const speechVoices = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx",
  "sage", "shimmer", "verse", "marin", "cedar",
] as const;
export type SpeechVoice = typeof speechVoices[number];

export class MediaService {
  constructor(
    private readonly workspace: FileWorkspace,
    private readonly model: MediaModel,
  ) {}

  async saveUpload(userId: string, path: string, content: Buffer, declaredMimeType?: string) {
    if (content.byteLength === 0) throw new Error("Media file is empty");
    if (content.byteLength > MAX_MEDIA_BYTES) throw new Error("Media file exceeds the 10 MB limit");
    const detected = detectMedia(content);
    assertExtension(path, detected);
    if (declaredMimeType && declaredMimeType !== "application/octet-stream") {
      const aliases = mimeAliases(detected.mimeType);
      if (!aliases.includes(declaredMimeType.toLowerCase())) {
        throw new Error("Declared media type does not match file contents");
      }
    }
    const stored = await this.workspace.writeBuffer(userId, path, content);
    return { ...stored, kind: detected.kind, mimeType: detected.mimeType };
  }

  async analyzeImage(
    userId: string,
    path: string,
    prompt: string,
    detail: "auto" | "low" | "high" = "auto",
  ) {
    const file = await this.workspace.readBuffer(userId, path, MAX_MEDIA_BYTES);
    const detected = detectMedia(file.content);
    if (detected.kind !== "image") throw new Error("The selected file is not a supported image");
    const text = await this.model.analyzeImage({ content: file.content, mimeType: detected.mimeType, prompt, detail });
    return { path: file.path, mimeType: detected.mimeType, text };
  }

  async analyzePdf(userId: string, path: string, prompt: string) {
    const file = await this.workspace.readBuffer(userId, path, MAX_MEDIA_BYTES);
    const detected = detectMedia(file.content);
    if (detected.kind !== "pdf") throw new Error("The selected file is not a PDF document");
    const text = await this.model.analyzePdf({ content: file.content, filename: file.path, prompt });
    return { path: file.path, mimeType: detected.mimeType, text };
  }

  async transcribeAudio(userId: string, path: string, language?: string) {
    const file = await this.workspace.readBuffer(userId, path, MAX_MEDIA_BYTES);
    const detected = detectMedia(file.content);
    if (detected.kind !== "audio") throw new Error("The selected file is not supported audio");
    const text = await this.model.transcribeAudio({
      content: file.content,
      filename: file.path,
      mimeType: detected.mimeType,
      ...(language ? { language } : {}),
    });
    return { path: file.path, mimeType: detected.mimeType, text };
  }

  async transcribeUpload(content: Buffer, filename: string, declaredMimeType?: string, language?: string) {
    if (content.byteLength === 0) throw new Error("Audio recording is empty");
    if (content.byteLength > MAX_MEDIA_BYTES) throw new Error("Audio recording exceeds the 10 MB limit");
    const detected = detectMedia(content);
    if (detected.kind !== "audio") throw new Error("The uploaded recording is not supported audio");
    assertExtension(filename, detected);
    if (declaredMimeType && declaredMimeType !== "application/octet-stream") {
      const normalized = declaredMimeType.toLowerCase().split(";", 1)[0]!;
      if (!mimeAliases(detected.mimeType).includes(normalized)) {
        throw new Error("Declared audio type does not match recording contents");
      }
    }
    const text = await this.model.transcribeAudio({
      content,
      filename,
      mimeType: detected.mimeType,
      ...(language ? { language } : {}),
    });
    return { mimeType: detected.mimeType, text };
  }

  async createSpeech(userId: string, path: string, text: string, voice: SpeechVoice) {
    if (extname(path).toLowerCase() !== ".mp3") throw new Error("Generated speech path must end in .mp3");
    const content = await this.model.createSpeech({ text, voice });
    if (content.byteLength === 0 || content.byteLength > MAX_MEDIA_BYTES) {
      throw new Error("Generated speech exceeds the allowed media size");
    }
    const stored = await this.workspace.writeBuffer(userId, path, content);
    return { ...stored, mimeType: "audio/mpeg", voice };
  }

  async createSpeechBuffer(text: string, voice: SpeechVoice) {
    const content = await this.model.createSpeech({ text, voice });
    if (content.byteLength === 0 || content.byteLength > MAX_MEDIA_BYTES) {
      throw new Error("Generated speech exceeds the allowed media size");
    }
    return { content, mimeType: "audio/mpeg" as const, voice };
  }
}

export class OpenAIMediaModel implements MediaModel {
  private readonly client: OpenAI;

  constructor(private readonly options: {
    apiKey: string;
    visionModel: string;
    transcriptionModel: string;
    speechModel: string;
  }) {
    this.client = new OpenAI({ apiKey: options.apiKey });
  }

  async analyzeImage(input: Parameters<MediaModel["analyzeImage"]>[0]): Promise<string> {
    const response = await this.client.responses.create({
      model: this.options.visionModel,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: input.prompt },
          {
            type: "input_image",
            image_url: `data:${input.mimeType};base64,${input.content.toString("base64")}`,
            detail: input.detail,
          },
        ],
      }],
      max_output_tokens: 4_096,
      metadata: { product: "Barlas AI Agent", capability: "image-analysis" },
    });
    if (!response.output_text) throw new Error("Image model returned no text");
    return response.output_text;
  }

  async analyzePdf(input: Parameters<MediaModel["analyzePdf"]>[0]): Promise<string> {
    const response = await this.client.responses.create({
      model: this.options.visionModel,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: input.prompt },
          {
            type: "input_file",
            filename: input.filename,
            file_data: `data:application/pdf;base64,${input.content.toString("base64")}`,
          },
        ],
      }],
      max_output_tokens: 4_096,
      metadata: { product: "Barlas AI Agent", capability: "pdf-analysis" },
    });
    if (!response.output_text) throw new Error("Document model returned no text");
    return response.output_text;
  }

  async transcribeAudio(input: Parameters<MediaModel["transcribeAudio"]>[0]): Promise<string> {
    const response = await this.client.audio.transcriptions.create({
      model: this.options.transcriptionModel,
      file: await toFile(input.content, input.filename, { type: input.mimeType }),
      response_format: "json",
      ...(input.language ? { language: input.language } : {}),
    });
    if (!("text" in response) || !response.text) throw new Error("Transcription model returned no text");
    return response.text;
  }

  async createSpeech(input: Parameters<MediaModel["createSpeech"]>[0]): Promise<Buffer> {
    const response = await this.client.audio.speech.create({
      model: this.options.speechModel,
      input: input.text,
      voice: input.voice,
      response_format: "mp3",
    });
    return Buffer.from(await response.arrayBuffer());
  }
}

export function detectMedia(content: Buffer): DetectedMedia {
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "image", mimeType: "image/png", extensions: [".png"] };
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg", extensions: [".jpg", ".jpeg"] };
  }
  const prefix = content.subarray(0, 12).toString("ascii");
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) {
    return { kind: "image", mimeType: "image/gif", extensions: [".gif"] };
  }
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP") {
    return { kind: "image", mimeType: "image/webp", extensions: [".webp"] };
  }
  if (content.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { kind: "pdf", mimeType: "application/pdf", extensions: [".pdf"] };
  }
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WAVE") {
    return { kind: "audio", mimeType: "audio/wav", extensions: [".wav"] };
  }
  if (content.subarray(0, 4).toString("ascii") === "OggS") {
    return { kind: "audio", mimeType: "audio/ogg", extensions: [".ogg", ".oga"] };
  }
  if (content.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { kind: "audio", mimeType: "audio/webm", extensions: [".webm"] };
  }
  if (content.subarray(0, 3).toString("ascii") === "ID3" || isMp3Frame(content)) {
    return { kind: "audio", mimeType: "audio/mpeg", extensions: [".mp3", ".mpeg", ".mpga"] };
  }
  if (content.length >= 12 && content.subarray(4, 8).toString("ascii") === "ftyp") {
    return { kind: "audio", mimeType: "audio/mp4", extensions: [".m4a", ".mp4"] };
  }
  throw new Error("Unsupported or unrecognized media file");
}

function assertExtension(path: string, media: DetectedMedia): void {
  const extension = extname(path).toLowerCase();
  if (!media.extensions.includes(extension)) throw new Error("File extension does not match media contents");
}

function mimeAliases(mimeType: string): string[] {
  if (mimeType === "audio/mpeg") return [mimeType, "audio/mp3"];
  if (mimeType === "audio/wav") return [mimeType, "audio/wave", "audio/x-wav"];
  if (mimeType === "audio/mp4") return [mimeType, "audio/x-m4a", "video/mp4"];
  if (mimeType === "image/jpeg") return [mimeType, "image/jpg"];
  return [mimeType];
}

function isMp3Frame(content: Buffer): boolean {
  return content.length >= 2 && content[0] === 0xff && (content[1]! & 0xe0) === 0xe0;
}
