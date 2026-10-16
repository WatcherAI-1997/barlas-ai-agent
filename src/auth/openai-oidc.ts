import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { AuthenticationError, type VerifiedExternalIdentity } from "./service.js";

export interface OidcTransactionStore {
  createOidcTransaction(input: { stateHash: string; browserHash: string; codeVerifier: string; nonce: string; redirectUri: string; expiresAt: Date }): Promise<void>;
  consumeOidcTransaction(input: { stateHash: string; browserHash: string }): Promise<{ codeVerifier: string; nonce: string; redirectUri: string } | null>;
}

export class OpenAiOidcService {
  private readonly issuer = "https://auth.openai.com";
  private readonly authorizationEndpoint = "https://auth.openai.com/api/accounts/authorize";
  private readonly tokenEndpoint = "https://auth.openai.com/api/accounts/oauth/token";
  private readonly jwks = createRemoteJWKSet(new URL("https://auth.openai.com/.well-known/jwks.json"));
  constructor(private readonly store: OidcTransactionStore, private readonly clientId: string, private readonly clientSecret?: string) {}

  async begin(redirectUri: string) {
    const state = secret(32), browserToken = secret(32), codeVerifier = secret(64), nonce = secret(32);
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await this.store.createOidcTransaction({ stateHash: hash(state), browserHash: hash(browserToken), codeVerifier, nonce, redirectUri, expiresAt: new Date(Date.now() + 10 * 60_000) });
    const url = new URL(this.authorizationEndpoint);
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid profile email", state, code_challenge: challenge, code_challenge_method: "S256", nonce }).toString();
    return { authorizationUrl: url.toString(), browserToken };
  }

  async complete(input: { state: string; code: string; browserToken: string }): Promise<VerifiedExternalIdentity> {
    const transaction = await this.store.consumeOidcTransaction({ stateHash: hash(input.state), browserHash: hash(input.browserToken) });
    if (!transaction) throw new AuthenticationError("Sign-in transaction is invalid or expired");
    const body = new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: transaction.redirectUri, client_id: this.clientId, code_verifier: transaction.codeVerifier });
    const headers: Record<string, string> = { accept: "application/json", "content-type": "application/x-www-form-urlencoded" };
    if (this.clientSecret) headers.authorization = `Basic ${Buffer.from(`${formEncode(this.clientId)}:${formEncode(this.clientSecret)}`).toString("base64")}`;
    const response = await fetch(this.tokenEndpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new AuthenticationError("OpenAI token exchange failed");
    const tokens = await response.json() as { id_token?: string };
    if (!tokens.id_token) throw new AuthenticationError("OpenAI did not return an identity token");
    const { payload } = await jwtVerify(tokens.id_token, this.jwks, { issuer: this.issuer, audience: this.clientId, requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5 });
    if (payload.nonce !== transaction.nonce || typeof payload.sub !== "string" || typeof payload.email !== "string") throw new AuthenticationError("OpenAI identity could not be verified");
    return { provider: "openai", issuer: this.issuer, clientId: this.clientId, subject: payload.sub, email: payload.email, emailVerified: payload.email_verified === true, displayName: typeof payload.name === "string" ? payload.name : payload.email };
  }
}

function secret(bytes: number) { return randomBytes(bytes).toString("base64url"); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function formEncode(value: string) { return new URLSearchParams({ value }).toString().slice("value=".length); }
