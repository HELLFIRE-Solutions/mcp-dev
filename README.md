# HELLFIRE AI Solutions — AI MCP Dev

Module 9. Reuses TETA+PI's MCP-server experience (resolve→verify→profile chain), documented as a repeatable playbook.

**Stage 1 — playbook: ✅ done.** [`docs/playbook.md`](docs/playbook.md) — process, checklists (bootstrap hardening, tool-adding, pre-launch QA gate), and real incidents from TETA+PI's production MCP server (`mcp.tetapi.dev`), not hypothetical best practices.

**Stage 2 — starter-kit: ✅ done.** [`starter-kit/`](starter-kit) — a generic MCP TypeScript server with a hardened bootstrap (session-per-client transport, CORS, scoped routing, timeouts) and a pluggable adapter interface (`resolve`/`verify`/`getProfile`) with examples for CRM, an internal DB, and a generic API. Details and the "Adding an adapter" checklist: [`starter-kit/README.md`](starter-kit/README.md).

**License:** MIT.
