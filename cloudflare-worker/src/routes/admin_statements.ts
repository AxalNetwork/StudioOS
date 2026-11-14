/**
 * HQ · Revenue → Statements and promo ceilings (H5, D111).
 *
 *   GET   /api/admin/statements                 the ledger, newest period first
 *   POST  /api/admin/statements/draw            draw one from what was reported
 *   PATCH /api/admin/statements/:uid            HQ enters or clears a disputed amount
 *   POST  /api/admin/statements/:uid/issue      governed: draft -> issued (D5039)
 *   POST  /api/admin/statements/:uid/payments   governed: record a payment, step-up (D5039)
 *   POST  /api/admin/statements/:uid/void       governed: withdraw the claim, step-up (D5039)
 *   GET   /api/admin/licence-picker             uid, name and territory, searched and paged (D5039)
 *   GET   /api/admin/promo-ceilings             what HQ has set, per licence
 *   PUT   /api/admin/promo-ceilings/:uid        set one, and push it to the branch
 *
 * WHY THIS IS NOT IN `admin_revenue.ts`. That endpoint is a READ: one payload
 * for the Revenue page, computed per request, holding nothing. These routes are
 * a ledger with writes, an authored figure and a push to another Worker.
 * Folding them in would put `UPDATE ... paid_cents` inside the function whose
 * whole contract is "this reads and stores nothing".
 *
 * WHAT A STATEMENT IS, AND WHAT IT IS NOT (D.8). It is HQ's claim: gross as
 * reported by the branch, times the revenue share on the licence, at the
 * moment it was drawn. It is NOT a reconciliation — `paid_cents` is what an
 * HQ operator recorded receiving, with a note for the reference, and nothing
 * here talks to Stripe. Making paid automatic needs HQ to be a Connect
 * platform with each branch a connected account, which is real work and is
 * named in D.8 as later.
 *
 * DRAWING IS EXPLICIT AND RE-DRAWABLE UNTIL IT IS ISSUED. A statement nobody
 * has sent is a working figure; once `issued` it is a claim somebody has seen,
 * and re-drawing it under a re-termed revenue share would silently restate
 * what a subsidiary was told it owed. So a re-draw refuses past `draft`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import {
  drawStatement, quarterKey, PERIOD_RE, STATEMENT_STREAMS, type StreamFigure,
} from '../services/statements';
import { statementOverdue } from '../services/statementAdjustments';
import { branchByCode } from '../services/branches';
import { currencyCode } from '../services/currencies';
import { mirrorBranchAction } from '../services/auditMirror';
import { logAdminAction } from '../services/adminAudit';
import {
  ACTION_REASON_MAX, ACTION_REASON_MIN, AUDIT_ACTION, IDEMPOTENCY_KEY_RE, PAYMENT_REFERENCE_MAX, STEP_UP_ACTIONS,
  planStatementAction, requestHash, type StatementActionKind,
} from '../services/statementActions';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);

/**
 * D514 — an amount an operator typed is a whole number of minor units, 0 or
 * more, or it is refused. It used to go through a clamp that turned anything
 * unreadable into 0, which records "nothing paid" or clears a dispute without
 * anybody asking for either (D228 applied the same rule to the ceiling).
 */
const typedCents = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * D5029 — a statement's or ceiling's currency is one StudioOS can price in, or the write is refused. The old
 * `currency || 'EUR'` read an unrecorded currency as euros, which makes every figure beside it wrong by the
 * currency's exponent when it is not. The `*_cents` columns stay integer minor units; what a unit is depends on this.
 */
const UNRECORDED_CURRENCY = 'UNRECORDED';

/** One sentence for every place that used to promise a re-draw after a void. */
export const NO_REDRAW_AFTER_VOID =
  'A period holds one statement, and one past draft cannot be drawn again, voided or not: '
  + 'correct it with the paid and disputed entries, or void it and say why.';

/**
 * The licence's own name, joined in on READ only.
 *
 * WHY A JOIN AND NOT A COPIED COLUMN. The statement stores the uid and nothing
 * else about the licence, because a brand renamed next quarter must not make
 * last quarter's statement disagree with the ledger — but a list of uids is
 * unreadable, so the name is fetched beside it and may legitimately be null
 * (a licence deleted out from under a statement). The page shows the uid then,
 * rather than a blank row.
 */
