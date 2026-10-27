/**
 * D1264 (#3287, Raise evidence part 3 of #2430) — the claim check.
 *
 * Every Raise claim gets a state from the founder's PINNED evidence
 * (`raise_evidence_items`, D1263), never from a model:
 *
 *   backed           the best-sourced record agrees (within 2%, `agrees`)
 *   founders_figure  only a Typed record agrees: "Founder's figure", never Backed
 *   mismatch         the best-sourced record disagrees; both figures and sources are kept
 *   not_backed       no pinned record of that kind
 *
 * "Best source first" is Connector, Signed, Document, Recorded, Typed, then the
 * newest observation date. A figure meets every pinned item of its kind; a
 * count (interviews, letters of intent, waitlist sign-ups) is the number of
 * pinned records of that kind.
 *
 * The claims, by surface:
 *
 *   narrative      the newest investor-narrative version's figures (D1264's widened `FIGURES`)
 *   deck           the current pitch deck's figures, slide by slide
 *   readiness      Traction proof, Team and Product-market fit: backed by presence, not a figure
 *   use_of_funds   each section's planned share against the bank spend mapped to it
 *   cap_table      each founder holding's shares against its recorded vesting
 *   capital_model  growth, churn and CAC assumptions against the measured figure
 *
 * A claim's own record never backs it (a model assumption is not evidence for
 * itself). Each surface is read on its own: one that cannot be read leaves its
 * claims as they were, and the others are still checked. The check writes
 * `raise_claims` and the `computed` rows of `raise_claim_evidence` only when
 * something changed; a founder's or Eadwyn's link is never touched.
 * `narrative_checks` keeps its rows for readiness (`raiseWriters.ts`).
 */
import type { Env } from '../types';
import { agrees, fmtFigure, FIGURE_LABEL, FIGURE_UNIT, parseStatedFigures, VERSION_MARKER_KEY, type FigureKey } from './raiseCycle';
import { EVIDENCE_RULES, type EvidenceSourceLabel } from './raiseEvidenceSources';
import { FUND_SECTIONS, parseUseOfFundsValue } from '../util/useOfFunds';

export const CLAIM_STATES = ['backed', 'founders_figure', 'mismatch', 'not_backed'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];
export const CLAIM_SURFACES = ['narrative', 'deck', 'readiness', 'use_of_funds', 'cap_table', 'capital_model'] as const;
export type ClaimSurface = (typeof CLAIM_SURFACES)[number];

/** Best source first. A label not in this list never decides a claim. */
export const SOURCE_RANK: Record<EvidenceSourceLabel, number> = { connector: 0, signed: 1, document: 2, recorded: 3, typed: 4 };

export type PinnedItem = {
  id: number; uid: string; kind: string; source_table: string; source_ref: string; source_label: EvidenceSourceLabel;
  provider: string | null; observed_on: string | null; value_num: number | null; value_unit: string | null; currency: string | null;
  private_reason: string | null;
};
/** One record a claim is compared with: a pinned item, or a count of several. */
export type Candidate = { value: number | null; label: EvidenceSourceLabel; provider: string | null; observed_on: string | null; items: PinnedItem[] };
export type Unit = 'money' | 'percent' | 'months' | 'count' | 'shares';
export type ComputedClaim = {
  surface: ClaimSurface; surface_version: string; field_key: string; claim_kind: string; stated_value: string | null; unit: Unit | null;
  state: ClaimState; record: Candidate | null; linked: PinnedItem[];
};

const rankOf = (c: Pick<Candidate, 'label' | 'observed_on'>) => SOURCE_RANK[c.label] ?? 99;
/** Best source first, then the newest observation; an undated record after a dated one. */
export function bestFirst<T extends Pick<Candidate, 'label' | 'observed_on'> & { items?: PinnedItem[] }>(list: T[]): T[] {
  return [...list].sort((a, b) => rankOf(a) - rankOf(b)
    || String(b.observed_on ?? '').localeCompare(String(a.observed_on ?? ''))
    || Number(b.items?.[0]?.id ?? 0) - Number(a.items?.[0]?.id ?? 0));
}

