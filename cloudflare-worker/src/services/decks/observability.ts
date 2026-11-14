/**
 * D1510 (#3761, deck v2 A17): what deck generation costs and whether The Grid
 * is used. Four parts, no migration.
 *
 * THE CEILING'S REACH. D1540 (#3791) built the owner's daily ceiling
 * (`DECK_DAILY_CEILING_MICROUSD`, `runQuotes.ceilingRefusal`) on `/outline`,
 * `/generate` and card regeneration. `deckCeilingRefusal` is the same check
 * for every other generation path, before any hold: `admitDeckRun` (area runs,
 * the whole-deck build, a retry, and any autopilot run, since a run starts
 * nowhere else), the image routes and card assist. Every one of them logs
 * under the Pitch deck page, so the day's spend is one sum. Unset is off: the
 * ceiling reads "Not set", never a guessed figure.
 *
 * HQ ALERTS. When the day's settled spend first reaches 50% and then 80% of
 * the ceiling, every active HQ administrator gets one in-app notice and one
 * email naming the amounts only. Each threshold is claimed once per UTC day in
 * `job_idempotency` (key `deck-ceiling-alert:<day>:<pct>`), so two runs
 * settling together send it once; a jump past both sends only the 80% one.
 *
 * ANALYTICS ENGINE. One point per finished run (`runPoint`, written by the
 * driver that closed it) and one per funnel event (`funnelPoint`). Both carry
 * ids and codes only: no title, prompt, words or figure a founder wrote.
 *
 * THE ACCEPT RATE. `acceptRates` reads A3's proposal rows (#3764, D1512) per
 * element and model: accepted (Accept or Accept all) over decided (accepted,
 * discarded, superseded or expired), with the seconds to the first result.
 */
import type { Env } from '../../types';
import { branchOf } from '../../util/branch';
import { GRID_PAGE } from './elementModels';
import { CEILING_REACHED, chargedToday, ceilingRefusal, dailyCeiling } from './runQuotes';

export { CEILING_REACHED };

/** The thresholds HQ is told about, in percent of the ceiling. */
export const ALERT_THRESHOLDS = [50, 80] as const;
export type AlertThreshold = typeof ALERT_THRESHOLDS[number];

/** The ceiling's refusal for a deck generation run that may charge `nextMicrousd`, or null when it may go on. */
export function deckCeilingRefusal(env: Env, nextMicrousd: number) {
  return ceilingRefusal(env, GRID_PAGE, nextMicrousd);
}

export type CeilingState = {
  /** The owner's figure, or null when it is not set ("Not set"). */
  ceiling_microusd: number | null;
  /** Today's settled deck spend (UTC), or null when it could not be read. */
  spent_today_microusd: number | null;
  /** Spent over the ceiling, as a whole percent; null when either is unknown. */
  percent: number | null;
  paused: boolean;
};