type LicenceName = { licence_ref: string | null; brand_name: string | null };

type StatementRow = {
  uid: string; licence_uid: string; period: string; gross_cents: number;
  revenue_share_bps: number; owed_cents: number; currency: string;
  streams_json: string; estimated_streams: number; unreported_streams: number;
  paid_cents: number; paid_note: string | null; paid_at: string | null;
  disputed_cents: number; dispute_note: string | null;
  status: string; reports_as_of: string | null; created_at: string; updated_at: string;
  // Migration 202611090909 (D5039): bumped by every write; the governed actions name it.
  revision: number; last_action_uid: string | null; due_on?: string | null;
};

/** Parse `streams_json` back, never throwing a stored row's shape at the page. */
function withStreams(row: StatementRow) {
  let streams: unknown = [];
  try { streams = JSON.parse(row.streams_json || '[]'); } catch { streams = []; }
  return {
    ...row,
    streams_json: undefined,
    overdue: statementOverdue(row),
    streams,
    // Said on every row rather than computed by each reader: an owed figure
    // drawn over streams nobody could report is a FLOOR, and a screen showing
    // it without this reads it as a total.
    complete: row.unreported_streams === 0 && row.estimated_streams === 0,
    outstanding_cents: Math.max(0, row.owed_cents - row.paid_cents - row.disputed_cents),
  };
}

