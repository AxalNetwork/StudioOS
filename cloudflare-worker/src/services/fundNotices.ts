// D716 (#1781, PR 1) — the notices: what each type prints, built from the
// records, and the one payment-instructions block.
//
// `buildNoticeFigures(env, { type, source, inputs }, today)` answers
// `{ figures, refusal }`:
//   - `figures` is everything the notice prints, frozen at issue, and
//     `figuresDigest` hashes it (canonical JSON, sorted keys);
//   - `refusal` is why it cannot issue. A preview still prints when the
//     figures exist (#1773's sentence in the payment block's place, a stub's
//     "Stub — counsel to draft", a bracket label for an unfilled field); an
//     issue refuses.
//
// Payment instructions come only from #1773's `payInstructionsFor`, masked:
// no figure, row, response or file here ever holds a full account number. The
// phone check is #1773's `PAY_WARNING`, imported, never copied (decision 4).
// The two fee types (`management_fee_statement`, `management_fee_invoice`)
// read #1774's period and statement (`readPeriod`, `statementFor`), never its
// tables. The statement previews and draws its paper only: it reaches an LP
// through #1777's queue, so it never issues here.
//
// `noticeSpecimen(env, type)` (D758, #1864) is each type's page as a specimen
// for the Templates catalog: the same labels, every figure a bracket. It reads
// no record and no account; only the three prose types read their library row.
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import type { Env } from '../types';
import { AXAL_ENTITIES, buildAddresseeBlock, type AxalEntityKey } from './legalDocFormat';
import {
  PAYMENT_PURPOSES, PAY_WARNING, capitalCallReference, fundPayeeOf, isPaymentPurpose, payInstructionsFor,
  type PaymentPurpose,
} from './payInstructions';
import { readLine } from './fundCallLedger';
import { FeeRefusal, readPeriod, statementFor } from './fundFees';
import { parseQuarter } from './fundFeeCalc';
import { commitmentCents, splitCall } from './fundCallSplit';
import { getTemplate } from './legalTemplateStore';
import { bracketLabel } from './legalMergeSchema';
import type { NoticeKeyFigure, NoticePayment, NoticeTable, PaperInput } from './legalPaper';
import { RECEIVING_BRACKET } from './fundStructure';

export type NoticeType =
  | 'capital_call_notice' | 'distribution_notice' | 'default_notice'
  | 'management_fee_statement' | 'management_fee_invoice'
  | 'platform_licence_fee_invoice' | 'payment_instructions_letter'
  // D802 (#2238): HQ's annual fee invoice to a territory licensee.
  | 'territory_licence_fee_invoice';

export interface NoticeTypeDef {
  type: NoticeType;
  title: string;
  /** Who sends it; the letter's sender is its purpose's payee. */
  sender: AxalEntityKey | 'purpose_payee';
  /** True when the prose is counsel's catalog body. */
  prose: boolean;
  /** True when it prints the sender's block. The invoices print none. */
  senderBlock: boolean;
}

/** Decision 3, the seven types; D802 adds the eighth, the territory licence fee invoice. */
export const NOTICE_TYPES: readonly NoticeTypeDef[] = Object.freeze([
  { type: 'capital_call_notice', title: 'Capital Call Notice', sender: 'fund', prose: true, senderBlock: true },
  { type: 'distribution_notice', title: 'Distribution Notice', sender: 'fund', prose: true, senderBlock: true },
  { type: 'default_notice', title: 'Notice of Default', sender: 'fund', prose: true, senderBlock: true },
  { type: 'management_fee_statement', title: 'Management Fee Statement', sender: 'fund', prose: false, senderBlock: true },
  { type: 'management_fee_invoice', title: 'Management Fee Invoice', sender: 'gp', prose: false, senderBlock: false },
  { type: 'platform_licence_fee_invoice', title: 'Platform Licence Fee Invoice', sender: 'holdings', prose: false, senderBlock: false },
  { type: 'payment_instructions_letter', title: 'Payment Instructions', sender: 'purpose_payee', prose: false, senderBlock: true },
  { type: 'territory_licence_fee_invoice', title: 'Territory Licence Fee Invoice', sender: 'holdings', prose: false, senderBlock: false },
] as NoticeTypeDef[]);

export const isNoticeType = (v: unknown): v is NoticeType => NOTICE_TYPES.some((t) => t.type === v);
export const noticeTypeDef = (t: NoticeType) => NOTICE_TYPES.find((d) => d.type === t)!;

/** Decision 5: the tax character a distribution notice freezes. */
export const TAX_CHARACTERS = Object.freeze({
  return_of_capital: 'Return of capital',
  long_term_capital_gain: 'Long-term capital gain',
  short_term_capital_gain: 'Short-term capital gain',
  ordinary_income: 'Ordinary income',
  qualified_dividend: 'Qualified dividend',
  tax_withheld: 'Tax withheld',
});
export type TaxCharacter = keyof typeof TAX_CHARACTERS;

/** The fixed sentences D716.md lists. Operating instructions, not legal terms. */
export const NOTICE_SENTENCES = Object.freeze({
  fullNumber: 'The full account number is shown in your LP workspace, after you confirm these details by phone.',
  stub: 'Stub — counsel to draft',
  onlyInstructions: (entity: string) => `These are the only instructions on which ${entity} accepts payment.`,
  replacesEarlier: (entity: string) => `This letter replaces any earlier payment instructions from ${entity}.`,
  /** #1774's `pay_to.sentence`: the LP funds its share through a capital call. */
  nothingDue: 'Nothing is due from you against this statement.',
});

/** The licence each licensee pays for (#1772's two platform IP licences). */
const LICENCE_SLUG: Record<'management' | 'gp', string> = {
  management: 'platform_ip_licence_management_admin',
  gp: 'platform_ip_licence_fund_admin',
};

export class NoticeRefusal extends Error {
  status: number;
  code: string;
  publicMessage: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.publicMessage = message;
    this.extra = extra;
  }
}

// ---------------------------------------------------------------- formatting

