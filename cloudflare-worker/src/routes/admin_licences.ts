/**
 * Territory licences — the HQ ledger behind the subsidiary model.
 *
 * Mounted at /api/admin/licences BEFORE the catch-all /api/admin in index.ts,
 * the same mount-precedence trick admin_billing and admin_promos use. Schema:
 * migration 187.
 *
 *   GET    /                       every licence, with territories and seats
 *   GET    /territories            who holds what, for the picker
 *   POST   /                       step 1 — create a draft from an entity
 *   PUT    /:uid/territories       step 2 — set the countries (refuses overlap)
 *   PUT    /:uid/seats             step 3 — seats licensed, per persona
 *   PATCH  /:uid/terms             step 4 — term, fee, revenue share, splits
 *   GET    /:uid/activation        step 5 — what still blocks activation
 *   POST   /:uid/activate          step 5 — activate, if nothing blocks
 *   POST   /:uid/suspend           suspend (territory is NOT released)
 *   POST   /:uid/reinstate         back to active
 *   POST   /:uid/renew             push renews_on out by the term
 *   POST   /:uid/terminate         end it, releasing every country
 *
 * WHAT THIS IS NOT. This is the ledger, not the scope. No existing query
 * learns a territory from it and no row gains a licence_id — retrofitting
 * that across 151 route files is a programme, and the repo's rule is that
 * tenancy goes through ONE middleware. A half-applied scope reads as enforced
 * and is not, which is worse than none.
 *
 * The visible consequence is that every figure derived from account
 * attribution — seats used, accounts per licence, revenue per subsidiary,
 * token P&L — is UNAVAILABLE, and is reported as null rather than as a
 * plausible number. `seatsUsed` below is the whole of that story.
 *
 * TERRITORY EXCLUSIVITY is enforced by a unique index on
 * `licence_territories.country_code`, not by the check in this file. The check
 * exists to produce a good error message naming the conflicting holder; the
 * index is what makes a race impossible. `PUT /:uid/territories` therefore
 * writes inside a batch and lets the constraint be the final word.
 *
 * SUSPENSION DOES NOT RELEASE TERRITORY. Rows are deleted on terminate and
 * left alone on suspend. Nobody has to remember the rule because there is no
 * code path that could forget it.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

const SEAT_TYPES = ['founder', 'investor', 'advisor', 'partner'] as const;
const ISO2 = /^[A-Z]{2}$/;
/** Statuses that still hold territory. Terminated is the only one that does not. */
const HOLDS_TERRITORY = ['draft', 'pending_activation', 'active', 'suspended'];

export type LicenceRow = {
  id: number; uid: string; licence_ref: string; entity_id: number | null;
  legal_entity_name: string; brand_name: string; registered_address: string | null;
  signatory_name: string | null; signatory_title: string | null; status: string;
  term_years: number | null; annual_fee_cents: number | null; currency: string;
  revenue_share_bps: number | null; token_split_bps: number | null;
  starts_on: string | null; renews_on: string | null; suspended_at: string | null;
  terminated_at: string | null; status_note: string | null; created_at: string;
};

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);
const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

async function byUid(env: Env, uid: string): Promise<LicenceRow | null> {
  return await env.DB.prepare('SELECT * FROM territory_licences WHERE uid = ?')
    .bind(uid).first<LicenceRow>();
}