/**
 * A figure's state: the best-sourced record decides. It is Backed only when
 * that record is not Typed and agrees; a Typed record that agrees is the
 * founder's figure; any record that disagrees is a Mismatch.
 */
export function decideFigure(stated: number, candidates: Candidate[]): Decision {
  const comparable = bestFirst(candidates.filter((c) => c.value != null && Number.isFinite(c.value)));
  const best = comparable[0];
  const bearing = comparable.flatMap((c) => c.items);
  if (!best || !Number.isFinite(stated)) return { state: 'not_backed', record: null, bearing };
  if (!agrees(stated, Number(best.value))) return { state: 'mismatch', record: best, bearing };
  return { state: best.label === 'typed' ? 'founders_figure' : 'backed', record: best, bearing };
}
/** A claim's state, the record that decided it, and every pinned item that bears on it (its `computed` links). */
export type Decision = { state: ClaimState; record: Candidate | null; bearing: PinnedItem[] };

/** A claim backed by presence (a readiness item): any non-Typed record backs it; Typed alone is the founder's figure. */
export function decidePresence(candidates: Candidate[]): Decision {
  const best = bestFirst(candidates)[0];
  const bearing = candidates.flatMap((c) => c.items);
  if (!best) return { state: 'not_backed', record: null, bearing };
  return { state: best.label === 'typed' ? 'founders_figure' : 'backed', record: best, bearing };
}

/**
 * A count (interviews, letters of intent, waitlist sign-ups): the pinned
 * records not typed are counted first; if that count agrees the claim is
 * Backed. If it only agrees once Typed records are added, it is the founder's
 * figure. Otherwise it is a Mismatch with the best count.
 */
export function decideCount(stated: number, items: PinnedItem[]): Decision {
  if (!items.length || !Number.isFinite(stated)) return { state: 'not_backed', record: null, bearing: items };
  const strong = items.filter((i) => i.source_label !== 'typed');
  const newest = (list: PinnedItem[]) => list.map((i) => i.observed_on).filter(Boolean).sort().at(-1) ?? null;
  const asCandidate = (list: PinnedItem[]): Candidate => ({
    value: list.length, label: bestFirst(list.map((i) => ({ label: i.source_label, observed_on: i.observed_on })))[0]?.label ?? 'typed',
    provider: null, observed_on: newest(list), items: list,
  });
  if (strong.length && agrees(stated, strong.length)) return { state: 'backed', record: asCandidate(strong), bearing: items };
  // A count that needs a Typed record to agree is, as a whole, the founder's figure.
  const all: Candidate = strong.length < items.length ? { ...asCandidate(items), label: 'typed' } : asCandidate(items);
  if (strong.length < items.length && agrees(stated, items.length)) return { state: 'founders_figure', record: all, bearing: items };
  return { state: 'mismatch', record: strong.length ? asCandidate(strong) : all, bearing: items };
}

const suffix = (ref: string) => ref.slice(ref.lastIndexOf(':') + 1);
const prefix = (ref: string) => ref.split(':')[0];
const usdOrNone = (i: PinnedItem) => i.currency == null || i.currency.toLowerCase() === 'usd';
const one = (i: PinnedItem, value: number): Candidate => ({ value, label: i.source_label, provider: i.provider, observed_on: i.observed_on, items: [i] });

/**
 * Which pinned items measure a figure, and in the figure's own unit. A KPI
 * snapshot is one metric per item (`<row>:<metric>`); a bank revenue item is
 * cents or a growth percentage; the model's assumptions are Typed.
 */