/** Integer cents as dollars, never through a float. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError('cents must be a whole number');
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface NoticeFigures {
  type: NoticeType;
  title: string;
  notice_date: string;
  sender: AxalEntityKey;
  payee: AxalEntityKey | null;
  purpose: PaymentPurpose | null;
  fund_id: number | null;
  limited_partner_id: number | null;
  source_ref: string;
  addressee: string[];
  key_figures: NoticeKeyFigure[];
  tables: NoticeTable[];
  warning: string;
  payment: (NoticePayment & { account_uid?: string; account_last4?: string; refusal_code?: string }) | null;
  reference: string | null;
  amount_cents: number | null;
  /** The prose: counsel's body, merged, or the stub line; with its slug, version and body hash. */
  prose: { slug: string; version: number | null; body_sha256: string | null; text: string } | null;
  /** The sentences that close a letter. */
  closing: string[];
}

export async function figuresDigest(f: NoticeFigures): Promise<string> {
  return sha256Hex(canonicalJson(f));
}

/**
 * #1860: the call number and the due date an LP's list shows, read from the
 * key figures this file writes — "Call number" and "Due date" on a capital
 * call, "Call number" and "Cure date" on a default notice, both null on any
 * other type. Computed on read; never part of the figures or their digest. A
 * value that is not a date ("Not set") is null.
 */
export function noticeListFacts(f: NoticeFigures): { call_number: string | null; due_date: string | null } {
  const dueLabel = f?.type === 'capital_call_notice' ? 'Due date' : f?.type === 'default_notice' ? 'Cure date' : null;
  if (!dueLabel) return { call_number: null, due_date: null };
  const figure = (label: string) => (Array.isArray(f.key_figures) ? f.key_figures.find((k) => k.label === label)?.value : undefined);
  const call = figure('Call number');
  const due = figure(dueLabel);
  return { call_number: typeof call === 'string' && call.trim() !== '' ? call : null, due_date: isDate(due) ? due : null };
}

// ---------------------------------------------------------------- the payment block

/** Decision 4: #1773's answer as L6's block, masked. A refusal prints its sentence in the block's place. */
export async function paymentBlock(env: Env, payee: AxalEntityKey, purpose: PaymentPurpose, reference: string | null, toLp: boolean):
  Promise<{ payment: NonNullable<NoticeFigures['payment']>; refusal: { code: string; message: string } | null }> {
  const pay = await payInstructionsFor(env, payee, purpose);
  if (!pay.ok) {
    return { payment: { refusal: pay.message, refusal_code: pay.code }, refusal: { code: pay.code, message: pay.message } };
  }
  const i = pay.instructions;
  const lines: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Beneficiary', value: i.beneficiary_name },
    { label: 'Beneficiary address', value: i.beneficiary_address },
    { label: 'Bank', value: i.bank_name },
    { label: 'Bank address', value: i.bank_address },
    { label: 'Routing number (ABA)', value: i.routing_number, mono: true },
  ];
  if (i.routing_number_alt) lines.push({ label: 'Alternate routing number', value: i.routing_number_alt, mono: true });
  if (i.swift_code) lines.push({ label: 'SWIFT', value: i.swift_code, mono: true });
  if (i.intermediary_swift_code) lines.push({ label: 'Intermediary SWIFT', value: i.intermediary_swift_code, mono: true });
  lines.push({ label: 'Account', value: `ending ${i.account_last4}`, mono: true });
  if (toLp) lines.push({ label: 'Full account number', value: NOTICE_SENTENCES.fullNumber });
  return { payment: { lines, reference, account_uid: i.uid, account_last4: i.account_last4 }, refusal: null };
}

// ---------------------------------------------------------------- prose

/** Fill `{{path}}` from the context. Unfilled fields print as bracket labels and are named. */
export function mergeProse(body: string, ctx: Record<string, string>): { text: string; unfilled: string[] } {
  const unfilled = new Set<string>();
  const text = body.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, path: string) => {
    const v = ctx[path];
    if (v == null || v === '') { unfilled.add(path); return bracketLabel(path); }
    return v;
  });
  return { text, unfilled: [...unfilled].sort() };
}

async function proseFor(env: Env, slug: string, ctx: Record<string, string>):
  Promise<{ prose: NonNullable<NoticeFigures['prose']>; refusal: { code: string; message: string; extra?: Record<string, unknown> } | null }> {
  const tpl = await getTemplate(env, slug);
  const body = tpl && !tpl.is_stub ? String(tpl.body_md || '') : '';
  if (!tpl || tpl.is_stub || !body.trim()) {
    return {
      prose: { slug, version: tpl ? Number(tpl.version) : null, body_sha256: null, text: NOTICE_SENTENCES.stub },
      refusal: { code: 'notice_body_missing', message: 'Counsel has not written this notice yet, so it cannot issue.' },
    };
  }
  const merged = mergeProse(body, ctx);
  return {
    prose: { slug, version: Number(tpl.version), body_sha256: await sha256Hex(body), text: merged.text },
    refusal: merged.unfilled.length
      ? { code: 'merge_field_unfilled', message: `The notice has fields with no value: ${merged.unfilled.join(', ')}.`, extra: { fields: merged.unfilled } }
      : null,
  };
}

/** D758: why a prose notice cannot issue while its library row has no body, in `proseFor`'s own words; else null. */
export async function noticeBodyRefusal(env: Env, slug: string): Promise<{ code: string; message: string } | null> {
  const { refusal } = await proseFor(env, slug, {});
  return refusal && refusal.code === 'notice_body_missing' ? { code: refusal.code, message: refusal.message } : null;
}

// ---------------------------------------------------------------- the builders

export interface NoticeRequest {
  type: unknown;
  source?: Record<string, unknown> | null;
  inputs?: Record<string, unknown> | null;
}

export interface BuiltNotice {
  figures: NoticeFigures;
  /** Why it cannot issue; a preview still prints. */
  refusal: { code: string; message: string; extra?: Record<string, unknown> } | null;
}

const posInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

