/**
 * The subsidiary administrator's read of their OWN territory licence.
 *
 * WHY THIS IS SEPARATE FROM admin_licences.ts. That file is HQ's ledger: every
 * licence, and every write. This is one licence, read-only, for the person who
 * administers it. A subsidiary admin is not a super admin — the design is
 * explicit that they have "their own profile and a different dashboard" — and
 * the cleanest expression of that is a different route with a different guard,
 * not a `role === 'admin'` branch inside HQ's endpoints.
 *
 * WHAT IT WILL NOT SHOW, and why the endpoint says so instead of leaving a
 * hole for the UI to fill. Migration 187 built the licence LEDGER and was
 * explicit that it is not the tenancy SCOPE: no account, project, deal or
 * document carries a licence_id. So accounts in territory, revenue per
 * subsidiary and the whole approval queue in the canvas cannot be computed —
 * not "are zero", cannot be computed. Every one of them would need
 * account→licence attribution.
 *
 * SEATS USED IS THE ONE THAT CAME OFF THAT LIST (D127), and only on a branch.
 * A branch does not need account→licence attribution to count its own
 * accounts: every user in its database *is* its own. So on a branch this
 * returns a number, counted from active accounts whose role is one a licence
 * sells a seat for — a definition rather than a seat ledger, which
 * `seats_used_basis` states in the payload. On HQ it stays null, because there
 * the attribution really is what is missing.
 *
 * The response therefore carries `derived_metrics_available: false` and a
 * reason — a DIFFERENT reason per tier, since the same sentence cannot be true
 * on both — in the same spirit as the fund-analytics rule: an unmeasured number
 * is unknown, and a surface that says so is worth more than one that shows a
 * plausible zero. Seats LICENSED is in the ledger and IS shown.
 *
 * Migration 190 supplies the one thing that was missing to make any of this
 * addressable: `licence_admins`, which says who administers what. Before it,
 * "which licence is this admin's?" had no answer at all.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { hydrate, type LicenceRow } from './admin_licences';
// The roles a licence sells a seat for. Imported rather than re-listed, so the
// branch overview and this page cannot disagree about what a seat is (D127).
import { SEAT_ROLES } from '../rpc/branchOps';

const r = new Hono<{ Bindings: Env }>();

/** The `branch_licence` singleton (migration 256), or null. */
type BranchLicenceRow = {
  licence_uid: string;
  licence_ref: string | null;
  legal_entity: string | null;
  brand_name: string | null;
  territory: string;
  status: string;
  seats_json: string | null;
  revenue_share_bps: number | null;
  token_split_bps: number | null;
  annual_fee_cents: number | null;
  currency: string | null;
  term_start: string | null;
  term_end: string | null;
  renewal_at: string | null;
  template_version: string | null;
  suspended_at: string | null;
  suspended_note: string | null;
  // Migration 265 — the five `MyLicencePage` reads and the copy never carried.
  registered_address: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  term_years: number | null;
  terminated_at: string | null;
  pushed_at: string;
};

/**
 * The same payload, read from the copy HQ pushed (D106, migration 256).
 *
 * WHY A BRANCH CANNOT USE THE QUERY BELOW. `licence_admins` and
 * `territory_licences` exist in a branch database — it is bootstrapped from
 * the same baseline — and they are EMPTY, because the ledger is HQ's. So the
 * normal path would answer 404 "You do not administer a territory licence" to
 * the one person on the deployment who does. That is not a missing row, it is
 * a row in another database, and the two must not read alike.
 *
 * `source` and `as_of` ride the response because everything a branch shows
 * from HQ shows its age (S6, D.10). A screen that renders this without the
 * stamp is showing a copy as though it were live.
 */
