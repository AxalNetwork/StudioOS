/**
 * VC Funds + Limited Partners + LPAs + Distributions.
 *
 * Roles: admin manages funds & runs distributions; partner/LP gets read-only
 * portal of their own positions; founders are excluded.
 *
 * Money convention: legacy commitment_amount/invested_amount/returns are dollars
 * (legacy floats). New v2 columns (fund_size_cents, fund_distributions.amount_cents)
 * are integer cents. Conversions happen at the boundary.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireApprovedKyc } from '../auth';
import { requireFundGp, requireFundCreator } from '../services/fundGpAccess';
import { Funds, LPs } from '../models/funds';
import { Jobs } from '../models/jobs';
import { enqueueJob } from '../services/queue';
import { Distributions } from '../models/distributions';
import { logActivity } from './partnernet';
import { clampLimit } from '../util/pagination';
import { ensureFundGpColumns } from '../services/fundGpSchema';
import { lpMembershipScope, lpSelfScope, fundGpScope, NO_ROWS } from '../services/tenancyScope';
import { refuse } from '../util/refusal';
import { claimLpRowsByEmail } from '../services/lpClaim';
import { userMeetsInvestorTier } from '../middleware/requireInvestorTier';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { splitCall } from '../services/fundCallSplit';
import {
  issueFundCall, recordReceipt, readLine, readFundCalls, readFundLedger,
} from '../services/fundCallLedger';
import {
  rollUpFundRow, totalFundRollups, FUND_METRIC_UNAVAILABLE,
  type FundRollup, type FundRollupRow,
} from '../services/fundRollup';

const funds = new Hono<{ Bindings: Env }>();

/** GP narrative for a period. Prose is authored, never generated. */
interface PeriodNarrative {
  letter?: string[];
  developments?: Array<{ date: string; title: string; body: string }>;
  outlook?: string[];
  subsequent?: Array<{ d: string; e: string }>;
}

const parseJson = <T,>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string' || !raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};


/**
 * The funds a caller may see in a list or a rollup (D370).
 *
 * The list, the family analytics and the syndication queue answered EVERY
 * signed-in role with every fund on the platform — `SELECT *`, so a founder
 * could read each fund's size, deployed capital and GP email. Now: an admin
 * sees all of them; anyone else sees the funds they are general partner of
 * record for, and (for the list only) the funds they hold an LP position in.
 * Both arms are the shared predicates every other fund surface already uses,
 * so this adds no third definition of "your fund". The GP arm carries no
 * company clause here: a list is a read of funds the caller already runs,
 * and the operating gate (`requireFundGp`) still scopes every write.
 */
function visibleFundsScope(user: any, opts: { includeLp: boolean }): { sql: string; binds: Array<string | number> } {
  const gp = fundGpScope(user, null, 'f');
  if (!opts.includeLp) return gp;
  const lp = lpMembershipScope(user, 'lpv');
  return {
    sql: `(${gp.sql} OR EXISTS (SELECT 1 FROM limited_partners lpv WHERE lpv.fund_id = f.id AND ${lp.sql}))`,
    binds: [...gp.binds, ...lp.binds],
  };
}

// ---------- vc_funds CRUD ----------
funds.get('/', async (c) => {
  const user = await requireAuth(c);
  const status = c.req.query('status') || undefined;
  if (user.role === 'admin') {
    const list = await Funds.list(c.env, status);
    // An admin operates every fund through `requireFundGp`'s bypass.
    return c.json({ ok: true, items: (list.results || []).map((f: any) => ({ ...f, can_manage: true })) });
  }
  await claimLpRowsByEmail(c.env, Number(user.id), (user as any).email);
  const scope = visibleFundsScope(user, { includeLp: true });
  const where = [scope.sql];
  const binds = [...scope.binds];
  if (status) { where.push('f.status = ?'); binds.push(status); }
  // `can_manage` (D371): whether `requireFundGp` would let this caller operate
  // the fund — the institutional tier, then the same GP-and-active-company
  // predicate the gate runs. The list carries LP-only funds too, and the fund
  // pages used to open `items[0]`, which 404'd whenever that was one of them.
  const tierOk = userMeetsInvestorTier(user as any, 'institutional');
  const companyId = tierOk
    ? await resolveActiveCompany(c.env, user as any, c.req.header(ACTIVE_COMPANY_HEADER))
    : null;
  if (companyId !== null) await ensureFundGpColumns(c.env);
  const manage = tierOk ? fundGpScope(user as any, companyId, 'f') : NO_ROWS;
  const rows = await c.env.DB.prepare(
    `SELECT f.*, CASE WHEN ${manage.sql} THEN 1 ELSE 0 END AS can_manage
       FROM vc_funds f WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC`,
  ).bind(...manage.binds, ...binds).all();
  return c.json({
    ok: true,
    items: (rows.results || []).map((f: any) => ({ ...f, can_manage: Number(f.can_manage) === 1 })),
  });
});