const MEASURES: Partial<Record<FigureKey, (i: PinnedItem) => number | null>> = {
  mrr: (i) => (i.kind === 'kpi-snapshot' && suffix(i.source_ref) === 'mrr' ? i.value_num : null),
  arr: (i) => (i.kind === 'kpi-snapshot' && suffix(i.source_ref) === 'arr' ? i.value_num : null),
  paying_customers: (i) => (i.kind === 'kpi-snapshot' && suffix(i.source_ref) === 'paying_accounts' ? i.value_num : null),
  revenue: (i) => (i.kind === 'bank-revenue' && i.value_unit === 'cents' && i.value_num != null && usdOrNone(i) ? i.value_num / 100 : null),
  revenue_growth: (i) => (i.kind === 'bank-revenue' && i.value_unit === 'percent' ? i.value_num : null),
  net_burn: (i) => (i.kind === 'kpi-snapshot' && suffix(i.source_ref) === 'net_burn' ? i.value_num : null),
  runway: (i) => (i.kind === 'bank-runway' && i.value_unit === 'months' ? i.value_num : null),
  churn: (i) => (['kpi-snapshot', 'model-assumption'].includes(i.kind) && suffix(i.source_ref) === 'monthly_churn_pct' ? i.value_num : null),
  cac: (i) => (['kpi-snapshot', 'model-assumption'].includes(i.kind) && suffix(i.source_ref) === 'cac' ? i.value_num : null),
  headcount: (i) => (i.kind === 'kpi-snapshot' && suffix(i.source_ref) === 'headcount' ? i.value_num : null),
  // `raise` and `pilots`: no rule in D1263's table records either, so they are Not backed until one does.
};
/** The figures that are counts of pinned records, not a value one record holds. */
const COUNTED: Partial<Record<FigureKey, (i: PinnedItem, signalKind: Map<string, string>) => string | null>> = {
  interviews: (i) => (['icp-fit', 'consented-quote'].includes(i.kind) ? prefix(i.source_ref) : null),
  lois: (i, kinds) => (['demand-signal', 'loi-file'].includes(i.kind) && kinds.get(prefix(i.source_ref)) === 'loi' ? prefix(i.source_ref) : null),
  waitlist: (i, kinds) => (i.kind === 'demand-signal' && kinds.get(prefix(i.source_ref)) === 'waitlist' ? prefix(i.source_ref) : null),
};

/** A figure's candidates among the pinned items, never the claim's own record. */
export function figureClaim(figure: FigureKey, stated: number, items: PinnedItem[], signalKind: Map<string, string>, own: (i: PinnedItem) => boolean = () => false) {
  const pool = items.filter((i) => !own(i));
  const count = COUNTED[figure];
  if (count) {
    const seen = new Map<string, PinnedItem>();
    for (const i of bestFirst(pool.map((i) => ({ label: i.source_label, observed_on: i.observed_on, items: [i] })))) {
      const key = count(i.items[0], signalKind);
      if (key != null && !seen.has(key)) seen.set(key, i.items[0]);
    }
    return decideCount(stated, [...seen.values()]);
  }
  const measure = MEASURES[figure];
  const candidates = measure ? pool.flatMap((i) => { const v = measure(i); return v == null ? [] : [one(i, v)]; }) : [];
  return decideFigure(stated, candidates);
}

/** The readiness items that are claims, and the evidence kind each needs (D1263's `backs`). */
export const READINESS_CLAIMS = { traction: 'traction_proof', team: 'team', pmf: 'customer_evidence' } as const;

/** The capital model's drivers that are claims, and the figure each is measured as. */
export const MODEL_CLAIMS: Record<string, { kind: string; unit: Unit; measure: (i: PinnedItem) => number | null }> = {
  monthly_growth_pct: { kind: 'growth', unit: 'percent', measure: (i) => (i.kind === 'bank-revenue' && i.value_unit === 'percent' ? i.value_num : null) },
  monthly_churn_pct: { kind: 'churn', unit: 'percent', measure: (i) => (i.kind === 'kpi-snapshot' && suffix(i.source_ref) === 'monthly_churn_pct' ? i.value_num : null) },
  cac: { kind: 'cac', unit: 'money', measure: (i) => (i.kind === 'kpi-snapshot' && suffix(i.source_ref) === 'cac' ? i.value_num : null) },
  // Gross margin: no rule records a measured margin yet, so it is Not backed.
  gross_margin_pct: { kind: 'margin', unit: 'percent', measure: () => null },
};

