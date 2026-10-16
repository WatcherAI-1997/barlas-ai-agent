import { describe, expect, it } from "vitest";

import { SafeWebReader, isPublicAddress } from "../src/tools/safe-web.js";

describe("safe web reader", () => {
  it("rejects local URLs before making a request", async () => {
    const reader = new SafeWebReader();
    await expect(reader.open("http://127.0.0.1/private")).rejects.toThrow(/non-public/u);
    await expect(reader.open("http://localhost/private")).rejects.toThrow(/Local network/u);
    await expect(reader.open("http://example.com:8080/")).rejects.toThrow(/standard/u);
    await expect(reader.open("file:///etc/passwd")).rejects.toThrow(/HTTP/u);
  });

  it("classifies private, reserved, and public addresses", () => {
    expect(isPublicAddress("10.0.0.1")).toBe(false);
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("192.168.1.2")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("fc00::1")).toBe(false);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});
