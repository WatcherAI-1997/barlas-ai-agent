import { extname } from "node:path";

import { FileWorkspace } from "./file-workspace.js";

export type DocumentFormat = "markdown" | "text" | "csv";

export class DocumentWriter {
  constructor(private readonly workspace: FileWorkspace) {}

  async create(input: {
    userId: string;
    path: string;
    format: DocumentFormat;
    content?: string;
    rows?: string[][];
  }): Promise<{ path: string; format: DocumentFormat; bytes: number }> {
    const expectedExtension = { markdown: ".md", text: ".txt", csv: ".csv" }[input.format];
    if (extname(input.path).toLowerCase() !== expectedExtension) {
      throw new Error(`${input.format} documents must use the ${expectedExtension} extension`);
    }
    const content = input.format === "csv" ? serializeCsv(input.rows ?? []) : input.content ?? "";
    const written = await this.workspace.write(input.userId, input.path, content);
    return { ...written, format: input.format };
  }
}

function serializeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

function csvCell(value: string): string {
  if (!/[",\r\n]/u.test(value)) return value;
  return `"${value.replace(/"/gu, '""')}"`;
}
