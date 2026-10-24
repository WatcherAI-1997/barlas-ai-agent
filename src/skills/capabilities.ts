import type { ExtensionStatus } from "../extensions/catalog.js";
import type { SkillDefinition, SkillMetadata } from "./registry.js";

export type SkillReadiness = "ready" | "degraded" | "unavailable";

export interface SkillCapabilityProfile {
  readiness: SkillReadiness;
  usable: boolean;
  availableTools: string[];
  missingTools: string[];
  missingCapabilities: string[];
}

export function runtimeCapabilities(
  toolNames: readonly string[],
  extensions: readonly Pick<ExtensionStatus, "id" | "configured">[] = [],
): Set<string> {
  return new Set([
    ...toolNames,
    ...extensions.filter((extension) => extension.configured).map((extension) => extension.id),
  ]);
}

export function assessSkillCapabilities(
  skill: SkillDefinition | SkillMetadata,
  capabilities: ReadonlySet<string>,
): SkillCapabilityProfile {
  const availableTools = skill.allowedTools.filter((tool) => capabilities.has(tool));
  const missingTools = skill.allowedTools.filter((tool) => !capabilities.has(tool));
  const missingCapabilities = (skill.requiredCapabilities ?? [])
    .filter((capability) => !capabilities.has(capability));
  const readiness: SkillReadiness = missingCapabilities.length > 0 ||
      (skill.allowedTools.length > 0 && availableTools.length === 0)
    ? "unavailable"
    : missingTools.length > 0
      ? "degraded"
      : "ready";
  return {
    readiness,
    usable: (!("active" in skill) || skill.active) && readiness !== "unavailable",
    availableTools,
    missingTools,
    missingCapabilities,
  };
}
