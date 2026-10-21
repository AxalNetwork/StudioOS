/**
 * D840 part 2 (#2347) — the founder's own Mercury feeds their Raise modules.
 * READ-ONLY: every read goes through `RaiseReads`, which `raiseReadsOf` binds
 * to part 1's MCP reads (`reads.ts`), so only the allowlisted read tools are
 * ever called.
 *
 * FACTS ARE WRITTEN; JUDGEMENT IS PROPOSED (D782).
 *
 * | Module                 | From Mercury                                  | Lands as |
 * | ---------------------- | --------------------------------------------- | -------- |
 * | Fundraising readiness  | cash and the last 3 full months' net burn     | fact `runway`: "Runway: N months at the last 3 months' burn" |
 * | Use of funds           | spend by Mercury category, last 3, 6, 12 mo.  | facts `spend:<m>:<category>`; a category → section mapping is a proposal |
 * | Data room              | the last 12 monthly statements (PDF)          | proposals; an accepted one is a data-room file, NDA, seen by nobody until the founder opens it |
 * | Cap table              | SAFE requests                                 | proposals; an accepted one is an Investors · SAFE entry |
 * | Capital relationships  | incoming wires and ACH credits ≥ $10,000      | proposals: a match to a prospect, or a new investor |
 * | Investor narrative, Pitch deck | monthly revenue credits, burn, runway | facts `revenue:<YYYY-MM>` and `revenue:growth`, offered as citable figures, never typed into text |
 *
 * EVERY ROW GOES THROUGH THE LEDGER (`connector_fed_items`, D655). A fact's
 * ledger row is `raise:<project>:<fact_key>` (a revenue fact also has
 * `raise:<project>:deck:<fact_key>`, in Pitch deck); an accepted proposal's is
 * `raise:<project>:<kind>:<source_key>`. A fact the founder deleted keeps its
 * ledger row with no `local_id`, and a re-sync never writes it back. A
 * proposal is proposed once: a decided one is never proposed again, and a
 * pending one is refreshed.
 *
 * ONLY THE FOUNDER'S OWN DATA, ONLY ON THEIR OWN PAGES. Every read here is
 * keyed by the connection (`integration_id`) and the project; the route
 * passes only the founder's own connection, for a project of their own.
 *
 * NO MERCURY FIGURE IS EVER LOGGED. A sync's log row holds counts; an error
 * names its module and a code, never an amount, a name or a date.
 */
import type { Env, User } from '../../types';
import { FUND_SECTIONS, type ModuleSlug } from '../raiseCycle';
import { normalizeEntityName, namesAxalEntity } from '../../integrations/providers/mercury';
import { addHolder } from '../capTableWrites';
import { createProspect } from '../../routes/contacts';
import { logCycleWrite } from '../cycleActivity';
import { cashNow } from '../mercurySpend';
import { INTERNAL_KINDS, POSTED_STATUSES, VOID_STATUSES } from './parse';
import type { CashflowMonth, MercuryReads } from './reads';

// ───────────────────────────────────────────────────────────── the reads

/** One bank line, as the Raise readers need it. */
export interface RaiseLine {
  id: string;
  amount_cents: number;
  posted_on: string | null;
  kind: string | null;
  counterparty: string | null;
  category: string | null;
  last_four: string | null;
  posted: boolean;
  internal: boolean;
  voided: boolean;
}

export interface RaiseStatement { id: string; account_id: string; month: string; last_four: string | null }
export interface RaiseSafe {
  id: string;
  investor_name: string | null;
  amount_cents: number | null;
  cap_cents: number | null;
  discount_pct: number | null;
  status: string | null;
  date: string | null;
}

/** What the Raise readers read from Mercury. Every method is a read; none can move money. */
export interface RaiseReads {
  /** Cash across the checking and savings accounts (null when none could be read), and the cashflow summary's months. */
  cashflow(): Promise<{ cash_cents: number | null; months: CashflowMonth[] }>;
  /** The lines posted in [from, to], oldest first, and whether a cap cut them short. */
  lines(from: string, to: string): Promise<{ lines: RaiseLine[]; capped: boolean }>;
  /** The monthly statements Mercury lists, any order. */
  statements(): Promise<RaiseStatement[]>;
  /** One statement's PDF, or null when Mercury no longer serves it. */
  statementPdf(accountId: string, id: string): Promise<{ bytes: Uint8Array; content_type: string } | null>;
  /** The organization's SAFE requests. */
  safes(): Promise<RaiseSafe[]>;
}

// ───────────────────────────────────────────────────────────── the rules

export const RUNWAY_MONTHS = 3;
export const SPEND_WINDOWS = [3, 6, 12] as const;
export const REVENUE_MONTHS = 6;
export const MAX_STATEMENTS = 12;
/** A credit looks like investment at $10,000 or more, by wire or ACH. */
export const MIN_INVESTMENT_CENTS = 1_000_000;
/** UNVERIFIED: the kinds Mercury gives an incoming wire, domestic or international, and an ACH credit. */
export const INVESTMENT_KINDS = ['incomingDomesticWire', 'incomingInternationalWire', 'externalTransfer'];
export const UNCATEGORIZED = 'Uncategorized';
/** Accepted statements are the founder's own: NDA, and seen by no investor until the founder opens them. */
export const STATEMENT_ACCESS = { visibility: 'nda', access_tier: 'nobody', checklist_item: 'financial_statements' } as const;
export const MAX_STATEMENT_BYTES = 20 * 1024 * 1024;

export const FACT_MODULE = { runway: 'fundraising_readiness', spend: 'use_of_funds', revenue: 'investor_narrative' } as const;
export const PROPOSAL_MODULE = {
  fund_mapping: 'use_of_funds', statement: 'data_room', safe: 'cap_table', investor_credit: 'capital_relationships',
} as const;
export type FactKind = keyof typeof FACT_MODULE;
export type ProposalKind = keyof typeof PROPOSAL_MODULE;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
export const SECTION_KEYS: readonly string[] = FUND_SECTIONS.map((s) => s.key);

