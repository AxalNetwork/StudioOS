/** D1239: saved settings never grant access to a deal or another investor's thesis. */
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { requireInvestorTier } from '../middleware/requireInvestorTier';
import { resolveActiveCompany } from '../middleware/activeCompany';
import { primaryCover } from './investor_seats';
import { userReadableDealIds } from './deals';
import { computeThesisFit, readFitGeographies, readThesis, type FitGeography } from '../services/thesisFit';

const r = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;
class Refused extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(status: 400 | 403 | 404 | 409, message: string) { super(message); this.status = status; }
}
const uid = () => crypto.randomUUID().replaceAll('-', '');
const validUid = (value: string) => /^[a-f0-9]{32}$/.test(value);
const professional = requireInvestorTier('professional');
const guard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const user = await requireAuth(c);
  if (user.role !== 'investor' || (await selectJwt(c))?.payload.impersonated_by) {
    return c.json({ error: 'Only the investor can use these personal deal-flow settings.' }, 403);
  }
  c.header('Cache-Control', 'no-store');
  return professional(c, next);
};
// Never mount a wildcard middleware under /deals: other deal routes keep their gates.
r.use('/views', guard);
r.use('/views/*', guard);
r.use('/fit', guard);

type Viewer = { user: User; root: number; company: number | null; canShare: boolean };
async function viewer(c: Ctx): Promise<Viewer> {
  const user = await requireAuth(c);
  const row = await c.env.DB.prepare('SELECT investor_seat_primary_user_id FROM users WHERE id = ?').bind(user.id)
    .first<{ investor_seat_primary_user_id: number | null }>();
  if (!row) throw new Refused(403, 'The investor account is unavailable.');
  const root = row.investor_seat_primary_user_id ?? user.id;
  if (root !== user.id) {
    const seat = await c.env.DB.prepare(`SELECT s.id FROM investor_seats s JOIN users p ON p.id = s.primary_user_id
      WHERE s.primary_user_id = ? AND s.seat_user_id = ? AND s.accepted_at IS NOT NULL AND s.revoked_at IS NULL
      AND p.role = 'investor' AND p.is_active = 1`).bind(root, user.id).first();
    if (!seat) throw new Refused(403, 'This firm seat is no longer available.');
  }
  const cover = await primaryCover(c.env, root);
  if (root !== user.id && !cover.ok) throw new Refused(403, 'This firm seat is no longer available.');
  // A seat represents its primary account's firm, even without a duplicate
  // user_company_links row. A client may select only that account's companies.
  const raw = c.req.header('X-Company-Id');
  let company = await resolveActiveCompany(c.env, { id: root }, raw);
  if (raw && company == null) throw new Refused(403, 'That firm selection is unavailable.');
  if (!raw) {
    const links = await c.env.DB.prepare('SELECT DISTINCT company_id FROM user_company_links WHERE user_id = ? LIMIT 2')
      .bind(root).all<{ company_id: number }>();
    if (links.results.length > 1) throw new Refused(409, 'Choose the firm this view belongs to.');
    company = links.results[0]?.company_id ?? null;
  }
  return { user, root, company, canShare: cover.ok };
}

type ViewRow = { uid: string; owner_user_id: number; firm_owner_user_id: number; company_id: number | null;
  name: string; shared_with_firm: number; is_default: number; spec_json: string; version: number;
  mutation_uid: string; created_at: string; updated_at: string };
const shape = (row: ViewRow, who: number) => ({ uid: row.uid, owner_user_id: row.owner_user_id, company_id: row.company_id,
  name: row.name, shared_with_firm: row.shared_with_firm === 1, mine: row.owner_user_id === who,
  // Default is personal. A colleague never inherits the author's default.
  is_default: row.owner_user_id === who && row.is_default === 1,
  spec: JSON.parse(row.spec_json), version: row.version, created_at: row.created_at, updated_at: row.updated_at });