/** The figures one piece of text states, each a claim on that field. */
function statedClaims(surface: ClaimSurface, version: string, field: string, text: string, items: PinnedItem[], kinds: Map<string, string>): ComputedClaim[] {
  const out: ComputedClaim[] = [];
  const seen = new Set<FigureKey>();
  for (const s of parseStatedFigures(field, text)) {
    if (seen.has(s.figure)) continue;
    seen.add(s.figure);
    const { state, record, bearing } = figureClaim(s.figure, s.value, items, kinds);
    out.push({ surface, surface_version: version, field_key: `${field}#${s.figure}`, claim_kind: s.figure, stated_value: String(s.value), unit: FIGURE_UNIT[s.figure], state, record, linked: bearing });
  }
  return out;
}

/** Every string inside a slide, in order; a slide that is not an object or a string states nothing. */
export function slideText(v: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap((x) => slideText(x, depth + 1));
  if (v && typeof v === 'object') return Object.values(v).flatMap((x) => slideText(x, depth + 1));
  return [];
}

export type Surface = { surface: ClaimSurface; version: string | null; state: 'recorded' | 'unreadable'; claims: ComputedClaim[] };

export async function pinnedItems(env: Env, projectId: number): Promise<PinnedItem[]> {
  const r = await env.DB.prepare(
    `SELECT id, uid, kind, source_table, source_ref, source_label, provider, observed_on, value_num, value_unit, currency, private_reason
       FROM raise_evidence_items WHERE project_id = ? AND state = 'pinned' ORDER BY id`,
  ).bind(projectId).all<PinnedItem>();
  return r.results || [];
}

/** The founder's and Eadwyn's own links, which back a presence claim beside the computed match. */
async function manualLinks(env: Env, projectId: number): Promise<Map<string, number[]>> {
  const r = await env.DB.prepare(
    `SELECT c.surface, c.surface_version, c.field_key, l.item_id FROM raise_claim_evidence l
       JOIN raise_claims c ON c.id = l.claim_id AND c.project_id = l.project_id
      WHERE l.project_id = ? AND l.how IN ('founder', 'eadwyn_accepted')`,
  ).bind(projectId).all<{ surface: string; surface_version: string; field_key: string; item_id: number }>();
  const out = new Map<string, number[]>();
  for (const l of r.results || []) {
    const key = JSON.stringify([l.surface, l.surface_version, l.field_key]);
    out.set(key, [...(out.get(key) || []), Number(l.item_id)]);
  }
  return out;
}

/** The kind of each pinned demand signal, read from its own row (bound, by id). */
export async function signalKinds(env: Env, projectId: number, items: PinnedItem[]): Promise<Map<string, string>> {
  const ids = [...new Set(items.filter((i) => i.source_table === 'demand_signals').map((i) => Number(prefix(i.source_ref))).filter(Number.isSafeInteger))];
  if (!ids.length) return new Map();
  const r = await env.DB.prepare('SELECT id, kind FROM demand_signals WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))')
    .bind(projectId, JSON.stringify(ids)).all<{ id: number; kind: string }>();
  return new Map((r.results || []).map((s) => [String(s.id), String(s.kind)]));
}

async function surface(name: ClaimSurface, run: () => Promise<{ version: string | null; claims: ComputedClaim[] }>): Promise<Surface> {
  try { return { surface: name, state: 'recorded', ...(await run()) }; }
  catch { return { surface: name, version: null, state: 'unreadable', claims: [] }; }
}

/**
 * A narrative version's figures, one claim per field and figure (D1264). With
 * no version, the newest saved one; D912's check passes the version asked about.
 */
export const narrative = (env: Env, projectId: number, items: PinnedItem[], kinds: Map<string, string>, asked?: number | null) => surface('narrative', async () => {
  const latest = asked != null ? { v: asked } : await env.DB.prepare('SELECT MAX(version) AS v FROM spinout_deck_overrides WHERE project_id = ? AND version > 0')
    .bind(projectId).first<{ v: number | null }>();
  if (latest?.v == null) return { version: null, claims: [] };
  const version = `v${latest.v}`;
  const words = await env.DB.prepare('SELECT field_key, value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key != ? ORDER BY field_key')
    .bind(projectId, latest.v, VERSION_MARKER_KEY).all<{ field_key: string; value: string }>();
  const meta = await env.DB.prepare('SELECT why_now FROM narrative_version_meta WHERE project_id = ? AND version = ?').bind(projectId, latest.v).first<{ why_now: string | null }>();
  const claims = (words.results || []).flatMap((w) => statedClaims('narrative', version, w.field_key, w.value, items, kinds));
  if (meta?.why_now) claims.push(...statedClaims('narrative', version, 'why_now', meta.why_now, items, kinds));
  return { version, claims };
});