/** Where the ceiling stands today. A spend that cannot be read is null, never 0. */
export async function ceilingState(env: Env): Promise<CeilingState> {
  const ceiling = dailyCeiling(env);
  let spent: number | null = null;
  try { spent = await chargedToday(env, GRID_PAGE); } catch { spent = null; }
  const percent = ceiling != null && spent != null ? Math.floor((spent * 100) / ceiling) : null;
  // Once set, a spend that cannot be read pauses generation (the ceiling fails closed).
  const paused = ceiling != null && (spent == null || spent >= ceiling);
  return { ceiling_microusd: ceiling, spent_today_microusd: spent, percent, paused };
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;
const today = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Tells HQ the first time today's deck spend reaches 50% and 80% of the
 * ceiling. Returns the threshold sent, or null. Best effort: the caller never
 * fails a run on it.
 */
export async function noteCeilingAlerts(env: Env, now = new Date()): Promise<AlertThreshold | null> {
  const ceiling = dailyCeiling(env);
  if (ceiling == null) return null;
  const spent = await chargedToday(env, GRID_PAGE);
  const passed = ALERT_THRESHOLDS.filter((t) => spent * 100 >= ceiling * t);
  if (!passed.length) return null;
  const day = today(now);
  const fresh: AlertThreshold[] = [];
  // The lower ones passed with it are claimed too, unsent, so they never fire later today.
  for (const t of passed) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO job_idempotency (idempotency_key) VALUES (?)').bind(`deck-ceiling-alert:${day}:${t}`).run();
    if (Number(r.meta?.changes) === 1) fresh.push(t);
  }
  const top = fresh.length ? fresh[fresh.length - 1] : null;
  if (top == null) return null;
  const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all<{ id: number }>();
  const { notify } = await import('../notify');
  for (const a of admins.results || []) {
    await notify(env, {
      userId: Number(a.id), type: 'deck_ceiling_alert', category: 'billing', channels: ['in_app', 'email'],
      title: `Deck generation has used ${top}% of today's ceiling`,
      body: `${usd(spent)} of ${usd(ceiling)} charged today (UTC). At the ceiling, generation pauses until tomorrow; manual editing still works.`,
      link: '/admin/ai',
      payload: { threshold: top, day, ceiling_microusd: ceiling, spent_microusd: spent },
    });
  }
  return top;
}

// ─────────────────────────────────────────────────────────── analytics engine

/** The funnel's steps: the editor's path (structure change to share) and the one-click path (Build, Accept all, Accept all and present). */
export const FUNNEL_EVENTS = ['structure_change', 'share', 'build', 'accept_all', 'accept_all_present'] as const;
export type FunnelEvent = typeof FUNNEL_EVENTS[number];

/**
 * The dataset's layout (D161, D209), shared with the request row
 * (`middleware/observability.ts`) and the branch-action mirror
 * (`services/auditMirror.ts`): blob1 is the row's kind, never a path, so the
 * traffic readers (`blob1 LIKE '/%'`) never count these rows as requests; blob6
 * is the branch, `branchOf(env)` or 'hq'. Slots 7 on are this row's own.
 */
export const RUN_KIND = 'deck:run';
export const FUNNEL_KIND = 'deck:funnel';

const id = (x: number | string | null | undefined) => (x == null ? '' : String(x).slice(0, 96));

/** Writes one point; false when the binding is absent or the write fails. A metric never fails a request. */
function write(env: Env, kind: string, slots: [string, string, string, string], own: string[], doubles: number[]): boolean {
  try {
    const ae = env.ANALYTICS;
    if (!ae || typeof ae.writeDataPoint !== 'function') return false;
    ae.writeDataPoint({ indexes: [kind], blobs: [kind, ...slots, branchOf(env) || 'hq', ...own], doubles });
    return true;
  } catch { return false; }
}

/** One funnel event: its name, the deck, the venture and the proposal, by id. Nothing a founder wrote. */
export function funnelPoint(env: Env, event: FunnelEvent, at: { deckId?: number | null; projectId?: number | null; proposalId?: number | null; oneClick?: boolean }): boolean {
  return write(env, FUNNEL_KIND, [event, id(at.deckId), id(at.projectId), id(at.proposalId)], [at.oneClick ? 'one_click' : ''], [1]);
}

export type RunPointInput = {
  uid: string; deck_id: number; project_id: number; class: string; runtime?: string | null; state: string;
  quote_microusd: number; charged_microusd: number; steps: number; done: number; failed: number; seconds: number | null;
};

/** One point per finished run: its class, how it ended, its hold and charge, its steps and how long it took. */
export function runPoint(env: Env, r: RunPointInput): boolean {
  return write(env, RUN_KIND, [r.class, r.state, r.runtime ?? 'do', id(r.uid)], [id(r.deck_id), id(r.project_id)],
    [r.quote_microusd, r.charged_microusd, r.steps, r.done, r.failed, r.seconds ?? -1]);
}

// ─────────────────────────────────────────────────────────── the accept rate

