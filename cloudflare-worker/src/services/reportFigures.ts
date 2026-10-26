/**
 * D1059 (#2929, part 3 of #2427) — what a report is built from.
 *
 *   REPORT_FIGURES   each figure a report can carry: its key, label, Grow
 *                    module, unit, the sources it may come from, and the
 *                    other keys it is known by. It unifies Share an update's
 *                    five keys (`METRIC_KEYS`, `updateShare.ts`) with the KPI
 *                    rule keys of `portfolio_kpi_definitions` (migration 168),
 *                    so `burn` and `net_burn`, `runway` and `runway_months` are
 *                    one figure each. A test holds the assembler to it.
 *   assembleReport   reads every module's stores for one venture and period,
 *                    and returns each figure with its value, source and
 *                    `as_of`. Nothing missing becomes 0: an unrecorded figure
 *                    is `value: null` with its reason.
 *   applyChoices     the founder's choices on top: include or leave out (a
 *                    required figure left out needs a reason the investor
 *                    reads), share a team-only Mercury figure, and a typed
 *                    figure no source holds.
 *   frozenFigures    the exact list that is stored, hashed and sent.
 *
 * TEAM ONLY. A figure read from the founder's Mercury is team only
 * (`services/mercury/growFeeds.ts`): it is shown in a draft only to the
 * venture's team, and it goes into a report only when the venture's founder
 * ticks it in their own session (`isVentureFounder`). Every other figure is
 * included by default when it is recorded.
 *
 * The source words are PIPE-RAISE's five (#2430): Connector, Document,
 * Recorded, Signed, Typed. A computed figure carries the word of what it read.
 */
import type { Env } from '../types';
import { sha256Hex } from './fundReportDrafts';
import { shippedItems } from '../routes/portfolio_updates';

export type FigureUnit = 'usd' | 'pct' | 'count' | 'months';
export type GrowSlug = 'product-improvement' | 'distribution' | 'revenue-and-traction' | 'team-expansion'
  | 'partner-network' | 'market-expansion' | 'durable-company-building';
export type SourceWord = 'Connector' | 'Document' | 'Recorded' | 'Signed' | 'Typed';
/** Where a value came from: `stripe` and `mercury` are connectors; `manual` is the team's own typing in Grow. */
export type Provider = 'stripe' | 'mercury' | 'manual' | 'roster' | 'job_postings' | 'growth_partners' | 'markets'
  | 'checklist' | 'shipped' | 'founder';

export interface FigureDef {
  key: string; label: string; module: GrowSlug; unit: FigureUnit;
  /** The providers this figure may be read from; an empty list means no Grow store records it yet. */
  sources: readonly Provider[];
  /** Other keys for the same figure: Share an update's and the KPI rules'. */
  aliases: readonly string[];
  /** Why an unrecorded figure is unrecorded, when no store holds it at all. */
  unstored?: string;
}

/** The Grow modules in their tab order (`growCycle.ts` `GROW_MODULES`). */
export const MODULE_ORDER: readonly GrowSlug[] = [
  'product-improvement', 'distribution', 'revenue-and-traction', 'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building',
];