/** A deck version as `pitch_decks` holds it. */
export type DeckRow = { id: number; version: number; slides: string | null };

/**
 * One deck version's figures, slide by slide (D1264). With no row, the
 * current deck; D900's check passes the version it was asked about. A deck
 * whose slides cannot be read is unreadable, not empty.
 */
export const deck = (env: Env, projectId: number, items: PinnedItem[], kinds: Map<string, string>, row?: DeckRow | null) => surface('deck', async () => {
  const d = row ?? await env.DB.prepare('SELECT id, version, slides FROM pitch_decks WHERE project_id = ? ORDER BY COALESCE(is_current, 0) DESC, version DESC, id DESC LIMIT 1')
    .bind(projectId).first<DeckRow>();
  if (!d) return { version: null, claims: [] };
  const slides: unknown = JSON.parse(String(d.slides));
  if (!Array.isArray(slides)) throw new Error('deck_unreadable');
  const version = deckVersion(d);
  return { version, claims: slides.flatMap((s, i) => statedClaims('deck', version, `slide:${i + 1}`, slideText(s).join('\n'), items, kinds)) };
});
/** A deck version's `surface_version`: `v<n>`. */
export const deckVersion = (d: { version: number | null }) => `v${Number(d.version) || 1}`;

/** Traction proof, Team and Product-market fit, where the venture's readiness list holds them. */
const readiness = (env: Env, projectId: number, items: PinnedItem[], links: Map<string, number[]>) => surface('readiness', async () => {
  const r = await env.DB.prepare('SELECT item_key FROM readiness_items WHERE project_id = ? AND item_key IN (SELECT value FROM json_each(?)) ORDER BY position, id')
    .bind(projectId, JSON.stringify(Object.keys(READINESS_CLAIMS))).all<{ item_key: keyof typeof READINESS_CLAIMS }>();
  const claims = (r.results || []).map((row): ComputedClaim => {
    const kind = READINESS_CLAIMS[row.item_key];
    const linkedIds = new Set(links.get(JSON.stringify(['readiness', 'current', row.item_key])) || []);
    const backing = items.filter((i) => EVIDENCE_RULES.find((rule) => rule.kind === i.kind)?.backs.includes(kind) || linkedIds.has(i.id));
    const { state, record, bearing } = decidePresence(backing.map((i): Candidate => ({ value: null, label: i.source_label, provider: i.provider, observed_on: i.observed_on, items: [i] })));
    return { surface: 'readiness', surface_version: 'current', field_key: row.item_key, claim_kind: kind, stated_value: null, unit: null, state, record, linked: bearing };
  });
  return { version: 'current', claims };
});

/**
 * Each section's planned share against the share of the bank spend mapped to
 * it (D840's accepted mappings), over the shortest window pinned (3, 6 or 12
 * months). A section with no mapped spend in a window that has spend is a
 * measured 0%.
 */
