import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import { z } from "zod";

const skillDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]{2,63}$/u),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(20_000),
  allowedTools: z.array(z.string().min(1).max(128)).max(32),
}).strict();

export const skillEvaluationCasesSchema = z.object({
  cases: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    prompt: z.string().min(1).max(10_000),
    requiredStrings: z.array(z.string().min(1).max(500)).min(1).max(10),
    forbiddenStrings: z.array(z.string().min(1).max(500)).max(10).default([]),
  }).strict()).min(1).max(5),
}).strict();

const publisherSchema = z.object({
  name: z.string().trim().min(1).max(120),
  publicKey: z.string().min(80).max(2_000),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

const unsignedPackageSchema = z.object({
  schemaVersion: z.literal(1),
  publisher: publisherSchema,
  skill: skillDefinitionSchema,
  evaluation: skillEvaluationCasesSchema.optional(),
}).strict();

const signedPackageSchema = unsignedPackageSchema.extend({
  signature: z.string().min(40).max(1_000),
}).strict();

export type UnsignedSkillPackage = z.infer<typeof unsignedPackageSchema>;
export type SignedSkillPackage = z.infer<typeof signedPackageSchema>;

const packageTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  publisher: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  skill: skillDefinitionSchema,
  evaluation: skillEvaluationCasesSchema.optional(),
}).strict();

export type SkillPackageTemplate = z.infer<typeof packageTemplateSchema>;

const MAX_PACKAGE_BYTES = 128_000;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  throw new Error("Skill package contains an unsupported value");
}

function signingPayload(skillPackage: SignedSkillPackage | UnsignedSkillPackage): Buffer {
  const { schemaVersion, publisher, skill, evaluation } = skillPackage;
  return Buffer.from(canonicalize({ schemaVersion, publisher, skill, ...(evaluation ? { evaluation } : {}) }), "utf8");
}

export function skillPublisherFingerprint(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Skill publisher key must be Ed25519");
  const der = key.export({ type: "spki", format: "der" });
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

export function parseSignedSkillPackage(raw: string): SignedSkillPackage {
  if (Buffer.byteLength(raw, "utf8") > MAX_PACKAGE_BYTES) throw new Error("Skill package exceeds 128 KB");
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error("Skill package is not valid JSON"); }
  return parseSignedSkillPackageValue(value);
}

export function parseSignedSkillPackageValue(value: unknown): SignedSkillPackage {
  const parsed = signedPackageSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid signed skill package: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function parseSkillPackageTemplate(raw: string): SkillPackageTemplate {
  if (Buffer.byteLength(raw, "utf8") > MAX_PACKAGE_BYTES) throw new Error("Skill package exceeds 128 KB");
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error("Skill package template is not valid JSON"); }
  const parsed = packageTemplateSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid skill package template: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function verifySkillPackage(skillPackage: SignedSkillPackage, trustedFingerprint?: string): string {
  const actualFingerprint = skillPublisherFingerprint(skillPackage.publisher.publicKey);
  if (actualFingerprint !== skillPackage.publisher.fingerprint) throw new Error("Skill publisher fingerprint does not match its public key");
  if (trustedFingerprint && actualFingerprint !== trustedFingerprint.toLocaleLowerCase()) {
    throw new Error(`Untrusted skill publisher: expected ${trustedFingerprint}, received ${actualFingerprint}`);
  }
  let signature: Buffer;
  try { signature = Buffer.from(skillPackage.signature, "base64"); } catch { throw new Error("Skill package signature is not valid base64"); }
  if (signature.length !== 64 || !verify(null, signingPayload(skillPackage), skillPackage.publisher.publicKey, signature)) {
    throw new Error("Skill package signature verification failed");
  }
  return actualFingerprint;
}

export function createSignedSkillPackage(
  input: Omit<UnsignedSkillPackage, "publisher"> & { publisher: { name: string } },
  privateKeyPem: string,
): SignedSkillPackage {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Skill signing key must be Ed25519");
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const unsigned = unsignedPackageSchema.parse({
    ...input,
    publisher: { name: input.publisher.name, publicKey, fingerprint: skillPublisherFingerprint(publicKey) },
  });
  return { ...unsigned, signature: sign(null, signingPayload(unsigned), privateKey).toString("base64") };
}