export const REPORT_FIGURES: readonly FigureDef[] = Object.freeze([
  { key: 'mrr', label: 'MRR', module: 'revenue-and-traction', unit: 'usd', sources: ['stripe', 'manual'], aliases: [] },
  { key: 'growth', label: 'Growth', module: 'revenue-and-traction', unit: 'pct', sources: ['stripe', 'manual'], aliases: [] },
  { key: 'customers', label: 'Customers', module: 'revenue-and-traction', unit: 'count', sources: ['stripe', 'manual'], aliases: ['paying_accounts'] },
  { key: 'arr', label: 'ARR', module: 'revenue-and-traction', unit: 'usd', sources: ['stripe', 'manual'], aliases: [] },
  { key: 'revenue', label: 'Revenue', module: 'revenue-and-traction', unit: 'usd', sources: [], aliases: [],
    unstored: 'Not recorded: no Grow store records a period’s revenue yet' },
  { key: 'net_retention', label: 'Net revenue retention', module: 'revenue-and-traction', unit: 'pct', sources: ['stripe', 'manual'], aliases: ['nrr_pct'] },
  { key: 'gross_margin', label: 'Gross margin', module: 'revenue-and-traction', unit: 'pct', sources: [], aliases: [],
    unstored: 'Not recorded: no Grow store records gross margin yet' },
  { key: 'net_burn', label: 'Net burn', module: 'revenue-and-traction', unit: 'usd', sources: ['stripe', 'manual', 'mercury'], aliases: ['burn'] },
  { key: 'cash_balance', label: 'Cash', module: 'revenue-and-traction', unit: 'usd', sources: ['manual', 'mercury'], aliases: ['cash'] },
  { key: 'headcount', label: 'Headcount', module: 'team-expansion', unit: 'count', sources: ['manual', 'roster'], aliases: [] },
  { key: 'open_roles', label: 'Open roles', module: 'team-expansion', unit: 'count', sources: ['job_postings'], aliases: [] },
  { key: 'partners_signed', label: 'Signed partners', module: 'partner-network', unit: 'count', sources: ['growth_partners'], aliases: [] },
  { key: 'markets_entering', label: 'Markets entering', module: 'market-expansion', unit: 'count', sources: ['markets'], aliases: [] },
  { key: 'shipped_items', label: 'Items shipped', module: 'product-improvement', unit: 'count', sources: ['shipped'], aliases: [] },
  { key: 'runway', label: 'Runway', module: 'durable-company-building', unit: 'months', sources: ['manual', 'mercury'], aliases: ['runway_months'] },
  { key: 'checklist_done', label: 'Durability checklist done', module: 'durable-company-building', unit: 'count', sources: ['checklist'], aliases: [] },
] as FigureDef[]);

const BY_KEY = new Map<string, FigureDef>();
for (const f of REPORT_FIGURES) { BY_KEY.set(f.key, f); for (const a of f.aliases) BY_KEY.set(a, f); }

/** The registry's figure for a key or any of its aliases, or null. */
export const figureFor = (key: string): FigureDef | null => BY_KEY.get(String(key)) ?? null;

/**
 * Migration 168's firm-wide KPI rules (`portfolio_kpi_definitions`, fund_id
 * NULL), the ones marked required, by cadence. A test holds this list to the
 * migration's seed rows.
 */
export const KPI_RULES_REQUIRED: Readonly<Record<'monthly' | 'quarterly', readonly string[]>> = Object.freeze({
  monthly: ['cash_balance', 'net_burn', 'runway_months', 'revenue'],
  quarterly: ['arr', 'headcount'],
});

/**
 * The figures a duty requires. A duty whose signed paper names figures keeps
 * them (D1058 stores them in `required_figures`). None names one yet, so the
 * financial and KPI duties take migration 168's required KPI rules, mapped to
 * this registry's keys; the other kinds require none. The stored duty row is
 * never rewritten.
 */
export function requiredFiguresOf(duty: { kind: string; required_figures?: string | null }): string[] {
  let stored: unknown = [];
  try { stored = JSON.parse(String(duty.required_figures ?? '[]')); } catch { stored = []; }
  const named = Array.isArray(stored) ? stored.map((k) => figureFor(String(k))?.key).filter((k): k is string => !!k) : [];
  const keys = named.length ? named
    : duty.kind === 'monthly_financials' ? KPI_RULES_REQUIRED.monthly
      : duty.kind === 'quarterly_kpi' ? [...KPI_RULES_REQUIRED.monthly, ...KPI_RULES_REQUIRED.quarterly]
        : [];
  return [...new Set(keys.map((k) => figureFor(k)!.key))];
}

// ── The figures as read ─────────────────────────────────────────────────────

export interface FigureSource { word: SourceWord; provider: Provider; computed: boolean }

export interface Figure {
  key: string; label: string; module: GrowSlug; unit: FigureUnit;
  value: number | null; source: FigureSource | null; as_of: string | null; reason: string | null;
  /** True for a figure read from the founder's Mercury. */
  team_only: boolean;
}

const WORD: Record<Provider, SourceWord> = {
  stripe: 'Connector', mercury: 'Connector', manual: 'Typed', founder: 'Typed',
  roster: 'Recorded', job_postings: 'Recorded', growth_partners: 'Recorded', markets: 'Recorded', checklist: 'Recorded', shipped: 'Recorded',
};
const src = (provider: Provider, computed = false): FigureSource => ({ word: WORD[provider], provider, computed });
/** A `project_metrics.source` as a provider: the two connectors by name, anything else the team typed. */
const providerOf = (s: string | null): Provider => (s === 'stripe' ? 'stripe' : s === 'mercury' ? 'mercury' : 'manual');