/** Bounded JSON settings only. Nothing in this document becomes SQL or an ACL. */
export function viewSpec(value: unknown): string {
  const allowed = new Set(['version', 'scope', 'view', 'filters', 'sort', 'columns', 'weights']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.has(key))) throw new Refused(400, 'The view specification is invalid.');
  let count = 0;
  function visit(v: unknown, depth: number): void {
    if (++count > 300 || depth > 5) throw new Refused(400, 'The view specification is too large.');
    if (v == null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e15) return;
    if (typeof v === 'string' && v.length <= 500) return;
    if (Array.isArray(v) && v.length <= 50) { v.forEach(x => visit(x, depth + 1)); return; }
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 40) {
      for (const [key, x] of Object.entries(v)) {
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || ['constructor', 'prototype'].includes(key)) throw new Refused(400, 'The view specification is invalid.');
        visit(x, depth + 1);
      }
      return;
    }
    throw new Refused(400, 'The view specification is invalid.');
  }
  visit(value, 0);
  const spec = value as Record<string, unknown>;
  if ((spec.version != null && spec.version !== 1)
    || (spec.scope != null && !['mine', 'all', 'new'].includes(String(spec.scope)))
    || (spec.view != null && !['board', 'table'].includes(String(spec.view)))) throw new Refused(400, 'The view specification is invalid.');
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > 8192) throw new Refused(400, 'The view specification is too large.');
  return json;
}

async function body(c: Ctx): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !['name', 'spec', 'shared_with_firm', 'is_default', 'version'].includes(key))) {
    throw new Refused(400, 'The view request is invalid.');
  }
  return data;
}
function fields(data: Record<string, unknown>, old?: ViewRow) {
  const name = data.name === undefined ? old?.name : typeof data.name === 'string' ? data.name.trim() : null;
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Refused(400, 'Give the view a name.');
  for (const key of ['shared_with_firm', 'is_default']) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Refused(400, 'The view options are invalid.');
  }
  if (old && data.version === undefined) throw new Refused(400, 'Refresh this view before editing it.');
  if (data.version !== undefined && (!Number.isSafeInteger(data.version) || Number(data.version) < 1)) throw new Refused(400, 'The view version is invalid.');
  return { name, spec: data.spec === undefined && old ? old.spec_json : viewSpec(data.spec),
    shared: data.shared_with_firm === undefined ? old?.shared_with_firm ?? 0 : data.shared_with_firm ? 1 : 0,
    default: data.is_default === undefined ? old?.is_default ?? 0 : data.is_default ? 1 : 0,
    version: data.version === undefined ? old?.version ?? 1 : Number(data.version) };
}
function failure(c: Ctx, error: unknown) {
  if (error instanceof Refused) return c.json({ error: error.message }, error.status);
  return c.json({ error: 'Deal-flow settings are unreadable. Try again.' }, 503);
}
async function own(c: Ctx, x: Viewer) {
  const id = c.req.param('uid') ?? '';
  if (!validUid(id)) throw new Refused(404, 'View not found.');
  const row = await c.env.DB.prepare(`SELECT * FROM deal_saved_views
    WHERE uid = ? AND owner_user_id = ? AND firm_owner_user_id = ? AND company_id IS ?`)
    .bind(id, x.user.id, x.root, x.company).first<ViewRow>();
  if (!row) throw new Refused(404, 'View not found.');
  return row;
}

