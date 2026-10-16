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
    format: "pdf" | "docx" | "xlsx" | "pptx";
    text: string;
    truncated: boolean;
  }> {
    const extension = extname(path).toLowerCase();
    if (![".pdf", ".docx", ".xlsx", ".pptx"].includes(extension)) {
      throw new Error("Document extraction supports only .pdf, .docx, .xlsx, and .pptx files");
    }
    const file = await this.workspace.readBuffer(userId, path);
    const raw = extension === ".pdf" ? await extractPdf(file.content)
      : extension === ".docx" ? await extractDocx(file.content)
        : extension === ".xlsx" ? await extractXlsx(file.content)
          : await extractPptx(file.content);
    const limit = 100_000;
    return {
      path: file.path,
      format: extension.slice(1) as "pdf" | "docx" | "xlsx" | "pptx",
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

async function safeZipXml(entry: JSZip.JSZipObject, label: string): Promise<string> {
  const metadata = entry as unknown as { _data?: { uncompressedSize?: number } };
  if ((metadata._data?.uncompressedSize ?? 0) > 20_000_000) throw new Error(`${label} XML exceeds the extraction limit`);
  const xml = await entry.async("string");
  if (xml.length > 20_000_000) throw new Error(`${label} XML exceeds the extraction limit`);
  return xml;
}

async function extractXlsx(content: Buffer): Promise<string> {
  const archive = await JSZip.loadAsync(content, { checkCRC32: true });
  const sharedEntry = archive.file("xl/sharedStrings.xml");
  const shared = sharedEntry ? [...(await safeZipXml(sharedEntry, "XLSX shared strings")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)]
    .map((match) => decodeXml(match[1]!.replace(/<[^>]+>/gu, ""))) : [];
  const sheets = Object.values(archive.files).filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(entry.name) && !entry.dir)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  if (sheets.length === 0) throw new Error("XLSX worksheets are missing");
  const output: string[] = [];
  for (const [index, sheet] of sheets.entries()) {
    const xml = await safeZipXml(sheet, "XLSX worksheet");
    output.push(`Sheet ${index + 1}`);
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
      const values = [...row[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)].map((cell) => {
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/u.exec(cell[2]!)?.[1]
          ?? /<is\b[^>]*>([\s\S]*?)<\/is>/u.exec(cell[2]!)?.[1]?.replace(/<[^>]+>/gu, "") ?? "";
        return cell[1]!.includes('t="s"') ? shared[Number(raw)] ?? raw : decodeXml(raw);
      });
      output.push(values.join("\t"));
    }
  }
  return output.join("\n").trim();
}

async function extractPptx(content: Buffer): Promise<string> {
  const archive = await JSZip.loadAsync(content, { checkCRC32: true });
  const slides = Object.values(archive.files).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/u.test(entry.name) && !entry.dir)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  if (slides.length === 0) throw new Error("PPTX slides are missing");
  const output: string[] = [];
  for (const [index, slide] of slides.entries()) {
    const xml = await safeZipXml(slide, "PPTX slide");
    const text = [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gu)].map((match) => decodeXml(match[1]!)).join("\n");
    output.push(`Slide ${index + 1}\n${text}`);
  }
  return output.join("\n\n").trim();
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