const NOT_RECORDED = 'Not recorded';
const unread = (def: FigureDef, reason: string): Figure => ({
  key: def.key, label: def.label, module: def.module, unit: def.unit, value: null, source: null, as_of: null, reason, team_only: false,
});
const read = (def: FigureDef, value: number, source: FigureSource, asOf: string | null): Figure => ({
  key: def.key, label: def.label, module: def.module, unit: def.unit, value, source, as_of: asOf, reason: null, team_only: source.provider === 'mercury',
});

type SnapRow = { snapshot_date: string; source: string | null; [col: string]: number | string | null };

/**
 * The latest snapshot in the period that records `col`. On one date a
 * connector or typed row is preferred to a Mercury one, so a team-only figure
 * never stands in for one the team may share.
 */
function latestIn(rows: SnapRow[], col: string): SnapRow | null {
  let best: SnapRow | null = null;
  for (const r of rows) {
    const v = r[col];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!best || r.snapshot_date > best.snapshot_date
      || (r.snapshot_date === best.snapshot_date && best.source === 'mercury' && r.source !== 'mercury')) best = r;
  }
  return best;
}

/** One module's read, or the reason it could not be read: a failed store never reads as none. */
async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try { return { ok: true, value: await fn() }; } catch { return { ok: false }; }
}

export interface Assembled { period: { start: string; end: string }; figures: Figure[]; unreadable: GrowSlug[] }

/**
 * Every REPORT_FIGURES figure of one venture for one period, from the stores
 * as they are now. `today` dates the figures that are counts of the present
 * (the roster, open roles, partners, markets and the checklist).
 */
