import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright-core";

import { ManagedBrowser } from "../src/tools/managed-browser.js";

describe("managed browser", () => {
  it("blocks local destinations before connecting to the browser", async () => {
    const connect = vi.fn();
    const browser = new ManagedBrowser("ws://browser:3000/", connect);
    await expect(browser.run({ url: "http://127.0.0.1" })).rejects.toThrow(/Local|non-public/u);
    expect(connect).not.toHaveBeenCalled();
  });

  it("uses an ephemeral context and returns bounded page content", async () => {
    const locator = {
      first: vi.fn(), click: vi.fn(), fill: vi.fn(), selectOption: vi.fn(), press: vi.fn(),
      innerText: vi.fn(async () => "Public page"),
      evaluateAll: vi.fn(async () => [{ text: "DNS", url: "https://8.8.8.8/" }]),
    };
    locator.first.mockReturnValue(locator);
    const page = {
      setDefaultTimeout: vi.fn(), on: vi.fn(), route: vi.fn(), goto: vi.fn(), waitForTimeout: vi.fn(),
      waitForLoadState: vi.fn(async () => undefined), title: vi.fn(async () => "Example"), locator: vi.fn(() => locator),
      url: vi.fn(() => "https://8.8.8.8/"),
    };
    const context = { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) };
    const remote = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) };
    const connect = vi.fn(async () => remote as unknown as Browser);
    const browser = new ManagedBrowser("ws://browser:3000/", connect);

    await expect(browser.run({ url: "https://8.8.8.8/" })).resolves.toMatchObject({
      title: "Example", text: "Public page", truncated: false,
    });
    expect(context.close).toHaveBeenCalledOnce();
    expect(remote.close).toHaveBeenCalledOnce();
  });
});
