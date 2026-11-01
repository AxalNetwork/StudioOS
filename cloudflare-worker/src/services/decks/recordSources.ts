/**
 * D1520 (#3772, deck v2 A21) — the record sources the one-click deck needs
 * beyond D896's: market size, the financial projection, the competition
 * table, the round's valuation terms, the use of funds by section, and the
 * narrative's and positioning's own words.
 *
 * Every value is read from the venture's own records, never from a model,
 * and each carries its source and grade through `sources.ts`'s one mapping.
 * A value the venture has not recorded is left out, so `readSources` reports
 * it `not_recorded` — never 0 — and the missing-data cut can drop its card
 * and say where to add it.
 *
 *  - `market`: TAM, SAM and SOM from `projects.tam/sam/som`. Sourced when a
 *    market source is recorded (`market_sources`), Stated otherwise. The
 *    figures must nest, SOM ≤ SAM ≤ TAM: a figure larger than the one above it
 *    is left out, with everything below it, rather than shown as a market.
 *  - `financials`: the founder's financial model (`financial_models`,
 *    `routes/financials.ts`). A projection is a forecast, so the adapter is
 *    marked `projection`: `readSources` grades every one of its slots
 *    Projected, whatever origin it reports, and attaches the Projection
 *    label and its forward-looking footnote, which no binding can drop.
 *  - `competitors_detail`: the tracked competitors, direct and adjacent, and
 *    their names. Sourced only when every one listed has a source.
 *  - `round_terms`: pre-money from the latest round call's counsel terms
 *    (`round_calls.pre_money_cents`) or the active round (`raise_rounds.pre_money`);
 *    post-money and dilution only when both the pre-money and the round's
 *    target are recorded. Reviewed while counsel's approval covers the call.
 *  - `use_of_funds_sections`: `raise.use_of_funds.<section>`, one percent per
 *    `FUND_SECTIONS` entry, read from the same allocation as `use_of_funds`.
 *  - `narrative_text`: `raise.narrative.<section>` and
 *    `raise.positioning.<kind>`, the latest saved version's words (its
 *    `spinout_deck_overrides` version; version 0, the live deck, when none is saved), so #3768 can plan the
 *    whole deck from the narrative.
 */
import { loadTracked } from '../cycleValidate';
import { FUND_SECTIONS, parseAllocation } from '../raiseCycle';
import type { Adapter, Origin, Read } from './sources';

/** The words every projection carries, in every format (pd8b: "A projection keeps its label in every format."). */
export const PROJECTION_LABEL = 'Projection';
export const PROJECTION_FOOTNOTE = 'Forward-looking projection from the venture’s own model. It is not a result and may not be achieved.';

const q = (path: string) => (pid: number) => `${path}?project=${pid}`;
const day = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const positive = (v: unknown) => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const noTable = (e: unknown) => /no such table/i.test(String((e as Error)?.message ?? e));

// ─────────────────────────────────────────────────────────────── Market size

/** SOM ≤ SAM ≤ TAM: a figure that does not fit under the one above it is dropped, with those below it. */
export function nestedMarket(tam: number | null, sam: number | null, som: number | null) {
  const out = { tam, sam, som };
  if (out.sam != null && out.tam != null && out.sam > out.tam) { out.sam = null; out.som = null; }
  if (out.som != null && out.sam != null && out.som > out.sam) out.som = null;
  if (out.som != null && out.sam == null && out.tam != null && out.som > out.tam) out.som = null;
  return out;
}