export type AcceptRate = {
  element: string;
  /** The model the area ran on, or null for a records element (no model). */
  model: string | null;
  proposals: number;
  decided: number;
  accepted: number;
  accepted_all: number;
  discarded: number;
  regenerated: number;
  /** accepted / decided, or null when nothing was decided yet. */
  accept_rate: number | null;
  /** Mean seconds from the run's admission to the area's first finished step, or null when none is recorded. */
  first_result_seconds: number | null;
};

export const ACCEPT_WINDOW_MAX_DAYS = 365;

/** The accept rate per element and model over the last `days` days of proposals (A3's rows). */
export async function acceptRates(env: Env, days = 30): Promise<AcceptRate[]> {
  const window = Math.min(ACCEPT_WINDOW_MAX_DAYS, Math.max(1, Math.floor(Number(days) || 30)));
  const rows = await env.DB.prepare(
    `SELECT p.element AS element,
            (SELECT COALESCE(s.model_used, s.model) FROM deck_area_batch_steps s
              WHERE s.batch_uid = p.batch_uid AND s.card_uid = p.card_uid AND s.area_id = p.area_id ORDER BY s.seq LIMIT 1) AS model,
            p.outcome AS outcome, p.regenerated_from AS regenerated_from,
            (SELECT (julianday(MIN(s.ended_at)) - julianday(b.created_at)) * 86400.0 FROM deck_area_batch_steps s, deck_area_batches b
              WHERE s.batch_uid = p.batch_uid AND s.card_uid = p.card_uid AND s.area_id = p.area_id AND s.state = 'done' AND b.uid = p.batch_uid) AS first_seconds
       FROM deck_area_proposals p
      WHERE datetime(p.created_at) >= datetime('now', ?)`,
  ).bind(`-${window} days`).all<{ element: string; model: string | null; outcome: string | null; regenerated_from: string | null; first_seconds: number | null }>();
  const groups = new Map<string, AcceptRate & { _secs: number[] }>();
  for (const r of rows.results || []) {
    const model = r.model ?? null;
    const key = `${r.element}\u0000${model ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = { element: r.element, model, proposals: 0, decided: 0, accepted: 0, accepted_all: 0, discarded: 0, regenerated: 0, accept_rate: null, first_result_seconds: null, _secs: [] };
      groups.set(key, g);
    }
    g.proposals += 1;
    if (r.regenerated_from) g.regenerated += 1;
    if (r.outcome) g.decided += 1;
    if (r.outcome === 'accept' || r.outcome === 'accept_all') g.accepted += 1;
    if (r.outcome === 'accept_all') g.accepted_all += 1;
    if (r.outcome === 'discard') g.discarded += 1;
    const s = r.first_seconds == null ? NaN : Number(r.first_seconds);
    if (Number.isFinite(s) && s >= 0) g._secs.push(s);
  }
  return [...groups.values()]
    .map(({ _secs, ...g }) => ({
      ...g,
      accept_rate: g.decided ? g.accepted / g.decided : null,
      first_result_seconds: _secs.length ? Math.round((_secs.reduce((a, b) => a + b, 0) / _secs.length) * 10) / 10 : null,
    }))
    .sort((a, b) => a.element.localeCompare(b.element) || String(a.model ?? '').localeCompare(String(b.model ?? '')));
}

/**
 * Whether a save changes the structure of a card it already had (the editor
 * funnel's first step). Cards are matched by their uid, else their place; a
 * card added or removed is not a structure change.
 */
export function structuresChanged(prior: unknown[], next: unknown[]): boolean {
  const keyOf = (s: any, i: number) => (typeof s?.uid === 'string' && s.uid ? `u:${s.uid}` : `i:${i}`);
  const structureOf = (s: any) => (typeof s?.structure === 'string' && s.structure ? s.structure : null);
  const before = new Map<string, string | null>();
  (Array.isArray(prior) ? prior : []).forEach((s, i) => before.set(keyOf(s, i), structureOf(s)));
  return (Array.isArray(next) ? next : []).some((s, i) => {
    const k = keyOf(s, i);
    return before.has(k) && before.get(k) !== structureOf(s);
  });
}