async function lpRow(env: Env, lpId: number) {
  return env.DB.prepare(
    `SELECT lp.id, lp.fund_id, lp.user_id, lp.commitment_amount, COALESCE(u.name, lp.name) AS name
       FROM limited_partners lp LEFT JOIN users u ON u.id = lp.user_id WHERE lp.id = ?`,
  ).bind(lpId).first<{ id: number; fund_id: number; user_id: number | null; commitment_amount: number; name: string | null }>();
}

async function assertAxalFund(env: Env, fundId: number) {
  if (await fundPayeeOf(env, fundId) !== 'fund') {
    throw new NoticeRefusal(409, 'not_an_axal_fund', 'This fund is not an Axal fund, so Axal sends no notice for it.');
  }
}

/** What this LP has been called to date, through the given line (inclusive). */
async function calledToDateCents(env: Env, lpId: number, throughLineId: number | null): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(COALESCE(amount_cents, CAST(ROUND(amount * 100) AS INTEGER))), 0) AS cents
       FROM capital_calls WHERE limited_partner_id = ? AND (? IS NULL OR id <= ?)`,
  ).bind(lpId, throughLineId, throughLineId).first<{ cents: number }>();
  return Number(row?.cents ?? 0);
}

function commitmentTable(commitment: number, calledToDate: number, thisCall: number): NoticeTable {
  return {
    title: 'Your commitment',
    columns: [{ label: 'Item' }, { label: 'Amount', align: 'right' }],
    rows: [
      ['Commitment', formatCents(commitment)],
      ['Called to date, including this call', formatCents(calledToDate)],
      ['This call', formatCents(thisCall)],
      ['Unfunded after this call', formatCents(commitment - calledToDate)],
    ],
  };
}

async function capitalCall(env: Env, req: NoticeRequest, today: string): Promise<BuiltNotice> {
  const src = req.source || {};
  const fundName = AXAL_ENTITIES.fund.name;
  let lp; let fundId: number; let callNumber: number; let amount: number; let dueDate: string | null; let purpose: string | null;
  let lineId: number | null = null;
  let calledToDate: number;
  if (src.line_id != null) {
    lineId = posInt(src.line_id);
    const line = lineId ? await readLine(env, lineId) : null;
    if (!line || !line.fund_call_id) throw new NoticeRefusal(404, 'source_not_found', 'No capital call line here.');
    fundId = Number(line.fund_id);
    await assertAxalFund(env, fundId);
    if (line.status === 'paid' || line.outstanding_cents <= 0) {
      throw new NoticeRefusal(409, 'line_already_paid', 'This line is paid, so no capital call notice issues for it.');
    }
    const head = await env.DB.prepare('SELECT call_number, purpose, due_date FROM fund_capital_calls WHERE id = ?')
      .bind(line.fund_call_id).first<{ call_number: number; purpose: string | null; due_date: string | null }>();
    lp = await lpRow(env, Number(line.limited_partner_id));
    callNumber = Number(head?.call_number ?? 0);
    amount = Number(line.owed_cents);
    dueDate = line.due_date || head?.due_date || null;
    purpose = head?.purpose || null;
    calledToDate = await calledToDateCents(env, Number(line.limited_partner_id), lineId);
  } else if (src.proposed && typeof src.proposed === 'object') {
    // A proposed call, previewed for one LP: split as the capital-call preview splits it.
    const p = src.proposed as Record<string, unknown>;
    fundId = posInt(p.fund_id) ?? 0;
    const lpId = posInt(p.lp_id);
    const total = posInt(p.amount_cents);
    if (!fundId || !lpId || !total) throw new NoticeRefusal(400, 'source_invalid', 'A proposed call needs fund_id, lp_id and amount_cents.');
    await assertAxalFund(env, fundId);
    const lps = (await env.DB.prepare(
      `SELECT lp.id, lp.commitment_amount FROM limited_partners lp
        WHERE lp.fund_id = ? AND lp.status IN ('committed', 'active') ORDER BY lp.id`,
    ).bind(fundId).all<{ id: number; commitment_amount: number }>()).results || [];
    const share = splitCall(total, lps).lines.find((l) => l.lpId === lpId);
    if (!share) throw new NoticeRefusal(404, 'source_not_found', 'That LP is not billed on this call.');
    const next = await env.DB.prepare('SELECT COALESCE(MAX(call_number), 0) + 1 AS n FROM fund_capital_calls WHERE fund_id = ?')
      .bind(fundId).first<{ n: number }>();
    lp = await lpRow(env, lpId);
    callNumber = Number(next?.n ?? 1);
    amount = share.shareCents;
    dueDate = isDate(p.due_date) ? p.due_date : null;
    purpose = typeof p.purpose === 'string' ? p.purpose.slice(0, 120) : null;
    calledToDate = (await calledToDateCents(env, lpId, null)) + amount;
  } else {
    throw new NoticeRefusal(400, 'source_invalid', 'Name the call line, or a proposed call and one LP.');
  }
  if (!lp) throw new NoticeRefusal(404, 'source_not_found', 'No limited partner here.');
  const reference = lineId ? capitalCallReference(fundId, Number(lp.id), lineId) : null;
  const commitment = commitmentCents(lp.commitment_amount) ?? 0;
  const pay = await paymentBlock(env, 'fund', 'capital_contribution', reference, true);
  const ctx = {
    'lp.name': lp.name || '', 'lp.number': `L${lp.id}`, 'fund.name': fundName, 'call.number': String(callNumber),
    'call.amount': formatCents(amount), 'call.due_date': dueDate || '', 'notice.date': today, 'notice.reference': reference || '',
  };
  const prose = await proseFor(env, 'capital_call_notice', ctx);
  const figures: NoticeFigures = {
    type: 'capital_call_notice', title: 'Capital Call Notice', notice_date: today, sender: 'fund', payee: 'fund',
    purpose: 'capital_contribution', fund_id: fundId, limited_partner_id: Number(lp.id),
    source_ref: lineId ? `call_line:${lineId}` : `proposed:${fundId}:${lp.id}`,
    addressee: buildAddresseeBlock({ to: lp.name || '', lpNumber: Number(lp.id) }),
    key_figures: [
      { label: 'Notice date', value: today },
      { label: 'Call number', value: String(callNumber) },
      { label: 'Amount due', value: formatCents(amount), mono: true },
      { label: 'Due date', value: dueDate || 'Not set' },
    ],
    tables: [
      { title: 'This call', columns: [{ label: 'Purpose' }, { label: 'Amount', align: 'right' }], rows: [[purpose || 'Capital contribution', formatCents(amount)]] },
      commitmentTable(commitment, calledToDate, amount),
    ],
    warning: PAY_WARNING,
    payment: pay.payment,
    reference,
    amount_cents: amount,
    prose: prose.prose,
    closing: [],
  };
  return { figures, refusal: pay.refusal ?? prose.refusal };
}

async function distribution(env: Env, req: NoticeRequest): Promise<BuiltNotice> {
  const id = posInt(req.source?.distribution_id);
  const row = id ? await env.DB.prepare(
    `SELECT d.id, d.fund_id, d.lp_id, d.amount_cents, d.distribution_type, d.status, d.distributed_at
       FROM fund_distributions d WHERE d.id = ?`,
  ).bind(id).first<{ id: number; fund_id: number; lp_id: number; amount_cents: number; distribution_type: string; status: string; distributed_at: string | null }>() : null;
  if (!row) throw new NoticeRefusal(404, 'source_not_found', 'No distribution here.');
  await assertAxalFund(env, Number(row.fund_id));
  if (row.status !== 'paid') throw new NoticeRefusal(409, 'distribution_not_paid', 'This distribution is not marked paid, so no notice issues for it.');
  const tax = req.inputs?.tax_character;
  if (typeof tax !== 'string' || !Object.hasOwn(TAX_CHARACTERS, tax)) {
    throw new NoticeRefusal(400, 'tax_character_missing', 'Pick the distribution\'s tax character.');
  }
  const lp = await lpRow(env, Number(row.lp_id));
  if (!lp) throw new NoticeRefusal(404, 'source_not_found', 'No limited partner here.');
  const date = String(row.distributed_at || '').slice(0, 10);
  const amount = Number(row.amount_cents);
  const ctx = {
    'lp.name': lp.name || '', 'lp.number': `L${lp.id}`, 'fund.name': AXAL_ENTITIES.fund.name,
    'distribution.amount': formatCents(amount), 'distribution.date': date, 'distribution.type': row.distribution_type,
    'distribution.tax_character': TAX_CHARACTERS[tax as TaxCharacter], 'notice.date': date,
  };
  const prose = await proseFor(env, 'distribution_notice', ctx);
  const figures: NoticeFigures = {
    type: 'distribution_notice', title: 'Distribution Notice', notice_date: date, sender: 'fund', payee: null, purpose: null,
    fund_id: Number(row.fund_id), limited_partner_id: Number(lp.id), source_ref: `distribution:${row.id}`,
    addressee: buildAddresseeBlock({ to: lp.name || '', lpNumber: Number(lp.id) }),
    key_figures: [
      { label: 'Distribution date', value: date ? `${date} (date recorded when marked paid)` : 'date recorded when marked paid' },
      { label: 'Amount', value: formatCents(amount), mono: true },
    ],
    tables: [{
      title: 'This distribution',
      columns: [{ label: 'Type' }, { label: 'Tax character' }, { label: 'Amount', align: 'right' }],
      rows: [[row.distribution_type, TAX_CHARACTERS[tax as TaxCharacter], formatCents(amount)]],
    }],
    warning: PAY_WARNING,
    payment: null,
    reference: null,
    amount_cents: amount,
    prose: prose.prose,
    closing: [],
  };
  return { figures, refusal: prose.refusal };
}

async function defaultNotice(env: Env, req: NoticeRequest, today: string): Promise<BuiltNotice> {
  const lineId = posInt(req.source?.line_id);
  const line = lineId ? await readLine(env, lineId) : null;
  if (!line || !line.fund_call_id) throw new NoticeRefusal(404, 'source_not_found', 'No capital call line here.');
  await assertAxalFund(env, Number(line.fund_id));
  const due = String(line.due_date || '');
  if (!(line.outstanding_cents > 0) || !isDate(due) || !(due < today)) {
    throw new NoticeRefusal(409, 'line_not_overdue', 'This line is not overdue, so no default notice issues for it.');
  }
  const cure = req.inputs?.cure_date;
  if (!isDate(cure) || !(cure > today)) throw new NoticeRefusal(400, 'cure_date_invalid', 'Give a cure date after today.');
  const section = typeof req.inputs?.lpa_section === 'string' ? req.inputs.lpa_section.trim() : '';
  if (section.length < 1 || section.length > 200) throw new NoticeRefusal(400, 'lpa_section_invalid', 'Give the LPA section, 1 to 200 characters.');
  const head = await env.DB.prepare('SELECT call_number FROM fund_capital_calls WHERE id = ?').bind(line.fund_call_id).first<{ call_number: number }>();
  const lp = await lpRow(env, Number(line.limited_partner_id));
  if (!lp) throw new NoticeRefusal(404, 'source_not_found', 'No limited partner here.');
  const fundId = Number(line.fund_id);
  const reference = capitalCallReference(fundId, Number(lp.id), lineId!);
  const outstanding = Number(line.outstanding_cents);
  const pay = await paymentBlock(env, 'fund', 'capital_contribution', reference, true);
  const ctx = {
    'lp.name': lp.name || '', 'lp.number': `L${lp.id}`, 'fund.name': AXAL_ENTITIES.fund.name,
    'call.number': String(head?.call_number ?? ''), 'default.amount': formatCents(outstanding), 'default.due_date': due,
    'default.cure_date': cure, 'default.lpa_section': section, 'notice.date': today, 'notice.reference': reference,
  };
  const prose = await proseFor(env, 'default_notice', ctx);
  const figures: NoticeFigures = {
    type: 'default_notice', title: 'Notice of Default', notice_date: today, sender: 'fund', payee: 'fund', purpose: 'capital_contribution',
    fund_id: fundId, limited_partner_id: Number(lp.id), source_ref: `call_line:${lineId}`,
    addressee: buildAddresseeBlock({ to: lp.name || '', lpNumber: Number(lp.id) }),
    key_figures: [
      { label: 'Notice date', value: today },
      { label: 'Call number', value: String(head?.call_number ?? '') },
      { label: 'Amount outstanding', value: formatCents(outstanding), mono: true },
      { label: 'Original due date', value: due },
      { label: 'Cure date', value: cure },
      { label: 'LPA section', value: section },
    ],
    tables: [],
    warning: PAY_WARNING,
    payment: pay.payment,
    reference,
    amount_cents: outstanding,
    prose: prose.prose,
    closing: [],
  };
  return { figures, refusal: pay.refusal ?? prose.refusal };
}

async function licenceInvoice(env: Env, req: NoticeRequest, today: string): Promise<BuiltNotice> {
  const i = req.inputs || {};
  const licensee = i.licensee;
  if (licensee !== 'management' && licensee !== 'gp') {
    throw new NoticeRefusal(400, 'licensee_invalid', 'Holdings licenses the platform to Management or the GP only.');
  }
  if (!isDate(i.period_start) || !isDate(i.period_end) || i.period_end < i.period_start) {
    throw new NoticeRefusal(400, 'period_invalid', 'Give the licence period\'s first and last day, the last on or after the first.');
  }
  const amount = posInt(i.amount_cents);
  if (!amount) throw new NoticeRefusal(400, 'amount_invalid', 'Give the amount as a positive whole number of cents.');
  if (!isDate(i.due_date)) throw new NoticeRefusal(400, 'due_date_invalid', 'Give the due date.');
  const reference = `AXAL-LIC-${licensee === 'management' ? 'MGMT' : 'GP'}-${i.period_start.replace(/-/g, '')}`;
  const pay = await paymentBlock(env, 'holdings', 'platform_licence_fee', reference, false);
  const figures: NoticeFigures = {
    type: 'platform_licence_fee_invoice', title: 'Platform Licence Fee Invoice', notice_date: today, sender: 'holdings', payee: 'holdings',
    purpose: 'platform_licence_fee', fund_id: null, limited_partner_id: null,
    source_ref: `licence:${licensee}:${i.period_start}`,
    addressee: buildAddresseeBlock({ to: AXAL_ENTITIES[licensee].name, from: 'holdings' }),
    key_figures: [
      { label: 'Invoice date', value: today },
      { label: 'Period', value: `${i.period_start} to ${i.period_end}` },
      { label: 'Amount due', value: formatCents(amount), mono: true },
      { label: 'Due date', value: i.due_date },
    ],
    tables: [{
      columns: [{ label: 'Licence' }, { label: 'Period' }, { label: 'Amount', align: 'right' }],
      rows: [[LICENCE_SLUG[licensee], `${i.period_start} to ${i.period_end}`, formatCents(amount)], ['Total', '', formatCents(amount)]],
      total: true,
    }],
    warning: PAY_WARNING,
    payment: pay.payment,
    reference,
    amount_cents: amount,
    prose: null,
    closing: [],
  };
  return { figures, refusal: pay.refusal };
}

const CURRENCY_SIGN: Readonly<Record<string, string>> = Object.freeze({ USD: '$', EUR: '\u20ac', GBP: '\u00a3' });

/** "€12,000.00" in the row's own currency; a currency with no sign here is written "CHF 12,000.00". */
export function formatMoney(cents: number, currency: string): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError('cents must be a whole number');
  const code = String(currency || '').toUpperCase();
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const amount = `${whole}.${String(abs % 100).padStart(2, '0')}`;
  const sign = CURRENCY_SIGN[code];
  return `${cents < 0 ? '-' : ''}${sign ?? `${code} `}${amount}`;
}

/** What a territory licence fee invoice prints (D802). The caller has checked every figure. */
export interface TerritoryInvoiceInput {
  licence_uid: string;
  licence_ref: string;
  licensee_name: string;
  period_label: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  reference: string;
}

/**
 * D802 (#2238): HQ's annual fee invoice to a territory licensee, drawn as D716's
 * licence invoice is. The sender and payee are Holdings, the licensor of the
 * platform's IP until D797 records another (`licensorRefusal`); the payment block
 * is D798's `territory_licence_fee` purpose, masked. A payment refusal is
 * returned beside the figures, and the caller refuses to issue on it.
 */
export async function territoryLicenceInvoice(env: Env, i: TerritoryInvoiceInput, today: string): Promise<BuiltNotice> {
  const pay = await paymentBlock(env, 'holdings', 'territory_licence_fee', i.reference, false);
  const amount = formatMoney(i.amount_cents, i.currency);
  const period = `${i.period_start} to ${i.period_end}`;
  const figures: NoticeFigures = {
    type: 'territory_licence_fee_invoice', title: 'Territory Licence Fee Invoice', notice_date: today, sender: 'holdings', payee: 'holdings',
    purpose: 'territory_licence_fee', fund_id: null, limited_partner_id: null,
    source_ref: `territory_licence:${i.licence_uid}:${i.period_start}`,
    addressee: buildAddresseeBlock({ to: i.licensee_name, from: 'holdings' }),
    key_figures: [
      { label: 'Invoice date', value: today },
      { label: 'Licence', value: i.licence_ref, mono: true },
      { label: 'Licence year', value: `${i.period_label} (${period})` },
      { label: 'Amount due', value: amount, mono: true },
      { label: 'Due date', value: i.due_date },
    ],
    tables: [{
      columns: [{ label: 'Licence' }, { label: 'Licence year' }, { label: 'Amount', align: 'right' }],
      rows: [[`Annual licence fee, ${i.licence_ref}`, period, amount], ['Total', '', amount]],
      total: true,
    }],
    warning: PAY_WARNING,
    payment: pay.payment,
    reference: i.reference,
    amount_cents: i.amount_cents,
    prose: null,
    closing: [],
  };
  return { figures, refusal: pay.refusal };
}

// ---------------------------------------------------------------- the fee types

/** "2.00% a year" from basis points, never through a float. */
function rateText(bps: number | null): string {
  if (bps == null || !Number.isSafeInteger(bps)) return 'Not recorded';
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}% a year`;
}

