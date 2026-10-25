/**
 * D708 (#1773) — `/api/admin/bank-accounts`: each Axal entity's bank
 * accounts, for the Super Admin only, on HQ only.
 *
 *   GET  /              every account, masked; `coverage`, the resolver's
 *                       answer per payment purpose; `fund_i`, the fund that
 *                       carries the `spinout-fund-i` slug, or null; and
 *                       `refusals` (#1856), the resolver's own sentence for
 *                       each refusal the console explains, read from nothing
 *   POST /              add one account                       (201, masked; D1184's Mercury last-four check)
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
 * D1184 (#3113): each account on the GET also carries `mercury`, its Mercury
 * account joined by entity and last four (`services/mercury/registryJoin.ts`),
 * after the `mercury_accounts_read` audit row; and `notice_preview`, what a
 * notice prints for each purpose it takes: the resolver's masked
 * instructions and its warning, or the resolver's refusal. An add that names
 * a Mercury account (`mercury_account_uid`) is refused when that account is
 * another entity's or ends in other digits.
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
import { PAYMENT_PURPOSES, FUND_I_SLUG, NOTICE_REFUSALS, payInstructionsFor, refusalMessage, type PaymentPurpose } from '../services/payInstructions';
import { AUDIT_UNAVAILABLE, auditRead } from '../services/mercury/access';
import { mercuryAccountByUid, mercuryForRegistry, type MercuryJoin } from '../services/mercury/registryJoin';

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
  const user = await requireSuperAdmin(c);
  const [accounts, fundI] = await Promise.all([listAccounts(c.env), Funds.bySlug(c.env, FUND_I_SLUG)]);
  const coverage = [];
  const byPurpose = new Map<string, Awaited<ReturnType<typeof payInstructionsFor>>>();
  for (const [purpose, def] of Object.entries(PAYMENT_PURPOSES)) {
    const pay = await payInstructionsFor(c.env, def.payee, purpose as PaymentPurpose);
    byPurpose.set(purpose, pay);
    coverage.push(pay.ok
      ? { purpose, label: def.label, payee: def.payee, ok: true, account_uid: pay.instructions.uid, account_masked: pay.instructions.account_masked }
      : { purpose, label: def.label, payee: def.payee, ok: false, code: pay.code, message: pay.message });
  }
  const refusals = NOTICE_REFUSALS.map(({ code, payee, purpose }) => ({ code, message: refusalMessage(code, payee, purpose) }));
  // D1184: the Mercury join is a Mercury read, so its audit row comes first; without it the block alone reads unreadable.
  const audited = await auditRead(c.env, user, 'mercury_accounts_read', { surface: 'bank_accounts', accounts: accounts.length });
  const joins = audited ? await mercuryForRegistry(c.env, accounts) : null;
  const mercuryOf = (uid: string): MercuryJoin => joins?.get(uid) ?? { state: 'unreadable', reason: AUDIT_UNAVAILABLE.detail };
  return c.json({
    accounts: accounts.map((a) => ({ ...a, mercury: mercuryOf(a.uid), notice_preview: noticePreview(a, byPurpose) })),
    coverage, fund_i: fundI ? { id: Number(fundI.id), name: fundI.name } : null, refusals,
  });
});

/**
 * What a notice prints for this account, purpose by purpose (BNK2): the
 * resolver's own masked instructions and warning when it gives this account,
 * or why it does not. Never a full number: the resolver gives none.
 */
function noticePreview(a: { uid: string; status: string; purposes: PaymentPurpose[] }, byPurpose: Map<string, Awaited<ReturnType<typeof payInstructionsFor>>>) {
  if (a.status !== 'active') return { printed: false, reason: 'A retired account is never printed on a notice.', purposes: [] };
  if (!a.purposes.length) return { printed: false, reason: 'This account takes no purpose, so no notice prints it.', purposes: [] };
  const purposes = a.purposes.map((purpose) => {
    const label = PAYMENT_PURPOSES[purpose].label;
    // Every purpose was resolved above, and the resolver gives only the one account carrying it.
    const pay = byPurpose.get(purpose)!;
    return pay.ok
      ? { purpose, label, ok: true, instructions: pay.instructions, warning: pay.warning }
      : { purpose, label, ok: false, code: pay.code, message: pay.message };
  });
  return { printed: purposes.some((p) => p.ok), purposes };
}

/**
 * D1184: an add that names a Mercury account must be that account: the same
 * entity and the same last four. Reading it is a Mercury read, audited first.
 */
async function mercuryAddRefusal(c: Context<{ Bindings: Env }>, actor: User, b: Record<string, unknown>): Promise<Response | null> {
  if (b.mercury_account_uid == null || b.mercury_account_uid === '') return null;
  const uid = typeof b.mercury_account_uid === 'string' ? b.mercury_account_uid : '';
  const no = (status: 400 | 404 | 409, code: string, sentence: string) => c.json({ code, error: code, detail: sentence, message: sentence }, status);
  if (!/^[0-9a-f]{32}$/.test(uid)) return no(400, 'mercury_account_invalid', 'Choose the Mercury account from the list.');
  if (!await auditRead(c.env, actor, 'mercury_accounts_read', { surface: 'bank_accounts_add' })) return c.json(AUDIT_UNAVAILABLE, 503);
  const m = await mercuryAccountByUid(c.env, uid);
  if (!m) return no(404, 'mercury_account_unknown', 'That Mercury account is not on record. Sync Mercury, then choose it again.');
  if (m.entity_key !== b.entity_key) return no(409, 'mercury_entity_mismatch', 'That Mercury account belongs to another entity, so it cannot be added here.');
  const digits = String(b.account_number ?? '').replace(/\D/g, '');
  if (digits.length >= 4 && digits.slice(-4) !== m.last_four) {
    return no(409, 'mercury_last4_mismatch', `The account number does not end in ${m.last_four}, the last four of the Mercury account chosen. Check the number and type it again.`);
  }
  return null;
}

r.post('/', async (c) => {
  const actor = await superAdminWriter(c);
  if (actor instanceof Response) return actor;
  try {
    const b = await body(c);
    const mercury = await mercuryAddRefusal(c, actor, b);
    if (mercury) return mercury;
    const account = await createAccount(c.env, b, Number(actor.id));
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
