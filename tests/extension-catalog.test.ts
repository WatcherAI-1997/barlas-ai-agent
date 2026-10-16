import { describe, expect, it } from "vitest";

import { createBuiltinExtensionCatalog, ExtensionCatalog } from "../src/extensions/catalog.js";

describe("Barlas extension catalog", () => {
  it("reports built-in capability availability without exposing secrets", () => {
    const catalog = createBuiltinExtensionCatalog({
      browser: true, github: false, google: false, mcp: true, sandbox: true,
      telegram: true, privateModel: false, deviceNodes: true,
    });
    expect(catalog.get("channel.telegram")).toMatchObject({ configured: true, kind: "channel" });
    expect(catalog.get("connector.github")).toMatchObject({ configured: false });
    expect(catalog.list().map((item) => item.id)).toEqual([...catalog.list().map((item) => item.id)].sort());
    expect(JSON.stringify(catalog.list())).not.toContain("token-value");
  });

  it("rejects malformed and duplicate manifests", () => {
    const catalog = new ExtensionCatalog();
    const manifest = {
      id: "provider.test", name: "Test", version: "1.0.0", description: "Test provider",
      kind: "provider" as const, capabilities: ["chat"], risks: ["external" as const],
      configuration: ["TEST_KEY"], builtin: false,
    };
    catalog.register(manifest);
    expect(() => catalog.register(manifest)).toThrow(/already registered/u);
    expect(() => catalog.register({ ...manifest, id: "BAD" })).toThrow(/Invalid extension id/u);
  });
});