/** #1774's period, issued or paid: its draft is not a fee anyone owes yet. */
async function issuedPeriod(env: Env, src: Record<string, unknown>) {
  const fundId = posInt(src.fund_id);
  const quarter = typeof src.quarter === 'string' ? src.quarter : '';
  if (!fundId || !parseQuarter(quarter)) throw new NoticeRefusal(400, 'source_invalid', 'Name the fund and the quarter, as 2026-Q3.');
  await assertAxalFund(env, fundId);
  let read;
  try { read = await readPeriod(env, fundId, quarter); } catch (e) {
    if (e instanceof FeeRefusal && e.status === 404) throw new NoticeRefusal(404, 'source_not_found', 'No fee period here.');
    throw e;
  }
  if (read.period.status === 'draft') {
    throw new NoticeRefusal(409, 'fee_period_not_issued', 'This fee period is still a draft. Issue it before its statement or invoice.');
  }
  return { fundId, quarter, read };
}

async function feeStatement(env: Env, req: NoticeRequest, today: string): Promise<BuiltNotice> {
  const src = req.source || {};
  const lpId = posInt(src.lp_id);
  if (!lpId) throw new NoticeRefusal(400, 'source_invalid', 'Name the fund, the quarter and the LP.');
  const { fundId, quarter } = await issuedPeriod(env, src);
  let st;
  try { st = await statementFor(env, fundId, quarter, lpId); } catch (e) {
    if (e instanceof FeeRefusal && e.status === 404) throw new NoticeRefusal(404, 'source_not_found', 'This LP has no fee line in that quarter.');
    throw e;
  }
  const lp = await lpRow(env, lpId);
  if (!lp) throw new NoticeRefusal(404, 'source_not_found', 'No limited partner here.');
  const BASIS: Record<string, string> = { committed: 'Commitment', net_invested_share: 'Share of net invested capital' };
  const figures: NoticeFigures = {
    type: 'management_fee_statement', title: 'Management Fee Statement', notice_date: today, sender: 'fund', payee: null, purpose: null,
    fund_id: fundId, limited_partner_id: lpId, source_ref: `fee_line:${fundId}:${quarter}:${lpId}`,
    addressee: buildAddresseeBlock({ to: lp.name || '', lpNumber: lpId }),
    key_figures: [
      { label: 'Statement date', value: today },
      { label: 'Quarter', value: quarter },
      { label: 'Fee window', value: `${st.window.start} to ${st.window.end} (${st.window.days} days)` },
      { label: 'Rate', value: rateText(st.rate_bps) },
      { label: 'Net fee', value: formatCents(st.net_fee_cents), mono: true },
      { label: 'Reference', value: st.reference_code, mono: true },
    ],
    tables: [
      {
        title: 'Basis',
        columns: [{ label: 'Basis' }, { label: 'Days', align: 'right' }, { label: 'Amount', align: 'right' }],
        rows: st.basis.map((b) => [BASIS[b.basis] || b.basis, String(b.days), formatCents(Number(b.cents))]),
      },
      {
        title: 'Fee',
        columns: [{ label: 'Item' }, { label: 'Amount', align: 'right' }],
        rows: [
          ['Gross fee', formatCents(st.gross_fee_cents)],
          [`Catch-up (${st.catch_up_days} days)`, formatCents(st.catch_up_cents)],
          ['Offset', formatCents(-st.offset_cents)],
          ['Net fee', formatCents(st.net_fee_cents)],
        ],
        total: true,
      },
    ],
    warning: PAY_WARNING,
    // Decision 4: the LP funds its share through a capital call, whose notice carries the block.
    payment: null,
    reference: st.reference_code,
    amount_cents: st.net_fee_cents,
    prose: null,
    closing: [NOTICE_SENTENCES.nothingDue],
  };
  return { figures, refusal: null };
}

