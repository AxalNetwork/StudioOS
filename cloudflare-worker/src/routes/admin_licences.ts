/**
 * Territory licences — the HQ ledger behind the subsidiary model.
 *
 * SUPER ADMIN ONLY, every route including the reads (migration 199). This is
 * the franchisor's console: it issues, re-terms, suspends, renews and
 * terminates other people's licences, and its lists are every licensee's
 * commercial terms side by side. An admin who can operate it is not a
 * subsidiary of anything.
 *
 * The licensee's own view is `routes/licence.ts` (`GET /licence/mine`), which
 * stays on plain auth — a subsidiary admin reads their licence there and
 * cannot reach anyone else's from here.
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
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import {
  DEFAULT_RESPOND_DAYS, MAX_RESPOND_DAYS, MIN_RESPOND_DAYS, NOTICE_KINDS,
  freezeHoldersForLicence, notifyLicenceAdmins,
} from '../services/complianceLadder';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { hashEmail } from '../util/hashEmail';
import { ensureLegalTemplatesSchema, getTemplate, listTemplates } from '../services/legalTemplateStore';
import { mergeValues, renderContract } from '../services/licenceContract';

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

/** What each notice kind is called in the mail. The CHECK's four values are
 *  machine words; this is the sentence the addressee reads. */
