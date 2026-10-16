export type AgentProfileStyle = "balanced" | "concise" | "warm" | "analytical" | "creative";
export type AgentTaskClass = "fast" | "deep" | "private";

export interface AgentProfile {
  id: string;
  userId: string;
  slug: string;
  name: string;
  style: AgentProfileStyle;
  instructions: string;
  defaultTaskClass: AgentTaskClass;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfileStore {
  createAgentProfile(input: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">): Promise<AgentProfile>;
  listAgentProfiles(userId: string): Promise<AgentProfile[]>;
  getAgentProfile(userId: string, id: string): Promise<AgentProfile | null>;
  deleteAgentProfile(userId: string, id: string): Promise<boolean>;
  bindConversationAgentProfile(input: { userId: string; conversationId: string; profileId: string }): Promise<boolean>;
  getConversationAgentProfile(userId: string, conversationId: string): Promise<AgentProfile | null>;
}

export class AgentProfileConflictError extends Error {}

export class AgentProfileService {
  constructor(private readonly store: AgentProfileStore) {}

  create(input: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">) {
    return this.store.createAgentProfile(input);
  }

  list(userId: string) { return this.store.listAgentProfiles(userId); }
  get(userId: string, id: string) { return this.store.getAgentProfile(userId, id); }
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
    profile.instructions.trim(),
  ].filter(Boolean).join("\n");
}