async function feeInvoice(env: Env, req: NoticeRequest, today: string): Promise<BuiltNotice> {
  const { fundId, quarter, read } = await issuedPeriod(env, req.source || {});
  const p = read.period as Record<string, any>;
  const reference = String(p.remittance_reference);
  const pay = await paymentBlock(env, 'gp', 'management_fee', reference, false);
  const net = Number(p.net_cents);
  const figures: NoticeFigures = {
    type: 'management_fee_invoice', title: 'Management Fee Invoice', notice_date: today, sender: 'gp', payee: 'gp',
    purpose: 'management_fee', fund_id: fundId, limited_partner_id: null, source_ref: `fee_period:${fundId}:${quarter}`,
    addressee: buildAddresseeBlock({ to: AXAL_ENTITIES.fund.name, from: 'gp' }),
    key_figures: [
      { label: 'Invoice date', value: today },
      { label: 'Quarter', value: quarter },
      { label: 'Fee window', value: `${p.window_start} to ${p.window_end}` },
      { label: 'Amount due', value: formatCents(net), mono: true },
    ],
    tables: [{
      title: 'Fee lines',
      columns: [{ label: 'LP' }, { label: 'Days', align: 'right' }, { label: 'Gross', align: 'right' }, { label: 'Catch-up', align: 'right' },
        { label: 'Offset', align: 'right' }, { label: 'Net', align: 'right' }],
      rows: [
        ...read.lines.map((l: any) => [`L${l.limited_partner_id}`, String(Number(l.committed_days) + Number(l.invested_days)),
          formatCents(Number(l.gross_fee_cents)), formatCents(Number(l.catch_up_cents)), formatCents(-Number(l.offset_cents)), formatCents(Number(l.net_fee_cents))]),
        ['Total', '', formatCents(Number(p.gross_cents)), formatCents(Number(p.catch_up_cents)), formatCents(-Number(p.offset_applied_cents)), formatCents(net)],
      ],
      total: true,
    }],
    warning: PAY_WARNING,
    payment: pay.payment,
    reference,
    amount_cents: net,
    prose: null,
    closing: [],
  };
  return { figures, refusal: pay.refusal };
}

