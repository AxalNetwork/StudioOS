/**
 * D1540 (#3791, deck v2 B15) — New deck's pinned quotes and the owner's daily
 * ceiling on deck generation.
 *
 * PINNED QUOTES. `POST /api/decks/new/quote` stores what it showed
 * (`deck_run_quotes`, migration 733): the hold, the price list it was made
 * under (`pricingVersion`) and a hash of the run it priced. The build or the
 * outline that names the quote (`quote_uid`) takes it once (`takeQuote`) and
 * runs with `pinMicrousd`, so it settles at no more than the quoted price even
 * when prices change between the quote and the settlement. A quote is for one
 * member, one venture, one step and one run: a quote for another run (other
 * cards, other words, another model) is refused as `quote_stale`, so a small
 * quote can never cap a larger run.
 *
 * THE DAILY CEILING (owner decision AA = A, 2026-11-01). One figure the owner
 * sets, `DECK_DAILY_CEILING_MICROUSD`: what deck generation may charge across
 * every member in one UTC day. Unset, empty, 0 or unreadable is off (no
 * ceiling), so nothing pauses until the owner sets it. #3761 (A17, D1510)
 * owns the ceiling's alerts and its reach over area and autopilot runs; it
 * reads this same figure and `ceilingRefusal`, so the ceiling is built once.
 * The refusal comes before any hold, so a paused run charges nothing.
 */
import type { Env } from '../../types';
import { pricingVersion } from '../ai/pricing';
import type { RunOptions } from '../aiRouter';

/** A quote holds its price this long. */
export const QUOTE_TTL_MINUTES = 120;

export type QuoteStep = 'outline' | 'build';

/** The per-message nonce on the untrusted-record fences (`BEGIN_<KIND>_UNTRUSTED_<id>`, `ai/untrusted.ts`), which no two messages share. */
const FENCE_NONCE = /((?:BEGIN|END)_[A-Z_]+?_UNTRUSTED)_[0-9a-f]+/g;

/**
 * The run a quote priced, as one hash: its task, model, words and output
 * allowance. The fences' nonces are left out, so the same run hashes the same
 * at the quote and at the build; the words inside them are kept.
 */
export async function runHash(opts: RunOptions): Promise<string> {
  const material = JSON.stringify({
    task: opts.task, model: opts.model ?? null, option: opts.rail?.option ?? null, record: opts.rail?.record ?? null,
    system: opts.systemPrompt ?? null, messages: opts.messages ?? [], max: opts.maxTokens ?? null,
  }).replace(FENCE_NONCE, '$1');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material)));
  return Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Stores the quote New deck showed; its uid, or null when it could not be written (the quote is then unpinned). */
export async function pinQuote(env: Env, q: { userId: number; projectId: number; step: QuoteStep; holdMicrousd: number; model: string | null; opts: RunOptions }):
  Promise<{ uid: string; pricing_version: string } | null> {
  if (!(q.userId > 0) || !Number.isSafeInteger(q.holdMicrousd) || q.holdMicrousd < 0) return null;
  const uid = `dq_${crypto.randomUUID().replace(/-/g, '')}`;
  const version = pricingVersion(env);
  try {
    await env.DB.prepare(
      `INSERT INTO deck_run_quotes (uid, user_id, project_id, step, hold_microusd, pricing_version, input_hash, model, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    ).bind(uid, q.userId, q.projectId, q.step, q.holdMicrousd, version, await runHash(q.opts), q.model, `+${QUOTE_TTL_MINUTES} minutes`).run();
    return { uid, pricing_version: version };
  } catch (e) {
    console.warn('[deck_quotes] quote not pinned', String((e as Error)?.message || e).slice(0, 120));
    return null;
  }
}

export interface TakenQuote { uid: string; hold_microusd: number; pricing_version: string }

export const QUOTE_STALE = 'The price shown is no longer held: it was used, it lapsed, or the deck changed since. Here is the price now; press Build again.';

/**
 * Takes the member's quote for this run, once. `stale` when it is not theirs,
 * not this venture's or step's, lapsed, already used, or priced another run.
 * The take is one conditional write, so two presses cannot both use it.
 */
export async function takeQuote(env: Env, uid: unknown, k: { userId: number; projectId: number; step: QuoteStep; opts: RunOptions }):
  Promise<{ quote: TakenQuote } | { stale: true }> {
  if (typeof uid !== 'string' || !/^dq_[0-9a-f]{32}$/.test(uid)) return { stale: true };
  const row = await env.DB.prepare(
    `UPDATE deck_run_quotes SET used_at = datetime('now')
      WHERE uid = ? AND user_id = ? AND project_id = ? AND step = ? AND input_hash = ?
        AND used_at IS NULL AND datetime(expires_at) > datetime('now')
      RETURNING uid, hold_microusd, pricing_version`,
  ).bind(uid, k.userId, k.projectId, k.step, await runHash(k.opts)).first<{ uid: string; hold_microusd: number; pricing_version: string }>().catch(() => null);
  if (!row || !Number.isSafeInteger(Number(row.hold_microusd))) return { stale: true };
  return { quote: { uid: row.uid, hold_microusd: Number(row.hold_microusd), pricing_version: String(row.pricing_version) } };
}

/** A quote a run did not use (refused before its hold): it may price the next press. */
export async function returnQuote(env: Env, uid: string): Promise<void> {
  await env.DB.prepare('UPDATE deck_run_quotes SET used_at = NULL WHERE uid = ?').bind(uid).run().catch(() => undefined);
}

// ─────────────────────────────────────────────────────────── the daily ceiling

export const CEILING_REACHED = 'Generation is paused for today. Manual editing still works.';

/** The owner's ceiling in micro-USD, or null when none is set (off). */
export function dailyCeiling(env: Env): number | null {
  const raw: unknown = env.DECK_DAILY_CEILING_MICROUSD;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(String(raw).trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** What deck generation has charged today (UTC), across every member: the Pitch deck page's settled runs. */
export async function chargedToday(env: Env, page: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(charged_microusd), 0) AS spent FROM ai_usage_logs
      WHERE rail_page = ? AND charged_microusd > 0 AND datetime(created_at) >= datetime('now', 'start of day')`,
  ).bind(page).first<{ spent: number }>();
  const spent = Number(row?.spent ?? 0);
  if (!Number.isFinite(spent) || spent < 0) throw new Error('deck spend unreadable');
  return spent;
}

/**
 * Null when the run may go ahead; otherwise why not. A run is refused when
 * today's deck spend plus what it may charge (`nextMicrousd`) would pass the
 * ceiling. A spend that cannot be read pauses generation too: the ceiling
 * fails closed once the owner has set it.
 */
export async function ceilingRefusal(env: Env, page: string, nextMicrousd: number): Promise<{ code: 'deck_ceiling_reached'; message: string } | null> {
  const ceiling = dailyCeiling(env);
  if (ceiling == null) return null;
  let spent: number;
  try { spent = await chargedToday(env, page); } catch { return { code: 'deck_ceiling_reached', message: CEILING_REACHED }; }
  return spent + Math.max(0, nextMicrousd || 0) > ceiling ? { code: 'deck_ceiling_reached', message: CEILING_REACHED } : null;
}
