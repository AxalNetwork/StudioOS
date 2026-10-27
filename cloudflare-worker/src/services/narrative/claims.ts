/**
 * D912 (#2696, part 6 of #2454) — the narrative's claims (NAR6, NAR7) and its
 * check against the deck and the metrics (NAR8).
 *
 * THE STATES ARE D1264'S. A narrative version's figures are D1264's
 * `narrative` surface: each figure a section states, read by fixed patterns,
 * written to `raise_claims` (`surface = 'narrative'`, `surface_version =
 * 'v<n>'`) as Backed, Founder's figure, Mismatch or Not backed from the
 * founder's pinned evidence. This file reads them for the Claims tab, with:
 *
 *   best source    the record a claim was compared with (Connector, Signed,
 *                  Document, Recorded, Typed); none for Not backed
 *   candidates     the pinned records of the figure's kind that are not linked
 *                  to the claim ("Evidence candidates", NAR7), never a model's
 *   Eadwyn's links open `raise:evidence-link` proposals for the claim (lavender)
 *   the note       "Keep mine, with a note" (D900, migration 645)
 *
 * THE CHECK (NAR8) compares each figure the version states with the current
 * deck's figure (read from its cards, bound or typed) and the metric stores,
 * as the version's "Check against" chooses (#2447). A figure stated in one
 * place only is Not compared.
 *
 * Nothing here logs a figure; all SQL is bound.
 */
import type { Env } from '../../types';
import { agrees, checkInputs, FIGURE_LABEL, fmtFigure, parseStatedFigures, type FigureKey } from '../raiseCycle';
import { selectedCheckSources } from '../raiseEvidence';
import { claimRecord, slideText, type ComputedClaim } from '../raiseClaims';
import { noteApplies } from '../deckCheck';
import { NARRATIVE_SECTIONS } from './store';

export const CLAIM_STATES = ['backed', 'founders_figure', 'mismatch', 'not_backed'] as const;
export const SOURCE_LABELS = ['connector', 'signed', 'document', 'recorded', 'typed'] as const;
const SOURCE_RANK: Record<string, number> = { connector: 0, signed: 1, document: 2, recorded: 3, typed: 4 };
const LINK_OPTION = 'raise:evidence-link';

/** The pinned record kinds that could back each figure: the Evidence candidates NAR7 offers. */
export const FIGURE_KINDS: Record<FigureKey, string[]> = {
  mrr: ['kpi-snapshot'], arr: ['kpi-snapshot'], paying_customers: ['kpi-snapshot'], headcount: ['kpi-snapshot'],
  revenue: ['bank-revenue'], revenue_growth: ['bank-revenue'], net_burn: ['kpi-snapshot', 'bank-runway'], runway: ['bank-runway'],
  churn: ['kpi-snapshot', 'model-assumption'], cac: ['kpi-snapshot', 'model-assumption'],
  interviews: ['icp-fit', 'consented-quote'], lois: ['demand-signal', 'loi-file'], waitlist: ['demand-signal'], pilots: ['demand-signal'],
  raise: [],
};

/** A KPI snapshot or a model assumption holds one metric (`<row>:<metric>`): the one each figure reads. */
const FIGURE_METRIC: Partial<Record<FigureKey, string>> = {
  mrr: 'mrr', arr: 'arr', paying_customers: 'paying_accounts', headcount: 'headcount', net_burn: 'net_burn', churn: 'monthly_churn_pct', cac: 'cac',
};
const ONE_METRIC = new Set(['kpi-snapshot', 'model-assumption']);

/** May this pinned record back this figure: its kind, and for a one-metric record its metric. */
export function couldBack(figure: FigureKey, item: { kind: string; source_ref?: string | null }): boolean {
  if (!FIGURE_KINDS[figure].includes(item.kind)) return false;
  if (!ONE_METRIC.has(item.kind)) return true;
  const ref = String(item.source_ref ?? '');
  return ref.slice(ref.lastIndexOf(':') + 1) === FIGURE_METRIC[figure];
}

/** The section a claim's field belongs to: a deck row's key, Why now, or a section-store `section:<key>`. */
export function sectionOfField(field: string): { key: string; label: string } | null {
  if (field === 'why_now') return { key: 'why_now', label: 'Why now' };
  const s = field.startsWith('section:')
    ? NARRATIVE_SECTIONS.find((x) => x.store === 'section' && `section:${x.key}` === field)
    : NARRATIVE_SECTIONS.find((x) => x.deckKey === field);
  return s ? { key: s.key, label: s.label } : null;
}

type StoredClaim = {
  id: number; uid: string; field_key: string; claim_kind: string; stated_value: string | null; state: string; checked_at: string | null;
  note: string | null; note_value: string | null; noted_at: string | null;
};
type Item = { id: number; uid: string; kind: string; source_ref?: string | null; source_label: string; provider: string | null; observed_on: string | null; summary: string | null; version: number };

