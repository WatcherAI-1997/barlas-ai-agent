export const supportedLanguages = [
  { code: "tr", name: "Turkish", nativeName: "Türkçe", direction: "ltr" },
  { code: "az", name: "Azerbaijani", nativeName: "Azərbaycanca", direction: "ltr" },
  { code: "azb", name: "South Azerbaijani", nativeName: "تۆرکجه", direction: "rtl" },
  { code: "tk", name: "Turkmen", nativeName: "Türkmençe", direction: "ltr" },
  { code: "gag", name: "Gagauz", nativeName: "Gagauzça", direction: "ltr" },
  { code: "qxq", name: "Qashqai", nativeName: "قشقایی دیلی", direction: "rtl" },
  { code: "kmz", name: "Khorasani Turkic", nativeName: "ترکی خراسانی", direction: "rtl" },
  { code: "klj", name: "Khalaj", nativeName: "خلجی", direction: "rtl" },
  { code: "uz", name: "Uzbek", nativeName: "O‘zbekcha", direction: "ltr" },
  { code: "ug", name: "Uyghur", nativeName: "ئۇيغۇرچە", direction: "rtl" },
  { code: "ili", name: "Ili Turki", nativeName: "ئىلى تۈركى", direction: "rtl" },
  { code: "slr", name: "Salar", nativeName: "Salırça", direction: "ltr" },
  { code: "ybe", name: "Western Yugur", nativeName: "Yughur", direction: "ltr" },
  { code: "kk", name: "Kazakh", nativeName: "Қазақша", direction: "ltr" },
  { code: "ky", name: "Kyrgyz", nativeName: "Кыргызча", direction: "ltr" },
  { code: "kaa", name: "Karakalpak", nativeName: "Qaraqalpaqsha", direction: "ltr" },
  { code: "nog", name: "Nogai", nativeName: "Ногайша", direction: "ltr" },
  { code: "tt", name: "Tatar", nativeName: "Татарча", direction: "ltr" },
  { code: "ba", name: "Bashkir", nativeName: "Башҡортса", direction: "ltr" },
  { code: "crh", name: "Crimean Tatar", nativeName: "Qırımtatarca", direction: "ltr" },
  { code: "kum", name: "Kumyk", nativeName: "Къумукъча", direction: "ltr" },
  { code: "krc", name: "Karachay-Balkar", nativeName: "Къарачай-малкъар тил", direction: "ltr" },
  { code: "kdr", name: "Karaim", nativeName: "Karaj tili", direction: "ltr" },
  { code: "uum", name: "Urum", nativeName: "Урум тили", direction: "ltr" },
  { code: "cv", name: "Chuvash", nativeName: "Чӑвашла", direction: "ltr" },
  { code: "sah", name: "Sakha", nativeName: "Саха тыла", direction: "ltr" },
  { code: "dlg", name: "Dolgan", nativeName: "Дулҕан тыла", direction: "ltr" },
  { code: "tyv", name: "Tuvan", nativeName: "Тыва дыл", direction: "ltr" },
  { code: "kim", name: "Tofa", nativeName: "Тоъфа дыл", direction: "ltr" },
  { code: "alt", name: "Altai", nativeName: "Алтай тил", direction: "ltr" },
  { code: "kjh", name: "Khakas", nativeName: "Хакас тілі", direction: "ltr" },
  { code: "cjs", name: "Shor", nativeName: "Шор тили", direction: "ltr" },
  { code: "clw", name: "Chulym", nativeName: "Ӧс тили", direction: "ltr" },
  { code: "fuy", name: "Fuyu Kyrgyz", nativeName: "Fuyu Gïrgïs", direction: "ltr" },
  { code: "sty", name: "Siberian Tatar", nativeName: "Себер татар теле", direction: "ltr" },
  { code: "mn", name: "Mongolian", nativeName: "Монгол хэл", direction: "ltr" },
  { code: "ru", name: "Russian", nativeName: "Русский", direction: "ltr" },
  { code: "en", name: "English", nativeName: "English", direction: "ltr" },
] as const;

export type SupportedLanguageCode = (typeof supportedLanguages)[number]["code"];

export const verifiedSetupLanguages = ["en", "ru", "uz"] as const satisfies readonly SupportedLanguageCode[];
export type VerifiedSetupLanguageCode = (typeof verifiedSetupLanguages)[number];

export type SetupPhrasePack = {
  loginTitle: string;
  loginDescription: string;
  gatewayTokenLabel: string;
  connectLabel: string;
  title: string;
  description: string;
  languageLabel: string;
  continueLabel: string;
  fallbackNotice: string;
};

export type SetupPhrasePackDescriptor = {
  schemaVersion: 1;
  revision: string;
  language: VerifiedSetupLanguageCode;
  author: string;
  reviewer: string;
  reviewedAt: string;
  phrases: SetupPhrasePack;
};

export const setupPhraseKeys = [
  "loginTitle", "loginDescription", "gatewayTokenLabel", "connectLabel",
  "title", "description", "languageLabel", "continueLabel", "fallbackNotice",
] as const satisfies readonly (keyof SetupPhrasePack)[];