async function logEvent(
  env: Env, licenceId: number, event: string, actorId: number,
  detail?: unknown, note?: string | null,
) {
  await env.DB.prepare(
    `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).bind(
    licenceId, event, detail === undefined ? null : JSON.stringify(detail),
    note ?? null, actorId, nowIso(),
  ).run();
}

/**
 * Seats used, which is deliberately unknowable here.
 *
 * The canvas shows "% utilised" against seats licensed. Computing it needs
 * every account to name the licence it belongs to, and no account does —
 * that is the scoping half this ledger does not build. Returning null makes
 * the UI say so; returning 0 would read as "nobody has signed up", which is a
 * different and false claim.
 */
function seatsUsed(): null { return null; }

/**
 * Every licence with its territories and seats, in three queries not 3N.
 *
 * Exported for routes/licence.ts, the holder-facing read added in task #202.
 * A subsidiary admin must see exactly the shape HQ sees — including the null
 * `seats_used` — so the two views cannot drift into disagreeing about the
 * same licence.
 */
export async function hydrate(env: Env, rows: LicenceRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((l) => l.id);
  const placeholders = ids.map(() => '?').join(',');
  const terr = await env.DB.prepare(
    `SELECT licence_id, country_code FROM licence_territories
      WHERE licence_id IN (${placeholders}) ORDER BY country_code`,
  ).bind(...ids).all<{ licence_id: number; country_code: string }>();
  const seats = await env.DB.prepare(
    `SELECT licence_id, seat_type, seats_licensed FROM licence_seats
      WHERE licence_id IN (${placeholders})`,
  ).bind(...ids).all<{ licence_id: number; seat_type: string; seats_licensed: number }>();

  const byLicence = new Map<number, { territories: string[]; seats: Record<string, number> }>();
  for (const l of rows) byLicence.set(l.id, { territories: [], seats: {} });
  for (const t of terr.results || []) byLicence.get(t.licence_id)?.territories.push(t.country_code);
  for (const s of seats.results || []) {
    const e = byLicence.get(s.licence_id);
    if (e) e.seats[s.seat_type] = Number(s.seats_licensed) || 0;
  }
  return rows.map((l) => {
    const e = byLicence.get(l.id)!;
    const licensed = Object.values(e.seats).reduce((a, b) => a + b, 0);
    return {
      ...l,
      territories: e.territories,
      seats: e.seats,
      seats_licensed: licensed,
      seats_used: seatsUsed(),
    };
  });
}

/**
 * Everything blocking activation, as a list rather than a boolean, because
 * the operator needs to know WHICH thing. Mirrors the canvas's step 5: a
 * territory conflict blocks, a pending signature does not.
 */
async function activationBlockers(env: Env, licence: LicenceRow): Promise<string[]> {
  const out: string[] = [];
  if (licence.status === 'terminated') out.push('This licence is terminated.');
  if (licence.status === 'active') out.push('This licence is already active.');
  const terr = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM licence_territories WHERE licence_id = ?',
  ).bind(licence.id).first<{ n: number }>();
  if (!Number(terr?.n)) out.push('No territory is assigned. A licence with no country grants nothing.');
  const seats = await env.DB.prepare(
    'SELECT COALESCE(SUM(seats_licensed), 0) AS n FROM licence_seats WHERE licence_id = ?',
  ).bind(licence.id).first<{ n: number }>();
  if (!Number(seats?.n)) out.push('No seats are licensed.');
  if (licence.annual_fee_cents === null || licence.revenue_share_bps === null) {
    out.push('Commercial terms are incomplete — the fee and the revenue share are both required.');
  }
  if (!licence.renews_on) out.push('No renewal date is set.');
  return out;
}

/* ---------------------------------------------------------------- */

r.get('/', async (c) => {
  try {
    await requireAdmin(c);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM territory_licences ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1
                     WHEN 'pending_activation' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
         licence_ref`,
    ).all<LicenceRow>();
    return c.json({
      items: await hydrate(c.env, rows.results || []),
      // Said once, at the top, rather than implied by a column of dashes.
      seats_used_available: false,
      seats_used_reason:
        'Seats used needs every account to name the licence it belongs to. No account carries one '
        + 'yet — this is the licence ledger, not the tenancy scope — so utilisation is not shown '
        + 'rather than shown as zero.',
    });
  } catch (e) { return mapError(c, e); }
});

