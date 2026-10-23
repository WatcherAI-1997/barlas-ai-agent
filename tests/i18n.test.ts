import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  getLanguage,
  isSupportedLanguage,
  languageInstruction,
  setupLanguageInstruction,
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
    expect(supportedLanguages).toHaveLength(38);
  });

  it("preserves writing direction and creates an agent instruction", () => {
    expect(getLanguage("ug")?.direction).toBe("rtl");
    expect(getLanguage("tr")?.direction).toBe("ltr");
    expect(languageInstruction("kk")).toContain("Kazakh");
    expect(languageInstruction("mn")).toContain("Mongolian");
    expect(languageInstruction("unknown")).toBeNull();
    expect(setupLanguageInstruction("ug")).toContain("all subsequent onboarding");
    expect(setupLanguageInstruction("unknown")).toBeNull();
    expect(isSupportedLanguage("uz")).toBe(true);
    expect(isSupportedLanguage("de")).toBe(false);
  });

  it("publishes a GitHub product description for every selectable language", () => {
    const overview = readFileSync(new URL("../docs/PRODUCT_OVERVIEW_MULTILINGUAL.md", import.meta.url), "utf8");
    const anchors = supportedLanguages.map((language) => `<a id="${language.code}"></a>`);
    for (const [index, language] of supportedLanguages.entries()) {
      const anchor = anchors[index]!;
      expect(overview).toContain(anchor);
      expect(overview).toContain(`[${language.nativeName}](#${language.code})`);
      const start = overview.indexOf(anchor);
      const end = index + 1 < anchors.length
        ? overview.indexOf(anchors[index + 1]!, start)
        : overview.indexOf("## Shared technical documentation", start);
      const section = overview.slice(start, end);
      expect(section.length, `${language.name} overview is too short`).toBeGreaterThan(1_000);
      expect(section.match(/^- /gmu), `${language.name} overview lacks full product areas`).toHaveLength(5);
    }
    expect(overview.match(/<a id="[^"]+"><\/a>/gu)).toHaveLength(supportedLanguages.length);
  });
});
