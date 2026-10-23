import { describe, expect, it } from "vitest";

import {
  OutcomeService,
  type EvidenceKind,
  type Outcome,
  type OutcomeDetail,
  type OutcomeEvidence,
  type OutcomeStatus,
  type OutcomeStore,
} from "../src/outcomes/service.js";
import { createBuiltinToolRegistry } from "../src/tools/builtins.js";

const ids = {
  outcome: "00000000-0000-4000-8000-000000000001",
  criterion1: "00000000-0000-4000-8000-000000000011",
  criterion2: "00000000-0000-4000-8000-000000000012",
};

class MemoryOutcomes implements OutcomeStore {
  records: OutcomeDetail[] = [];

  async createOutcome(input: { userId: string; title: string; objective: string; criteria: string[]; sourceConversationId?: string }) {
    const now = new Date().toISOString();
    const outcome: Outcome = {
      id: ids.outcome, userId: input.userId, title: input.title, objective: input.objective,
      status: "planned", ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
      createdAt: now, updatedAt: now,
    };
    const detail: OutcomeDetail = {
      outcome,
      criteria: input.criteria.map((description, index) => ({
        id: index === 0 ? ids.criterion1 : ids.criterion2,
        outcomeId: outcome.id, description, required: true, createdAt: now,
      })),
      evidence: [],
    };
    this.records.push(detail);
    return detail;
  }

  async listOutcomes(userId: string, statuses: OutcomeStatus[], limit: number) {
    return this.records.filter((item) => item.outcome.userId === userId && statuses.includes(item.outcome.status)).slice(0, limit).map((item) => item.outcome);
  }

  async getOutcome(userId: string, id: string) {
    return this.records.find((item) => item.outcome.userId === userId && item.outcome.id === id) ?? null;
  }

  async addOutcomeEvidence(input: { userId: string; outcomeId: string; criterionId: string; kind: EvidenceKind; passed: boolean; summary: string; locator?: string; observedAt: Date }) {
    const detail = await this.getOutcome(input.userId, input.outcomeId);
    if (!detail || detail.outcome.status === "cancelled" || !detail.criteria.some((item) => item.id === input.criterionId)) return null;
    const createdAt = new Date().toISOString();
    const evidence: OutcomeEvidence = {
      id: `00000000-0000-4000-8000-${String(detail.evidence.length + 1).padStart(12, "0")}`,
      outcomeId: input.outcomeId, criterionId: input.criterionId, kind: input.kind,
      passed: input.passed, summary: input.summary, ...(input.locator ? { locator: input.locator } : {}),
      observedAt: input.observedAt.toISOString(), createdAt,
    };
    detail.evidence.unshift(evidence);
    detail.outcome.status = "verification_pending";
    detail.outcome.updatedAt = createdAt;
    delete detail.outcome.verifiedAt;
    return evidence;
  }

  async setOutcomeStatus(userId: string, id: string, status: OutcomeStatus) {
    const detail = await this.getOutcome(userId, id);
    if (!detail) return null;
    detail.outcome.status = status;
    detail.outcome.updatedAt = new Date().toISOString();
    if (status === "verified") detail.outcome.verifiedAt = detail.outcome.updatedAt;
    else delete detail.outcome.verifiedAt;
    return detail.outcome;
  }
}

describe("Barlas Outcome Mode", () => {
  it("keeps an outcome pending until every criterion has strong passing evidence", async () => {
    const store = new MemoryOutcomes();
    const service = new OutcomeService(store);
    await service.create("owner", { title: " Ship release ", objective: " Deliver a working build ", criteria: ["Tests pass", "Artifact exists"] });

    await service.addEvidence("owner", {
      outcomeId: ids.outcome, criterionId: ids.criterion1, kind: "agent_observation", passed: true,
      summary: "I think the tests passed.",
    });
    expect((await service.detail("owner", ids.outcome))?.outcome.status).toBe("verification_pending");

    await service.addEvidence("owner", {
      outcomeId: ids.outcome, criterionId: ids.criterion1, kind: "deterministic_check", passed: true,
      summary: "216 tests passed.", locator: "run:test:216",
    });
    await service.addEvidence("owner", {
      outcomeId: ids.outcome, criterionId: ids.criterion2, kind: "artifact", passed: true,
      summary: "Release artifact checksum recorded.", locator: "sha256:abc",
    });

    expect((await service.detail("owner", ids.outcome))?.outcome).toMatchObject({ status: "verified" });
  });

  it("automatically reopens verification when newer strong evidence fails", async () => {
    const store = new MemoryOutcomes();
    const service = new OutcomeService(store);
    await service.create("owner", { title: "Deploy", objective: "Healthy service", criteria: ["Health check passes"] });
    await service.addEvidence("owner", { outcomeId: ids.outcome, criterionId: ids.criterion1, kind: "external_receipt", passed: true, summary: "HTTP 200", observedAt: "2026-10-24T00:00:00.000Z" });
    expect((await service.detail("owner", ids.outcome))?.outcome.status).toBe("verified");

    await service.addEvidence("owner", { outcomeId: ids.outcome, criterionId: ids.criterion1, kind: "deterministic_check", passed: false, summary: "Health check returned 503", observedAt: "2026-10-24T01:00:00.000Z" });
    expect((await service.detail("owner", ids.outcome))?.outcome.status).toBe("verification_failed");
  });

  it("isolates owner context and approval-gates every mutation", async () => {
    const store = new MemoryOutcomes();
    const service = new OutcomeService(store);
    await service.create("owner", { title: "Result", objective: "Measurable result", criteria: ["Receipt exists"] });

    await expect(service.context("owner")).resolves.toContain("Receipt exists");
    await expect(service.context("another-owner")).resolves.toBeNull();

    const registry = createBuiltinToolRegistry({ outcomes: service });
    expect(registry.get("outcomes.list").risk).toBe("read");
    expect(registry.get("outcomes.inspect").risk).toBe("read");
    expect(registry.get("outcomes.create").risk).toBe("write");
    expect(registry.get("outcomes.evidence.add").risk).toBe("write");
    expect(registry.get("outcomes.verify").risk).toBe("write");
    expect(registry.get("outcomes.cancel").risk).toBe("write");
  });
});