// Who holds what, for the step-2 picker. A country not listed here is free.
r.get('/territories', async (c) => {
  try {
    await requireAdmin(c);
    const rows = await c.env.DB.prepare(
      `SELECT lt.country_code, l.uid AS licence_uid, l.licence_ref, l.brand_name, l.status
         FROM licence_territories lt
         JOIN territory_licences l ON l.id = lt.licence_id
        ORDER BY lt.country_code`,
    ).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

// Step 1 — the entity.
r.post('/', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const ref = str(b?.licence_ref, 40).toUpperCase();
    const legalName = str(b?.legal_entity_name, 200);
    const brand = str(b?.brand_name, 200) || legalName;
    if (!ref || !legalName) {
      return c.json({ error: 'licence_ref and legal_entity_name are required' }, 400);
    }
    const clash = await c.env.DB.prepare('SELECT 1 AS x FROM territory_licences WHERE licence_ref = ?')
      .bind(ref).first<{ x: number }>();
    if (clash) return c.json({ error: `${ref} is already in use` }, 409);

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO territory_licences (uid, licence_ref, entity_id, legal_entity_name,
                                       brand_name, registered_address, signatory_name,
                                       signatory_title, status, created_by_user_id,
                                       created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'draft', ?,?,?)`,
    ).bind(
      uid, ref, intOrNull(b?.entity_id), legalName, brand,
      str(b?.registered_address) || null, str(b?.signatory_name, 200) || null,
      str(b?.signatory_title, 200) || null, admin.id, nowIso(), nowIso(),
    ).run();
    const created = await byUid(c.env, uid);
    if (created) await logEvent(c.env, created.id, 'created', admin.id, { licence_ref: ref });
    return c.json({ uid, licence_ref: ref, status: 'draft' }, 201);
  } catch (e) { return mapError(c, e); }
});

// Step 2 — territory. Refuses an overlap rather than recording one.
r.put('/:uid/territories', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    if (licence.status === 'terminated') {
      return c.json({ error: 'a terminated licence cannot be given territory' }, 409);
    }
    const b = await c.req.json().catch(() => ({} as any));
    const raw: unknown[] = Array.isArray(b?.countries) ? b.countries : [];
    const normalised: string[] = raw.map((x) => String(x ?? '').trim().toUpperCase());
    // Validate BEFORE de-duplicating: comparing a de-duplicated length against
    // the input length would report ['FR','FR'] — harmless — as an invalid
    // country code, which is a confusing thing to tell someone.
    const bad = normalised.filter((x) => !ISO2.test(x));
    if (bad.length) {
      return c.json({
        error: 'every country must be an ISO 3166-1 alpha-2 code',
        invalid: [...new Set(bad)],
      }, 400);
    }
    const wanted = [...new Set(normalised)];

    // Held by someone ELSE. A licence keeping its own countries is not a
    // conflict, and a suspended holder still counts — suspension does not
    // release territory.
    let conflicts: any[] = [];
    if (wanted.length) {
      const placeholders = wanted.map(() => '?').join(',');
      const held = await c.env.DB.prepare(
        `SELECT lt.country_code, l.licence_ref, l.brand_name, l.status
           FROM licence_territories lt
           JOIN territory_licences l ON l.id = lt.licence_id
          WHERE lt.country_code IN (${placeholders}) AND lt.licence_id != ?`,
      ).bind(...wanted, licence.id).all<any>();
      conflicts = held.results || [];
    }
    if (conflicts.length) {
      return c.json({
        error: 'territory_conflict',
        conflicts,
        message: conflicts.map((x) => `${x.country_code} is held by ${x.licence_ref} (${x.status})`).join('; '),
      }, 409);
    }

    const stmts = [
      c.env.DB.prepare('DELETE FROM licence_territories WHERE licence_id = ?').bind(licence.id),
      ...wanted.map((code) => c.env.DB.prepare(
        'INSERT INTO licence_territories (licence_id, country_code, created_at) VALUES (?,?,?)',
      ).bind(licence.id, code, nowIso())),
      c.env.DB.prepare('UPDATE territory_licences SET updated_at = ? WHERE id = ?')
        .bind(nowIso(), licence.id),
    ];
    // The unique index on country_code is the real guard: if another request
    // claimed a country between the check above and here, this batch fails
    // rather than double-recording it.
    await c.env.DB.batch(stmts);
    await logEvent(c.env, licence.id, 'territory_changed', admin.id, { countries: wanted });
    return c.json({ ok: true, countries: wanted });
  } catch (e) { return mapError(c, e); }
});

// Step 3 — seats.
r.put('/:uid/seats', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const seats: Record<string, number> = {};
    for (const t of SEAT_TYPES) {
      const n = intOrNull(b?.seats?.[t]);
      if (n !== null && n < 0) return c.json({ error: `${t} seats cannot be negative` }, 400);
      seats[t] = n ?? 0;
    }
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM licence_seats WHERE licence_id = ?').bind(licence.id),
      ...SEAT_TYPES.map((t) => c.env.DB.prepare(
        'INSERT INTO licence_seats (licence_id, seat_type, seats_licensed, created_at) VALUES (?,?,?,?)',
      ).bind(licence.id, t, seats[t], nowIso())),
      c.env.DB.prepare('UPDATE territory_licences SET updated_at = ? WHERE id = ?')
        .bind(nowIso(), licence.id),
    ]);
    await logEvent(c.env, licence.id, 'seats_changed', admin.id, seats);
    return c.json({ ok: true, seats });
  } catch (e) { return mapError(c, e); }
});

// Step 4 — commercial terms.
r.patch('/:uid/terms', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const bps = (v: unknown) => {
      const n = intOrNull(v);
      if (n === null) return null;
      // Basis points. A share above 100% is a typo, not a deal.
      return Math.min(10000, Math.max(0, n));
    };
    const fee = intOrNull(b?.annual_fee_cents);
    if (fee !== null && fee < 0) return c.json({ error: 'the annual fee cannot be negative' }, 400);
    const terms = {
      term_years: intOrNull(b?.term_years),
      annual_fee_cents: fee,
      currency: str(b?.currency, 3).toUpperCase() || licence.currency,
      revenue_share_bps: bps(b?.revenue_share_bps),
      token_split_bps: bps(b?.token_split_bps),
      starts_on: str(b?.starts_on, 32) || licence.starts_on,
      renews_on: str(b?.renews_on, 32) || licence.renews_on,
    };
    await c.env.DB.prepare(
      `UPDATE territory_licences
          SET term_years = ?, annual_fee_cents = ?, currency = ?, revenue_share_bps = ?,
              token_split_bps = ?, starts_on = ?, renews_on = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      terms.term_years, terms.annual_fee_cents, terms.currency, terms.revenue_share_bps,
      terms.token_split_bps, terms.starts_on, terms.renews_on, nowIso(), licence.id,
    ).run();
    await logEvent(c.env, licence.id, 'terms_changed', admin.id, terms);
    return c.json({ ok: true, ...terms });
  } catch (e) { return mapError(c, e); }
});

