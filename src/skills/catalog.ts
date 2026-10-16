import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { z } from "zod";

import { parseSignedSkillPackage, skillPublisherFingerprint, verifySkillPackage, type SignedSkillPackage } from "./package.js";

const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const catalogPackageSchema = z.object({
  skillId: z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  description: z.string().trim().min(1).max(500),
  packageUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "Package URL must use HTTPS"),
  packageSha256: digestSchema,
  publisherFingerprint: fingerprintSchema,
}).strict();

const revocationSchema = z.object({
  publisherFingerprint: fingerprintSchema.optional(),
  skillId: z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/u).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u).optional(),
  reason: z.string().trim().min(1).max(500),
  revokedAt: z.string().datetime(),
}).strict().refine((value) => value.publisherFingerprint || (value.skillId && value.version), {
  message: "Revocation must identify a publisher or exact skill version",
});

const catalogPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  sequence: z.number().int().min(1),
  generatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  packages: z.array(catalogPackageSchema).max(5_000),
  revocations: z.array(revocationSchema).max(5_000).default([]),
}).strict();

const catalogTemplateSchema = catalogPayloadSchema;
const signedCatalogSchema = catalogPayloadSchema.extend({
  signer: z.object({
    name: z.string().trim().min(1).max(120),
    publicKey: z.string().min(80).max(2_000),
    fingerprint: fingerprintSchema,
  }).strict(),
  signature: z.string().min(40).max(1_000),
}).strict();

export type SkillCatalogTemplate = z.infer<typeof catalogTemplateSchema>;
export type SignedSkillCatalog = z.infer<typeof signedCatalogSchema>;
export type SkillCatalogEntry = SignedSkillCatalog["packages"][number];

const MAX_CATALOG_BYTES = 1_000_000;
const MAX_PACKAGE_BYTES = 128_000;

async function boundedResponseBuffer(response: Response, maxBytes: number, label: string): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${label} exceeds the allowed size`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds the allowed size`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes);
}

function canonicalize(value: unknown): string {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  throw new Error("Skill catalog contains an unsupported value");
}

function catalogPayload(catalog: SignedSkillCatalog): Buffer {
  const { signer: _signer, signature: _signature, ...payload } = catalog;
  return Buffer.from(canonicalize(payload), "utf8");
}

function parseJson(raw: string, label: string): unknown {
  try { return JSON.parse(raw) as unknown; } catch { throw new Error(`${label} is not valid JSON`); }
}

export function parseSkillCatalogTemplate(raw: string): SkillCatalogTemplate {
  if (Buffer.byteLength(raw, "utf8") > MAX_CATALOG_BYTES) throw new Error("Skill catalog exceeds 1 MB");
  const parsed = catalogTemplateSchema.safeParse(parseJson(raw, "Skill catalog template"));
  if (!parsed.success) throw new Error(`Invalid skill catalog template: ${z.prettifyError(parsed.error)}`);
  assertUniquePackages(parsed.data.packages);
  return parsed.data;
}

export function parseSignedSkillCatalog(raw: string): SignedSkillCatalog {
  if (Buffer.byteLength(raw, "utf8") > MAX_CATALOG_BYTES) throw new Error("Skill catalog exceeds 1 MB");
  const parsed = signedCatalogSchema.safeParse(parseJson(raw, "Skill catalog"));
  if (!parsed.success) throw new Error(`Invalid signed skill catalog: ${z.prettifyError(parsed.error)}`);
  assertUniquePackages(parsed.data.packages);
  return parsed.data;
}

function assertUniquePackages(packages: SkillCatalogEntry[]): void {
  const seen = new Set<string>();
  for (const entry of packages) {
    const key = `${entry.skillId}@${entry.version}`;
    if (seen.has(key)) throw new Error(`Skill catalog contains duplicate ${key}`);
    seen.add(key);
  }
}

export function createSignedSkillCatalog(template: SkillCatalogTemplate, signerName: string, privateKeyPem: string): SignedSkillCatalog {
  const payload = catalogTemplateSchema.parse(template);
  assertUniquePackages(payload.packages);
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Catalog signing key must be Ed25519");
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const signer = { name: signerName, publicKey, fingerprint: skillPublisherFingerprint(publicKey) };
  const unsigned = { ...payload, signer, signature: "pending" } as SignedSkillCatalog;
  return { ...unsigned, signature: sign(null, catalogPayload(unsigned), privateKey).toString("base64") };
}

export function verifySkillCatalog(catalog: SignedSkillCatalog, trustedFingerprint: string, now = new Date(), minimumSequence = 0): void {
  const fingerprint = skillPublisherFingerprint(catalog.signer.publicKey);
  if (fingerprint !== catalog.signer.fingerprint) throw new Error("Catalog signer fingerprint does not match its public key");
  if (fingerprint !== trustedFingerprint.toLowerCase()) throw new Error(`Untrusted catalog signer: received ${fingerprint}`);
  const signature = Buffer.from(catalog.signature, "base64");
  if (signature.length !== 64 || !verify(null, catalogPayload(catalog), catalog.signer.publicKey, signature)) {
    throw new Error("Skill catalog signature verification failed");
  }
  const generatedAt = Date.parse(catalog.generatedAt);
  const expiresAt = Date.parse(catalog.expiresAt);
  if (generatedAt > now.getTime() + 5 * 60_000) throw new Error("Skill catalog was generated in the future");
  if (expiresAt <= now.getTime()) throw new Error("Skill catalog has expired");
  if (expiresAt <= generatedAt) throw new Error("Skill catalog expiry must follow generation time");
  if (catalog.sequence < minimumSequence) throw new Error(`Skill catalog rollback detected: sequence ${catalog.sequence} is older than ${minimumSequence}`);
}

export function availableCatalogEntries(catalog: SignedSkillCatalog): SkillCatalogEntry[] {
  return catalog.packages.filter((entry) => !catalog.revocations.some((revocation) => (
    revocation.publisherFingerprint === entry.publisherFingerprint ||
    (revocation.skillId === entry.skillId && revocation.version === entry.version)
  )));
}

export function selectCatalogEntry(catalog: SignedSkillCatalog, skillId: string, version?: string): SkillCatalogEntry {
  const candidates = availableCatalogEntries(catalog).filter((entry) => entry.skillId === skillId && (!version || entry.version === version));
  candidates.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
  const selected = candidates[0];
  if (!selected) throw new Error(`No non-revoked catalog package found for ${skillId}${version ? `@${version}` : ""}`);
  return selected;
}

export async function fetchCatalogPackage(entry: SkillCatalogEntry, fetchImpl: typeof fetch = fetch): Promise<SignedSkillPackage> {
  const response = await fetchImpl(entry.packageUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Skill package download failed with HTTP ${response.status}`);
  const content = await boundedResponseBuffer(response, MAX_PACKAGE_BYTES, "Skill package");
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (digest !== entry.packageSha256) throw new Error("Skill package digest does not match the signed catalog");
  const skillPackage = parseSignedSkillPackage(content.toString("utf8"));
  verifySkillPackage(skillPackage, entry.publisherFingerprint);
  if (skillPackage.skill.id !== entry.skillId || skillPackage.skill.version !== entry.version) {
    throw new Error("Skill package identity does not match the signed catalog");
  }
  return skillPackage;
}
