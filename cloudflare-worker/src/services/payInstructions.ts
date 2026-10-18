/**
 * D708 (#1773) — one resolver gives every notice and invoice the payee's own
 * payment instructions, or refuses with a code and a sentence the screen
 * prints.
 *
 * - `payInstructionsFor` returns the masked instructions and the warning,
 *   never the number. Any notice, preview or list reads this.
 * - `revealPayInstructions` writes a reveal row, then decrypts. Only the two
 *   reveal routes call it: the Super Admin's console and an LP's own open
 *   capital-call line.
 *
 * The resolver re-checks what the console's writes already block, because a
 * row can be changed by hand.
 *
 * Fund I is the `vc_funds` row with slug `spinout-fund-i`. Other funds are
 * not Axal entities: `fundPayeeOf` answers null for them and nothing here
 * reads the registry for their calls.
 */
import type { Env } from '../types';
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';
import { Funds } from '../models/funds';
// Imported inside function bodies only, so the two modules may import each other.
import {
  activeRowsCarrying, accountNumberOf, masked, recordReveal,
  type BankAccountRow, type MaskedAccount, type RevealContext,
} from './entityBankAccounts';

/** The slug that names Fund I (`models/funds.ts`, `routes/spinout_lab.ts`). Moving it is the Super Admin's (decision 13). */
export const FUND_I_SLUG = 'spinout-fund-i';

/**
 * Decision 4. Each purpose has one fixed payee and names the money kinds
 * (#1772's Mercury rail) it receives, as strings.
 */
export const PAYMENT_PURPOSES = Object.freeze({
  capital_contribution: Object.freeze({ payee: 'fund' as AxalEntityKey, label: 'Capital contributions', money_kinds: Object.freeze(['capital_contribution']) }),
  gp_commitment: Object.freeze({ payee: 'fund' as AxalEntityKey, label: 'GP commitment', money_kinds: Object.freeze(['gp_commitment']) }),
  management_fee: Object.freeze({ payee: 'gp' as AxalEntityKey, label: 'Management fee', money_kinds: Object.freeze(['management_fee']) }),
  platform_licence_fee: Object.freeze({
    payee: 'holdings' as AxalEntityKey, label: 'Platform licence fee',
    money_kinds: Object.freeze(['licence_fee_management_admin', 'licence_fee_fund_admin']),
  }),
});
export type PaymentPurpose = keyof typeof PAYMENT_PURPOSES;

/** A purpose's label inside a sentence: "management fee", but "GP commitment", whose acronym keeps its capitals. */
export const purposeInSentence = (label: string): string =>
  /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);

export const isPaymentPurpose = (v: unknown): v is PaymentPurpose =>
  typeof v === 'string' && Object.hasOwn(PAYMENT_PURPOSES, v);

/** The purpose a #1772 money kind is paid under, or null for any kind no purpose receives. */
export function purposeForMoneyKind(kind: unknown): PaymentPurpose | null {
  for (const [purpose, def] of Object.entries(PAYMENT_PURPOSES)) {
    if ((def.money_kinds as readonly string[]).includes(String(kind))) return purpose as PaymentPurpose;
  }
  return null;
}

/** Decision 10: printed with every set of payment instructions, masked or full. */
export const PAY_WARNING = 'Before you send money, call us to confirm these details on a phone number you already hold for Axal, '
  + 'never one given in an email or on this page. Axal never changes its payment instructions by email.';

export type PayRefusalCode =
  | 'payee_not_entitled' | 'fund_account_missing' | 'no_active_account' | 'holder_not_payee'
  | 'savings_account' | 'ambiguous_account' | 'account_unreadable';
export type PayRefusal = { ok: false; code: PayRefusalCode | 'reveal_unrecorded'; message: string };
export type PayInstructions = { ok: true; purpose: PaymentPurpose; payee: AxalEntityKey; instructions: MaskedAccount; warning: string };
export type RevealedInstructions = {
  ok: true; purpose: PaymentPurpose; payee: AxalEntityKey; instructions: MaskedAccount & { account_number: string }; warning: string;
};

const nameOf = (key: AxalEntityKey) => AXAL_ENTITIES[key]?.name ?? key;
const no = (code: PayRefusal['code'], message: string): PayRefusal => ({ ok: false, code, message });

type SentenceCode = 'payee_not_entitled' | 'fund_account_missing' | 'no_active_account' | 'ambiguous_account' | 'holder_not_payee' | 'savings_account';

/**
 * #1856: the one source of the resolver's refusal sentences, so the Bank
 * accounts console prints what a notice reads without copying it. Each names
 * the payee and the purpose; `payee_not_entitled` also names who is paid.
 */
export function refusalMessage(code: SentenceCode, payee: AxalEntityKey, purpose: PaymentPurpose): string {
  const def = PAYMENT_PURPOSES[purpose];
  const what = purposeInSentence(def.label);
  switch (code) {
    case 'payee_not_entitled': return `${nameOf(payee)} is not paid ${what}. It is paid to ${nameOf(def.payee)}.`;
    case 'fund_account_missing': return `${nameOf('fund')} has no bank account for ${what} yet, so no payment instructions can be given. Do not send money until Axal adds the Fund's account.`;
    case 'no_active_account': return `${nameOf(payee)} has no active account for ${what}, so no payment instructions can be given.`;
    case 'ambiguous_account': return `More than one active account takes ${what}, so none is given. Keep the purpose on one account.`;
    case 'holder_not_payee': return `The account that takes ${what} is not held by ${nameOf(payee)}, so it is not given.`;
    case 'savings_account': return `The account that takes ${what} is a savings account, so it is not given. Give the purpose to a checking account.`;
  }
}

