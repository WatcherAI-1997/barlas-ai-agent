import { extname } from "node:path";

import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";

import { FileWorkspace } from "./file-workspace.js";

export type DocumentFormat = "markdown" | "text" | "csv" | "docx";

export class DocumentWriter {
  constructor(private readonly workspace: FileWorkspace) {}

  async create(input: {
    userId: string;
    path: string;
    format: DocumentFormat;
    content?: string;
    rows?: string[][];
  }): Promise<{ path: string; format: DocumentFormat; bytes: number }> {
    const expectedExtension = { markdown: ".md", text: ".txt", csv: ".csv", docx: ".docx" }[input.format];
    if (extname(input.path).toLowerCase() !== expectedExtension) {
      throw new Error(`${input.format} documents must use the ${expectedExtension} extension`);
    }
    const content = input.format === "csv" ? serializeCsv(input.rows ?? []) : input.content ?? "";
    const written = input.format === "docx"
      ? await this.workspace.writeBuffer(input.userId, input.path, await createDocx(content))
      : await this.workspace.write(input.userId, input.path, content);
    return { ...written, format: input.format };
  }
}

export class DocumentReader {
  constructor(private readonly workspace: FileWorkspace) {}

  async extract(userId: string, path: string): Promise<{
    path: string;
    format: "pdf" | "docx";
    text: string;
    truncated: boolean;
  }> {
    const extension = extname(path).toLowerCase();
    if (extension !== ".pdf" && extension !== ".docx") {
      throw new Error("Document extraction supports only .pdf and .docx files");
    }
    const file = await this.workspace.readBuffer(userId, path);
    const raw = extension === ".pdf"
      ? await extractPdf(file.content)
      : await extractDocx(file.content);
    const limit = 100_000;
    return {
      path: file.path,
      format: extension === ".pdf" ? "pdf" : "docx",
      text: raw.slice(0, limit),
      truncated: raw.length > limit,
    };
  }
}

async function createDocx(content: string): Promise<Buffer> {
  const paragraphs = content.split(/\r?\n/u).map((text) => new Paragraph({ text }));
  return Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] }));
}

async function extractPdf(content: Buffer): Promise<string> {
  const parser = new PDFParse({ data: content });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(content: Buffer): Promise<string> {
  const archive = await JSZip.loadAsync(content, { checkCRC32: true });
  const entry = archive.file("word/document.xml");
  if (!entry) throw new Error("DOCX document.xml is missing");
  const metadata = entry as unknown as { _data?: { uncompressedSize?: number } };
  if ((metadata._data?.uncompressedSize ?? 0) > 20_000_000) {
    throw new Error("DOCX XML exceeds the extraction limit");
  }
  const xml = await entry.async("string");
  if (xml.length > 20_000_000) throw new Error("DOCX XML exceeds the extraction limit");
  return decodeXml(xml
    .replace(/<w:tab\b[^>]*\/>/gu, "\t")
    .replace(/<w:br\b[^>]*\/>/gu, "\n")
    .replace(/<\/w:p>/gu, "\n")
    .replace(/<[^>]+>/gu, ""))
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function serializeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

function csvCell(value: string): string {
  if (!/[",\r\n]/u.test(value)) return value;
  return `"${value.replace(/"/gu, '""')}"`;
}
