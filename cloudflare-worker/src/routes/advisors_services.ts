/**
 * #4715 (D4715) — Services: what an advisor offers and charges (migration 203).
 *
 * Split out of routes/advisors.ts, which mounts it at the place these routes
 * held there (`advisors.route('/', …)`), so the paths and their order under
 * /api/advisors and /api/mentors are unchanged. Shared rows, checks and money
 * helpers come from services/advisorPractice.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { SERVICE_LIMITS, boundedText, supportedCurrency, wholeCents } from '../services/advisorLimits';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { pageFacts, pageWindow } from '../services/listPage';
import {
  SERVICES_PAGE, requireMyAdvisor, sentRevision, validationRefusal,
} from '../services/advisorPractice';

const advisors = new Hono<{ Bindings: Env }>();


// ---------------------------------------------------------------------------
// 203 — Services. What an advisor offers, and what they charge for it.
// ---------------------------------------------------------------------------
type ServiceRow = {
  id: number; uid: string; advisor_id: number; title: string; kind: string;
  duration_note: string | null; price_cents: number | null; currency: string;
  scope: string | null; is_active: number; created_at: string; updated_at: string;
};

const SERVICE_KINDS = ['fixed', 'package', 'retainer'];

function serviceDto(r: ServiceRow, unitsSold: number | null = null): any {
  return {
    id: r.id, uid: r.uid, advisor_id: r.advisor_id,
    title: r.title, kind: r.kind, duration_note: r.duration_note,
    // NULL is not zero. An advisor who has not set a price has not said the
    // service is free, and the surface must render "Not recorded" rather than
    // a confident 0 — CLAUDE.md's absent-is-not-empty rule.
    price_cents: r.price_cents ?? null,
    currency: r.currency,
    scope: r.scope, is_active: !!r.is_active,
    units_sold: unitsSold,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

advisors.get('/me/services', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    // #4689: a page of the list, ordered to a unique column, and the counts of
    // the whole list beside it (services/listPage.ts).
    const w = pageWindow(c.req.query(), SERVICES_PAGE);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM advisor_services WHERE advisor_id = ?
        ORDER BY is_active DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).bind(m.id, w.limit, w.offset).all<ServiceRow>();
    const whole = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS live,
              COALESCE(SUM(CASE WHEN price_cents IS NOT NULL THEN 1 ELSE 0 END), 0) AS priced
         FROM advisor_services WHERE advisor_id = ?`
    ).bind(m.id).first<{ total: number; live: number; priced: number }>();
    const items = rows.results || [];
    const total = Number(whole?.total) || 0;
    const live = Number(whole?.live) || 0;
    const priced = Number(whole?.priced) || 0;

    // `units_sold` STAYS NULL, and that is the honest answer rather than a
    // missing feature. Nothing links a booking to a service: `advisor_bookings`
    // has a free-text `topic`, not a service id. Counting bookings whose topic
    // string happens to equal a service title would produce a number that looks
    // like a fact and is a guess — the exact thing CLAUDE.md's absent-is-not-
    // empty rule forbids. The Services zone renders "Not recorded" until a
    // booking can name the service it delivered.
    return c.json({
      items: items.map((r) => serviceDto(r, null)),
      page: pageFacts(w, total, items.length),
      counts: { total, live, draft: total - live, priced, unpriced: total - priced },
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/services', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    const title = boundedText('title', body.title, SERVICE_LIMITS.title);
    if (!title) return c.json({ detail: 'A service needs a title' }, 400);
    const kind = String(body.kind || 'fixed').trim();
    if (!SERVICE_KINDS.includes(kind)) {
      return c.json({ detail: 'kind must be one of: fixed, package, retainer' }, 400);
    }
    const price_cents = wholeCents(body.price_cents);
    // D4674: the currency is stated, never assumed. A price in a currency the
    // advisor did not choose is a price they did not set.
    if (body.currency == null || body.currency === '') {
      return refuse(c, 400, { code: 'currency_required', message: 'Choose the currency this service is priced in.' });
    }
    const currency = supportedCurrency(body.currency);
    const duration_note = boundedText('duration_note', body.duration_note, SERVICE_LIMITS.duration_note);
    const scope = boundedText('scope', body.scope, SERVICE_LIMITS.scope);
    const now = nowIso();
    const uid = newUid();
    const r = await c.env.DB.prepare(
      `INSERT INTO advisor_services
         (uid, advisor_id, title, kind, duration_note, price_cents, currency,
          scope, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, m.id, title, kind, duration_note, price_cents, currency, scope,
           body.is_active === false ? 0 : 1, now, now).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind((r as any).meta?.last_row_id).first<ServiceRow>();
    return c.json(serviceDto(fresh!));
  } catch (e) { return validationRefusal(c, e) ?? mapError(c, e); }
});

advisors.patch('/me/services/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ServiceRow>();
    // Ownership is checked against the caller's own advisor id, not asserted
    // from the path. A service belonging to someone else is Not Found here.
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Service not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const has = (k: string) => k in body;
    if (has('kind') && body.kind != null && !SERVICE_KINDS.includes(String(body.kind).trim())) {
      return c.json({ detail: 'kind must be one of: fixed, package, retainer' }, 400);
    }
    // D4681: a title sent blank is refused rather than quietly kept, so an edit
    // that clears it says so instead of reporting a save that changed nothing.
    if (body.title != null && !String(body.title).trim()) {
      return c.json({ detail: 'A service needs a title' }, 400);
    }
    const title = body.title == null ? null : boundedText('title', body.title, SERVICE_LIMITS.title);
    const price_cents = has('price_cents') ? wholeCents(body.price_cents) : null;
    const currency = has('currency') && body.currency != null ? supportedCurrency(body.currency) : null;
    // Changing the currency of a price that is already set changes what the price
    // means, so the new amount has to come in the same edit.
    if (currency && currency !== row.currency && row.price_cents != null && !has('price_cents')) {
      return refuse(c, 400, { code: 'price_required_with_currency', message: 'Changing the currency changes what the price means. Enter the price in the new currency as well.' });
    }
    const duration_note = has('duration_note') ? boundedText('duration_note', body.duration_note, SERVICE_LIMITS.duration_note) : null;
    const scope = has('scope') ? boundedText('scope', body.scope, SERVICE_LIMITS.scope) : null;
    const revision = sentRevision(body);
    // D4674: ONE fixed statement that writes only the fields the body names
    // (CASE per column), so two edits to different fields of the same service
    // both land; a `revision` makes an edit conditional on the row not having
    // moved since the editor read it, and a miss is a 409 with the current row.
    const r = await c.env.DB.prepare(
      `UPDATE advisor_services SET
         title = CASE WHEN ? = 1 THEN ? ELSE title END,
         kind = CASE WHEN ? = 1 THEN ? ELSE kind END,
         duration_note = CASE WHEN ? = 1 THEN ? ELSE duration_note END,
         price_cents = CASE WHEN ? = 1 THEN ? ELSE price_cents END,
         currency = CASE WHEN ? = 1 THEN ? ELSE currency END,
         scope = CASE WHEN ? = 1 THEN ? ELSE scope END,
         is_active = CASE WHEN ? = 1 THEN ? ELSE is_active END,
         updated_at = ?
       WHERE id = ? AND advisor_id = ? AND (? IS NULL OR updated_at = ?)`
    ).bind(
      body.title == null ? 0 : 1, title,
      body.kind == null ? 0 : 1, body.kind == null ? null : String(body.kind).trim(),
      has('duration_note') ? 1 : 0, duration_note,
      has('price_cents') ? 1 : 0, price_cents,
      currency ? 1 : 0, currency,
      has('scope') ? 1 : 0, scope,
      body.is_active == null ? 0 : 1, body.is_active ? 1 : 0,
      nowIso(), row.id, m.id, revision, revision,
    ).run();
    if (Number((r as any).meta?.changes ?? 1) === 0) {
      const current = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
        .bind(row.id).first<ServiceRow>();
      if (!current) return c.json({ detail: 'Service not found' }, 404);
      return c.json({
        error: 'revision_conflict',
        message: 'This service was changed somewhere else after you opened it. It is shown as it now stands; nothing of yours was saved.',
        current: serviceDto(current),
      }, 409);
    }
    const fresh = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind(row.id).first<ServiceRow>();
    return c.json(serviceDto(fresh!));
  } catch (e) { return validationRefusal(c, e) ?? mapError(c, e); }
});

advisors.delete('/me/services/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_services WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<ServiceRow>();
    if (!row || row.advisor_id !== m.id) return c.json({ detail: 'Service not found' }, 404);
    await c.env.DB.prepare('DELETE FROM advisor_services WHERE id = ?').bind(row.id).run();
    return c.json({ ok: true, id: row.id });
  } catch (e) { return mapError(c, e); }
});

export default advisors;