r.get('/views', async c => {
  try {
    const x = await viewer(c);
    const rawLimit = c.req.query('limit') ?? '100', rawOffset = c.req.query('offset') ?? '0';
    if (!/^\d{1,7}$/.test(rawLimit) || !/^\d{1,7}$/.test(rawOffset)) throw new Refused(400, 'The view page is invalid.');
    const limit = Number(rawLimit), offset = Number(rawOffset);
    if (limit < 1 || limit > 100 || offset > 1000000) throw new Refused(400, 'The view page is invalid.');
    const rows = await c.env.DB.prepare(`SELECT * FROM deal_saved_views WHERE firm_owner_user_id = ? AND company_id IS ?
      AND (owner_user_id = ? OR (shared_with_firm = 1 AND ? = 1))
      ORDER BY (owner_user_id = ?) DESC, is_default DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(x.root, x.company, x.user.id, x.canShare ? 1 : 0, x.user.id, limit + 1, offset).all<ViewRow>();
    const current = await c.env.DB.prepare(`SELECT uid FROM deal_saved_views
      WHERE owner_user_id = ? AND firm_owner_user_id = ? AND company_id IS ? AND is_default = 1`)
      .bind(x.user.id, x.root, x.company).first<{ uid: string }>();
    return c.json({ items: rows.results.slice(0, limit).map(row => shape(row, x.user.id)), has_more: rows.results.length > limit,
      default_uid: current?.uid ?? null, company_id: x.company, can_share_with_firm: x.canShare });
  } catch (e) { return failure(c, e); }
});

/** Every later statement proves this operation wrote the row using its nonce.
 * A failed authorization/CAS cannot clear defaults or create an audit entry.
 */
function finish(c: Ctx, x: Viewer, id: string, nonce: string, isDefault: number, action: string) {
  return [
    c.env.DB.prepare(`UPDATE deal_saved_views SET is_default = 0, version = version + 1, updated_at = datetime('now')
      WHERE owner_user_id = ? AND firm_owner_user_id = ?
      AND company_id IS ? AND uid != ? AND is_default = 1 AND ? = 1 AND EXISTS
      (SELECT 1 FROM deal_saved_views target WHERE target.uid = ? AND target.mutation_uid = ?)`)
      .bind(x.user.id, x.root, x.company, id, isDefault, id, nonce),
    c.env.DB.prepare('UPDATE deal_saved_views SET is_default = ? WHERE uid = ? AND mutation_uid = ?').bind(isDefault, id, nonce),
    c.env.DB.prepare(`INSERT INTO activity_logs(user_id,action,entity_type,entity_id,details)
      SELECT ?,?,'deal_view',?,? WHERE EXISTS (SELECT 1 FROM deal_saved_views WHERE uid = ? AND mutation_uid = ?)`)
      .bind(x.user.id, action, id, JSON.stringify({ company_id: x.company }), id, nonce),
  ];
}

r.post('/views', async c => {
  try {
    const x = await viewer(c), f = fields(await body(c));
    if (f.shared && !x.canShare) throw new Refused(403, 'Firm views require an active firm seat account.');
    const id = uid(), nonce = uid();
    const result = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO deal_saved_views(uid,owner_user_id,firm_owner_user_id,company_id,name,shared_with_firm,is_default,spec_json,mutation_uid)
        SELECT ?,?,?,?,?,?,0,?,? WHERE (? = ? OR EXISTS
        (SELECT 1 FROM investor_seats s JOIN users u ON u.id = s.seat_user_id WHERE s.primary_user_id = ? AND s.seat_user_id = ?
          AND u.investor_seat_primary_user_id = s.primary_user_id AND s.accepted_at IS NOT NULL AND s.revoked_at IS NULL))
        AND (SELECT COUNT(*) FROM deal_saved_views WHERE owner_user_id = ? AND firm_owner_user_id = ? AND company_id IS ?) < 100`)
        .bind(id, x.user.id, x.root, x.company, f.name, f.shared, f.spec, nonce,
          x.user.id, x.root, x.root, x.user.id, x.user.id, x.root, x.company),
      ...finish(c, x, id, nonce, f.default, 'deal_view_created'),
    ]);
    if (!result[0].meta.changes) throw new Refused(409, 'The view could not be saved. Refresh and try again.');
    const row = await c.env.DB.prepare('SELECT * FROM deal_saved_views WHERE uid = ? AND owner_user_id = ?').bind(id, x.user.id).first<ViewRow>();
    return c.json(shape(row!, x.user.id), 201);
  } catch (e) { return failure(c, e); }
});