async function branchLicencePayload(env: Env, code: string) {
  let row: BranchLicenceRow | null = null;
  try {
    row = await env.DB.prepare(
      `SELECT licence_uid, licence_ref, legal_entity, brand_name, territory, status, seats_json,
              revenue_share_bps, token_split_bps, annual_fee_cents, currency, term_start, term_end,
              renewal_at, template_version, suspended_at, suspended_note,
              registered_address, signatory_name, signatory_title, term_years, terminated_at,
              pushed_at
         FROM branch_licence WHERE id = 1`,
    ).first<BranchLicenceRow>();
  } catch (e) {
    // A branch whose migration 256 has not been applied. Say so rather than
    // reading as "no licence": provisioning has not finished, and the two
    // states need different answers from support.
    console.warn('[licence] branch_licence unreadable', (e as Error).message);
    return {
      error: 'licence_not_pushed',
      message: 'HQ has not pushed this branch its licence yet.',
      branch: code,
    } as const;
  }
  if (!row) {
    return {
      error: 'licence_not_pushed',
      message: 'HQ has not pushed this branch its licence yet.',
      branch: code,
    } as const;
  }

  const territories = row.territory.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  let seats: Record<string, number> = {};
  try {
    const parsed = row.seats_json ? JSON.parse(row.seats_json) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) seats[k] = n;
      }
    }
  } catch { seats = {}; }

  // SEATS USED, COUNTED THE ONE WAY THIS TIER CAN (D127). Its own try/catch,
  // because a failed count must not blank the licence summary beside it — the
  // whole page exists to show terms, and an unreadable `users` table is a
  // different and smaller problem. `null` on failure keeps the distinction the
  // canvas draws between "unknown" and "zero".
  //
  // NO `IN (…)` AND NO INTERPOLATION. A first draft built the placeholder list
  // with `${SEAT_ROLES.map(() => '?').join(', ')}`, which `check-sql-prepare`
  // refused — correctly, even though that particular expression can only emit
  // `?, ?, ?, ?`: the rule is that nothing reaches the query TEXT, and a rule
  // with a "provably safe" exemption is one somebody widens later. Counting by
  // role and summing in JS removes the question, and it has a better property
  // besides — this is byte-for-byte the query `branchOverview` runs, so the
  // two readers of this figure cannot drift into asking different things.
  //
  // THE BREAKDOWN IS THE SAME ROWS UN-SUMMED (D129). S2 draws one tile per
  // licence type, so the page needs used-per-type beside licensed-per-type;
  // deriving that from a total would mean a second query asking a subtly
  // different question, which is the drift the paragraph above exists to
  // prevent. `seats_used` stays the sum of exactly these entries, so the tiles
  // and the total cannot disagree — asserted rather than assumed.
  let seatsUsedHere: number | null = null;
  let seatsUsedByType: Record<string, number> | null = null;
  try {
    const seated = await env.DB.prepare(
      'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role',
    ).all<{ role: string; n: number }>();
    // EVERY SEAT ROLE GETS A KEY, INCLUDING THE ZEROES. A role with no active
    // account returns no row at all, and a map missing that key would make the
    // page choose between rendering nothing and inventing a zero. Here the zero
    // is measured: the query ran, the role has none. That is a different claim
    // from `seats_used_by_type: null`, which is what an unreadable table gives.
    const byType: Record<string, number> = {};
    for (const role of SEAT_ROLES) byType[role] = 0;
    let sum = 0;
    for (const row of seated.results || []) {
      const role = String(row.role);
      if (!(SEAT_ROLES as readonly string[]).includes(role)) continue;
      const n = Number(row.n) || 0;
      byType[role] = n;
      sum += n;
    }
    seatsUsedHere = sum;
    seatsUsedByType = byType;
  } catch (e) {
    console.warn('[licence] seats used unreadable', (e as Error).message);
  }

  return {
    licence: {
      uid: row.licence_uid,
      // THE KEYS ARE HQ'S, NOT THE TABLE'S. `branch_licence` stores
      // `legal_entity`; the HQ payload this is a copy of calls the same fact
      // `legal_entity_name`, and `MyLicencePage` reads the HQ name. A copy
      // that renamed its own fields would render blank on exactly the tier it
      // was built for — which is what it did until this line, and is why the
      // page's fields are read off this object in its test rather than
      // assumed to line up.
      licence_ref: row.licence_ref,
      legal_entity_name: row.legal_entity,
      brand_name: row.brand_name,
      status: row.status,
      territories,
      seats,
      seats_licensed: Object.values(seats).reduce((a, b) => a + b, 0),
      // D127 — THIS IS NOW A NUMBER, and the comment it replaces was wrong on
      // its own terms: it said "PR 5 builds `seat_assignments`", PR 5 shipped,
      // and it built none. A branch can count its own seats because every user
      // in this database *is* this branch's; what it counts is roles, which is
      // a definition rather than a seat ledger — `seats_used_basis` below says
      // so on the screen rather than leaving the number to be read as more
      // than it is.
      seats_used: seatsUsedHere,
      // D129 — what S2's four tiles read. `null` only when the count failed;
      // a role with no account is a measured 0, not a missing key.
      seats_used_by_type: seatsUsedByType,
      seats_used_basis:
        'Active accounts whose role is one a licence sells a seat for. Role is not a licensed seat: '
        + 'no seat has an id, and none is assigned or released.',
      revenue_share_bps: row.revenue_share_bps,
      token_split_bps: row.token_split_bps,
      annual_fee_cents: row.annual_fee_cents,
      currency: row.currency,
      // D137 — THE REST OF THE RENAME THE COMMENT ABOVE STARTED. That comment
      // was applied to `legal_entity` alone and stopped, so seven more fields
      // went on being emitted under the TABLE's names while `MyLicencePage`
      // read HQ's. Every one of them rendered blank on exactly the tier the
      // copy exists for — including `status_note`, which is the sentence
      // saying WHY a licence was suspended, on the page a suspended
      // administrator goes to find out.
      //
      // The mapping is `LicenceRow` (routes/admin_licences.ts), which is what
      // `hydrate` spreads verbatim into HQ's payload, so the two tiers now
      // answer with one vocabulary. A test asserts that set-equality rather
      // than this comment.
      starts_on: row.term_start,
      renews_on: row.renewal_at,
      status_note: row.suspended_note,
      term_years: row.term_years,
      registered_address: row.registered_address,
      signatory_name: row.signatory_name,
      signatory_title: row.signatory_title,
      suspended_at: row.suspended_at,
      terminated_at: row.terminated_at,
      template_version: row.template_version,
      admin_role: 'principal',
    },
    // NOT an empty history. `licence_events` is HQ's append-only trail and is
    // not pushed, so an empty array here would say "nothing has happened to
    // your licence", which is a different and false claim.
    events: [],
    events_available: false,
    events_reason:
      'The licence event trail is held at HQ and is not copied to a branch. Ask HQ for the '
      + 'history of a licence change.',
    source: 'hq_copy' as const,
    as_of: row.pushed_at,
    branch: code,
  };
}

