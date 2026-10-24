import { describe, expect, it } from "vitest";

import { assessSkillCapabilities, runtimeCapabilities } from "../src/skills/capabilities.js";
import type { SkillDefinition } from "../src/skills/registry.js";

const skill = (overrides: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id: "research.capability-test",
  version: "1.0.0",
  description: "Capability test",
  instructions: "Use only available capabilities.",
  allowedTools: ["files.read", "browser.interact"],
  ...overrides,
});

describe("skill capability assessment", () => {
  it("distinguishes ready, degraded, and unavailable workflows", () => {
    expect(assessSkillCapabilities(
      skill(),
      runtimeCapabilities(["files.read", "browser.interact"]),
    )).toMatchObject({ readiness: "ready", usable: true, missingTools: [] });

    expect(assessSkillCapabilities(
      skill(),
      runtimeCapabilities(["files.read"]),
    )).toMatchObject({
      readiness: "degraded",
      usable: true,
      availableTools: ["files.read"],
      missingTools: ["browser.interact"],
    });

    expect(assessSkillCapabilities(
      skill({ requiredCapabilities: ["runner.codex"] }),
      runtimeCapabilities(["files.read", "browser.interact"]),
    )).toMatchObject({
      readiness: "unavailable",
      usable: false,
      missingCapabilities: ["runner.codex"],
    });
  });

  it("includes only configured extensions as available capabilities", () => {
    const capabilities = runtimeCapabilities(["files.read"], [
      { id: "connector.mcp", configured: true },
      { id: "runtime.browser", configured: false },
    ]);
    expect([...capabilities].sort()).toEqual(["connector.mcp", "files.read"]);
  });
});
