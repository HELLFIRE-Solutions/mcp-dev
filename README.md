# mcp-dev

A TypeScript starter kit for building Model Context Protocol (MCP) servers that expose a company's own systems (a CRM, an internal database, any REST API, a GitHub organisation) to AI agents. It ships one tool contract, `resolve → verify → get_profile`, which every adapter implements, so an agent can find a record, check it and read it while passing a single identifier through all three calls.

## Status

Early. Six commits, last change August 2026, version `0.2.0` in `starter-kit/package.json`. Three of the four adapters are examples backed by in-memory data; the GitHub adapter makes real API calls. There is no automated test suite and no CI. A chain-check script (below) is the only executable check.

## Repository layout

| Path | Contents |
|---|---|
| `starter-kit/` | The MCP server: HTTP bootstrap, tool registration, adapters, sync job |
| `docs/playbook.md` | Engineering checklist the code follows: bootstrap hardening, id discipline across the tool chain, release and discoverability steps |

## How it works

- **Transport.** `src/server.ts` runs a plain `node:http` server with the MCP SDK's Streamable HTTP transport. It creates one `McpServer` and one transport per session, keyed by the `Mcp-Session-Id` header. It only routes `/mcp`, `GET /health` and `GET /.well-known/mcp` (a JSON manifest of the tools). Any other path returns 404, and an unknown session returns 400.
- **Tool contract.** `src/types.ts` defines the `Adapter` interface (`resolve`, `verify`, `getProfile`). `src/tools.ts` registers `<adapter>_resolve`, `<adapter>_verify` and `<adapter>_get_profile` for every adapter, with input schemas in Zod. Results come back as JSON text, and failures as `isError` results.
- **Adapters** (`src/adapters/`):
  - `crm.example.ts`: a contacts API in the HubSpot/Pipedrive style. Live when `CRM_BASE_URL` and `CRM_API_KEY` are set, otherwise three sample contacts.
  - `api.example.ts`: a generic `/resources` REST API. Live when `API_BASE_URL` and `API_KEY` are set, otherwise sample items.
  - `internal-db.example.ts`: in-memory records, with comments showing where a `pg` pool goes.
  - `github.ts`: real GitHub REST calls over issues and pull requests in one organisation. Its ids look like `owner/repo#number`. It is enabled only when `GITHUB_TOKEN` is set.
- **Timeouts.** `withTimeout()` wraps every outbound call (10 s by default), so a stalled backend fails the tool call instead of hanging it.
- **Sync.** `src/sync/github-to-db.ts` reads issue and PR state for an organisation's repositories and upserts it into a PostgreSQL table `mcp_sync.github_state`. It runs as the `github_sync_to_db` tool or as `npm run sync`. The table's migration is not part of this repository.

## Quick start

```bash
cd starter-kit
npm install
npm run build
npm start                  # listens on :3000 (PORT to change)
curl localhost:3000/.well-known/mcp
```

With no environment variables the server starts with the `crm`, `internal_db` and `api` adapters on sample data. Point any MCP client that speaks Streamable HTTP at `http://localhost:3000/mcp`.

## Configuration

All variables are optional. See `starter-kit/.env.example`.

| Variable | Effect |
|---|---|
| `PORT` | HTTP port, default 3000 |
| `CRM_BASE_URL`, `CRM_API_KEY` | Switch the CRM adapter from sample data to a live API |
| `API_BASE_URL`, `API_KEY` | Same for the generic API adapter |
| `GITHUB_TOKEN`, `GITHUB_ORG` | Enable the GitHub adapter and the sync tool (organisation defaults to `HELLFIRE-Solutions`) |
| `MCP_SYNC_DATABASE_URL` | PostgreSQL connection used by the sync job |

## Checks

```bash
cd starter-kit && npm run build && node dist/chain-check.js
```

`chain-check` passes each adapter's `resolve` output, unchanged, into `verify` and `getProfile`, and fails if any call returns a different id. It covers the GitHub adapter only when `GITHUB_TOKEN` is set.

## Adding an adapter

Implement `Adapter` from `src/types.ts` in a new file under `src/adapters/`, add it to the `adapters` array in `src/index.ts`, and add a query for it in `src/chain-check.ts`.

## Licence

MIT. See `LICENSE`.
