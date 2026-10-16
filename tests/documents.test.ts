import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentReader, DocumentWriter } from "../src/tools/documents.js";
import { FileWorkspace } from "../src/tools/file-workspace.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("document writer", () => {
  it("creates an escaped CSV inside the owning user's workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-documents-"));
    roots.push(root);
    const workspace = new FileWorkspace(root);
    const writer = new DocumentWriter(workspace);
    const result = await writer.create({
      userId: "user-a",
      path: "reports/data.csv",
      format: "csv",
      rows: [["name", "note"], ["Barlas", "one, \"two\""]],
    });

    expect(result).toMatchObject({ path: "reports/data.csv", format: "csv" });
    const saved = await workspace.pathForRead("user-a", "reports/data.csv");
    expect(await readFile(saved.absolutePath, "utf8")).toBe('name,note\r\nBarlas,"one, ""two"""\r\n');
    await expect(workspace.read("user-b", "reports/data.csv")).rejects.toThrow();
  });

  it("requires a matching safe extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-documents-"));
    roots.push(root);
    const writer = new DocumentWriter(new FileWorkspace(root));
    await expect(writer.create({
      userId: "user-a",
      path: "report.html",
      format: "markdown",
      content: "# Report",
    })).rejects.toThrow(/\.md/u);
  });

  it("creates and extracts a Unicode DOCX in the owning workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-documents-"));
    roots.push(root);
    const workspace = new FileWorkspace(root);
    const writer = new DocumentWriter(workspace);
    const reader = new DocumentReader(workspace);
    const content = "Barlas AI Agent\nҚазақша · Монгол хэл · O‘zbekcha";
    await writer.create({ userId: "user-a", path: "reports/overview.docx", format: "docx", content });

    await expect(reader.extract("user-a", "reports/overview.docx")).resolves.toMatchObject({
      format: "docx",
      text: content,
      truncated: false,
    });
    await expect(reader.extract("user-b", "reports/overview.docx")).rejects.toThrow();
  });

  it("extracts bounded text from a PDF", async () => {
    const root = await mkdtemp(join(tmpdir(), "barlas-documents-"));
    roots.push(root);
    const workspace = new FileWorkspace(root);
    await workspace.writeBuffer("user-a", "reports/report.pdf", minimalPdf("Barlas PDF report"));
    const result = await new DocumentReader(workspace).extract("user-a", "reports/report.pdf");
    expect(result).toMatchObject({ format: "pdf", truncated: false });
    expect(result.text).toContain("Barlas PDF report");
  });
});

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/gu, "\\$1");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