const itemView = (i: Item) => ({ uid: i.uid, kind: i.kind, source_label: i.source_label, provider: i.provider, observed_on: i.observed_on, summary: i.summary, version: i.version });
const bestOf = (items: Item[]) => [...items].sort((a, b) => (SOURCE_RANK[a.source_label] ?? 9) - (SOURCE_RANK[b.source_label] ?? 9) || String(b.observed_on ?? '').localeCompare(String(a.observed_on ?? '')))[0] ?? null;
const figureOf = (k: string) => (k in FIGURE_LABEL ? k as FigureKey : null);

/**
 * NAR6 and NAR7: the claims of one narrative version. The founder reads both
 * figures, the records, the candidates and Eadwyn's links; any other reader
 * (an admin with a reason, D914) reads each claim's state and best source.
 */
export async function narrativeClaims(env: Env, projectId: number, version: number, opts: { founder: boolean; computed?: ComputedClaim[] }) {
  const v = `v${version}`;
  const stored = (await env.DB.prepare(
    `SELECT id, uid, field_key, claim_kind, stated_value, state, checked_at, note, note_value, noted_at
       FROM raise_claims WHERE project_id = ? AND surface = 'narrative' AND surface_version = ? ORDER BY id`,
  ).bind(projectId, v).all<StoredClaim>()).results || [];
  const links = stored.length ? (await env.DB.prepare(
    `SELECT l.claim_id, l.how, i.id, i.uid, i.kind, i.source_label, i.provider, i.observed_on, i.summary, i.version
       FROM raise_claim_evidence l JOIN raise_evidence_items i ON i.id = l.item_id AND i.project_id = l.project_id
      WHERE l.project_id = ? AND l.claim_id IN (SELECT value FROM json_each(?)) AND (? = 1 OR i.private_reason IS NULL)`,
  ).bind(projectId, JSON.stringify(stored.map((c) => c.id)), opts.founder ? 1 : 0).all<Item & { claim_id: number; how: string }>()).results || [] : [];
  const pinned = opts.founder ? (await env.DB.prepare(
    `SELECT id, uid, kind, source_ref, source_label, provider, observed_on, summary, version FROM raise_evidence_items
      WHERE project_id = ? AND state = 'pinned' ORDER BY id DESC LIMIT 500`,
  ).bind(projectId).all<Item>()).results || [] : [];
  const proposals = opts.founder && stored.length ? (await env.DB.prepare(
    `SELECT uid, payload_json FROM ai_rail_proposals WHERE record_ref = ? AND rail_option = ? AND kind = 'proposal' AND status = 'proposed' ORDER BY id DESC LIMIT 200`,
  ).bind(`project:${projectId}`, LINK_OPTION).all<{ uid: string; payload_json: string }>()).results || [] : [];
  const records = new Map((opts.computed ?? []).map((c) => [c.field_key, claimRecord(c)]));

  const claims = stored.map((c) => {
    const figure = figureOf(c.claim_kind);
    const section = sectionOfField(c.field_key.split('#')[0]);
    const mine = links.filter((l) => Number(l.claim_id) === Number(c.id));
    const record = records.get(c.field_key) ?? null;
    const best = c.state === 'not_backed' ? null : record?.source_label ?? bestOf(mine)?.source_label ?? null;
    const base = {
      uid: c.uid, figure: c.claim_kind, label: figure ? FIGURE_LABEL[figure] : c.claim_kind,
      section: section?.key ?? null, section_label: section?.label ?? null, state: c.state, best_source: best, checked_at: c.checked_at,
    };
    if (!opts.founder) return base;
    const linked = new Set(mine.map((l) => Number(l.id)));
    const candidates = !figure || c.state === 'backed' || c.state === 'founders_figure' ? [] : pinned.filter((i) => couldBack(figure, i) && !linked.has(Number(i.id))).slice(0, 10);
    const offered = proposals.flatMap((q) => {
      let p: any = null;
      try { p = JSON.parse(q.payload_json); } catch { return []; }
      if (p?.claim_id !== c.uid) return [];
      const it = pinned.find((i) => i.uid === p.item_id);
      return it ? [{ proposal_uid: q.uid, item: itemView(it) }] : [];
    });
    return {
      ...base,
      stated_value: c.stated_value, stated_shown: c.stated_value == null || !figure ? null : fmtFigure(figure, Number(c.stated_value)),
      record, links: mine.map((l) => ({ how: l.how, item: itemView(l) })),
      candidates: candidates.map(itemView), eadwyn: offered,
      note: noteApplies(c) ? { text: c.note, at: c.noted_at } : null, note_outdated: c.note != null && !noteApplies(c),
    };
  });
  const bySource = Object.fromEntries([...SOURCE_LABELS, 'not_backed'].map((k) => [k, claims.filter((c) => (k === 'not_backed' ? c.best_source == null : c.best_source === k)).length]));
  const counts = Object.fromEntries(CLAIM_STATES.map((s) => [s, claims.filter((c) => c.state === s).length]));
  const checkedAt = stored.map((c) => c.checked_at).filter(Boolean).sort().at(-1) ?? null;
  return { version, claims, counts, by_source: bySource, checked_at: checkedAt };
}