async function letter(env: Env, req: NoticeRequest, today: string): Promise<BuiltNotice> {
  const purpose = req.inputs?.purpose;
  if (!isPaymentPurpose(purpose)) {
    throw new NoticeRefusal(400, 'purpose_invalid', 'Name the payment purpose the letter gives instructions for.');
  }
  const payee = PAYMENT_PURPOSES[purpose].payee;
  // Management has no wire purpose in #1773's list, so it gets no letter.
  const asked = req.inputs?.entity;
  if (asked != null && asked !== payee) {
    throw new NoticeRefusal(400, 'letter_payee_invalid', `${AXAL_ENTITIES[asked as AxalEntityKey]?.name ?? 'That entity'} is not paid for this, so it sends no letter for it.`);
  }
  const to = typeof req.inputs?.to === 'string' ? req.inputs.to.trim().slice(0, 200) : '';
  const name = AXAL_ENTITIES[payee].name;
  const pay = await paymentBlock(env, payee, purpose, null, false);
  const figures: NoticeFigures = {
    type: 'payment_instructions_letter', title: 'Payment Instructions', notice_date: today, sender: payee, payee, purpose,
    fund_id: null, limited_partner_id: null, source_ref: `letter:${purpose}`,
    addressee: buildAddresseeBlock({ to: to || 'The payer', from: payee }),
    key_figures: [{ label: 'Date', value: today }, { label: 'For', value: PAYMENT_PURPOSES[purpose].label }],
    tables: [],
    warning: PAY_WARNING,
    payment: pay.payment,
    reference: null,
    amount_cents: null,
    prose: null,
    closing: [NOTICE_SENTENCES.onlyInstructions(name), NOTICE_SENTENCES.replacesEarlier(name)],
  };
  return { figures, refusal: pay.refusal };
}