// Step 5 — what blocks activation, before trying it.
r.get('/:uid/activation', async (c) => {
  try {
    await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const blockers = await activationBlockers(c.env, licence);
    return c.json({
      blockers,
      can_activate: blockers.length === 0,
      // The canvas is explicit that a pending signature is NOT a blocker, and
      // says so on the screen rather than leaving it to be inferred.
      notes: ['A pending signature does not block activation.'],
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/activate', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const blockers = await activationBlockers(c.env, licence);
    if (blockers.length) return c.json({ error: 'blocked', blockers }, 409);
    await c.env.DB.prepare(
      "UPDATE territory_licences SET status = 'active', status_note = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), licence.id).run();
    await logEvent(c.env, licence.id, 'activated', admin.id);
    return c.json({ ok: true, status: 'active' });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/suspend', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const note = str(c.req.query('note') || (await c.req.json().catch(() => ({} as any)))?.note, 1000);
    if (!note) return c.json({ error: 'a suspension must record why' }, 400);
    // Territory rows are untouched on purpose: a suspended licence still holds
    // its countries. Releasing them is a termination, not a lapse.
    await c.env.DB.prepare(
      "UPDATE territory_licences SET status = 'suspended', status_note = ?, suspended_at = ?, updated_at = ? WHERE id = ?",
    ).bind(note, nowIso(), nowIso(), licence.id).run();
    await logEvent(c.env, licence.id, 'suspended', admin.id, null, note);
    return c.json({ ok: true, status: 'suspended', territory_released: false });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/reinstate', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    if (licence.status !== 'suspended') {
      return c.json({ error: 'only a suspended licence can be reinstated' }, 409);
    }
    await c.env.DB.prepare(
      "UPDATE territory_licences SET status = 'active', status_note = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), licence.id).run();
    await logEvent(c.env, licence.id, 'reinstated', admin.id);
    return c.json({ ok: true, status: 'active' });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/renew', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    // An explicit date wins. Otherwise push out by the term, from the CURRENT
    // renewal date rather than from today, so a late renewal does not silently
    // shorten the next period.
    let next = str(b?.renews_on, 32);
    if (!next) {
      const years = Number(licence.term_years) || 1;
      const base = licence.renews_on ? new Date(licence.renews_on) : new Date();
      if (Number.isNaN(base.getTime())) return c.json({ error: 'the current renewal date is unreadable — set one explicitly' }, 400);
      base.setFullYear(base.getFullYear() + years);
      next = base.toISOString().slice(0, 10);
    }
    await c.env.DB.prepare(
      'UPDATE territory_licences SET renews_on = ?, updated_at = ? WHERE id = ?',
    ).bind(next, nowIso(), licence.id).run();
    await logEvent(c.env, licence.id, 'renewed', admin.id, { renews_on: next });
    return c.json({ ok: true, renews_on: next });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/terminate', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const note = str((await c.req.json().catch(() => ({} as any)))?.note, 1000);
    if (!note) return c.json({ error: 'a termination must record why' }, 400);
    const released = await c.env.DB.prepare(
      'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
    ).bind(licence.id).all<{ country_code: string }>();
    const codes = (released.results || []).map((x) => x.country_code);
    // Termination is the ONLY thing that releases territory.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM licence_territories WHERE licence_id = ?').bind(licence.id),
      c.env.DB.prepare(
        "UPDATE territory_licences SET status = 'terminated', status_note = ?, terminated_at = ?, updated_at = ? WHERE id = ?",
      ).bind(note, nowIso(), nowIso(), licence.id),
    ]);
    await logEvent(c.env, licence.id, 'terminated', admin.id, { released: codes }, note);
    return c.json({ ok: true, status: 'terminated', released: codes });
  } catch (e) { return mapError(c, e); }
});

// Who administers this licence. Migration 190 — a subsidiary admin was not
// representable before it, because territory_licences names an entity, a brand
// and a signatory, and never a user.
//
// HQ writes this; the holder reads it through GET /api/licence/mine. Assigning
// an administrator is a contractual act, so it lands in licence_events like
// every other one.
r.get('/:uid/admins', async (c) => {
  try {
    await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const rows = await c.env.DB.prepare(
      `SELECT la.admin_role, la.created_at, u.id AS user_id, u.name, u.email
         FROM licence_admins la JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ? ORDER BY la.admin_role, u.email`,
    ).bind(licence.id).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/admins', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const email = str(b?.email, 320).toLowerCase();
    const role = str(b?.admin_role, 20) || 'principal';
    if (!email) return c.json({ error: 'an email address is required' }, 400);
    if (role !== 'principal' && role !== 'delegate') {
      return c.json({ error: "admin_role must be 'principal' or 'delegate'" }, 400);
    }
    // Resolve to an existing account, like the data room does. Assigning a
    // licence to an address nobody holds would create an administrator who
    // cannot sign in.
    const u = await c.env.DB.prepare('SELECT id, email FROM users WHERE LOWER(email) = ?')
      .bind(email).first<{ id: number; email: string }>();
    if (!u) return c.json({ error: 'no account with that address' }, 404);

    // licence_admins is UNIQUE on user_id alone — see migration 190. Report
    // the conflict rather than letting the insert fail opaquely.
    const held = await c.env.DB.prepare(
      `SELECT l.licence_ref FROM licence_admins la
         JOIN territory_licences l ON l.id = la.licence_id
        WHERE la.user_id = ? AND la.licence_id != ?`,
    ).bind(u.id, licence.id).first<{ licence_ref: string }>();
    if (held) {
      return c.json({ error: `that account already administers ${held.licence_ref}` }, 409);
    }

    await c.env.DB.prepare(
      `INSERT INTO licence_admins (licence_id, user_id, admin_role, granted_by_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET admin_role = excluded.admin_role`,
    ).bind(licence.id, u.id, role, admin.id).run();
    await logEvent(c.env, licence.id, 'terms_changed', admin.id,
      { administrator_added: u.email, admin_role: role });
    return c.json({ ok: true, user_id: u.id, admin_role: role });
  } catch (e) { return mapError(c, e); }
});

r.delete('/:uid/admins/:userId{[0-9]+}', async (c) => {
  try {
    const admin = await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const userId = Number(c.req.param('userId'));
    const gone = await c.env.DB.prepare(
      'SELECT u.email FROM licence_admins la JOIN users u ON u.id = la.user_id WHERE la.licence_id = ? AND la.user_id = ?',
    ).bind(licence.id, userId).first<{ email: string }>();
    if (!gone) return c.json({ error: 'not_found' }, 404);
    await c.env.DB.prepare('DELETE FROM licence_admins WHERE licence_id = ? AND user_id = ?')
      .bind(licence.id, userId).run();
    await logEvent(c.env, licence.id, 'terms_changed', admin.id,
      { administrator_removed: gone.email });
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    await requireAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const [full] = await hydrate(c.env, [licence]);
    const events = await c.env.DB.prepare(
      `SELECT event, detail_json, note, created_at FROM licence_events
        WHERE licence_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`,
    ).bind(licence.id).all<any>();
    return c.json({
      ...full,
      events: events.results || [],
      blockers: await activationBlockers(c.env, licence),
      holds_territory: HOLDS_TERRITORY.includes(licence.status),
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