/**
 * Said once, in one place, so the callers cannot word it differently. Exported
 * for the HQ overview (routes/admin_hq.ts), which reports the same absence
 * platform-wide and must not develop a second phrasing of it.
 *
 * SEATS USED CAME OFF THIS LIST (D127) RATHER THAN THE LIST BEING DELETED.
 * A branch counts its own seats now, so a payload carrying both a number and a
 * sentence saying that number is "not shown" would contradict itself — which
 * is what it did for the length of one commit, caught by
 * `branch_licence_copy.test.ts`. What is still genuinely unavailable on BOTH
 * tiers is narrower, and saying the narrower true thing is the point: the
 * D111 pattern, where `budget_reason` survived in a smaller and still-true
 * form rather than being dropped.
 */
export const DERIVED_UNAVAILABLE = {
  derived_metrics_available: false,
  derived_metrics_reason:
    'Accounts in territory and revenue per subsidiary need every account to name the licence it '
    + 'belongs to. No account carries one yet — migration 187 built the licence ledger, not the '
    + 'tenancy scope — so these are not shown rather than shown as zero.',
} as const;

/**
 * The same absence on a BRANCH, where seats used is a figure and the rest is
 * not (D127).
 *
 * A branch does not need the tenancy scope to count its own accounts — every
 * user in its database is its own — so the sentence above is wrong there in
 * the one direction that matters: it would tell a branch admin their seat
 * figure is unavailable while the page beside it shows one.
 */
