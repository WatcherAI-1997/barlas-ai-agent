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

  private async requireToken(userId: string, connectorId: string): Promise<string> {
    const token = await this.connectors.secret(userId, connectorId, "github");
    if (!token) throw new Error("GitHub connector was not found");
    return token;
  }
}

async function githubRequest(token: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL(path, "https://api.github.com"), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Barlas-AI-Agent",
        "X-GitHub-Api-Version": "2022-11-28",
      },
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
