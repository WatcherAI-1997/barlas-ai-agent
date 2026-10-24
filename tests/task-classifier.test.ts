import { describe, expect, it } from "vitest";

import { inferTaskClass } from "../src/core/task-classifier.js";

describe("adaptive task classification", () => {
  it("keeps short factual turns on the fast route", () => {
    expect(inferTaskClass({ messages: [{ role: "user", content: "What time is it?" }] })).toBe("fast");
  });

  it("routes substantial autonomous work to the deep model", () => {
    expect(inferTaskClass({
      messages: [{ role: "user", content: "Исследуй варианты, разработай план, затем реализуй и проверь результат." }],
    })).toBe("deep");
  });

  it("uses project and skill context as complexity signals", () => {
    expect(inferTaskClass({
      messages: [{ role: "user", content: "Продолжай." }],
      hasProject: true,
      hasSkill: true,
    })).toBe("deep");
  });
});
