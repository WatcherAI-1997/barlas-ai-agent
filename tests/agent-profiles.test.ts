import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AgentProfileConflictError,
  AgentProfileService,
  agentProfileInstruction,
  type AgentProfile,
  type AgentProfileStore,
} from "../src/agents/profiles.js";

class MemoryProfileStore implements AgentProfileStore {
  profiles: AgentProfile[] = [];
  bindings = new Map<string, string>();

  async createAgentProfile(input: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">) {
    const profile = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.profiles.push(profile);
    return profile;
  }
  async listAgentProfiles(userId: string) { return this.profiles.filter((profile) => profile.userId === userId); }
  async getAgentProfile(userId: string, id: string) { return this.profiles.find((profile) => profile.userId === userId && profile.id === id) ?? null; }
  async deleteAgentProfile(userId: string, id: string) {
    const before = this.profiles.length;
    this.profiles = this.profiles.filter((profile) => profile.userId !== userId || profile.id !== id);
    return before !== this.profiles.length;
  }
  async bindConversationAgentProfile(input: { userId: string; conversationId: string; profileId: string }) {
    const profile = await this.getAgentProfile(input.userId, input.profileId);
    if (!profile) return false;
    const existing = this.bindings.get(input.conversationId);
    if (existing && existing !== input.profileId) return false;
    this.bindings.set(input.conversationId, input.profileId);
    return true;
  }
  async getConversationAgentProfile(userId: string, conversationId: string) {
    const id = this.bindings.get(conversationId);
    return id ? this.getAgentProfile(userId, id) : null;
  }
}

describe("agent profiles", () => {
  it("binds a conversation to one owned profile and restores it", async () => {
    const store = new MemoryProfileStore();
    const service = new AgentProfileService(store);
    const profile = await service.create({
      userId: "owner", slug: "research", name: "Researcher", style: "analytical",
      instructions: "Cite evidence.", defaultTaskClass: "deep", projectId: randomUUID(),
    });
    const conversationId = randomUUID();
    expect(await service.resolve("owner", conversationId, profile.id)).toEqual(profile);
    expect(await service.resolve("owner", conversationId)).toEqual(profile);
    expect(agentProfileInstruction(profile)).toContain("Cite evidence.");
  });

  it("rejects cross-profile and cross-user conversation reuse", async () => {
    const store = new MemoryProfileStore();
    const service = new AgentProfileService(store);
    const first = await service.create({ userId: "owner", slug: "one", name: "One", style: "balanced", instructions: "", defaultTaskClass: "fast" });
    const second = await service.create({ userId: "owner", slug: "two", name: "Two", style: "warm", instructions: "", defaultTaskClass: "fast" });
    const conversationId = randomUUID();
    await service.resolve("owner", conversationId, first.id);
    await expect(service.resolve("owner", conversationId, second.id)).rejects.toBeInstanceOf(AgentProfileConflictError);
    await expect(service.resolve("stranger", randomUUID(), first.id)).rejects.toBeInstanceOf(AgentProfileConflictError);
  });
});
