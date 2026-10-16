import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../src/skills/registry.js";

describe("versioned skill registry", () => {
  it("keeps multiple versions and can activate an earlier safe version", () => {
    const registry = new SkillRegistry();
    registry.register({ id: "writing.test", version: "1.0.0", description: "v1", instructions: "one", allowedTools: [] });
    registry.register({ id: "writing.test", version: "1.1.0", description: "v2", instructions: "two", allowedTools: [] });

    expect(registry.get("writing.test").version).toBe("1.1.0");
    expect(registry.get("writing.test", "1.0.0").instructions).toBe("one");
    expect(registry.activate("writing.test", "1.0.0").version).toBe("1.0.0");
    expect(registry.get("writing.test").version).toBe("1.0.0");
    expect(registry.list()).toHaveLength(2);
  });
});