export const DERIVED_UNAVAILABLE_BRANCH = {
  derived_metrics_available: false,
  derived_metrics_reason:
    'Seats used is shown, counted from active accounts by role. Revenue per subsidiary is not: the '
    + 'reporting call that sends this branch\'s own billing figures to HQ is not built, so nothing '
    + 'is shown rather than a zero.',
} as const;

/**
 * The licence this user administers, or null.
 *
 * `licence_admins` has a UNIQUE index on user_id, so "the" licence is
 * well-defined by the schema rather than by this query picking one.
 */
async function licenceForUser(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT l.*, la.admin_role
       FROM licence_admins la
       JOIN territory_licences l ON l.id = la.licence_id
      WHERE la.user_id = ?`,
  ).bind(userId).first<LicenceRow & { admin_role: string }>();
}

// GET /api/licence/mine — the subsidiary dashboard's only source.
//
// 404 rather than 403 when the caller administers nothing: they are not
// forbidden from a licence, there is no licence of theirs to return, and the
// UI needs to tell those two apart.
r.get('/mine', async (c) => {
  const user = await requireAuth(c);

  // D106 — on a branch the ledger is in another database; read the copy.
  // Placed after requireAuth so an anonymous caller still gets 401 rather
  // than the branch's licence terms.
  const code = branchOf(c.env);
  if (code) {
    const payload = await branchLicencePayload(c.env, code);
    if ('error' in payload) return c.json(payload, 404);
    return c.json({ ...payload, ...DERIVED_UNAVAILABLE_BRANCH });
  }

  const row = await licenceForUser(c.env, user.id);
  if (!row) {
    return c.json({
      error: 'no_licence',
      message: 'You do not administer a territory licence.',
    }, 404);
  }
  const [licence] = await hydrate(c.env, [row]);

  // Append-only history. The whole point of licence_events is that a contract
  // dispute is exactly the case where an overwritten status is useless, so the
  // holder gets the same trail HQ does.
  const events = await c.env.DB.prepare(
    `SELECT event, note, detail_json, created_at
       FROM licence_events WHERE licence_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 50`,
  ).bind(row.id).all<{ event: string; note: string | null; detail_json: string | null; created_at: string }>();

  return c.json({
    licence: { ...licence, admin_role: row.admin_role },
    events: events.results || [],
    ...DERIVED_UNAVAILABLE,
  });
});

/* ------------------------------------------------------------------ *
 * The compliance ladder — the addressee's half (D135)                  *
 * ------------------------------------------------------------------ */

// THESE TWO ROUTES LIVE HERE PRECISELY BECAUSE THIS FILE IS NOT AN ADMIN
// ROUTER, and that is what lets the ladder work without an exception list.
//
// The freeze lives inside `requireAdmin` (auth.ts), so every admin write on HQ
// refuses with 423 while a notice is outstanding. Put the reply behind
// `requireAdmin` and the freeze locks the addressee out of the one action that
// lifts it; the usual patch — a list of paths the gate skips — is the thing
// that rots, because the next route added to it is the one nobody remembers.
// `requireAuth` plus "you are this notice's addressee" is also the honest
// description of what is happening: an admin answering their own warning is not
// exercising admin power, they are the person the letter was addressed to.
//
// IT IS ALSO WHY THIS FILE STOPS BEING READ-ONLY. Its header says "one licence,
// read-only, for the person who administers it" — true until the ladder needed
// somewhere for that person to answer from, and the answer belongs beside the
// licence they are answering about rather than in a third router with a third
// gate. Reading stays the bulk of it; there is exactly one write.
//
// WHAT A RESPONSE IS NOT: it is not compliance. Writing "paid it" does not
// settle anything — the notice moves to `responded` and waits for HQ, because a
// click by the person who owes a fee is not evidence the fee was paid. The lift
// is HQ's, at POST /api/admin/licences/:uid/notices/:noticeUid/review.

const noticeText = (v: unknown, max = 5000): string => String(v ?? '').trim().slice(0, max);

r.get('/notices', async (c) => {
  const user = await requireAuth(c);
  let items: Array<Record<string, unknown>> = [];
  let readable = true;
  try {
    const res = await c.env.DB.prepare(
      `SELECT n.uid, n.kind, n.subject, n.body, n.respond_by, n.status,
              n.response, n.responded_at, n.review_note, n.reviewed_at,
              n.froze_at, n.created_at,
              l.licence_ref, l.brand_name, l.status AS licence_status
         FROM admin_notices n
         LEFT JOIN territory_licences l ON l.id = n.licence_id
        WHERE n.user_id = ?
        ORDER BY n.id DESC`,
    ).bind(user.id).all<Record<string, unknown>>();
    items = res.results || [];
  } catch { readable = false; }
  return c.json({
    items: readable ? items : [],
    // An unreadable store is not an empty inbox. Telling somebody whose account
    // is frozen that they have no notices would be the worst possible version
    // of a missing table — the #204 distinction, on the surface it matters most.
    notices_available: readable,
    ...(readable ? {} : {
      notices_reason: 'The admin_notices table could not be read on this database (migration 264).',
    }),
  });
});

r.post('/notices/:uid/respond', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const response = noticeText((body as Record<string, unknown>)?.response);
  if (response.length < 10) {
    return c.json({
      error: 'A response of at least 10 characters is required — it is what HQ reads when deciding whether this is settled.',
      code: 'response_too_short',
    }, 400);
  }
  // OWNERSHIP IS IN THE WHERE, not a check after the read: a notice addressed
  // to somebody else answers 404 rather than 403, because 403 confirms that it
  // exists. Same reasoning `mapError`'s header gives for the ownership helpers.
  const notice = await c.env.DB.prepare(
    'SELECT id, uid, status, subject FROM admin_notices WHERE uid = ? AND user_id = ?',
  ).bind(c.req.param('uid'), user.id).first<{ id: number; uid: string; status: string; subject: string }>();
  if (!notice) return c.json({ error: 'not_found' }, 404);
  // ANSWERABLE FROM BOTH `issued` AND `overdue`. Answering late is the whole
  // point of the middle rung — "frozen until they act on things from what they
  // have been notified" describes somebody acting AFTER the deadline, and a
  // ladder that refused a late answer would have no way back up it.
  if (notice.status !== 'issued' && notice.status !== 'overdue') {
    return c.json({
      error: `this notice is ${notice.status} and is not waiting on you`,
      code: 'not_answerable',
    }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE admin_notices
        SET status = 'responded', response = ?, responded_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
  ).bind(response, notice.id, user.id).run();

  // THE FREEZE LIFTS ON RESPONDING, NOT ON HQ ACCEPTING, and that is a choice
  // rather than an oversight. `responded` is not in FREEZING_STATUSES, so an
  // admin who answers can write again while HQ reads it. Holding the freeze
  // through a review of unknown length would punish the person for doing
  // exactly what they were asked; if HQ rejects, `rejected` freezes them again,
  // and that refusal is a decision somebody made rather than a queue they sat
  // in. "Frozen until they act" is the owner's sentence, and acting is this.
  try {
    const { notify } = await import('../services/notify');
    const hq = await c.env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>();
    for (const h of (hq.results || [])) {
      await notify(c.env, {
        userId: Number(h.user_id),
        type: 'compliance_response',
        title: 'A compliance notice has been answered',
        body: `${user.name || user.email} responded to "${notice.subject}". It is waiting on your review.`,
        link: '/admin/licences',
        category: 'compliance',
        payload: { notice_uid: notice.uid },
      });
    }
  } catch (e) { console.warn('[compliance] HQ notification failed', (e as Error).message); }

  return c.json({ ok: true, status: 'responded' });
});

export default r;
