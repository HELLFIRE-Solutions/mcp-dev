import { Pool } from "pg";

/**
 * GitHub org -> internal-db sync (docs/playbook.md's "GitHub org <->
 * internal-db" pattern). Reads issue/PR state for a set of repos via the
 * live REST API and upserts the basic facts into internal-db's
 * `mcp_sync.github_state` table (internal-db/migrations/0009_mcp_sync_schema.sql).
 *
 * Exposed two ways: as the `github_sync_to_db` MCP tool (src/index.ts), for
 * an agent to trigger, and as a standalone CLI (`npm run sync`) for cron /
 * manual runs — same underlying function either way.
 */

const GITHUB_API = "https://api.github.com";

export interface SyncConfig {
  token: string;
  org: string;
  /** Repo names (not "owner/repo") to sync. If omitted, every repo in the org is synced. */
  repos?: string[];
  databaseUrl: string;
}

export interface SyncResult {
  repo: string;
  synced: number;
}

interface GhIssueRow {
  repo: string;
  kind: "issue" | "pull_request";
  number: number;
  title: string;
  state: string;
  author: string | null;
  html_url: string;
  github_updated_at: string;
}

async function ghFetch(path: string, token: string): Promise<any> {
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

async function listOrgRepos(org: string, token: string): Promise<string[]> {
  const repos = await ghFetch(`/orgs/${org}/repos?per_page=100`, token);
  return repos.map((r: any) => r.name);
}

async function fetchRepoIssues(org: string, repo: string, token: string): Promise<GhIssueRow[]> {
  const items = await ghFetch(`/repos/${org}/${repo}/issues?state=all&per_page=100`, token);
  return Promise.all(
    items.map(async (item: any) => {
      // The issues endpoint's `state` is only ever open/closed, even for a
      // merged PR -- fetch the pull separately to distinguish merged from
      // closed-unmerged, matching what the github adapter's verify()/
      // getProfile() already do (src/adapters/github.ts).
      let state = item.state;
      if (item.pull_request) {
        const pr = await ghFetch(`/repos/${org}/${repo}/pulls/${item.number}`, token);
        if (pr.merged_at) state = "merged";
      }
      return {
        repo: `${org}/${repo}`,
        kind: item.pull_request ? "pull_request" : "issue",
        number: item.number,
        title: item.title,
        state,
        author: item.user?.login ?? null,
        html_url: item.html_url,
        github_updated_at: item.updated_at,
      };
    })
  );
}

export async function syncGithubToDb(config: SyncConfig): Promise<SyncResult[]> {
  const repos = config.repos && config.repos.length > 0 ? config.repos : await listOrgRepos(config.org, config.token);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const results: SyncResult[] = [];

  try {
    for (const repo of repos) {
      const rows = await fetchRepoIssues(config.org, repo, config.token);
      for (const row of rows) {
        await pool.query(
          `INSERT INTO mcp_sync.github_state
             (repo, kind, number, title, state, author, html_url, github_updated_at, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (repo, kind, number) DO UPDATE SET
             title = EXCLUDED.title,
             state = EXCLUDED.state,
             author = EXCLUDED.author,
             html_url = EXCLUDED.html_url,
             github_updated_at = EXCLUDED.github_updated_at,
             synced_at = now()`,
          [row.repo, row.kind, row.number, row.title, row.state, row.author, row.html_url, row.github_updated_at]
        );
      }
      results.push({ repo: `${config.org}/${repo}`, synced: rows.length });
    }
  } finally {
    await pool.end();
  }

  return results;
}

// CLI entrypoint: node dist/sync/github-to-db.js [repo1,repo2,...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG ?? "HELLFIRE-Solutions";
  const databaseUrl = process.env.MCP_SYNC_DATABASE_URL;
  const repoArg = process.argv[2];

  if (!token) throw new Error("GITHUB_TOKEN is required");
  if (!databaseUrl) throw new Error("MCP_SYNC_DATABASE_URL is required");

  syncGithubToDb({
    token,
    org,
    repos: repoArg ? repoArg.split(",").map((r) => r.trim()) : undefined,
    databaseUrl,
  })
    .then((results) => {
      console.log(JSON.stringify(results, null, 2));
    })
    .catch((err) => {
      console.error((err as Error).message);
      process.exit(1);
    });
}