/** The current deck's figures, card by card, bound or typed, the first statement of each. */
async function deckFigures(env: Env, projectId: number) {
  const d = await env.DB.prepare('SELECT id, version, slides FROM pitch_decks WHERE project_id = ? ORDER BY COALESCE(is_current, 0) DESC, version DESC, id DESC LIMIT 1')
    .bind(projectId).first<{ id: number; version: number; slides: string | null }>();
  if (!d) return { version: null, figures: new Map<FigureKey, { value: number; slide: number }>(), state: 'none' as const };
  let slides: unknown;
  try { slides = JSON.parse(String(d.slides)); } catch { return { version: Number(d.version), figures: new Map(), state: 'unreadable' as const }; }
  if (!Array.isArray(slides)) return { version: Number(d.version), figures: new Map(), state: 'unreadable' as const };
  const figures = new Map<FigureKey, { value: number; slide: number }>();
  slides.forEach((s, i) => {
    for (const f of parseStatedFigures(`slide:${i + 1}`, slideText(s).join('\n'))) if (!figures.has(f.figure)) figures.set(f.figure, { value: f.value, slide: i + 1 });
  });
  return { version: Number(d.version), figures, state: 'ok' as const };
}

/**
 * NAR8: each figure the version states, against the current deck and the
 * metric stores, as "Check against" chooses. A side that agrees within the
 * check's tolerance (`agrees`) is OK; one that differs is a Mismatch naming
 * both figures and both sources, neither presumed right; a figure no chosen
 * side states is Not compared.
 */
export async function narrativeCheckRows(env: Env, projectId: number, version: number) {
  const { stated, metrics } = await checkInputs(env, projectId, version);
  const meta = await env.DB.prepare('SELECT check_against_json FROM narrative_version_meta WHERE project_id = ? AND version = ?')
    .bind(projectId, version).first<{ check_against_json: string | null }>();
  const against = selectedCheckSources(meta?.check_against_json);
  const deck = against.includes('deck') ? await deckFigures(env, projectId) : { version: null, figures: new Map(), state: 'not_chosen' as const };
  const seen = new Set<FigureKey>();
  const rows = stated.flatMap((s) => {
    if (seen.has(s.figure)) return [];
    seen.add(s.figure);
    const section = sectionOfField(String(s.source).replace(/^Narrative · /, ''));
    const d = deck.figures.get(s.figure);
    const m = metrics[s.figure];
    const sides = [
      ...(d ? [{ side: 'deck', value: d.value, shown: fmtFigure(s.figure, d.value), source: `Pitch deck v${deck.version} · card ${d.slide}` }] : []),
      ...(m && Number.isFinite(m.value) ? [{ side: 'metrics', value: m.value, shown: fmtFigure(s.figure, m.value), source: m.source }] : []),
    ];
    const differs = sides.filter((x) => !agrees(s.value, x.value));
    const result = !sides.length ? 'not_compared' : differs.length ? 'mismatch' : 'ok';
    return [{
      figure: s.figure, label: FIGURE_LABEL[s.figure], section: section?.key ?? null, section_label: section?.label ?? null,
      narrative: { value: s.value, shown: fmtFigure(s.figure, s.value) },
      deck: d ? sides.find((x) => x.side === 'deck') : null,
      metrics: m && Number.isFinite(m.value) ? sides.find((x) => x.side === 'metrics') : null,
      result, differs: differs.map((x) => x.side),
    }];
  });
  const compared = rows.filter((r) => r.result !== 'not_compared').length;
  return {
    version, against, deck: { version: deck.version, state: deck.state },
    rows, compared, mismatches: rows.filter((r) => r.result === 'mismatch').length,
  };
}

/** The words a narrative claim's section holds now, and where they live. */
export async function sectionWords(env: Env, projectId: number, version: number, field: string): Promise<string | null> {
  if (field === 'why_now') {
    const m = await env.DB.prepare('SELECT why_now FROM narrative_version_meta WHERE project_id = ? AND version = ?').bind(projectId, version).first<{ why_now: string | null }>();
    return m?.why_now ?? null;
  }
  if (field.startsWith('section:')) {
    const b = await env.DB.prepare('SELECT body FROM narrative_sections WHERE project_id = ? AND version = ? AND section = ?')
      .bind(projectId, version, field.slice('section:'.length)).first<{ body: string | null }>();
    return b?.body ?? null;
  }
  const w = await env.DB.prepare('SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key = ?').bind(projectId, version, field).first<{ value: string }>();
  return w?.value ?? null;
}
