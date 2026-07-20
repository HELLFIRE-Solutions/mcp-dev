import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startServer } from "./server.js";
import { registerAdapterTools } from "./tools.js";
import { createCrmAdapter } from "./adapters/crm.example.js";
import { createInternalDbAdapter } from "./adapters/internal-db.example.js";
import { createApiAdapter } from "./adapters/api.example.js";
import { Adapter } from "./types.js";

const SERVER_NAME = "hellfire-mcp-starter-kit";
const SERVER_VERSION = "0.1.0";

const adapters: Adapter[] = [
  createCrmAdapter({ baseUrl: process.env.CRM_BASE_URL, apiKey: process.env.CRM_API_KEY }),
  createInternalDbAdapter(),
  createApiAdapter({ baseUrl: process.env.API_BASE_URL, apiKey: process.env.API_KEY }),
];

const manifest = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  description:
    "HELLFIRE AI Solutions MCP starter-kit — resolve/verify/profile tools over CRM, internal DB, and generic API adapters.",
  tools: adapters.flatMap((a) => [
    { name: `${a.name}_resolve`, description: `Resolve a query against ${a.description}` },
    { name: `${a.name}_verify`, description: `Verify a record from ${a.description}` },
    { name: `${a.name}_get_profile`, description: `Get the full profile of a record from ${a.description}` },
  ]),
};

startServer({
  port: Number(process.env.PORT ?? 3000),
  manifest,
  registerTools: (mcp: McpServer) => {
    for (const adapter of adapters) {
      registerAdapterTools(mcp, adapter);
    }
  },
});
