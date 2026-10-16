import { describe, expect, it } from "vitest";

import {
  OrganizationAuthorizationError,
  OrganizationService,
  type OrganizationStore,
} from "../src/organizations/service.js";

function store(role: "owner" | "admin" | "member" | "viewer" | null): OrganizationStore {
  return {
    createOrganization: async (input) => ({
      id: "11111111-1111-4111-8111-111111111111",
      name: input.name,
      slug: input.slug,
      plan: input.plan,
      role: "owner",
      createdAt: "2026-10-16T00:00:00.000Z",
    }),
    listOrganizations: async () => [],
    getOrganizationRole: async () => role,
    listOrganizationMembers: async () => [],
    upsertOrganizationMember: async (input) => ({
      accountId: input.accountId,
      email: "member@example.com",
      displayName: "Member",
      role: input.role,
      createdAt: "2026-10-16T00:00:00.000Z",
    }),
    updateOrganizationPlan: async () => undefined,
  };
}

describe("organization service", () => {
  it("normalizes slugs and creates the first owner membership", async () => {
    const database = store("owner");
    const service = new OrganizationService(database);
    const organization = await service.create({
      name: " Barlas Team ",
      slug: "Barlas-Team",
      plan: "team",
      ownerId: "owner-id",
    });
    expect(organization).toMatchObject({ name: "Barlas Team", slug: "barlas-team", role: "owner" });
  });

  it("allows admins to manage non-owner members but only owners to change plans", async () => {
    const database = store("admin");
    const service = new OrganizationService(database);
    await expect(service.addMember({
      organizationId: "org-id",
      actorId: "admin-id",
      accountId: "member-id",
      role: "viewer",
    })).resolves.toMatchObject({ role: "viewer" });
    await expect(service.changePlan({
      organizationId: "org-id",
      actorId: "admin-id",
      plan: "business",
    })).rejects.toBeInstanceOf(OrganizationAuthorizationError);
  });

  it("denies organization data to non-members", async () => {
    const service = new OrganizationService(store(null));
    await expect(service.members("org-id", "outsider-id")).rejects.toBeInstanceOf(OrganizationAuthorizationError);
  });
});