/** The first day of `month` months before `today`'s month, and the last day of the month before `today`'s. */
export function fullMonths(today: string, months: number): { from: string; to: string; list: string[] } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  const list: string[] = [];
  for (let k = months; k >= 1; k -= 1) {
    const d = new Date(Date.UTC(y, m - k, 1));
    list.push(d.toISOString().slice(0, 7));
  }
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${list[0]}-01`, to: last, list };
}

const counted = (l: RaiseLine) => l.posted && !l.internal && !l.voided && !!l.posted_on && DAY.test(l.posted_on);

/**
 * Runway: cash over the average monthly net burn of the last 3 full months in
 * Mercury's cashflow summary. Not recorded when one of those months is
 * missing or cash could not be read; no months when nothing burns.
 */
export function runwayFact(cash: number | null, months: CashflowMonth[], today: string) {
  const span = fullMonths(today, RUNWAY_MONTHS);
  const got = span.list.map((m) => months.find((x) => x.month === m));
  if (got.some((m) => !m)) return { cash_cents: cash, burn_cents: null, months: null, label: RUNWAY_NOT_RECORDED.months };
  const burn = Math.round(-got.reduce((a, m) => a + m!.cashflow_cents, 0) / RUNWAY_MONTHS);
  const runway = cash != null && burn > 0 ? Math.round((cash / burn) * 10) / 10 : null;
  return { cash_cents: cash, burn_cents: burn, months: runway, label: runwayLabel(runway, burn) };
}

export const RUNWAY_NOT_RECORDED = {
  months: 'Runway: Not recorded, because Mercury’s cashflow summary lacks one of the last 3 full months',
  cash: 'Runway: Not recorded, because Mercury gave no cash balance',
};

export function runwayLabel(months: number | null, burn: number): string {
  if (months != null) return `Runway: ${months} months at the last 3 months’ burn`;
  return burn > 0 ? RUNWAY_NOT_RECORDED.cash : 'Runway: no net burn over the last 3 months';
}

/** Spend by Mercury category in each window: debits only, as positive cents. */
export function spendByCategory(lines: RaiseLine[], today: string): Array<{ months: number; category: string; cents: number }> {
  const out: Array<{ months: number; category: string; cents: number }> = [];
  for (const w of SPEND_WINDOWS) {
    const span = fullMonths(today, w);
    const by = new Map<string, number>();
    for (const l of lines) {
      if (!counted(l) || l.amount_cents >= 0 || l.posted_on! < span.from || l.posted_on! > span.to) continue;
      const cat = (l.category || '').trim().slice(0, 80) || UNCATEGORIZED;
      by.set(cat, (by.get(cat) ?? 0) - l.amount_cents);
    }
    for (const [category, cents] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) out.push({ months: w, category, cents });
  }
  return out;
}

/** The section a category's name suggests, or null when none does: a guess the founder accepts or changes. */
export function suggestSection(category: string): string | null {
  const c = category.toLowerCase();
  if (/advertis|marketing|event|travel|meal|entertain|sales|conference/.test(c)) return 'go-to-market';
  if (/software|cloud|hosting|saas|server|data|telecom|internet|infrastructure/.test(c)) return 'infrastructure';
  if (/payroll|salar|contractor|engineer|research|equipment|hardware/.test(c)) return 'product';
  if (/rent|office|legal|professional|insurance|tax|fee|bank|utilit|accounting|compliance/.test(c)) return 'operations';
  return null;
}

/** A credit that looks like investment: posted, incoming, by wire or ACH, at least $10,000. */
export function looksLikeInvestment(l: RaiseLine): boolean {
  return counted(l) && l.amount_cents >= MIN_INVESTMENT_CENTS && INVESTMENT_KINDS.includes(String(l.kind || ''));
}

export interface ProspectRow { id: number; name: string | null; firm: string | null; amount: number | null; stage: string }

/** Whether `a` names `b` word for word (both normalised), and `b` is long enough to mean something. */
const names = (a: string, b: string) => b.length >= 3 && ` ${a} `.includes(` ${b} `);

/**
 * The prospect a credit settles: one whose name or firm the counterparty names
 * (or the reverse), never one that passed. With several, the one whose amount
 * is the credit's; otherwise the first. Null with none: then a new investor.
 */
export function matchProspect(counterparty: string | null, cents: number, prospects: ProspectRow[]): ProspectRow | null {
  const cp = normalizeEntityName(counterparty);
  if (!cp) return null;
  const hits = prospects.filter((p) => p.stage !== 'passed' && [p.name, p.firm].some((n) => {
    const k = normalizeEntityName(n);
    return !!k && (names(cp, k) || names(k, cp));
  }));
  if (!hits.length) return null;
  return hits.find((p) => p.amount != null && Math.round(Number(p.amount) * 100) === cents) ?? hits[0];
}

/** Revenue credits per full month: credits, less internal moves, Axal's and anything taken as investment. */
export function revenueByMonth(lines: RaiseLine[], today: string, investment: Set<string>): Array<{ month: string; cents: number }> {
  const span = fullMonths(today, REVENUE_MONTHS);
  const by = new Map(span.list.map((m) => [m, 0]));
  for (const l of lines) {
    if (!counted(l) || l.amount_cents <= 0 || investment.has(l.id) || namesAxalEntity(l.counterparty)) continue;
    const m = l.posted_on!.slice(0, 7);
    if (by.has(m)) by.set(m, by.get(m)! + l.amount_cents);
  }
  return span.list.map((month) => ({ month, cents: by.get(month)! }));
}

/** The last full month's change over the one before, in whole percent; null when the one before had none. */
export function revenueGrowth(months: Array<{ cents: number }>): number | null {
  if (months.length < 2) return null;
  const prev = months[months.length - 2].cents, last = months[months.length - 1].cents;
  return prev > 0 ? Math.round(((last - prev) / prev) * 100) : null;
}

// ───────────────────────────────────────────────────────────── the sync

const FACT_EXT = (projectId: number, key: string) => `raise:${projectId}:${key}`;
const PROPOSAL_EXT = (projectId: number, kind: string, key: string) => `raise:${projectId}:${kind}:${key}`;

const UPSERT_FACT = `INSERT INTO mercury_raise_facts (integration_id, project_id, kind, fact_key, label, months, amount_cents, burn_cents, value, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, fact_key) DO UPDATE SET
       label = excluded.label, months = excluded.months, amount_cents = excluded.amount_cents,
       burn_cents = excluded.burn_cents, value = excluded.value, as_of = excluded.as_of, updated_at = CURRENT_TIMESTAMP`;
// The ledger row links to the fact just written; one deleted since is not written (`deletedFacts`).
const FACT_LEDGER = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     SELECT ?, ?, ?, ?, ?, 'mercury_raise_facts', id FROM mercury_raise_facts
      WHERE integration_id = ? AND project_id = ? AND fact_key = ?
     ON CONFLICT(integration_id, external_id) DO UPDATE SET
       last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`;
