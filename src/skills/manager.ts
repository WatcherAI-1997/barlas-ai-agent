import { randomUUID } from "node:crypto";

import type { ModelProvider } from "../core/models.js";
import type { SkillDefinition, SkillMetadata, SkillRegistry } from "./registry.js";

export interface StoredSkill extends SkillDefinition {
  active: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface SkillEvaluationCase {
  name: string;
  prompt: string;
  requiredStrings: string[];
  forbiddenStrings: string[];
}

export interface SkillEvaluation {
  id: string;
  skillId: string;
  skillVersion: string;
  passed: boolean;
  passedCases: number;
  totalCases: number;
  details: Array<{ name: string; passed: boolean; missing: string[]; forbidden: string[] }>;
  createdBy: string | null;
  createdAt: string;
}

export interface SkillStore {
  listSkillVersions(): Promise<StoredSkill[]>;
  insertSkill(input: SkillDefinition & { createdBy: string | null }): Promise<StoredSkill>;
  saveSkillEvaluation(input: Omit<SkillEvaluation, "createdAt">): Promise<SkillEvaluation>;
  latestSkillEvaluation(skillId: string, version: string): Promise<SkillEvaluation | null>;
  activateSkill(skillId: string, version: string): Promise<boolean>;
}

export class SkillManager {
  constructor(
    private readonly store: SkillStore,
    private readonly registry: SkillRegistry,
    private readonly model: ModelProvider,
    private readonly availableTools: () => string[],
  ) {}

  async load(): Promise<void> {
    const stored = await this.store.listSkillVersions();
    for (const skill of stored) {
      if (!this.registry.has(skill.id, skill.version)) this.registry.register(skill, false);
    }
    for (const skill of stored.filter((item) => item.active)) this.registry.activate(skill.id, skill.version);
  }

  async install(skill: SkillDefinition, createdBy: string | null): Promise<StoredSkill> {
    this.validateTools(skill.allowedTools);
    if (this.registry.has(skill.id, skill.version)) throw new Error(`Skill ${skill.id}@${skill.version} is already registered`);
    const stored = await this.store.insertSkill({ ...skill, createdBy });
    this.registry.register(stored, false);
    return stored;
  }

  async evaluate(input: {
    skillId: string;
    version: string;
    cases: SkillEvaluationCase[];
    createdBy: string | null;
  }): Promise<SkillEvaluation> {
    const skill = this.registry.get(input.skillId, input.version);
    if (input.cases.length < 1 || input.cases.length > 5) throw new Error("Skill evaluation requires 1 to 5 cases");
    const details = [];
    for (const testCase of input.cases) {
      const result = await this.model.generate({
        userId: input.createdBy ?? "skill-evaluator",
        conversationId: randomUUID(),
        taskClass: "deep",
        messages: [
          {
            role: "system",
            content: [
              "You are evaluating a candidate Barlas AI Agent skill in a sandbox without tools.",
              `Skill: ${skill.id}@${skill.version}.`,
              skill.instructions,
              "Follow the skill and answer only the supplied test prompt. Do not claim external actions.",
            ].join(" "),
          },
          { role: "user", content: testCase.prompt },
        ],
      });
      const normalized = result.text.toLocaleLowerCase();
      const missing = testCase.requiredStrings.filter((value) => !normalized.includes(value.toLocaleLowerCase()));
      const forbidden = testCase.forbiddenStrings.filter((value) => normalized.includes(value.toLocaleLowerCase()));
      details.push({ name: testCase.name, passed: missing.length === 0 && forbidden.length === 0, missing, forbidden });
    }
    const passedCases = details.filter((item) => item.passed).length;
    return this.store.saveSkillEvaluation({
      id: randomUUID(),
      skillId: skill.id,
      skillVersion: skill.version,
      passed: passedCases === details.length,
      passedCases,
      totalCases: details.length,
      details,
      createdBy: input.createdBy,
    });
  }

  async activate(skillId: string, version: string): Promise<SkillDefinition> {
    const skill = this.registry.get(skillId, version);
    const evaluation = await this.store.latestSkillEvaluation(skillId, version);
    if (!evaluation?.passed) throw new Error("A custom skill must pass its latest evaluation before activation");
    if (!await this.store.activateSkill(skillId, version)) throw new Error("Skill version was not found");
    return this.registry.activate(skill.id, skill.version);
  }

  list(): SkillMetadata[] {
    return this.registry.list();
  }

  private validateTools(allowedTools: string[]): void {
    const available = new Set(this.availableTools());
    const unknown = allowedTools.filter((tool) => !available.has(tool));
    if (unknown.length > 0) throw new Error(`Unknown or unavailable skill tools: ${unknown.join(", ")}`);
  }
}