r.patch('/views/:uid', async c => {
  try {
    const x = await viewer(c), old = await own(c, x), f = fields(await body(c), old);
    if (f.shared && !x.canShare) throw new Refused(403, 'Firm views require an active firm seat account.');
    const nonce = uid();
    const result = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE deal_saved_views SET name = ?, spec_json = ?, shared_with_firm = ?, is_default = 0,
        version = version + 1, mutation_uid = ?, updated_at = datetime('now')
        WHERE uid = ? AND owner_user_id = ? AND firm_owner_user_id = ? AND company_id IS ? AND version = ?
        AND (? = ? OR EXISTS (SELECT 1 FROM investor_seats s JOIN users u ON u.id = s.seat_user_id
          WHERE s.primary_user_id = ? AND s.seat_user_id = ? AND u.investor_seat_primary_user_id = s.primary_user_id
          AND s.accepted_at IS NOT NULL AND s.revoked_at IS NULL))`)
        .bind(f.name, f.spec, f.shared, nonce, old.uid, x.user.id, x.root, x.company, f.version,
          x.user.id, x.root, x.root, x.user.id),
      ...finish(c, x, old.uid, nonce, f.default, 'deal_view_updated'),
    ]);
    if (!result[0].meta.changes) throw new Refused(409, 'The view changed or is unavailable. Refresh and try again.');
    const row = await own(c, x);
    return c.json(shape(row, x.user.id));
  } catch (e) { return failure(c, e); }
});

r.delete('/views/:uid', async c => {
  try {
    const x = await viewer(c), old = await own(c, x);
    const expected = c.req.query('version') ?? '';
    if (!/^[1-9][0-9]{0,14}$/.test(expected)) throw new Refused(400, 'Refresh this view before deleting it.');
    if (Number(expected) !== old.version) throw new Refused(409, 'The view changed. Refresh before deleting it.');
    const result = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO activity_logs(user_id,action,entity_type,entity_id,details)
        SELECT ?,'deal_view_deleted','deal_view',uid,? FROM deal_saved_views
        WHERE uid = ? AND owner_user_id = ? AND firm_owner_user_id = ? AND company_id IS ? AND version = ?
        AND (? = ? OR EXISTS (SELECT 1 FROM investor_seats s JOIN users u ON u.id = s.seat_user_id
          WHERE s.primary_user_id = ? AND s.seat_user_id = ? AND u.investor_seat_primary_user_id = s.primary_user_id
          AND s.accepted_at IS NOT NULL AND s.revoked_at IS NULL))`)
        .bind(x.user.id, JSON.stringify({ company_id: x.company }), old.uid, x.user.id, x.root, x.company, old.version,
          x.user.id, x.root, x.root, x.user.id),
      c.env.DB.prepare(`DELETE FROM deal_saved_views WHERE uid = ? AND owner_user_id = ? AND firm_owner_user_id = ? AND company_id IS ? AND version = ?
        AND (? = ? OR EXISTS (SELECT 1 FROM investor_seats s JOIN users u ON u.id = s.seat_user_id
          WHERE s.primary_user_id = ? AND s.seat_user_id = ? AND u.investor_seat_primary_user_id = s.primary_user_id
          AND s.accepted_at IS NOT NULL AND s.revoked_at IS NULL))`)
        .bind(old.uid, x.user.id, x.root, x.company, old.version, x.user.id, x.root, x.root, x.user.id),
    ]);
    if (!result[1].meta.changes) throw new Refused(409, 'The view changed or is unavailable. Refresh and try again.');
    return c.json({ ok: true });
  } catch (e) { return failure(c, e); }
});

r.get('/fit', async c => {
  const user = await requireAuth(c);
  const ids = (c.req.query('ids') ?? '').split(',');
  if (!ids.length || ids.length > 50 || ids.some(id => !/^[1-9][0-9]{0,14}$/.test(id))) {
    return c.json({ error: 'Choose valid deals for the fit read.' }, 400);
  }
  try {
    const wanted = [...new Set(ids.map(Number))];
    const readable = await userReadableDealIds(c.env, user, wanted);
    const unavailable = (id: number) => ({ deal_id: id, state: 'unavailable', label: 'Deal unavailable', score: null, confidence: null });
    if (!readable.size) return c.json({ items: wanted.map(unavailable) });
    const thesis = await readThesis(c.env, user.id);
    const rows = await c.env.DB.prepare(`SELECT d.id, d.project_id, d.target_raise, d.amount, d.currency, p.sector, p.stage
      FROM deals d JOIN projects p ON p.id = d.project_id
      WHERE d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND p.deleted_at IS NULL`)
      .bind(JSON.stringify([...readable])).all<{ id: number; project_id: number; target_raise: number | null; amount: number | null;
        currency: string | null; sector: string | null; stage: string | null }>();
    let geography: Map<number, FitGeography> | null = null;
    let geographyFailed = false;
    if (thesis?.regions.length) {
      try { geography = await readFitGeographies(c.env, rows.results.map(row => row.project_id)); }
      catch { geographyFailed = true; }
    }
    const items = rows.results.map(row => {
      try {
        const recorded = geography?.get(row.project_id);
        if (geographyFailed || recorded?.unreadable) throw new Error('geography_unreadable');
        return { deal_id: row.id, ...computeThesisFit(thesis, { sector: row.sector, stage: row.stage,
          ask: row.target_raise ?? row.amount, currency: row.currency, regions: recorded?.regions ?? null,
          geographyIncomplete: recorded?.geographyIncomplete ?? false }) };
      } catch { return { deal_id: row.id, state: 'unreadable', score: null, confidence: null,
        label: 'Unreadable', reason: 'The fit inputs could not be read. Try again.' }; }
    });
    const byId = new Map(items.map(item => [item.deal_id, item]));
    return c.json({ items: wanted.map(id => byId.get(id) ?? unavailable(id)) });
  } catch { return c.json({ error: 'Thesis fit is unreadable. Try again.' }, 503); }
});

export default r;
