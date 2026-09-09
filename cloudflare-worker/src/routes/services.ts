/**
 * Task #1 (AG) — Service Offerings (founder-marketplace catalog).
 *
 * Mounted at /api/services. All endpoints authenticated.
 *
 *   GET    /offerings             — list (filter q, category)
 *   GET    /offerings/:id         — read one
 *   POST   /offerings             — create (provider/admin)
 *   PUT    /offerings/:id         — update (owner/admin)
 *   DELETE /offerings/:id         — delete (owner/admin)
 *   POST   /offerings/:id/engage  — founder requests this offering
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';

const services = new Hono<{ Bindings: Env }>();

type Offering = {
  id: number;
  uid: string;
  owner_user_id: number;
  title: string;
  category: string | null;
  summary: string | null;
  price_usd: number | null;
  price_cents: number | null;
  engagement_model: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  sold?: number;
};

/**
 * How a service is charged — the `po1` artboard's `Model` column.
 *
 * NOT `category`, WHICH IS ABOUT SOMETHING ELSE. `category` names the SUBJECT
 * of the work ("design", "revops"); this names the shape of the deal, and the
 * artboard's instNote turns on the difference: "Seat services price monthly and
 * carry a granted scope; fixed services price once."
 */
const MODELS = ['fixed', 'retainer', 'seat'];