export async function assembleReport(env: Env, projectId: number, period: { start: string; end: string }, today: string): Promise<Assembled> {
  const unreadable = new Set<GrowSlug>();
  const out = new Map<string, Figure>();
  const def = (k: string) => figureFor(k)!;

  // Revenue and traction, and the snapshot figures of the other modules.
  const snaps = await attempt(async () => {
    const [inPeriod, before] = await Promise.all([
      env.DB.prepare(`SELECT snapshot_date, source, mrr, arr, paying_accounts, nrr_pct, net_burn, cash_balance, headcount FROM project_metrics
         WHERE project_id = ? AND snapshot_date >= ? AND snapshot_date <= ? ORDER BY snapshot_date, id`)
        .bind(projectId, period.start, period.end).all<SnapRow>(),
      env.DB.prepare(`SELECT snapshot_date, source, mrr, arr, paying_accounts, nrr_pct, net_burn, cash_balance, headcount FROM project_metrics
         WHERE project_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC, id DESC LIMIT 60`)
        .bind(projectId, period.start).all<SnapRow>(),
    ]);
    return { inPeriod: inPeriod.results || [], before: before.results || [] };
  });
  const mercury = await attempt(async () => (await env.DB.prepare(
    `SELECT kind, value, amount_cents, as_of FROM mercury_grow_facts WHERE project_id = ? AND kind IN ('cash', 'runway')
       AND as_of >= ? AND as_of <= ? ORDER BY as_of DESC, id DESC`,
  ).bind(projectId, period.start, period.end).all<{ kind: string; value: number | null; amount_cents: number | null; as_of: string }>()).results || []);

  if (!snaps.ok) {
    for (const k of ['mrr', 'growth', 'customers', 'arr', 'net_retention', 'net_burn', 'cash_balance']) out.set(k, unread(def(k), 'Unreadable: Revenue and traction could not be read'));
    unreadable.add('revenue-and-traction');
  } else {
    const rows = snaps.value.inPeriod;
    const pick = (key: string, col: string) => {
      const s = latestIn(rows, col);
      out.set(key, s ? read(def(key), Number(s[col]), src(providerOf(s.source)), s.snapshot_date)
        : unread(def(key), `${NOT_RECORDED}: no snapshot in this period records it`));
    };
    pick('mrr', 'mrr'); pick('customers', 'paying_accounts'); pick('arr', 'arr'); pick('net_retention', 'nrr_pct'); pick('net_burn', 'net_burn');
    pick('cash_balance', 'cash_balance');
    // Growth: this period's MRR against the last MRR recorded before it, from the same provider family.
    const mrr = out.get('mrr')!;
    const prev = latestIn(snaps.value.before, 'mrr');
    out.set('growth', mrr.value != null && prev && Number(prev.mrr) > 0
      ? read(def('growth'), Math.round(((mrr.value - Number(prev.mrr)) / Number(prev.mrr)) * 1000) / 10, { ...mrr.source!, computed: true }, mrr.as_of)
      : unread(def('growth'), `${NOT_RECORDED}: growth needs MRR recorded in this period and before it`));
    // Cash from Mercury, when no typed balance is recorded (Mercury's own rows never hold a balance).
    if (out.get('cash_balance')!.value == null && mercury.ok) {
      const cash = mercury.value.find((m) => m.kind === 'cash' && m.amount_cents != null);
      if (cash) out.set('cash_balance', read(def('cash_balance'), Number(cash.amount_cents) / 100, src('mercury'), cash.as_of));
    }
    // Headcount typed into the snapshots, else the roster below.
    const hc = latestIn(rows, 'headcount');
    if (hc) out.set('headcount', read(def('headcount'), Number(hc.headcount), src(providerOf(hc.source)), hc.snapshot_date));
  }

  // Durable company-building: runway from cash and burn, else from Mercury; the checklist.
  {
    const cash = out.get('cash_balance'); const burn = out.get('net_burn');
    if (cash?.value != null && burn?.value != null && burn.value > 0) {
      const teamOnly = cash.team_only || burn.team_only;
      out.set('runway', read(def('runway'), Math.round((cash.value / burn.value) * 10) / 10,
        { ...(teamOnly ? src('mercury') : cash.source!), computed: true }, [cash.as_of, burn.as_of].sort().at(-1) ?? null));
    } else if (mercury.ok && mercury.value.find((m) => m.kind === 'runway' && m.value != null)) {
      const m = mercury.value.find((x) => x.kind === 'runway' && x.value != null)!;
      out.set('runway', read(def('runway'), Number(m.value), src('mercury'), m.as_of));
    } else {
      out.set('runway', unread(def('runway'), !snaps.ok ? 'Unreadable: Revenue and traction could not be read'
        : `${NOT_RECORDED}: runway needs cash and burn recorded in this period`));
    }
    const list = await attempt(async () => env.DB.prepare(
      `SELECT COUNT(*) AS done FROM durability_checklist WHERE project_id = ? AND done_at IS NOT NULL AND substr(done_at, 1, 10) <= ?`,
    ).bind(projectId, period.end).first<{ done: number }>());
    if (list.ok) out.set('checklist_done', read(def('checklist_done'), Number(list.value?.done ?? 0), src('checklist'), period.end < today ? period.end : today));
    else { out.set('checklist_done', unread(def('checklist_done'), 'Unreadable: Durable company-building could not be read')); unreadable.add('durable-company-building'); }
  }

  // Team expansion: the roster (when no snapshot gave a headcount) and open roles, as of today.
  {
    if (!out.has('headcount')) {
      const roster = await attempt(async () => env.DB.prepare(
        `SELECT COUNT(*) AS n, COUNT(p.company_id) AS linked FROM projects p LEFT JOIN company_people cp ON cp.company_id = p.company_id
            AND cp.status = 'active' AND cp.person_type = 'employee' WHERE p.id = ?`,
      ).bind(projectId).first<{ n: number; linked: number }>());
      if (!roster.ok) { out.set('headcount', unread(def('headcount'), 'Unreadable: Team expansion could not be read')); unreadable.add('team-expansion'); }
      else if (!Number(roster.value?.linked ?? 0)) out.set('headcount', unread(def('headcount'), `${NOT_RECORDED}: no team roster is recorded`));
      else out.set('headcount', read(def('headcount'), Number(roster.value!.n), src('roster'), today));
    }
    const roles = await attempt(async () => env.DB.prepare(
      `SELECT COUNT(*) AS n FROM job_postings WHERE project_id = ? AND status IN ('open', 'published')`,
    ).bind(projectId).first<{ n: number }>());
    if (roles.ok) out.set('open_roles', read(def('open_roles'), Number(roles.value?.n ?? 0), src('job_postings'), today));
    else { out.set('open_roles', unread(def('open_roles'), 'Unreadable: Team expansion could not be read')); unreadable.add('team-expansion'); }
  }

  // Partner network, Market expansion and Product improvement: counts of their records.
  const counted = async (key: string, slug: GrowSlug, provider: Provider, statement: () => D1PreparedStatement, asOf: string) => {
    const r = await attempt(async () => statement().first<{ n: number }>());
    if (r.ok) out.set(key, read(def(key), Number(r.value?.n ?? 0), src(provider), asOf));
    else { out.set(key, unread(def(key), `Unreadable: ${MODULE_TITLES[slug]} could not be read`)); unreadable.add(slug); }
  };
  await counted('partners_signed', 'partner-network', 'growth_partners',
    () => env.DB.prepare(`SELECT COUNT(*) AS n FROM growth_partners WHERE project_id = ? AND stage = 'signed'`).bind(projectId), today);
  await counted('markets_entering', 'market-expansion', 'markets',
    () => env.DB.prepare(`SELECT COUNT(*) AS n FROM markets WHERE project_id = ? AND state = 'entering'`).bind(projectId), today);
  {
    // `shippedItems` reads each of its two stores alone and drops one it cannot read.
    const shipped = await shippedItems(env, projectId, period.start, period.end);
    out.set('shipped_items', read(def('shipped_items'), shipped.length, src('shipped'), period.end < today ? period.end : today));
  }

  for (const f of REPORT_FIGURES) if (!out.has(f.key)) out.set(f.key, unread(f, f.unstored ?? NOT_RECORDED));
  const figures = REPORT_FIGURES.map((f) => out.get(f.key)!);
  return { period, figures, unreadable: MODULE_ORDER.filter((m) => unreadable.has(m)) };
}

