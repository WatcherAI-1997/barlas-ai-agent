import { describe, expect, it } from "vitest";

import { evaluateAction } from "../src/policy/approval.js";

describe("approval policy", () => {
  it("allows read-only actions", () => {
    expect(evaluateAction({ tool: "search", risk: "read", summary: "Search docs" })).toMatchObject({
      allowed: true,
      requiresApproval: false,
    });
  });

  it.each(["write", "external", "destructive"] as const)(
    "requires approval for %s actions",
    (risk) => {
      expect(evaluateAction({ tool: "tool", risk, summary: "Proposed action" })).toMatchObject({
        allowed: false,
        requiresApproval: true,
      });
    },
  );
});

