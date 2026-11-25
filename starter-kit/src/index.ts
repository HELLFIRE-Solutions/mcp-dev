import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startServer } from "./server.js";
import { registerAdapterTools } from "./tools.js";
import { createCrmAdapter } from "./adapters/crm.example.js";
import { createInternalDbAdapter } from "./adapters/internal-db.example.js";
import { createApiAdapter } from "./adapters/api.example.js";
import { createGithubAdapter } from "./adapters/github.js";
import { syncGithubToDb } from "./sync/github-to-db.js";
import { Adapter } from "./types.js";

const SERVER_NAME = "hellfire-mcp-starter-kit";
const SERVER_VERSION = "0.2.0";

const adapters: Adapter[] = [
  createCrmAdapter({ baseUrl: process.env.CRM_BASE_URL, apiKey: process.env.CRM_API_KEY }),
  createInternalDbAdapter(),
  createApiAdapter({ baseUrl: process.env.API_BASE_URL, apiKey: process.env.API_KEY }),
];

// Unlike the three adapters above, github has no mock fallback (it's a
// real, currently-wired integration, not a demo — see
// src/adapters/github.ts) — so it's only added when a token is actually
// configured, to keep the rest of the starter-kit's zero-config startup
// intact for anyone evaluating the template without GitHub credentials.
const hasGithubToken = Boolean(process.env.GITHUB_TOKEN);
if (hasGithubToken) {
  adapters.push(createGithubAdapter());
} else {
  console.warn("GITHUB_TOKEN not set — github adapter and github_sync_to_db tool disabled");
}

const manifest = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  description:
    "HELLFIRE AI Solutions MCP starter-kit — resolve/verify/profile tools over CRM, internal DB, generic API, and (when configured) GitHub adapters, plus a github_sync_to_db tool.",
  tools: [
    ...adapters.flatMap((a) => [
      { name: `${a.name}_resolve`, description: `Resolve a query against ${a.description}` },
      { name: `${a.name}_verify`, description: `Verify a record from ${a.description}` },
      { name: `${a.name}_get_profile`, description: `Get the full profile of a record from ${a.description}` },
    ]),
    ...(hasGithubToken
      ? [{ name: "github_sync_to_db", description: "Sync GitHub org issue/PR state into internal-db's mcp_sync.github_state table" }]
      : []),
  ],
};

startServer({
  port: Number(process.env.PORT ?? 3000),
  manifest,
  registerTools: (mcp: McpServer) => {
    for (const adapter of adapters) {
      registerAdapterTools(mcp, adapter);
    }

    if (hasGithubToken) {
      mcp.registerTool(
        "github_sync_to_db",
        {
          title: "Sync GitHub state to internal-db",
          description:
            "Reads issue/PR state for GitHub org repos (via the live REST API) and upserts the basic facts into internal-db's mcp_sync.github_state table.",
          inputSchema: {
            repos: z
              .string()
              .optional()
              .describe("Comma-separated repo names to sync (default: every repo in the org)"),
          },
        },
        async ({ repos }) => {
          try {
            const databaseUrl = process.env.MCP_SYNC_DATABASE_URL;
            if (!databaseUrl) {
              throw new Error("MCP_SYNC_DATABASE_URL not configured");
            }
            const result = await syncGithubToDb({
              token: process.env.GITHUB_TOKEN!,
              org: process.env.GITHUB_ORG ?? "HELLFIRE-Solutions",
              repos: repos ? repos.split(",").map((r) => r.trim()) : undefined,
              databaseUrl,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `github_sync_to_db failed: ${(err as Error).message}` }],
              isError: true,
            };
          }
        }
      );
    }
  },
});