funds.get('/lp-portal', async (c) => {
  // LP-only self-view: own commitments, capital calls, distributions, performance.
  const user = await requireAuth(c);
  // listByUser selects the fund's GP-of-record and service-provider columns so a
  // quarterly report can name the responsible fiduciary without an admin call.
  await ensureFundGpColumns(c.env);

  // Claim first, then read. This handler is where the two LP predicates used to
  // meet: the positions came back on `user_id` alone while the capital calls
  // below matched the account email too, so a legacy LP saw calls for a fund
  // whose position the same page had just failed to find. Claiming links those
  // rows to the account once; every query beneath is then the same question,
  // asked once, through lpSelfScope.
  await claimLpRowsByEmail(c.env, Number(user.id), user.email);

  const my = await LPs.listByUser(c.env, user);
  const lpRows: any[] = my.results || [];

  // Aggregate cash flows per-fund for TVPI / DPI
  const distRows = await Distributions.listByUser(c.env, user, 200);

  // Self-view, so lpSelfScope and not lpMembershipScope: an admin's own
  // portal must show their own positions, not the sum of everyone's.
  const callScope = lpSelfScope(user as any);
  // D372: each line carries what the ledger (D371) knows about it — the cents
  // it owes, the cents received against it, the call's number and its fund —
  // so the My-commitment card can say called, due and uncalled without
  // guessing. A failed read is `capital_calls_recorded: false`, never an empty
  // list: "no calls" is a claim about the LP's money.
  let calls: any[] = [];
  let callsRecorded = true;
  try {
    calls = (await c.env.DB.prepare(
      `SELECT cc.*, lp.fund_id AS fund_id, f.name AS fund_name, fc.call_number AS call_number,
              COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER)) AS owed_cents,
              COALESCE((SELECT SUM(r.amount_cents) FROM capital_call_receipts r WHERE r.capital_call_id = cc.id), 0)
                AS received_cents
         FROM capital_calls cc
         JOIN limited_partners lp ON lp.id = cc.limited_partner_id
         JOIN vc_funds f ON f.id = lp.fund_id
         LEFT JOIN fund_capital_calls fc ON fc.id = cc.fund_call_id
        WHERE ${callScope.sql}
        ORDER BY cc.created_at DESC LIMIT 200`
    ).bind(...callScope.binds).all()).results || [];
  } catch (e) {
    console.error('[funds] lp-portal calls unreadable', e);
    callsRecorded = false;
  }

  // Performance per-LP-row: TVPI = (returns + distributions) / invested ; DPI = distributions / invested
  const perfByLp = lpRows.map((lp: any) => {
    const lpDists = distRows.filter((d: any) => d.fund_id === lp.fund_id);
    const distSumDollars = lpDists.reduce((s: number, d: any) => s + Number(d.amount_cents || 0) / 100, 0);
    const invested = Number(lp.invested_amount || 0);
    const returns = Number(lp.returns || 0);
    // Nothing paid in, no multiple: null, not 0 (D372). A TVPI of 0.00× says
    // the money was lost; with no paid-in capital there is no ratio at all.
    const tvpi = invested > 0 ? Number(((invested + returns + distSumDollars) / invested).toFixed(3)) : null;
    const dpi = invested > 0 ? Number(((returns + distSumDollars) / invested).toFixed(3)) : null;
    return {
      lp_id: lp.id,
      fund_id: lp.fund_id,
      fund_name: lp.fund_name,
      fund_slug: lp.fund_slug ?? null,
      commitment: invested + Math.max(0, Number(lp.commitment_amount || 0) - invested),
      invested_amount: invested,
      returns: returns,
      distributions_dollars: distSumDollars,
      tvpi,
      dpi,
      lpa_signed: !!lp.lpa_signed,
      lpa_signed_at: lp.lpa_signed_at ?? null,
      commitment_date: lp.commitment_date ?? null,
    };
  });

  return c.json({
    ok: true,
    lp_holdings: lpRows,
    capital_calls: calls,
    capital_calls_recorded: callsRecorded,
    distributions: distRows,
    performance: perfByLp,
    // The signer and the firms an LP-facing document names, per fund the caller
    // actually holds. Absent values stay null — the document says "not
    // recorded" rather than naming a fiduciary the database has not been told
    // about. See migration 163.
    funds: fundFacts(lpRows),
    // Who the report is for. The caller's own account, echoed so the document
    // never has to guess a name from a session the renderer cannot see.
    recipient: { name: user.name ?? null, email: user.email ?? null },
    // ISSUED periods only, for the funds this caller actually holds. The report
    // archive lists these; a draft period is the GP's working copy and is not an
    // LP-facing document until it is issued.
    report_periods: await issuedPeriods(c.env, lpRows.map((r: any) => r.fund_id)),
  });
});

