import { Adapter, ProfileResult, ResolveResult, VerifyResult } from "../types.js";
import { withTimeout } from "../server.js";

/**
 * Example generic-API adapter — any REST API with API-key auth and a
 * search + get-by-id shape (e.g. a client's product catalog, inventory
 * system, or internal microservice). Runs against an in-memory dataset
 * with no `baseUrl`/`apiKey` configured; wire real endpoints for a client
 * integration.
 */

interface ApiConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

const MOCK_RESOURCES = [
  { id: "res-1", name: "Widget A", sku: "WA-100", inStock: true },
  { id: "res-2", name: "Widget B", sku: "WB-200", inStock: false },
  { id: "res-3", name: "Gadget C", sku: "GC-300", inStock: true },
];

export function createApiAdapter(config: ApiConfig = {}): Adapter {
  const timeoutMs = config.timeoutMs ?? 10_000;
  const live = Boolean(config.baseUrl && config.apiKey);

  async function fetchJson(path: string): Promise<unknown> {
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { "X-Api-Key": config.apiKey ?? "" },
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return {
    name: "api",
    description: "client REST API resources (generic — example: in-memory, swap baseUrl/apiKey for the real API)",

    async resolve(query, limit = 10): Promise<ResolveResult[]> {
      if (!live) {
        const q = query.toLowerCase();
        return MOCK_RESOURCES.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
          .slice(0, limit)
          .map((r) => ({ id: r.id, label: r.name, summary: r.sku }));
      }
      const data = (await withTimeout(
        fetchJson(`/resources?q=${encodeURIComponent(query)}&limit=${limit}`),
        timeoutMs,
        "api_resolve"
      )) as { id: string; name: string; sku?: string }[];
      return data.map((r) => ({ id: r.id, label: r.name, summary: r.sku }));
    },

    async verify(id, claim): Promise<VerifyResult> {
      if (!live) {
        const resource = MOCK_RESOURCES.find((r) => r.id === id);
        if (!resource) return { id, verified: false, level: "not_found" };
        const claimChecked = claim;
        const verified = claim === "in_stock" ? resource.inStock : Boolean(resource);
        return { id, verified, level: resource.inStock ? "in_stock" : "out_of_stock", claimChecked };
      }
      const data = (await withTimeout(fetchJson(`/resources/${id}`), timeoutMs, "api_verify")) as {
        id: string;
        inStock?: boolean;
      };
      return { id: data.id, verified: Boolean(data.inStock), level: data.inStock ? "in_stock" : "out_of_stock" };
    },

    async getProfile(id): Promise<ProfileResult> {
      if (!live) {
        const resource = MOCK_RESOURCES.find((r) => r.id === id);
        if (!resource) throw new Error(`resource ${id} not found`);
        return { id: resource.id, label: resource.name, fields: { ...resource } };
      }
      const data = (await withTimeout(fetchJson(`/resources/${id}`), timeoutMs, "api_get_profile")) as Record<
        string,
        unknown
      > & { id: string; name: string };
      return { id: data.id, label: data.name, fields: data };
    },
  };
}
