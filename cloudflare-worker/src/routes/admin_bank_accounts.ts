/**
 * D708 (#1773) — `/api/admin/bank-accounts`: each Axal entity's bank
 * accounts, for the Super Admin only, on HQ only.
 *
 *   GET  /              every account, masked; `coverage`, the resolver's
 *                       answer per payment purpose; `fund_i`, the fund that
 *                       carries the `spinout-fund-i` slug, or null
 *   POST /              add one account                       (201, masked)
 *   PATCH /:uid         the label and the purposes, nothing else
 *   POST /:uid/retire   retire it, with a reason
 *   POST /:uid/reveal   one full number, recorded first, `Cache-Control: no-store`
 *
 * WHO. A read needs `requireSuperAdmin`, which refuses on a branch. Each write
 * and the reveal first refuse an admin without the elevation with 403
 * `super_admin_required`, before any TOTP or step-up demand, so a plain Admin
 * is never asked for a code it cannot use; then `requireSuperAdminWriteBar`
 * (TOTP, a fresh step-up, the elevation). This is inline until #1779's
 * `assertAdminAct` and its row for these acts are on `main`.
 *
 * Each write is audited with the uid, the entity and the last four, never the
 * number. Mounted before the `/api/admin` catch-all, under the recovery
 * cool-off and the fail-closed `bank_accounts` rate-limit bucket.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAdmin, requireSuperAdmin, requireSuperAdminWriteBar, isSuperAdmin } from '../auth';
import { branchOf, HQ_ONLY } from '../util/branch';
import { logAdminAction } from '../services/adminAudit';
import { Funds } from '../models/funds';
import {
  BankAccountError, createAccount, listAccounts, updateAccount, retireAccount, revealAccount,
} from '../services/entityBankAccounts';
import { PAYMENT_PURPOSES, FUND_I_SLUG, payInstructionsFor, type PaymentPurpose } from '../services/payInstructions';

const r = new Hono<{ Bindings: Env }>();

/** Decision 5: the elevation is checked first, so a plain Admin gets this and never a TOTP or step-up demand. */
async function superAdminWriter(c: Context<{ Bindings: Env }>): Promise<User | Response> {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  if (!isSuperAdmin(user as any)) return c.json({ code: 'super_admin_required', detail: 'Super admin required' }, 403);
  return requireSuperAdminWriteBar(c);
}

/** A refusal from the service: its code and our sentence, never what was typed. */
function refused(c: Context<{ Bindings: Env }>, e: unknown) {
  if (e instanceof BankAccountError) {
    return c.json({ code: e.code, error: e.code, detail: e.sentence, message: e.sentence }, e.status as any);
  }
  throw e;
}

const body = async (c: Context<{ Bindings: Env }>): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
};

const audit = (c: Context<{ Bindings: Env }>, actor: User, action: string, account: { uid: string; entity_key: string; account_last4: string }, extra: Record<string, unknown> = {}) =>
  logAdminAction(c.env, Number(actor.id), String(actor.email || ''), action, {
    account_uid: account.uid, entity_key: account.entity_key, account_last4: account.account_last4, ...extra,
  });

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  const [accounts, fundI] = await Promise.all([listAccounts(c.env), Funds.bySlug(c.env, FUND_I_SLUG)]);
  const coverage = [];
  for (const [purpose, def] of Object.entries(PAYMENT_PURPOSES)) {
    const pay = await payInstructionsFor(c.env, def.payee, purpose as PaymentPurpose);
    coverage.push(pay.ok
      ? { purpose, label: def.label, payee: def.payee, ok: true, account_uid: pay.instructions.uid, account_masked: pay.instructions.account_masked }
      : { purpose, label: def.label, payee: def.payee, ok: false, code: pay.code, message: pay.message });
  }
  return c.json({ accounts, coverage, fund_i: fundI ? { id: Number(fundI.id), name: fundI.name } : null });
});

r.post('/', async (c) => {
  const actor = await superAdminWriter(c);
  if (actor instanceof Response) return actor;
  try {
    const account = await createAccount(c.env, await body(c), Number(actor.id));
    await audit(c, actor, 'bank_account_added', account, { account_kind: account.account_kind, purposes: account.purposes });
    return c.json({ account }, 201);
  } catch (e) { return refused(c, e); }
});

r.patch('/:uid', async (c) => {
  const actor = await superAdminWriter(c);
  if (actor instanceof Response) return actor;
  try {
    const b = await body(c);
    const account = await updateAccount(c.env, c.req.param('uid'), b);
    await audit(c, actor, 'bank_account_updated', account, { fields: Object.keys(b), purposes: account.purposes });
    return c.json({ account });
  } catch (e) { return refused(c, e); }
});

r.post('/:uid/retire', async (c) => {
  const actor = await superAdminWriter(c);
  if (actor instanceof Response) return actor;
  try {
    const account = await retireAccount(c.env, c.req.param('uid'), (await body(c)).reason);
    await audit(c, actor, 'bank_account_retired', account);
    return c.json({ account });
  } catch (e) { return refused(c, e); }
});

r.post('/:uid/reveal', async (c) => {
  const actor = await superAdminWriter(c);
  if (actor instanceof Response) return actor;
  try {
    const account = await revealAccount(c.env, c.req.param('uid'), Number(actor.id), (await body(c)).reason);
    // The ledger row is the gate (decision 6); this audit line carries the last four only.
    await audit(c, actor, 'bank_account_revealed', account);
    c.header('Cache-Control', 'no-store');
    return c.json({ account });
  } catch (e) {
    c.header('Cache-Control', 'no-store');
    return refused(c, e);
  }
});

export default r;
