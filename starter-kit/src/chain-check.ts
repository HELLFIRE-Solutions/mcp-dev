import { createCrmAdapter } from "./adapters/crm.example.js";
import { createInternalDbAdapter } from "./adapters/internal-db.example.js";
import { createApiAdapter } from "./adapters/api.example.js";
import { Adapter } from "./types.js";

/**
 * Playbook §3's rule, made executable: call resolve, feed its raw output
 * into verify and getProfile UNMODIFIED, and assert both succeed. This is
 * the exact test that would have caught TETA+PI's slug/UUID mismatch —
 * per-tool unit tests with hand-built fixtures did not, because the
 * fixtures were already in the right shape.
 *
 * Run against every adapter before shipping a new one:
 *   npm run build && node dist/chain-check.js
 */

async function checkAdapter(adapter: Adapter, query: string): Promise<void> {
  const label = adapter.name;
  const resolved = await adapter.resolve(query, 5);
  if (resolved.length === 0) {
    throw new Error(`[${label}] resolve("${query}") returned no results — pick a query that matches the fixture/live data`);
  }

  for (const { id } of resolved) {
    // Deliberately do NOT reshape `id` here — that's the point of the test.
    const verified = await adapter.verify(id);
    if (verified.id !== id) {
      throw new Error(`[${label}] verify() returned a different id than resolve() gave it: ${verified.id} !== ${id}`);
    }

    const profile = await adapter.getProfile(id);
    if (profile.id !== id) {
      throw new Error(`[${label}] getProfile() returned a different id than resolve() gave it: ${profile.id} !== ${id}`);
    }
  }

  console.log(`[${label}] OK — ${resolved.length} result(s) chained through resolve -> verify -> getProfile`);
}

async function main() {
  const checks: [Adapter, string][] = [
    [createCrmAdapter(), "ada"],
    [createInternalDbAdapter(), "acme"],
    [createApiAdapter(), "widget"],
  ];

  let failed = false;
  for (const [adapter, query] of checks) {
    try {
      await checkAdapter(adapter, query);
    } catch (err) {
      failed = true;
      console.error((err as Error).message);
    }
  }

  if (failed) {
    console.error("\nchain-check FAILED");
    process.exit(1);
  }
  console.log("\nchain-check passed for all adapters");
}

main();
