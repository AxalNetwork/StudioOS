/**
 * D714 (#1779) — the fund administration act table, and the gate every fund
 * write runs after its own access check.
 *
 * S1's split: a Super Admin issues capital calls, executes distributions,
 * changes a fund's general partner of record or its economics, and assigns
 * its ledger administrator. A plain Admin (any `role = 'admin'` account on HQ
 * without the elevation) previews, records receipts, marks distributions
 * paid, drafts report periods and writes the books. Nothing in fund
 * operations told the two apart before this file.
 *
 * HOW A ROUTE USES IT. `routes/funds.ts` keeps its `requireFundGp(...)` call
 * on every handler (`funds_deadmin.test.ts` pins that), then runs
 * `assertFundAct(c, gp, act)` on the context it returned. Routes with no
 * `requireFundGp` — the two legacy `/api/capital` issue routes and the
 * ledger's writes — run `assertAdminAct(c, user, act)`. Reads carry no act.
 *
 * THE ORDER, and why each step sits where it does:
 *   1. a support session is refused every act, whoever it acts as, on HQ and
 *      on a branch: an admin never moves a member's money, or writes a
 *      member's books, by acting as the member;
 *   2. a Super Admin act during a recovery cool-off gets the cool-off's 423 —
 *      the in-gate twin of `index.ts`'s route list, for the acts that share a
 *      route with reads the cool-off must not pause;
 *   3. on a branch Worker the admin rows do not apply (a branch has no Super
 *      Admin, D106) and today's gate stands;
 *   4. an admin on an Admin act passes `requireAdmin`, so a frozen admin's
 *      write gets the D135 423;
 *   5. an admin without the elevation on a Super Admin act is refused AT
 *      ONCE with `super_admin_required` — before any TOTP or step-up demand,
 *      so a plain Admin is never asked for a code it cannot use — and the
 *      Super Admin then passes `requireSuperAdminWriteBar`;
 *   6. a non-admin GP of record keeps today's power over their own fund,
 *      except changing its GP of record, which hands every GP gate to another
 *      account, and moving the Fund I slug, which decides which fund the Fund
 *      I bank account pays (D708 decision 13). The slug move is checked
 *      before step 3, so a branch Worker refuses it too: no branch account
 *      holds the elevation.
 *
 * IT REFUSES BY THROWING A `Response`, never an `Error`, as `requireFundGp`
 * does. The report-period handlers and the ledger router map every thrown
 * auth sentence to `fund_access_refused`; a step-up or a freeze thrown as an
 * Error inside either reached the SPA as a refusal the admin could not
 * answer. A thrown Response passes both through unchanged
 * (`util/thrownResponse.ts`), so the step-up prompt and the freeze banner
 * work on every route in the table.
 *
 * `requireFundGp` itself does not change.
 */
import type { Context } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin, requireAuth, requireSuperAdminWriteBar, selectJwt } from '../auth';
import { branchOf, HQ_ONLY } from '../util/branch';
import {
  ADMIN_FROZEN, AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, adminFrozenBody, stepUpRefusalBody,
} from '../util/authErrors';
import { recoveryCoolOffBody } from '../middleware/recoveryCoolOff';
import { logAdminAction } from './adminAudit';
import type { FundGpContext } from './fundGpAccess';

export type FundActTier = 'admin' | 'super_admin';

export type FundActKey =
  | 'capital_call.preview' | 'capital_call.issue' | 'capital_call.receipt'
  | 'distribution.preview' | 'distribution.execute' | 'distribution.mark_paid'
  | 'fund_report.draft' | 'fund_report.issue'
  | 'fund.gp_of_record' | 'fund.slug_fund_i' | 'fund.economics' | 'fund.write'
  | 'fund_ledger.administrator' | 'fund_ledger.write'
  | 'bank_account.see' | 'bank_account.change' | 'bank_account.reveal';

export type FundAct = Readonly<{
  act: FundActKey;
  label: string;
  /** Method and path, as `index.ts` mounts them. A parenthesis names the body that selects the act. */
  routes: readonly string[];
  tier: FundActTier;
  /** The task whose routes decide the act. */
  owner: string;
  /** What a plain Admin reads in place of a Super Admin act's control. */
  sentence: string | null;
}>;

const act = (row: FundAct): FundAct => Object.freeze({ ...row, routes: Object.freeze([...row.routes]) });