// GET /api/admin/statements
r.get('/statements', async (c) => {
  try {
    await requireSuperAdmin(c);
    const period = str(c.req.query('period'), 10);
    if (period && !PERIOD_RE.test(period)) {
      return c.json({ error: 'bad_period', message: 'period must be YYYY-Qn' }, 400);
    }

    let rows: (StatementRow & LicenceName)[] = [];
    let available = true;
    try {
      const q = period
        ? await c.env.DB.prepare(
          `SELECT s.*, l.licence_ref, l.brand_name
             FROM subsidiary_statements s
             LEFT JOIN territory_licences l ON l.uid = s.licence_uid
            WHERE s.period = ? ORDER BY s.licence_uid`,
        ).bind(period).all<StatementRow & LicenceName>()
        : await c.env.DB.prepare(
          `SELECT s.*, l.licence_ref, l.brand_name
             FROM subsidiary_statements s
             LEFT JOIN territory_licences l ON l.uid = s.licence_uid
            ORDER BY s.period DESC, s.licence_uid LIMIT 200`,
        ).all<StatementRow & LicenceName>();
      rows = q.results || [];
    } catch { available = false; }

    return c.json({
      available,
      ...(available ? {} : {
        reason: 'The subsidiary_statements table could not be read on this database (migration 260).',
      }),
      current_period: quarterKey(new Date()),
      items: rows.map(withStreams),
      // NO PLATFORM TOTAL. Statements are denominated per licence, so adding
      // them would be wrong by whatever the rate happens to be, quoted to the
      // cent — the same refusal `admin_revenue.ts` makes for the same reason.
      totals_by_currency: rows.reduce((m: Record<string, { owed: number; paid: number }>, s) => {
        const k = currencyCode(s.currency) ?? UNRECORDED_CURRENCY;
        m[k] = m[k] || { owed: 0, paid: 0 };
        m[k].owed += Number(s.owed_cents) || 0;
        m[k].paid += Number(s.paid_cents) || 0;
        return m;
      }, {}),
      streams: STATEMENT_STREAMS,
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/admin/statements/draw  { licence_uid, period }
r.post('/statements/draw', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const licenceUid = str(b?.licence_uid, 80);
    const period = str(b?.period, 10) || quarterKey(new Date());
    if (!licenceUid) return c.json({ error: 'licence_uid is required' }, 400);
    if (!PERIOD_RE.test(period)) return c.json({ error: 'bad_period', message: 'period must be YYYY-Qn' }, 400);

    const licence = await c.env.DB.prepare(
      'SELECT uid, licence_ref, brand_name, revenue_share_bps, currency, status FROM territory_licences WHERE uid = ?',
    ).bind(licenceUid).first<{
      uid: string; licence_ref: string; brand_name: string;
      revenue_share_bps: number | null; currency: string; status: string;
    }>();
    if (!licence) return c.json({ error: 'not_found' }, 404);
    const licenceCurrency = currencyCode(licence.currency);
    if (!licenceCurrency) {
      return c.json({
        error: 'currency_unknown',
        message: `${licence.licence_ref} has no currency StudioOS can price in ("${licence.currency ?? ''}"), so a statement cannot be drawn in it. `
          + 'Record the licence currency first; nothing was drawn.',
      }, 409);
    }

    // A HELD OR INACTIVE LICENCE DOES NOT GET A NEW CLAIM. Suspension freezes
    // the subsidiary's obligations; drawing while it is held would bill against
    // a party HQ has already told to stop trading.
    if (licence.status !== 'active') {
      return c.json({
        error: 'licence_not_active',
        message: `${licence.licence_ref} is ${licence.status}, so no new statement can be drawn for it. `
          + 'Reactivate the licence first.',
      }, 409);
    }

    // A LICENCE WITH NO AGREED SHARE CANNOT BE BILLED. Treating a null share
    // as 0% would draw a statement for nothing and file it as settled.
    if (licence.revenue_share_bps === null || licence.revenue_share_bps === undefined) {
      return c.json({
        error: 'no_revenue_share',
        message: `${licence.licence_ref} has no revenue share on its terms, so there is no rate to `
          + 'draw a statement at. Set it in step 4 of the issue flow first.',
      }, 409);
    }

    const existing = await c.env.DB.prepare(
      'SELECT uid, status, paid_cents, disputed_cents FROM subsidiary_statements WHERE licence_uid = ? AND period = ?',
    ).bind(licenceUid, period).first<{ uid: string; status: string; paid_cents: number; disputed_cents: number }>();
    if (existing && existing.status !== 'draft') {
      return c.json({
        error: 'already_issued',
        message: `The ${period} statement for ${licence.licence_ref} is ${existing.status}. `
          + 'Re-drawing it would restate a figure that has left draft. ' + NO_REDRAW_AFTER_VOID,
        uid: existing.uid,
        status: existing.status,
      }, 409);
    }

    const reports = await c.env.DB.prepare(
      `SELECT stream, gross_cents, currency, is_estimate, estimate_basis, reported_at
         FROM subsidiary_usage_reports WHERE licence_uid = ? AND period = ?`,
    ).bind(licenceUid, period).all<{
      stream: string; gross_cents: number | null; currency: string;
      is_estimate: number; estimate_basis: string | null; reported_at: string;
    }>();
    const reported = reports.results || [];

    // EVERY STREAM APPEARS, reported or not. A statement listing only what
    // arrived cannot be told apart from one where the rest earned nothing.
    const byStream = new Map(reported.map((x) => [x.stream, x]));
    const figures: StreamFigure[] = STATEMENT_STREAMS.map((s) => {
      const got = byStream.get(s);
      if (!got) {
        return {
          stream: s,
          gross_cents: null,
          currency: licenceCurrency,
          available: false,
          reason: `The branch has not reported ${s.replace('_', ' ')} for ${period}.`,
        };
      }
      return {
        stream: s,
        gross_cents: got.gross_cents === null ? null : Number(got.gross_cents),
        currency: got.currency || licenceCurrency,
        available: got.gross_cents !== null,
        is_estimate: !!got.is_estimate,
        reason: got.gross_cents === null
          ? (got.estimate_basis || `The branch reported ${s} as unmeasurable.`)
          : undefined,
      };
    });

    // D802 (#2238): each stream at its own share from D797's terms, the ledger's
    // revenue share where none is recorded, and the platform-licence royalty
    // (Not recorded when unset). Terms that cannot be read refuse the draw rather
    // than draw at the wrong shares.
    let terms: Record<string, unknown> | null = null;
    try {
      const { readLicenceTerms } = await import('../services/licenceTerms');
      terms = (await readLicenceTerms(c.env, licenceUid))?.terms ?? null;
    } catch (e) {
      // A database before migration 512 has no terms table: every stream is drawn at the ledger's share.
      if (!/no such table/i.test(String((e as Error)?.message ?? e))) {
        console.warn('[statements] licence_terms unreadable for draw', (e as Error).message);
        return c.json({
        error: 'terms_unreadable',
          message: `The terms schedule for ${licence.licence_ref} could not be read, so its per-stream shares are unknown. Nothing was drawn; try again.`,
        }, 503);
      }
    }
    const share = (k: string) => (typeof terms?.[k] === 'number' ? (terms[k] as number) : null);
    const drawn = drawStatement(figures, {
      fallback_bps: licence.revenue_share_bps,
      subscriptions: share('share_subscriptions_bps'),
      licence_fees: share('share_licence_fees_bps'),
      token_margin: share('share_token_margin_bps'),
      royalty_bps: share('royalty_platform_licence_bps'),
    }, licenceCurrency);

    // D514 — A RE-DRAW KEEPS WHAT WAS PAID AND DISPUTED (the upsert below leaves
    // both alone), so a re-draw to a smaller owed figure would leave more paid
    // and disputed than owed. Refused, rather than silently clamped.
    const recorded = existing ? (Number(existing.paid_cents) || 0) + (Number(existing.disputed_cents) || 0) : 0;
    if (existing && recorded > drawn.owed_cents) {
      return c.json({
        error: 'recorded_above_owed',
        message: `The draft already records ${recorded} minor units paid and disputed, more than the `
          + `${drawn.owed_cents} this draw would claim. Lower the paid or disputed entry first.`,
      }, 409);
    }
    const asOf = reported.length
      ? reported.map((x) => x.reported_at).sort().slice(-1)[0]
      : null;

    const uid = existing?.uid || newUid();
    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO subsidiary_statements
         (uid, licence_uid, period, gross_cents, revenue_share_bps, owed_cents, currency,
          streams_json, estimated_streams, unreported_streams, status, reports_as_of,
          drawn_by_user_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)
       ON CONFLICT(licence_uid, period) DO UPDATE SET
         gross_cents = excluded.gross_cents, revenue_share_bps = excluded.revenue_share_bps,
         owed_cents = excluded.owed_cents, currency = excluded.currency,
         streams_json = excluded.streams_json, estimated_streams = excluded.estimated_streams,
         unreported_streams = excluded.unreported_streams, reports_as_of = excluded.reports_as_of,
         drawn_by_user_id = excluded.drawn_by_user_id, updated_at = excluded.updated_at,
         revision = subsidiary_statements.revision + 1`,
    ).bind(
      uid, licenceUid, period, drawn.gross_cents, drawn.revenue_share_bps, drawn.owed_cents,
      drawn.currency, JSON.stringify(drawn.streams), drawn.estimated, drawn.unreported,
      asOf, admin.id, now, now,
    ).run();

    return c.json({
      uid,
      licence_ref: licence.licence_ref,
      brand_name: licence.brand_name,
      period,
      ...drawn,
      reports_as_of: asOf,
      status: 'draft',
      ...(drawn.complete ? {} : {
        note:
          `${drawn.unreported} of ${STATEMENT_STREAMS.length} streams could not be reported, so `
          + 'this owed figure is a floor rather than a total. It is drawn as a draft and says so '
          + 'on every surface that shows it.',
      }),
    }, 201);
  } catch (e) { return mapError(c, e); }
});

// The retired PATCH cannot bypass revision, reason, idempotency or step-up (#5039).
r.patch('/statements/:uid', async (c) => {
  try {
    await requireSuperAdmin(c);
    const row = await c.env.DB.prepare('SELECT uid FROM subsidiary_statements WHERE uid = ?').bind(c.req.param('uid')).first();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'governed_action_required', message: 'Use POST /api/admin/statements/:uid/payments, /issue or /void for those actions; use /disputes or /due-date to adjust recorded facts. Nothing was written.' }, 409);
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * D5039 — the governed actions: Mark issued, Record a payment, Void    *
 * ------------------------------------------------------------------ */

/**
 * One governed action, start to finish. The order is the contract:
 *
 *   1. THE GATE. Super Admin; Record a payment and Void also take the write
 *      bar (a TOTP session and a recent step-up), the gate the refund uses
 *      (D224), because they change what HQ is owed.
 *   2. THE REQUEST. A reason of ACTION_REASON_MIN characters or more, the
 *      revision the client read, and its idempotency key. A payment also
 *      carries its amount, in the statement's own minor units.
 *   3. A RETRY IS A REPLAY. The same key from the same admin returns the
 *      stored reply (`replayed: true`), before any status or revision check,
 *      because by then the row has moved on exactly as the first try moved it.
 *      The same key with a different request is refused.
 *   4. THE RULES (`planStatementAction`) and the revision: a stale read is 409
 *      `changed_since_open` with the row as it now stands.
 *   5. ONE BATCH. The statement update is guarded by the revision and stamps
 *      the action's uid; the action row is inserted only if that stamp is
 *      there. Both land or neither does.
 *   6. THE AUDIT ROW, then the reply.
 */
async function governedAction(c: any, kind: StatementActionKind) {
  const admin = STEP_UP_ACTIONS.has(kind) ? await requireSuperAdminWriteBar(c) : await requireSuperAdmin(c);
  const uid = str(c.req.param('uid'), 80);
  const row = await c.env.DB.prepare('SELECT * FROM subsidiary_statements WHERE uid = ?')
    .bind(uid).first() as StatementRow | null;
  if (!row) return c.json({ error: 'not_found' }, 404);

  const b = await c.req.json().catch(() => ({} as any));
  const reason = str(b?.reason, ACTION_REASON_MAX);
  if (reason.length < ACTION_REASON_MIN) {
    return c.json({
      error: 'reason_required',
      message: `Say why, in at least ${ACTION_REASON_MIN} characters: it is what an auditor reads. Nothing was written.`,
    }, 400);
  }
  const expected = b?.expected_revision;
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) {
    return c.json({
      error: 'revision_required',
      message: 'expected_revision is required: the revision you read, as a whole number, zero or more.',
    }, 400);
  }
  const key = typeof b?.idempotency_key === 'string' ? b.idempotency_key.trim() : '';
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    return c.json({
      error: 'idempotency_key_required',
      message: 'idempotency_key is required: 8 to 200 letters, digits or . _ : -, minted once per action and sent again on a retry.',
    }, 400);
  }
  let amount: number | null = null;
  let reference: string | null = null;
  if (kind === 'record_payment') {
    amount = typedCents(b?.amount_cents);
    if (amount === null || amount === 0) {
      return c.json({ error: 'bad_amount', message: 'amount_cents must be a whole number of minor units above 0.' }, 400);
    }
    reference = str(b?.reference, PAYMENT_REFERENCE_MAX) || null;
  }

  const hash = await requestHash({ kind, uid, expected, amount, reason, reference });
  const prior = await c.env.DB.prepare(
    'SELECT request_hash, response_json FROM subsidiary_statement_actions WHERE actor_user_id = ? AND idempotency_key = ?',
  ).bind(admin.id, key).first() as { request_hash: string; response_json: string } | null;
  if (prior) {
    if (prior.request_hash !== hash) {
      return c.json({
        error: 'idempotency_key_reused',
        message: 'This idempotency key was already used for a different action. Prepare the action again; nothing was written.',
      }, 409);
    }
    return c.json({ ...JSON.parse(prior.response_json), replayed: true });
  }

  const changed = async () => {
    const now = await c.env.DB.prepare('SELECT * FROM subsidiary_statements WHERE uid = ?').bind(uid).first() as StatementRow | null;
    return c.json({
      error: 'changed_since_open',
      message: 'This statement changed after you opened it. Review it as it stands now; nothing was written.',
      current_revision: now ? Number(now.revision ?? 0) : null,
      current: now ? withStreams(now) : null,
    }, 409);
  };
  if (Number(row.revision ?? 0) !== expected) return changed();

  const plan = planStatementAction(kind, row, amount);
  if (!plan.ok) return c.json({ error: plan.error, message: plan.message, status: row.status }, plan.status);

  const actionUid = newUid();
  const now = nowIso();
  const toRevision = expected + 1;
  const isPayment = kind === 'record_payment';
  const response = {
    outcome: 'applied',
    action: kind,
    statement_uid: uid,
    settled: plan.settled,
    before: { ...plan.before, revision: expected },
    after: { ...plan.after, revision: toRevision },
    receipt: {
      action_uid: actionUid,
      at: now,
      reason,
      currency: row.currency,
      ...(isPayment ? { amount_cents: amount, reference } : {}),
    },
    replayed: false,
  };

  let results: any[];
  try {
    results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE subsidiary_statements
            SET status = ?, paid_cents = ?,
                paid_note = CASE WHEN ? = 1 THEN COALESCE(?, paid_note) ELSE paid_note END,
                paid_by_user_id = CASE WHEN ? = 1 THEN ? ELSE paid_by_user_id END,
                paid_at = CASE WHEN ? = 1 THEN ? ELSE paid_at END,
                revision = revision + 1, last_action_uid = ?, updated_at = ?
          WHERE uid = ? AND revision = ?`,
      ).bind(
        plan.to_status, plan.paid_cents,
        isPayment ? 1 : 0, reference,
        isPayment ? 1 : 0, admin.id,
        isPayment ? 1 : 0, now,
        actionUid, now, uid, expected,
      ),
      c.env.DB.prepare(
        `INSERT INTO subsidiary_statement_actions
           (uid, statement_uid, action, actor_user_id, idempotency_key, request_hash, reason, amount_cents, reference,
            currency, from_status, to_status, from_revision, to_revision, response_json, created_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
          WHERE EXISTS (SELECT 1 FROM subsidiary_statements WHERE uid = ? AND last_action_uid = ?)`,
      ).bind(
        actionUid, uid, kind, admin.id, key, hash, reason, amount, reference,
        row.currency, row.status, plan.to_status, expected, toRevision, JSON.stringify(response), now,
        uid, actionUid,
      ),
    ]);
  } catch (e) {
    // The same key raced itself: the other request's batch holds the key and
    // this one rolled back. Its stored reply is this request's answer.
    if (/UNIQUE/i.test(String((e as Error)?.message ?? e))) {
      const won = await c.env.DB.prepare(
        'SELECT request_hash, response_json FROM subsidiary_statement_actions WHERE actor_user_id = ? AND idempotency_key = ?',
      ).bind(admin.id, key).first() as { request_hash: string; response_json: string } | null;
      if (won && won.request_hash === hash) return c.json({ ...JSON.parse(won.response_json), replayed: true });
    }
    throw e;
  }
  if (!Number(results?.[0]?.meta?.changes)) return changed();

  await logAdminAction(c.env, admin.id, admin.email, AUDIT_ACTION[kind], {
    statement_uid: uid,
    uid,
    action_uid: actionUid,
    licence_uid: row.licence_uid,
    period: row.period,
    from_status: row.status,
    to_status: plan.to_status,
    from_revision: expected,
    to_revision: toRevision,
    currency: row.currency,
    amounts: isPayment
      ? { amount_cents: amount, paid_before_cents: plan.before.paid_cents, paid_after_cents: plan.after.paid_cents, owed_cents: row.owed_cents }
      : { owed_cents: row.owed_cents },
    note: reason,
    ...(reference ? { reference } : {}),
  });

  return c.json(response);
}

// POST /api/admin/statements/:uid/issue     { reason, expected_revision, idempotency_key }
r.post('/statements/:uid/issue', async (c) => {
  try { return await governedAction(c, 'issue'); } catch (e) { return mapError(c, e); }
});

// POST /api/admin/statements/:uid/payments  { amount_cents, reference?, reason, expected_revision, idempotency_key }
r.post('/statements/:uid/payments', async (c) => {
  try { return await governedAction(c, 'record_payment'); } catch (e) { return mapError(c, e); }
});

// POST /api/admin/statements/:uid/void      { reason, expected_revision, idempotency_key }
r.post('/statements/:uid/void', async (c) => {
  try { return await governedAction(c, 'void'); } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * D5039 — the scoped licence picker                                   *
 * ------------------------------------------------------------------ */

export const PICKER_PAGE_DEFAULT = 20;
export const PICKER_PAGE_MAX = 50;

const pickerCursor = (name: string, id: number) =>
  btoa(JSON.stringify([name, id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function readPickerCursor(raw: string): [string, number] | null {
  try {
    const pad = raw.replace(/-/g, '+').replace(/_/g, '/');
    const v = JSON.parse(atob(pad + '='.repeat((4 - (pad.length % 4)) % 4)));
    return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && Number.isSafeInteger(v[1]) ? [v[0], v[1]] : null;
  } catch { return null; }
}

// GET /api/admin/licence-picker?q=&cursor=&limit=
//
// WHAT A PICKER NEEDS, AND NOTHING ELSE. The ceiling editor used to page the
// whole ledger (every column of every licence, up to forty pages) to fill one
// <select>. This answers a page of { uid, name, territory } ordered by name,
// searched by name, reference, legal entity or an exact country code, and is
// asked only when the picker opens.
r.get('/licence-picker', async (c) => {
  try {
    await requireSuperAdmin(c);
    const q = str(c.req.query('q'), 80);
    const rawLimit = Math.floor(Number(c.req.query('limit')));
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(PICKER_PAGE_MAX, rawLimit) : PICKER_PAGE_DEFAULT;
    const rawCursor = str(c.req.query('cursor'), 400);
    const after = rawCursor ? readPickerCursor(rawCursor) : null;
    if (rawCursor && !after) {
      return c.json({ error: 'bad_cursor', message: 'The cursor is not one this picker issued. Start from the first page.' }, 400);
    }
    const like = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : '';
    const rows = await c.env.DB.prepare(
      `SELECT * FROM (
         SELECT tl.id, tl.uid,
                COALESCE(NULLIF(TRIM(tl.brand_name), ''), tl.licence_ref) AS name,
                (SELECT GROUP_CONCAT(lt.country_code, ',') FROM
                   (SELECT country_code FROM licence_territories WHERE licence_id = tl.id ORDER BY country_code) lt) AS territory
           FROM territory_licences tl
          WHERE (? = ''
                 OR tl.licence_ref LIKE ? ESCAPE '\\'
                 OR tl.brand_name LIKE ? ESCAPE '\\'
                 OR tl.legal_entity_name LIKE ? ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM licence_territories x WHERE x.licence_id = tl.id AND x.country_code = ?))
       )
       WHERE (? IS NULL OR name > ? OR (name = ? AND id > ?))
       ORDER BY name, id
       LIMIT ?`,
    ).bind(
      q, like, like, like, q.toUpperCase(),
      after ? after[0] : null, after ? after[0] : null, after ? after[0] : null, after ? after[1] : null,
      limit + 1,
    ).all<{ id: number; uid: string; name: string; territory: string | null }>();
    const got = rows.results || [];
    const more = got.length > limit;
    const page = more ? got.slice(0, limit) : got;
    const last = page[page.length - 1];
    return c.json({
      items: page.map((x) => ({ uid: x.uid, name: x.name, territory: x.territory ? String(x.territory).split(',') : [] })),
      next_cursor: more && last ? pickerCursor(String(last.name), Number(last.id)) : null,
      limit,
    });
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * Promo ceilings                                                      *
 * ------------------------------------------------------------------ */

// GET /api/admin/promo-ceilings
r.get('/promo-ceilings', async (c) => {
  try {
    await requireSuperAdmin(c);
    let rows: unknown[] = [];
    let available = true;
    try {
      const q = await c.env.DB.prepare(
        `SELECT p.licence_uid, p.period, p.ceiling_cents, p.currency, p.issued_cents,
                p.issued_reported_at, p.pushed_at, p.updated_at,
                l.licence_ref, l.brand_name
           FROM licence_promo_ceilings p
           LEFT JOIN territory_licences l ON l.uid = p.licence_uid
          ORDER BY p.period DESC, p.licence_uid`,
      ).all<any>();
      rows = (q.results || []).map((x) => ({
        ...x,
        // `issued_cents` NULL means the branch has not told us, which is not
        // the same as zero issued — a null remaining would otherwise render
        // as the whole ceiling being available.
        remaining_cents: x.issued_cents === null ? null : Math.max(0, x.ceiling_cents - x.issued_cents),
        issued_available: x.issued_cents !== null,
      }));
    } catch { available = false; }

    return c.json({
      available,
      ...(available ? {} : {
        reason: 'The licence_promo_ceilings table could not be read on this database (migration 260).',
      }),
      current_period: quarterKey(new Date()),
      items: rows,
    });
  } catch (e) { return mapError(c, e); }
});

// PUT /api/admin/promo-ceilings/:uid  { period, ceiling_cents, currency }
r.put('/promo-ceilings/:uid', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licenceUid = str(c.req.param('uid'), 80);
    const licence = await c.env.DB.prepare(
      'SELECT uid, licence_ref, currency FROM territory_licences WHERE uid = ?',
    ).bind(licenceUid).first<{ uid: string; licence_ref: string; currency: string }>();
    if (!licence) return c.json({ error: 'not_found' }, 404);

    const b = await c.req.json().catch(() => ({} as any));
    const period = str(b?.period, 10) || quarterKey(new Date());
    if (!PERIOD_RE.test(period)) return c.json({ error: 'bad_period', message: 'period must be YYYY-Qn' }, 400);
    // D228 — A CEILING IS A FIGURE SOMEBODY TYPED, SO AN UNREADABLE ONE IS
    // REFUSED, NOT STORED AS ZERO. A clamp that coerces (`cents()`, removed in D514) is right
    // for a reported stream and wrong here: a missing or mistyped
    // `ceiling_cents` became a stored ceiling of 0 — a branch told it may issue
    // nothing — and the route answered 200. Integer minor units, 0 or more;
    // zero stays expressible, because "no promotions this quarter" is a ceiling.
    const rawCeiling = b?.ceiling_cents;
    if (typeof rawCeiling !== 'number' || !Number.isSafeInteger(rawCeiling) || rawCeiling < 0) {
      return c.json({
        error: 'bad_ceiling',
        message: 'ceiling_cents must be a whole number of minor units, 0 or more.',
      }, 400);
    }
    const ceiling = rawCeiling;
    // D5029: the ceiling's currency is named or the licence's own, and it must be a listed ISO 4217 code. Never a default.
    const currency = currencyCode((str(b?.currency, 3) || licence.currency || '').toUpperCase());
    if (!currency) {
      return c.json({ error: 'bad_currency', message: 'currency must be a listed three-letter ISO 4217 code, such as EUR.' }, 400);
    }

    const now = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO licence_promo_ceilings
         (licence_uid, period, ceiling_cents, currency, set_by_user_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(licence_uid, period) DO UPDATE SET
         ceiling_cents = excluded.ceiling_cents, currency = excluded.currency,
         set_by_user_id = excluded.set_by_user_id, updated_at = excluded.updated_at`,
    ).bind(licenceUid, period, ceiling, currency, admin.id, now, now).run();

    // PUSH IT, AND REPORT WHETHER THE PUSH LANDED — as its own field, not as
    // the success of the write. HQ's ceiling is set either way; whether the
    // branch has it yet is a separate fact, and a route that returned 502 for
    // an unreachable branch would make an operator re-enter a figure that is
    // already stored.
    let pushed: { ok: boolean; reason?: string } = {
      ok: false,
      // D266 — THIS USED TO PROMISE the ceiling "will reach the branch when
      // one is". Nothing re-pushes a ceiling when a branch is deployed later:
      // this route is its one push. So the sentence says what to do instead.
      reason: 'No branch is bound to this licence yet, so the ceiling is set at HQ only. Nothing '
        + 'sends it when a branch is deployed later: save it again once the branch answers.',
    };
    const dep = await c.env.DB.prepare(
      'SELECT code FROM licence_deployments WHERE licence_uid = ?',
    ).bind(licenceUid).first<{ code: string }>().catch(() => null);
    const binding = dep ? branchByCode(c.env, dep.code) : null;
    if (binding) {
      try {
        await (binding.stub as any).applyPromoCeiling({
          period, ceiling_cents: ceiling, currency, pushed_at: now,
        });
        await c.env.DB.prepare(
          'UPDATE licence_promo_ceilings SET pushed_at = ? WHERE licence_uid = ? AND period = ?',
        ).bind(now, licenceUid, period).run();
        pushed = { ok: true };
      } catch (e) {
        pushed = { ok: false, reason: `The branch did not accept the push: ${(e as Error).message}` };
      }
    }
    // D163 — `dep` absent means no deployment at all, so there is no branch
    // this concerns and the helper no-ops on the undefined code. A dep row with
    // no binding is the narrower, real `not_deployed`.
    mirrorBranchAction(
      c.env,
      'promo_ceiling_pushed',
      !binding ? 'not_deployed' : (pushed.ok ? 'ok' : 'failed'),
      dep?.code,
    );

    return c.json({ licence_uid: licenceUid, period, ceiling_cents: ceiling, currency, pushed });
  } catch (e) { return mapError(c, e); }
});

export default r;
