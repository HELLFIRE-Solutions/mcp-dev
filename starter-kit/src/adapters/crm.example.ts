import { Adapter, ProfileResult, ResolveResult, VerifyResult } from "../types.js";
import { withTimeout } from "../server.js";

/**
 * Example CRM adapter — generic REST contacts API shape (HubSpot/Pipedrive-
 * style: GET /contacts/search, GET /contacts/{id}). Swap `baseUrl`/`apiKey`
 * for a real portal and the two `fetch` calls below become live; until then
 * this runs against a small in-memory dataset so the starter-kit works
 * out of the box with no credentials.
 *
 * Timeout on every outbound call per playbook §2 — a hung CRM API must not
 * hang the calling agent's tool call.
 */

interface CrmConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

const MOCK_CONTACTS = [
  { id: "contact-1001", name: "Ada Lovelace", email: "ada@example.com", company: "Analytical Engines Ltd", status: "customer" },
  { id: "contact-1002", name: "Grace Hopper", email: "grace@example.com", company: "COBOL Systems", status: "lead" },
  { id: "contact-1003", name: "Alan Turing", email: "alan@example.com", company: "Bletchley Consulting", status: "customer" },
];

export function createCrmAdapter(config: CrmConfig = {}): Adapter {
  const timeoutMs = config.timeoutMs ?? 10_000;
  const live = Boolean(config.baseUrl && config.apiKey);

  async function fetchJson(path: string): Promise<unknown> {
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`CRM API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return {
    name: "crm",
    description: "client CRM contacts (generic REST — HubSpot/Pipedrive-shaped)",

    async resolve(query, limit = 10): Promise<ResolveResult[]> {
      if (!live) {
        const q = query.toLowerCase();
        return MOCK_CONTACTS.filter(
          (c) => c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.email.includes(q)
        )
          .slice(0, limit)
          .map((c) => ({ id: c.id, label: c.name, summary: `${c.company} — ${c.status}` }));
      }
      const data = (await withTimeout(
        fetchJson(`/contacts/search?q=${encodeURIComponent(query)}&limit=${limit}`),
        timeoutMs,
        "crm_resolve"
      )) as { results: { id: string; name: string; company?: string }[] };
      return data.results.map((r) => ({ id: r.id, label: r.name, summary: r.company }));
    },

    async verify(id, claim): Promise<VerifyResult> {
      if (!live) {
        const contact = MOCK_CONTACTS.find((c) => c.id === id);
        if (!contact) return { id, verified: false, level: "not_found" };
        const claimChecked = claim;
        const verified = claim ? contact.status.includes(claim.toLowerCase()) : true;
        return { id, verified, level: contact.status, claimChecked, details: { email: contact.email } };
      }
      const data = (await withTimeout(fetchJson(`/contacts/${id}`), timeoutMs, "crm_verify")) as {
        id: string;
        status?: string;
      };
      return { id: data.id, verified: Boolean(data.status), level: data.status };
    },

    async getProfile(id): Promise<ProfileResult> {
      if (!live) {
        const contact = MOCK_CONTACTS.find((c) => c.id === id);
        if (!contact) throw new Error(`contact ${id} not found`);
        return { id: contact.id, label: contact.name, fields: { ...contact } };
      }
      const data = (await withTimeout(fetchJson(`/contacts/${id}`), timeoutMs, "crm_get_profile")) as Record<
        string,
        unknown
      > & { id: string; name: string };
      return { id: data.id, label: data.name, fields: data };
    },
  };
}
