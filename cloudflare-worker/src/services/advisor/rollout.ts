/**
 * Task #5 — Personal Advisor V2 rollout gate.
 *
 * Combines three rollout signals into a single decision the advisor
 * routes consult before serving a request:
 *
 *   1. ADVISOR_V2_DISABLED=1     — instant kill switch (Phase rollback).
 *                                  Aliased to the existing ADVISOR_DISABLED
 *                                  so a single flip disables both names.
 *   2. ADVISOR_V2_ALLOWLIST=csv  — explicit user-id allowlist (Phase 1:
 *                                  admins + a handful of dogfood users).
 *                                  Admins are always allowlisted regardless.
 *   3. ADVISOR_V2_ROLLOUT_PCT=NN — deterministic FNV-1a hash of the user
 *                                  id mapped into [0,100). Phase 2 sets
 *                                  this to 10; Phase 3 sets it to 100.
 *
 * The decision is intentionally pure (no D1 / KV / fetch) so the route
 * layer can call it on every request without latency cost. The kill
 * switch's per-user `advisor_locked` check stays in `guardrails.ts:
 * checkKillSwitch` — that's a separate concern (anomaly-driven) from
 * the staged rollout.
 */
import type { Env, User } from '../../types';

export type RolloutDecision =
  | { allowed: true; reason: 'admin' | 'allowlist' | 'percentage' | 'full' }
  | { allowed: false; reason: 'disabled' | 'not_in_phase'; message: string };

export const TEMPORARILY_UNAVAILABLE_MESSAGE =
  'The Personal Advisor is being rolled out gradually and isn\'t available for your account yet. ' +
  'Please check back soon — your other dashboard tools are unaffected.';

const DISABLED_MESSAGE =
  'The Personal Advisor is temporarily unavailable while we ship an update. ' +
  'Please try again in a few minutes.';

/** FNV-1a 32-bit hash. Deterministic across JS engines and stable
 *  across deploys — same user id → same bucket → same rollout
 *  decision. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic bucket in [0,100). */
export function userBucket(userId: number | string): number {
  return fnv1a(String(userId)) % 100;
}

function parseAllowlist(csv: string | undefined): Set<string> {
  if (!csv) return new Set();
  return new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
}

function parsePct(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function isDisabled(env: Env): boolean {
  // Either flag flips the kill switch — logical OR, NOT precedence by
  // presence. This is critical for incident response: an operator
  // setting `ADVISOR_DISABLED=1` must NOT be silently overridden by a
  // stale `ADVISOR_V2_DISABLED=0` (and vice versa).
  const e = env as unknown as { ADVISOR_V2_DISABLED?: string; ADVISOR_DISABLED?: string };
  const truthy = (v: string | undefined) => v === '1' || v === 'true';
  return truthy(e.ADVISOR_V2_DISABLED) || truthy(e.ADVISOR_DISABLED);
}

/** Parse an ISO timestamp env to epoch ms. Returns 0 on absent/invalid. */
function parseTs(v: string | undefined): number {
  if (!v) return 0;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute the rollout decision for `user`. Pure — depends only on env
 * vars + user.id + user.role + user.created_at.
 *
 * Decision order (first match wins):
 *   - DISABLED env  → blocked('disabled')
 *   - admin role    → allowed('admin')        — admins always see V2
 *   - in allowlist  → allowed('allowlist')    — Phase 1
 *   - pct >= 100    → allowed('full')         — Phase 3
 *   - bucket < pct  → allowed('percentage')   — Phase 2 (10% gate)
 *
 * Phase-2 narrowing (spec: "10% of new signups via deterministic
 * user_id hash"):
 *   When `ADVISOR_V2_NEW_SIGNUPS_AFTER` is set (ISO timestamp), the
 *   percentage gate ONLY applies to users with
 *   `created_at >= cutoff`. Pre-existing users stay on the legacy
 *   advisor until pct=100 (Phase 3) flips them in. Without the cutoff
 *   set, the percentage gate applies to all users — that's the
 *   permanent post-rollout configuration.
 */
export function rolloutDecision(env: Env, user: User): RolloutDecision {
  if (isDisabled(env)) {
    return { allowed: false, reason: 'disabled', message: DISABLED_MESSAGE };
  }
  if ((user.role || '').toLowerCase() === 'admin') {
    return { allowed: true, reason: 'admin' };
  }
  const e = env as unknown as {
    ADVISOR_V2_ALLOWLIST?: string;
    ADVISOR_V2_ROLLOUT_PCT?: string;
    ADVISOR_V2_NEW_SIGNUPS_AFTER?: string;
  };
  const allow = parseAllowlist(e.ADVISOR_V2_ALLOWLIST);
  if (allow.has(String(user.id))) {
    return { allowed: true, reason: 'allowlist' };
  }
  const pct = parsePct(e.ADVISOR_V2_ROLLOUT_PCT);
  if (pct >= 100) return { allowed: true, reason: 'full' };
  if (pct <= 0) {
    return { allowed: false, reason: 'not_in_phase', message: TEMPORARILY_UNAVAILABLE_MESSAGE };
  }
  // Phase-2 "new signups only" narrowing: when the cutoff env is set,
  // the percentage gate only applies to users created on/after the
  // cutoff. Pre-existing users wait for Phase 3 (pct=100).
  const cutoff = parseTs(e.ADVISOR_V2_NEW_SIGNUPS_AFTER);
  if (cutoff > 0) {
    const created = parseTs(user.created_at);
    if (!created || created < cutoff) {
      return { allowed: false, reason: 'not_in_phase', message: TEMPORARILY_UNAVAILABLE_MESSAGE };
    }
  }
  if (userBucket(user.id) < pct) {
    return { allowed: true, reason: 'percentage' };
  }
  return { allowed: false, reason: 'not_in_phase', message: TEMPORARILY_UNAVAILABLE_MESSAGE };
}
