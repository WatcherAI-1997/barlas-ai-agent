import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  getLanguage,
  getSetupPhrasePack,
  getSetupPhrasePackDescriptor,
  getSetupLanguage,
  isSupportedLanguage,
  isVerifiedSetupLanguage,
  languageInstruction,
  setupTranslationStatus,
  setupPhraseKeys,
  setupPhrasePackCompleteness,
  setupLanguageInstruction,
  supportedLanguages,
  verifiedSetupLanguages,
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

  it("reports installer translation coverage without disguising fallbacks", () => {
    expect(verifiedSetupLanguages).toEqual(["en", "ru", "uz"]);
    expect(isVerifiedSetupLanguage("ru")).toBe(true);
    expect(isVerifiedSetupLanguage("kk")).toBe(false);
    expect(getSetupLanguage("uz")).toBe("uz");
    expect(getSetupLanguage("kk")).toBe("en");
    expect(getSetupPhrasePack("uz").title).toBe("Tilni tanlang");
    expect(getSetupPhrasePack("uz").loginTitle).toBe("Barlas AI Agent tizimiga kirish");
    expect(getSetupPhrasePack("kk").title).toBe("Choose your language");
    expect(setupTranslationStatus("en")).toBe("verified");
    expect(setupTranslationStatus("tr")).toBe("fallback");
    expect(setupTranslationStatus("de")).toBe("unsupported");
    expect(setupPhrasePackCompleteness("en")).toBe(1);
    expect(setupPhrasePackCompleteness("ru")).toBe(1);
    expect(setupPhrasePackCompleteness("uz")).toBe(1);
    expect(setupPhrasePackCompleteness("kk")).toBe(0);
    expect(getSetupPhrasePackDescriptor("uz")).toMatchObject({
      schemaVersion: 1, revision: "2026.10.1", language: "uz", reviewedAt: "2026-10-24",
    });
    expect(Object.keys(getSetupPhrasePack("ru")).sort()).toEqual([...setupPhraseKeys].sort());
    expect(getSetupPhrasePackDescriptor("kk").language).toBe("en");
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
