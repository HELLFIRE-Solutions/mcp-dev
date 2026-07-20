# HELLFIRE AI Solutions — AI MCP Dev

Модуль 9. Використання наявного досвіду з MCP-серверів TETA+PI (resolve→verify→profile ланцюг), задокументованого як repeatable playbook.

**Етап 1 — playbook: ✅ готово.** [`docs/playbook.md`](docs/playbook.md) — процес, чек-листи (bootstrap hardening, tool-adding, pre-launch QA gate) і реальні інциденти з продакшн MCP-сервера TETA+PI (`mcp.tetapi.dev`), а не гіпотетичні best practices.

**Етап 2 — starter-kit: ✅ готово.** [`starter-kit/`](starter-kit) — генерик MCP TypeScript сервер з hardened bootstrap (session-per-client transport, CORS, scoped routing, timeouts) і pluggable adapter-інтерфейсом (`resolve`/`verify`/`getProfile`) з прикладами під CRM, внутрішню базу та generic API. Деталі й "Adding an adapter" чек-лист: [`starter-kit/README.md`](starter-kit/README.md).

**Ліцензія:** MIT.
