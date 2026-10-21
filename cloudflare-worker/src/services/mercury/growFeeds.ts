/**
 * D840 part 3 (#2348) — the founder's own Mercury feeds their Grow modules,
 * read-only.
 *
 *   Revenue and traction      FACT  one `project_metrics` row per full month
 *                                   (`source = 'mercury'`): operating money in
 *                                   (`cash_in`) and net burn. A credit that
 *                                   matches exactly one paid invoice lands as a
 *                                   revenue entry with the invoice's customer,
 *                                   replacing D713's pick for it; every other
 *                                   credit stays a pick. Invoices paid, open
 *                                   and overdue are counted (team only).
 *   Durable company-building  FACT  cash, treasury and runway (team only); the
 *                                   checklist's runway item reads them.
 *   Team expansion            FACT  payroll by month (team only). "Hires
 *                                   affordable at current runway" is computed
 *                                   when read, never stored and never a plan.
 *   Distribution              FACT  marketing and advertising spend by month,
 *                                   and by channel where a payee names exactly
 *                                   one channel (team only). CAC is computed
 *                                   only where the channel records customers.
 *   Partner network       PROPOSAL  payments to a recipient whose name is an
 *                                   Axal partner's company. Nothing is linked
 *                                   until the founder accepts.
 *
 * EVERY LANDING GOES THROUGH `connector_fed_items` (D655): a re-sync updates
 * the row its ledger row links, and a row the founder deleted keeps its ledger
 * row with no `local_id` and is never re-created.
 *
 * ONLY THE TEAM SEES A BALANCE. Cash, treasury, runway and everything derived
 * from them are read only by members of the founder's company
 * (`isTeamViewer`); anyone else who reads the venture is told the figures are
 * the team's. Nothing here is logged with a figure, and no counterparty name,
 * account number or transaction id is stored.
 */
import type { Env } from '../../types';
import { namesAxalEntity, normalizeEntityName } from '../../integrations/providers/mercury';
import { addMonths, bucketMonths, cashNow, monthOf, runwayFrom, RUNWAY_FULL_MONTHS, type SpendLine } from '../mercurySpend';
import { LEDGER_CURRENCY, mercuryCreditToEntry, namesStripe, verificationFor } from '../revenueLedger';
import { raiseReceiptIds } from '../mercuryPersonal';
import { recomputeRevenueMovements } from '../revenueMovements';
import { MERCURY_INSERT } from '../../routes/revenue';
import { INTERNAL_KINDS, POSTED_STATUSES, VOID_STATUSES } from './parse';
import type { Customer, Invoice, McpTransaction, MercuryReads } from './reads';

/** How many full months a sync reads and writes. */
export const GROW_MONTHS = 12;
/** "Hires affordable" keeps this many months of runway. */
export const HIRE_RUNWAY_MONTHS = 12;
/** A credit counts as an invoice's payment within this many days after it was paid (or due). */
export const INVOICE_PAID_SLACK_DAYS = 10;

// ───────────────────────────────────────────────────────────── the inputs

/** A bank line as this file reads it: D752's spend line. */
export type GrowLine = SpendLine;

export type InvoiceState = 'paid' | 'open' | 'overdue' | 'other';

export interface GrowInvoice {
  id: string;
  amount_cents: number;
  state: InvoiceState;
  customer_name: string | null;
  issued_on: string | null;
  due_on: string | null;
  paid_on: string | null;
  recurring: boolean;
}

export interface GrowAccount { kind: string; available_cents: number | null }

export interface AxalPartner { uid: string; company: string }

export interface GrowChannel { uid: string; name: string; utm_source: string | null }

// ───────────────────────────────────────────────────────────── months

/** The `n` full months before `today`'s, oldest first. */
export function fullMonths(today: string, n = GROW_MONTHS): string[] {
  const current = today.slice(0, 7);
  return Array.from({ length: n }, (_, i) => addMonths(current, i - n));
}

/** The last calendar day of `YYYY-MM`. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const settled = (l: GrowLine) => l.posted && !l.voided && !l.internal;

// ───────────────────────────────────────────────────────────── revenue

export interface RevenueMonth { month: string; cash_in_cents: number | null; net_burn_cents: number | null }

/** Each full month's operating money in and net burn (D752's arithmetic); a month with no posted line has neither. */
export function revenueMonths(lines: GrowLine[], months: string[]): RevenueMonth[] {
  return bucketMonths(lines, months).map((r) => ({ month: r.month, cash_in_cents: r.operating_in_cents, net_burn_cents: r.net_burn_cents }));
}

const DAY = 86_400_000;
const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY;

/**
 * Credits that are a paid invoice's payment: the same amount, posted on or
 * after the invoice was issued and no later than INVOICE_PAID_SLACK_DAYS after
 * it was paid (else due). Only a one-to-one match lands: a credit two invoices
 * fit, or an invoice two credits fit, stays a pick.
 */
export function matchPaidInvoices(lines: GrowLine[], invoices: GrowInvoice[]): Map<string, GrowInvoice> {
  const credits = lines.filter((l) => settled(l) && l.amount_cents > 0 && !l.financing && l.posted_on);
  const paid = invoices.filter((i) => i.state === 'paid' && i.amount_cents > 0);
  const fits = (l: GrowLine, i: GrowInvoice) => {
    if (l.amount_cents !== i.amount_cents) return false;
    const on = dayNum(l.posted_on as string);
    if (i.issued_on && on < dayNum(i.issued_on)) return false;
    const by = i.paid_on ?? i.due_on;
    return !by || on <= dayNum(by) + INVOICE_PAID_SLACK_DAYS;
  };
  const out = new Map<string, GrowInvoice>();
  for (const l of credits) {
    const mine = paid.filter((i) => fits(l, i));
    if (mine.length !== 1) continue;
    const rivals = credits.filter((x) => fits(x, mine[0]));
    if (rivals.length === 1) out.set(l.transaction_id, mine[0]);
  }
  return out;
}

