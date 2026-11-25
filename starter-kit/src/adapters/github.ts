import { Adapter, ProfileResult, ResolveResult, VerifyResult } from "../types.js";

/**
 * Real GitHub adapter — resolves/verifies/profiles issues and pull requests
 * across a GitHub org via the live REST API. Unlike the other adapters in
 * this kit (`*.example.ts`), this one has no in-memory mock fallback: it
 * throws at construction if `GITHUB_TOKEN` is missing, rather than
 * silently returning fake data. This is the "GitHub org <-> internal-db"
 * pattern from docs/playbook.md — a genuinely wired integration, not a
 * demo of the interface shape.
 *
 * id shape: "owner/repo#number" — the same string flows unmodified through
 * resolve -> verify -> getProfile (playbook §3). Note this is deliberately
 * NOT GitHub's own node_id/GraphQL id — those differ between the REST
 * search endpoint and the REST get-single-issue endpoint in ways that
 * would reintroduce exactly the id-shape bug playbook §3 exists to catch.
 */

const GITHUB_API = "https://api.github.com";

export interface GithubAdapterConfig {
  token?: string;
  org?: string;
}

function parseId(id: string): { owner: string; repo: string; number: number } {
  const m = id.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!m) throw new Error(`invalid github id "${id}", expected "owner/repo#number"`);
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

function repoFromUrl(url: string): string {
  const parts = url.split("/");
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function createGithubAdapter(config: GithubAdapterConfig = {}): Adapter {
  const token = config.token ?? process.env.GITHUB_TOKEN;
  const org = config.org ?? process.env.GITHUB_ORG ?? "HELLFIRE-Solutions";

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is required for the github adapter (no mock fallback — see src/adapters/github.ts). " +
        "Set it in .env, e.g. GITHUB_TOKEN=$(gh auth token)."
    );
  }

  async function ghFetch(path: string): Promise<any> {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${path} -> ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  return {
    name: "github",
    description: `GitHub issues/PRs across the ${org} org (live REST API, no mock fallback)`,

    async resolve(query, limit = 10): Promise<ResolveResult[]> {
      const q = encodeURIComponent(`${query} org:${org}`);
      const data = await ghFetch(`/search/issues?q=${q}&per_page=${limit}`);
      return (data.items ?? []).map((item: any) => ({
        id: `${repoFromUrl(item.repository_url)}#${item.number}`,
        label: item.title,
        summary: `${item.pull_request ? "PR" : "issue"} — ${item.state} — ${repoFromUrl(item.repository_url)}`,
      }));
    },

    async verify(id, claim): Promise<VerifyResult> {
      const { owner, repo, number } = parseId(id);
      const issue = await ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
      let level = issue.state as string;
      let merged: boolean | undefined;
      if (issue.pull_request) {
        const pr = await ghFetch(`/repos/${owner}/${repo}/pulls/${number}`);
        merged = Boolean(pr.merged_at);
        level = merged ? "merged" : issue.state;
      }
      const verified = claim ? level === claim : issue.state === "closed";
      return {
        id,
        verified,
        level,
        claimChecked: claim,
        details: {
          author: issue.user?.login ?? null,
          html_url: issue.html_url,
          updated_at: issue.updated_at,
          ...(merged !== undefined ? { merged } : {}),
        },
      };
    },

    async getProfile(id): Promise<ProfileResult> {
      const { owner, repo, number } = parseId(id);
      const issue = await ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
      const fields: Record<string, unknown> = {
        repo: `${owner}/${repo}`,
        number,
        state: issue.state,
        author: issue.user?.login ?? null,
        html_url: issue.html_url,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        is_pull_request: Boolean(issue.pull_request),
      };
      if (issue.pull_request) {
        const pr = await ghFetch(`/repos/${owner}/${repo}/pulls/${number}`);
        fields.merged = Boolean(pr.merged_at);
        fields.additions = pr.additions;
        fields.deletions = pr.deletions;
        fields.changed_files = pr.changed_files;
      }
      return { id, label: issue.title, fields };
    },
  };
}
