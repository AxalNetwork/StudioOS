/**
 * D717 (#1782) decision 11 — the entity and money map: one model, two
 * drawings (the admin screen's React SVG and the paper's SVG string,
 * services/fundStructurePaper.ts).
 *
 * The model is built from #1772's `ENTITY_ROLES` and `MONEY_KINDS` and from
 * #1773's `PAYMENT_PURPOSES`, imported and never copied: the four entities and
 * their roles, the two platform licences, and every money flow with its
 * label, payer, payee, rail and receiving account.
 *
 * The receiving account depends on who reads the map:
 *   · super_admin, issued — #1773's `payInstructionsFor`, masked (bank,
 *     beneficiary, ending), or the resolver's sentence. Never
 *     `revealPayInstructions`, never a routing number.
 *   · admin — #1773 decision 5's sentence; the registry is not read.
 *   · preview — the bracket label; the registry is not read.
 * Stripe flows name Management's Stripe account, and a Mercury flow no purpose
 * receives (a distribution to an LP, a fund expense to a vendor) says who is
 * paid. Neither calls the resolver. Nothing here moves money.
 */
import type { Env } from '../types';
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';
import { ENTITY_ROLES, MONEY_KINDS, type MoneyKind, type MoneyParty, type MoneyRail, type MoneyGroup } from './moneyRails';
import { PAYMENT_PURPOSES, payInstructionsFor, purposeForMoneyKind, type PaymentPurpose } from './payInstructions';
import { STRUCTURE_MAP_SLUGS } from './templateFormat';

export type StructureAudience = 'super_admin' | 'admin' | 'preview' | 'issued';
export const STRUCTURE_AUDIENCES: readonly StructureAudience[] = ['super_admin', 'admin', 'preview', 'issued'];

/** The four entities, in the order the map draws them. */
export const STRUCTURE_ENTITY_ORDER: readonly AxalEntityKey[] = ['holdings', 'management', 'gp', 'fund'];

export const ADMIN_WITHHELD = 'Only the Super Admin can see or change payment instructions.';
export const RECEIVING_BRACKET = '[Receiving account, filled when issued]';
export const NOT_OPENED_YET = 'Not opened yet';
export const OUTSIDE_THE_MAP = 'Payouts and partner-deal settlements between Axal VC Management LLC and a member are not on this map.';

const PARTY_LABELS: Readonly<Record<Exclude<MoneyParty, AxalEntityKey>, string>> = Object.freeze({
  customer: 'Customers', lp: 'Limited partners', vendor: 'Vendors',
});
const PAID_TO: Readonly<Partial<Record<MoneyParty, string>>> = Object.freeze({ lp: 'Paid to the LP', vendor: 'Paid to the vendor' });

export const partyLabel = (p: MoneyParty): string =>
  (AXAL_ENTITIES as Record<string, { name: string } | undefined>)[p]?.name ?? PARTY_LABELS[p as keyof typeof PARTY_LABELS] ?? p;

export type ReceivingAccount =
  | { shown: 'account'; bank_name: string; beneficiary_name: string; account_masked: string; account_last4: string }
  | { shown: 'refusal'; code: string; message: string; label: string }
  | { shown: 'withheld'; text: string }
  | { shown: 'bracket'; text: string }
  | { shown: 'stripe'; text: string }
  | { shown: 'paid_out'; text: string };

export type StructureFlow = {
  kind: MoneyKind; label: string; group: MoneyGroup; rail: MoneyRail;
  payer: MoneyParty; payer_label: string; payee: MoneyParty; payee_label: string;
  purpose: PaymentPurpose | null; receiving: ReceivingAccount;
};

export type StructureModel = {
  audience: StructureAudience;
  entities: { key: AxalEntityKey; name: string; role: string }[];
  /** Holdings licenses the platform to Management and to the GP (decision 1 of D707). */
  licences: { licensor: 'holdings'; licensee: AxalEntityKey; scope: string; fee_kind: MoneyKind }[];
  flows: StructureFlow[];
  note: string;
};

type Resolver = (payee: AxalEntityKey, purpose: PaymentPurpose) => ReturnType<typeof payInstructionsFor>;

