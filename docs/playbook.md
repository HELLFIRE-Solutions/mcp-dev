# The resolve → verify → profile playbook

Distilled from building and hardening TETA+PI's production MCP server
(`mcp.tetapi.dev`, TypeScript, `@modelcontextprotocol/sdk`, versions 1.2.0 →
1.4.0). This is a process document, not a code dump — it captures what broke,
why, and the checklist that prevents it from breaking the same way twice. The
generic starter-kit in [`starter-kit/`](../starter-kit) is this playbook
turned into runnable scaffolding.

Source material: TETA+PI's `docs/mcp.md`, `docs/roadmap.md` (items 1.12,
1.13, 2.1–2.7, 6.2), and `docs/known-issues.md` (findings #2, #5, #16, #17),
local at `/Users/bobbob/BOB/SERVER/TETA+PI/`. Every incident below is a real,
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
