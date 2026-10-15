export interface SkillDefinition {
  id: string;
  version: string;
  description: string;
  instructions: string;
  allowedTools: string[];
}

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    if (!/^[a-z][a-z0-9.-]{2,63}$/u.test(skill.id)) {
      throw new Error(`Invalid skill id: ${skill.id}`);
    }
    if (!/^\d+\.\d+\.\d+$/u.test(skill.version)) {
      throw new Error(`Invalid skill version for ${skill.id}`);
    }
    if (this.skills.has(skill.id)) throw new Error(`Skill ${skill.id} is already registered`);
    this.skills.set(skill.id, Object.freeze({ ...skill, allowedTools: [...skill.allowedTools] }));
  }

  get(id: string): SkillDefinition {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`Unknown skill: ${id}`);
    return skill;
  }

  list(): Array<Omit<SkillDefinition, "instructions">> {
    return [...this.skills.values()].map(({ instructions: _instructions, ...metadata }) => metadata);
  }
}

export function createBuiltinSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.register({
    id: "research.summary",
    version: "1.0.0",
    description: "Extract verified findings, uncertainties, and sources from supplied context.",
    instructions: "Separate facts from assumptions. Preserve source references. State uncertainty explicitly.",
    allowedTools: ["files.read", "files.list"],
  });
  registry.register({
    id: "writing.brief",
    version: "1.0.0",
    description: "Turn supplied findings into a concise decision brief.",
    instructions: "Lead with the outcome, keep claims grounded in context, and end with concrete next actions.",
    allowedTools: ["files.read", "files.write"],
  });
  registry.register({
    id: "planning.execution",
    version: "1.0.0",
    description: "Produce an ordered implementation plan with checks and rollback points.",
    instructions: "Use bounded steps, identify dependencies and risks, and include objective verification criteria.",
    allowedTools: ["files.read", "files.list"],
  });
  return registry;
}
