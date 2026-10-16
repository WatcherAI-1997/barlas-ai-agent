import { ManagedBrowser } from "../dist/src/tools/managed-browser.js";
import { SafeWebReader } from "../dist/src/tools/safe-web.js";
import { WebSearchClient } from "../dist/src/tools/web-search.js";

const configuredSearch = process.env.SEARXNG_BASE_URL || undefined;
const browserEndpoint = process.env.BROWSER_WS_ENDPOINT || "local://chromium";

try {
  const results = await new WebSearchClient(configuredSearch).search("Barlas AI Agent", 1);
  if (!results[0]?.url) throw new Error("search returned no result URL");
  console.log(`[OK] Web search: ${results[0].title}`);

  const page = await new SafeWebReader().open("https://example.com/");
  if (!page.text) throw new Error("page reader returned no text");
  console.log(`[OK] Safe page reader: ${page.title ?? page.url}`);

  const browser = await new ManagedBrowser(browserEndpoint).run({ url: "https://example.com/" });
  if (!browser.text) throw new Error("managed browser returned no text");
  console.log(`[OK] Managed browser: ${browser.title || browser.url}`);
} catch (error) {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.cause) console.error(`[CAUSE] ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`);
  process.exitCode = 1;
}