/** Issued reporting periods for the given funds, newest first. */
async function issuedPeriods(env: Env, fundIds: number[]) {
  const ids = [...new Set(fundIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  // `notes` carries the GP's letter and commentary for the period. It travels
  // with an ISSUED period on purpose: that letter is the document. `snapshot_json`
  // is deliberately NOT selected — it is the GP's frozen working copy of
  // fund-level figures, and the LP's report is rendered from the same live model
  // the workspace shows them.
  const r = await env.DB.prepare(
    `SELECT id, fund_id, period, period_start, period_end, issued_at, status, notes
       FROM fund_report_periods
      WHERE fund_id IN (${marks}) AND status = 'issued'
      ORDER BY period_end DESC LIMIT 40`
  ).bind(...ids).all().catch(() => ({ results: [] }));
  return (r.results || []).map((row: any) => ({
    ...row,
    notes: undefined,
    narrative: parseJson<PeriodNarrative>(row?.notes, {}),
  }));
}

/**
 * Per-fund GP-of-record + provider facts, keyed by fund id, from rows that
 * already carry them (LPs.listByUser joins vc_funds). Shared by the LP self-view
 * and the GP's per-LP report endpoint so both documents state the same thing.
 */
function fundFacts(rows: any[]) {
  const out: Record<string, any> = {};
  for (const r of rows) {
    if (out[r.fund_id]) continue;
    out[r.fund_id] = {
      fund_id: r.fund_id,
      name: r.fund_name ?? null,
      slug: r.fund_slug ?? null,
      vintage_year: r.fund_vintage ?? null,
      management_fee: r.management_fee ?? null,
      carried_interest: r.carried_interest ?? null,
      gp: {
        name: r.gp_name ?? null,
        title: r.gp_title ?? null,
        email: r.gp_email ?? null,
        entity: r.gp_entity ?? null,
        // D372: the GP of record's platform account, which "Message the GP"
        // starts a thread with (`POST /api/messages` takes an account email).
        // `email` above is the fiduciary address as printed on the LPA, which
        // may not be an account at all. Only the LP's own funds reach here.
        contact_email: r.gp_account_email ?? null,
      },
      providers: {
        fund_admin: r.fund_admin ?? null,
        auditor: r.auditor ?? null,
        legal_counsel: r.legal_counsel ?? null,
        custodian: r.custodian ?? null,
        valuation_policy: r.valuation_policy ?? null,
      },
    };
  }
  return out;
}

funds.get('/syndication', async (c) => {
  // Lightweight co-invest opportunities: open marketplace listings + pending capital calls.
  const user = await requireAuth(c);
  // D370: investors, partners and admins — the roles a co-invest listing is
  // for. The pending CALLS carry fund money in their payloads, so they are
  // narrowed further below to the funds the caller is GP of record for.
  if (!['admin', 'investor', 'partner'].includes(String(user.role))) {
    return refuse(c, 403, { code: 'investor_access_required', message: 'Co-invest listings are for investors, partners and the platform team.' });
  }
  // T17 — clamp ?limit=N (default 20, max 50) for both lists.
  const limit = clampLimit(c.req.query('limit'), 20, 50);
  const listings = await c.env.DB.prepare(
    `SELECT l.id AS listing_id, l.subsidiary_id, l.shares, l.asking_price_cents, l.ai_valuation_cents,
            s.subsidiary_name
       FROM secondary_listings l
       JOIN subsidiaries s ON s.id = l.subsidiary_id
      WHERE l.status = 'open' AND l.shares > 0
      ORDER BY l.created_at DESC LIMIT ?`
  ).bind(limit).all().catch(() => ({ results: [] }));
  const gp = fundGpScope(user as any, null, 'f');
  const pendingCalls = await c.env.DB.prepare(
    // `queue_jobs` has no fund_id column — `Jobs.enqueue` puts it in the
    // payload. Naming it directly threw, and the catch below made this list
    // permanently empty, so no pending capital call ever surfaced here.
    //
    // D370: only calls on funds the caller runs (every call, for an admin —
    // `fundGpScope` is unscoped for them). A queued call names its amount.
    `SELECT id, json_extract(payload, '$.fund_id') AS fund_id, payload, created_at FROM queue_jobs
      WHERE job_type IN ('capital_call', 'capital_call_notice') AND status IN ('pending','processing')
        AND json_extract(payload, '$.fund_id') IN (SELECT f.id FROM vc_funds f WHERE ${gp.sql})
      ORDER BY created_at DESC LIMIT ?`
  ).bind(...gp.binds, limit).all().catch(() => ({ results: [] }));
  return c.json({
    ok: true,
    co_invest_listings: listings.results || [],
    pending_capital_calls: pendingCalls.results || [],
    limit,
  });
});

funds.get('/distributions', async (c) => {
  // The fund's GP, or an admin. fund_id is parsed BEFORE the gate because the
  // gate needs it — every handler below follows the same order for that reason.
  const fundId = parseInt(c.req.query('fund_id') || '0', 10);
  if (!fundId) return c.json({ error: 'fund_id required' }, 400);
  await requireFundGp(c, fundId);
  const items = await Distributions.listByFund(c.env, fundId, 200);
  return c.json({ ok: true, items });
});

// Fund analytics. The arithmetic and the honesty rules live in
// services/fundRollup.ts, which is pure and tested; this file only does SQL.
const FUND_ROLLUP_SQL = (where: string) =>
  `SELECT f.id, f.name, f.vintage_year, f.status, f.deployed_capital,
          f.total_commitment, f.management_fee, f.carried_interest,
          COALESCE(f.fund_size_cents, 0) AS fund_size_cents,
          (SELECT COUNT(*) FROM limited_partners lp WHERE lp.fund_id = f.id) AS lp_rows,
          (SELECT COALESCE(SUM(lp.invested_amount), 0) FROM limited_partners lp
            WHERE lp.fund_id = f.id) AS called_dollars,
          (SELECT COALESCE(SUM(d.amount_cents), 0) FROM fund_distributions d
            WHERE d.fund_id = f.id AND d.status = 'paid') AS distributed_cents
     FROM vc_funds f ${where}
    ORDER BY f.vintage_year DESC, f.id DESC`;

// The two sums are independent, so they are correlated subqueries rather than
// joins, which would multiply one fund's rows by the other's row count.
async function rollUpFunds(env: Env, fundId?: number, scope?: { sql: string; binds: Array<string | number> }): Promise<FundRollup[]> {
  const where: string[] = [];
  const binds: Array<string | number> = [];
  if (fundId) { where.push('f.id = ?'); binds.push(fundId); }
  if (scope) { where.push(scope.sql); binds.push(...scope.binds); }
  const stmt = env.DB.prepare(FUND_ROLLUP_SQL(where.length ? `WHERE ${where.join(' AND ')}` : ''));
  const rows = await (binds.length ? stmt.bind(...binds) : stmt).all<FundRollupRow>();
  return (rows.results || []).map(rollUpFundRow);
}

// Family rollup. Registered before /:id so `analytics` is not read as an id.
funds.get('/analytics', async (c) => {
  // D370: the family rollup is the funds the caller runs (all of them, for an
  // admin). An LP's view of a fund is their own position, on /lp-portal.
  const user = await requireAuth(c);
  const items = await rollUpFunds(c.env, undefined, visibleFundsScope(user, { includeLp: false }));
  return c.json({
    ok: true,
    items,
    totals: totalFundRollups(items),
    unavailable: FUND_METRIC_UNAVAILABLE,
  });
});

funds.get('/:id/analytics', async (c) => {
  const fundId = parseInt(c.req.param('id'), 10);
  if (!fundId) return c.json({ error: 'invalid fund id' }, 400);
  // D370: the fund's GP of record, or an admin — the same gate as every GP
  // control. It was any signed-in role.
  await requireFundGp(c, fundId);
  const [fund] = await rollUpFunds(c.env, fundId);
  if (!fund) return c.json({ error: 'Fund not found' }, 404);
  return c.json({ ok: true, fund, unavailable: FUND_METRIC_UNAVAILABLE });
});

// /funds/:id MUST come AFTER all /funds/<word> handlers above.
funds.get('/:id', async (c) => {
  // D370: the fund's GP of record, or an admin. This returned the whole row —
  // size, deployed capital, the GP's email — plus the LP totals to any
  // signed-in role. An LP's own view of the fund is /lp-portal.
  const id = parseInt(c.req.param('id'), 10);
  await requireFundGp(c, id);
  const f = await Funds.getById(c.env, id);
  if (!f) return c.json({ error: 'not found' }, 404);
  // Compute LP count + invested totals at read time — denormalized lp_count
  // can drift under concurrent LP writes, so the read path is the source of truth.
  const agg = await c.env.DB.prepare(
    `SELECT COUNT(*) AS lp_count,
            COALESCE(SUM(commitment_amount),0) AS total_committed,
            COALESCE(SUM(invested_amount),0)   AS total_invested
       FROM limited_partners WHERE fund_id = ?`
  ).bind(id).first<{ lp_count: number; total_committed: number; total_invested: number }>();
  // LPA doc preview if any
  let lpa: any = null;
  if (f.lpa_doc_id) {
    lpa = await c.env.DB.prepare(
      `SELECT id, type, status, version, created_at, updated_at FROM legal_documents WHERE id = ?`
    ).bind(f.lpa_doc_id).first();
  }
  return c.json({
    ok: true,
    fund: { ...f, lp_count: agg?.lp_count ?? 0 },
    totals: { committed: agg?.total_committed ?? 0, invested: agg?.total_invested ?? 0 },
    lpa,
  });
});

/**
 * May this caller read THIS fund's LPA body?
 *
 * ONE definition, read by the metadata route and by the download route below.
 * Two copies of an entitlement check is how a download route ends up more
 * permissive than the screen that links to it — and the download is the half
 * that hands over the text.
 *
 * Admin, or an LP of this fund on the same predicate every other LP surface
 * uses, so a legacy LP is not refused the agreement they signed. The claim is
 * scoped to this fund: the read that justifies the write was about this fund
 * alone.
 */
async function mayReadLpa(env: Env, user: any, fundId: number): Promise<boolean> {
  if (user?.role === 'admin') return true;
  await claimLpRowsByEmail(env, Number(user?.id), user?.email, fundId);
  const scope = lpMembershipScope(user);
  const isLP = await env.DB.prepare(
    `SELECT 1 AS yes FROM limited_partners lp WHERE lp.fund_id = ? AND ${scope.sql} LIMIT 1`
  ).bind(fundId, ...scope.binds).first<{ yes: number }>();
  return !!isLP;
}

funds.get('/:id/lpa', async (c) => {
  // Security #8 — storage cleanup:
  // The LPA body is NEVER inlined in this JSON response, whatever the viewer's
  // role. An admin or an LP of this fund learns that a body EXISTS and fetches
  // it from `/:id/lpa/download`, which re-checks the same entitlement; a
  // non-LP gets metadata only.
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const f = await Funds.getById(c.env, id);
  if (!f?.lpa_doc_id) return c.json({ error: 'No LPA on file yet' }, 404);
  const doc: any = await c.env.DB.prepare(
    `SELECT * FROM legal_documents WHERE id = ?`
  ).bind(f.lpa_doc_id).first();
  if (!doc) return c.json({ error: 'doc not found' }, 404);

  // The inline body comes off for everyone, before any branch below.
  const { content, ...rest } = doc;
  const safeDoc: any = { ...rest };

  if (!(await mayReadLpa(c.env, user, id))) {
    // Non-LP, non-admin: metadata only, minus the one column on this table
    // that points AT a body.
    //
    // D174 — WHAT THIS USED TO DESTRUCTURE, AND WHY IT WAS THEATRE. It read
    // `const { file_key, file_size, file_content_type, ...meta }`, under a
    // comment saying it dropped the first of those so a non-LP could not
    // attempt a download. Measured against production: `legal_documents` has
    // twelve columns and not one of those three is among them, and nothing
    // has ever written them — so it removed nothing, and the comment
    // described a defence that never had anything to defend. `file_url` is
    // the column that does exist, and it is the one worth withholding.
    const { file_url, ...meta } = safeDoc;
    return c.json({ ok: true, doc: meta, redacted: true });
  }

  // Admin or LP.
  //
  // D174 — WHY THIS REPORTS A BODY RATHER THAN MINTING A LINK, and it is a
  // correction to this route's own TODO as much as to its output. The TODO
  // said to port the FastAPI contract-minting flow into the worker so the
  // LPADrawer's `Download LPA` button would have a `content_url` to hit. That
  // port HAD shipped — the signed-download minter is used by dd, research,
  // jobs, admin_contracts and data_room — and minting here still could not
  // have worked: that minter binds an R2 object key, and an LPA is not in R2.
  // Its body is `legal_documents.content`, inline text written by the
  // `lpa_generation` queue job. So the TODO named a mechanism that was never
  // going to fit this document, and following it would have shipped a mint
  // whose guard is false on every row that exists.
  //
  // The button is served the way this repo already serves an authenticated
  // download — `api.downloadDataRoom`'s shape, whose own comment gives the
  // reason: a plain `<a>` click cannot set the session's header, so the SPA
  // fetches the blob and clicks it client-side. That re-checks entitlement on
  // every hit, where a signed token in a URL is replayable for its window.
  //
  // WHAT THE DRAWER SHOWED BEFORE ANY OF THIS. No `content_url` was ever sent
  // to anyone, so `FundsPage.jsx` fell to its `content_url`-absent branch for
  // EVERY reader and told an LP who had just passed the check above — and
  // every admin — "you are not an LP of this fund". A false claim about
  // entitlement, shown to exactly the two audiences who have it.
  const hasBody = typeof content === 'string' && content.trim().length > 0;
  return c.json({ ok: true, doc: safeDoc, content_available: hasBody });
});

funds.get('/:id/lpa/download', async (c) => {
  // The body, for a reader `mayReadLpa` allows — the one place it leaves the
  // database. It is never inlined in the metadata response above, so a drawer
  // that merely opens has not handed over the agreement.
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const f = await Funds.getById(c.env, id);
  if (!f?.lpa_doc_id) return c.json({ error: 'No LPA on file yet' }, 404);
  if (!(await mayReadLpa(c.env, user, id))) {
    return c.json({ error: 'You are not an LP of this fund.', code: 'lpa_not_entitled' }, 403);
  }
  const row = await c.env.DB.prepare(
    `SELECT content, version FROM legal_documents WHERE id = ?`
  ).bind(f.lpa_doc_id).first<{ content: string | null; version: number | null }>();
  const body = typeof row?.content === 'string' ? row.content : '';
  if (!body.trim()) {
    // Deliberately a different answer from the 403 above: "we have nothing to
    // give you" and "you may not have it" are different facts about one click,
    // and collapsing them is the defect D174 exists to correct.
    return c.json({ error: 'No LPA body is stored for this fund.', code: 'lpa_no_body' }, 404);
  }
  // Recorded because this is the fund's constitutional document leaving the
  // store. Best-effort by construction — `logActivity` swallows its own
  // failures, and a download must not fail because its audit row did.
  await logActivity(c.env, Number(user.id), 'fund_lpa_downloaded', {
    entityType: 'vc_fund', entityId: id, metadata: { doc_id: f.lpa_doc_id },
  });
  // Built from two integers and never from stored text: a filename carrying a
  // quote or a newline would rewrite the response headers.
  const filename = `lpa-fund-${id}-v${Number(row?.version) || 1}.txt`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});

funds.post('/', async (c) => {
  // Nothing to own at call time, so this gates on tier alone and then RECORDS
  // ownership: a non-admin creator becomes the fund's GP of record, which is
  // what every other control here checks. An admin creating a fund on behalf
  // of a GP leaves gp_user_id unset for them to fill in, rather than silently
  // making the operator the fiduciary of record.
  const { user: creator, viaAdmin, companyId } = await requireFundCreator(c);
  const body = await c.req.json<Partial<{
    name: string; vintage_year: number; total_commitment: number;
    fund_size_cents: number; carried_interest: number; management_fee: number;
    status: 'fundraising' | 'active' | 'closed' | 'wound_down';
  }>>();
  if (!body?.name) return c.json({ error: 'name required' }, 400);
  const f = await Funds.create(c.env, body);
  if (!f) return c.json({ error: 'create failed' }, 500);
  // Stamp the GP of record. Without this a non-admin creates a fund and is
  // then locked out of it by every other control on this router, since they
  // would own nothing — the fund would be operable only by an admin, which is
  // the state this task exists to remove.
  //
  // gp_name/title/email are deliberately NOT set from the account profile:
  // migration 163 is explicit that those are the strings AS THEY APPEAR ON THE
  // DOCUMENT, signed in a legal capacity, and guessing them would put an
  // unreviewed name on an LP-facing report. They stay unset and render as
  // "not recorded" until the GP enters them.
  //
  // The firm is stamped in the SAME statement, company scoping stage 7. One
  // UPDATE rather than a branch: `company_id = ?` bound to null writes NULL,
  // which is exactly the state a creator with no company selected should have,
  // and 195 reads as "this GP's fund under every company". Guessing their
  // primary company instead would put a firm on a fund they never named.
  if (!viaAdmin) {
    await ensureFundGpColumns(c.env);
    await c.env.DB.prepare(`UPDATE vc_funds SET gp_user_id = ?, company_id = ? WHERE id = ?`)
      .bind(creator.id, companyId, f.id).run();
    (f as any).gp_user_id = creator.id;
    (f as any).company_id = companyId;
  }
  // NO GP OF RECORD, NO LPA (D370, the Fabric canvas's F10 rule). The LPA is
  // the document a GP signs as fiduciary; generating one for a fund with no
  // GP of record puts an agreement with nobody's name behind it into the LP
  // record. An admin-created fund has none until a GP is named, so its LPA
  // waits — the response says so, and regenerate-lpa is the door once named.
  if (!(f as any).gp_user_id) {
    return c.json({
      ok: true,
      fund: f,
      lpa_status: 'blocked_no_gp',
      lpa_reason: 'No LPA is drafted until the fund has a general partner of record.',
    }, 201);
  }
  // Auto-generate LPA via job queue (non-blocking).
  await enqueueJob(c.env, 'lpa_generation', { fund_id: f.id });
  return c.json({ ok: true, fund: f, lpa_status: 'enqueued' }, 201);
});

funds.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  await requireFundGp(c, id);
  const body = await c.req.json();
  const f = await Funds.update(c.env, id, body);
  return c.json({ ok: true, fund: f });
});

