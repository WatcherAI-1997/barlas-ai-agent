import { chromium, type Browser, type Page, type Route } from "playwright-core";

import { assertPublicUrl } from "./safe-web.js";

const MAX_ACTIONS = 8;
const MAX_TEXT = 100_000;
const MAX_LINKS = 100;
const TOTAL_TIMEOUT_MS = 45_000;

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "select"; selector: string; value: string }
  | { type: "press"; selector: string; key: "Enter" | "Tab" | "Escape" | "ArrowDown" | "ArrowUp" }
  | { type: "wait"; milliseconds: number };

export interface BrowserRunResult {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  links: Array<{ text: string; url: string }>;
}

export class ManagedBrowser {
  constructor(
    private readonly wsEndpoint: string,
    private readonly connect: (endpoint: string) => Promise<Browser> = (endpoint) => endpoint === "local://chromium"
      ? chromium.launch({ headless: true })
      : chromium.connect(endpoint),
  ) {}

  async run(input: { url: string; actions?: BrowserAction[] }): Promise<BrowserRunResult> {
    const initial = await assertPublicUrl(input.url);
    const actions = input.actions ?? [];
    if (actions.length > MAX_ACTIONS) throw new Error(`Browser accepts at most ${MAX_ACTIONS} actions`);
    const browser = await this.connect(this.wsEndpoint);
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport: { width: 1280, height: 800 },
      userAgent: "Barlas-AI-Agent/0.1 (+managed-browser)",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("dialog", (dialog) => void dialog.dismiss());
    page.on("popup", (popup) => void popup.close());
    await page.route("**/*", (route) => this.guardRoute(route));
    try {
      return await Promise.race([
        this.execute(page, initial.toString(), actions),
        new Promise<never>((_resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Browser operation exceeded 45 seconds")), TOTAL_TIMEOUT_MS);
          timeout.unref();
        }),
      ]);
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private async execute(page: Page, url: string, actions: BrowserAction[]): Promise<BrowserRunResult> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    for (const action of actions) {
      if (action.type === "navigate") {
        const target = await assertPublicUrl(action.url);
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
      } else if (action.type === "click") {
        await page.locator(action.selector).first().click();
      } else if (action.type === "fill") {
        if (/password|secret|token|api.?key/iu.test(action.selector)) {
          throw new Error("Managed browser must not enter credentials or secrets");
        }
        await page.locator(action.selector).first().fill(action.value);
      } else if (action.type === "select") {
        await page.locator(action.selector).first().selectOption(action.value);
      } else if (action.type === "press") {
        await page.locator(action.selector).first().press(action.key);
      } else {
        await page.waitForTimeout(Math.min(Math.max(action.milliseconds, 0), 5_000));
      }
    }
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const [title, bodyText, links] = await Promise.all([
      page.title(),
      page.locator("body").innerText().catch(() => ""),
      page.locator("a[href]").evaluateAll((anchors) => anchors.slice(0, 100).map((anchor) => ({
        text: (anchor.textContent ?? "").trim().slice(0, 500),
        url: (anchor as HTMLAnchorElement).href,
      }))),
    ]);
    const safeLinks: Array<{ text: string; url: string }> = [];
    for (const link of links.slice(0, MAX_LINKS)) {
      try {
        safeLinks.push({ ...link, url: (await assertPublicUrl(link.url)).toString() });
      } catch {
        // Hide local, non-HTTP, malformed, and credential-bearing targets.
      }
    }
    return {
      url: page.url(),
      title: title.slice(0, 500),
      text: bodyText.slice(0, MAX_TEXT),
      truncated: bodyText.length > MAX_TEXT,
      links: safeLinks,
    };
  }

  private async guardRoute(route: Route): Promise<void> {
    const request = route.request();
    try {
      await assertPublicUrl(request.url());
      if (["media", "font"].includes(request.resourceType())) return route.abort("blockedbyclient");
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  }
}
