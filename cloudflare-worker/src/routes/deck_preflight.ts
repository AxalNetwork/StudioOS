/**
 * D4208 (#4208, part of #3661 P1) — preflight dismissals, kept per deck version.
 *
 *   GET /api/decks/:id/preflight/dismissals?version=<n>
 *       → { deck_id, version, dismissed: [finding_id] }
 *   PUT /api/decks/:id/preflight/dismissals
 *       { version, finding_id, dismissed: true|false, severity? }
 *       → { deck_id, version, dismissed: [finding_id] }
 *
 * A founder may dismiss a "Worth a look" warning from the preflight panel
 * (`frontend/src/pages/raise/pitch/preflightModel.js`). The dismissal is kept
 * here, so it survives a reload and every editor of the deck sees it. A new
 * version has none of its own, so it starts clean.
 *
 * Who: the access of `GET /api/decks/:id` (`projectOwned` in `decks.ts`). A
 * reader may read; only an editor may write (`{ write: true }`).
 *
 * What is stored: the finding's id only, `"<check>:<card>:<block>:<n>"`, at
 * most 120 characters. No title, detail or fix is stored.
 *
 * Blocking is never dismissed. The export-blocking checks are `layout`,
 * `overflow`, and `image` when the block has no image. The id names the check
 * and, for `image`, the server reads the version's own block to tell an empty
 * image (blocking) from a soft one (a warning). A client that says the finding
 * is `blocking` is refused too. Each is 422 `finding_blocking`, and nothing is
 * written. Undo (`dismissed: false`) only removes a row.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import decks, { ensureSchema, getDeckRow, projectOwned } from './decks';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';

/** The preflight model's checks (`CHECKS` in `preflightModel.js`). */
export const PREFLIGHT_CHECKS = Object.freeze(['layout', 'overflow', 'density', 'font', 'contrast', 'image', 'alt', 'theme', 'placeholder', 'sources']);
/** Checks whose every finding blocks export. `image` blocks only when the block has no image. */
export const BLOCKING_CHECKS = Object.freeze(['layout', 'overflow']);
export const FINDING_ID_MAX = 120;

export type FindingRef = { check: string; card: number; block: string | null; n: number };

/** Parse `"<check>:<card>:<block>:<n>"`; a block of `-` is the card itself. Null when it is not one. */
export function parseFindingId(id: unknown): FindingRef | null {
  if (typeof id !== 'string' || !id || id.length > FINDING_ID_MAX) return null;
  const m = /^([a-z]+):(\d{1,4}):([^:\s]{1,80}):(\d{1,4})$/.exec(id);
  if (!m || !PREFLIGHT_CHECKS.includes(m[1])) return null;
  return { check: m[1], card: Number(m[2]), block: m[3] === '-' ? null : m[3], n: Number(m[4]) };
}

/**
 * Whether a finding blocks export, read from the version's own cards. An
 * `image` finding blocks when its block has no image; one whose block cannot
 * be found is treated as blocking, since it cannot be shown to be a warning.
 */
export function isBlocking(ref: FindingRef, slides: unknown[]): boolean {
  if (BLOCKING_CHECKS.includes(ref.check)) return true;
  if (ref.check !== 'image') return false;
  const card: any = slides[ref.card];
  const blocks: any[] = Array.isArray(card?.blocks) ? card.blocks : [];
  const block = ref.block === null ? null : blocks.find((b) => String(b?.id ?? '') === ref.block);
  if (!block) return true;
  return block.kind === 'image' && !String(block.image_url ?? '').trim();
}

const versionOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : null;
};

async function dismissedOf(env: Env, deckId: number, version: number): Promise<string[]> {
  const rows = (await env.DB.prepare('SELECT finding_id FROM deck_preflight_dismissals WHERE deck_id = ? AND version = ? ORDER BY finding_id')
    .bind(deckId, version).all<{ finding_id: string }>()).results ?? [];
  return rows.map((r) => r.finding_id);
}

const deckPreflight = new Hono<{ Bindings: Env }>();

deckPreflight.get('/:id{[0-9]+}/preflight/dismissals', async (c) => {
  const user = await requireAuth(c);
  const version = versionOf(c.req.query('version'));
  if (version === null) return refuse(c, 400, { code: 'invalid_version', message: 'Say which version of the deck, as a whole number.' });
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, Number(c.req.param('id'))); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id)); } catch { return c.json({ error: 'forbidden' }, 403); }
  return c.json({ deck_id: Number(row.id), version, dismissed: await dismissedOf(c.env, Number(row.id), version) });
});

deckPreflight.put('/:id{[0-9]+}/preflight/dismissals', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => null) as any;
  const version = versionOf(body?.version);
  if (version === null) return refuse(c, 400, { code: 'invalid_version', message: 'Say which version of the deck, as a whole number.' });
  const ref = parseFindingId(body?.finding_id);
  if (!ref) return refuse(c, 400, { code: 'invalid_finding', message: `A finding is named "<check>:<card>:<block>:<n>", at most ${FINDING_ID_MAX} characters.` });
  if (typeof body?.dismissed !== 'boolean') return refuse(c, 400, { code: 'invalid_dismissed', message: 'Say whether the finding is dismissed, true or false.' });
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, Number(c.req.param('id'))); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id), { write: true }); } catch { return c.json({ error: 'forbidden' }, 403); }
  const deckId = Number(row.id);
  const findingId = String(body.finding_id);

  if (body.dismissed) {
    // The version's own cards say whether an image finding blocks.
    const at = await c.env.DB.prepare('SELECT id FROM pitch_decks WHERE project_id = ? AND version = ? ORDER BY id DESC LIMIT 1')
      .bind(Number(row.project_id), version).first<{ id: number }>();
    if (!at) return refuse(c, 404, { code: 'version_not_found', message: 'This deck has no such version.' });
    const own = Number(at.id) === deckId ? row : await getDeckRow(c.env, Number(at.id));
    let slides: unknown[] = [];
    try { const s = JSON.parse(own.slides || '[]'); slides = Array.isArray(s) ? s : []; } catch { slides = []; }
    if (body.severity === 'blocking' || isBlocking(ref, slides)) {
      return refuse(c, 422, { code: 'finding_blocking', message: 'This finding blocks export, so it cannot be dismissed. Fix it on the card.' });
    }
    await c.env.DB.prepare('INSERT INTO deck_preflight_dismissals (deck_id, version, finding_id, dismissed_by) VALUES (?, ?, ?, ?) ON CONFLICT (deck_id, version, finding_id) DO NOTHING')
      .bind(deckId, version, findingId, Number(user.id)).run();
  } else {
    await c.env.DB.prepare('DELETE FROM deck_preflight_dismissals WHERE deck_id = ? AND version = ? AND finding_id = ?')
      .bind(deckId, version, findingId).run();
  }
  return c.json({ deck_id: deckId, version, dismissed: await dismissedOf(c.env, deckId, version) });
});

export default deckPreflight;

export const mount: RouteMount = { path: '/api/decks', router: deckPreflight, before: [decks] };
