import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("Barlas web interface", () => {
  it("keeps responsive navigation and accessible feedback primitives", async () => {
    const [html, css, script] = await Promise.all([
      readFile(resolve(root, "web/index.html"), "utf8"),
      readFile(resolve(root, "web/styles.css"), "utf8"),
      readFile(resolve(root, "web/app.js"), "utf8"),
    ]);

    for (const marker of [
      'id="nav-toggle"',
      'aria-controls="primary-nav"',
      'aria-current="page"',
      'id="toast-region"',
      'aria-live="polite"',
      'id="detail-dialog"',
      'aria-labelledby="dialog-title"',
      'id="voice-toggle"',
      'aria-pressed="false"',
    ]) expect(html).toContain(marker);
    expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>/u);

    for (const marker of [
      "prefers-reduced-motion",
      "button:focus-visible",
      ".nav-backdrop",
      "grid-template-areas",
      "@media (max-width: 700px)",
    ]) expect(css).toContain(marker);

    for (const marker of [
      "function notify(",
      "function showDialog(",
      "aria-current",
      "navigator.clipboard.writeText",
      "closeNavigation",
      "navigator.mediaDevices.getUserMedia",
      "function stopVoiceTracks(",
      'consent: "true"',
    ]) expect(script).toContain(marker);
    expect(script).not.toContain("alert(");
  });
});
