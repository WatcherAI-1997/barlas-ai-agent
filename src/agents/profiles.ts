export type AgentProfileStyle = "balanced" | "concise" | "warm" | "analytical" | "creative";
export type AgentTaskClass = "fast" | "deep" | "private";
export type AgentInitiativeLevel = "directed" | "balanced" | "proactive";
export type AgentRiskPosture = "cautious" | "balanced" | "bold";
export type AgentCritiqueStyle = "gentle" | "direct" | "challenging";

export interface AgentCharacter {
  values: string[];
  strengths: string[];
  voice: string;
  initiativeLevel: AgentInitiativeLevel;
  riskPosture: AgentRiskPosture;
  critiqueStyle: AgentCritiqueStyle;
  color: string;
  avatar?: string | undefined;
}

export interface AgentProfile {
  id: string;
  userId: string;
  slug: string;
  name: string;
  style: AgentProfileStyle;
  instructions: string;
  defaultTaskClass: AgentTaskClass;
  character: AgentCharacter;
  identityVersion: number;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfileStore {
  createAgentProfile(input: Omit<AgentProfile, "id" | "createdAt" | "updatedAt" | "identityVersion">): Promise<AgentProfile>;
  listAgentProfiles(userId: string): Promise<AgentProfile[]>;
  getAgentProfile(userId: string, id: string): Promise<AgentProfile | null>;
  updateAgentProfile(input: { userId: string; id: string; patch: AgentProfilePatch; reason: string }): Promise<AgentProfile | null>;
  listAgentProfileRevisions(userId: string, id: string): Promise<AgentProfileRevision[]>;
  deleteAgentProfile(userId: string, id: string): Promise<boolean>;
  bindConversationAgentProfile(input: { userId: string; conversationId: string; profileId: string }): Promise<boolean>;
  getConversationAgentProfile(userId: string, conversationId: string): Promise<AgentProfile | null>;
}

export interface AgentProfileRevision {
  version: number;
  snapshot: Omit<AgentProfile, "createdAt" | "updatedAt">;
  reason: string;
  createdAt: string;
}

export type AgentProfilePatch = Partial<Omit<AgentProfile, "id" | "userId" | "slug" | "createdAt" | "updatedAt" | "identityVersion" | "projectId">> & {
  projectId?: string | null;
};

export class AgentProfileConflictError extends Error {}

export class AgentProfileService {
  constructor(private readonly store: AgentProfileStore) {}

  create(input: Omit<AgentProfile, "id" | "createdAt" | "updatedAt" | "identityVersion">) {
    return this.store.createAgentProfile(input);
  }

  list(userId: string) { return this.store.listAgentProfiles(userId); }
  get(userId: string, id: string) { return this.store.getAgentProfile(userId, id); }
  update(userId: string, id: string, patch: Parameters<AgentProfileStore["updateAgentProfile"]>[0]["patch"], reason: string) {
    return this.store.updateAgentProfile({ userId, id, patch, reason });
  }
  revisions(userId: string, id: string) { return this.store.listAgentProfileRevisions(userId, id); }
  delete(userId: string, id: string) { return this.store.deleteAgentProfile(userId, id); }

  async resolve(userId: string, conversationId: string, requestedId?: string): Promise<AgentProfile | null> {
    if (!requestedId) return this.store.getConversationAgentProfile(userId, conversationId);
    const profile = await this.store.getAgentProfile(userId, requestedId);
    if (!profile) throw new AgentProfileConflictError("Agent profile not found");
    if (!(await this.store.bindConversationAgentProfile({ userId, conversationId, profileId: profile.id }))) {
      throw new AgentProfileConflictError("Conversation belongs to another agent profile");
    }
    return profile;
  }
}

export function agentProfileInstruction(profile: AgentProfile): string {
  const style = {
    balanced: "Be clear, practical, and appropriately detailed.",
    concise: "Prefer short, direct answers unless detail is necessary.",
    warm: "Be warm, patient, and conversational while staying useful.",
    analytical: "Reason carefully, surface assumptions, and favor evidence.",
    creative: "Explore original approaches while remaining accurate and actionable.",
  } as const;
  return [
    `You are ${profile.name}, a dedicated Barlas agent profile.`,
    style[profile.style],
    `Your stable values are: ${profile.character.values.join(", ") || "helpfulness, honesty, and respect"}.`,
    `Your strongest capabilities are: ${profile.character.strengths.join(", ") || "general problem solving"}.`,
    profile.character.voice ? `Your recognizable voice: ${profile.character.voice}` : undefined,
    `Initiative: ${profile.character.initiativeLevel}. Risk posture: ${profile.character.riskPosture}. Critique style: ${profile.character.critiqueStyle}.`,
    profile.instructions.trim(),
    "Protected Barlas principles: the owner remains the highest authority; never bypass permissions, approval gates, privacy, budgets, or safety boundaries. Character is a consistent working disposition, not a theatrical role. Admit uncertainty, preserve factual accuracy, and do not claim actions or memories that did not occur.",
  ].filter(Boolean).join("\n");
}