const KIND_LABELS: Record<string, string> = {
  renewal_terms: 'Renewal terms',
  fees: 'Fees',
  term_violation: 'A term of the agreement',
  other: 'Your licence',
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
 * Seats used, which is deliberately unknowable HERE and knowable on a branch.
 *
 * The canvas shows "% utilised" against seats licensed. Computing it at HQ
 * needs every account to name the licence it belongs to, and no account does
 * (U1) — that is the scoping half this ledger does not build. Returning null
 * makes the UI say so; returning 0 would read as "nobody has signed up",
 * which is a different and false claim.
 *
 * A BRANCH CAN COUNT ITS OWN, AND THAT IS NOT AN INCONSISTENCY (D127). Every
 * user in a branch's D1 *is* that branch's, so `rpc/branchOps.ts` counts
 * active accounts whose role is one a licence sells a seat for. HQ has no
 * equivalent question to ask of its own table. The two tiers answer
 * differently because the tiers differ, not because one of them is behind —
 * and `seats_used_available: false` below still says so on this side.
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
    await requireSuperAdmin(c);
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
    await requireSuperAdmin(c);
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
    const admin = await requireSuperAdmin(c);
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
    const admin = await requireSuperAdmin(c);
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
    const admin = await requireSuperAdmin(c);
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
    const admin = await requireSuperAdmin(c);
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
    await requireSuperAdmin(c);
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
    const admin = await requireSuperAdmin(c);
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
    const admin = await requireSuperAdmin(c);
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
    // D135 — THIS FILE HAD ZERO `notify()` CALLS. Suspending a licence changed
    // four columns in HQ's ledger and told the holder nothing: they found out by
    // hitting a 423. "First admins get notified" is the ladder's first sentence,
    // so this is the missing half of the flow rather than an addition to it.
    await notifyLicenceAdmins(c.env, licence.id, {
      type: 'licence_suspended',
      title: 'Your licence has been suspended by HQ',
      body: `${note} Your territory is not released — suspension is not a lapse — and reading is unaffected.`,
      payload: { licence_uid: licence.uid },
    });
    return c.json({ ok: true, status: 'suspended', territory_released: false });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/reinstate', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    if (licence.status !== 'suspended') {
      return c.json({ error: 'only a suspended licence can be reinstated' }, 409);
    }
    await c.env.DB.prepare(
      "UPDATE territory_licences SET status = 'active', status_note = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?",
    ).bind(nowIso(), licence.id).run();
    await logEvent(c.env, licence.id, 'reinstated', admin.id);
    await notifyLicenceAdmins(c.env, licence.id, {
      type: 'licence_reinstated',
      title: 'Your licence is active again',
      body: 'HQ has reinstated it. Your account can make changes again.',
      payload: { licence_uid: licence.uid },
    });
    return c.json({ ok: true, status: 'active' });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/renew', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
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
    const admin = await requireSuperAdmin(c);
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
    // Told LAST, after the batch, because a notification about a termination
    // that then failed to apply is worse than a late one. The administrators
    // are still bound at this point — D134's detach is a separate act — so the
    // lookup still finds them.
    await notifyLicenceAdmins(c.env, licence.id, {
      type: 'licence_terminated',
      title: 'Your licence has been terminated',
      body: `${note} ${codes.length ? `The ${codes.length === 1 ? 'territory' : `${codes.length} territories`} it held ${codes.length === 1 ? 'has' : 'have'} been released.` : ''}`.trim(),
      payload: { licence_uid: licence.uid, released: codes },
    });
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
//
// D134 — THIS IS THE DOOR ADMIN ACCOUNTS ARE OPENED THROUGH, and until D134 it
// was half a door. `POST` wrote the binding and left `users.role` alone, so the
// only way to actually mint an admin was SQL against production —
// `PATCH /api/admin/users/:userId/role` refuses `role === 'admin'` outright and
// still does. The user's model is that one super admin opens, supervises, bans
// and closes many subsidiary admins; "open" had no route at all.
//
// So the promotion happens HERE, bound to a licence in the same batch, and that
// ordering is the point: an admin minted through this door is licence-bound by
// construction and there is no path that produces an unscoped one. The reverse
// is deliberately NOT symmetric — `DELETE` refuses while the account still
// holds the role, because detaching first would leave exactly the unscoped
// admin this door exists to make impossible. Demote, then detach; the demote is
// `POST /api/admin/users/:userId/demote-admin`, and `GET` returns `u.role` so
// the state between the two steps is on the screen rather than inferred.
r.get('/:uid/admins', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    // `u.role` and `u.is_active` are the two facts that make the row honest
    // rather than a name: a binding survives a demotion and survives a
    // deactivation, so a list that showed neither would render a closed
    // account and a live one identically. The transient state between demote
    // and detach is visible for the same reason.
    const rows = await c.env.DB.prepare(
      `SELECT la.admin_role, la.created_at, u.id AS user_id, u.name, u.email,
              u.role, u.is_active
         FROM licence_admins la JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ? ORDER BY la.admin_role, u.email`,
    ).bind(licence.id).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/admins', async (c) => {
  try {
    // D134 — THE WRITE BAR, not the plain elevation. Every other route in this
    // file re-terms or suspends a licence; this one mints an administrator, and
    // the thing it is closest to is impersonation, which has always wanted a
    // TOTP-minted session and a recent step-up. A super-admin session left open
    // on a desk should not be able to create a peer.
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const email = str(b?.email, 320).toLowerCase();
    const role = str(b?.admin_role, 20) || 'principal';
    const reason = str(b?.reason, 500);
    if (!email) return c.json({ error: 'an email address is required' }, 400);
    if (role !== 'principal' && role !== 'delegate') {
      return c.json({ error: "admin_role must be 'principal' or 'delegate'" }, 400);
    }
    // The same rule the impersonation reason carries, for the same reason:
    // enforced server-side because a UI-only rule would be a convention rather
    // than a control, and ten characters because this is the line somebody
    // reads in the audit when they ask why an account has admin.
    if (reason.length < 10) {
      return c.json({
        error: 'A reason of at least 10 characters is required — minting an administrator is the line someone reads in the audit later.',
        code: 'reason_too_short',
      }, 400);
    }
    // Resolve to an existing account, like the data room does. Assigning a
    // licence to an address nobody holds would create an administrator who
    // cannot sign in.
    const u = await c.env.DB.prepare('SELECT id, email, role FROM users WHERE LOWER(email) = ?')
      .bind(email).first<{ id: number; email: string; role: string }>();
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

    // ONE BATCH, AND THE ORDER OF THE TWO WRITES DOES NOT MATTER — that they
    // are one statement does. A binding without the role is an administrator
    // who cannot administer; the role without a binding is the unscoped admin
    // the whole door exists to prevent. Either alone is a state somebody would
    // have to notice and repair by hand.
    const previousRole = String(u.role || '');
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO licence_admins (licence_id, user_id, admin_role, granted_by_user_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET admin_role = excluded.admin_role`,
      ).bind(licence.id, u.id, role, admin.id),
      c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(u.id),
    ]);
    await logEvent(c.env, licence.id, 'terms_changed', admin.id,
      { administrator_added: u.email, admin_role: role, promoted_from: previousRole }, reason);
    // The account's OWN feed learns it too. `role_changed` / `your_role_changed`
    // are the pair `routes/admin.ts` already writes and every audit reader
    // already renders; a new action name would show up nowhere until three
    // separate allowlists were swept, which is the failure that pair's own
    // comment describes.
    try {
      const actorHash = await hashEmail(admin.email);
      const targetHash = await hashEmail(u.email);
      await c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?,?,?,?)',
        ).bind('role_changed',
          `Super admin ${admin.name} made ${u.email} an administrator of ${licence.licence_ref} (was ${previousRole || 'unrecorded'}). Reason: ${reason}`,
          actorHash, admin.id),
        c.env.DB.prepare(
          'INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?,?,?,?)',
        ).bind('your_role_changed',
          `You were made an administrator of ${licence.licence_ref} by ${admin.name}`,
          targetHash, u.id),
      ]);
    } catch (e) {
      console.warn('[licences/admins] activity log failed', (e as Error).message);
    }
    return c.json({ ok: true, user_id: u.id, admin_role: role, role: 'admin', promoted_from: previousRole });
  } catch (e) { return mapError(c, e); }
});

r.delete('/:uid/admins/:userId{[0-9]+}', async (c) => {
  try {
    // Same bar as the add, because the two are one power read from either end.
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const userId = Number(c.req.param('userId'));
    const gone = await c.env.DB.prepare(
      'SELECT u.email, u.role FROM licence_admins la JOIN users u ON u.id = la.user_id WHERE la.licence_id = ? AND la.user_id = ?',
    ).bind(licence.id, userId).first<{ email: string; role: string }>();
    if (!gone) return c.json({ error: 'not_found' }, 404);
    // D134 — DETACH REFUSES WHILE THEY ARE STILL AN ADMIN, and this is the
    // asymmetry that makes the add safe. `POST` above binds and promotes in one
    // batch precisely so no admin exists without a licence behind them;
    // unbinding first would produce exactly that account — role intact, nothing
    // naming which territory it belongs to, and no screen that lists it.
    //
    // The refusal names the step rather than stating a policy, because the
    // caller's next action is a single route away and a 409 that does not say
    // which one is a dead end.
    if (String(gone.role).toLowerCase() === 'admin') {
      return c.json({
        error: `${gone.email} still holds the admin role. Demote the account first `
          + '(POST /api/admin/users/:userId/demote-admin) — detaching alone would leave an '
          + 'administrator with no licence behind them.',
        code: 'still_an_admin',
      }, 409);
    }
    await c.env.DB.prepare('DELETE FROM licence_admins WHERE licence_id = ? AND user_id = ?')
      .bind(licence.id, userId).run();
    await logEvent(c.env, licence.id, 'terms_changed', admin.id,
      { administrator_removed: gone.email });
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * The compliance ladder — HQ's half (D135)                             *
 * ------------------------------------------------------------------ */

// "First admins get notified; if admins do not act on notifications, admin
// accounts are frozen until they act; and lastly if they don't comply admin
// accounts are terminated." These three routes are the first and third of
// those: HQ issues a notice with a deadline, and HQ reads the response and
// accepts or rejects it. The middle rung — the freeze — belongs to a clock, in
// `services/complianceLadder.ts`, because a rung a person has to remember to
// climb is not a ladder.
//
// THE NOTICE IS NOT A LICENCE EVENT, and that is deliberate rather than an
// omission. `licence_events`' CHECK admits nine values (migration 187) and
// "notice issued" is not one of them; writing `terms_changed` instead would put
// a false sentence in the one table a contract dispute reads. The notice row IS
// the record. What DOES reach `licence_events` is the `suspended` the sweep
// performs, which is a real transition and is in the CHECK.
//
// AND THE ADDRESSEE MUST ADMINISTER THIS LICENCE. A notice about a territory
// sent to someone who does not hold it is a notice with no remedy behind it:
// the freeze would land on an account whose licence is somebody else's.

r.get('/:uid/notices', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    let items: any[] = [];
    let readable = true;
    try {
      const res = await c.env.DB.prepare(
        `SELECT n.uid, n.kind, n.subject, n.body, n.respond_by, n.status,
                n.response, n.responded_at, n.review_note, n.reviewed_at,
                n.froze_at, n.created_at,
                u.id AS user_id, u.name, u.email
           FROM admin_notices n JOIN users u ON u.id = n.user_id
          WHERE n.licence_id = ?
          ORDER BY n.id DESC`,
      ).bind(licence.id).all<any>();
      items = res.results || [];
    } catch { readable = false; }
    return c.json({
      items: readable ? items : [],
      // An unreadable table is NOT "no notices". A database that has not applied
      // migration 264 must say so rather than render an empty list, which is a
      // claim about the licence that nothing measured.
      notices_available: readable,
      ...(readable ? {} : {
        notices_reason: 'The admin_notices table could not be read on this database (migration 264).',
      }),
      freeze_holders: readable ? await freezeHoldersForLicence(c.env, licence.id) : null,
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/notices', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const kind = str(b?.kind, 32);
    const subject = str(b?.subject, 200);
    const body = str(b?.body, 5000);
    const email = str(b?.email, 320).toLowerCase();
    if (!(NOTICE_KINDS as readonly string[]).includes(kind)) {
      return c.json({ error: `kind must be one of ${NOTICE_KINDS.join(', ')}`, code: 'bad_kind' }, 400);
    }
    if (subject.length < 3) return c.json({ error: 'a notice needs a subject' }, 400);
    // The body IS the notice. A ten-character floor for the same reason every
    // other reason field on this tier has one: it is what the addressee reads
    // when deciding what to do, and what a tribunal reads afterwards.
    if (body.length < 10) {
      return c.json({
        error: 'A notice body of at least 10 characters is required — it is what the addressee has to act on.',
        code: 'body_too_short',
      }, 400);
    }
    const days = Math.min(MAX_RESPOND_DAYS, Math.max(MIN_RESPOND_DAYS,
      Number.isFinite(Number(b?.respond_days)) ? Math.trunc(Number(b.respond_days)) : DEFAULT_RESPOND_DAYS));

    const target = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name FROM licence_admins la JOIN users u ON u.id = la.user_id
        WHERE la.licence_id = ? AND LOWER(u.email) = ?`,
    ).bind(licence.id, email).first<{ id: number; email: string; name: string }>();
    if (!target) {
      return c.json({
        error: `no administrator of ${licence.licence_ref} with that address — a notice has to reach someone who can act on it`,
        code: 'not_an_administrator',
      }, 404);
    }

    const uid = newUid();
    try {
      // `respond_by` is computed in SQL, never bound as an ISO string. The
      // column is swept against `datetime('now')`, and an ISO value compared
      // there is ALWAYS the greater one — a deadline that does not bite until
      // the UTC date rolls over. One writer, one format.
      await c.env.DB.prepare(
        `INSERT INTO admin_notices
           (uid, user_id, licence_id, kind, subject, body, issued_by_user_id, respond_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), 'issued')`,
      ).bind(uid, target.id, licence.id, kind, subject, body, admin.id, `+${days} days`).run();
    } catch (e) {
      const msg = String((e as Error).message || '');
      if (/no such table/i.test(msg)) {
        return c.json({
          error: 'The admin_notices table does not exist on this database (migration 264 has not been applied).',
          code: 'store_missing',
        }, 503);
      }
      throw e;
    }

    const row = await c.env.DB.prepare(
      'SELECT uid, respond_by, status FROM admin_notices WHERE uid = ?',
    ).bind(uid).first<{ uid: string; respond_by: string; status: string }>();

    // `send()` and NOT `notify()` here, and the difference is worth stating
    // because the two look interchangeable and are not. `send()` renders a
    // DESIGNED template, queues through JOB_QUEUE so a failure retries into the
    // DLQ, writes `email_send_log`, and mirrors the message into the inbox with
    // its category and CTA — six modules already use it. `notify()` has no
    // template: it sends `[Axal] <title>` with the body as plain text. A notice
    // is the one piece of mail on this ladder that is worth designing, so it
    // goes through the path that can render one. The freeze that follows uses
    // `notify()`, because by then the person is looking at a 423 and what they
    // need is one sentence and the route back.
    let delivered = false;
    try {
      const { send } = await import('../services/email/send');
      const res = await send(c.env, 'compliance_notice_issued', target.email, {
        name: target.name || target.email,
        subject,
        kind_label: KIND_LABELS[kind] ?? kind,
        respond_by: String(row?.respond_by || ''),
        body,
        licence_url: `${String((c.env as any).APP_URL || 'https://axal.vc')}/admin/my-licence`,
      }, { userId: target.id });
      delivered = Boolean(res?.ok);
    } catch (e) { console.warn('[compliance] notice mail failed', (e as Error).message); }

    return c.json({
      ok: true,
      notice: { uid, status: row?.status ?? 'issued', respond_by: row?.respond_by ?? null },
      // Whether the message actually left, reported rather than assumed — the
      // `email_sent` argument migration 236 already made: a notice nobody was
      // told about is a different thing from one that is merely unanswered, and
      // the ladder's next rung freezes an account over the difference.
      email_sent: delivered,
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/notices/:noticeUid/review', async (c) => {
  try {
    const admin = await requireSuperAdminWriteBar(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const decision = str(b?.decision, 16);
    const note = str(b?.note, 1000);
    if (decision !== 'accept' && decision !== 'reject') {
      return c.json({ error: "decision must be 'accept' or 'reject'", code: 'bad_decision' }, 400);
    }
    const notice = await c.env.DB.prepare(
      'SELECT id, uid, user_id, status FROM admin_notices WHERE uid = ? AND licence_id = ?',
    ).bind(c.req.param('noticeUid'), licence.id).first<{ id: number; uid: string; user_id: number; status: string }>();
    if (!notice) return c.json({ error: 'not_found' }, 404);
    // A CLICK BY THE PERSON WHO OWES A FEE IS NOT EVIDENCE THE FEE WAS PAID —
    // which is why HQ reviews and lifts, and why there is nothing to review
    // until the addressee has actually said something.
    if (notice.status !== 'responded') {
      return c.json({
        error: `this notice is ${notice.status}; there is nothing to review until the addressee has responded`,
        code: 'not_responded',
      }, 409);
    }
    const next = decision === 'accept' ? 'accepted' : 'rejected';
    await c.env.DB.prepare(
      `UPDATE admin_notices
          SET status = ?, reviewed_by_user_id = ?, reviewed_at = datetime('now'),
              review_note = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(next, admin.id, note || null, notice.id).run();

    // ACCEPTING LIFTS THE FREEZE ONLY WHEN IT WAS THE LAST THING HOLDING IT.
    // Two outstanding notices and one accepted is still a frozen account; the
    // count is what says which. Reinstatement reuses the licence's own state —
    // there is no second flag to keep in step.
    let reinstated = false;
    const holders = await freezeHoldersForLicence(c.env, licence.id);
    if (next === 'accepted' && holders === 0 && licence.status === 'suspended') {
      await c.env.DB.prepare(
        "UPDATE territory_licences SET status = 'active', status_note = NULL, suspended_at = NULL, updated_at = ? WHERE id = ? AND status = 'suspended'",
      ).bind(nowIso(), licence.id).run();
      await logEvent(c.env, licence.id, 'reinstated', admin.id, { notice_uid: notice.uid }, note || null);
      reinstated = true;
    }
    await notifyLicenceAdmins(c.env, licence.id, {
      type: next === 'accepted' ? 'compliance_accepted' : 'compliance_rejected',
      title: next === 'accepted'
        ? 'HQ accepted your response'
        : 'HQ did not accept your response',
      body: next === 'accepted'
        ? (reinstated
          ? 'Your licence is active again and your account can write.'
          : `Accepted. ${holders} other notice${holders === 1 ? '' : 's'} still outstanding, so the freeze stays until those are answered.`)
        : `Your account stays frozen.${note ? ` HQ's note: ${note}` : ''}`,
      payload: { notice_uid: notice.uid, decision: next },
    });
    return c.json({ ok: true, status: next, freeze_holders: holders, reinstated });
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * H3 step 5 — the contract, instantiated from a master template        *
 * ------------------------------------------------------------------ */

// GET /:uid/contract — what has been instantiated, and what could be.
//
// THE TEMPLATE LIST AND THE CONTRACT LIST COME BACK TOGETHER because the
// screen's two states are "pick one" and "here is the one you picked", and a
// second request to learn which of those it is would be a request whose
// failure mode is a picker that renders empty for a licence that already has
// a contract.
r.get('/:uid/contract', async (c) => {
  try {
    await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);

    let contracts: any[] = [];
    let store = true;
    try {
      const q = await c.env.DB.prepare(
        `SELECT uid, template_slug, template_version, template_title, unfilled_fields,
                status, envelope_uid, superseded_at, created_at, sent_at, signed_at
           FROM licence_contracts WHERE licence_uid = ? ORDER BY created_at DESC, id DESC`,
      ).bind(licence.uid).all<any>();
      contracts = (q.results || []).map((row) => ({
        ...row,
        unfilled_fields: JSON.parse(String(row.unfilled_fields || '[]')),
      }));
    } catch { store = false; }

    await ensureLegalTemplatesSchema(c.env);
    const templates = await listTemplates(c.env);

    return c.json({
      licence_uid: licence.uid,
      contracts,
      contracts_available: store,
      ...(store ? {} : {
        contracts_reason:
          'The licence_contracts table could not be read on this database (migration 259).',
      }),
      // What the master library actually holds. Offered as-is rather than
      // filtered to a "licence agreement" category: `legal_templates` has four
      // categories and none of them is that, so a filter would show an empty
      // picker over a library that is not empty.
      templates: templates.map((t) => ({
        slug: t.slug, title: t.title, category: t.category, version: t.version,
      })),
      ...(templates.length ? {} : {
        templates_reason:
          'HQ has authored no master templates yet, so there is nothing to instantiate. '
          + 'The library lives on Contracts.',
      }),
    });
  } catch (e) { return mapError(c, e); }
});

// POST /:uid/contract — instantiate the named template at its current version.
//
// THE VERSION IS READ, NOT PASSED. A caller naming a version could instantiate
// an archived one, and the rule the library runs on is that an archived
// version stays binding on contracts that ALREADY carry it — not that it can
// be newly issued. The current version is the only one HQ is offering today.
r.post('/:uid/contract', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return c.json({ error: 'not_found' }, 404);

    const b = await c.req.json().catch(() => ({} as any));
    const slug = str(b?.template_slug, 120);
    if (!slug) return c.json({ error: 'template_slug is required' }, 400);

    await ensureLegalTemplatesSchema(c.env);
    const tpl = await getTemplate(c.env, slug);
    if (!tpl) return c.json({ error: 'template_not_found', template_slug: slug }, 404);

    const [terr, seats] = await Promise.all([
      c.env.DB.prepare(
        'SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code',
      ).bind(licence.id).all<{ country_code: string }>(),
      c.env.DB.prepare(
        'SELECT seat_type, seats_licensed FROM licence_seats WHERE licence_id = ? ORDER BY seat_type',
      ).bind(licence.id).all<{ seat_type: string; seats_licensed: number }>(),
    ]);

    const { body, unfilled } = renderContract(
      tpl.body_md,
      mergeValues(licence, (terr.results || []).map((t) => t.country_code), seats.results || []),
    );

    // The prior contract is SUPERSEDED, never deleted or edited — the same
    // rule licence_events runs on, and for the same reason: a contract
    // dispute is exactly the case where the overwritten copy was the one that
    // mattered.
    const now = nowIso();
    await c.env.DB.prepare(
      'UPDATE licence_contracts SET superseded_at = ?, updated_at = ? WHERE licence_uid = ? AND superseded_at IS NULL',
    ).bind(now, now, licence.uid).run();

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO licence_contracts
         (uid, licence_uid, template_slug, template_version, template_title, body_md,
          unfilled_fields, status, created_by_user_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'draft', ?,?,?)`,
    ).bind(
      uid, licence.uid, tpl.slug, tpl.version, tpl.title, body,
      JSON.stringify(unfilled), admin.id, now, now,
    ).run();

    await logEvent(c.env, licence.id, 'contract_instantiated', admin.id, {
      contract_uid: uid, template_slug: tpl.slug, template_version: tpl.version,
      unfilled_fields: unfilled,
    });

    return c.json({
      uid,
      template_slug: tpl.slug,
      template_version: tpl.version,
      template_title: tpl.title,
      status: 'draft',
      unfilled_fields: unfilled,
      body_md: body,
      // Said here because the screen's next control is Activate, and the rule
      // is the canvas's own.
      note: 'Instantiated unsigned. A pending signature does not block activation; a territory conflict does.',
    }, 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
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
