import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("GitHub presentation", () => {
  it("keeps every local README link and image target valid", async () => {
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    const targets = [
      ...readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu),
      ...readme.matchAll(/<img\s+[^>]*src="([^"]+)"/gu),
    ].map((match) => match[1]!).filter((target) => !/^(?:https?:|#)/u.test(target));
    for (const target of targets) {
      await expect(access(resolve(root, target.split("#", 1)[0]!)), target).resolves.toBeUndefined();
    }
  });

  it("uses the dedicated 3:1 GitHub hero without replacing the original logo", async () => {
    const [hero, original, readme] = await Promise.all([
      readFile(resolve(root, "assets/brand/barlas-ai-agent-github-hero.png")),
      readFile(resolve(root, "assets/brand/barlas-ai-agent-logo-original.png")),
      readFile(resolve(root, "README.md"), "utf8"),
    ]);
    expect(hero.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect({ width: hero.readUInt32BE(16), height: hero.readUInt32BE(20) }).toEqual({ width: 2172, height: 724 });
    expect(original.equals(hero)).toBe(false);
    expect(readme).toContain("assets/brand/barlas-ai-agent-github-hero.png");
  });
});