// Once per source: a decided proposal is never proposed again; a pending one is refreshed.
const PROPOSE = `INSERT INTO mercury_raise_proposals (integration_id, project_id, kind, source_key, payload_json, target)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, kind, source_key) DO UPDATE SET
       payload_json = excluded.payload_json, target = excluded.target, updated_at = CURRENT_TIMESTAMP
     WHERE mercury_raise_proposals.status = 'pending'`;
// A landed row the founder deleted elsewhere unlinks its ledger row, so it reads as deleted (#1906).
const UNLINK_GONE = (table: string) => `UPDATE connector_fed_items SET local_id = NULL
     WHERE integration_id = ? AND project_id = ? AND local_table = '${table}' AND local_id IS NOT NULL
       AND external_id LIKE 'raise:%' AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = connector_fed_items.local_id)`;
const LANDED_TABLES = ['mercury_raise_facts', 'data_room_files', 'raise_prospects'];

export type SyncCounts = Record<string, number | boolean | string>;

/** The fact keys whose ledger row says the founder deleted them. */
async function deletedFacts(env: Env, integrationId: number, projectId: number): Promise<Set<string>> {
  const rows = (await env.DB.prepare(
    `SELECT external_id FROM connector_fed_items
      WHERE integration_id = ? AND project_id = ? AND external_id LIKE ? AND local_table = 'mercury_raise_facts' AND local_id IS NULL`,
  ).bind(integrationId, projectId, `raise:${projectId}:%`).all<{ external_id: string }>()).results || [];
  const prefix = `raise:${projectId}:`;
  return new Set(rows.map((r) => r.external_id.slice(prefix.length)));
}

interface Fact { kind: FactKind; key: string; label: string | null; months: number | null; amount: number | null; burn: number | null; value: number | null }

function factStmts(env: Env, integrationId: number, projectId: number, asOf: string, f: Fact): D1PreparedStatement[] {
  const stmts = [
    env.DB.prepare(UPSERT_FACT).bind(integrationId, projectId, f.kind, f.key, f.label, f.months, f.amount, f.burn, f.value, asOf),
    env.DB.prepare(FACT_LEDGER).bind(integrationId, projectId, FACT_MODULE[f.kind], f.kind, FACT_EXT(projectId, f.key), integrationId, projectId, f.key),
  ];
  // The deck cites the narrative's revenue figures: the same fact, its own ledger row, so Pitch deck counts what it was fed.
  if (f.kind === 'revenue') {
    stmts.push(env.DB.prepare(FACT_LEDGER).bind(integrationId, projectId, 'pitch_deck', f.kind, FACT_EXT(projectId, `deck:${f.key}`), integrationId, projectId, f.key));
  }
  return stmts;
}

const proposeStmt = (env: Env, integrationId: number, projectId: number, kind: ProposalKind, key: string, payload: unknown, target: string | null) =>
  env.DB.prepare(PROPOSE).bind(integrationId, projectId, kind, key, JSON.stringify(payload), target);

/**
 * One Raise sync for one connection and one project. Each module reads and
 * lands on its own: a read that fails marks that module `unreadable` in the
 * counts and leaves the others. Returns counts only.
 */