/** Decision 1: one act table. Rows of #1774 and #1775 join from `main` (decision 6); #1777's issue row (D712) and #1773's rows have joined. */
export const FUND_ACTS: readonly FundAct[] = Object.freeze([
  act({ act: 'capital_call.preview', label: 'Preview a capital call', tier: 'admin', owner: '#1779', sentence: null,
    routes: ['POST /api/funds/:id/capital-calls/preview'] }),
  act({ act: 'capital_call.issue', label: 'Issue a capital call', tier: 'super_admin', owner: '#1779',
    sentence: 'A Super Admin issues capital calls.',
    routes: ['POST /api/funds/:id/capital-call', 'POST /api/funds/:id/lps (first_call_cents > 0)',
      'POST /api/capital/calls', 'POST /api/capital/capitalCall'] }),
  act({ act: 'capital_call.receipt', label: 'Record a receipt', tier: 'admin', owner: '#1779', sentence: null,
    routes: ['POST /api/funds/:id/capital-calls/lines/:lineId/receipts'] }),
  act({ act: 'distribution.preview', label: 'Preview a distribution', tier: 'admin', owner: '#1779', sentence: null,
    routes: ['POST /api/funds/:id/distributions/preview'] }),
  act({ act: 'distribution.execute', label: 'Execute a distribution', tier: 'super_admin', owner: '#1779',
    sentence: 'A Super Admin executes distributions.',
    routes: ['POST /api/funds/distributions/execute'] }),
  act({ act: 'distribution.mark_paid', label: 'Mark a distribution paid', tier: 'admin', owner: '#1779', sentence: null,
    routes: ['POST /api/funds/distributions/:id/mark-paid'] }),
  act({ act: 'fund_report.draft', label: 'Save a report period draft', tier: 'admin', owner: '#1779', sentence: null,
    routes: ['POST /api/funds/:id/report-periods'] }),
  act({ act: 'fund_report.issue', label: 'Issue a fund report pack', tier: 'super_admin', owner: '#1777',
    sentence: 'A Super Admin issues fund reports.',
    routes: ['POST /api/fund-reporting/drafts/:uid/issue'] }),
  act({ act: 'fund.gp_of_record', label: "Change a fund's general partner of record", tier: 'super_admin', owner: '#1779',
    sentence: "A Super Admin changes a fund's general partner of record.",
    routes: ['PATCH /api/funds/:id (gp_user_id)'] }),
  act({ act: 'fund.slug_fund_i', label: "Move the Fund I slug onto or off a fund", tier: 'super_admin', owner: '#1773',
    sentence: 'A Super Admin decides which fund the Fund I bank account pays.',
    routes: ['PATCH /api/funds/:id (slug, to or from spinout-fund-i)'] }),
  act({ act: 'fund.economics', label: "Change a fund's carry or management fee", tier: 'super_admin', owner: '#1779',
    sentence: "A Super Admin changes a fund's carry or management fee.",
    routes: ['PATCH /api/funds/:id (carried_interest, management_fee)'] }),
  act({ act: 'fund.write', label: 'Edit a fund and its LP records', tier: 'admin', owner: '#1779', sentence: null,
    routes: ['PATCH /api/funds/:id', 'POST /api/funds/:id/lps', 'PUT /api/funds/:id/lps/:lpId/type',
      'POST /api/funds/:id/comms', 'POST /api/funds/:id/regenerate-lpa'] }),
  act({ act: 'fund_ledger.administrator', label: "Assign a fund's ledger administrator", tier: 'super_admin', owner: '#1779',
    sentence: "A Super Admin assigns a fund's ledger administrator.",
    routes: ['PUT /api/fund-ledger/:id/administrator'] }),
  act({ act: 'fund_ledger.write', label: 'Write the fund ledger', tier: 'admin', owner: '#1779', sentence: null,
    routes: ['POST /api/fund-ledger/:id/accounts', 'POST /api/fund-ledger/:id/periods', 'POST /api/fund-ledger/:id/fee-terms',
      'POST /api/fund-ledger/:id/periods/:periodId/entries', 'POST /api/fund-ledger/:id/periods/:periodId/fee-accrual',
      'POST /api/fund-ledger/:id/periods/:periodId/expenses', 'POST /api/fund-ledger/:id/lines/:lineId/reconcile',
      'POST /api/fund-ledger/:id/periods/:periodId/state'] }),
  // #1773's console (D708 decision 5). Its routes keep their own gates
  // (`requireSuperAdmin`, `superAdminWriter`); the rows let the console say
  // who holds them.
  act({ act: 'bank_account.see', label: "See the entities' bank accounts", tier: 'super_admin', owner: '#1773',
    sentence: "A Super Admin sees the entities' bank accounts.",
    routes: ['GET /api/admin/bank-accounts'] }),
  act({ act: 'bank_account.change', label: 'Enter, change or retire bank details', tier: 'super_admin', owner: '#1773',
    sentence: 'A Super Admin enters and changes bank details.',
    routes: ['POST /api/admin/bank-accounts', 'PATCH /api/admin/bank-accounts/:uid', 'POST /api/admin/bank-accounts/:uid/retire'] }),
  act({ act: 'bank_account.reveal', label: 'Reveal a full account number', tier: 'super_admin', owner: '#1773',
    sentence: 'A Super Admin reveals a full account number.',
    routes: ['POST /api/admin/bank-accounts/:uid/reveal'] }),
]);

const BY_ACT = new Map<string, FundAct>(FUND_ACTS.map((row) => [row.act, row]));

export function fundAct(key: FundActKey): FundAct {
  const row = BY_ACT.get(key);
  // A key the table does not name is a programming error, never a pass.
  if (!row) throw new Error(`Unknown fund act: ${key}`);
  return row;
}

