import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { OpenAiOidcService, type OidcTransactionStore } from "../src/auth/openai-oidc.js";

class MemoryTransactions implements OidcTransactionStore {
  created: Parameters<OidcTransactionStore["createOidcTransaction"]>[0] | null = null;
  async createOidcTransaction(input: Parameters<OidcTransactionStore["createOidcTransaction"]>[0]) { this.created = input; }
  async consumeOidcTransaction() { return null; }
}

describe("Sign in with ChatGPT OIDC", () => {
  it("starts a short-lived Authorization Code + PKCE transaction without exposing the verifier", async () => {
    const store = new MemoryTransactions();
    const service = new OpenAiOidcService(store, "oaiapp_test-client");
    const result = await service.begin("https://agent.barlas.test/auth/openai/callback");
    const url = new URL(result.authorizationUrl);

    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(url.searchParams.get("client_id")).toBe("oaiapp_test-client");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(url.searchParams.has("code_verifier")).toBe(false);
    expect(store.created?.stateHash).toBe(createHash("sha256").update(url.searchParams.get("state")!).digest("hex"));
    expect(store.created?.browserHash).toBe(createHash("sha256").update(result.browserToken).digest("hex"));
    expect(store.created?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
