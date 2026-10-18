/**
 * D717 (#1782) decision 11 — the entity and money map: one model, two
 * drawings (the admin screen's React SVG, `pages/admin/contracts/
 * FundStructureMap.jsx`, and the paper's SVG string,
 * services/fundStructurePaper.ts).
 *
 * The model is built from #1772's `ENTITY_ROLES`, `ENTITY_SIGNS` and
 * `MONEY_KINDS` and from #1773's `PAYMENT_PURPOSES`, imported and never copied:
 * the four entities with their role, what they sign and who signs for them;
 * the two platform licences, A and B; every money flow with its label, payer,
 * payee, rail and receiving account; and (#1855) the canvas's numbering:
 *   · `rows` — the eight numbered flows, in the "Legal Documents · Templates"
 *     canvas's order and words (`FLOW_ROWS`). Every money kind sits in exactly
 *     one row, and each flow carries its row's `no`.
 *   · `map` — the drawing, computed once here from `STRUCTURE_LAYOUT` (L10's
 *     geometry) as path data and text positions. Paper and screen print it as
 *     given and hold no coordinate of their own, so the two cannot drift.
 *   · `signing` and `rails` — the address, the notice email, the routing
 *     sentence, and the two rail boxes.
 *
 * The receiving account depends on who reads the map:
 *   · super_admin, issued — #1773's `payInstructionsFor`, masked (bank,
 *     beneficiary, ending), or the resolver's sentence. Never
 *     `revealPayInstructions`, never a routing number.
 *   · admin — #1773 decision 5's sentence; the registry is not read.
 *   · preview — the bracket label; the registry is not read.
 * Stripe flows name Management's Stripe account, and a Mercury flow no purpose
 * receives (a distribution to an LP, a fund expense to a vendor) says who is
 * paid. Neither calls the resolver.
 *
 * Only the super_admin model carries `accounts`: each entity's active accounts
 * from the registry's masked list (`listAccounts`), cut to label, kind, masked
 * number and last four. It never reveals or decrypts, and no other audience's
 * model has the key. Nothing here moves money.
 */
import type { Env } from '../types';
import { AXAL_ENTITIES, AXAL_LEGAL_ADDRESS, AXAL_LEGAL_EMAIL, AXAL_SIGNATORY_NAME, type AxalEntityKey } from './legalDocFormat';
import {
  ENTITY_ROLES, ENTITY_SIGNS, ENTITY_SIGNS_ROUTING, MONEY_KINDS,
  type MoneyKind, type MoneyParty, type MoneyRail, type MoneyGroup,
} from './moneyRails';
import { PAYMENT_PURPOSES, payInstructionsFor, purposeForMoneyKind, type PaymentPurpose } from './payInstructions';
import { listAccounts } from './entityBankAccounts';
import { receivingLine } from './fundStructurePaper';
import { STRUCTURE_MAP_SLUGS } from './templateFormat';

export type StructureAudience = 'super_admin' | 'admin' | 'preview' | 'issued';
export const STRUCTURE_AUDIENCES: readonly StructureAudience[] = ['super_admin', 'admin', 'preview', 'issued'];

/** The four entities, in the order the map draws them. */
export const STRUCTURE_ENTITY_ORDER: readonly AxalEntityKey[] = ['holdings', 'management', 'gp', 'fund'];

export const ADMIN_WITHHELD = 'Only the Super Admin can see or change payment instructions.';
export const RECEIVING_BRACKET = '[Receiving account, filled when issued]';
export const NOT_OPENED_YET = 'Not opened yet';
export const OUTSIDE_THE_MAP = 'Payouts and partner-deal settlements between Axal VC Management LLC and a member are not on this map.';
export const RAILS_NOTE = `Stripe carries only ${AXAL_ENTITIES.management.name}’s platform revenue. Every fund and intercompany flow moves on Mercury, by wire or ACH. Fund money never touches Stripe.`;
/** "Receives on paper" for an entity no payment purpose pays. */
export const NO_NOTICE_PURPOSE = 'No notice purpose';

/**
 * #1855 decision 1: the eight numbered rows, in the canvas's order and words
 * (product copy, not legal text). Every money kind sits in exactly one row.
 */
