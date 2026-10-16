export interface SkillDefinition {
  id: string;
  version: string;
  description: string;
  instructions: string;
  allowedTools: string[];
}

export type SkillMetadata = Omit<SkillDefinition, "instructions"> & { active: boolean };

export class SkillRegistry {
  private readonly skills = new Map<string, Map<string, SkillDefinition>>();
  private readonly activeVersions = new Map<string, string>();

  register(skill: SkillDefinition, activate = true): void {
    if (!/^[a-z][a-z0-9.-]{2,63}$/u.test(skill.id)) {
      throw new Error(`Invalid skill id: ${skill.id}`);
    }
    if (!/^\d+\.\d+\.\d+$/u.test(skill.version)) {
      throw new Error(`Invalid skill version for ${skill.id}`);
    }
    const versions = this.skills.get(skill.id) ?? new Map<string, SkillDefinition>();
    if (versions.has(skill.version)) throw new Error(`Skill ${skill.id}@${skill.version} is already registered`);
    versions.set(skill.version, Object.freeze({ ...skill, allowedTools: [...skill.allowedTools] }));
    this.skills.set(skill.id, versions);
    if (activate) this.activeVersions.set(skill.id, skill.version);
  }

  get(id: string, version?: string): SkillDefinition {
    const activeVersion = version ?? this.activeVersions.get(id);
    const skill = activeVersion ? this.skills.get(id)?.get(activeVersion) : undefined;
    if (!skill) throw new Error(`Unknown skill: ${id}`);
    return skill;
  }

  activate(id: string, version: string): SkillDefinition {
    const skill = this.skills.get(id)?.get(version);
    if (!skill) throw new Error(`Unknown skill version: ${id}@${version}`);
    this.activeVersions.set(id, version);
    return skill;
  }

  has(id: string, version: string): boolean {
    return this.skills.get(id)?.has(version) ?? false;
  }

  isActive(id: string, version: string): boolean {
    return this.activeVersions.get(id) === version;
  }

  list(): SkillMetadata[] {
    return [...this.skills.entries()].flatMap(([id, versions]) => [...versions.values()].map((skill) => {
      const { instructions: _instructions, ...metadata } = skill;
      return { ...metadata, active: this.activeVersions.get(id) === skill.version };
    }));
  }
}

export function createBuiltinSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  registry.register({
    id: "research.summary",
    version: "1.0.0",
    description: "Extract verified findings, uncertainties, and sources from supplied context.",
    instructions: "Separate facts from assumptions. Preserve source references. State uncertainty explicitly.",
    allowedTools: ["files.read", "files.list", "web.search"],
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