function refusal(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const SUPER_ADMIN_REQUIRED_CODE = 'super_admin_required';
export const SUPPORT_SESSION_REFUSED_CODE = 'support_session_refused';

const superAdminRequired = () =>
  refusal(403, { detail: 'Super admin required', code: SUPER_ADMIN_REQUIRED_CODE });

/** True when the request rides a support session (`impersonated_by` on the JWT). */
export async function isSupportSession(c: Context<{ Bindings: Env }>): Promise<boolean> {
  return !!(await selectJwt(c))?.payload?.impersonated_by;
}

/**
 * Run an auth helper that throws sentences, and rethrow what it throws as the
 * body `app.onError` would have sent, so a router that maps sentences to its
 * own refusal cannot swallow the step-up or the freeze.
 */
async function asResponse<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Response) throw e;
    const msg = String((e as Error)?.message ?? '');
    if (msg === ADMIN_FROZEN) throw refusal(423, adminFrozenBody(e));
    if (msg === STEP_UP_REQUIRED) throw refusal(403, stepUpRefusalBody(e));
    if (msg === 'Super admin required') throw superAdminRequired();
    const status = AUTH_ERROR_STATUSES[msg];
    if (status) throw refusal(status, { detail: msg });
    throw e;
  }
}

async function gate(
  c: Context<{ Bindings: Env }>, user: any, row: FundAct,
): Promise<void> {
  if (await isSupportSession(c)) {
    throw refusal(403, {
      detail: 'A support session cannot move fund money or write a fund’s books.',
      code: SUPPORT_SESSION_REFUSED_CODE,
    });
  }
  if (row.tier === 'super_admin') {
    const coolOff = recoveryCoolOffBody(user);
    if (coolOff) throw refusal(423, coolOff);
  }
  // Only the Super Admin points the Fund I bank account at a fund. Checked
  // before the branch passthrough: on a branch `hydrateSuperAdmin` sets the
  // flag to 0 whatever `super_admins` holds (D106), so every caller is refused.
  if (row.act === 'fund.slug_fund_i' && !isSuperAdmin(user)) throw superAdminRequired();
  if (branchOf(c.env)) return;
  const isAdmin = String(user?.role ?? '') === 'admin';
  if (!isAdmin) {
    // Only the Super Admin hands a fund's GP gates to another account.
    if (row.act === 'fund.gp_of_record') throw superAdminRequired();
    return;
  }
  if (row.tier === 'admin') {
    await asResponse(() => requireAdmin(c));
    return;
  }
  if (!isSuperAdmin(user)) throw superAdminRequired();
  await asResponse(() => requireSuperAdminWriteBar(c));
}

/** The gate for a `routes/funds.ts` handler, on the context `requireFundGp` returned. */
export async function assertFundAct(
  c: Context<{ Bindings: Env }>, gp: FundGpContext, key: FundActKey,
): Promise<void> {
  await gate(c, gp.user, fundAct(key));
}

/**
 * The gate for a route with no `requireFundGp`: the same rules for an admin
 * caller; any other caller passes to the route's own gate (after the
 * support-session refusal and the cool-off).
 */
export async function assertAdminAct(
  c: Context<{ Bindings: Env }>, user: any, key: FundActKey,
): Promise<void> {
  await gate(c, user, fundAct(key));
}

/**
 * Decision 4 — one `admin_audit_log` row per act an admin performs, after the
 * act. The action is `fund_admin.<act key>`, so it does not double the
 * domain rows (`capital_call_issued`, …), which stay. Details carry the act,
 * the fund and amounts in cents, and never bank text (no receipt reference,
 * memo or counterparty). `logAdminAction` never throws, so it cannot undo an
 * act.
 */
export async function auditFundAct(
  env: Env, user: any, key: FundActKey, details: Record<string, unknown>,
): Promise<void> {
  if (String(user?.role ?? '') !== 'admin') return;
  try {
    await logAdminAction(env, Number(user.id), String(user.email ?? ''), `fund_admin.${key}`, { act: key, ...details });
  } catch (e) {
    console.warn('[fundAdminAccess] audit failed', key, (e as Error).message);
  }
}

/**
 * Decision 6 — what `GET /api/fund-admin/access` answers: an admin on HQ, in
 * their own session. The console draws its controls from this; the Worker
 * still decides each act.
 */
export async function fundAdminAccess(c: Context<{ Bindings: Env }>): Promise<{
  super_admin: boolean;
  acts: Array<{ act: FundActKey; label: string; tier: FundActTier; owner: string; sentence: string | null; allowed: boolean }>;
}> {
  await requireAuth(c);
  if (await isSupportSession(c)) {
    throw refusal(403, { detail: 'A support session cannot read fund administration.', code: SUPPORT_SESSION_REFUSED_CODE });
  }
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  const superAdmin = isSuperAdmin(user as any);
  return {
    super_admin: superAdmin,
    acts: FUND_ACTS.map((row) => ({
      act: row.act, label: row.label, tier: row.tier, owner: row.owner, sentence: row.sentence,
      allowed: row.tier === 'admin' || superAdmin,
    })),
  };
}
