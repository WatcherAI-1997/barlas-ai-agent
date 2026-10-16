import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  getLanguage,
  isSupportedLanguage,
  languageInstruction,
  supportedLanguages,
} from "../src/i18n/languages.js";

describe("Barlas AI Agent languages", () => {
  it("offers the broad Turkic catalogue, Mongolian, and fallback languages", () => {
    const codes = new Set(supportedLanguages.map((language) => language.code));
    expect(supportedLanguages.length).toBeGreaterThanOrEqual(35);
    for (const code of [
      "tr", "az", "tk", "uz", "ug", "kk", "ky", "kaa", "tt", "ba", "crh", "cv",
      "sah", "tyv", "alt", "kjh", "cjs", "kum", "krc", "nog", "mn", "ru", "en",
    ] as const) expect(codes.has(code)).toBe(true);
  });

  it("preserves writing direction and creates an agent instruction", () => {
    expect(getLanguage("ug")?.direction).toBe("rtl");
    expect(getLanguage("tr")?.direction).toBe("ltr");
    expect(languageInstruction("kk")).toContain("Kazakh");
    expect(languageInstruction("mn")).toContain("Mongolian");
    expect(languageInstruction("unknown")).toBeNull();
    expect(isSupportedLanguage("uz")).toBe(true);
    expect(isSupportedLanguage("de")).toBe(false);
  });

  it("publishes a GitHub product description for every selectable language", () => {
    const overview = readFileSync(new URL("../docs/PRODUCT_OVERVIEW_MULTILINGUAL.md", import.meta.url), "utf8");
    for (const language of supportedLanguages) {
      expect(overview).toContain(`<a id="${language.code}"></a>`);
    }
    expect(overview.match(/<a id="[^"]+"><\/a>/gu)).toHaveLength(supportedLanguages.length);
  });
});
