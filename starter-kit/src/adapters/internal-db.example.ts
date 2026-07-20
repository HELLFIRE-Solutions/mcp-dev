import { Adapter, ProfileResult, ResolveResult, VerifyResult } from "../types.js";

/**
 * Example internal-database adapter — client's own Postgres (or similar)
 * holding records like clients/contracts/work orders. This example ships
 * with an in-memory table so the starter-kit runs with zero setup; swap
 * the three functions below for real `pg` queries against a `Pool`:
 *
 *   import { Pool } from "pg";
 *   const pool = new Pool({ connectionString: process.env.INTERNAL_DB_URL });
 *   const { rows } = await pool.query(
 *     "SELECT id, name, status FROM records WHERE name ILIKE $1 LIMIT $2",
 *     [`%${query}%`, limit]
 *   );
 *
 * Keep the same `id` type (string) that `resolve` returns flowing into
 * `verify`/`getProfile` unmodified — e.g. don't `SELECT id::text AS id` in
 * one query and return a numeric id from another (playbook §3).
 */

interface DbRecord {
  id: string;
  name: string;
  type: string;
  status: "active" | "pending" | "closed";
  owner: string;
}

const MOCK_RECORDS: DbRecord[] = [
  { id: "rec-001", name: "Acme GmbH — implementation contract", type: "contract", status: "active", owner: "bob" },
  { id: "rec-002", name: "Nordwind AG — onboarding", type: "contract", status: "pending", owner: "bob" },
  { id: "rec-003", name: "Contractor: J. Müller", type: "contractor", status: "active", owner: "bob" },
];

export function createInternalDbAdapter(): Adapter {
  return {
    name: "internal_db",
    description: "internal database records (clients/contracts/contractors — example: in-memory, swap for Postgres)",

    async resolve(query, limit = 10): Promise<ResolveResult[]> {
      const q = query.toLowerCase();
      return MOCK_RECORDS.filter((r) => r.name.toLowerCase().includes(q) || r.type.includes(q))
        .slice(0, limit)
        .map((r) => ({ id: r.id, label: r.name, summary: `${r.type} — ${r.status}` }));
    },

    async verify(id, claim): Promise<VerifyResult> {
      const record = MOCK_RECORDS.find((r) => r.id === id);
      if (!record) return { id, verified: false, level: "not_found" };
      const claimChecked = claim;
      const verified = claim ? record.status === claim : record.status === "active";
      return { id, verified, level: record.status, claimChecked, details: { owner: record.owner } };
    },

    async getProfile(id): Promise<ProfileResult> {
      const record = MOCK_RECORDS.find((r) => r.id === id);
      if (!record) throw new Error(`record ${id} not found`);
      return { id: record.id, label: record.name, fields: { ...record } };
    },
  };
}
