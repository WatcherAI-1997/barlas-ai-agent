export type OrganizationRole = "owner" | "admin" | "member" | "viewer";
export type OrganizationPlan = "private_alpha" | "team" | "business";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: OrganizationPlan;
  role: OrganizationRole;
  createdAt: string;
}

export interface OrganizationMember {
  accountId: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
  createdAt: string;
}

export interface OrganizationStore {
  createOrganization(input: { name: string; slug: string; plan: OrganizationPlan; ownerId: string }): Promise<Organization>;
  listOrganizations(accountId: string): Promise<Organization[]>;
  getOrganizationRole(organizationId: string, accountId: string): Promise<OrganizationRole | null>;
  listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]>;
  upsertOrganizationMember(input: {
    organizationId: string;
    accountId: string;
    role: Exclude<OrganizationRole, "owner">;
  }): Promise<OrganizationMember>;
  updateOrganizationPlan(organizationId: string, plan: OrganizationPlan): Promise<void>;
}

export class OrganizationService {
  constructor(private readonly store: OrganizationStore) {}

  create(input: { name: string; slug: string; plan: OrganizationPlan; ownerId: string }): Promise<Organization> {
    return this.store.createOrganization({ ...input, name: input.name.trim(), slug: normalizeSlug(input.slug) });
  }

  list(accountId: string): Promise<Organization[]> {
    return this.store.listOrganizations(accountId);
  }

  async members(organizationId: string, actorId: string): Promise<OrganizationMember[]> {
    await this.requireRole(organizationId, actorId, ["owner", "admin", "member", "viewer"]);
    return this.store.listOrganizationMembers(organizationId);
  }

  async addMember(input: {
    organizationId: string;
    actorId: string;
    accountId: string;
    role: Exclude<OrganizationRole, "owner">;
  }): Promise<OrganizationMember> {
    await this.requireRole(input.organizationId, input.actorId, ["owner", "admin"]);
    return this.store.upsertOrganizationMember(input);
  }

  async changePlan(input: {
    organizationId: string;
    actorId: string;
    plan: OrganizationPlan;
  }): Promise<void> {
    await this.requireRole(input.organizationId, input.actorId, ["owner"]);
    await this.store.updateOrganizationPlan(input.organizationId, input.plan);
  }

  private async requireRole(organizationId: string, accountId: string, allowed: OrganizationRole[]): Promise<void> {
    const role = await this.store.getOrganizationRole(organizationId, accountId);
    if (!role || !allowed.includes(role)) throw new OrganizationAuthorizationError();
  }
}

export class OrganizationAuthorizationError extends Error {
  constructor() {
    super("Organization access denied");
    this.name = "OrganizationAuthorizationError";
  }
}

function normalizeSlug(slug: string): string {
  const value = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/u.test(value)) throw new Error("Invalid organization slug");
  return value;
}