/** Build a notice's figures from the records. `today` is the caller's (UTC, YYYY-MM-DD). */
export async function buildNoticeFigures(env: Env, req: NoticeRequest, today: string): Promise<BuiltNotice> {
  if (!isNoticeType(req.type)) {
    throw new NoticeRefusal(400, 'notice_type_invalid', 'Name one of the notice types this platform builds.');
  }
  switch (req.type) {
    case 'capital_call_notice': return capitalCall(env, req, today);
    case 'distribution_notice': return distribution(env, req);
    case 'default_notice': return defaultNotice(env, req, today);
    case 'management_fee_statement': return feeStatement(env, req, today);
    case 'management_fee_invoice': return feeInvoice(env, req, today);
    case 'platform_licence_fee_invoice': return licenceInvoice(env, req, today);
    case 'payment_instructions_letter': return letter(env, req, today);
    // D802: drawn only from its licence (`services/licenceFeeInvoices.ts`), which keeps one invoice per licence year.
    case 'territory_licence_fee_invoice':
      throw new NoticeRefusal(409, 'issued_from_licence', 'A territory licence fee invoice is issued from its licence, on HQ\'s licence console.');
  }
}

// ---------------------------------------------------------------- the specimen (D758)

const br = (label: string) => `[${label}]`;
const figs = (labels: [string, boolean?][]): NoticeKeyFigure[] =>
  labels.map(([label, mono]) => (mono ? { label, value: br(label), mono: true } : { label, value: br(label) }));
/** One row of bracketed column labels; a totals table also keeps its "Total" row. */
function specimenTable(t: Omit<NoticeTable, 'rows'>): NoticeTable {
  const cells = t.columns.map((c) => br(c.label));
  return { ...t, rows: t.total ? [cells, ['Total', ...cells.slice(1)]] : [cells] };
}
/** The payment block's lines with bracket values, and no account read. */
function specimenPayment(toLp: boolean): NonNullable<NoticeFigures['payment']> {
  const lines: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Beneficiary', value: br('Beneficiary') },
    { label: 'Beneficiary address', value: br('Beneficiary address') },
    { label: 'Bank', value: br('Bank') },
    { label: 'Bank address', value: br('Bank address') },
    { label: 'Routing number (ABA)', value: br('Routing number (ABA)'), mono: true },
    { label: 'Account', value: RECEIVING_BRACKET, mono: true },
  ];
  if (toLp) lines.push({ label: 'Full account number', value: NOTICE_SENTENCES.fullNumber });
  return { lines, reference: br('Reference') };
}

/**
 * A notice type's page with bracket figures, for the Templates catalog's
 * thumbnail (D758 decision 5). The labels are each builder's own; a test
 * holds them to a real build. No record and no account is read: the three
 * prose types read their library row (merged with no values), and nothing else.
 */
