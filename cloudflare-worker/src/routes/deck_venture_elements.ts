/**
 * D1543 (#3781, deck v2 B5) — the venture-record elements and the logos store.
 *
 *   GET    /api/decks/:id/venture-elements[?include=cap_table]
 *          → { deck_id, elements: { team_grid, team_bios, use_of_funds, round_terms, cap_table, logo_wall, interview_quote } }
 *            each `{ available: true, blocks, bindings, model: null, label }` or
 *            `{ available: false, code, line }`: the one-click run places what
 *            passes its gate and leaves the rest out, with no placeholder.
 *   GET    /api/decks/:id/venture-elements/:element
 *            [?include=cap_table] [?detail=holders] [?final=1] [?logos=k1,k2] [?segment=<id>]
 *          → one element as above, or a refusal (409 unless said) whose
 *            `error` is the gate's code and whose `message` is the canvas's line:
 *            no_consent, no_permission, totals_only, not_included,
 *            subject_to_counsel, quotes_not_switched_on, pick_required,
 *            not_recorded; unreadable is 503.
 *   GET    /api/decks/:id/logos → { deck_id, logos: [{ logo_key, customer_name, image_uid, image_url, permitted, permission_reference, permitted_at }] }
 *   POST   /api/decks/:id/logos { customer_name, image_uid, permitted?, permission_reference? } → { logo }
 *   PATCH  /api/decks/:id/logos/:key { permitted, permission_reference? } → { logo }
 *   DELETE /api/decks/:id/logos/:key → { deleted: true }
 *
 * Values come from the venture's records (`services/decks/ventureElements.ts`),
 * never from a model, each with its Source and grade. A logo is stored with a
 * permission flag (migration 732): one without permission is kept while the
 * founder asks, but never placed (`no_permission`) and never sent on a link
 * (`shareInclude.shareGatesFor`).
 *
 * WHO. Reading is whoever may read the deck (`projectOwned`, as the other
 * deck reads); a logo write needs write access, and a support session may not
 * record a customer's permission for the member it is looking at. No DTO
 * carries an email or a user id. Every statement is a bound literal.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { isSupportSession } from '../integrations/providers/mercury';
import { ensureSchema, getDeckRow } from './decks';
import { imageUrl } from './deck_images';
import { refuse } from '../util/refusal';
import { isVentureElement, ventureElement, ventureElements, type ElementAnswer, type ElementOpts } from '../services/decks/ventureElements';

export const LOGO_KEY = /^logo_[0-9a-f]{24}$/;
const IMAGE_UID = /^[0-9a-f-]{36}$/;
const NAME_MAX = 80;
const REFERENCE_MAX = 200;
export const LOGOS_MAX = 48;

const r = new Hono<{ Bindings: Env }>();

async function deckProject(c: any, write: boolean): Promise<{ deckId: number; projectId: number; userId: number } | Response> {
  const user = await requireAuth(c);
  const deckId = Number(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id), write ? { write: true } : {}); } catch { return c.json({ error: 'forbidden' }, 403); }
  if (write && await isSupportSession(c)) {
    return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot record a customer\'s logo or permission for this member.' });
  }
  return { deckId, projectId: Number(row.project_id), userId: Number(user.id) };
}

function optsOf(c: any): ElementOpts {
  const q = (k: string) => c.req.query(k);
  const include = String(q('include') || '').split(',').map((s: string) => s.trim());
  const logos = String(q('logos') || '').split(',').map((s: string) => s.trim()).filter((k: string) => LOGO_KEY.test(k)).slice(0, LOGOS_MAX);
  const seg = Number(q('segment'));
  return {
    includeCapTable: include.includes('cap_table'),
    holders: q('detail') === 'holders',
    final: q('final') === '1' || q('final') === 'true',
    logos: logos.length ? logos : null,
    segment: Number.isSafeInteger(seg) && seg > 0 ? seg : null,
    quoteIndex: c.env.DECK_QUOTES ?? null,
    imageUrl: (uid: string) => imageUrl(c.req.url, uid),
  };
}

r.get('/:id{[0-9]+}/venture-elements', async (c) => {
  const at = await deckProject(c, false);
  if (at instanceof Response) return at;
  return c.json({ deck_id: at.deckId, elements: await ventureElements(c.env, at.projectId, optsOf(c)) });
});

r.get('/:id{[0-9]+}/venture-elements/:element', async (c) => {
  const element = c.req.param('element');
  if (!isVentureElement(element)) return refuse(c, 400, { code: 'unknown_element', message: 'That is not one of the venture-record elements.' });
  const at = await deckProject(c, false);
  if (at instanceof Response) return at;
  let answer: ElementAnswer;
  try {
    answer = await ventureElement(c.env, at.projectId, element, optsOf(c));
  } catch (e) {
    return refuse(c, 503, { code: 'unreadable', message: 'Your records could not be read right now.', raw: e });
  }
  if (!answer.available) {
    return refuse(c, answer.code === 'unreadable' ? 503 : 409, { code: answer.code, message: answer.line, extra: { element } });
  }
  return c.json({ deck_id: at.deckId, ...answer });
});

// ─────────────────────────────────────────────────────────────── the logos store (migration 732)

type LogoRow = { logo_key: string; customer_name: string; image_uid: string; permitted: number; permission_reference: string | null; permitted_at: string | null };
const logoShape = (c: any, l: LogoRow) => ({
  logo_key: l.logo_key, customer_name: l.customer_name, image_uid: l.image_uid, image_url: imageUrl(c.req.url, l.image_uid),
  permitted: Number(l.permitted) === 1, permission_reference: l.permission_reference, permitted_at: l.permitted_at,
});
const readLogo = (env: Env, projectId: number, key: string) => env.DB.prepare(
  'SELECT logo_key, customer_name, image_uid, permitted, permission_reference, permitted_at FROM deck_logos WHERE project_id = ? AND logo_key = ?',
).bind(projectId, key).first<LogoRow>();

/** A permission as a body states it: granted with how it was given, or withdrawn. */
function permissionOf(body: any): { permitted: 0 | 1; reference: string | null } | { code: string; message: string } {
  if (body?.permitted === undefined || body?.permitted === false) return { permitted: 0, reference: null };
  if (body.permitted !== true) return { code: 'invalid_permission', message: 'Say whether the customer gave permission: true or false.' };
  const reference = typeof body.permission_reference === 'string' ? body.permission_reference.trim().slice(0, REFERENCE_MAX) : '';
  if (!reference) return { code: 'permission_reference_required', message: 'Say how the customer gave permission, for example "Email from their CMO, 30 Oct".' };
  return { permitted: 1, reference };
}

function newLogoKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return `logo_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

r.get('/:id{[0-9]+}/logos', async (c) => {
  const at = await deckProject(c, false);
  if (at instanceof Response) return at;
  const rows = await c.env.DB.prepare(
    'SELECT logo_key, customer_name, image_uid, permitted, permission_reference, permitted_at FROM deck_logos WHERE project_id = ? ORDER BY id LIMIT ?',
  ).bind(at.projectId, LOGOS_MAX).all<LogoRow>();
  return c.json({ deck_id: at.deckId, logos: (rows.results || []).map((l) => logoShape(c, l)) });
});

r.post('/:id{[0-9]+}/logos', async (c) => {
  const at = await deckProject(c, true);
  if (at instanceof Response) return at;
  const body = await c.req.json<any>().catch(() => null);
  const name = typeof body?.customer_name === 'string' ? body.customer_name.trim().slice(0, NAME_MAX) : '';
  if (!name) return refuse(c, 400, { code: 'customer_name_required', message: 'Name the customer whose logo this is.' });
  const uid = typeof body?.image_uid === 'string' && IMAGE_UID.test(body.image_uid) ? body.image_uid : null;
  if (!uid) return refuse(c, 400, { code: 'image_required', message: 'Upload the logo first, then add it here.' });
  const perm = permissionOf(body);
  if ('code' in perm) return refuse(c, 400, perm);
  const img = await c.env.DB.prepare("SELECT uid FROM deck_images WHERE uid = ? AND project_id = ? AND state = 'kept'").bind(uid, at.projectId).first<{ uid: string }>();
  if (!img) return refuse(c, 404, { code: 'image_not_found', message: 'That picture is not one of this venture\'s uploads.' });
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM deck_logos WHERE project_id = ?').bind(at.projectId).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= LOGOS_MAX) return refuse(c, 409, { code: 'too_many_logos', message: 'A venture keeps at most 48 logos.' });
  const dup = await c.env.DB.prepare('SELECT logo_key FROM deck_logos WHERE project_id = ? AND image_uid = ?').bind(at.projectId, uid).first<{ logo_key: string }>();
  if (dup) return refuse(c, 409, { code: 'logo_exists', message: 'That picture is already one of your logos.' });
  const key = newLogoKey();
  await c.env.DB.prepare(
    `INSERT INTO deck_logos (project_id, logo_key, customer_name, image_uid, permitted, permission_reference, permitted_by, permitted_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, ?)`,
  ).bind(at.projectId, key, name, uid, perm.permitted, perm.reference, perm.permitted ? at.userId : null, perm.permitted, at.userId).run();
  const row = await readLogo(c.env, at.projectId, key);
  return c.json({ logo: row ? logoShape(c, row) : null });
});

r.patch('/:id{[0-9]+}/logos/:key', async (c) => {
  const key = c.req.param('key');
  if (!LOGO_KEY.test(key)) return refuse(c, 400, { code: 'invalid_logo_key', message: 'That is not a logo key.' });
  const at = await deckProject(c, true);
  if (at instanceof Response) return at;
  const body = await c.req.json<any>().catch(() => null);
  if (typeof body?.permitted !== 'boolean') return refuse(c, 400, { code: 'invalid_permission', message: 'Say whether the customer gave permission: true or false.' });
  const perm = permissionOf(body);
  if ('code' in perm) return refuse(c, 400, perm);
  const res = await c.env.DB.prepare(
    `UPDATE deck_logos SET permitted = ?, permission_reference = ?, permitted_by = ?,
            permitted_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, updated_at = datetime('now')
      WHERE project_id = ? AND logo_key = ?`,
  ).bind(perm.permitted, perm.reference, perm.permitted ? at.userId : null, perm.permitted, at.projectId, key).run();
  if (!Number(res.meta?.changes ?? 0)) return refuse(c, 404, { code: 'logo_not_found', message: 'No logo of this venture has that key.' });
  const row = await readLogo(c.env, at.projectId, key);
  return c.json({ logo: row ? logoShape(c, row) : null });
});

r.delete('/:id{[0-9]+}/logos/:key', async (c) => {
  const key = c.req.param('key');
  if (!LOGO_KEY.test(key)) return refuse(c, 400, { code: 'invalid_logo_key', message: 'That is not a logo key.' });
  const at = await deckProject(c, true);
  if (at instanceof Response) return at;
  const res = await c.env.DB.prepare('DELETE FROM deck_logos WHERE project_id = ? AND logo_key = ?').bind(at.projectId, key).run();
  if (!Number(res.meta?.changes ?? 0)) return refuse(c, 404, { code: 'logo_not_found', message: 'No logo of this venture has that key.' });
  return c.json({ deleted: true });
});

export default r;
