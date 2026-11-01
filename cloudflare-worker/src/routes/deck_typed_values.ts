/**
 * D1538 (#3787, deck v2 B11) — the figures a founder types for a deck.
 *
 *   GET    /api/decks/:id/typed-values
 *          → { deck_id, values: [{ key, label, value, unit, grade: 'Stated', typed_by: { id, name } | null, typed_at }] }
 *   PUT    /api/decks/:id/typed-values/:key  { label, value, unit }
 *          → { value: <one row as above> }
 *   DELETE /api/decks/:id/typed-values/:key  → { deleted: true }
 *
 * A typed figure is the venture's, not one version's (migration 734): every
 * version of the deck reads the same figures. Its grade is always Stated,
 * because nothing measured backs it; the card says "✎ Stated" and "Typed by
 * <name>". A key with no row is absent, never a 0.
 *
 * Who: reading is whoever may read the deck (`projectOwned`, as
 * `GET /api/decks/:id/grid`); writing needs write access to the venture, and a
 * support session may not type a figure for the member it is looking at.
 * Every statement is bound.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { isSupportSession } from '../integrations/providers/mercury';
import { ensureSchema, getDeckRow } from './decks';
import { refuse } from '../util/refusal';

export const TYPED_KEY = /^[a-z0-9_]{1,40}$/;
export const TYPED_UNITS = ['count', 'usd', 'percent', 'months', 'text'] as const;
export const TYPED_MAX = 200;
const LABEL_MAX = 80;
const TEXT_MAX = 80;

type Row = { key: string; label: string; value_num: number | null; value_text: string | null; unit: string; typed_by: number | null; typed_by_name: string | null; typed_at: string };

const shape = (r: Row) => ({
  key: r.key,
  label: r.label,
  value: r.value_num ?? r.value_text,
  unit: r.unit,
  grade: 'Stated' as const,
  typed_by: r.typed_by == null ? null : { id: Number(r.typed_by), name: r.typed_by_name || null },
  typed_at: r.typed_at,
});

/** The typed figures of one venture, by key. */
export async function typedValuesOf(env: Env, projectId: number) {
  const r = await env.DB.prepare(
    `SELECT v.key, v.label, v.value_num, v.value_text, v.unit, v.typed_by, v.typed_at,
            COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), '')) AS typed_by_name
       FROM deck_typed_values v LEFT JOIN users u ON u.id = v.typed_by
      WHERE v.project_id = ? ORDER BY v.key LIMIT ?`,
  ).bind(projectId, TYPED_MAX).all<Row>();
  return (r.results || []).map(shape);
}

/** A PUT body, or the refusal's code and sentence. */
export function typedBody(body: any): { label: string; num: number | null; text: string | null; unit: string } | { code: string; message: string } {
  const label = typeof body?.label === 'string' ? body.label.trim().slice(0, LABEL_MAX) : '';
  if (!label) return { code: 'label_required', message: 'Name the figure.' };
  const unit = typeof body?.unit === 'string' && (TYPED_UNITS as readonly string[]).includes(body.unit) ? body.unit : null;
  if (!unit) return { code: 'invalid_unit', message: 'The unit is a count, dollars, a percent, months or text.' };
  const v = body?.value;
  if (unit === 'text') {
    const text = typeof v === 'string' ? v.trim().slice(0, TEXT_MAX) : '';
    return text ? { label, num: null, text, unit } : { code: 'value_required', message: 'Type the figure.' };
  }
  const num = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  if (!Number.isFinite(num)) return { code: 'invalid_value', message: 'The figure must be a number.' };
  if (unit === 'percent' && (num < -1000 || num > 1000)) return { code: 'invalid_value', message: 'A percent is between -1,000 and 1,000.' };
  return { label, num, text: null, unit };
}

const r = new Hono<{ Bindings: Env }>();

async function deckProject(c: any, write: boolean): Promise<{ deckId: number; projectId: number; userId: number } | Response> {
  const user = await requireAuth(c);
  const deckId = Number(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id), write ? { write: true } : {}); } catch { return c.json({ error: 'forbidden' }, 403); }
  if (write && await isSupportSession(c)) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot type a figure for this member.' });
  }
  return { deckId, projectId: Number(row.project_id), userId: Number(user.id) };
}

r.get('/:id{[0-9]+}/typed-values', async (c) => {
  const at = await deckProject(c, false);
  if (at instanceof Response) return at;
  return c.json({ deck_id: at.deckId, values: await typedValuesOf(c.env, at.projectId) });
});

r.put('/:id{[0-9]+}/typed-values/:key', async (c) => {
  const key = c.req.param('key');
  if (!TYPED_KEY.test(key)) return refuse(c, 400, { code: 'invalid_key', message: 'A key is up to 40 lowercase letters, digits or underscores.' });
  const at = await deckProject(c, true);
  if (at instanceof Response) return at;
  const body = typedBody(await c.req.json().catch(() => null));
  if ('code' in body) return refuse(c, 400, body);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM deck_typed_values WHERE project_id = ? AND key <> ?').bind(at.projectId, key).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= TYPED_MAX) return refuse(c, 409, { code: 'too_many_values', message: 'A deck keeps at most 200 typed figures.' });
  await c.env.DB.prepare(
    `INSERT INTO deck_typed_values (project_id, deck_id, key, label, value_num, value_text, unit, typed_by, typed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, key) DO UPDATE SET deck_id = excluded.deck_id, label = excluded.label, value_num = excluded.value_num,
       value_text = excluded.value_text, unit = excluded.unit, typed_by = excluded.typed_by, typed_at = excluded.typed_at`,
  ).bind(at.projectId, at.deckId, key, body.label, body.num, body.text, body.unit, at.userId).run();
  const row = await c.env.DB.prepare(
    `SELECT v.key, v.label, v.value_num, v.value_text, v.unit, v.typed_by, v.typed_at,
            COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(u.name), '')) AS typed_by_name
       FROM deck_typed_values v LEFT JOIN users u ON u.id = v.typed_by
      WHERE v.project_id = ? AND v.key = ?`,
  ).bind(at.projectId, key).first<Row>();
  return c.json({ value: row ? shape(row) : null });
});

r.delete('/:id{[0-9]+}/typed-values/:key', async (c) => {
  const key = c.req.param('key');
  if (!TYPED_KEY.test(key)) return refuse(c, 400, { code: 'invalid_key', message: 'A key is up to 40 lowercase letters, digits or underscores.' });
  const at = await deckProject(c, true);
  if (at instanceof Response) return at;
  const res = await c.env.DB.prepare('DELETE FROM deck_typed_values WHERE project_id = ? AND key = ?').bind(at.projectId, key).run();
  if (!Number(res.meta?.changes ?? 0)) return refuse(c, 404, { code: 'not_found', message: 'No figure is typed under that key.' });
  return c.json({ deleted: true });
});

export default r;