type SerializedOffering = Omit<Offering, 'is_active'> & { is_active: boolean };
function serialize(o: Offering): SerializedOffering {
  return {
    id: o.id,
    uid: o.uid,
    owner_user_id: o.owner_user_id,
    title: o.title,
    category: o.category,
    summary: o.summary,
    // BOTH, AND THE INTEGER IS THE CANONICAL ONE. `price_usd` is a REAL read in
    // fifty-two places and stays for them; `price_cents` (migration 227) is what
    // the catalog reads and writes, because the artboard's own instMeta is
    // "Prices stored as integers, formatted once". Every write below sets the
    // two together, so a reader of either gets the same number.
    price_usd: o.price_usd,
    // RESOLVED HERE, WHICH IS WHY MIGRATION 227 CARRIES NO BACKFILL. A row
    // priced before that migration has `price_cents` null and `price_usd` set;
    // deriving it in SQL would have meant a migration READING a column only
    // some definitions of this multiply-defined table carry, which
    // `check-migration-column-shapes` refuses on the grounds that it cannot be
    // sure the shape carrying it won. One expression, one place — "formatted
    // once", as the artboard's instMeta puts it.
    price_cents: o.price_cents ?? (o.price_usd == null ? null : Math.round(o.price_usd * 100)),
    engagement_model: o.engagement_model ?? null,
    // Counted from `service_engagements`, joined rather than stored — an
    // engagement nobody linked to an offering is counted against none. Absent
    // on the single-row reads, which do not join.
    sold: o.sold,
    is_active: !!o.is_active,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

/**
 * The two money columns, derived from one input, so a write cannot set one.
 *
 * `price_cents` is what a person typed, as an integer. `price_usd` follows from
 * it by division rather than being taken from the request separately — which is
 * the whole of what keeps the legacy readers agreeing with the catalog.
 */
function priceFrom(input: unknown): { cents: number | null; usd: number | null } {
  if (input == null || input === '') return { cents: null, usd: null };
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return { cents: null, usd: null };
  const cents = Math.round(n * 100);
  return { cents, usd: cents / 100 };
}

function isAdmin(u: User): boolean { return u.role === 'admin'; }

services.get('/offerings', async (c) => {
  const user = await requireAuth(c);
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const category = (c.req.query('category') || '').trim();
  // Wave 1a — `?mine=1` returns the caller's OWN catalog for the Operations →
  // Capabilities tab, including inactive drafts (an owner manages the whole
  // set; the marketplace listing below stays active-only for everyone else).
  const mine = c.req.query('mine') === '1';
  // Qualified, because the SELECT below aliases the table to join the sold
  // count. `id` is on both `service_offerings` and `service_engagements`, so an
  // unqualified predicate in a correlated query is a bug waiting for the day
  // someone filters on one.
  let where = mine ? 'o.owner_user_id = ?' : 'o.is_active = 1';
  const params: (string | number)[] = mine ? [user.id] : [];
  // Company scoping, stage 8. Only the `?mine=1` arm narrows: it answers "what
  // does MY agency offer", which is a claim about a firm. The marketplace arm
  // below it is the founder-facing catalog and must keep showing every active
  // offering — narrowing a catalog hides the providers a founder could hire
  // and makes the switcher look broken. Same rule as the deal list in stage 6.
  //
  // An offering with a NULL company_id belongs to an owner with no primary
  // company and stays visible under every one of theirs.
  if (mine) {
    const companyId = await activeCompanyFor(c, user);
    if (companyId !== null) {
      where += ' AND (o.company_id = ? OR o.company_id IS NULL)';
      params.push(companyId);
    }
  }
  if (category) { where += ' AND o.category = ?'; params.push(category); }
  // `sold` COMES FROM THE ENGAGEMENT TABLE, NOT FROM A COUNTER ON THE ROW. A
  // stored count drifts the moment an engagement is deleted; a correlated count
  // cannot. `service_engagements` (migration 034) carries `offering_id` and has
  // a writer in this same file.
  const rows = await c.env.DB.prepare(
    `SELECT o.*, (SELECT COUNT(*) FROM service_engagements se
                   WHERE se.offering_id = o.id AND se.status <> 'cancelled') AS sold
       FROM service_offerings o WHERE ${where} ORDER BY o.created_at DESC LIMIT 200`,
  ).bind(...params).all<Offering>();
  let items: SerializedOffering[] = (rows.results || []).map(serialize);
  if (q) {
    items = items.filter((o) =>
      (o.title || '').toLowerCase().includes(q) ||
      (o.summary || '').toLowerCase().includes(q));
  }
  return c.json({ items });
});

services.get('/offerings/:id', async (c) => {
  await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  if (!row) return c.json({ detail: 'Offering not found' }, 404);
  return c.json(serialize(row));
});

services.post('/offerings', async (c) => {
  const user = await requireAuth(c);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = String(body?.title || '').trim();
  if (!title) return c.json({ detail: 'title required' }, 400);
  const summary = body?.summary ? String(body.summary).slice(0, 4000) : null;
  const category = body?.category ? String(body.category).slice(0, 80) : null;
  // `price_usd` stays the request's field name — fifty-two callers send it —
  // and `priceFrom` turns it into the pair the row stores.
  const price = priceFrom(body?.price_usd);
  const model = MODELS.includes(String(body?.engagement_model || '')) ? String(body.engagement_model) : null;
  const uid = crypto.randomUUID();
  const now = new Date().toISOString();
  // The agency is recorded at creation, alongside the owner. A creator with no
  // company selected records NULL rather than a guess at their primary — the
  // honest answer when they never named a firm, and one that keeps the
  // offering visible under all of them.
  const companyId = await activeCompanyFor(c, user);
  const r = await c.env.DB.prepare(
    `INSERT INTO service_offerings (uid, owner_user_id, title, category, summary, price_usd, price_cents, engagement_model, is_active, created_at, updated_at, company_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(uid, user.id, title.slice(0, 200), category, summary,
         price.usd, price.cents, model, now, now, companyId).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(r.meta.last_row_id).first<Offering>();
  return c.json(serialize(fresh as Offering));
});

/**
 * The write gate for PUT and DELETE, now also asking WHICH AGENCY.
 *
 * This is an authorisation check, not a filter — its answer becomes a 404 —
 * so the company test runs only AFTER ownership has been established, and an
 * admin is exempt from both. Ordering it the other way would let a company id
 * decide access on a row the caller does not own.
 *
 * A NULL company on the row means the owner recorded no agency for it, and it
 * stays editable under any of theirs.
 */
async function ensureOwnerOr404(
  env: Env, id: number, user: User, companyId: number | null,
): Promise<Offering | null> {
  const row = await env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  if (!row) return null;
  if (isAdmin(user)) return row;
  if (row.owner_user_id !== user.id) return null;
  const owning = (row as Offering & { company_id?: number | null }).company_id ?? null;
  if (companyId !== null && owning !== null && owning !== companyId) return null;
  return row;
}

services.put('/offerings/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await ensureOwnerOr404(c.env, id, user, await activeCompanyFor(c, user));
  if (!row) return c.json({ detail: 'Offering not found' }, 404);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = body?.title != null ? String(body.title).slice(0, 200) : row.title;
  const summary = body?.summary !== undefined ? (body.summary ? String(body.summary).slice(0, 4000) : null) : row.summary;
  const category = body?.category !== undefined ? (body.category ? String(body.category).slice(0, 80) : null) : row.category;
  const price = body?.price_usd !== undefined
    ? priceFrom(body.price_usd)
    : { cents: row.price_cents ?? null, usd: row.price_usd };
  const model = body?.engagement_model !== undefined
    ? (MODELS.includes(String(body.engagement_model || '')) ? String(body.engagement_model) : null)
    : (row.engagement_model ?? null);
  const isActive = body?.is_active !== undefined ? (body.is_active ? 1 : 0) : row.is_active;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE service_offerings SET title = ?, summary = ?, category = ?, price_usd = ?, price_cents = ?, engagement_model = ?, is_active = ?, updated_at = ? WHERE id = ?`,
  ).bind(title, summary, category, price.usd, price.cents, model, isActive, now, id).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  return c.json(serialize(fresh as Offering));
});

services.delete('/offerings/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await ensureOwnerOr404(c.env, id, user, await activeCompanyFor(c, user));
  if (!row) return c.json({ detail: 'Offering not found' }, 404);
  await c.env.DB.prepare('DELETE FROM service_offerings WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

services.post('/offerings/:id/engage', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const offering = await c.env.DB.prepare('SELECT * FROM service_offerings WHERE id = ?')
    .bind(id).first<Offering>();
  if (!offering || !offering.is_active) return c.json({ detail: 'Offering not available' }, 404);
  if (offering.owner_user_id === user.id) return c.json({ detail: 'cannot engage own offering' }, 400);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const note = body?.note ? String(body.note).slice(0, 2000) : null;
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO service_engagements (uid, offering_id, requester_user_id, owner_user_id, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
  ).bind(uid, id, user.id, offering.owner_user_id, note).run();
  return c.json({ ok: true, uid });
});

export default services;