export const setupPhrasePacks = {
  en: {
    schemaVersion: 1, revision: "2026.10.1", language: "en",
    author: "Barlas maintainers", reviewer: "Barlas language review", reviewedAt: "2026-10-24",
    phrases: {
      loginTitle: "Sign in to Barlas AI Agent",
      loginDescription: "Use the protected Barlas gateway token created by the installer. No username or password is required.",
      gatewayTokenLabel: "Gateway token",
      connectLabel: "Connect",
      title: "Choose your language",
      description: "Barlas AI Agent will answer in this language. You can change it later in Settings.",
      languageLabel: "Language",
      continueLabel: "Continue",
      fallbackNotice: "Setup text for this language is awaiting community review, so setup continues in English. Barlas will still answer in the language you selected.",
    },
  },
  ru: {
    schemaVersion: 1, revision: "2026.10.1", language: "ru",
    author: "Barlas maintainers", reviewer: "Barlas language review", reviewedAt: "2026-10-24",
    phrases: {
      loginTitle: "Вход в Barlas AI Agent",
      loginDescription: "Используйте защищённый gateway‑токен Barlas, созданный установщиком. Логин и пароль не нужны.",
      gatewayTokenLabel: "Gateway token",
      connectLabel: "Подключиться",
      title: "Выберите язык",
      description: "Barlas AI Agent будет отвечать на этом языке. Выбор можно изменить позже в настройках.",
      languageLabel: "Язык",
      continueLabel: "Продолжить",
      fallbackNotice: "Текст установки на этом языке ожидает проверки сообществом, поэтому установка продолжится на английском. Barlas всё равно будет отвечать на выбранном языке.",
    },
  },
  uz: {
    schemaVersion: 1, revision: "2026.10.1", language: "uz",
    author: "Barlas maintainers", reviewer: "Barlas language review", reviewedAt: "2026-10-24",
    phrases: {
      loginTitle: "Barlas AI Agent tizimiga kirish",
      loginDescription: "O‘rnatuvchi yaratgan himoyalangan Barlas gateway tokenidan foydalaning. Login va parol kerak emas.",
      gatewayTokenLabel: "Gateway tokeni",
      connectLabel: "Ulanish",
      title: "Tilni tanlang",
      description: "Barlas AI Agent shu tilda javob beradi. Tilni keyinroq sozlamalarda o‘zgartirish mumkin.",
      languageLabel: "Til",
      continueLabel: "Davom etish",
      fallbackNotice: "Bu til uchun o‘rnatish matni hamjamiyat tekshiruvini kutmoqda, shuning uchun o‘rnatish ingliz tilida davom etadi. Barlas baribir siz tanlagan tilda javob beradi.",
    },
  },
} as const satisfies Record<VerifiedSetupLanguageCode, SetupPhrasePackDescriptor>;

const verifiedSetupLanguageSet = new Set<SupportedLanguageCode>(verifiedSetupLanguages);

const languagesByCode = new Map<string, (typeof supportedLanguages)[number]>(
  supportedLanguages.map((language) => [language.code, language]),
);

export function isSupportedLanguage(code: string): code is SupportedLanguageCode {
  return languagesByCode.has(code);
}

export function getLanguage(code: string | null | undefined) {
  return code ? languagesByCode.get(code) : undefined;
}

export function isVerifiedSetupLanguage(
  code: string | null | undefined,
): code is VerifiedSetupLanguageCode {
  return Boolean(code && isSupportedLanguage(code) && verifiedSetupLanguageSet.has(code));
}

export function getSetupLanguage(code: string | null | undefined): VerifiedSetupLanguageCode {
  return isVerifiedSetupLanguage(code) ? code : "en";
}

export function getSetupPhrasePack(code: string | null | undefined): SetupPhrasePack {
  return setupPhrasePacks[getSetupLanguage(code)].phrases;
}

export function getSetupPhrasePackDescriptor(code: string | null | undefined): SetupPhrasePackDescriptor {
  return setupPhrasePacks[getSetupLanguage(code)];
}

export function setupPhrasePackCompleteness(code: string | null | undefined): number {
  if (!isVerifiedSetupLanguage(code)) return 0;
  const phrases = getSetupPhrasePack(code);
  const complete = setupPhraseKeys.filter((key) => phrases[key].trim().length > 0).length;
  return complete / setupPhraseKeys.length;
}

export function setupTranslationStatus(code: string | null | undefined): "verified" | "fallback" | "unsupported" {
  if (!code || !isSupportedLanguage(code)) return "unsupported";
  return isVerifiedSetupLanguage(code) ? "verified" : "fallback";
}

export function languageInstruction(code: string | null | undefined): string | null {
  const language = getLanguage(code);
  if (!language) return null;
  return [
    `The user's preferred language is ${language.name} (${language.nativeName}; language code ${language.code}).`,
    "Respond in that language unless the user explicitly asks for another language.",
    "Preserve code, commands, file paths, identifiers, and quoted text when translation would change their meaning.",
  ].join(" ");
}

export function setupLanguageInstruction(code: string | null | undefined): string | null {
  const language = getLanguage(code);
  if (!language) return null;
  return [
    `The Barlas setup language is ${language.name} (${language.nativeName}; ${language.code}).`,
    "Present all subsequent onboarding explanations, choices, validation guidance, status messages, and final instructions in that language.",
    "Keep provider names, model identifiers, commands, paths, environment variables, and security tokens unchanged.",
    "For a community-review language without standardized modern technical terminology, prefer clear native wording and retain the unambiguous technical term in parentheses.",
  ].join(" ");
}
