import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { extractWhatsAppMessages, verifyWhatsAppSignature, WhatsAppClient } from "../src/channels/whatsapp.js";

describe("WhatsApp Cloud API channel", () => {
  it("extracts only bounded text messages", () => {
    expect(extractWhatsAppMessages({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { messages: [
        { id: "wamid.1", from: "15550001111", type: "text", text: { body: " Hello " } },
        { id: "wamid.2", from: "15550001111", type: "image", image: { id: "media" } },
      ] } }] }],
    })).toEqual([{ id: "wamid.1", from: "15550001111", text: "Hello" }]);
  });

  it("verifies the exact raw webhook payload", () => {
    const raw = Buffer.from('{"object":"whatsapp_business_account"}');
    const secret = "app-secret-value";
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyWhatsAppSignature(secret, raw, signature)).toBe(true);
    expect(verifyWhatsAppSignature(secret, Buffer.from("changed"), signature)).toBe(false);
  });

  it("sends bounded text chunks without placing the token in the body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = new WhatsAppClient("access-token-secret-value", "phone-id", "https://graph.example/v99.0/", fetchImpl);
    await client.sendMessage("15550001111", "x".repeat(5_000));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://graph.example/v99.0/phone-id/messages");
    const first = fetchImpl.mock.calls[0]![1]!;
    expect(first.headers).toMatchObject({ authorization: "Bearer access-token-secret-value" });
    expect(String(first.body)).not.toContain("access-token-secret-value");
    expect(JSON.parse(String(first.body))).toMatchObject({ messaging_product: "whatsapp", to: "15550001111" });
  });
});