funds.post('/:id/regenerate-lpa', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { fund } = await requireFundGp(c, id);
  if (!fund?.gp_user_id) {
    return refuse(c, 409, {
      code: 'no_gp_of_record',
      message: 'Name the fund\'s general partner of record before an LPA is drafted.',
    });
  }
  // Clear any prior LPA doc reference so the worker re-generates.
  await c.env.DB.prepare(`UPDATE vc_funds SET lpa_doc_id = NULL WHERE id = ?`).bind(id).run();
  const job = await Jobs.enqueue(c.env, 'lpa_generation', { fund_id: id });
  return c.json({ ok: true, enqueued_job: job });
});

// ---------- LPs ----------
funds.get('/:id/lps', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  await requireFundGp(c, id);
  const r = await LPs.listByFund(c.env, id);
  return c.json({ ok: true, items: r.results || [] });
});

// ---------- quarterly reporting periods ----------
//
// A period row is what makes a quarterly report REPRODUCIBLE. The capital
// account can be reconstructed as-of any date from dated capital_calls and
// fund_distributions rows, but portfolio MARKS cannot — position values live in
// an operator-maintained model with no history — so a report re-rendered next
// year under an old heading would silently carry today's marks. Issuing a period
// freezes the fund-level figures into `snapshot_json`, and the GP's own
// commentary into `notes`, so every later download of that period is the
// document that was actually sent.
//
// Until a period is issued, every report generated for it is a DRAFT: the
// renderer marks it as such, because a report with no GP letter is not a report
// a fiduciary has stood behind.

