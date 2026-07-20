# HELLFIRE MCP starter-kit

A generic MCP server implementing the resolve → verify → profile chain
described in [`../docs/playbook.md`](../docs/playbook.md), with three
example adapters (CRM, internal DB, generic API) so a client integration is
"implement one `Adapter`", not "build a server from scratch".

Runs out of the box with **no credentials** — every adapter falls back to a
small in-memory example dataset when its `baseUrl`/`apiKey` env vars are
unset.

## Quick start

```bash
npm install
npm run build
npm start
# → hellfire-mcp-starter-kit v0.1.0 listening on :3000
```

Check it's alive:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/.well-known/mcp
```

Run the chained self-test (playbook §3 — resolve's output fed unmodified
into verify/getProfile, for every adapter):

```bash
npm run build && node dist/chain-check.js
```

Connect a real MCP client:

```bash
claude mcp add --transport http hellfire-starter http://localhost:3000/mcp
# or: npx @modelcontextprotocol/inspector http://localhost:3000/mcp --transport http
```

## What's in here

| File | Purpose |
|---|---|
| `src/server.ts` | Hardened HTTP bootstrap — session-per-client transport, CORS, scoped routing, outbound timeouts (playbook §2) |
| `src/types.ts` | The `Adapter` interface (`resolve`/`verify`/`getProfile`), single `id: string` type across all three (playbook §3) |
| `src/tools.ts` | Generates the three MCP tools for any adapter from that one interface |
| `src/adapters/*.example.ts` | CRM, internal DB, generic API examples — swap the mock data for real calls |
| `src/chain-check.ts` | The chained resolve→verify→profile test from playbook §3, runnable standalone |
| `src/index.ts` | Wires adapters → tools → server; reads config from env |

## Adding an adapter (playbook §4, adapted)

1. Implement `Adapter` in a new `src/adapters/<name>.ts` — `resolve`,
   `verify`, `getProfile`, all keyed by the same `id: string`.
2. Add it to the `adapters` array in `src/index.ts`.
3. Add it to `checks` in `src/chain-check.ts` with a query that matches
   your data, and run `node dist/chain-check.js` — this is the check that
   catches an id-shape mismatch before an agent does.
4. `npm run build` (typecheck), commit, push.
5. Verify live: hit `/.well-known/mcp` on the deployed server and confirm
   the new adapter's three tools are listed.

No manifest/agent.json hand-editing needed here — the manifest tool list is
generated from the adapters array in `src/index.ts`, so it can't drift out
of sync the way TETA+PI's hand-maintained manifest + two `agent.json` files
could.

## Before you ship (playbook §5)

Before pointing a real agent at this in production:

- [ ] `node dist/chain-check.js` passes for every adapter, against **live**
      backends (not the mock fallback) if any adapter has real
      `baseUrl`/`apiKey` configured.
- [ ] A real MCP client (Claude Code remote MCP or
      `@modelcontextprotocol/inspector`) can resolve → verify → get_profile
      end to end for at least one adapter.
- [ ] Two clients connected at once don't collide (open two client
      sessions against the same server; confirm neither gets
      `"Server already initialized"` or a stale-session 400).
- [ ] `/health` and `/.well-known/mcp` respond correctly behind whatever
      reverse proxy fronts this in production.

## Deploy (playbook §6)

Same shape as TETA+PI's MCP server:

1. `npm run build` → `dist/`.
2. Ship `dist/` + `package.json` to the target (CI rsync, or manual for a
   first deploy), `npm install --omit=dev`.
3. Run under a process manager (systemd unit, pm2, or equivalent) — one
   unit per server.
4. Reverse proxy (nginx/Caddy) on a dedicated subdomain, HTTPS from the
   first request if the domain is on any HSTS-preload list.
5. Bump `SERVER_VERSION` in `src/index.ts` (and `package.json`) together on
   every change that touches tool schemas or behavior, so `/.well-known/mcp`
   is a reliable "what's deployed" check.

## Client setup snippets

**Claude Code:**
```bash
claude mcp add --transport http <name> https://<your-domain>/mcp
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "<name>": { "type": "http", "url": "https://<your-domain>/mcp" }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "<name>": { "url": "https://<your-domain>/mcp" }
  }
}
```