const useOfFunds = (env: Env, projectId: number, items: PinnedItem[]) => surface('use_of_funds', async () => {
  const p = await env.DB.prepare('SELECT use_of_funds FROM projects WHERE id = ?').bind(projectId).first<{ use_of_funds: string | null }>();
  const plan = parseUseOfFundsValue(p?.use_of_funds);
  if (!plan.length) return { version: 'current', claims: [] };
  const spend = items.filter((i) => i.kind === 'mapped-bank-spend' && i.value_num != null && usdOrNone(i));
  const facts = spend.length ? await env.DB.prepare(
    `SELECT f.id, f.months, m.target FROM mercury_raise_facts f
       JOIN mercury_raise_proposals m ON m.integration_id = f.integration_id AND m.project_id = f.project_id AND m.kind = 'fund_mapping' AND m.status = 'accepted' AND m.source_key = f.label
      WHERE f.project_id = ? AND f.kind = 'spend' AND f.id IN (SELECT value FROM json_each(?))`,
  ).bind(projectId, JSON.stringify(spend.map((i) => Number(i.source_ref)).filter(Number.isSafeInteger))).all<{ id: number; months: number; target: string }>() : { results: [] };
  const fact = new Map((facts.results || []).map((f) => [String(f.id), f]));
  const windows = [...new Set(spend.map((i) => fact.get(i.source_ref)?.months).filter((m): m is number => m != null))].sort((a, b) => a - b);
  const window = windows[0];
  const inWindow = spend.filter((i) => fact.get(i.source_ref)?.months === window);
  const total = inWindow.reduce((n, i) => n + Number(i.value_num), 0);
  const claims = plan.flatMap((line): ComputedClaim[] => {
    const section = FUND_SECTIONS.find((s) => s.label === line.label);
    if (!section) return [];
    const mine = inWindow.filter((i) => fact.get(i.source_ref)?.target === section.key);
    const record: Candidate | null = total > 0 ? {
      value: Math.round((mine.reduce((n, i) => n + Number(i.value_num), 0) / total) * 1000) / 10, label: 'connector', provider: 'mercury',
      observed_on: inWindow.map((i) => i.observed_on).filter(Boolean).sort().at(-1) ?? null, items: inWindow,
    } : null;
    const { state } = record ? decideFigure(line.pct, [record]) : { state: 'not_backed' as const };
    return [{ surface: 'use_of_funds', surface_version: 'current', field_key: `section:${section.key}`, claim_kind: 'use_of_funds_section', stated_value: String(line.pct), unit: 'percent', state, record: state === 'not_backed' ? null : record, linked: record ? inWindow : [] }];
  });
  return { version: 'current', claims };
});

/** Each founder holding's shares against the vesting recorded for that holder; the holding itself never backs its own row. */
const capTable = (env: Env, projectId: number, items: PinnedItem[]) => surface('cap_table', async () => {
  const holders = await env.DB.prepare(
    `SELECT id, shares FROM cap_table_holders WHERE project_id = ? AND (kind = 'founder' OR founder_role IS NOT NULL) AND shares IS NOT NULL ORDER BY id`,
  ).bind(projectId).all<{ id: number; shares: number }>();
  if (!(holders.results || []).length) return { version: 'current', claims: [] };
  const vesting = items.filter((i) => i.kind === 'vesting-schedule' && i.value_unit === 'shares');
  const owners = vesting.length ? await env.DB.prepare(
    `SELECT v.id, v.holder_id FROM cap_table_vesting v JOIN cap_table_holders h ON h.id = v.holder_id
      WHERE h.project_id = ? AND v.id IN (SELECT value FROM json_each(?))`,
  ).bind(projectId, JSON.stringify(vesting.map((i) => Number(prefix(i.source_ref))).filter(Number.isSafeInteger))).all<{ id: number; holder_id: number }>() : { results: [] };
  const holderOf = new Map((owners.results || []).map((o) => [String(o.id), Number(o.holder_id)]));
  return {
    version: 'current',
    claims: (holders.results || []).map((h): ComputedClaim => {
      const mine = vesting.filter((i) => holderOf.get(prefix(i.source_ref)) === Number(h.id)).map((i) => one(i, Number(i.value_num)));
      const { state, record, bearing } = decideFigure(Number(h.shares), mine);
      return { surface: 'cap_table', surface_version: 'current', field_key: `holder:${h.id}`, claim_kind: 'holder_shares', stated_value: String(h.shares), unit: 'shares', state, record, linked: bearing };
    }),
  };
});

/** The model's growth, churn, CAC and margin assumptions against what is measured; the model never backs itself. */
const capitalModel = (env: Env, projectId: number, items: PinnedItem[]) => surface('capital_model', async () => {
  const m = await env.DB.prepare('SELECT assumptions_json FROM financial_models WHERE project_id = ?').bind(projectId).first<{ assumptions_json: string | null }>();
  if (!m?.assumptions_json) return { version: 'current', claims: [] };
  const a: unknown = JSON.parse(m.assumptions_json);
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('model_unreadable');
  const claims: ComputedClaim[] = [];
  for (const [driver, def] of Object.entries(MODEL_CLAIMS)) {
    const v = (a as Record<string, unknown>)[driver];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    // Each measure reads a measured figure only, never `model-assumption`: the model does not back itself.
    const candidates = items.flatMap((i) => { const x = def.measure(i); return x == null ? [] : [one(i, x)]; });
    const { state, record, bearing } = decideFigure(v, candidates);
    claims.push({ surface: 'capital_model', surface_version: 'current', field_key: driver, claim_kind: def.kind, stated_value: String(v), unit: def.unit, state, record, linked: bearing });
  }
  return { version: 'current', claims };
});