export interface InvoiceTally { state: 'paid' | 'open' | 'overdue'; count: number; amount_cents: number }

/** Invoices by state; an open invoice past its due date is overdue. */
export function invoiceTally(invoices: GrowInvoice[], today: string): InvoiceTally[] {
  const t = { paid: { count: 0, amount_cents: 0 }, open: { count: 0, amount_cents: 0 }, overdue: { count: 0, amount_cents: 0 } };
  for (const i of invoices) {
    let s: InvoiceState = i.state;
    if (s === 'open' && i.due_on && i.due_on.slice(0, 10) < today) s = 'overdue';
    if (s === 'other') continue;
    t[s].count += 1;
    t[s].amount_cents += Math.max(0, i.amount_cents);
  }
  return (['paid', 'open', 'overdue'] as const).map((state) => ({ state, ...t[state] }));
}

// ───────────────────────────────────────────────────────────── spend by kind

/** Payroll providers whose debits are payroll whatever their category. */
export const PAYROLL_PAYEES = ['gusto', 'rippling', 'deel', 'justworks', 'adp', 'trinet', 'paychex', 'remote com', 'oyster hr', 'zenefits'];
const PAYROLL_CATEGORY = /\b(payroll|salar(y|ies)|wages)\b/i;
const MARKETING_CATEGORY = /\b(advertising|marketing)\b/i;

const words = (s: string | null | undefined) => ` ${normalizeEntityName(s)} `;

export function isPayroll(l: Pick<GrowLine, 'category' | 'counterparty_name'>): boolean {
  if (l.category && PAYROLL_CATEGORY.test(l.category)) return true;
  const w = words(l.counterparty_name);
  return PAYROLL_PAYEES.some((p) => w.includes(` ${p} `));
}

export function isMarketing(l: Pick<GrowLine, 'category'>): boolean {
  return !!l.category && MARKETING_CATEGORY.test(l.category);
}

/** Posted debits a predicate keeps, summed per month; a month with none is null, never 0. */
export function debitsByMonth(lines: GrowLine[], months: string[], keep: (l: GrowLine) => boolean): Array<{ month: string; cents: number | null }> {
  const by = new Map<string, number>();
  for (const l of lines) {
    if (!settled(l) || l.amount_cents >= 0 || !keep(l)) continue;
    const m = monthOf(l);
    if (m) by.set(m, (by.get(m) ?? 0) - l.amount_cents);
  }
  return months.map((month) => ({ month, cents: by.has(month) ? by.get(month)! : null }));
}

const channelKey = (s: string | null | undefined) => normalizeEntityName(s);

/**
 * The channel a payee names: its name or UTM source starts the payee's name,
 * on a word. The longest such key wins; two channels with it name none.
 */