export async function syncRaise(env: Env, integrationId: number, projectId: number, reads: RaiseReads, today: string): Promise<SyncCounts> {
  const counts: SyncCounts = {};
  // Rows the founder deleted through a module's own tools read as deleted.
  await env.DB.batch(LANDED_TABLES.map((t) => env.DB.prepare(UNLINK_GONE(t)).bind(integrationId, projectId)));
  const deleted = await deletedFacts(env, integrationId, projectId);
  const keep = (facts: Fact[]) => facts.filter((f) => !deleted.has(f.key));

  // One read of the last 12 full months and this month serves runway, spend, credits and revenue.
  let lines: RaiseLine[] | null = null;
  try {
    const span = fullMonths(today, 12);
    const read = await reads.lines(span.from, today);
    lines = read.lines;
    if (read.capped) counts.partial = true;
  } catch { counts.lines = 'unreadable'; }

  // Fundraising readiness: the runway, from the cashflow summary.
  {
    try {
      const flow = await reads.cashflow();
      const r = runwayFact(flow.cash_cents, flow.months, today);
      const facts = keep([{ kind: 'runway', key: 'runway', label: r.label, months: RUNWAY_MONTHS, amount: r.cash_cents, burn: r.burn_cents, value: r.months }]);
      if (facts.length) await env.DB.batch(facts.flatMap((f) => factStmts(env, integrationId, projectId, today, f)));
      counts.runway = facts.length;
    } catch { counts.runway = 'unreadable'; }
  }

  // Use of funds: the actuals, and a mapping proposal per category not yet decided.
  if (lines) {
    const spend = spendByCategory(lines, today);
    // A category stored before and absent from a window now spent nothing in it.
    const before = (await env.DB.prepare(
      `SELECT fact_key, label, months FROM mercury_raise_facts WHERE integration_id = ? AND project_id = ? AND kind = 'spend'`,
    ).bind(integrationId, projectId).all<{ fact_key: string; label: string; months: number }>()).results || [];
    const keyOf = (m: number, c: string) => `spend:${m}:${c}`;
    const now = new Set(spend.map((s) => keyOf(s.months, s.category)));
    const facts: Fact[] = spend.map((s) => ({ kind: 'spend', key: keyOf(s.months, s.category), label: s.category, months: s.months, amount: s.cents, burn: null, value: null }));
    for (const b of before) if (!now.has(b.fact_key)) facts.push({ kind: 'spend', key: b.fact_key, label: b.label, months: b.months, amount: 0, burn: null, value: null });
    const kept = keep(facts);
    const categories = [...new Set(spend.map((s) => s.category))];
    const stmts = [
      ...kept.flatMap((f) => factStmts(env, integrationId, projectId, today, f)),
      ...categories.map((c) => proposeStmt(env, integrationId, projectId, 'fund_mapping', c, { category: c }, suggestSection(c))),
    ];
    if (stmts.length) await env.DB.batch(stmts);
    counts.spend = kept.length;
    counts.fund_mappings = categories.length;
  }

  // Capital relationships: a proposal per credit that looks like investment, not already on a ledger.
  let investment = new Set<string>();
  if (lines) {
    const credits = lines.filter(looksLikeInvestment);
    const ids = credits.map((l) => l.id);
    const taken = ids.length ? new Set(((await env.DB.prepare(
      `SELECT source_ref AS id FROM revenue_entries WHERE source = 'mercury' AND source_ref IN (SELECT value FROM json_each(?))
       UNION SELECT mercury_transaction_id AS id FROM mercury_personal_matches WHERE state = 'confirmed' AND mercury_transaction_id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(ids), JSON.stringify(ids)).all<{ id: string }>()).results || []).map((r) => r.id)) : new Set<string>();
    const prospects = (await env.DB.prepare(
      'SELECT id, name, firm, amount, stage FROM raise_prospects WHERE project_id = ?',
    ).bind(projectId).all<ProspectRow>()).results || [];
    const stmts = credits.filter((l) => !taken.has(l.id)).map((l) => {
      const p = matchProspect(l.counterparty, l.amount_cents, prospects);
      return proposeStmt(env, integrationId, projectId, 'investor_credit', l.id, {
        posted_on: l.posted_on, amount_cents: l.amount_cents, counterparty: l.counterparty, last_four: l.last_four,
      }, p ? `prospect:${p.id}` : 'new');
    });
    if (stmts.length) await env.DB.batch(stmts);
    counts.investor_credits = stmts.length;
    // A credit the founder has not dismissed as investment is not revenue.
    const live = (await env.DB.prepare(
      `SELECT source_key FROM mercury_raise_proposals WHERE integration_id = ? AND project_id = ? AND kind = 'investor_credit' AND status != 'dismissed'`,
    ).bind(integrationId, projectId).all<{ source_key: string }>()).results || [];
    investment = new Set([...live.map((r) => r.source_key), ...taken]);
  }

  // Investor narrative and Pitch deck: revenue credits per month and the last month's growth.
  if (lines) {
    const months = revenueByMonth(lines, today, investment);
    const facts = keep([
      ...months.map((m): Fact => ({ kind: 'revenue', key: `revenue:${m.month}`, label: m.month, months: 1, amount: m.cents, burn: null, value: null })),
      { kind: 'revenue', key: 'revenue:growth', label: months[months.length - 1]?.month ?? null, months: 1, amount: null, burn: null, value: revenueGrowth(months) },
    ]);
    if (facts.length) await env.DB.batch(facts.flatMap((f) => factStmts(env, integrationId, projectId, today, f)));
    counts.revenue = facts.length;
  }

  // Data room: the last 12 statements, each a proposal.
  try {
    const list = (await reads.statements()).filter((s) => s.id && MONTH.test(s.month))
      .sort((a, b) => b.month.localeCompare(a.month) || a.id.localeCompare(b.id)).slice(0, MAX_STATEMENTS);
    if (list.length) await env.DB.batch(list.map((s) => proposeStmt(env, integrationId, projectId, 'statement', s.id, { month: s.month, last_four: s.last_four, account_id: s.account_id }, null)));
    counts.statements = list.length;
  } catch { counts.statements = 'unreadable'; }

  // Cap table: each SAFE, a proposed instrument.
  try {
    const safes = (await reads.safes()).filter((s) => s.id && s.amount_cents != null && s.amount_cents > 0 && !/cancel|void|declin/i.test(String(s.status || '')));
    if (safes.length) {
      await env.DB.batch(safes.map((s) => proposeStmt(env, integrationId, projectId, 'safe', s.id, {
        investor_name: s.investor_name, amount_cents: s.amount_cents, cap_cents: s.cap_cents, discount_pct: s.discount_pct, date: s.date, status: s.status,
      }, null)));
    }
    counts.safes = safes.length;
  } catch { counts.safes = 'unreadable'; }

  return counts;
}

// ───────────────────────────────────────────────────────────── the modules

export interface FactRow { id: number; kind: FactKind; fact_key: string; label: string | null; months: number | null; amount_cents: number | null; burn_cents: number | null; value: number | null; as_of: string }
export interface ProposalRow { id: number; kind: ProposalKind; source_key: string; payload: Record<string, unknown>; target: string | null; status: string }

async function factsOf(env: Env, integrationId: number, projectId: number, kind: FactKind): Promise<FactRow[]> {
  return (await env.DB.prepare(
    `SELECT id, kind, fact_key, label, months, amount_cents, burn_cents, value, as_of FROM mercury_raise_facts
      WHERE integration_id = ? AND project_id = ? AND kind = ? ORDER BY months, label, id`,
  ).bind(integrationId, projectId, kind).all<FactRow>()).results || [];
}

async function proposalsOf(env: Env, integrationId: number, projectId: number, kind: ProposalKind, status = 'pending'): Promise<ProposalRow[]> {
  const rows = (await env.DB.prepare(
    `SELECT id, kind, source_key, payload_json, target, status FROM mercury_raise_proposals
      WHERE integration_id = ? AND project_id = ? AND kind = ? AND status = ? ORDER BY id`,
  ).bind(integrationId, projectId, kind, status).all<any>()).results || [];
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(r.payload_json) ?? {}; } catch { payload = {}; }
    return { id: r.id, kind: r.kind, source_key: r.source_key, payload, target: r.target, status: r.status };
  });
}

const FROM = (asOf: string) => `From Mercury, as of ${asOf}`;
const sectionLabel = (key: string | null) => FUND_SECTIONS.find((s) => s.key === key)?.label ?? null;

/**
 * Fundraising readiness: the measured runway item. Where the founder recorded
 * a runway themselves (a metrics snapshot with cash and burn, not Mercury's),
 * the measured one replaces it here, and says which.
 */
async function readinessPart(env: Env, i: number, p: number) {
  const [r] = await factsOf(env, i, p, 'runway');
  if (!r) return { runway: null };
  const self = await env.DB.prepare(
    `SELECT snapshot_date FROM project_metrics WHERE project_id = ? AND COALESCE(source, 'manual') != 'mercury'
        AND cash_balance IS NOT NULL AND net_burn IS NOT NULL ORDER BY snapshot_date DESC, id DESC LIMIT 1`,
  ).bind(p).first<{ snapshot_date: string }>();
  return {
    runway: {
      fact_id: r.id, label: r.label, months: r.value, cash_cents: r.amount_cents, burn_cents: r.burn_cents, evidence: 'measured', source: FROM(r.as_of), as_of: r.as_of,
      replaces: self ? `Replaces the runway you recorded in the metrics snapshot of ${self.snapshot_date}` : null,
    },
  };
}

/** Use of funds: actuals per category and per section through the accepted mappings, and the mappings to decide. */
async function fundsPart(env: Env, i: number, p: number) {
  const facts = await factsOf(env, i, p, 'spend');
  const accepted = await proposalsOf(env, i, p, 'fund_mapping', 'accepted');
  const section = new Map(accepted.map((m) => [m.source_key, m.target]));
  const sections = FUND_SECTIONS.map((s) => ({
    key: s.key, label: s.label,
    actual_cents: Object.fromEntries(SPEND_WINDOWS.map((w) => [w, facts.filter((f) => f.months === w && section.get(String(f.label)) === s.key).reduce((a, f) => a + Number(f.amount_cents ?? 0), 0)])),
  }));
  const pending = await proposalsOf(env, i, p, 'fund_mapping');
  return {
    as_of: facts[0]?.as_of ?? null,
    source: facts[0] ? FROM(facts[0].as_of) : null,
    categories: facts.map((f) => ({ fact_id: f.id, category: f.label, months: f.months, spent_cents: f.amount_cents, section: section.get(String(f.label)) ?? null })),
    sections: accepted.length ? sections : null,
    proposals: pending.map((m) => ({ id: m.id, category: m.source_key, section: m.target, section_label: sectionLabel(m.target) })),
  };
}

async function statementsPart(env: Env, i: number, p: number) {
  const pending = await proposalsOf(env, i, p, 'statement');
  return {
    title: 'Add the last 12 statements to the data room',
    access: STATEMENT_ACCESS,
    proposals: pending.map((s) => ({ id: s.id, month: s.payload.month ?? null, last_four: s.payload.last_four ?? null })),
  };
}

async function safesPart(env: Env, i: number, p: number) {
  const pending = await proposalsOf(env, i, p, 'safe');
  return { proposals: pending.map((s) => ({ id: s.id, ...s.payload })) };
}

async function creditsPart(env: Env, i: number, p: number) {
  const pending = await proposalsOf(env, i, p, 'investor_credit');
  const ids = pending.map((c) => Number(String(c.target).replace('prospect:', ''))).filter((n) => Number.isInteger(n) && n > 0);
  const named = new Map(ids.length ? ((await env.DB.prepare(
    'SELECT id, name, firm FROM raise_prospects WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))',
  ).bind(p, JSON.stringify(ids)).all<{ id: number; name: string | null; firm: string | null }>()).results || []).map((r) => [r.id, r.name || r.firm]) : []);
  return {
    proposals: pending.map((c) => {
      const pid = c.target?.startsWith('prospect:') ? Number(c.target.slice(9)) : null;
      return { id: c.id, ...c.payload, match: pid != null && named.has(pid) ? { prospect_id: pid, name: named.get(pid) } : null, new_investor: pid == null || !named.has(pid) };
    }),
  };
}

/** The figures the narrative and the deck's traction slide may cite. Never written into their text. */
export async function citableFigures(env: Env, i: number, p: number) {
  const revenue = await factsOf(env, i, p, 'revenue');
  const [runway] = await factsOf(env, i, p, 'runway');
  const months = revenue.filter((f) => f.fact_key !== 'revenue:growth').sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const growth = revenue.find((f) => f.fact_key === 'revenue:growth');
  const last = months[months.length - 1];
  const out: Array<{ key: string; label: string; value: number | null; unit: string; source: string; fact_id: number }> = [];
  if (last) out.push({ key: 'revenue_last_month', label: `Revenue credits, ${last.label}`, value: last.amount_cents, unit: 'cents', source: FROM(last.as_of), fact_id: last.id });
  if (growth) out.push({ key: 'revenue_growth', label: `Revenue growth, ${growth.label} over the month before`, value: growth.value, unit: 'percent', source: FROM(growth.as_of), fact_id: growth.id });
  if (runway) {
    out.push({ key: 'net_burn', label: 'Net burn, average of the last 3 months', value: runway.burn_cents, unit: 'cents', source: FROM(runway.as_of), fact_id: runway.id });
    out.push({ key: 'runway', label: 'Runway', value: runway.value, unit: 'months', source: FROM(runway.as_of), fact_id: runway.id });
  }
  return { figures: out, months: months.map((m) => ({ month: m.label, cents: m.amount_cents, fact_id: m.id })) };
}

export const RAISE_PART_FOR: Record<string, (env: Env, integrationId: number, projectId: number) => Promise<unknown>> = {
  'fundraising-readiness': readinessPart,
  'use-of-funds': fundsPart,
  'data-room': statementsPart,
  'cap-table': safesPart,
  'capital-relationships': creditsPart,
  'investor-narrative': citableFigures,
  'pitch-deck': citableFigures,
};

// ───────────────────────────────────────────────────────────── the decisions

export type Outcome = { ok: true; landed: { table: string; id: number | string } | null } | { ok: false; status: number; code: string; message: string };
const NOT_FOUND: Outcome = { ok: false, status: 404, code: 'proposal_not_found', message: 'That proposal is not yours, or does not exist.' };
const DECIDED: Outcome = { ok: false, status: 409, code: 'proposal_decided', message: 'That proposal was already decided.' };

async function claim(env: Env, integrationId: number, projectId: number, id: number, userId: number) {
  const row = await env.DB.prepare(
    'SELECT id, kind, source_key, payload_json, target, status FROM mercury_raise_proposals WHERE id = ? AND integration_id = ? AND project_id = ?',
  ).bind(id, integrationId, projectId).first<any>();
  if (!row) return NOT_FOUND;
  const r = await env.DB.prepare(
    `UPDATE mercury_raise_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`,
  ).bind(userId, id).run();
  if (!r.meta?.changes) return DECIDED;
  let payload: Record<string, any> = {};
  try { payload = JSON.parse(row.payload_json) ?? {}; } catch { payload = {}; }
  return { ...row, payload } as { id: number; kind: ProposalKind; source_key: string; target: string | null; payload: Record<string, any> };
}

const handBack = (env: Env, id: number) => env.DB.prepare(
  `UPDATE mercury_raise_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL, local_table = NULL, local_id = NULL WHERE id = ? AND status = 'accepted'`,
).bind(id).run();

function landedStmts(env: Env, integrationId: number, projectId: number, p: { id: number; kind: ProposalKind; source_key: string }, table: string, localId: number | null, target: string | null) {
  return [
    env.DB.prepare('UPDATE mercury_raise_proposals SET local_table = ?, local_id = ?, target = ? WHERE id = ?').bind(table, localId, target, p.id),
    env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`)
      .bind(integrationId, projectId, PROPOSAL_MODULE[p.kind], p.kind, PROPOSAL_EXT(projectId, p.kind, p.source_key), table, localId),
  ];
}

export class AcceptError extends Error {
  status: number;
  code: string;
  sentence: string;
  constructor(status: number, code: string, sentence: string) { super(code); this.status = status; this.code = code; this.sentence = sentence; }
}

/**
 * Accept: the proposal is claimed (pending → accepted, once), then its row is
 * written to its module and its ledger row recorded. Anything that fails
 * hands the claim back, so nothing is half-written and Accept can be pressed
 * again. `section` names the use-of-funds section a mapping lands on, when
 * the founder changes the proposed one.
 */
export async function acceptRaiseProposal(env: Env, a: {
  integrationId: number; projectId: number; id: number; user: User; reads: RaiseReads | null; section?: unknown;
}): Promise<Outcome> {
  const { integrationId: i, projectId: pid, user } = a;
  if (a.section !== undefined && a.section !== null && !SECTION_KEYS.includes(String(a.section))) {
    return { ok: false, status: 400, code: 'invalid_section', message: 'Choose one of the five use-of-funds sections.' };
  }
  const p = await claim(env, i, pid, a.id, Number(user.id));
  if ('ok' in p) return p;
  try {
    if (p.kind === 'fund_mapping') {
      const section = a.section != null ? String(a.section) : p.target;
      if (!section || !SECTION_KEYS.includes(section)) throw new AcceptError(400, 'section_required', 'Choose the use-of-funds section this category is spent on.');
      await env.DB.batch(landedStmts(env, i, pid, p, 'mercury_raise_proposals', p.id, section));
      await log(env, user, pid, 'use-of-funds', p.id, 'mercury_mapping_accepted', 'Mercury category mapped to a section');
      return { ok: true, landed: { table: 'mercury_raise_proposals', id: p.id } };
    }
    if (p.kind === 'statement') return await acceptStatement(env, a, p);
    if (p.kind === 'safe') {
      const out = await addHolder(env, {
        projectId: pid, actor: user, group: 'investors', instrument: 'safe',
        name: String(p.payload.investor_name || 'SAFE investor').slice(0, 200),
        amount_cents: p.payload.amount_cents, cap_cents: p.payload.cap_cents ?? null, discount_pct: p.payload.discount_pct ?? null,
      });
      const base = await env.DB.prepare('SELECT id FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0 ORDER BY id LIMIT 1')
        .bind(pid).first<{ id: number }>();
      await env.DB.batch(landedStmts(env, i, pid, p, 'cap_table_scenarios', base?.id ?? null, out.id));
      await log(env, user, pid, 'cap-table', out.id, 'mercury_safe_accepted', 'Holder added from a Mercury SAFE: Investors · SAFE');
      return { ok: true, landed: { table: 'cap_table_scenarios', id: out.id } };
    }
    return await acceptCredit(env, a, p);
  } catch (e) {
    await handBack(env, p.id);
    if (e instanceof AcceptError) return { ok: false, status: e.status, code: e.code, message: e.sentence };
    throw e;
  }
}

async function acceptStatement(env: Env, a: { integrationId: number; projectId: number; user: User; reads: RaiseReads | null }, p: { id: number; kind: ProposalKind; source_key: string; payload: Record<string, any> }): Promise<Outcome> {
  if (!env.FILES) throw new AcceptError(503, 'storage_not_configured', 'The data room’s storage is not configured here.');
  if (!a.reads) throw new AcceptError(409, 'mercury_reconnect_required', 'Sign in with Mercury again to add the statement.');
  const project = await env.DB.prepare('SELECT id, uid FROM projects WHERE id = ?').bind(a.projectId).first<{ id: number; uid: string }>();
  if (!project?.uid) throw new AcceptError(404, 'project_not_found', 'This venture has no data room.');
  const accountId = typeof p.payload.account_id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(p.payload.account_id) ? p.payload.account_id : null;
  if (!accountId) throw new AcceptError(404, 'statement_not_found', 'Mercury no longer serves that statement.');
  const pdf = await a.reads.statementPdf(accountId, p.source_key);
  if (!pdf || !pdf.bytes?.byteLength) throw new AcceptError(404, 'statement_not_found', 'Mercury no longer serves that statement.');
  if (pdf.bytes.byteLength > MAX_STATEMENT_BYTES) throw new AcceptError(413, 'too_large', 'That statement is larger than the data room takes.');
  const uid = crypto.randomUUID().replace(/-/g, '');
  const key = `data-room/${project.uid}/${uid}`;
  const month = MONTH.test(String(p.payload.month)) ? String(p.payload.month) : 'statement';
  const four = /^\d{4}$/.test(String(p.payload.last_four)) ? ` ··${p.payload.last_four}` : '';
  await env.FILES.put(key, pdf.bytes, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { project_uid: project.uid, uploaded_by: String(a.user.id) } });
  let fileId: number | null = null;
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO data_room_files (uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id,
         created_at, updated_at, access_tier, checklist_item)
       VALUES (?, ?, NULL, ?, ?, 'application/pdf', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)`,
    ).bind(uid, project.id, `Mercury statement ${month}${four}.pdf`, key, pdf.bytes.byteLength, STATEMENT_ACCESS.visibility, a.user.id,
      STATEMENT_ACCESS.access_tier, STATEMENT_ACCESS.checklist_item).run();
    fileId = Number(ins.meta?.last_row_id) || null;
    await env.DB.batch(landedStmts(env, a.integrationId, a.projectId, p, 'data_room_files', fileId, null));
  } catch (e) {
    if (fileId != null) await env.DB.prepare('DELETE FROM data_room_files WHERE id = ?').bind(fileId).run().catch(() => {});
    await env.FILES.delete(key).catch(() => {});
    throw e;
  }
  await log(env, a.user, a.projectId, 'data-room', fileId ?? p.id, 'file_uploaded', 'File added from Mercury; access nobody');
  return { ok: true, landed: { table: 'data_room_files', id: fileId ?? 0 } };
}

async function acceptCredit(env: Env, a: { integrationId: number; projectId: number; user: User }, p: { id: number; kind: ProposalKind; source_key: string; target: string | null; payload: Record<string, any> }): Promise<Outcome> {
  const cents = Number(p.payload.amount_cents);
  const four = String(p.payload.last_four ?? '');
  const day = String(p.payload.posted_on ?? '');
  if (!Number.isSafeInteger(cents) || cents <= 0 || !/^\d{4}$/.test(four) || !DAY.test(day)) {
    throw new AcceptError(409, 'credit_unreadable', 'That credit is missing its amount, date or account, so it cannot be matched.');
  }
  // A line already on the revenue ledger is never also a raise receipt (D752 decision 10).
  const revenue = await env.DB.prepare(`SELECT 1 AS x FROM revenue_entries WHERE source = 'mercury' AND source_ref = ?`).bind(p.source_key).first();
  if (revenue) throw new AcceptError(409, 'imported_as_revenue', 'That credit is already imported as revenue.');
  let prospectId: number | null = p.target?.startsWith('prospect:') ? Number(p.target.slice(9)) : null;
  if (prospectId != null) {
    const own = await env.DB.prepare(`SELECT id FROM raise_prospects WHERE id = ? AND project_id = ? AND stage != 'passed'`).bind(prospectId, a.projectId).first();
    if (!own) prospectId = null;
  }
  let created = false;
  if (prospectId == null) {
    const name = String(p.payload.counterparty || '').trim() || 'Investor from Mercury';
    const out = await createProspect(env, a.projectId, { name, firm: name, stage: 'committed', amount: cents / 100 });
    if (out === 'invalid' || out === 'duplicate') throw new AcceptError(409, 'prospect_not_created', 'The investor could not be added.');
    prospectId = Number(out.prospect.id);
    created = true;
  } else {
    // The prospect commits at this amount, then the match is recorded (the D752 trigger withdraws a match on a change, so it goes first).
    await env.DB.prepare(`UPDATE raise_prospects SET stage = 'committed', amount = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`)
      .bind(cents / 100, prospectId, a.projectId).run();
  }
  const uid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mercury_personal_matches (uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on, target_kind, target_id, state)
       SELECT ?, ?, ?, ?, ?, ?, ?, 'raise_prospect', ?, 'confirmed'
        WHERE NOT EXISTS (SELECT 1 FROM revenue_entries r WHERE r.source = 'mercury' AND r.source_ref = ?)`,
    ).bind(uid, a.user.id, a.integrationId, p.source_key, four, cents, day, prospectId, p.source_key),
    env.DB.prepare(`UPDATE raise_prospects SET commit_status = 'wired', updated_at = datetime('now')
        WHERE id = ? AND stage = 'committed' AND EXISTS (SELECT 1 FROM mercury_personal_matches WHERE uid = ? AND state = 'confirmed')`).bind(prospectId, uid),
    ...landedStmts(env, a.integrationId, a.projectId, p, 'raise_prospects', prospectId, `prospect:${prospectId}`),
  ]);
  await log(env, a.user, a.projectId, 'capital-relationships', prospectId, created ? 'prospect_created' : 'mercury_receipt_matched',
    created ? 'Investor added from a Mercury credit, at Committed' : 'Mercury credit matched to this investor');
  return { ok: true, landed: { table: 'raise_prospects', id: prospectId } };
}