const shapePeriod = (row: any) => ({
  ...row,
  narrative: parseJson<PeriodNarrative>(row?.notes, {}),
  snapshot: parseJson<Record<string, unknown> | null>(row?.snapshot_json, null),
});

funds.get('/:id/report-periods', async (c) => {
  await ensureFundGpColumns(c.env);
  const fundId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(fundId)) return c.json({ error: 'bad id' }, 400);
  await requireFundGp(c, fundId);
  const r = await c.env.DB.prepare(
    `SELECT * FROM fund_report_periods WHERE fund_id = ? ORDER BY period_end DESC LIMIT 40`
  ).bind(fundId).all().catch(() => ({ results: [] }));
  return c.json({ ok: true, items: (r.results || []).map(shapePeriod) });
});

/**
 * Create or update a reporting period, and optionally issue it.
 *
 * Issuing is one-way on purpose: once `status = 'issued'`, the snapshot and the
 * narrative are the record of what LPs received. A later edit would rewrite
 * history under a document already in an LP's inbox, so the route refuses it
 * and asks for a correcting period instead.
 */
funds.post('/:id/report-periods', async (c) => {
  await ensureFundGpColumns(c.env);
  const fundId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(fundId)) return c.json({ error: 'bad id' }, 400);
  // The issuer recorded on the period is now whoever actually issued it —
  // the GP signing their own quarterly report, or an admin acting for them.
  const { user: issuer } = await requireFundGp(c, fundId);

  const body = await c.req.json().catch(() => ({} as any));
  const period = String(body?.period || '').trim();
  const periodStart = String(body?.period_start || '').trim();
  const periodEnd = String(body?.period_end || '').trim();
  if (!period || !periodStart || !periodEnd) {
    return c.json({ error: 'period, period_start and period_end are required' }, 400);
  }
  if (periodEnd < periodStart) return c.json({ error: 'period_end precedes period_start' }, 400);

  const existing: any = await c.env.DB.prepare(
    `SELECT * FROM fund_report_periods WHERE fund_id = ? AND period = ?`
  ).bind(fundId, period).first();
  if (existing?.status === 'issued') {
    return c.json({ error: 'period already issued — issue a correcting period instead' }, 409);
  }

  const notes = body?.narrative === undefined
    ? (existing?.notes ?? null)
    : JSON.stringify(body.narrative ?? {});
  const issue = body?.issue === true;
  // The snapshot is only meaningful at issue: a draft is always re-rendered
  // from live figures, which is what makes it a draft.
  const snapshot = issue ? JSON.stringify(body?.snapshot ?? {}) : (existing?.snapshot_json ?? null);

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE fund_report_periods
          SET period_start = ?, period_end = ?, notes = ?, snapshot_json = ?,
              status = ?, issued_at = ?, issued_by = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).bind(
      periodStart, periodEnd, notes, snapshot,
      issue ? 'issued' : 'draft',
      issue ? new Date().toISOString() : null,
      issue ? issuer.id : null,
      existing.id,
    ).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO fund_report_periods
         (fund_id, period, period_start, period_end, notes, snapshot_json, status, issued_at, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      fundId, period, periodStart, periodEnd, notes, snapshot,
      issue ? 'issued' : 'draft',
      issue ? new Date().toISOString() : null,
      issue ? issuer.id : null,
    ).run();
  }

  const row: any = await c.env.DB.prepare(
    `SELECT * FROM fund_report_periods WHERE fund_id = ? AND period = ?`
  ).bind(fundId, period).first();
  return c.json({ ok: true, period: row ? shapePeriod(row) : null }, existing ? 200 : 201);
});