export type ClaimCheck = { outcome: 'recorded' | 'partial' | 'unreadable'; surfaces: Array<{ surface: ClaimSurface; state: 'recorded' | 'unreadable'; claims: number | null }>; claims: ComputedClaim[]; written: number };

/** Every claim's state from the pinned evidence, computed; nothing is written. */
export async function computeClaims(env: Env, projectId: number): Promise<{ surfaces: Surface[] }> {
  const items = await pinnedItems(env, projectId);
  const [kinds, links] = await Promise.all([signalKinds(env, projectId, items), manualLinks(env, projectId)]);
  const surfaces = await Promise.all([
    narrative(env, projectId, items, kinds), deck(env, projectId, items, kinds), readiness(env, projectId, items, links),
    useOfFunds(env, projectId, items), capTable(env, projectId, items), capitalModel(env, projectId, items),
  ]);
  return { surfaces };
}

const MAX_WRITES = 500;
const nonce = () => crypto.randomUUID().replaceAll('-', '');
const claimKey = (c: { surface: string; surface_version: string; field_key: string }) => JSON.stringify([c.surface, c.surface_version, c.field_key]);

/**
 * Run the check and write what changed: a claim's kind, stated value or state,
 * and its `computed` links. A claim of a surface's current version that is no
 * longer stated is removed unless the founder or Eadwyn linked it. Older
 * versions keep their last state.
 */
export async function checkClaims(env: Env, projectId: number, now = new Date().toISOString()): Promise<ClaimCheck> {
  const { surfaces } = await computeClaims(env, projectId);
  return writeSurfaces(env, projectId, surfaces, now);
}

/**
 * D900 (#2679): one deck version, checked and written as the Evidence read
 * checks the current one. Other surfaces and other versions are untouched.
 */
export async function checkDeckVersion(env: Env, projectId: number, row: DeckRow, now = new Date().toISOString()): Promise<ClaimCheck> {
  const items = await pinnedItems(env, projectId);
  const kinds = await signalKinds(env, projectId, items);
  return writeSurfaces(env, projectId, [await deck(env, projectId, items, kinds, row)], now);
}

/**
 * D912 (#2696): one narrative version, checked and written as the Evidence
 * read checks the newest. Other surfaces and other versions are untouched.
 */
export async function checkNarrativeVersion(env: Env, projectId: number, version: number, now = new Date().toISOString()): Promise<ClaimCheck> {
  const items = await pinnedItems(env, projectId);
  const kinds = await signalKinds(env, projectId, items);
  return writeSurfaces(env, projectId, [await narrative(env, projectId, items, kinds, version)], now);
}