export const FLOW_ROWS: readonly Readonly<{ no: number; label: string; kinds: readonly MoneyKind[] }>[] = Object.freeze([
  { no: 1, kinds: ['platform_plan', 'investor_tier', 'partner_service', 'marketplace'],
    label: `Plans, subscriptions, partner services, marketplace and perks, to ${AXAL_ENTITIES.management.name}` },
  { no: 2, kinds: ['licence_fee_management_admin'], label: 'Platform licence fee, Management to Holdings' },
  { no: 3, kinds: ['licence_fee_fund_admin'], label: 'Platform licence fee, the GP to Holdings' },
  { no: 4, kinds: ['capital_contribution'], label: 'Capital contributions, limited partners to the Fund' },
  { no: 5, kinds: ['distribution'], label: 'Distributions, the Fund to limited partners' },
  { no: 6, kinds: ['management_fee'], label: 'Management fee, the Fund to the GP' },
  { no: 7, kinds: ['gp_commitment'], label: 'GP commitment, the GP to the Fund' },
  { no: 8, kinds: ['fund_expense'], label: 'Fund expenses, paid by the Fund' },
].map((r) => Object.freeze({ ...r, kinds: Object.freeze(r.kinds as MoneyKind[]) })));

/** The two rail boxes under "The accounts" (#1855 decision 5). */
export const RAIL_LINES: readonly Readonly<{ rail: MoneyRail; name: string; text: string }>[] = Object.freeze([
  { rail: 'stripe' as const, name: 'Stripe',
    text: `${AXAL_ENTITIES.management.name} only: plans and subscriptions, investor tiers, partner services, marketplace and perks. Receipts name Management as merchant.` },
  { rail: 'mercury' as const, name: 'Mercury', text: 'every fund and intercompany flow, by wire or ACH. Fund money never touches Stripe.' },
].map((r) => Object.freeze(r)));

type LayoutBox = { id: string; x: number; y: number; w: number; h: number; outside: boolean; title?: string; sub: string | null };
type LayoutRoute = { id: string; from: [number, number]; to: [number, number]; style: 'licence' | 'mercury' | 'stripe' };

/**
 * #1855 decision 2: L10's geometry (the canvas's `MAPSVG`). An entity box's
 * title is its name from `AXAL_ENTITIES`; the outside boxes' words are canvas copy.
 */
export const STRUCTURE_LAYOUT = Object.freeze({
  view_box: [504, 478] as [number, number],
  boxes: [
    { id: 'holdings', x: 162, y: 10, w: 180, h: 54, outside: false, sub: 'Owns the platform IP and brand · licensor' },
    { id: 'management', x: 10, y: 150, w: 180, h: 54, outside: false, sub: 'Managing Partner · operates the platform' },
    { id: 'gp', x: 314, y: 150, w: 180, h: 54, outside: false, sub: 'General Partner of the Fund' },
    { id: 'fund', x: 314, y: 290, w: 180, h: 54, outside: false, sub: 'The Fund' },
    { id: 'customer', x: 10, y: 290, w: 180, h: 54, outside: true, title: 'Operating partners and customers', sub: `Managed by ${AXAL_ENTITIES.management.name}` },
    { id: 'lp', x: 314, y: 410, w: 86, h: 40, outside: true, title: 'Limited partners', sub: null },
    { id: 'founders', x: 408, y: 410, w: 86, h: 40, outside: true, title: 'Funded founders', sub: null },
  ] as readonly LayoutBox[],
  routes: [
    { id: 'A', from: [180, 64], to: [70, 150], style: 'licence' },
    { id: 'B', from: [324, 64], to: [434, 150], style: 'licence' },
    { id: '1', from: [100, 290], to: [100, 204], style: 'stripe' },
    { id: '2', from: [120, 150], to: [230, 64], style: 'mercury' },
    { id: '3', from: [384, 150], to: [274, 64], style: 'mercury' },
    { id: '4', from: [357, 410], to: [357, 344], style: 'mercury' },
    { id: '5', from: [377, 344], to: [377, 410], style: 'mercury' },
    { id: '6', from: [404, 290], to: [404, 204], style: 'mercury' },
    { id: '7', from: [454, 204], to: [454, 290], style: 'mercury' },
    { id: '8', from: [314, 330], to: [270, 330], style: 'mercury' },
  ] as readonly LayoutRoute[],
  labels: [
    { x: 238, y: 333, size: 7, tone: 'ink' as const, text: 'Fund expenses' },
    { x: 168, y: 250, size: 6.5, tone: 'grey' as const, text: 'manages' },
  ],
  guides: [{ points: [[150, 204], [150, 290]] }, { points: [[494, 177], [500, 177], [500, 430], [494, 430]] }] as { points: [number, number][] }[],
  caption: {
    x: 252, y: 470, size: 6.5,
    text: 'Grey lines: who manages whom. The GP manages the limited partners and the funded founders. Dashed purple: the two platform licences.',
  },
});
const FUND_MISSING_SUB = ' · account not opened yet';

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
  /** Its row in `FLOW_ROWS`. */
  no: number;
};