/**
 * GP view of ONE limited partner's reporting data, in the same shape
 * `/lp-portal` returns for the caller's own position — so the quarterly-report
 * renderer is one code path whether an LP downloads their own statement or the
 * GP produces it on their behalf.
 *
 * Admin-only, and deliberately narrow: it answers for a single named LP of a
 * single named fund, so it cannot be used to enumerate the LP register (that is
 * already what GET /:id/lps is for, under the same gate).
 */
funds.get('/:id/lp-report/:lpId', async (c) => {
  await ensureFundGpColumns(c.env);
  const fundId = parseInt(c.req.param('id'), 10);
  const lpId = parseInt(c.req.param('lpId'), 10);
  await requireFundGp(c, fundId);
  if (!Number.isFinite(fundId) || !Number.isFinite(lpId)) {
    return c.json({ error: 'bad id' }, 400);
  }

  // One row, and it must belong to the named fund: an LP id from another fund
  // would otherwise render under this fund's letterhead.
  const lp: any = await c.env.DB.prepare(
    `SELECT lp.*,
            COALESCE(u.name,  lp.name)  AS lp_display_name,
            COALESCE(u.email, lp.email) AS lp_display_email,
            f.name AS fund_name, f.status AS fund_status, f.carried_interest, f.management_fee,
            f.slug AS fund_slug, f.vintage_year AS fund_vintage,
            f.gp_name, f.gp_title, f.gp_email, f.gp_entity,
            f.fund_admin, f.auditor, f.legal_counsel, f.custodian, f.valuation_policy
       FROM limited_partners lp
       JOIN vc_funds f ON f.id = lp.fund_id
       LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.id = ? AND lp.fund_id = ?`
  ).bind(lpId, fundId).first();
  if (!lp) return c.json({ error: 'not found' }, 404);

  const calls = await c.env.DB.prepare(
    `SELECT * FROM capital_calls WHERE limited_partner_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(lpId).all().catch(() => ({ results: [] }));

  const dists: any[] = (await c.env.DB.prepare(
    `SELECT d.*, f.name AS fund_name
       FROM fund_distributions d JOIN vc_funds f ON f.id = d.fund_id
      WHERE d.lp_id = ? ORDER BY d.created_at DESC LIMIT 200`
  ).bind(lpId).all().catch(() => ({ results: [] }))).results || [];

  // Same arithmetic as /lp-portal — kept identical on purpose so the GP's copy
  // of a statement and the LP's own copy can never disagree.
  const distSumDollars = dists.reduce((s: number, d: any) => s + Number(d.amount_cents || 0) / 100, 0);
  const invested = Number(lp.invested_amount || 0);
  const returns = Number(lp.returns || 0);
  // Null with nothing paid in, as the LP's own portal says (D372).
  const tvpi = invested > 0 ? Number(((invested + returns + distSumDollars) / invested).toFixed(3)) : null;
  const dpi = invested > 0 ? Number(((returns + distSumDollars) / invested).toFixed(3)) : null;

  return c.json({
    ok: true,
    lp_holdings: [lp],
    capital_calls: calls.results || [],
    distributions: dists,
    performance: [{
      lp_id: lp.id,
      fund_id: lp.fund_id,
      fund_name: lp.fund_name,
      fund_slug: lp.fund_slug ?? null,
      commitment: invested + Math.max(0, Number(lp.commitment_amount || 0) - invested),
      invested_amount: invested,
      returns,
      distributions_dollars: distSumDollars,
      tvpi,
      dpi,
      lpa_signed: !!lp.lpa_signed,
      commitment_date: lp.commitment_date ?? null,
    }],
    funds: fundFacts([lp]),
    recipient: { name: lp.lp_display_name ?? null, email: lp.lp_display_email ?? null },
  });
});

funds.post('/:id/lps', async (c) => {
  const fundId = parseInt(c.req.param('id'), 10);
  const { user } = await requireFundGp(c, fundId);
  const body = await c.req.json();
  const lp = await LPs.create(c.env, { ...body, fund_id: fundId });
  if (!lp) return c.json({ error: 'create failed' }, 500);
  // First-call automation: enqueue a notice immediately if amount provided.
  // Task #197 — `call_uid` identifies THIS call, so the job's ledger rows are
  // idempotent across retries without two presses colliding. See
  // `_capital_call_writes.ts` for why it cannot come from the job id.
  if (body?.first_call_cents && body.first_call_cents > 0) {
    await Jobs.enqueue(c.env, 'capital_call_notice', {
      fund_id: fundId,
      amount_cents: body.first_call_cents,
      call_uid: crypto.randomUUID(),
      due_date: body?.first_call_due_date || null,
      // D371: the call header records who issued it.
      issued_by: Number(user.id),
    });
  }
  return c.json({ ok: true, lp }, 201);
});

funds.post('/lps/:lpId/sign-lpa', async (c) => {
  // LP signs their LPA. Binding signature → enforce KYC. Limited-access
  // users (kyc !== 'approved') are blocked; admins still pass through.
  const user = await requireApprovedKyc(c);
  const lpId = parseInt(c.req.param('lpId'), 10);
  const lp = await LPs.getById(c.env, lpId);
  if (!lp) return c.json({ error: 'LP not found' }, 404);
  if (user.role !== 'admin' && lp.user_id !== user.id) {
    return c.json({ error: 'Not your LP record' }, 403);
  }
  const updated = await LPs.signLPA(c.env, lpId);
  if (!updated) return c.json({ error: 'Already signed or could not sign' }, 409);
  await logActivity(c.env, user.id, 'lpa_signed', {
    entityType: 'limited_partner', entityId: lpId, metadata: { fund_id: lp.fund_id },
  }).catch(() => {});
  return c.json({ ok: true, lp: updated });
});

// ---------- Capital calls: issue, preview, receipts, ledger (D371) ----------

/** A real calendar date written YYYY-MM-DD, or null. */
function isoDate(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** The amount a request names, in cents: `amount_cents`, or `amount` in dollars. */
function requestCents(body: { amount_cents?: unknown; amount?: unknown }): number | null {
  const cents = body.amount_cents != null
    ? Number(body.amount_cents)
    : Math.round(Number(body.amount ?? NaN) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

const BAD_AMOUNT = {
  code: 'invalid_amount',
  message: 'A capital call needs an amount above zero, in whole cents.',
};

/**
 * Issue a call: the header, one line per billed LP and the notices, written
 * now rather than queued. The route used to enqueue `capital_call_notice` and
 * answer before anything existed, so the page a GP issued from could not show
 * the call it had just made. The job still exists — an LP's first call is
 * enqueued from `POST /:id/lps` — and runs the same `issueFundCall`.
 *
 * `due_date` is passed through and NEVER DEFAULTED (task 197): a deadline an LP
 * acts on is one the GP typed. It must be a real date when given.
 */
funds.post('/:id/capital-call', async (c) => {
  const fundId = parseInt(c.req.param('id'), 10);
  const { user } = await requireFundGp(c, fundId);
  const body = await c.req.json<{
    amount_cents?: number; amount?: number; note?: string; purpose?: string; due_date?: string;
  }>().catch(() => ({} as any));
  const amountCents = requestCents(body);
  if (amountCents === null) return refuse(c, 400, BAD_AMOUNT);
  const rawDue = typeof body.due_date === 'string' ? body.due_date.trim() : '';
  const dueDate = rawDue ? isoDate(rawDue) : null;
  if (rawDue && !dueDate) {
    return refuse(c, 400, { code: 'invalid_due_date', message: 'The due date must be a real date, written YYYY-MM-DD.' });
  }
  const purposeRaw = String(body.purpose ?? body.note ?? '').trim();
  const purpose = purposeRaw ? purposeRaw.slice(0, 500) : null;

  const issued = await issueFundCall(c.env, {
    fundId, amountCents, callUid: crypto.randomUUID(), dueDate, purpose, issuedBy: Number(user.id),
  });
  if (!issued.call) {
    return refuse(c, 409, {
      code: 'no_billable_lps',
      message: 'This fund has no committed or active LP with a commitment, so a call would bill nobody. Add an LP first.',
    });
  }
  await logActivity(c.env, Number(user.id), 'capital_call_issued', {
    entityType: 'fund', entityId: fundId,
    metadata: { call_number: issued.call.call_number, amount_cents: amountCents, lines: issued.written.length },
  }).catch(() => {});
  return c.json({ ok: true, call: issued.call, lines_written: issued.written.length, due_date: dueDate }, 201);
});

/**
 * What a call of this amount would ask each LP for, before it is issued. The
 * same `splitCall` the issue runs, over the same billed LPs, so the preview
 * and the ledger cannot disagree about a line.
 */
funds.post('/:id/capital-calls/preview', async (c) => {
  const fundId = parseInt(c.req.param('id'), 10);
  await requireFundGp(c, fundId);
  const body = await c.req.json<{ amount_cents?: number; amount?: number }>().catch(() => ({} as any));
  const amountCents = requestCents(body);
  if (amountCents === null) return refuse(c, 400, BAD_AMOUNT);
  const lps = (await c.env.DB.prepare(
    `SELECT lp.id, lp.commitment_amount, lp.user_id,
            COALESCE(u.name, lp.name) AS name, COALESCE(u.email, lp.email) AS email,
            u.kyc_status AS kyc_status
       FROM limited_partners lp
       LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.fund_id = ? AND lp.status IN ('committed', 'active')
      ORDER BY lp.id`,
  ).bind(fundId).all<any>()).results || [];
  const split = splitCall(amountCents, lps);
  const byId = new Map(lps.map((lp: any) => [Number(lp.id), lp]));
  const next = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(call_number), 0) + 1 AS n FROM fund_capital_calls WHERE fund_id = ?`,
  ).bind(fundId).first<{ n: number }>();
  const who = (id: number) => {
    const lp: any = byId.get(id) || {};
    return {
      lp_id: id, name: lp.name ?? null, email: lp.email ?? null, has_account: lp.user_id != null,
      kyc_status: lp.user_id != null ? (lp.kyc_status ?? null) : null,
    };
  };
  return c.json({
    ok: true,
    amount_cents: amountCents,
    next_call_number: Number(next?.n ?? 1),
    total_commitment_cents: split.totalCommitmentCents,
    residual_cents: split.residualCents,
    residual_lp_id: split.residualLpId,
    lines: split.lines.map((l) => ({
      ...who(l.lpId), commitment_cents: l.commitmentCents, share_cents: l.shareCents, residual: l.residual,
    })),
    excluded: split.excluded.map((x) => ({ ...who(x.lpId), reason: x.reason })),
  });
});