export async function noticeSpecimen(env: Env, type: unknown): Promise<NoticeFigures> {
  if (!isNoticeType(type)) {
    throw new NoticeRefusal(400, 'notice_type_invalid', 'Name one of the notice types this platform builds.');
  }
  const def = noticeTypeDef(type);
  const base = {
    type, title: def.title, notice_date: br('Notice date'), fund_id: null, limited_partner_id: null,
    source_ref: br('Source'), warning: PAY_WARNING, amount_cents: null, prose: null, closing: [] as string[],
  };
  const toAddressee = buildAddresseeBlock({ to: '[Addressee]' });
  switch (type) {
    case 'capital_call_notice':
      return {
        ...base, sender: 'fund', payee: 'fund', purpose: 'capital_contribution', addressee: toAddressee,
        key_figures: figs([['Notice date'], ['Call number'], ['Amount due', true], ['Due date']]),
        tables: [
          specimenTable({ title: 'This call', columns: [{ label: 'Purpose' }, { label: 'Amount', align: 'right' }] }),
          specimenTable({ title: 'Your commitment', columns: [{ label: 'Item' }, { label: 'Amount', align: 'right' }] }),
        ],
        payment: specimenPayment(true), reference: br('Reference'),
        prose: (await proseFor(env, 'capital_call_notice', {})).prose,
      };
    case 'distribution_notice':
      return {
        ...base, sender: 'fund', payee: null, purpose: null, addressee: toAddressee,
        key_figures: figs([['Distribution date'], ['Amount', true]]),
        tables: [specimenTable({ title: 'This distribution', columns: [{ label: 'Type' }, { label: 'Tax character' }, { label: 'Amount', align: 'right' }] })],
        payment: null, reference: null,
        prose: (await proseFor(env, 'distribution_notice', {})).prose,
      };
    case 'default_notice':
      return {
        ...base, sender: 'fund', payee: 'fund', purpose: 'capital_contribution', addressee: toAddressee,
        key_figures: figs([['Notice date'], ['Call number'], ['Amount outstanding', true], ['Original due date'], ['Cure date'], ['LPA section']]),
        tables: [], payment: specimenPayment(true), reference: br('Reference'),
        prose: (await proseFor(env, 'default_notice', {})).prose,
      };
    case 'management_fee_statement':
      return {
        ...base, sender: 'fund', payee: null, purpose: null, addressee: toAddressee,
        key_figures: figs([['Statement date'], ['Quarter'], ['Fee window'], ['Rate'], ['Net fee', true], ['Reference', true]]),
        tables: [
          specimenTable({ title: 'Basis', columns: [{ label: 'Basis' }, { label: 'Days', align: 'right' }, { label: 'Amount', align: 'right' }] }),
          specimenTable({ title: 'Fee', columns: [{ label: 'Item' }, { label: 'Amount', align: 'right' }], total: true }),
        ],
        payment: null, reference: br('Reference'), closing: [NOTICE_SENTENCES.nothingDue],
      };
    case 'management_fee_invoice':
      return {
        ...base, sender: 'gp', payee: 'gp', purpose: 'management_fee', addressee: buildAddresseeBlock({ to: '[Addressee]', from: 'gp' }),
        key_figures: figs([['Invoice date'], ['Quarter'], ['Fee window'], ['Amount due', true]]),
        tables: [specimenTable({
          title: 'Fee lines',
          columns: [{ label: 'LP' }, { label: 'Days', align: 'right' }, { label: 'Gross', align: 'right' }, { label: 'Catch-up', align: 'right' },
            { label: 'Offset', align: 'right' }, { label: 'Net', align: 'right' }],
          total: true,
        })],
        payment: specimenPayment(false), reference: br('Reference'),
      };
    case 'platform_licence_fee_invoice':
      return {
        ...base, sender: 'holdings', payee: 'holdings', purpose: 'platform_licence_fee', addressee: buildAddresseeBlock({ to: '[Addressee]', from: 'holdings' }),
        key_figures: figs([['Invoice date'], ['Period'], ['Amount due', true], ['Due date']]),
        tables: [specimenTable({ columns: [{ label: 'Licence' }, { label: 'Period' }, { label: 'Amount', align: 'right' }], total: true })],
        payment: specimenPayment(false), reference: br('Reference'),
      };
    case 'territory_licence_fee_invoice':
      return {
        ...base, sender: 'holdings', payee: 'holdings', purpose: 'territory_licence_fee', addressee: buildAddresseeBlock({ to: '[Addressee]', from: 'holdings' }),
        key_figures: figs([['Invoice date'], ['Licence'], ['Licence year'], ['Amount due', true], ['Due date']]),
        tables: [specimenTable({ columns: [{ label: 'Licence' }, { label: 'Licence year' }, { label: 'Amount', align: 'right' }], total: true })],
        payment: specimenPayment(false), reference: br('Reference'),
      };
    case 'payment_instructions_letter': {
      // Drawn for the first wire purpose, so its sender is that purpose's payee.
      const purpose = Object.keys(PAYMENT_PURPOSES)[0] as PaymentPurpose;
      const payee = PAYMENT_PURPOSES[purpose].payee;
      const name = AXAL_ENTITIES[payee].name;
      return {
        ...base, sender: payee, payee, purpose, addressee: buildAddresseeBlock({ to: '[Addressee]', from: payee }),
        key_figures: figs([['Date'], ['For']]), tables: [], payment: specimenPayment(false), reference: null,
        closing: [NOTICE_SENTENCES.onlyInstructions(name), NOTICE_SENTENCES.replacesEarlier(name)],
      };
    }
  }
}

// ---------------------------------------------------------------- the paper

export interface NoticePaperOptions {
  /** A preview prints Draft; an issued notice its stamp. */
  issued?: { uid: string; stamp: 'issued' | 'superseded'; figures_sha256: string } | null;
}

/** The paper input for a notice's figures (#1776's `paperModel`). */
export function noticePaperInput(f: NoticeFigures, opts: NoticePaperOptions = {}): PaperInput {
  const def = noticeTypeDef(f.type);
  const proseText = f.prose ? f.prose.text : '';
  const closing = f.closing.length ? `\n\n${f.closing.join('\n\n')}` : '';
  return {
    title: f.title,
    body: proseText + closing,
    slug: f.type,
    bodySha256: f.prose?.body_sha256 || 'f'.repeat(64),
    merge: 'filled',
    documentKind: 'notice',
    axalEntityKey: f.sender,
    state: opts.issued ? { kind: 'issued' } : { kind: 'draft' },
    stamp: opts.issued ? opts.issued.stamp : null,
    audit: opts.issued
      ? `Notice ${opts.issued.uid} · figures ${opts.issued.figures_sha256.slice(0, 12)}`
      : 'Notice id and figures hash assigned when issued',
    addressee: f.addressee,
    keyFigures: f.key_figures,
    tables: f.tables,
    warning: f.warning,
    payment: f.payment ? ('refusal' in f.payment ? { refusal: f.payment.refusal } : { lines: f.payment.lines, reference: f.payment.reference }) : null,
    suppressExecutionBlock: !def.senderBlock,
    inlineExecution: true,
    preserveBody: true,
  };
}