/** #1856: the refusals the console shows under "What a notice refuses", in the canvas's order, with the example each is drawn from. */
export const NOTICE_REFUSALS: readonly Readonly<{ code: SentenceCode; payee: AxalEntityKey; purpose: PaymentPurpose }>[] = Object.freeze([
  { code: 'no_active_account' as const, payee: 'gp' as AxalEntityKey, purpose: 'management_fee' as PaymentPurpose },
  { code: 'holder_not_payee' as const, payee: 'gp' as AxalEntityKey, purpose: 'management_fee' as PaymentPurpose },
  { code: 'savings_account' as const, payee: 'gp' as AxalEntityKey, purpose: 'management_fee' as PaymentPurpose },
  { code: 'fund_account_missing' as const, payee: 'fund' as AxalEntityKey, purpose: 'capital_contribution' as PaymentPurpose },
].map((r) => Object.freeze(r)));

/** The one row a payee is paid into for a purpose, or why there is none. */
async function resolve(env: Env, payee: AxalEntityKey, purpose: PaymentPurpose): Promise<{ row: BankAccountRow } | PayRefusal> {
  const def = isPaymentPurpose(purpose) ? PAYMENT_PURPOSES[purpose] : null;
  if (!def || def.payee !== payee) {
    return no('payee_not_entitled', def ? refusalMessage('payee_not_entitled', payee, purpose) : `${nameOf(payee)} is not paid for this.`);
  }
  const rows = await activeRowsCarrying(env, purpose);
  if (!rows.length) {
    return payee === 'fund'
      ? no('fund_account_missing', refusalMessage('fund_account_missing', payee, purpose))
      : no('no_active_account', refusalMessage('no_active_account', payee, purpose));
  }
  if (rows.length > 1) {
    return no('ambiguous_account', refusalMessage('ambiguous_account', payee, purpose));
  }
  const row = rows[0];
  // No commingling: the account must be held by the payee, in its own legal name.
  if (row.entity_key !== payee || row.beneficiary_name !== nameOf(payee)) {
    return no('holder_not_payee', refusalMessage('holder_not_payee', payee, purpose));
  }
  if (row.account_kind !== 'checking') {
    return no('savings_account', refusalMessage('savings_account', payee, purpose));
  }
  return { row };
}

const UNREADABLE = 'This account cannot be read, perhaps after a key change. Retire it and add it again in the Bank accounts console.';

/**
 * The payee's masked instructions for a purpose, and the warning, or a
 * refusal. The ciphertext is decrypted only to check that the account can
 * still be read, and the number is dropped: no instructions are given for an
 * account no one could reveal.
 */
export async function payInstructionsFor(env: Env, payee: AxalEntityKey, purpose: PaymentPurpose): Promise<PayInstructions | PayRefusal> {
  const found = await resolve(env, payee, purpose);
  if (!('row' in found)) return found;
  if (!await accountNumberOf(env, found.row)) return no('account_unreadable', UNREADABLE);
  return { ok: true, purpose, payee, instructions: masked(found.row), warning: PAY_WARNING };
}

export type RevealRequest = { actorUserId: number; context: RevealContext; contextRef: string | null };

/**
 * The full instructions for one payee and purpose. The reveal row is written
 * first; when it cannot be written, no number is given. Only
 * `routes/admin_bank_accounts.ts` and `routes/funds.ts` call this.
 */
export async function revealPayInstructions(
  env: Env, payee: AxalEntityKey, purpose: PaymentPurpose, reveal: RevealRequest,
): Promise<RevealedInstructions | PayRefusal> {
  const found = await resolve(env, payee, purpose);
  if (!('row' in found)) return found;
  try {
    await recordReveal(env, found.row.id, reveal.actorUserId, reveal.context, reveal.contextRef);
  } catch {
    return no('reveal_unrecorded', 'The reveal could not be recorded, so the payment instructions are not shown.');
  }
  const number = await accountNumberOf(env, found.row);
  if (!number) return no('account_unreadable', UNREADABLE);
  return { ok: true, purpose, payee, instructions: { ...masked(found.row), account_number: number }, warning: PAY_WARNING };
}

/** `'fund'` when the fund is Fund I (the row `Funds.bySlug` returns for `spinout-fund-i`), else null. Reads only `vc_funds`. */
export async function fundPayeeOf(env: Env, fundId: number): Promise<'fund' | null> {
  if (!Number.isInteger(fundId) || fundId <= 0) return null;
  const fundI = await Funds.bySlug(env, FUND_I_SLUG);
  return fundI && Number(fundI.id) === fundId ? 'fund' : null;
}

/**
 * Decision 9: a call on Fund I cannot issue while the Fund cannot be paid.
 * Returns the refusal for the first Fund I among `fundIds`, or null when every
 * fund can take the call. A fund that is not Fund I never reads the registry.
 */
export async function assertFundCallPayable(env: Env, fundIds: Iterable<number>): Promise<PayRefusal | null> {
  for (const id of new Set([...fundIds].map(Number))) {
    if (await fundPayeeOf(env, id) !== 'fund') continue;
    const pay = await payInstructionsFor(env, 'fund', 'capital_contribution');
    if (!pay.ok) return pay;
  }
  return null;
}

/**
 * Decision 11: the reference a payer quotes on one capital-call line,
 * `AXAL-CC-<fund id>-L<limited_partners.id>-<line id>`. Computed, never stored.
 */
export function capitalCallReference(fundId: number, lpId: number, lineId: number): string {
  for (const n of [fundId, lpId, lineId]) {
    if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError('A capital-call reference needs positive ids.');
  }
  return `AXAL-CC-${fundId}-L${lpId}-${lineId}`;
}
