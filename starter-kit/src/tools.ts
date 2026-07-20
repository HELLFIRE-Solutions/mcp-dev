import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Adapter } from "./types.js";

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/**
 * Register the resolve/verify/profile trio for one adapter (playbook §1,
 * §4). Every adapter gets the same three tools by construction, so the
 * "does step 1's output feed step 2/3 without translation" property from
 * playbook §3 is structural, not something each adapter has to get right
 * on its own.
 */
export function registerAdapterTools(mcp: McpServer, adapter: Adapter): void {
  const prefix = adapter.name;

  mcp.registerTool(
    `${prefix}_resolve`,
    {
      title: `Resolve (${prefix})`,
      description: `Find candidate records in ${adapter.description} matching a loose query. Returns ranked ids usable directly with ${prefix}_verify and ${prefix}_get_profile.`,
      inputSchema: {
        query: z.string().describe("Free-text search query"),
        limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)"),
      },
    },
    async ({ query, limit }) => {
      try {
        const results = await adapter.resolve(query, limit ?? 10);
        return toolResult(results);
      } catch (err) {
        return toolError(`${prefix}_resolve failed: ${(err as Error).message}`);
      }
    }
  );

  mcp.registerTool(
    `${prefix}_verify`,
    {
      title: `Verify (${prefix})`,
      description: `Verify a record's status in ${adapter.description}, or check one specific claim about it. Takes the id exactly as returned by ${prefix}_resolve.`,
      inputSchema: {
        id: z.string().describe(`Record id, as returned by ${prefix}_resolve`),
        claim: z.string().optional().describe("Optional specific claim to check against the record"),
      },
    },
    async ({ id, claim }) => {
      try {
        const result = await adapter.verify(id, claim);
        return toolResult(result);
      } catch (err) {
        return toolError(`${prefix}_verify failed: ${(err as Error).message}`);
      }
    }
  );

  mcp.registerTool(
    `${prefix}_get_profile`,
    {
      title: `Get profile (${prefix})`,
      description: `Fetch the full record from ${adapter.description}. Takes the id exactly as returned by ${prefix}_resolve.`,
      inputSchema: {
        id: z.string().describe(`Record id, as returned by ${prefix}_resolve`),
      },
    },
    async ({ id }) => {
      try {
        const profile = await adapter.getProfile(id);
        return toolResult(profile);
      } catch (err) {
        return toolError(`${prefix}_get_profile failed: ${(err as Error).message}`);
      }
    }
  );
}