/** Only the masked fields reach the model: bank, beneficiary and the ending. */
function accountOf(r: Awaited<ReturnType<typeof payInstructionsFor>>): ReceivingAccount {
  if (r.ok) {
    return { shown: 'account', bank_name: r.instructions.bank_name, beneficiary_name: r.instructions.beneficiary_name,
      account_masked: r.instructions.account_masked, account_last4: r.instructions.account_last4 };
  }
  return { shown: 'refusal', code: r.code, message: r.message, label: r.code === 'fund_account_missing' ? NOT_OPENED_YET : r.message };
}

/**
 * The map for one audience. `resolver` is #1773's `payInstructionsFor` unless
 * a test passes a spy; it is called at most once per payee and purpose.
 */
export async function fundStructureModel(env: Env, o: { audience: StructureAudience; resolver?: Resolver }): Promise<StructureModel> {
  if (!STRUCTURE_AUDIENCES.includes(o.audience)) throw new TypeError('A structure audience is super_admin, admin, preview or issued.');
  const resolver: Resolver = o.resolver ?? ((payee, purpose) => payInstructionsFor(env, payee, purpose));
  const reads = new Map<string, Promise<ReceivingAccount>>();
  const readsAccount = o.audience === 'super_admin' || o.audience === 'issued';

  const receivingFor = (row: (typeof MONEY_KINDS)[number], purpose: PaymentPurpose | null): Promise<ReceivingAccount> | ReceivingAccount => {
    if (row.rail === 'stripe') return { shown: 'stripe', text: `Stripe, ${AXAL_ENTITIES.management.name}'s account` };
    if (!purpose) return { shown: 'paid_out', text: PAID_TO[row.payee] ?? `Paid to ${partyLabel(row.payee)}` };
    if (o.audience === 'admin') return { shown: 'withheld', text: ADMIN_WITHHELD };
    if (!readsAccount) return { shown: 'bracket', text: RECEIVING_BRACKET };
    const payee = PAYMENT_PURPOSES[purpose].payee;
    const key = `${payee}:${purpose}`;
    if (!reads.has(key)) {
      reads.set(key, resolver(payee, purpose).then(accountOf, () => ({
        shown: 'refusal' as const, code: 'account_unreadable', message: 'The receiving account could not be read.', label: 'Could not be read',
      })));
    }
    return reads.get(key)!;
  };

  const flows = await Promise.all(MONEY_KINDS.map(async (row): Promise<StructureFlow> => {
    const purpose = row.rail === 'mercury' ? purposeForMoneyKind(row.kind) : null;
    return {
      kind: row.kind, label: row.label, group: row.group, rail: row.rail,
      payer: row.payer, payer_label: partyLabel(row.payer), payee: row.payee, payee_label: partyLabel(row.payee),
      purpose, receiving: await receivingFor(row, purpose),
    };
  }));

  const licences = MONEY_KINDS.filter((row) => row.group === 'intercompany' && row.payee === 'holdings')
    .map((row) => ({
      licensor: 'holdings' as const, licensee: row.payer as AxalEntityKey,
      // "Platform licence fee, management administration" → "management administration"
      scope: row.label.split(', ').slice(1).join(', ') || row.label, fee_kind: row.kind,
    }));

  return {
    audience: o.audience,
    entities: STRUCTURE_ENTITY_ORDER.map((key) => ({ key, name: AXAL_ENTITIES[key].name, role: ENTITY_ROLES[key] })),
    licences, flows, note: OUTSIDE_THE_MAP,
  };
}

/**
 * The map a paper prints, or null for a slug that carries none
 * (`STRUCTURE_MAP_SLUGS`). A paper is a preview or an issued copy; a failed
 * read is logged by code and prints no page, so a send or a signature never
 * fails over the map.
 */
export async function structureForPaper(env: Env, slug: string | null | undefined, audience: 'preview' | 'issued'): Promise<StructureModel | null> {
  if (!slug || !STRUCTURE_MAP_SLUGS.has(slug)) return null;
  try {
    return await fundStructureModel(env, { audience });
  } catch {
    console.warn(JSON.stringify({ event: 'fund_structure_unbuilt', code: 'structure_unreadable' }));
    return null;
  }
}
