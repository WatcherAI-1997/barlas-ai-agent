import type { ConnectorService } from "./vault.js";

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  url: string;
  defaultBranch: string;
  updatedAt: string;
}

export class GitHubConnector {
  constructor(private readonly connectors: Pick<ConnectorService, "secret">) {}

  async profile(userId: string, connectorId: string): Promise<{ login: string; name: string | null; avatarUrl: string }> {
    const token = await this.requireToken(userId, connectorId);
    const data = await githubRequest(token, "/user") as Record<string, unknown>;
    if (typeof data.login !== "string" || typeof data.avatar_url !== "string") {
      throw new Error("GitHub returned an invalid profile response");
    }
    return {
      login: data.login,
      name: typeof data.name === "string" ? data.name : null,
      avatarUrl: data.avatar_url,
    };
  }

  async repositories(userId: string, connectorId: string, limit: number): Promise<GitHubRepository[]> {
    const token = await this.requireToken(userId, connectorId);
    const data = await githubRequest(token, `/user/repos?per_page=${limit}&sort=updated&affiliation=owner,collaborator,organization_member`);
    if (!Array.isArray(data)) throw new Error("GitHub returned an invalid repositories response");
    return data.map((value) => {
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "number" || typeof row.name !== "string" || typeof row.full_name !== "string" ||
          typeof row.private !== "boolean" || typeof row.html_url !== "string" ||
          typeof row.default_branch !== "string" || typeof row.updated_at !== "string") {
        throw new Error("GitHub returned an invalid repository entry");
      }
      return {
        id: row.id,
        name: row.name,
        fullName: row.full_name,
        private: row.private,
        url: row.html_url,
        defaultBranch: row.default_branch,
        updatedAt: row.updated_at,
      };
    });
  }

  async createBranch(userId: string, connectorId: string, input: {
    repository: string;
    branch: string;
    fromBranch: string;
  }): Promise<{ ref: string; sha: string }> {
    const token = await this.requireToken(userId, connectorId);
    const repository = normalizeRepository(input.repository);
    const source = await githubRequest(token, `/repos/${repository}/git/ref/heads/${encodeURIComponent(input.fromBranch)}`) as Record<string, unknown>;
    const object = source.object as Record<string, unknown> | undefined;
    if (!object || typeof object.sha !== "string") throw new Error("GitHub returned an invalid source ref");
    const data = await githubRequest(token, `/repos/${repository}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${input.branch}`, sha: object.sha },
    }) as Record<string, unknown>;
    if (typeof data.ref !== "string") throw new Error("GitHub returned an invalid created ref");
    return { ref: data.ref, sha: object.sha };
  }

  async commitFile(userId: string, connectorId: string, input: {
    repository: string;
    path: string;
    branch: string;
    message: string;
    content: string;
    sha?: string;
  }): Promise<{ commitSha: string; contentPath: string }> {
    const token = await this.requireToken(userId, connectorId);
    const repository = normalizeRepository(input.repository);
    const path = normalizePath(input.path);
    const data = await githubRequest(token, `/repos/${repository}/contents/${path}`, {
      method: "PUT",
      body: {
        message: input.message,
        content: Buffer.from(input.content, "utf8").toString("base64"),
        branch: input.branch,
        ...(input.sha ? { sha: input.sha } : {}),
      },
    }) as Record<string, unknown>;
    const commit = data.commit as Record<string, unknown> | undefined;
    const content = data.content as Record<string, unknown> | undefined;
    if (!commit || typeof commit.sha !== "string" || !content || typeof content.path !== "string") {
      throw new Error("GitHub returned an invalid commit response");
    }
    return { commitSha: commit.sha, contentPath: content.path };
  }

  async createPullRequest(userId: string, connectorId: string, input: {
    repository: string;
    title: string;
    body?: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<{ number: number; url: string; state: string }> {
    const token = await this.requireToken(userId, connectorId);
    const repository = normalizeRepository(input.repository);
    const { repository: _repository, ...body } = input;
    const data = await githubRequest(token, `/repos/${repository}/pulls`, { method: "POST", body }) as Record<string, unknown>;
    return normalizeCreatedItem(data, "pull request");
  }

  async createIssue(userId: string, connectorId: string, input: {
    repository: string;
    title: string;
    body?: string;
    labels?: string[];
  }): Promise<{ number: number; url: string; state: string }> {
    const token = await this.requireToken(userId, connectorId);
    const repository = normalizeRepository(input.repository);
    const { repository: _repository, ...body } = input;
    const data = await githubRequest(token, `/repos/${repository}/issues`, { method: "POST", body }) as Record<string, unknown>;
    return normalizeCreatedItem(data, "issue");
  }

  private async requireToken(userId: string, connectorId: string): Promise<string> {
    const token = await this.connectors.secret(userId, connectorId, "github");
    if (!token) throw new Error("GitHub connector was not found");
    return token;
  }
}

function normalizeRepository(value: string): string {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)) throw new Error("Invalid GitHub repository name");
  return value.split("/").map(encodeURIComponent).join("/");
}

function normalizePath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\0") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid repository file path");
  }
  return value.split("/").map(encodeURIComponent).join("/");
}

function normalizeCreatedItem(data: Record<string, unknown>, kind: string): { number: number; url: string; state: string } {
  if (typeof data.number !== "number" || typeof data.html_url !== "string" || typeof data.state !== "string") {
    throw new Error(`GitHub returned an invalid ${kind} response`);
  }
  return { number: data.number, url: data.html_url, state: data.state };
}

async function githubRequest(token: string, path: string, options: {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
} = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL(path, "https://api.github.com"), {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "Barlas-AI-Agent",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub request failed with status ${response.status}`);
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 2 * 1024 * 1024) throw new Error("GitHub response is too large");
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}
