/**
 * D1543 (#3781) — what a save refuses: a gated block the venture's records
 * do not allow. Called by every path that persists a card the founder sent
 * (`PUT /api/decks/:id` in `routes/decks.ts`, and the working copy's
 * `PATCH /api/decks/:id/cards/:uid` in `routes/deck_draft.ts`), after the
 * cards are sanitized and before anything is written.
 *
 *   no_permission  a block carrying a `logo_key` that is not a permitted row
 *                  of this venture's `deck_logos` (migration 732);
 *   no_consent     an `interview_quote` block whose `session_uid` is not a
 *                  session with a quotable line, under the same clause as
 *                  `quoteRetrieval.quotableLines` (recorded consent, consent
 *                  to quote, the final transcript, the interviewee's own line,
 *                  this venture). `save_gates_d1543` holds the two clauses
 *                  equal.
 *
 *   brand_locked   D1572 (#3819): while the venture's palette is locked in
 *                  its brand kit (`deck_brand_locks`), a card colour — a
 *                  background, a run's accent, any `color`/`accent`/`fill` a
 *                  block holds — that is neither one of the kit's palette
 *                  roles nor already on the version being saved over
 *                  (`opts.prior`). "This colour is locked in the brand kit by
 *                  [name]. Nothing changed." (`brandLocks.lockedLine`, held
 *                  equal by `brand_locks_d1572`).
 *
 * A save with no such block reads nothing. A read that fails refuses: a gate
 * that cannot be checked does not pass. Imports nothing, so `routes/decks.ts`
 * takes on no module graph (D752).
 */
import type { Env } from '../../types';

export const CONSENT_LINE = 'Only quotes from sessions with recorded consent can be used.';
export const permissionLine = (customer: string) => `${customer} hasn't given permission to show their logo.`;

export type SaveGateRefusal = { code: 'no_permission' | 'no_consent' | 'brand_locked'; message: string };

const HEX = /^#[0-9a-f]{6}$/i;
const COLOUR_KEYS = new Set(['color', 'accent', 'fill', 'colour']);

/** Every #rrggbb a card holds under a colour key, lower-cased. */
export function cardColours(slides: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (COLOUR_KEYS.has(k) && typeof x === 'string' && HEX.test(x)) out.add(x.toLowerCase());
      else walk(x, depth + 1);
    }
  };
  walk(slides, 0);
  return out;
}

/** `brandLocks.lockedLine('palette', name)`, repeated so this file imports nothing; the test holds them equal. */
const paletteLockedLine = (by: string | null) => `This colour is locked in the brand kit by ${by || 'an admin'}. Nothing changed.`;

const blocksOf = (slides: unknown): any[] =>
  (Array.isArray(slides) ? slides : []).flatMap((s: any) => (Array.isArray(s?.blocks) ? s.blocks : [])).filter((b: any) => b && typeof b === 'object');

/** Null when every gated block passes; otherwise the first refusal. `opts.prior` is the version being saved over. */
export async function saveGateRefusal(env: Pick<Env, 'DB'>, projectId: number, slides: unknown, opts: { prior?: unknown } = {}): Promise<SaveGateRefusal | null> {
  const blocks = blocksOf(slides);

  // D1572: a locked palette. Only colours new to this save are checked, so a card saved before the lock never blocks.
  const prior = cardColours(opts.prior);
  const fresh = [...cardColours(slides)].filter((c) => !prior.has(c));
  if (fresh.length) {
    let lock: { by_name: string | null; palette_json: string | null } | null;
    try {
      lock = await env.DB.prepare(
        `SELECT u.name AS by_name, k.palette_json
           FROM deck_brand_locks l
           LEFT JOIN users u ON u.id = l.locked_by
           LEFT JOIN deck_brand_kits k ON k.project_id = l.project_id
          WHERE l.project_id = ? AND l.part = 'palette'`,
      ).bind(projectId).first<{ by_name: string | null; palette_json: string | null }>();
    } catch (e) {
      // A store with no lock table holds no lock; any other failed read refuses.
      lock = /no such table/i.test(String((e as Error)?.message ?? e)) ? null : { by_name: null, palette_json: null };
    }
    if (lock) {
      let palette: Record<string, unknown> = {};
      try { palette = JSON.parse(lock.palette_json || '{}') || {}; } catch { palette = {}; }
      const allowed = new Set(Object.values(palette).filter((v): v is string => typeof v === 'string' && HEX.test(v)).map((v) => v.toLowerCase()));
      if (fresh.some((c) => !allowed.has(c))) return { code: 'brand_locked', message: paletteLockedLine(lock.by_name) };
    }
  }
  const logoKeys = [...new Set(blocks.map((b) => b.logo_key).filter((k): k is string => typeof k === 'string' && k.length > 0))];
  const quotes = blocks.filter((b) => b.element === 'interview_quote');

  if (logoKeys.length) {
    let rows: Array<{ logo_key: string; customer_name: string; permitted: number; permitted_at: string | null; permission_reference: string | null }> = [];
    try {
      rows = ((await env.DB.prepare(
        'SELECT logo_key, customer_name, permitted, permitted_at, permission_reference FROM deck_logos WHERE project_id = ? LIMIT 1000',
      ).bind(projectId).all<any>()).results || []) as typeof rows;
    } catch { rows = []; }
    for (const key of logoKeys) {
      const r = rows.find((x) => x.logo_key === key);
      const ok = r && Number(r.permitted) === 1 && !!r.permitted_at && !!r.permission_reference;
      if (!ok) return { code: 'no_permission', message: permissionLine(r?.customer_name || 'This customer') };
    }
  }

  if (quotes.length) {
    let sessions: Set<string>;
    try {
      const rows = await env.DB.prepare(
        `SELECT DISTINCT s.uid AS session_uid
           FROM interview_transcript_segments g
           JOIN interview_sessions s ON s.id = g.session_id
           JOIN discovery_interviews i ON i.id = s.interview_id
          WHERE s.project_id = ? AND i.project_id = s.project_id
            AND s.consent_status = 'given' AND s.consent_at IS NOT NULL
            AND i.quote_consent = 1
            AND g.source = 'final'
            AND (g.speaker_label = i.interviewee_name OR g.speaker_label = 'Interviewee')
            AND length(trim(g.text)) >= ?
          LIMIT 1000`,
      ).bind(projectId, QUOTE_MIN_CHARS).all<{ session_uid: string }>();
      sessions = new Set((rows.results || []).map((r) => String(r.session_uid)));
    } catch { sessions = new Set(); }
    for (const q of quotes) {
      if (typeof q.session_uid !== 'string' || !sessions.has(q.session_uid)) return { code: 'no_consent', message: CONSENT_LINE };
    }
  }
  return null;
}

/** `quoteRetrieval.QUOTE_MIN_CHARS`, repeated so this file imports nothing; the test holds them equal. */
export const QUOTE_MIN_CHARS = 20;