/** Dismiss: pending → dismissed, once. A re-sync never proposes it again. */
export async function dismissRaiseProposal(env: Env, a: { integrationId: number; projectId: number; id: number; user: User }): Promise<Outcome> {
  const r = await env.DB.prepare(
    `UPDATE mercury_raise_proposals SET status = 'dismissed', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND integration_id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(a.user.id, a.id, a.integrationId, a.projectId).run();
  if (r.meta?.changes) return { ok: true, landed: null };
  const row = await env.DB.prepare('SELECT 1 AS x FROM mercury_raise_proposals WHERE id = ? AND integration_id = ? AND project_id = ?')
    .bind(a.id, a.integrationId, a.projectId).first();
  return row ? DECIDED : NOT_FOUND;
}

/** Delete a fact: the row goes, and its ledger row stays without a `local_id`, so a re-sync never brings it back. */
export async function deleteRaiseFact(env: Env, a: { integrationId: number; projectId: number; id: number }): Promise<boolean> {
  const out = await env.DB.batch([
    env.DB.prepare(`UPDATE connector_fed_items SET local_id = NULL
        WHERE integration_id = ? AND project_id = ? AND local_table = 'mercury_raise_facts' AND local_id = ?`).bind(a.integrationId, a.projectId, a.id),
    env.DB.prepare('DELETE FROM mercury_raise_facts WHERE id = ? AND integration_id = ? AND project_id = ?').bind(a.id, a.integrationId, a.projectId),
  ]);
  return Number(out[1]?.meta?.changes ?? 0) > 0;
}

/** The disconnect: the connection's facts and its pending proposals go with it; what the founder accepted stays in its module. */
export async function deleteRaiseFeedsOf(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mercury_raise_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare(`DELETE FROM mercury_raise_proposals WHERE integration_id = ? AND status = 'pending'`).bind(integrationId),
  ]);
}

async function log(env: Env, user: User, projectId: number, module: ModuleSlug, entityId: number | string, action: string, summary: string) {
  await logCycleWrite(env, { projectId, userId: Number(user.id), cycle: 'raise', module, entityId, action, summary }).catch(() => {});
}

// ───────────────────────────────────────────────────────────── part 1's reads

/** The newest-first statement months a list read spans: the last 13 months, so the last 12 are complete. */
const STATEMENT_SPAN_DAYS = 400;

/** Binds `RaiseReads` to part 1's MCP reads; a statement's bytes are `statementPdf`'s (#2346). */
export function raiseReadsOf(r: MercuryReads): RaiseReads {
  let accounts: Awaited<ReturnType<MercuryReads['accounts']>> | null = null;
  const accountsOnce = async () => (accounts ??= await r.accounts());
  return {
    async cashflow() {
      const [flow, accs] = [await r.cashflowSummary({ monthsBack: RUNWAY_MONTHS + 1 }), await accountsOnce()];
      return { cash_cents: cashNow(accs).cents, months: flow.months };
    },
    async lines(from, to) {
      const fours = new Map((await accountsOnce()).map((a) => [a.mercury_account_id, a.last_four]));
      const out: RaiseLine[] = [];
      let after: string | null = null, capped = false;
      for (let page = 0; ; page += 1) {
        if (page >= MAX_LINE_PAGES) { capped = true; break; }
        const res = await r.transactions({ postedStart: from, postedEnd: to, startAfter: after });
        for (const t of res.transactions) {
          // A line on an account that is not checking or savings is not counted (D710 decision 6).
          if (t.mercury_account_id != null && !fours.has(t.mercury_account_id)) continue;
          out.push({
            id: t.mercury_transaction_id, amount_cents: t.amount_cents, posted_on: t.posted_on, kind: t.kind,
            counterparty: t.counterparty_name, category: t.category,
            last_four: t.mercury_account_id ? fours.get(t.mercury_account_id) ?? null : null,
            posted: POSTED_STATUSES.includes(String(t.status || '')),
            internal: INTERNAL_KINDS.includes(String(t.kind || '')),
            voided: VOID_STATUSES.includes(String(t.status || '')),
          });
        }
        after = res.next;
        if (!after) break;
      }
      return { lines: out, capped };
    },
    async statements() {
      const accs = await accountsOnce();
      const start = new Date(Date.now() - STATEMENT_SPAN_DAYS * 86_400_000).toISOString().slice(0, 10);
      const out: RaiseStatement[] = [];
      for (const a of accs) {
        for (const s of await r.statements(a.mercury_account_id, { start })) {
          const month = (s.period_start ?? s.period_end ?? '').slice(0, 7);
          if (MONTH.test(month)) out.push({ id: s.id, account_id: a.mercury_account_id, month, last_four: a.last_four });
        }
      }
      return out;
    },
    async statementPdf(accountId, id) {
      const pdf = await r.statementPdf(accountId, id);
      return pdf ? { bytes: pdf.bytes, content_type: pdf.content_type } : null;
    },
    async safes() {
      return (await r.safeRequests()).map((s) => ({
        id: s.id, investor_name: s.investor_name, amount_cents: s.amount_cents, cap_cents: s.valuation_cap_cents,
        // Mercury's SAFE requests carry a post-money cap and no discount.
        discount_pct: null, status: s.status, date: s.created_on,
      }));
    },
  };
}

/** The most pages of lines one sync reads; past it the sync is `partial`. */
export const MAX_LINE_PAGES = 8;
