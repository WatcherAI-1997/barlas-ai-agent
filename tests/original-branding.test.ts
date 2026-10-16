import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const textExtensions = new Set([
  ".cjs", ".css", ".env", ".html", ".js", ".json", ".md", ".mjs", ".ps1",
  ".sh", ".sql", ".ts", ".txt", ".yaml", ".yml",
]);

describe("original Barlas product branding", () => {
  it("does not publish competitor product names in tracked product files", async () => {
    const forbidden = [
      ["open", "claw"].join(""),
      ["her", "mes"].join(""),
    ];
    const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .filter((path) => textExtensions.has(path.slice(path.lastIndexOf("."))));
    const violations: string[] = [];
    for (const path of files) {
      let content: string;
      try { content = (await readFile(resolve(root, path), "utf8")).toLocaleLowerCase(); }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
      if (forbidden.some((name) => content.includes(name))) violations.push(path);
    }
    expect(violations).toEqual([]);
  });
});