export type StructureRow = {
  no: number; label: string; rail: MoneyRail; kinds: MoneyKind[];
  receiving: ReceivingAccount; receiving_text: string;
};

type Point = { x: number; y: number };
export type StructureMap = {
  view_box: [number, number];
  boxes: { id: string; outside: boolean; d: string; title: Point & { text: string }; sub: (Point & { text: string }) | null }[];
  routes: { id: string; style: 'licence' | 'mercury' | 'stripe'; d: string; head: string; marker: string; num: Point }[];
  labels: (Point & { size: number; tone: 'ink' | 'grey'; text: string })[];
  guides: { d: string }[];
  caption: Point & { size: number; text: string };
};

export type StructureAccount = { label: string; account_kind: 'checking' | 'savings'; account_masked: string; account_last4: string };
export type StructureAccounts = { key: AxalEntityKey; name: string; accounts: StructureAccount[] }[];

export type StructureEntity = {
  key: AxalEntityKey; name: string; role: string; signs: string;
  signatory: string; title: string; through: string | null;
  /** The labels of the payment purposes paid to this entity: "Receives on paper". */
  receives: string[];
};

export type StructureModel = {
  audience: StructureAudience;
  entities: StructureEntity[];
  /** Holdings licenses the platform to Management (A) and to the GP (B) (decision 1 of D707). */
  licences: { id: 'A' | 'B'; licensor: 'holdings'; licensee: AxalEntityKey; scope: string; fee_kind: MoneyKind }[];
  flows: StructureFlow[];
  rows: StructureRow[];
  map: StructureMap;
  rails: { rail: MoneyRail; name: string; text: string }[];
  rails_note: string;
  signing: { address: string; email: string; routing: string };
  note: string;
  /** super_admin only: each entity's active accounts, masked. null when the registry could not be read. */
  accounts?: StructureAccounts | null;
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

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** A circle of radius r around (x, y), as a path of two arcs. */
function circlePath(x: number, y: number, r: number): string {
  return `M${f1(x - r)} ${f1(y)}a${r} ${r} 0 1 0 ${f1(2 * r)} 0a${r} ${r} 0 1 0 ${f1(-2 * r)} 0Z`;
}

/** A closed arrowhead with its tip at `to`, its base 5 back along the route at plus and minus 0.45 rad. */
function headPath(from: [number, number], to: [number, number]): string {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const [x, y] = to;
  const p = (da: number) => `${f1(x - 5 * Math.cos(a + da))} ${f1(y - 5 * Math.sin(a + da))}`;
  return `M${f1(x)} ${f1(y)}L${p(-0.45)}L${p(0.45)}Z`;
}

/** L10's drawing as path data and text positions. `fundSub` is the Fund box's sub-line. */
function buildMap(fundSub: string): StructureMap {
  const L = STRUCTURE_LAYOUT;
  return {
    view_box: [...L.view_box] as [number, number],
    boxes: L.boxes.map((b) => {
      const cx = b.x + b.w / 2;
      const title = b.title ?? AXAL_ENTITIES[b.id as AxalEntityKey].name;
      const sub = b.id === 'fund' ? fundSub : b.sub;
      return {
        id: b.id, outside: b.outside, d: `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`,
        title: { x: cx, y: b.y + (b.h === 40 ? 24 : 22), text: title },
        sub: sub ? { x: cx, y: b.y + 37, text: sub } : null,
      };
    }),
    routes: L.routes.map((r) => {
      const mx = (r.from[0] + r.to[0]) / 2; const my = (r.from[1] + r.to[1]) / 2;
      return {
        id: r.id, style: r.style, d: `M${r.from[0]} ${r.from[1]}L${r.to[0]} ${r.to[1]}`,
        head: headPath(r.from, r.to), marker: circlePath(mx, my, 6.5), num: { x: mx, y: my + 2.5 },
      };
    }),
    labels: L.labels.map((l) => ({ ...l })),
    guides: L.guides.map((g) => ({ d: g.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') })),
    caption: { ...L.caption },
  };
}

/** The Super Admin's accounts: active only, by entity in map order, four fields each. null when the registry fails. */
async function accountsFor(env: Env): Promise<StructureAccounts | null> {
  try {
    const all = (await listAccounts(env)).filter((a) => a.status === 'active');
    return STRUCTURE_ENTITY_ORDER.map((key) => ({
      key, name: AXAL_ENTITIES[key].name,
      accounts: all.filter((a) => a.entity_key === key).map((a) => ({
        label: a.label, account_kind: a.account_kind, account_masked: a.account_masked, account_last4: a.account_last4,
      })),
    }));
  } catch {
    console.warn(JSON.stringify({ event: 'fund_structure_accounts_unread', code: 'accounts_unreadable' }));
    return null;
  }
}

const rowOf = (kind: MoneyKind) => FLOW_ROWS.find((r) => r.kinds.includes(kind))!;

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
      purpose, receiving: await receivingFor(row, purpose), no: rowOf(row.kind).no,
    };
  }));

  const rows: StructureRow[] = FLOW_ROWS.map((r) => {
    const first = flows.find((f) => f.kind === r.kinds[0])!;
    return {
      no: r.no, label: r.label, rail: first.rail, kinds: [...r.kinds],
      receiving: first.receiving, receiving_text: receivingLine(first.receiving),
    };
  });
  const fundRow = rows.find((r) => r.kinds.includes('capital_contribution'))!.receiving;
  const fundMissing = fundRow.shown === 'refusal' && fundRow.code === 'fund_account_missing';

  const licences = MONEY_KINDS.filter((row) => row.group === 'intercompany' && row.payee === 'holdings')
    .map((row) => ({
      // A: Holdings to Management. B: Holdings to the GP. The map draws each as its own route.
      id: (row.payer === 'management' ? 'A' : 'B') as 'A' | 'B', licensor: 'holdings' as const, licensee: row.payer as AxalEntityKey,
      // "Platform licence fee, management administration" → "management administration"
      scope: row.label.split(', ').slice(1).join(', ') || row.label, fee_kind: row.kind,
    }));

  const purposes = Object.values(PAYMENT_PURPOSES) as { payee: AxalEntityKey; label: string }[];
  const model: StructureModel = {
    audience: o.audience,
    entities: STRUCTURE_ENTITY_ORDER.map((key) => ({
      key, name: AXAL_ENTITIES[key].name, role: ENTITY_ROLES[key], signs: ENTITY_SIGNS[key],
      signatory: AXAL_SIGNATORY_NAME, title: AXAL_ENTITIES[key].signatoryTitle, through: AXAL_ENTITIES[key].through ?? null,
      receives: purposes.filter((p) => p.payee === key).map((p) => p.label),
    })),
    licences, flows, rows,
    map: buildMap(fundMissing ? `The Fund${FUND_MISSING_SUB}` : 'The Fund'),
    rails: RAIL_LINES.map((r) => ({ ...r })),
    rails_note: RAILS_NOTE,
    signing: { address: AXAL_LEGAL_ADDRESS, email: AXAL_LEGAL_EMAIL, routing: ENTITY_SIGNS_ROUTING },
    note: OUTSIDE_THE_MAP,
  };
  if (o.audience === 'super_admin') model.accounts = await accountsFor(env);
  return model;
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
