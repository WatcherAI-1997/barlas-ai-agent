import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Windows desktop node", () => {
  it("pins the downloaded client and exposes only the notification capability", async () => {
    const [client, installer] = await Promise.all([
      readFile(new URL("../scripts/windows-node.ps1", import.meta.url), "utf8"),
      readFile(new URL("../install-node-windows.ps1", import.meta.url), "utf8"),
    ]);
    const digest = createHash("sha256").update(client).digest("hex");
    expect(installer).toContain(`$ExpectedSha256 = "${digest}"`);
    expect(client).toContain('capabilities = @("notifications")');
    expect(client).not.toMatch(/Invoke-Expression|\biex\b|cmd\.exe|\/bin\/sh|powershell.+-Command|pwsh.+-Command/iu);
  });

  it("protects tokens with DPAPI and registers only current-user autostart", async () => {
    const client = await readFile(new URL("../scripts/windows-node.ps1", import.meta.url), "utf8");
    expect(client).toContain("ConvertFrom-SecureString");
    expect(client).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(client).not.toContain("HKLM:");
    expect(client).not.toMatch(/-Verb\s+RunAs/iu);
  });
});