export function channelOf(payee: string | null, channels: GrowChannel[]): string | null {
  const p = channelKey(payee);
  if (!p) return null;
  let best = 0; let hits: string[] = [];
  for (const c of channels) {
    const len = Math.max(0, ...[c.name, c.utm_source].map((k) => {
      const key = channelKey(k);
      return key.length >= 3 && (p === key || p.startsWith(`${key} `)) ? key.length : 0;
    }));
    if (!len || len < best) continue;
    if (len > best) { best = len; hits = []; }
    hits.push(c.uid);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Marketing spend per month per channel, for the payees that name exactly one channel. */
export function channelSpend(lines: GrowLine[], months: string[], channels: GrowChannel[]): Array<{ month: string; channel_uid: string; cents: number }> {
  const want = new Set(months);
  const by = new Map<string, number>();
  for (const l of lines) {
    if (!settled(l) || l.amount_cents >= 0 || !isMarketing(l)) continue;
    const m = monthOf(l);
    const uid = channelOf(l.counterparty_name, channels);
    if (!m || !want.has(m) || !uid) continue;
    const k = `${m}|${uid}`;
    by.set(k, (by.get(k) ?? 0) - l.amount_cents);
  }
  return [...by].map(([k, cents]) => { const [month, channel_uid] = k.split('|'); return { month, channel_uid, cents }; })
    .sort((a, b) => a.month.localeCompare(b.month) || a.channel_uid.localeCompare(b.channel_uid));
}

// ───────────────────────────────────────────────────────────── cash and runway

export interface CashFacts {
  cash_cents: number | null;
  treasury_cents: number | null;
  runway_months: number | null;
  runway_reason: string | null;
  average_net_burn_cents: number | null;
}

const RUNWAY_WORDS: Record<string, string> = {
  not_burning: 'Not burning: money in covered money out over the last three full months',
  needs_three_months: 'Not recorded: Mercury holds fewer than three full months of posted lines',
  cash_not_read: 'Not recorded: Mercury gave no available balance',
  partial: 'Not recorded: Mercury holds more lines than one read covers',
};

/** Cash now, treasury and runway from the three full months before today's. */
export function cashFacts(lines: GrowLine[], accounts: GrowAccount[], treasuryCents: number | null, today: string, capped: boolean): CashFacts {
  const cash = cashNow(accounts);
  const months = fullMonths(today, RUNWAY_FULL_MONTHS);
  const r = runwayFrom(cash.cents, bucketMonths(lines, months), capped);
  return {
    cash_cents: cash.cents,
    treasury_cents: treasuryCents,
    runway_months: r.months,
    runway_reason: r.reason ? RUNWAY_WORDS[r.reason] ?? 'Not recorded' : null,
    average_net_burn_cents: r.average_net_burn_cents,
  };
}

/**
 * "Hires affordable at current runway": how many more people at last month's
 * payroll cost per head fit while keeping HIRE_RUNWAY_MONTHS of runway. A
 * computed figure, never a plan; null with the reason when an input is missing.
 */
export function hiresAffordable(input: { cash_cents: number | null; average_net_burn_cents: number | null; payroll_cents: number | null; headcount: number | null }):
  { value: number | null; reason: string | null; cost_per_head_cents: number | null } {
  const { cash_cents: cash, average_net_burn_cents: burn, payroll_cents: payroll, headcount } = input;
  if (cash == null) return { value: null, reason: 'Not recorded: Mercury gave no available balance', cost_per_head_cents: null };
  if (burn == null) return { value: null, reason: 'Not recorded: Mercury holds fewer than three full months of posted lines', cost_per_head_cents: null };
  if (payroll == null) return { value: null, reason: 'Not recorded: Mercury shows no payroll last month', cost_per_head_cents: null };
  if (!headcount || headcount <= 0) return { value: null, reason: 'Not recorded: no one is on the team roster', cost_per_head_cents: null };
  const perHead = Math.round(payroll / headcount);
  if (perHead <= 0) return { value: null, reason: 'Not recorded: Mercury shows no payroll last month', cost_per_head_cents: null };
  const room = Math.floor(cash / HIRE_RUNWAY_MONTHS) - Math.max(0, burn);
  return { value: Math.max(0, Math.floor(room / perHead)), reason: null, cost_per_head_cents: perHead };
}

// ───────────────────────────────────────────────────────────── partners

export interface PartnerPayment { partner_uid: string; company: string; paid_cents: number; payments: number; since: string }

/**
 * Posted debits to a payee whose normalised name equals exactly one Axal
 * partner's company. A proposal's figures, never a link.
 */
export function partnerPayments(lines: GrowLine[], partners: AxalPartner[]): PartnerPayment[] {
  const byName = new Map<string, AxalPartner[]>();
  for (const p of partners) {
    const k = normalizeEntityName(p.company);
    if (k) byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const out = new Map<string, PartnerPayment>();
  for (const l of lines) {
    if (!settled(l) || l.amount_cents >= 0 || !l.posted_on || namesAxalEntity(l.counterparty_name)) continue;
    const hits = byName.get(normalizeEntityName(l.counterparty_name));
    if (!hits || hits.length !== 1) continue;
    const p = hits[0];
    const e = out.get(p.uid) ?? { partner_uid: p.uid, company: p.company, paid_cents: 0, payments: 0, since: l.posted_on };
    e.paid_cents -= l.amount_cents;
    e.payments += 1;
    if (l.posted_on < e.since) e.since = l.posted_on;
    out.set(p.uid, e);
  }
  return [...out.values()].sort((a, b) => b.paid_cents - a.paid_cents || a.partner_uid.localeCompare(b.partner_uid));
}

// ═════════════════════════════════════════════════════════════ the read

/** At most this many 1,000-line pages of transactions are read; more marks the read capped. */
export const GROW_TX_PAGES = 3;
const GROW_TX_LIMIT = 1000;

/** UNVERIFIED (D840.md): Mercury's invoice statuses, by what Grow counts them as. */
export function invoiceState(status: string | null): InvoiceState {
  const s = String(status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'paid') return 'paid';
  if (s === 'overdue' || s === 'past_due') return 'overdue';
  if (s === 'open' || s === 'unpaid' || s === 'sent' || s === 'pending' || s === 'outstanding') return 'open';
  return 'other';
}

/** A Mercury invoice as Grow reads it, named by its customer. */
export function toGrowInvoice(i: Invoice, customers: Map<string, string | null>): GrowInvoice | null {
  if (i.amount_cents == null) return null;
  return {
    id: i.id, amount_cents: i.amount_cents, state: invoiceState(i.status),
    customer_name: i.customer_id ? customers.get(i.customer_id) ?? null : null,
    issued_on: i.issued_on, due_on: i.due_on, paid_on: null, recurring: false,
  };
}

/** A Mercury line as Grow reads it; `financing` when it names an Axal entity or is a confirmed raise receipt. */
export function toGrowLine(t: McpTransaction, receipts: Set<string>): GrowLine {
  const status = String(t.status ?? '');
  return {
    transaction_id: t.mercury_transaction_id, amount_cents: t.amount_cents, posted_on: t.posted_on, created_on: t.created_on,
    posted: POSTED_STATUSES.includes(status) && !!t.posted_on, internal: INTERNAL_KINDS.includes(String(t.kind ?? '')),
    voided: VOID_STATUSES.includes(status), counterparty_name: t.counterparty_name, category: t.category,
    financing: namesAxalEntity(t.counterparty_name) || receipts.has(t.mercury_transaction_id),
  };
}

/**
 * Everything one Grow sync needs, through part 1's typed reads: the accounts,
 * the lines posted since the first of GROW_MONTHS full months ago, treasury,
 * and invoices with their customers' names. Invoices or treasury Mercury does
 * not answer are left out (null), never read as none.
 */
export async function readGrow(env: Env, reads: MercuryReads, founderUserId: number, today: string): Promise<GrowRead> {
  const accounts = await reads.accounts();
  const lines: McpTransaction[] = [];
  let next: string | null = null; let capped = false;
  for (let page = 0; page < GROW_TX_PAGES; page += 1) {
    const out = await reads.transactions({ postedStart: `${fullMonths(today)[0]}-01`, postedEnd: today, limit: GROW_TX_LIMIT, startAfter: next });
    lines.push(...out.transactions);
    next = out.next;
    if (!next) break;
    if (page === GROW_TX_PAGES - 1) capped = true;
  }
  const receipts = await raiseReceiptIds(env, founderUserId, lines.map((l) => l.mercury_transaction_id));
  const offered = new Set(reads.offered);
  let treasury: number | null = null;
  if (offered.has('getTreasury')) {
    const t = await reads.treasury();
    const known = t.filter((a) => a.available_cents != null);
    treasury = known.length ? known.reduce((n, a) => n + (a.available_cents as number), 0) : null;
  }
  let invoices: GrowInvoice[] | null = null;
  if (offered.has('listInvoices')) {
    const list = await reads.invoices();
    const customers: Customer[] = offered.has('listCustomers') ? await reads.customers() : [];
    const names = new Map(customers.map((c) => [c.id, c.name]));
    invoices = list.map((i) => toGrowInvoice(i, names)).filter((i): i is GrowInvoice => i != null);
  }
  return {
    lines: lines.map((l) => toGrowLine(l, receipts)), capped,
    accounts: accounts.map((a) => ({ kind: a.kind, available_cents: a.available_cents })),
    treasury_cents: treasury, invoices,
  };
}

// ═════════════════════════════════════════════════════════════ the landings

/** What one Grow sync read, already parsed. `invoices` is null when Mercury gave none to read. */
export interface GrowRead {
  lines: GrowLine[];
  capped: boolean;
  accounts: GrowAccount[];
  treasury_cents: number | null;
  invoices: GrowInvoice[] | null;
}

export interface GrowProject { id: number; founder_user_id: number }

type Ledger = { local_table: string | null; local_id: number | null };

const LEDGER_OF = `SELECT local_table, local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?`;
const LEDGER_LINK = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, local_table = excluded.local_table,
       local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;
const LEDGER_TOUCH = `UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?`;
const LEDGER_UNLINK = `UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ? AND external_id = ?`;

/** Tables a landing may link, so a table name never comes from data. */
const LANDING_TABLES = new Set(['project_metrics', 'mercury_grow_facts', 'revenue_entries', 'growth_partners']);

/**
 * The ledger's word on one external item: `deleted` when the founder deleted
 * its row (it is never re-created: the ledger keeps the row with no
 * `local_id`), `linked` with the row to update, or `new`.
 */
export async function ledgerState(env: Env, integrationId: number, externalId: string, projectId: number):
  Promise<{ state: 'new' } | { state: 'deleted' } | { state: 'linked'; id: number }> {
  const l = await env.DB.prepare(LEDGER_OF).bind(integrationId, externalId).first<Ledger>();
  if (!l) return { state: 'new' };
  if (l.local_id == null || !l.local_table || !LANDING_TABLES.has(l.local_table)) return { state: 'deleted' };
  const alive = await env.DB.prepare(`SELECT 1 FROM ${l.local_table} WHERE id = ? AND project_id = ?`).bind(l.local_id, projectId).first();
  if (alive) return { state: 'linked', id: Number(l.local_id) };
  await env.DB.prepare(LEDGER_UNLINK).bind(integrationId, externalId).run();
  return { state: 'deleted' };
}

export interface GrowCounts {
  metric_months: number;
  invoice_credits: number;
  facts: number;
  partner_proposals: number;
  kept_deleted: number;
  partial: boolean;
}

const FACT_MODULE: Record<string, string> = {
  cash: 'durable_company_building', treasury: 'durable_company_building', runway: 'durable_company_building',
  payroll: 'team_expansion', marketing_spend: 'distribution', channel_spend: 'distribution',
  invoices_paid: 'revenue_and_traction', invoices_open: 'revenue_and_traction', invoices_overdue: 'revenue_and_traction',
};
export type FactKind = keyof typeof FACT_MODULE;

interface Fact { kind: FactKind; period: string; subject?: string; amount_cents?: number | null; count?: number | null; value?: number | null; note?: string | null }

/** One fact through the ledger: written, updated, or (deleted by the founder) left deleted. */
async function landFact(env: Env, integrationId: number, projectId: number, f: Fact, asOf: string, counts: GrowCounts): Promise<void> {
  const subject = f.subject ?? '';
  const externalId = `grow:${f.kind}:${projectId}:${f.period}${subject ? `:${subject}` : ''}`;
  const module = FACT_MODULE[f.kind];
  const known = await ledgerState(env, integrationId, externalId, projectId);
  const vals = [f.amount_cents ?? null, f.count ?? null, f.value ?? null, f.note ?? null, asOf];
  if (known.state === 'deleted') {
    await env.DB.prepare(LEDGER_TOUCH).bind(integrationId, externalId).run();
    counts.kept_deleted += 1;
    return;
  }
  if (known.state === 'linked') {
    await env.DB.batch([
      env.DB.prepare(`UPDATE mercury_grow_facts SET amount_cents = ?, count = ?, value = ?, note = ?, as_of = ?, integration_id = ?, updated_at = datetime('now')
        WHERE id = ? AND project_id = ?`).bind(...vals, integrationId, known.id, projectId),
      env.DB.prepare(LEDGER_TOUCH).bind(integrationId, externalId),
    ]);
  } else {
    const row = await env.DB.prepare(
      `INSERT INTO mercury_grow_facts (integration_id, project_id, module, kind, period, subject, amount_cents, count, value, note, as_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, kind, period, subject) DO UPDATE SET integration_id = excluded.integration_id, amount_cents = excluded.amount_cents,
         count = excluded.count, value = excluded.value, note = excluded.note, as_of = excluded.as_of, updated_at = datetime('now')
       RETURNING id`,
    ).bind(integrationId, projectId, module, f.kind, f.period, subject, ...vals).first<{ id: number }>();
    await env.DB.prepare(LEDGER_LINK).bind(integrationId, projectId, module, f.kind, externalId, 'mercury_grow_facts', row?.id ?? null).run();
  }
  counts.facts += 1;
}

const dollars = (cents: number | null) => (cents == null ? null : cents / 100);

/** Revenue and traction's monthly snapshot: one `mercury` row per full month with a posted line. */
async function landMonths(env: Env, integrationId: number, p: GrowProject, months: RevenueMonth[], today: string, counts: GrowCounts): Promise<void> {
  for (const m of months) {
    if (m.cash_in_cents == null && m.net_burn_cents == null) continue;
    const externalId = `grow:metric_month:${p.id}:${m.month}`;
    const known = await ledgerState(env, integrationId, externalId, p.id);
    if (known.state === 'deleted') {
      await env.DB.prepare(LEDGER_TOUCH).bind(integrationId, externalId).run();
      counts.kept_deleted += 1;
      continue;
    }
    const notes = `Money in and net burn for ${m.month}, read from your Mercury on ${today}.`;
    if (known.state === 'linked') {
      await env.DB.batch([
        env.DB.prepare(`UPDATE project_metrics SET cash_in = ?, net_burn = ?, notes = ? WHERE id = ? AND project_id = ?`)
          .bind(dollars(m.cash_in_cents), dollars(m.net_burn_cents), notes, known.id, p.id),
        env.DB.prepare(LEDGER_TOUCH).bind(integrationId, externalId),
      ]);
    } else {
      const row = await env.DB.prepare(
        `INSERT INTO project_metrics (project_id, snapshot_date, cash_in, net_burn, notes, source, created_by)
           VALUES (?, ?, ?, ?, ?, 'mercury', ?)
         ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET cash_in = excluded.cash_in, net_burn = excluded.net_burn, notes = excluded.notes
         RETURNING id`,
      ).bind(p.id, monthEnd(m.month), dollars(m.cash_in_cents), dollars(m.net_burn_cents), notes, p.founder_user_id).first<{ id: number }>();
      await env.DB.prepare(LEDGER_LINK).bind(integrationId, p.id, 'revenue_and_traction', 'metric_month', externalId, 'project_metrics', row?.id ?? null).run();
    }
    counts.metric_months += 1;
  }
}

/**
 * A credit that matches exactly one paid invoice lands as a revenue entry,
 * with the invoice's customer, under D713's rules (`mercuryCreditToEntry`):
 * the same refusals, the same one-row-per-line index and the same ledger kind,
 * so D713's pick lists it as already imported.
 */
async function landInvoiceCredits(env: Env, integrationId: number, p: GrowProject, read: GrowRead, counts: GrowCounts): Promise<void> {
  if (!read.invoices) return;
  const matches = matchPaidInvoices(read.lines, read.invoices);
  if (!matches.size) return;
  const ids = [...matches.keys()];
  const imported = new Map<string, number>();
  for (const r of (await env.DB.prepare(
    "SELECT source_ref, project_id FROM revenue_entries WHERE source = 'mercury' AND source_ref IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(ids)).all<{ source_ref: string; project_id: number }>()).results || []) imported.set(r.source_ref, Number(r.project_id));
  const stripe = !!(await env.DB.prepare(
    `SELECT 1 AS y FROM revenue_entries WHERE project_id = ? AND source = 'stripe'
     UNION ALL SELECT 1 FROM integrations WHERE user_id = ? AND provider_key = 'stripe' AND status = 'active' LIMIT 1`,
  ).bind(p.id, p.founder_user_id).first());
  const receipts = await raiseReceiptIds(env, p.founder_user_id, ids);
  const verification = verificationFor({ source: 'mercury', proof_document_id: null });
  const batch = crypto.randomUUID();
  let wrote = 0;
  for (const l of read.lines) {
    const inv = matches.get(l.transaction_id);
    if (!inv) continue;
    const known = await ledgerState(env, integrationId, l.transaction_id, p.id);
    if (known.state === 'deleted') { counts.kept_deleted += 1; continue; }
    if (known.state === 'linked') continue;
    const at = imported.get(l.transaction_id);
    const out = mercuryCreditToEntry({
      transaction_id: l.transaction_id, amount_cents: l.amount_cents, posted_on: l.posted_on, posted: l.posted, internal: l.internal,
      voided: l.voided, axal_counterparty: namesAxalEntity(l.counterparty_name), stripe_counterparty: namesStripe(l.counterparty_name),
    }, { stripeActive: stripe, importedHere: at === p.id, importedElsewhere: at != null && at !== p.id, raiseReceipt: receipts.has(l.transaction_id) });
    if (out.kind !== 'entry') continue;
    const customer = (inv.customer_name ?? '').trim().slice(0, 200) || 'Mercury invoice customer';
    const uid = crypto.randomUUID();
    const r = await env.DB.prepare(MERCURY_INSERT).bind(uid, p.id, customer, out.entry.amount_cents, LEDGER_CURRENCY,
      inv.recurring ? 'recurring' : 'one_time', out.entry.received_on, out.entry.source_ref, verification, batch, p.founder_user_id, out.entry.source_ref).run();
    if (!Number(r.meta?.changes ?? 0)) continue;
    const row = await env.DB.prepare('SELECT id FROM revenue_entries WHERE uid = ?').bind(uid).first<{ id: number }>();
    await env.DB.prepare(LEDGER_LINK).bind(integrationId, p.id, 'revenue_and_traction', 'credit', out.entry.source_ref, 'revenue_entries', row?.id ?? null).run();
    wrote += 1;
  }
  counts.invoice_credits += wrote;
  if (wrote) {
    try { await recomputeRevenueMovements(env, p.id); }
    catch (e) { console.error('[growFeeds] movements not rewritten:', (e as Error).name); }
  }
}

/** Partner payments become proposals; a dismissed one stays dismissed, an accepted one keeps its link. */
async function landPartnerProposals(env: Env, integrationId: number, p: GrowProject, payments: PartnerPayment[], today: string, counts: GrowCounts): Promise<void> {
  for (const pay of payments) {
    await env.DB.prepare(
      `INSERT INTO mercury_partner_proposals (integration_id, project_id, partner_uid, partner_company, paid_cents, payments, since, as_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, partner_uid) DO UPDATE SET integration_id = excluded.integration_id, partner_company = excluded.partner_company,
         paid_cents = excluded.paid_cents, payments = excluded.payments, since = excluded.since, as_of = excluded.as_of, updated_at = datetime('now')`,
    ).bind(integrationId, p.id, pay.partner_uid, pay.company.slice(0, 200), pay.paid_cents, pay.payments, pay.since, today).run();
    counts.partner_proposals += 1;
  }
}

/** The project's channels and the Axal partners whose company a payee may name. */
async function landingContext(env: Env, projectId: number): Promise<{ channels: GrowChannel[]; partners: AxalPartner[] }> {
  const channels = ((await env.DB.prepare('SELECT uid, name, utm_source FROM growth_channels WHERE project_id = ?').bind(projectId)
    .all<GrowChannel>()).results || []);
  const partners = ((await env.DB.prepare(
    `SELECT uid, company FROM partners WHERE status = 'active' AND company IS NOT NULL AND length(trim(company)) > 0`,
  ).all<AxalPartner>()).results || []);
  return { channels, partners };
}

/**
 * The founder's Grow sync: every landing above, from one read. Returns counts
 * only, never a figure: the route logs them.
 */
export async function landGrow(env: Env, integrationId: number, p: GrowProject, read: GrowRead, today: string): Promise<GrowCounts> {
  const counts: GrowCounts = { metric_months: 0, invoice_credits: 0, facts: 0, partner_proposals: 0, kept_deleted: 0, partial: read.capped };
  const months = fullMonths(today);
  const { channels, partners } = await landingContext(env, p.id);
  // A read Mercury capped is missing lines: no month, spend or payment total is written from it.
  if (!read.capped) {
    await landMonths(env, integrationId, p, revenueMonths(read.lines, months), today, counts);
    for (const r of debitsByMonth(read.lines, months, isPayroll)) {
      if (r.cents != null) await landFact(env, integrationId, p.id, { kind: 'payroll', period: r.month, amount_cents: r.cents }, today, counts);
    }
    for (const r of debitsByMonth(read.lines, months, isMarketing)) {
      if (r.cents != null) await landFact(env, integrationId, p.id, { kind: 'marketing_spend', period: r.month, amount_cents: r.cents }, today, counts);
    }
    for (const r of channelSpend(read.lines, months, channels)) {
      await landFact(env, integrationId, p.id, { kind: 'channel_spend', period: r.month, subject: r.channel_uid, amount_cents: r.cents }, today, counts);
    }
    await landPartnerProposals(env, integrationId, p, partnerPayments(read.lines, partners), today, counts);
  }
  await landInvoiceCredits(env, integrationId, p, read, counts);
  if (read.invoices) {
    for (const t of invoiceTally(read.invoices, today)) {
      await landFact(env, integrationId, p.id, { kind: `invoices_${t.state}` as FactKind, period: 'current', amount_cents: t.amount_cents, count: t.count }, today, counts);
    }
  }
  const cash = cashFacts(read.lines, read.accounts, read.treasury_cents, today, read.capped);
  if (cash.cash_cents != null) await landFact(env, integrationId, p.id, { kind: 'cash', period: 'current', amount_cents: cash.cash_cents }, today, counts);
  if (cash.treasury_cents != null) await landFact(env, integrationId, p.id, { kind: 'treasury', period: 'current', amount_cents: cash.treasury_cents }, today, counts);
  await landFact(env, integrationId, p.id, {
    kind: 'runway', period: 'current', value: cash.runway_months, amount_cents: cash.average_net_burn_cents, note: cash.runway_reason,
  }, today, counts);
  return counts;
}

// ═════════════════════════════════════════════════════════════ the reads

/**
 * Whether the viewer is on the founder's company: its founder, or a member
 * linked to its company. Nobody else — an admin, a partner, an advisor, an
 * investor — sees a Mercury figure, whatever they may read of the venture.
 */
export async function isTeamViewer(env: Env, viewer: { id: number; founder_id?: number | null }, projectId: number): Promise<boolean> {
  const p = await env.DB.prepare('SELECT founder_id, company_id FROM projects WHERE id = ?').bind(projectId)
    .first<{ founder_id: number | null; company_id: number | null }>();
  if (!p) return false;
  if (p.founder_id != null && viewer.founder_id != null && Number(viewer.founder_id) === Number(p.founder_id)) return true;
  if (p.company_id == null) return false;
  return !!(await env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(p.company_id, viewer.id).first());
}

/** Whether the viewer is the venture's founder, whose Mercury it is: only they decide what it proposes. */
export async function isVentureFounder(env: Env, viewer: { founder_id?: number | null }, projectId: number): Promise<boolean> {
  if (viewer.founder_id == null) return false;
  return !!(await env.DB.prepare('SELECT 1 FROM projects WHERE id = ? AND founder_id IS NOT NULL AND founder_id = ?')
    .bind(projectId, viewer.founder_id).first());
}

export const TEAM_ONLY = 'From the founder\'s Mercury: only the venture\'s team sees these figures.';
export const NOT_SYNCED = 'Not recorded: the founder has not synced their Mercury into Grow yet.';

export type GrowFeedSlug = 'revenue-and-traction' | 'durable-company-building' | 'team-expansion' | 'distribution' | 'partner-network';
export const GROW_FEED_SLUGS: readonly GrowFeedSlug[] = ['revenue-and-traction', 'durable-company-building', 'team-expansion', 'distribution', 'partner-network'];

interface FactRow { id: number; kind: string; period: string; subject: string; amount_cents: number | null; count: number | null; value: number | null; note: string | null; as_of: string }

async function facts(env: Env, projectId: number, kinds: string[]): Promise<FactRow[]> {
  return (await env.DB.prepare(
    `SELECT id, kind, period, subject, amount_cents, count, value, note, as_of FROM mercury_grow_facts
      WHERE project_id = ? AND kind IN (SELECT value FROM json_each(?)) ORDER BY kind, period, subject`,
  ).bind(projectId, JSON.stringify(kinds)).all<FactRow>()).results || [];
}

const fromMercury = (asOf: string | null) => (asOf ? `From Mercury, as of ${asOf}` : null);
const latestAsOf = (rows: Array<{ as_of: string }>) => rows.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null);
const monthly = (rows: FactRow[]) => rows.map((r) => ({ id: r.id, month: r.period, cents: r.amount_cents }));

/** The headcount the team roster records, as the Grow figures count it. */
async function headcount(env: Env, projectId: number): Promise<number | null> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM company_people cp JOIN projects p ON p.company_id = cp.company_id
      WHERE p.id = ? AND cp.status = 'active' AND cp.person_type = 'employee'`,
  ).bind(projectId).first<{ n: number }>();
  return r ? Number(r.n) : null;
}

/** Each channel's customers in a month, by UTM source, as `channelRows` counts them. */
async function customersByChannel(env: Env, projectId: number, month: string): Promise<Map<string, number>> {
  const rows = (await env.DB.prepare(
    `SELECT g.uid, g.utm_source, (SELECT COUNT(*) FROM contacts c WHERE c.project_id = g.project_id AND c.audience = 'customer'
         AND c.utm_json IS NOT NULL AND substr(c.created_at, 1, 7) = ? AND lower(trim(json_extract(c.utm_json, '$.utm_source'))) = lower(trim(g.utm_source))) AS n
       FROM growth_channels g WHERE g.project_id = ?`,
  ).bind(month, projectId).all<{ uid: string; utm_source: string | null; n: number }>()).results || [];
  return new Map(rows.map((r) => [r.uid, Number(r.n)]));
}

/**
 * The Mercury part of one Grow module, for one viewer. Anyone outside the
 * founder's company gets only `team_only` and the sentence; the team gets the
 * facts, each with "From Mercury, as of <date>". The partner proposals carry
 * Accept and Dismiss only for the founder, whose Mercury it is.
 */
export async function growFromMercury(env: Env, projectId: number, slug: GrowFeedSlug, viewer: { id: number; founder_id?: number | null }, today: string) {
  const team = await isTeamViewer(env, viewer, projectId);
  if (!team) return { state: 'team_only' as const, reason: TEAM_ONLY };
  if (slug === 'revenue-and-traction') {
    const months = ((await env.DB.prepare(
      `SELECT m.id, substr(m.snapshot_date, 1, 7) AS month, m.cash_in, m.net_burn FROM project_metrics m
         JOIN connector_fed_items f ON f.local_table = 'project_metrics' AND f.local_id = m.id AND f.kind = 'metric_month'
        WHERE m.project_id = ? AND m.source = 'mercury' ORDER BY m.snapshot_date`,
    ).bind(projectId).all<{ id: number; month: string; cash_in: number | null; net_burn: number | null }>()).results || [])
      .map((m) => ({ id: m.id, month: m.month, cash_in_cents: m.cash_in == null ? null : Math.round(m.cash_in * 100), net_burn_cents: m.net_burn == null ? null : Math.round(m.net_burn * 100) }));
    const inv = await facts(env, projectId, ['invoices_paid', 'invoices_open', 'invoices_overdue']);
    const landed = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM connector_fed_items f JOIN revenue_entries e ON e.id = f.local_id AND f.local_table = 'revenue_entries'
        WHERE f.project_id = ? AND f.kind = 'credit' AND e.import_batch IS NOT NULL AND e.created_by IS NOT NULL`,
    ).bind(projectId).first<{ n: number }>();
    if (!months.length && !inv.length) return { state: 'not_recorded' as const, reason: NOT_SYNCED };
    return {
      state: 'ok' as const, months,
      invoices: inv.map((r) => ({ id: r.id, state: r.kind.replace('invoices_', ''), count: r.count, amount_cents: r.amount_cents })),
      invoices_reason: inv.length ? null : 'Not recorded: Mercury gave no invoices to read',
      credits_from_mercury: Number(landed?.n ?? 0),
      source: fromMercury(latestAsOf([...inv, ...(months.length ? [{ as_of: months[months.length - 1].month }] : [])])),
    };
  }
  if (slug === 'durable-company-building') {
    const rows = await facts(env, projectId, ['cash', 'treasury', 'runway']);
    if (!rows.length) return { state: 'not_recorded' as const, reason: NOT_SYNCED };
    const one = (k: string) => rows.find((r) => r.kind === k) ?? null;
    const cash = one('cash'), treasury = one('treasury'), runway = one('runway');
    return {
      state: 'ok' as const,
      cash: cash ? { id: cash.id, cents: cash.amount_cents, source: fromMercury(cash.as_of) } : null,
      treasury: treasury ? { id: treasury.id, cents: treasury.amount_cents, source: fromMercury(treasury.as_of) } : null,
      runway: runway ? { id: runway.id, months: runway.value, reason: runway.value == null ? runway.note ?? 'Not recorded' : null, source: fromMercury(runway.as_of) } : null,
      source: fromMercury(latestAsOf(rows)),
    };
  }
  if (slug === 'team-expansion') {
    const payroll = await facts(env, projectId, ['payroll']);
    const cashRows = await facts(env, projectId, ['cash', 'runway']);
    if (!payroll.length && !cashRows.length) return { state: 'not_recorded' as const, reason: NOT_SYNCED };
    const last = fullMonths(today, 1)[0];
    const cash = cashRows.find((r) => r.kind === 'cash'), runway = cashRows.find((r) => r.kind === 'runway');
    const hires = hiresAffordable({
      cash_cents: cash?.amount_cents ?? null,
      average_net_burn_cents: runway?.value != null || runway?.amount_cents != null ? runway?.amount_cents ?? null : null,
      payroll_cents: payroll.find((r) => r.period === last)?.amount_cents ?? null,
      headcount: await headcount(env, projectId),
    });
    return {
      state: 'ok' as const, payroll: monthly(payroll),
      hires_affordable: { ...hires, kind: 'computed', keeps_runway_months: HIRE_RUNWAY_MONTHS,
        words: 'A computed figure, not a plan: people at last month\'s payroll cost per head that fit while keeping twelve months of runway.' },
      source: fromMercury(latestAsOf([...payroll, ...cashRows])),
    };
  }
  if (slug === 'distribution') {
    const rows = await facts(env, projectId, ['marketing_spend', 'channel_spend']);
    if (!rows.length) return { state: 'not_recorded' as const, reason: NOT_SYNCED };
    const last = fullMonths(today, 1)[0];
    const customers = await customersByChannel(env, projectId, last);
    const names = new Map(((await env.DB.prepare('SELECT uid, name FROM growth_channels WHERE project_id = ?').bind(projectId)
      .all<{ uid: string; name: string }>()).results || []).map((c) => [c.uid, c.name]));
    const channels = rows.filter((r) => r.kind === 'channel_spend' && r.period === last && names.has(r.subject)).map((r) => {
      const n = customers.get(r.subject) ?? 0;
      return { id: r.id, channel_uid: r.subject, name: names.get(r.subject)!, month: r.period, spend_cents: r.amount_cents, customers: n,
        cac_cents: n > 0 && r.amount_cents != null ? Math.round(r.amount_cents / n) : null,
        cac_reason: n > 0 ? null : 'Not recorded: no customer attributed to this channel that month' };
    });
    return { state: 'ok' as const, spend: monthly(rows.filter((r) => r.kind === 'marketing_spend')), month: last, channels, source: fromMercury(latestAsOf(rows)) };
  }
  // partner-network
  const proposals = ((await env.DB.prepare(
    `SELECT pr.id, pr.partner_uid, pr.partner_company, pr.paid_cents, pr.payments, pr.since, pr.as_of, pr.state, g.uid AS growth_partner_uid, g.name AS growth_partner_name
       FROM mercury_partner_proposals pr LEFT JOIN growth_partners g ON g.id = pr.growth_partner_id AND g.project_id = pr.project_id
      WHERE pr.project_id = ? AND pr.state IN ('pending', 'accepted') ORDER BY pr.state DESC, pr.paid_cents DESC, pr.id`,
  ).bind(projectId).all<Record<string, unknown>>()).results || []);
  const founder = await isVentureFounder(env, viewer, projectId);
  if (!proposals.length) return { state: 'not_recorded' as const, reason: NOT_SYNCED };
  return {
    state: 'ok' as const, can_decide: !!founder,
    proposals: proposals.map((r) => ({ ...r, source: fromMercury(String(r.as_of)),
      sentence: r.state === 'pending' ? `You paid ${r.partner_company} $${(Number(r.paid_cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} since ${r.since}: link to this partnership?` : null })),
  };
}

// ═════════════════════════════════════════════════════════════ the decisions

export type DecideOutcome = 'ok' | 'not_found' | 'decided' | 'unknown_partner';

/**
 * The founder accepts a partner proposal: it links one `growth_partners` row
 * — the one named, or a new one under the partner's company — through the
 * ledger. Nothing is linked before this. `extra` is the activity line.
 */
export async function acceptPartnerProposal(env: Env, projectId: number, id: number, body: { growth_partner_uid?: unknown }, userId: number,
  create: (name: string) => Promise<string>, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const pr = await env.DB.prepare('SELECT id, integration_id, partner_uid, partner_company, state FROM mercury_partner_proposals WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<{ id: number; integration_id: number; partner_uid: string; partner_company: string; state: string }>();
  if (!pr) return 'not_found';
  if (pr.state !== 'pending') return 'decided';
  let gp: { id: number } | null = null;
  if (typeof body.growth_partner_uid === 'string' && body.growth_partner_uid) {
    gp = await env.DB.prepare('SELECT id FROM growth_partners WHERE uid = ? AND project_id = ?').bind(body.growth_partner_uid, projectId).first<{ id: number }>();
    if (!gp) return 'unknown_partner';
  } else {
    const uid = await create(pr.partner_company);
    gp = await env.DB.prepare('SELECT id FROM growth_partners WHERE uid = ? AND project_id = ?').bind(uid, projectId).first<{ id: number }>();
    if (!gp) return 'unknown_partner';
  }
  const r = await env.DB.prepare(
    `UPDATE mercury_partner_proposals SET state = 'accepted', growth_partner_id = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND state = 'pending'`,
  ).bind(gp.id, userId, id, projectId).run();
  if (!Number(r.meta?.changes ?? 0)) return 'decided';
  await env.DB.batch([
    env.DB.prepare(LEDGER_LINK).bind(pr.integration_id, projectId, 'partner_network', 'partner_payment', `grow:partner:${projectId}:${pr.partner_uid}`, 'growth_partners', gp.id),
    ...extra,
  ]);
  return 'ok';
}

/** The founder dismisses a partner proposal; it stays dismissed through every later sync. */
export async function dismissPartnerProposal(env: Env, projectId: number, id: number, userId: number, extra: D1PreparedStatement[] = []): Promise<DecideOutcome> {
  const r = await env.DB.prepare(
    `UPDATE mercury_partner_proposals SET state = 'dismissed', decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND state = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (Number(r.meta?.changes ?? 0)) {
    if (extra.length) await env.DB.batch(extra);
    return 'ok';
  }
  const pr = await env.DB.prepare('SELECT 1 FROM mercury_partner_proposals WHERE id = ? AND project_id = ?').bind(id, projectId).first();
  return pr ? 'decided' : 'not_found';
}

const SLUG_OF: Record<string, GrowFeedSlug> = {
  revenue_and_traction: 'revenue-and-traction', durable_company_building: 'durable-company-building',
  team_expansion: 'team-expansion', distribution: 'distribution',
};

/** A team member deletes a Mercury fact; the ledger keeps it deleted through every later sync. Its module's slug, or null when none was deleted. */
export async function deleteGrowFact(env: Env, projectId: number, id: number, extra: D1PreparedStatement[] = []): Promise<GrowFeedSlug | null> {
  const row = await env.DB.prepare('DELETE FROM mercury_grow_facts WHERE id = ? AND project_id = ? RETURNING module').bind(id, projectId).first<{ module: string }>();
  if (!row) return null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND local_table = 'mercury_grow_facts' AND local_id = ?`).bind(projectId, id),
    ...extra,
  ]);
  return SLUG_OF[row.module] ?? 'revenue-and-traction';
}