/** Every call on the fund, each with its LP lines, and the fund's call totals. */
funds.get('/:id/capital-calls', async (c) => {
  const fundId = parseInt(c.req.param('id'), 10);
  const { fund } = await requireFundGp(c, fundId);
  try {
    const ledger = await readFundCalls(c.env, fundId, todayUtc());
    return c.json({ ok: true, fund: { id: fund.id, name: fund.name }, today: todayUtc(), ...ledger });
  } catch (e) {
    return refuse(c, 503, {
      code: 'call_ledger_unreadable',
      message: "This fund's call ledger could not be read. Nothing here says the fund has no calls; try again.",
      raw: e,
    });
  }
});

/**
 * The fund's capital ledger — calls issued and receipts recorded, newest
 * first. `?lp=<id>` narrows it to one LP's history, and that LP must be on
 * this fund.
 */
funds.get('/:id/ledger', async (c) => {
  const fundId = parseInt(c.req.param('id'), 10);
  await requireFundGp(c, fundId);
  const lpRaw = c.req.query('lp');
  let lpId: number | null = null;
  if (lpRaw != null && lpRaw !== '') {
    lpId = /^\d+$/.test(lpRaw) ? Number(lpRaw) : NaN;
    const onFund = Number.isSafeInteger(lpId) && await c.env.DB.prepare(
      `SELECT 1 AS yes FROM limited_partners WHERE id = ? AND fund_id = ?`,
    ).bind(lpId, fundId).first();
    if (!onFund) return refuse(c, 404, { code: 'lp_not_on_fund', message: 'That LP is not on this fund.' });
  }
  try {
    const ledger = await readFundLedger(c.env, fundId, lpId);
    return c.json({ ok: true, lp_id: lpId, ...ledger });
  } catch (e) {
    return refuse(c, 503, {
      code: 'ledger_unreadable',
      message: "This fund's ledger could not be read. Nothing here says no money has moved; try again.",
      raw: e,
    });
  }
});

/**
 * The GP records a wire against one LP's line: how much, the date it landed,
 * its reference. Append-only (migration 312); the line is paid once its
 * receipts reach what it owes. The line must be on this fund — a line id from
 * another fund is the same 404 as one that does not exist.
 */
