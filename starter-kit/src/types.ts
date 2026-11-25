/**
 * The resolve → verify → profile contract (playbook §1, §3).
 *
 * `id` is `string` everywhere on purpose and must be the SAME identifier a
 * caller can round-trip through all three methods unmodified. TETA+PI's
 * worst production MCP bug was `resolve` returning a slug while `verify`/
 * `getProfile` required a UUID — two different "identifiers" for the same
 * record, discovered only when an agent chained the calls for real. Do not
 * introduce a second identifier type (e.g. a display slug) into this
 * interface without also updating `resolve` to return the same type the
 * other two methods accept.
 */

export interface ResolveResult {
  id: string;
  label: string;
  /** Relevance score, if the source ranks results (0–1 or source-native scale). */
  score?: number;
  summary?: string;
}

export interface VerifyResult {
  id: string;
  verified: boolean;
  /** Free-form verification level/tier, source-specific (e.g. "registry", "manual", "unverified"). */
  level?: string;
  /** Set when `claim` was passed to `verify` and evaluated against the record. */
  claimChecked?: string;
  details?: Record<string, unknown>;
}

export interface ProfileResult {
  id: string;
  label: string;
  fields: Record<string, unknown>;
}

export interface Adapter {
  /** Tool name prefix, e.g. "crm", "internal_db", "api". Lowercase, no spaces. */
  name: string;
  description: string;
  resolve(query: string, limit?: number): Promise<ResolveResult[]>;
  verify(id: string, claim?: string): Promise<VerifyResult>;
  getProfile(id: string): Promise<ProfileResult>;
}