export const MODULE_TITLES: Record<GrowSlug, string> = {
  'product-improvement': 'Product improvement', distribution: 'Distribution', 'revenue-and-traction': 'Revenue and traction',
  'team-expansion': 'Team expansion', 'partner-network': 'Partner network', 'market-expansion': 'Market expansion',
  'durable-company-building': 'Durable company-building',
};

// ── The founder's choices ───────────────────────────────────────────────────

/** A figure as a report stores it: the read figure and the choice made on it. */
export interface ReportFigure extends Figure {
  included: boolean;
  /** The founders' reason for leaving out a figure a duty requires; the investor reads it. */
  left_out_reason: string | null;
  /** A team-only Mercury figure the venture's founder ticked to share. */
  shared: boolean;
  /** A figure the founders typed, which no source holds ("Entered by [company]"). */
  typed: boolean;
}

export interface Choice { key: string; include?: boolean; reason?: string | null; share?: boolean }
export interface TypedFigure { label: string; value: number; unit: FigureUnit; as_of: string }

/** A refused choice; `sentence` is written here and safe for a refusal body (D278). */
export class ChoiceError extends Error {
  sentence: string; field: string;
  constructor(field: string, sentence: string) { super(sentence); this.sentence = sentence; this.field = field; }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: readonly FigureUnit[] = ['usd', 'pct', 'count', 'months'];

/** Typed figures, checked: a label, a finite number, a unit and a date. At most eight. */
export function cleanTyped(raw: unknown): TypedFigure[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new ChoiceError('typed', 'Typed figures must be a list.');
  if (raw.length > 8) throw new ChoiceError('typed', 'Add at most eight typed figures.');
  return raw.map((t: any, i) => {
    const label = typeof t?.label === 'string' ? t.label.trim() : '';
    if (!label || label.length > 60) throw new ChoiceError('typed', `Typed figure ${i + 1} needs a name of at most 60 characters.`);
    if (typeof t?.value !== 'number' || !Number.isFinite(t.value)) throw new ChoiceError('typed', `Typed figure ${i + 1} needs a number.`);
    if (!UNITS.includes(t?.unit)) throw new ChoiceError('typed', `Typed figure ${i + 1} needs a unit: usd, pct, count or months.`);
    if (typeof t?.as_of !== 'string' || !DAY.test(t.as_of)) throw new ChoiceError('typed', `Typed figure ${i + 1} needs a date, YYYY-MM-DD.`);
    return { label, value: t.value, unit: t.unit, as_of: t.as_of };
  });
}

/**
 * The founder's choices over the assembled figures. A recorded figure is
 * included unless left out; a team-only one is left out unless shared; an
 * unrecorded one can never be included. Leaving out a figure a duty requires
 * needs a reason (at most 200 characters; `leftOut` and send hold that).
 * `mayShare` is whether this caller
 * is the venture's founder in their own session: anyone else's share is
 * refused, never ignored.
 */
export function applyChoices(figures: Figure[], choices: Choice[], typed: TypedFigure[], mayShare: boolean,
  previous: ReportFigure[] = []): ReportFigure[] {
  const byKey = new Map<string, Choice>();
  for (const ch of choices) {
    const def = figureFor(ch.key);
    if (!def) throw new ChoiceError('figures', `${String(ch.key).slice(0, 40)} is not a report figure.`);
    byKey.set(def.key, ch);
  }
  const before = new Map(previous.filter((p) => !p.typed).map((p) => [p.key, p]));
  const out: ReportFigure[] = figures.map((f) => {
    const ch = byKey.get(f.key); const old = before.get(f.key);
    if (ch?.share !== undefined && f.team_only && ch.share !== !!old?.shared && !mayShare) {
      throw new ChoiceError('figures', 'Only the venture’s founder, in their own session, shares a figure from their Mercury.');
    }
    const shared = f.team_only && f.value != null && (ch?.share ?? old?.shared ?? false);
    // A team-only figure goes in with its share, unless left out; any other recorded figure goes in unless left out.
    const wanted = ch?.include ?? (f.team_only ? shared : (old?.included ?? f.value != null));
    const included = f.value != null && wanted && (!f.team_only || shared);
    const reasonRaw = ch && 'reason' in ch ? ch.reason : old?.left_out_reason ?? null;
    const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim() : null;
    if (reason && reason.length > 200) throw new ChoiceError('figures', `Keep the reason for leaving out ${f.label} to 200 characters.`);
    return { ...f, included, shared, typed: false, left_out_reason: included ? null : reason };
  });
  typed.forEach((t, i) => out.push({
    key: `typed-${i + 1}`, label: t.label, module: 'revenue-and-traction', unit: t.unit, value: t.value,
    source: src('founder'), as_of: t.as_of, reason: null, team_only: false, included: true, shared: false, typed: true, left_out_reason: null,
  }));
  return out;
}

/** The required figures a report leaves out, each with its reason or null when it gives none. */
export function leftOut(figures: ReportFigure[], required: Set<string>) {
  return figures.filter((f) => !f.typed && required.has(f.key) && !f.included).map((f) => ({ key: f.key, label: f.label, reason: f.left_out_reason }));
}

/** The canonical string a report stores and hashes: the figures in registry order, then the typed ones, with fixed fields. */
export function canonicalFigures(figures: ReportFigure[]): string {
  return JSON.stringify(figures.map((f) => ({
    key: f.key, label: f.label, module: f.module, unit: f.unit, value: f.value,
    source: f.source ? { word: f.source.word, provider: f.source.provider, computed: f.source.computed } : null,
    as_of: f.as_of, reason: f.reason, team_only: f.team_only, included: f.included, shared: f.shared, typed: f.typed, left_out_reason: f.left_out_reason,
  })));
}

export async function digestFigures(figures: ReportFigure[]): Promise<{ json: string; sha256: string }> {
  const json = canonicalFigures(figures);
  return { json, sha256: await sha256Hex(json) };
}

/** A stored `figures_json`, read back; anything malformed is dropped rather than shown. */
export function storedFigures(raw: string | null | undefined): ReportFigure[] {
  let v: unknown = [];
  try { v = JSON.parse(String(raw ?? '[]')); } catch { v = []; }
  return (Array.isArray(v) ? v : []).filter((f: any) => f && typeof f === 'object' && typeof f.key === 'string') as ReportFigure[];
}

/** The choices a stored report made, to carry onto a fresh read of the stores. */
export function choicesOf(figures: ReportFigure[]): { choices: Choice[]; typed: TypedFigure[] } {
  return {
    choices: figures.filter((f) => !f.typed).map((f) => ({ key: f.key, include: f.included, reason: f.left_out_reason, share: f.shared })),
    typed: figures.filter((f) => f.typed && f.value != null).map((f) => ({ label: f.label, value: f.value as number, unit: f.unit, as_of: String(f.as_of) })),
  };
}

/**
 * What a reader outside the team is shown: the included figures, and each
 * left-out figure a duty requires with its reason. A team-only figure not
 * shared is never in it, not even its name.
 */
export function readerFigures(figures: ReportFigure[], required: Set<string>) {
  return figures.filter((f) => f.included || (!f.typed && required.has(f.key) && !(f.team_only && !f.shared))).map((f) => ({
    key: f.key, label: f.label, module: f.module, unit: f.unit,
    value: f.included ? f.value : null,
    source: f.included ? f.source : null,
    as_of: f.included ? f.as_of : null,
    shared_from_mercury: f.included && f.shared,
    typed: f.typed,
    left_out: !f.included,
    left_out_reason: f.included ? null : (f.left_out_reason ?? f.reason),
  }));
}