funds.post('/:id/capital-calls/lines/:lineId/receipts', async (c) => {
  const fundId = parseInt(c.req.param('id'), 10);
  const lineId = parseInt(c.req.param('lineId'), 10);
  const { user } = await requireFundGp(c, fundId);
  const notFound = () => refuse(c, 404, { code: 'call_line_not_found', message: 'That call line is not on this fund.' });
  if (!Number.isSafeInteger(lineId) || lineId <= 0) return notFound();
  const line = await readLine(c.env, lineId);
  if (!line || Number(line.fund_id) !== fundId) return notFound();

  const body = await c.req.json<{ amount_cents?: number; received_on?: string; reference?: string }>()
    .catch(() => ({} as any));
  const cents = Number(body.amount_cents);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    return refuse(c, 400, { code: 'invalid_amount', message: 'A receipt is an amount above zero, in whole cents.' });
  }
  const receivedOn = isoDate(body.received_on);
  const latest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (!receivedOn || receivedOn > latest) {
    return refuse(c, 400, {
      code: 'invalid_received_on',
      message: 'The date the wire landed must be a real date, written YYYY-MM-DD, and not in the future.',
    });
  }
  const reference = String(body.reference ?? '').trim().slice(0, 120) || null;

  const outcome = await recordReceipt(c.env, {
    lineId, amount: cents, receivedOn, reference, source: 'receipt', recordedBy: Number(user.id),
  });
  if (outcome.kind === 'not_found') return notFound();
  if (outcome.kind === 'already_paid') {
    return refuse(c, 409, { code: 'line_already_paid', message: 'This line is already paid in full; nothing was recorded.' });
  }
  if (outcome.kind === 'exceeds_outstanding') {
    return refuse(c, 409, {
      code: 'receipt_exceeds_outstanding',
      message: 'That is more than this line still owes, so nothing was recorded. Record the amount outstanding, or less.',
      extra: { outstanding_cents: outcome.outstandingCents },
    });
  }
  await logActivity(c.env, Number(user.id), 'capital_call_receipt_recorded', {
    entityType: 'capital_call', entityId: lineId,
    metadata: { fund_id: fundId, amount_cents: cents, received_on: receivedOn, paid: outcome.paid },
  }).catch(() => {});
  return c.json({ ok: true, receipt: outcome.receipt, line: outcome.line, paid: outcome.paid }, 201);
});

// ---------- Distributions ----------
funds.post('/distributions/execute', async (c) => {
  // Money movement: this fans cash out to a fund's LPs. The fund's own GP may
  // run it for their own fund; nobody may run it for anyone else's.
  //
  // fund_id arrives in the BODY, so the body is read before the gate — the
  // gate cannot know which fund is targeted until it has been. That ordering
  // is load-bearing: gating first and reading second would authorise against
  // a fund id nobody had supplied yet.
  //
  // fund_id stays REQUIRED for the original reason too: the worker refuses to
  // fan out across funds.
  const body = await c.req.json<{
    fund_id: number;
    liquidity_event_id?: number;
    proceeds_cents: number;
    subsidiary_id?: number;
  }>();
  if (!body?.proceeds_cents || body.proceeds_cents <= 0) {
    return c.json({ error: 'proceeds_cents must be > 0' }, 400);
  }
  if (!body?.fund_id) {
    return c.json({ error: 'fund_id required (target a specific fund)' }, 400);
  }
  const { user } = await requireFundGp(c, Number(body.fund_id));
  // For manual runs without a real liquidity event, create a placeholder one
  // so source_liquidity_event_id is always non-null and distributions are auditable.
  let evtId = body.liquidity_event_id;
  if (!evtId) {
    const evt: any = await c.env.DB.prepare(
      `INSERT INTO liquidity_events (subsidiary_id, event_type, status, valuation_cents, shares_offered, executed_price_cents, executed_at)
       VALUES (?, 'distribution', 'executed', ?, 0, ?, datetime('now')) RETURNING id`
    ).bind(body.subsidiary_id ?? null, body.proceeds_cents, body.proceeds_cents).first();
    evtId = evt?.id;
  }
  const job = await Jobs.enqueue(c.env, 'returns_distribution', {
    liquidity_event_id: evtId,
    fund_id: body.fund_id,
    proceeds_cents: body.proceeds_cents,
    subsidiary_id: body.subsidiary_id,
  });
  await logActivity(c.env, user.id, 'distribution_triggered', {
    entityType: 'fund', entityId: body.fund_id ?? 0,
    metadata: { proceeds_cents: body.proceeds_cents, liquidity_event_id: evtId },
  }).catch(() => {});
  return c.json({ ok: true, enqueued_job: job, liquidity_event_id: evtId });
});

funds.post('/distributions/:id/mark-paid', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  // Atomic: only credit the LP if we successfully transitioned pending → paid.
  // We fetch the row first to know the LP/amount, then run both writes in a batch
  // gated on a conditional UPDATE so a concurrent caller can't double-credit.
  const row = await c.env.DB.prepare(
    // fund_id joins the projection so ownership can be resolved: the path
    // parameter here identifies a DISTRIBUTION, not a fund, and marking one
    // paid credits an LP — so the gate has to run against the fund the row
    // actually belongs to, never against an id the caller supplied.
    `SELECT id, lp_id, amount_cents, status, fund_id FROM fund_distributions WHERE id = ?`
  ).bind(id).first<{ id: number; lp_id: number; amount_cents: number; status: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  // Gate BEFORE the status check, so 'already settled' cannot confirm the
  // existence of another GP's distribution.
  await requireFundGp(c, Number((row as any).fund_id));
  if (row.status !== 'pending') return c.json({ error: 'already settled' }, 409);

  const dollars = row.amount_cents / 100;
  const [updRes, _lpRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE fund_distributions
          SET status = 'paid', distributed_at = datetime('now')
        WHERE id = ? AND status = 'pending'`
    ).bind(id),
    c.env.DB.prepare(
      `UPDATE limited_partners
          SET returns = returns + ?, updated_at = datetime('now')
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM fund_distributions WHERE id = ? AND status = 'pending')`
    ).bind(dollars, row.lp_id, id),
  ]);
  // If the conditional UPDATE didn't fire, no LP credit happened either.
  // @ts-ignore — D1 result shape: meta.changes
  const changed = (updRes as any)?.meta?.changes ?? 0;
  if (!changed) return c.json({ error: 'lost race; already settled' }, 409);
  return c.json({
    ok: true,
    distribution: { ...row, status: 'paid' },
  });
});

export default funds;