const market: Adapter = {
  id: 'market', area: 'validate', module: 'Validate › Market intelligence', href: q('/validate/market-intelligence'),
  slots: [
    { key: 'validate.market_tam', label: 'Total market (TAM)', unit: 'usd' },
    { key: 'validate.market_sam', label: 'Serviceable market (SAM)', unit: 'usd' },
    { key: 'validate.market_som', label: 'Obtainable market (SOM)', unit: 'usd' },
  ],
  async read({ env, projectId }) {
    const p = await env.DB.prepare('SELECT tam, sam, som, updated_at FROM projects WHERE id = ?')
      .bind(projectId).first<{ tam: number | null; sam: number | null; som: number | null; updated_at: string | null }>();
    if (!p) return {};
    const fig = nestedMarket(positive(p.tam), positive(p.sam), positive(p.som));
    if (fig.tam == null && fig.sam == null && fig.som == null) return {};
    const src = await env.DB.prepare('SELECT COUNT(*) AS n FROM market_sources WHERE project_id = ?').bind(projectId).first<{ n: number }>();
    const origin: Origin = Number(src?.n) > 0 ? 'file' : 'typed';
    const as_of = day(p.updated_at);
    const out: Record<string, Read> = {};
    for (const [k, v] of [['tam', fig.tam], ['sam', fig.sam], ['som', fig.som]] as const) {
      if (v != null) out[`validate.market_${k}`] = { value: v, as_of, origin, record_ref: `projects:${projectId}:${k}` };
    }
    return out;
  },
};

// ─────────────────────────────────────────────────────────────── Financial projection

type Month = { month: number; revenue: number; cash: number };
type Computed = { months?: Month[]; runway_months?: number; breakeven_month?: number | null; ending_cash?: number };

