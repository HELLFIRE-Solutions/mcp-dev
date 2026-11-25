import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

/**
 * Hardened MCP HTTP bootstrap — playbook §2 (docs/playbook.md).
 *
 * Every point below is a fix for a bug that shipped once already in
 * TETA+PI's MCP server before it was caught in multi-client E2E testing.
 * Do not simplify this back to a single module-level transport.
 */

export interface ServerManifest {
  name: string;
  version: string;
  description: string;
  tools: { name: string; description: string }[];
}

export interface StartOptions {
  port: number;
  manifest: ServerManifest;
  registerTools: (mcp: McpServer) => void;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer;
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Mcp-Session-Id, Accept"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function startServer({ port, manifest, registerTools }: StartOptions) {
  const sessions = new Map<string, Session>();

  const httpServer = createServer(async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Scoped routing — anything not explicitly listed here is a real 404,
    // never silently forwarded to the MCP transport (playbook §2).
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", sessions: sessions.size }));
      return;
    }

    if (url.pathname === "/.well-known/mcp" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(manifest));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    const sessionIdHeader = Array.isArray(sessionId) ? sessionId[0] : sessionId;

    try {
      if (sessionIdHeader && sessions.has(sessionIdHeader)) {
        const session = sessions.get(sessionIdHeader)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      if (!sessionIdHeader && req.method === "POST") {
        const body = await readJsonBody(req);
        if (isInitializeRequest(body)) {
          // One McpServer + transport per session — a stateful transport
          // supports exactly one client. Sharing one at module scope is
          // the bug that locked out every second connecting client in
          // TETA+PI's original bootstrap (playbook §2).
          const mcpServer = new McpServer({
            name: manifest.name,
            version: manifest.version,
          });
          registerTools(mcpServer);

          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { transport, mcpServer });
            },
            onsessionclosed: (id) => {
              sessions.delete(id);
            },
          });

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }
      }

      // Unknown or stale session — a clean 400, never a crash or a fall
      // through into corrupting shared state (playbook §2).
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No valid session ID provided" }));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    }
  });

  httpServer.listen(port, () => {
    console.log(`${manifest.name} v${manifest.version} listening on :${port}`);
    console.log(`  manifest: http://localhost:${port}/.well-known/mcp`);
    console.log(`  mcp:      http://localhost:${port}/mcp`);
  });

  return httpServer;
}

/**
 * Wrap an outbound backend call with a timeout so a hung/unreachable
 * backend fails loud instead of hanging the calling agent's tool call
 * indefinitely (playbook §2 — TETA+PI's `apiFetch` originally had none).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
