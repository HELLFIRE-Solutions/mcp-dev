# The resolve → verify → profile playbook

Distilled from building and hardening TETA+PI's production MCP server
(`mcp.tetapi.dev`, TypeScript, `@modelcontextprotocol/sdk`, versions 1.2.0 →
1.4.0). This is a process document, not a code dump — it captures what broke,
why, and the checklist that prevents it from breaking the same way twice. The
generic starter-kit in [`starter-kit/`](../starter-kit) is this playbook
turned into runnable scaffolding.

Source material: the development history of the TETA+PI MCP server
([teta-pi/mcp](https://github.com/teta-pi/mcp)). Every incident below is a real,
dated bug from that project, not a hypothetical.

## 1. What the chain is

Most MCP servers that expose a data source to agents end up needing the same
three-step shape, regardless of domain:

1. **resolve** — turn a loose, natural-language or fuzzy query into a
   specific, addressable record. TETA+PI's flagship tool is
   `teta_resolve_intent`: TWIRA-ranked semantic search that returns a ranked
   list of entity IDs with a trust/intent/provenance breakdown.
2. **verify** — given a specific record, confirm a claim about it or fetch
   the entity's verified state (registry attestation, ownership of an
   endpoint, a specific claim). TETA+PI: `teta_verify_entity`,
   `teta_verify_endpoint`, `teta_verify_claim`.
3. **profile / proof** — fetch the full record for display or downstream
   reasoning, at whatever depth the agent asked for. TETA+PI:
   `teta_get_profile` (public view), `teta_get_proof` (raw cryptographic
   proof + proof depth: OTS status, BTC confirmation depth, C2PA chain
   length).

The chain is only useful if an agent can call all three back-to-back without
manual translation in between — the output of step 1 must be directly usable
as the input to step 2 and step 3. That single property (a stable, correctly
typed identifier flowing through all three calls) is the thing that actually
broke in production (see §3), and it's the thing to test for first on any
new implementation.

## 2. Bootstrap hardening checklist

TETA+PI's server originally worked for exactly one connected client. A
second Claude Code window, or MCP Inspector connecting while Claude Code was
already attached, got locked out with `"Server already initialized"` until
the process restarted. Root cause and fix, generalized into a checklist for
any new MCP server:

- [ ] **Session-scoped transport, not module-scoped.** A `StreamableHTTPServerTransport`
      is stateful and supports exactly one active session. Keep a
      `Map<sessionId, transport>` keyed off the SDK-assigned `Mcp-Session-Id`
      header, and create a fresh `McpServer` + transport per session on
      `initialize`. Never call `server.connect(transport)` once at module
      scope.
- [ ] **CORS on every route**, including explicit `OPTIONS` preflight
      handling. Browser-based MCP clients (Inspector's web UI, future
      client-side integrations) fail silently otherwise — the symptom is a
      bare `405` with no `Access-Control-Allow-*` header, easy to miss in
      manual testing since CLI clients don't hit it.
- [ ] **Scope routing explicitly.** Route everything that isn't
      `/health`, `/.well-known/mcp`, or `/mcp` to a real `404`. An
      unscoped fallback (`else { transport.handleRequest(...) }`) silently
      treats arbitrary paths/methods as MCP traffic — hard to detect until
      something depends on the 404 behavior.
- [ ] **Timeout every outbound call.** `client.ts`'s fetch to the backing
      API originally had no `AbortController`. An unreachable or slow
      backend hangs the tool call — and the calling agent — indefinitely,
      with no error surfaced. 10–15s via `AbortSignal.timeout()` is enough
      to fail loud instead of hanging silent.
- [ ] **Return a clean 400 for unknown/stale session IDs**, not a crash or
      silently-corrupted shared state.

These five were all found in one live E2E pass against a server that had
already been "working" for weeks in single-client testing — the bugs only
show up under realistic multi-client load. Test with at least two concurrent
clients (e.g. `claude mcp add --transport http` in one window + `npx
@modelcontextprotocol/inspector --cli` in another) before calling a server
done.

## 3. Data-contract discipline across the chain

The single most damaging bug in TETA+PI's MCP rollout: `teta_resolve_intent`
returned an entity's **slug** as `entity_id`, while every other tool in the
chain (`teta_verify_entity`, `teta_get_proof`, `teta_verify_claim`,
`teta_get_profile`) validated `id` as `z.string().uuid()` and the backing API
routes were UUID-typed path params. An agent doing exactly what the tool
descriptions told it to do — resolve, then verify the top result — got its
own second call rejected by zod with `"Invalid uuid"`. The flagship workflow
was unusable end to end for the length of time this went unnoticed, because
nothing tested step 1's output against step 2's input schema; each tool was
tested in isolation.

**Rule:** whenever a chain has more than one tool, write (and keep) one test
that calls tool 1, feeds its raw output into tool 2 unmodified, and asserts
tool 2 succeeds. Unit-testing each tool against hand-constructed fixtures
will not catch this class of bug — the fixtures will "helpfully" already be
in the right shape.

A second, quieter version of the same failure mode: a filter parameter
(`verified_only`) that the tool schema advertised as meaningful was silently
a no-op three layers down, because `undefined` and the API's "no filter"
sentinel (`"any"`) were treated as the same value by a strict-truthy check
one level below where the bug was visible. Any parameter with a "when unset,
behaves like X" default deserves an explicit test that the *other* branch
(when set) actually changes the request sent to the backend — not just that
the tool returns 200.

## 4. Tool-adding checklist

Keep this as a literal, mechanical checklist — TETA+PI's tool names are
depended on by connected agents, so drift here is a breaking change:

1. Add/extend the backend client function (typed request + response) if a
   new upstream call is needed.
2. Register the tool: `server.tool("<prefix>_<verb>", description,
   zodSchema, handler)`.
3. Add the tool to the `/.well-known/mcp` manifest's tool list and bump the
   server version.
4. If the project publishes agent-discovery metadata (`.well-known/agent.json`
   or equivalent), add the tool there too and keep it in sync with the
   manifest — these tend to drift independently because they're edited by
   different people/sessions.
5. Typecheck (`tsc --noEmit` at minimum), commit, push.
6. Verify live: hit the deployed manifest endpoint and confirm the new tool
   is listed with the version bump applied.

## 5. Pre-launch / pre-listing QA gate

Before TETA+PI's MCP server was allowed into GTM outreach or a registry
listing, the standing rule was a **live, unmocked, end-to-end pass of the
full chain** against production — not against a local dev server, not with
any backend call mocked. Concretely: create → attach data → search finds it
(via the API directly *and* via the MCP tool) → public/profile view renders
it → proof/verify tools succeed. Defects found during this pass get logged
with repro steps into a running known-issues file rather than silently
patched mid-QA-session — QA and fixing are different sessions, so a defect
found once doesn't quietly disappear if the fix turns out to be wrong.

This gate failed twice before passing clean (a search-page 404, an untyped
500 on record creation, two stuck test entities from a broken cleanup path)
— which is the point of running it live instead of trusting that
component-level tests passing means the chain works.

**Exit criterion, generalized:** all resolve/verify/profile tools pass a real
call from an actual MCP client (Claude Code remote MCP, or `npx
@modelcontextprotocol/inspector`) against the deployed server, chained
(output of one feeds the next), not just individually.

## 6. Deploy & versioning pattern

- Build: `tsc` to a `dist/` directory (not committed — gitignored, rebuilt by
  CI).
- CI rsyncs the build output + `package.json` (not the lockfile if it lives
  at a monorepo root), runs `npm install --omit=dev` on the target, restarts
  the process manager unit.
- One process manager unit per server (systemd in TETA+PI's case), fronted
  by a reverse proxy on a dedicated subdomain.
- Version is a single source of truth bumped in lockstep across:
  `package.json`, an in-code `SERVER_VERSION` constant surfaced in the
  `/.well-known/mcp` manifest, and any discovery metadata files. A bootstrap
  fix with no tool/schema change still gets a patch bump — it's cheap and it
  makes "did they get the fix" answerable from the manifest alone.

## 7. Discoverability readiness (do this even before publishing)

Prepare, but treat submission as an explicit, owner-approved step — not
something a session does automatically:

- An MCP registry manifest (`mcp/server.json`-equivalent) with a namespace
  claim path decided (DNS TXT record vs. GitHub OAuth namespace).
- A one-paragraph description, category, remote URL, and auth model ready
  for the Claude connectors directory or equivalent.
- Client setup snippets for the transports you actually support (Claude
  Code CLI, Claude Desktop config JSON, Cursor config JSON, and the raw
  Streamable HTTP contract for anything else) — write these once, keep them
  in the same doc as the tool list so they can't drift out of sync.

## 8. How this maps onto a client engagement

The starter-kit operationalizes every checklist above as scaffolding instead
of prose:

| Playbook section | Starter-kit piece |
|---|---|
| §2 bootstrap hardening | `starter-kit/src/server.ts` — session map, CORS, scoped routing, timeouts baked in, not opt-in |
| §1 + §3 chain shape | `starter-kit/src/tools.ts` — one factory that generates `resolve_/verify_/get_profile_` tools from a single adapter interface, so the three tools are structurally guaranteed to share one ID type |
| §4 tool-adding checklist | `starter-kit/README.md` "Adding an adapter" section |
| §5 QA gate | `starter-kit/README.md` "Before you ship" section — same chained-call requirement, adapted to a client's stack |
| §6 deploy pattern | `starter-kit/README.md` "Deploy" section, same build→rsync→process-manager shape |

A client integration is then: implement one `Adapter` (resolve/verify/profile
against their CRM, internal DB, or API), not a new server from scratch.

## 9. Repeatable pattern: "external system state ↔ internal-db sync"

The first genuinely deployed (not just scaffolded) integration built from
this kit is `starter-kit/src/adapters/github.ts` +
`starter-kit/src/sync/github-to-db.ts` — HELLFIRE's own GitHub org
(`HELLFIRE-Solutions`) read via the live REST API, synced into
`internal-db`'s `mcp_sync.github_state` table
(`internal-db/migrations/0009_mcp_sync_schema.sql`). Verified live
end-to-end 2026-08-28: real `initialize → tools/list → tools/call` MCP round
trip over HTTP, `github_resolve`/`github_verify`/`github_get_profile`
against real GitHub data, and `github_sync_to_db` performing a real write
confirmed by direct `SELECT` against the production database — not just a
CLI script run once, the MCP server itself does the read+sync.

This generalizes directly to any future client whose ask is "read state from
[a system we don't own] and keep our own DB/CRM in sync with it" — a very
common shape (ticketing system ↔ CRM, e-commerce orders ↔ fulfillment DB,
support inbox ↔ ticket tracker). The repeatable steps:

1. **Adapter = read side.** Implement `resolve`/`verify`/`getProfile`
   against the external system's real API (§4's checklist applies
   unchanged) — this is what an agent uses to *look up* one record on
   demand. No mock fallback if the whole point is a wired integration
   (see `github.ts`'s own comment on this) — the rest of the starter-kit's
   adapters can still ship with a mock fallback since they're templates,
   but a real client deployment's adapter for the system actually being
   integrated should fail loud without real credentials, not silently
   demo fake data.
2. **Sync = write side, kept separate from the MCP tool trio.** A plain
   function (`src/sync/<name>-to-db.ts`) that fetches a batch (not a single
   record — resolve/verify/profile are single-record by design) and
   `INSERT ... ON CONFLICT DO UPDATE`s it into the target DB. Expose it
   as one extra MCP tool (`<name>_sync_to_db`) registered directly in
   `index.ts`, alongside the generic adapter-trio registration — plus a
   `npm run sync` CLI entrypoint for cron/manual runs, same function either
   way.
3. **Own schema/table on the DB side, never an existing client-facing
   table.** `mcp_sync.github_state` here, not `crm.contractors` — an
   automated sync job and a human-entered CRM record are different kinds
   of fact with different owners; mixing them risks a sync overwriting a
   manually-verified field. Give the sync its own least-privilege scoped
   DB role (`mcp_sync_app` here), mirroring `crm_app`/`marketing_app`/
   `rag_app` (`internal-db/migrations/0007_scoped_app_roles.sql`,
   `rag-01/migrations/0002_scoped_app_role.sql`) — `CONNECT` to the
   database plus `SELECT`/`INSERT`/`UPDATE`/`DELETE` on that one schema
   only, no DDL, verified live with a cross-schema `permission denied`
   check before calling it done.
4. **Idempotent upsert, not insert-only.** Unique constraint on the
   external system's natural key (`(repo, kind, number)` here) so re-running
   the sync updates existing rows instead of duplicating them — a sync job
   runs repeatedly by nature (cron, or re-triggered by an agent), unlike a
   one-shot `submit`/`decide` flow.
5. **Verify against the live external system's real API, not a fixture** —
   this is where a stale/renamed field first shows up (e.g. this
   integration's own bug: the GitHub issues endpoint's `state` field is
   only ever open/closed, even for a merged PR — merged status needed a
   second call to the pulls endpoint, caught by re-checking the synced row
   against the actual PR instead of trusting the first successful run).