const financials: Adapter = {
  id: 'financials', area: 'raise', module: 'Raise › Use of funds', href: q('/raise/use-of-funds'), projection: true,
  slots: [
    { key: 'raise.projection_revenue_12m', label: 'Projected revenue, next 12 months', unit: 'usd' },
    { key: 'raise.projection_runway', label: 'Projected runway', unit: 'months' },
    { key: 'raise.projection_breakeven', label: 'Projected break-even month', unit: 'months' },
    { key: 'raise.projection_ending_cash', label: 'Projected cash at the model’s horizon', unit: 'usd' },
  ],
  async read({ env, projectId }) {
    let row: { id: number; computed_json: string | null; updated_at: string | null } | null;
    try {
      row = await env.DB.prepare('SELECT id, computed_json, updated_at FROM financial_models WHERE project_id = ?')
        .bind(projectId).first<{ id: number; computed_json: string | null; updated_at: string | null }>();
    } catch (e) {
      // The table is created on the model's first save (routes/financials.ts): none yet is not recorded, not unreadable.
      if (noTable(e)) return {};
      throw e;
    }
    if (!row?.computed_json) return {};
    let c: Computed;
    try { c = JSON.parse(row.computed_json); } catch { throw new Error('financial model unreadable'); }
    const months = Array.isArray(c.months) ? c.months.filter((m) => Number.isFinite(Number(m?.revenue))) : [];
    const as_of = day(row.updated_at);
    const ref = `financial_models:${row.id}`;
    // Projected is set by readSources for this adapter; the origin only says where the model's inputs came from.
    const read = (value: number | null): Read | undefined => (value == null || !Number.isFinite(value) ? undefined : { value, as_of, origin: 'typed', record_ref: ref });
    const out: Record<string, Read | undefined> = {
      'raise.projection_revenue_12m': months.length ? read(Math.round(months.slice(0, 12).reduce((s, m) => s + Number(m.revenue), 0) * 100) / 100) : undefined,
      'raise.projection_runway': read(c.runway_months == null ? null : Number(c.runway_months)),
      'raise.projection_breakeven': read(c.breakeven_month == null ? null : Number(c.breakeven_month)),
      'raise.projection_ending_cash': read(c.ending_cash == null ? null : Number(c.ending_cash)),
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as Record<string, Read>;
  },
};

// ─────────────────────────────────────────────────────────────── Competition table

export const COMPETITOR_NAMES_MAX = 8;

const competitorsDetail: Adapter = {
  id: 'competitors_detail', area: 'validate', module: 'Validate › Market intelligence', href: q('/validate/market-intelligence'),
  slots: [
    { key: 'validate.competitors_direct', label: 'Direct competitors', unit: 'count' },
    { key: 'validate.competitors_adjacent', label: 'Adjacent competitors', unit: 'count' },
    { key: 'validate.competitors_names', label: 'Competitors', unit: 'text' },
  ],
  async read({ env, projectId, today }) {
    const tracked = await loadTracked({ env, projectId, today });
    if (!tracked.length) return {};
    const origin: Origin = tracked.every((t) => t.source_url || t.source_kind) ? 'file' : 'typed';
    const as_of = tracked.map((t) => t.latest_on).filter(Boolean).sort().pop() ?? null;
    const ref = `competitor_candidates:${tracked.length}`;
    const direct = tracked.filter((t) => t.kind === 'direct');
    const adjacent = tracked.filter((t) => t.kind === 'adjacent');
    const names = [...direct, ...adjacent].map((t) => t.name);
    const shown = names.slice(0, COMPETITOR_NAMES_MAX).join(' · ') + (names.length > COMPETITOR_NAMES_MAX ? ` · +${names.length - COMPETITOR_NAMES_MAX} more` : '');
    return {
      'validate.competitors_direct': { value: direct.length, as_of, origin, record_ref: ref },
      'validate.competitors_adjacent': { value: adjacent.length, as_of, origin, record_ref: ref },
      'validate.competitors_names': { value: shown, as_of, origin, record_ref: ref },
    };
  },
};

// ─────────────────────────────────────────────────────────────── Round terms

const roundTerms: Adapter = {
  id: 'round_terms', area: 'raise', module: 'Raise › Round planner', href: q('/raise/calls'),
  slots: [
    { key: 'raise.pre_money', label: 'Pre-money valuation', unit: 'usd' },
    { key: 'raise.post_money', label: 'Post-money valuation', unit: 'usd' },
    { key: 'raise.dilution_pct', label: 'Dilution', unit: 'percent' },
  ],
  async read({ env, projectId }) {
    const round = await env.DB.prepare(
      "SELECT id, target_amount, pre_money, updated_at FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
    ).bind(projectId).first<{ id: number; target_amount: number | null; pre_money: number | null; updated_at: string | null }>();
    const call = await env.DB.prepare(
      `SELECT id, pre_money_cents, updated_at,
              (counsel_approved_hash IS NOT NULL AND counsel_approved_hash = terms_hash AND counsel_approved_by IS NOT NULL
               AND counsel_approved_at IS NOT NULL AND counsel_approval_reference IS NOT NULL) AS approved
         FROM round_calls WHERE project_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(projectId).first<{ id: number; pre_money_cents: number | null; updated_at: string | null; approved: number }>();
    const origin: Origin = Number(call?.approved) === 1 ? 'counsel_approved' : 'typed';
    const fromCall = positive(call?.pre_money_cents);
    const pre = fromCall != null ? fromCall / 100 : positive(round?.pre_money);
    if (pre == null) return {};
    const preRef = fromCall != null ? `round_calls:${call!.id}` : `raise_rounds:${round!.id}`;
    const preAt = day(fromCall != null ? call?.updated_at : round?.updated_at);
    const out: Record<string, Read> = { 'raise.pre_money': { value: pre, as_of: preAt, origin, record_ref: preRef } };
    const target = positive(round?.target_amount);
    if (target != null) {
      const post = pre + target;
      const ref = `${preRef}+raise_rounds:${round!.id}`;
      const at = [preAt, day(round?.updated_at)].filter(Boolean).sort().pop() ?? null;
      out['raise.post_money'] = { value: post, as_of: at, origin, record_ref: ref };
      out['raise.dilution_pct'] = { value: Math.round((target / post) * 1000) / 10, as_of: at, origin, record_ref: ref };
    }
    return out;
  },
};

// ─────────────────────────────────────────────────────────────── Use of funds by section

/** A slot key segment is `[a-z0-9_]` (sanitizeBinding): `go-to-market` becomes `go_to_market`. */
export const fundSlotKey = (key: string) => `raise.use_of_funds.${key.replace(/-/g, '_')}`;

const useOfFundsSections: Adapter = {
  id: 'use_of_funds_sections', area: 'raise', module: 'Raise › Use of funds', href: q('/raise/use-of-funds'),
  slots: FUND_SECTIONS.map((s) => ({ key: fundSlotKey(s.key), label: s.label, unit: 'percent' as const })),
  async read({ env, projectId }) {
    const p = await env.DB.prepare('SELECT use_of_funds, updated_at FROM projects WHERE id = ?').bind(projectId)
      .first<{ use_of_funds: string | null; updated_at: string | null }>();
    const alloc = parseAllocation(p?.use_of_funds);
    if (!alloc) return {};
    const as_of = day(p?.updated_at);
    // A recorded allocation says what every section gets, a 0% section included.
    return Object.fromEntries(FUND_SECTIONS.map((s, i) => [fundSlotKey(s.key), { value: alloc[i], as_of, origin: 'typed' as Origin, record_ref: `projects:${projectId}:use_of_funds` }]));
  },
};

// ─────────────────────────────────────────────────────────────── Narrative and positioning words

/**
 * The narrative's sections and positioning kinds, as `narrative/store.ts`
 * lists them (`NARRATIVE_SECTIONS`, `POSITIONING_KINDS`). Written here and
 * the store loaded only inside the read: the store reaches `routes/decks.ts`
 * through `raiseWriters`, which reaches this registry, so a static import is a
 * cycle. `deck_record_sources_d1520.test.ts` checks the two lists are the store's.
 */
export const NARRATIVE_SECTION_KEYS = [
  ['problem', 'Problem'], ['solution', 'Solution'], ['why_now', 'Why now'], ['market', 'Market'], ['traction', 'Traction'],
  ['business_model', 'Business model'], ['competition', 'Competition'], ['team', 'Team'], ['ask', 'The ask'], ['closing', 'Closing line'],
] as const;
export const POSITIONING_KIND_KEYS = ['one_liner', 'elevator', 'line', 'category', 'wedge', 'for_whom', 'instead_of'] as const;

const wordsOrigin = (label: string | null | undefined): Origin => (label === 'document' ? 'file' : 'typed');

const narrativeText: Adapter = {
  id: 'narrative_text', area: 'raise', module: 'Raise › Investor narrative', href: q('/raise/investor-narrative'),
  slots: [
    ...NARRATIVE_SECTION_KEYS.map(([key, label]) => ({ key: `raise.narrative.${key}`, label, unit: 'text' as const })),
    ...POSITIONING_KIND_KEYS.map((k) => ({ key: `raise.positioning.${k}`, label: `Positioning · ${k.replace(/_/g, ' ')}`, unit: 'text' as const })),
  ],
  async read({ env, projectId }) {
    // A saved version is a `spinout_deck_overrides` version (ownVersion); version 0 is the live deck's words.
    const latest = await env.DB.prepare('SELECT MAX(version) AS v FROM spinout_deck_overrides WHERE project_id = ? AND version > 0')
      .bind(projectId).first<{ v: number | null }>();
    const version = Number(latest?.v) > 0 ? Number(latest!.v) : 0;
    const { readNarrative, readPositioning } = await import('../narrative/store');
    const n = await readNarrative(env, projectId, version);
    if (n.sections.state !== 'ok') throw new Error('narrative sections unreadable');
    const out: Record<string, Read> = {};
    for (const s of (n.sections as any).items as Array<{ key: string; body: string | null; source: { label: string | null } | null; updated_at: string | null }>) {
      if (s.body) out[`raise.narrative.${s.key}`] = { value: s.body, as_of: day(s.updated_at), origin: wordsOrigin(s.source?.label), record_ref: `narrative:v${version}:${s.key}` };
    }
    const pos = await readPositioning(env, projectId, version === 0 ? null : version);
    for (const kind of POSITIONING_KIND_KEYS) {
      const lines = pos.effective.filter((p) => p.kind === kind && p.text && p.text.trim());
      if (!lines.length) continue;
      out[`raise.positioning.${kind}`] = {
        value: lines.map((l) => l.text.trim()).join('\n'),
        as_of: lines.map((l) => day(l.updated_at)).filter(Boolean).sort().pop() ?? null,
        origin: lines.every((l) => l.source?.label === 'document') ? 'file' : 'typed',
        record_ref: `narrative_positioning:${version === 0 ? 'core' : `v${version}`}:${kind}`,
      };
    }
    return out;
  },
};

/** D1520's adapters, in the order `DECK_SOURCES` lists them after D896's. */
export const RECORD_SOURCES: Adapter[] = [market, competitorsDetail, roundTerms, useOfFundsSections, financials, narrativeText];
