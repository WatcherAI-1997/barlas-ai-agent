export const outcomeStatuses = ["planned", "in_progress", "verification_pending", "verified", "verification_failed", "cancelled"] as const;
export type OutcomeStatus = (typeof outcomeStatuses)[number];
export const evidenceKinds = ["deterministic_check", "artifact", "external_receipt", "user_confirmation", "agent_observation"] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export interface OutcomeCriterion {
  id: string;
  outcomeId: string;
  description: string;
  required: boolean;
  createdAt: string;
}

export interface OutcomeEvidence {
  id: string;
  outcomeId: string;
  criterionId: string;
  kind: EvidenceKind;
  passed: boolean;
  summary: string;
  locator?: string;
  observedAt: string;
  createdAt: string;
}

export interface Outcome {
  id: string;
  userId: string;
  title: string;
  objective: string;
  status: OutcomeStatus;
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
}

export interface OutcomeDetail {
  outcome: Outcome;
  criteria: OutcomeCriterion[];
  evidence: OutcomeEvidence[];
}

export interface OutcomeStore {
  createOutcome(input: { userId: string; title: string; objective: string; criteria: string[]; sourceConversationId?: string }): Promise<OutcomeDetail>;
  listOutcomes(userId: string, statuses: OutcomeStatus[], limit: number): Promise<Outcome[]>;
  getOutcome(userId: string, id: string): Promise<OutcomeDetail | null>;
  addOutcomeEvidence(input: { userId: string; outcomeId: string; criterionId: string; kind: EvidenceKind; passed: boolean; summary: string; locator?: string; observedAt: Date }): Promise<OutcomeEvidence | null>;
  setOutcomeStatus(userId: string, id: string, status: OutcomeStatus): Promise<Outcome | null>;
}

const strongEvidenceKinds = new Set<EvidenceKind>([
  "deterministic_check", "artifact", "external_receipt", "user_confirmation",
]);

export class OutcomeService {
  constructor(private readonly store: OutcomeStore) {}

  create(userId: string, input: { title: string; objective: string; criteria: string[]; sourceConversationId?: string }) {
    const title = input.title.trim();
    const objective = input.objective.trim();
    const criteria = [...new Set(input.criteria.map((item) => item.trim()).filter(Boolean))];
    if (!title) throw new Error("An outcome requires a title");
    if (!objective) throw new Error("An outcome requires an objective");
    if (!criteria.length) throw new Error("An outcome requires at least one measurable success criterion");
    if (criteria.length > 20) throw new Error("An outcome supports at most 20 success criteria");
    return this.store.createOutcome({
      userId, title, objective, criteria,
      ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
    });
  }

  list(userId: string, statuses: OutcomeStatus[] = ["planned", "in_progress", "verification_pending", "verification_failed"], limit = 50) {
    return this.store.listOutcomes(userId, statuses, limit);
  }

  detail(userId: string, id: string) { return this.store.getOutcome(userId, id); }

  async addEvidence(userId: string, input: { outcomeId: string; criterionId: string; kind: EvidenceKind; passed: boolean; summary: string; locator?: string; observedAt?: string }) {
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
    if (Number.isNaN(observedAt.getTime())) throw new Error("Evidence observation time is invalid");
    const summary = input.summary.trim();
    if (!summary) throw new Error("Outcome evidence requires a summary");
    const evidence = await this.store.addOutcomeEvidence({
      userId, outcomeId: input.outcomeId, criterionId: input.criterionId,
      kind: input.kind, passed: input.passed, summary,
      ...(input.locator?.trim() ? { locator: input.locator.trim() } : {}), observedAt,
    });
    if (evidence) await this.verify(userId, input.outcomeId);
    return evidence;
  }

  async verify(userId: string, id: string): Promise<OutcomeDetail | null> {
    const detail = await this.store.getOutcome(userId, id);
    if (!detail) return null;
    if (detail.outcome.status === "cancelled") throw new Error("A cancelled outcome cannot be verified");

    const required = detail.criteria.filter((criterion) => criterion.required);
    const checks = required.map((criterion) => {
      const evidence = detail.evidence
        .filter((item) => item.criterionId === criterion.id && strongEvidenceKinds.has(item.kind))
        .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
      return { criterion, evidence: evidence[0] };
    });
    const hasFailure = checks.some((check) => check.evidence?.passed === false);
    const allPassed = checks.length > 0 && checks.every((check) => check.evidence?.passed === true);
    const status: OutcomeStatus = allPassed ? "verified" : hasFailure ? "verification_failed" : "verification_pending";
    await this.store.setOutcomeStatus(userId, id, status);
    return this.store.getOutcome(userId, id);
  }

  cancel(userId: string, id: string) { return this.store.setOutcomeStatus(userId, id, "cancelled"); }

  async context(userId: string): Promise<string | null> {
    const outcomes = await this.list(userId, ["planned", "in_progress", "verification_pending", "verification_failed"], 20);
    if (!outcomes.length) return null;
    const details = await Promise.all(outcomes.map((outcome) => this.store.getOutcome(userId, outcome.id)));
    return [
      "Active Barlas outcomes. Finishing a run is not proof that an outcome was achieved:",
      ...details.filter((item): item is OutcomeDetail => Boolean(item)).flatMap((item) => [
        `- ${item.outcome.id} [${item.outcome.status}]: ${item.outcome.title} — ${item.outcome.objective}`,
        ...item.criteria.filter((criterion) => criterion.required).map((criterion) => `  criterion ${criterion.id}: ${criterion.description}`),
      ]),
      "Only deterministic checks, artifacts, external receipts, or explicit user confirmation can verify criteria. Agent observation alone is insufficient.",
    ].join("\n").slice(0, 30_000);
  }
}
