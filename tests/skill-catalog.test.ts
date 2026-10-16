import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  availableCatalogEntries,
  createSignedSkillCatalog,
  fetchCatalogPackage,
  parseSignedSkillCatalog,
  selectCatalogEntry,
  verifySkillCatalog,
} from "../src/skills/catalog.js";
import { createSignedSkillPackage, skillPublisherFingerprint } from "../src/skills/package.js";

function keyPair() {
  return generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

describe("signed skill catalog", () => {
  it("verifies expiry, signature, sequence and duplicate-package invariants", () => {
    const signer = keyPair();
    const publisher = keyPair();
    const publisherFingerprint = skillPublisherFingerprint(publisher.publicKey);
    const catalog = createSignedSkillCatalog({
      schemaVersion: 1,
      name: "Barlas Community Skills",
      sequence: 7,
      generatedAt: "2026-10-17T00:00:00.000Z",
      expiresAt: "2026-11-17T00:00:00.000Z",
      packages: [{
        skillId: "community.release-notes", version: "1.0.0", description: "Create release notes",
        packageUrl: "https://example.test/release-notes.json",
        packageSha256: `sha256:${"a".repeat(64)}`,
        publisherFingerprint,
      }],
      revocations: [],
    }, "Barlas Catalog", signer.privateKey);
    const fingerprint = skillPublisherFingerprint(signer.publicKey);

    expect(() => verifySkillCatalog(catalog, fingerprint, new Date("2026-10-18T00:00:00.000Z"), 7)).not.toThrow();
    expect(() => verifySkillCatalog(catalog, fingerprint, new Date("2026-10-18T00:00:00.000Z"), 8)).toThrow(/rollback/i);
    expect(() => verifySkillCatalog(catalog, fingerprint, new Date("2026-12-01T00:00:00.000Z"))).toThrow(/expired/i);
    expect(() => parseSignedSkillCatalog(JSON.stringify({
      ...catalog,
      packages: [...catalog.packages, catalog.packages[0]],
    }))).toThrow(/duplicate/i);
    expect(() => verifySkillCatalog({ ...catalog, name: "Tampered" }, fingerprint, new Date("2026-10-18T00:00:00.000Z"))).toThrow(/signature/i);
  });

  it("removes revoked publishers and exact versions before selection", () => {
    const signer = keyPair();
    const publisher = keyPair();
    const publisherFingerprint = skillPublisherFingerprint(publisher.publicKey);
    const entry = (version: string) => ({
      skillId: "community.release-notes", version, description: `Release notes ${version}`,
      packageUrl: `https://example.test/release-notes-${version}.json`,
      packageSha256: `sha256:${(version === "1.0.0" ? "a" : "b").repeat(64)}`,
      publisherFingerprint,
    });
    const catalog = createSignedSkillCatalog({
      schemaVersion: 1, name: "Catalog", sequence: 1,
      generatedAt: "2026-10-17T00:00:00.000Z", expiresAt: "2026-11-17T00:00:00.000Z",
      packages: [entry("1.0.0"), entry("1.1.0")],
      revocations: [{ skillId: "community.release-notes", version: "1.1.0", reason: "Broken instructions", revokedAt: "2026-10-17T01:00:00.000Z" }],
    }, "Catalog", signer.privateKey);

    expect(availableCatalogEntries(catalog).map((item) => item.version)).toEqual(["1.0.0"]);
    expect(selectCatalogEntry(catalog, "community.release-notes").version).toBe("1.0.0");
    expect(() => selectCatalogEntry(catalog, "community.release-notes", "1.1.0")).toThrow(/non-revoked/i);
  });

  it("pins HTTPS package bytes, publisher signature, identity and version", async () => {
    const publisher = keyPair();
    const skillPackage = createSignedSkillPackage({
      schemaVersion: 1,
      publisher: { name: "Example Publisher" },
      skill: {
        id: "community.release-notes", version: "1.0.0", description: "Create release notes",
        instructions: "Summarize supplied changes accurately.", allowedTools: [],
      },
    }, publisher.privateKey);
    const raw = `${JSON.stringify(skillPackage)}\n`;
    const entry = {
      skillId: skillPackage.skill.id,
      version: skillPackage.skill.version,
      description: skillPackage.skill.description,
      packageUrl: "https://example.test/release-notes.json",
      packageSha256: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
      publisherFingerprint: skillPackage.publisher.fingerprint,
    };
    const fetchMock = vi.fn(async () => new Response(raw, { status: 200 }));

    await expect(fetchCatalogPackage(entry, fetchMock as typeof fetch)).resolves.toEqual(skillPackage);
    expect(fetchMock).toHaveBeenCalledWith(entry.packageUrl, expect.objectContaining({ redirect: "error" }));
    await expect(fetchCatalogPackage({ ...entry, packageSha256: `sha256:${"0".repeat(64)}` }, fetchMock as typeof fetch))
      .rejects.toThrow(/digest/i);
  });
});
