import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileWorkspace } from "../src/tools/file-workspace.js";
import { detectMedia, MediaService, type MediaModel } from "../src/tools/media.js";

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("safe-image"),
]);
const pdf = Buffer.from("%PDF-1.7\nmock document\n%%EOF");
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(16)]);

describe("secure multimodal media service", () => {
  let root: string;
  let model: MediaModel;
  let service: MediaService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "barlas-media-"));
    model = {
      analyzeImage: vi.fn(async () => "image result"),
      analyzePdf: vi.fn(async () => "pdf result"),
      transcribeAudio: vi.fn(async () => "audio result"),
      createSpeech: vi.fn(async () => Buffer.from("generated mp3")),
    };
    service = new MediaService(new FileWorkspace(root), model);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("recognizes supported magic bytes and rejects active or unknown formats", () => {
    expect(detectMedia(png)).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(detectMedia(pdf)).toMatchObject({ kind: "pdf", mimeType: "application/pdf" });
    expect(detectMedia(wav)).toMatchObject({ kind: "audio", mimeType: "audio/wav" });
    expect(() => detectMedia(Buffer.from("<svg><script>alert(1)</script></svg>"))).toThrow(/unsupported/i);
  });

  it("validates content, declared MIME type, and extension before storing", async () => {
    await expect(service.saveUpload("alice", "media/photo.png", png, "image/png")).resolves.toMatchObject({
      path: "media/photo.png", kind: "image", mimeType: "image/png",
    });
    await expect(service.saveUpload("alice", "media/photo.jpg", png, "image/png")).rejects.toThrow(/extension/i);
    await expect(service.saveUpload("alice", "media/photo.png", png, "image/jpeg")).rejects.toThrow(/declared/i);
  });

  it("keeps media isolated per user and calls the matching model capability", async () => {
    await service.saveUpload("alice", "media/photo.png", png, "image/png");
    await service.saveUpload("alice", "media/document.pdf", pdf, "application/pdf");
    await service.saveUpload("alice", "media/voice.wav", wav, "audio/wav");

    await expect(service.analyzeImage("alice", "media/photo.png", "Describe", "high"))
      .resolves.toMatchObject({ text: "image result" });
    await expect(service.analyzePdf("alice", "media/document.pdf", "Summarize"))
      .resolves.toMatchObject({ text: "pdf result" });
    await expect(service.transcribeAudio("alice", "media/voice.wav", "tr"))
      .resolves.toMatchObject({ text: "audio result" });
    await expect(service.analyzeImage("bob", "media/photo.png", "Describe"))
      .rejects.toThrow();

    expect(model.analyzeImage).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png", detail: "high" }));
    expect(model.analyzePdf).toHaveBeenCalledWith(expect.objectContaining({ filename: "media/document.pdf" }));
    expect(model.transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ language: "tr" }));
  });

  it("writes generated speech only to an MP3 workspace path", async () => {
    await expect(service.createSpeech("alice", "media/reply.mp3", "Salam", "alloy"))
      .resolves.toMatchObject({ path: "media/reply.mp3", mimeType: "audio/mpeg", voice: "alloy" });
    await expect(service.createSpeech("alice", "media/reply.wav", "Salam", "alloy"))
      .rejects.toThrow(/\.mp3/i);
  });

  it("processes an ephemeral voice turn without writing the microphone recording", async () => {
    await expect(service.transcribeUpload(wav, "voice.wav", "audio/wav;codecs=pcm", "ru"))
      .resolves.toEqual({ mimeType: "audio/wav", text: "audio result" });
    await expect(service.createSpeechBuffer("Ответ", "nova"))
      .resolves.toMatchObject({ content: Buffer.from("generated mp3"), mimeType: "audio/mpeg", voice: "nova" });
    await expect(service.transcribeUpload(png, "voice.png", "image/png"))
      .rejects.toThrow(/audio/i);
    expect(model.transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ filename: "voice.wav", language: "ru" }));
    await expect(service.transcribeAudio("alice", "voice.wav")).rejects.toThrow();
  });
});