/** Writes what changed for the surfaces given; the one writer both checks share. */
export async function writeSurfaces(env: Env, projectId: number, surfaces: Surface[], now = new Date().toISOString()): Promise<ClaimCheck> {
  const read = surfaces.filter((s) => s.state === 'recorded');
  const computed = read.flatMap((s) => s.claims).slice(0, MAX_WRITES);
  const existing = (await env.DB.prepare(
    `SELECT c.id, c.surface, c.surface_version, c.field_key, c.claim_kind, c.stated_value, c.state, c.checked_at,
            (SELECT json_group_array(l.item_id) FROM raise_claim_evidence l WHERE l.claim_id = c.id AND l.how = 'computed') AS computed_json,
            EXISTS (SELECT 1 FROM raise_claim_evidence l WHERE l.claim_id = c.id AND l.how <> 'computed') AS manual
       FROM raise_claims c WHERE c.project_id = ?`,
  ).bind(projectId).all<{ id: number; surface: string; surface_version: string; field_key: string; claim_kind: string; stated_value: string | null; state: string; checked_at: string | null; computed_json: string; manual: number }>()).results || [];
  const byKey = new Map(existing.map((e) => [claimKey(e), e]));
  const at = now.slice(0, 19).replace('T', ' ');
  const statements: D1PreparedStatement[] = [];
  for (const c of computed) {
    const prior = byKey.get(claimKey(c));
    const want = [...new Set([...(c.record?.items ?? []), ...c.linked].map((i) => Number(i.id)))].sort((a, b) => a - b);
    const have = prior ? (JSON.parse(prior.computed_json || '[]') as number[]).map(Number).sort((a, b) => a - b) : [];
    const same = prior && prior.claim_kind === c.claim_kind && prior.stated_value === c.stated_value && prior.state === c.state && prior.checked_at != null
      && JSON.stringify(want) === JSON.stringify(have);
    if (same) continue;
    statements.push(env.DB.prepare(
      `INSERT INTO raise_claims (uid, project_id, surface, surface_version, field_key, claim_kind, stated_value, state, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, surface, surface_version, field_key) DO UPDATE SET
         claim_kind = excluded.claim_kind, stated_value = excluded.stated_value, state = excluded.state, checked_at = excluded.checked_at`,
    ).bind(nonce(), projectId, c.surface, c.surface_version, c.field_key, c.claim_kind, c.stated_value, c.state, at));
    statements.push(env.DB.prepare(
      `DELETE FROM raise_claim_evidence WHERE project_id = ? AND how = 'computed'
         AND claim_id = (SELECT id FROM raise_claims WHERE project_id = ? AND surface = ? AND surface_version = ? AND field_key = ?)
         AND item_id NOT IN (SELECT value FROM json_each(?))`,
    ).bind(projectId, projectId, c.surface, c.surface_version, c.field_key, JSON.stringify(want)));
    for (const itemId of want) {
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO raise_claim_evidence (project_id, claim_id, item_id, how, mutation_uid)
         SELECT ?, (SELECT id FROM raise_claims WHERE project_id = ? AND surface = ? AND surface_version = ? AND field_key = ?), i.id, 'computed', ?
           FROM raise_evidence_items i WHERE i.id = ? AND i.project_id = ? AND i.state = 'pinned'`,
      ).bind(projectId, projectId, c.surface, c.surface_version, c.field_key, nonce(), itemId, projectId));
    }
  }
  // A current claim no longer stated goes, unless a person linked evidence to it.
  const stated = new Set(computed.map(claimKey));
  for (const s of read) {
    if (s.version == null) continue;
    for (const e of existing) {
      if (e.surface !== s.surface || e.surface_version !== s.version || stated.has(claimKey(e)) || Number(e.manual) === 1) continue;
      statements.push(env.DB.prepare('DELETE FROM raise_claims WHERE id = ? AND project_id = ?').bind(e.id, projectId));
    }
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  const unreadable = surfaces.filter((s) => s.state === 'unreadable').length;
  return {
    outcome: unreadable === 0 ? 'recorded' : unreadable === surfaces.length ? 'unreadable' : 'partial',
    surfaces: surfaces.map((s) => ({ surface: s.surface, state: s.state, claims: s.state === 'recorded' ? s.claims.length : null })),
    claims: computed, written: statements.length,
  };
}

/** What the founder reads beside a claim: the record it was compared with, its source and date, and the sentence. Never an admin's. */
export function claimRecord(c: ComputedClaim) {
  if (!c.record) return null;
  const figure = (c.claim_kind in FIGURE_LABEL ? c.claim_kind : null) as FigureKey | null;
  const show = (v: number | null) => (v == null ? null : figure ? fmtFigure(figure, v) : c.unit === 'percent' ? `${v}%` : c.unit === 'money' ? `$${v.toLocaleString('en-US')}` : String(v));
  return {
    value: c.record.value, shown: show(c.record.value), stated_shown: c.stated_value == null ? null : show(Number(c.stated_value)),
    source_label: c.record.label, provider: c.record.provider, observed_on: c.record.observed_on,
    items: c.record.items.map((i) => i.uid),
  };
}
