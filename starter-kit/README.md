# MCP starter kit

The server described in the repository [README](../README.md). This file covers only running and extending it.

## Requirements

Node.js 18 or newer. PostgreSQL only if you use the GitHub sync job.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Compile `src/` to `dist/` with `tsc` (strict mode) |
| `npm start` | Run `dist/index.js` |
| `npm run dev` | `tsc --watch` |
| `npm run sync` | Run the GitHub → PostgreSQL sync once, without the MCP server |
| `node dist/chain-check.js` | Pass each adapter's `resolve` output into `verify` and `get_profile` and check that ids survive unchanged |

## Endpoints

| Method and path | Response |
|---|---|
| `POST /mcp` (no session header, initialize request) | Opens a session and returns `Mcp-Session-Id` |
| `GET/POST/DELETE /mcp` with `Mcp-Session-Id` | Routed to that session's transport |
| `GET /health` | `{"status":"ok","sessions":<n>}` |
| `GET /.well-known/mcp` | Name, version, description and tool list |

CORS is open (`*`), and `Mcp-Session-Id` is exposed to browsers.

## Tools

For each enabled adapter (`crm`, `internal_db`, `api`, and `github` when a token is set):

- `<name>_resolve(query, limit?)`: ranked candidates, at most 50.
- `<name>_verify(id, claim?)`: status of a record, or whether a given status claim holds.
- `<name>_get_profile(id)`: the full record.

Plus `github_sync_to_db(repos?)` when `GITHUB_TOKEN` is set.

## Writing an adapter

1. Create `src/adapters/<name>.ts` that returns an object implementing `Adapter` (`src/types.ts`).
2. Use one id format across all three methods, and wrap every network call in `withTimeout()` from `src/server.ts`.
3. Register it in `src/index.ts` and add a test query to `src/chain-check.ts`.
4. Copy any new variables into `.env.example`.
