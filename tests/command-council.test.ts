import { describe, expect, it } from "vitest";

import { barlasCouncil, chiefBarlasInstruction, councilRoleIds } from "../src/agents/command.js";

describe("Barlas Command", () => {
  it("defines a stable council with distinct roles and bounded authority", () => {
    expect(barlasCouncil.map((role) => role.id)).toEqual(councilRoleIds);
    expect(new Set(barlasCouncil.map((role) => role.character)).size).toBe(barlasCouncil.length);
    expect(barlasCouncil.every((role) => role.mandate.length > 30 && role.boundaries.length > 30)).toBe(true);
    expect(barlasCouncil.find((role) => role.id === "guardian")?.boundaries).toMatch(/owner|policy/iu);
  });

  it("keeps the owner above the Chief and the Chief accountable", () => {
    const instruction = chiefBarlasInstruction();
    expect(instruction).toContain("owner is the highest authority");
    expect(instruction).toContain("single accountable voice");
    expect(instruction).toContain("approval-gated execution loop");
  });
});
