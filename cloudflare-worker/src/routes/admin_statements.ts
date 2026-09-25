/**
 * HQ · Revenue → Statements and promo ceilings (H5, D111).
 *
 *   GET   /api/admin/statements                 the ledger, newest period first
 *   POST  /api/admin/statements/draw            draw one from what was reported
 *   PATCH /api/admin/statements/:uid            HQ enters paid / disputed / status
 *   GET   /api/admin/promo-ceilings             what HQ has set, per licence
 *   PUT   /api/admin/promo-ceilings/:uid        set one, and push it to the branch
 *
 * WHY THIS IS NOT IN `admin_revenue.ts`. That endpoint is a READ: one payload
 * for the Revenue page, computed per request, holding nothing. These five are
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
import { requireSuperAdmin } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import {
  drawStatement, quarterKey, PERIOD_RE, STATEMENT_STREAMS, type StreamFigure,
} from '../services/statements';
import { branchByCode } from '../services/branches';
import { mirrorBranchAction } from '../services/auditMirror';

const r = new Hono<{ Bindings: Env }>();

const str = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);
const cents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

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
};

/** Parse `streams_json` back, never throwing a stored row's shape at the page. */
function withStreams(row: StatementRow) {
  let streams: unknown = [];
  try { streams = JSON.parse(row.streams_json || '[]'); } catch { streams = []; }
  return {
    ...row,
    streams_json: undefined,
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
        const k = s.currency || 'EUR';
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
      'SELECT uid, licence_ref, brand_name, revenue_share_bps, currency FROM territory_licences WHERE uid = ?',
    ).bind(licenceUid).first<{
      uid: string; licence_ref: string; brand_name: string;
      revenue_share_bps: number | null; currency: string;
    }>();
    if (!licence) return c.json({ error: 'not_found' }, 404);

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
      'SELECT uid, status FROM subsidiary_statements WHERE licence_uid = ? AND period = ?',
    ).bind(licenceUid, period).first<{ uid: string; status: string }>();
    if (existing && existing.status !== 'draft') {
      return c.json({
        error: 'already_issued',
        message: `The ${period} statement for ${licence.licence_ref} is ${existing.status}. `
          + 'Re-drawing it would restate a figure the subsidiary has already been given; void it '
          + 'and draw a new one if the terms have changed.',
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
          currency: licence.currency || 'EUR',
          available: false,
          reason: `The branch has not reported ${s.replace('_', ' ')} for ${period}.`,
        };
      }
      return {
        stream: s,
        gross_cents: got.gross_cents === null ? null : Number(got.gross_cents),
        currency: got.currency || licence.currency || 'EUR',
        available: got.gross_cents !== null,
        is_estimate: !!got.is_estimate,
        reason: got.gross_cents === null
          ? (got.estimate_basis || `The branch reported ${s} as unmeasurable.`)
          : undefined,
      };
    });

    const drawn = drawStatement(figures, licence.revenue_share_bps, licence.currency || 'EUR');
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
         drawn_by_user_id = excluded.drawn_by_user_id, updated_at = excluded.updated_at`,
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

// PATCH /api/admin/statements/:uid  — the HQ-entered half (D.8)
r.patch('/statements/:uid', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const uid = str(c.req.param('uid'), 80);
    const row = await c.env.DB.prepare('SELECT * FROM subsidiary_statements WHERE uid = ?')
      .bind(uid).first<StatementRow>();
    if (!row) return c.json({ error: 'not_found' }, 404);

    const b = await c.req.json().catch(() => ({} as any));

    // THREE LITERAL STATEMENTS, NOT ONE ASSEMBLED ONE. The first draft built a
    // `SET` clause by joining an array of column fragments, and
    // `check-sql-prepare` was right to refuse it: a `${…}` inside
    // `DB.prepare` lands in the query TEXT, where no binding protects it. The
    // array only ever held literals written above it — but "provably safe by
    // reading the function" stops being true the first time somebody pushes a
    // field name in from the request, and that is a change nobody would think
    // to re-review. Three statements with no interpolation cannot acquire the
    // problem.
    //
    // AND NOTHING IS WRITTEN UNTIL EVERYTHING VALIDATES. Three statements are
    // three chances to fail half-way, so each is prepared and held rather than
    // run, and the whole set goes out in one `batch` — which D1 applies as a
    // transaction — only once every field the request carries has passed.
    const writes: D1PreparedStatement[] = [];
    const now = nowIso();

    if (b?.paid_cents !== undefined) {
      const paid = cents(b.paid_cents);
      // OVERPAYMENT IS REFUSED RATHER THAN RECORDED. It is almost always a
      // figure typed into the wrong row, and a statement showing more paid
      // than owed is a reconciliation problem nobody notices until a quarter
      // later. The operator can void and re-draw if the owed figure is wrong.
      if (paid > row.owed_cents) {
        return c.json({
          error: 'over_payment',
          message: `${paid} cents is more than the ${row.owed_cents} this statement claims. `
            + 'If the owed figure is wrong, void the statement and draw it again.',
        }, 409);
      }
      writes.push(
        c.env.DB.prepare(
          `UPDATE subsidiary_statements
              SET paid_cents = ?, paid_note = ?, paid_by_user_id = ?, paid_at = ?, updated_at = ?
            WHERE uid = ?`,
        ).bind(paid, str(b?.paid_note, 300) || null, admin.id, paid > 0 ? now : null, now, uid),
      );
    }
    if (b?.disputed_cents !== undefined) {
      const disputed = cents(b.disputed_cents);
      const note = str(b?.dispute_note, 500);
      // A DISPUTE WITHOUT A REASON IS NOT A DISPUTE. It is the one field on
      // this row that a subsidiary will later ask HQ to justify.
      if (disputed > 0 && !note) {
        return c.json({ error: 'dispute_note_required', message: 'A disputed amount must say why.' }, 400);
      }
      writes.push(
        c.env.DB.prepare(
          `UPDATE subsidiary_statements
              SET disputed_cents = ?, dispute_note = ?, updated_at = ?
            WHERE uid = ?`,
        ).bind(disputed, note || null, now, uid),
      );
    }
    if (b?.status !== undefined) {
      const next = str(b.status, 20);
      if (!['draft', 'issued', 'paid', 'void'].includes(next)) {
        return c.json({ error: 'bad_status' }, 400);
      }
      writes.push(
        c.env.DB.prepare(
          `UPDATE subsidiary_statements SET status = ?, updated_at = ? WHERE uid = ?`,
        ).bind(next, now, uid),
      );
    }
    if (!writes.length) return c.json({ error: 'nothing_to_update' }, 400);

    await c.env.DB.batch(writes);

    const after = await c.env.DB.prepare('SELECT * FROM subsidiary_statements WHERE uid = ?')
      .bind(uid).first<StatementRow>();
    return c.json(withStreams(after!));
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
    // REFUSED, NOT STORED AS ZERO. `cents()` clamps and coerces, which is right
    // for a reported stream and wrong here: a missing or mistyped
    // `ceiling_cents` became a stored ceiling of 0 — a branch told it may issue
    // nothing — and the route answered 200. Integer minor units, 0 or more;
    // zero stays expressible, because "no promotions this quarter" is a ceiling.
    const rawCeiling = b?.ceiling_cents;
    if (typeof rawCeiling !== 'number' || !Number.isInteger(rawCeiling) || rawCeiling < 0) {
      return c.json({
        error: 'bad_ceiling',
        message: 'ceiling_cents must be a whole number of minor units, 0 or more.',
      }, 400);
    }
    const ceiling = rawCeiling;
    const currency = (str(b?.currency, 3) || licence.currency || 'EUR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return c.json({ error: 'bad_currency', message: 'currency must be a three-letter ISO code.' }, 400);
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
