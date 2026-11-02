/**
 * D1535 (#3782, deck v2 B6) — deck templates: what a template may hold (#3876's
 * H14 shape, `deck_template/1`), how one becomes a deck's cards, what "Save as
 * my template" strips, and the deterministic pick the one-click run calls.
 *
 * A TEMPLATE is structure, theme and decor with bracketed placeholders. It
 * never holds a venture's words or figures: every user-visible string passes
 * `numberIn` (no digit, currency, percentage or number word), no metric has a
 * value and no chart series has points (`templateProblems`).
 *
 * APPLY writes a proposal (`toSlides`, then the deck routes' proposal row):
 * nothing is saved before Accept. Figures are bound by code from each block's
 * `binding.source_key`, as every deck's are.
 *
 * SAVE AS MY TEMPLATE (`stripDeck`) keeps each card's layout, structure,
 * areas, background and decor and each block's kind, grid, style, chart type
 * and binding key; it replaces every text with a bracketed placeholder for
 * its style, nulls every metric value and image, and drops chart points,
 * notes and alt text.
 *
 * THE PICK (`pickTemplate`) is by stage and audience, with sector optional:
 * the same inputs over the same templates always give the same template and
 * the same reason, so the one-click run can record "Picked … because …".
 *
 * Pure: no binding.
 */
import { AUDIENCES, CHART_TYPES, LAYOUT_IDS } from './slideModel';
import { CARD_IDS, numberIn } from './newDeck';
import { ROLE_LAYOUTS } from './designSystem';

export const CONTRACT = 'deck_template/1';
export const STAGES = ['pre_seed', 'seed', 'series_a', 'series_b_plus'] as const;
export const STYLES = ['editorial', 'bold', 'minimal'] as const;
export const SWATCHES = ['cream', 'white', 'near_black', 'blush', 'navy', 'sage', 'ivory', 'white_rule'] as const;
export type Stage = typeof STAGES[number];
export const STAGE_LABEL: Record<Stage, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+' };
export const AUDIENCE_LABEL: Record<string, string> = {
  angel: 'Angel', pre_seed_fund: 'Pre-seed fund', seed_fund: 'Seed fund', series_a_fund: 'Series A fund', strategic: 'Strategic', grant: 'Grant', other: 'Other',
};
export const ATTESTATION = "No text, layout, palette, icon or image copied from a competitor's template or a v1 deck method.";
/** The prefix a template's proposal carries in `pitch_deck_proposals.method_id` (Q5: v1's method ids and labels unchanged). */
export const TEMPLATE_METHOD = 'tpl:';

export type TemplateMeta = {
  uid: string; name: string; description: string | null; stage: Stage | null; audience_tags: string[]; deck_audience: string | null;
  style: string | null; swatch: string | null; card_count: number;
};

const PLACEHOLDER = /^\[[A-Z][^\[\]]{0,39}\]$/;
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Every user-visible string a template holds: card titles, purposes, messages, block words, labels, alts, notes, diagram labels, art prompts. */
export function visibleStrings(t: any): string[] {
  const out: string[] = [];
  const push = (v: unknown) => { if (isStr(v) && v.trim()) out.push(v); };
  push(t?.name); push(t?.description);
  for (const c of [...(Array.isArray(t?.cards) ? t.cards : []), ...(Array.isArray(t?.pending_cards) ? t.pending_cards : [])]) {
    push(c?.title); push(c?.purpose); push(c?.message); push(c?.notes);
    for (const a of Array.isArray(c?.areas) ? c.areas : []) push(a?.art?.prompt);
    for (const b of Array.isArray(c?.blocks) ? c.blocks : []) {
      push(b?.text); push(b?.label); push(b?.alt); push(b?.caption);
      for (const s of Array.isArray(b?.series) ? b.series : []) push(s?.label);
      for (const i of Array.isArray(b?.diagram?.items) ? b.diagram.items : []) push(i?.label);
      for (const p of Array.isArray(b?.items) ? b.items : []) push(typeof p === 'string' ? p : p?.text);
    }
  }
  return out;
}

/** Why an object is not a template a member may be shown; [] when it is. */
export function templateProblems(t: any): string[] {
  const p: string[] = [];
  if (!t || typeof t !== 'object') return ['not a template'];
  if (t.contract !== CONTRACT) p.push(`contract must be ${CONTRACT}`);
  if (!isStr(t.uid) || !/^tpl_[a-z0-9_]{1,60}$/.test(t.uid)) p.push('uid must be tpl_<snake_name>');
  if (!isStr(t.name) || !t.name.trim() || t.name.length > 40) p.push('name is 1 to 40 characters');
  if (t.description != null && (!isStr(t.description) || t.description.length > 140)) p.push('description is at most 140 characters');
  if (t.stage != null && !(STAGES as readonly string[]).includes(t.stage)) p.push('stage is pre_seed, seed, series_a or series_b_plus');
  if (!Array.isArray(t.audience_tags) || t.audience_tags.some((a: unknown) => !(AUDIENCES as readonly string[]).includes(a as string))) p.push("audience_tags are New deck's seven audiences");
  if (t.style != null && !(STYLES as readonly string[]).includes(t.style)) p.push('style is editorial, bold or minimal');
  if (t.swatch != null && !(SWATCHES as readonly string[]).includes(t.swatch)) p.push('swatch is one of the eight');
  const cards = Array.isArray(t.cards) ? t.cards : [];
  if (cards.length < 1 || cards.length > 40) p.push('a template has cards');
  if (t.card_count !== cards.length) p.push('card_count is the number of cards');
  cards.forEach((c: any, i: number) => {
    const at = `card ${i + 1}`;
    if (c?.card != null && !CARD_IDS.includes(c.card)) p.push(`${at}: ${String(c.card).slice(0, 30)} is not a catalogue card`);
    if (c?.layout != null && !LAYOUT_IDS.includes(c.layout)) p.push(`${at}: not a layout`);
    if (c?.card && c?.layout && ROLE_LAYOUTS[c.card] && !(ROLE_LAYOUTS[c.card] as string[]).includes(c.layout)) p.push(`${at}: ${c.layout} is not a layout for ${c.card}`);
    for (const b of Array.isArray(c?.blocks) ? c.blocks : []) {
      if (b?.kind === 'metric' && b.value != null && b.value !== '') p.push(`${at}: a metric holds a value`);
      if (b?.kind === 'chart') {
        if (b.chart_type != null && !(CHART_TYPES as readonly string[]).includes(b.chart_type)) p.push(`${at}: not a chart type`);
        if ((b.series ?? []).some((s: any) => Array.isArray(s?.points) && s.points.length)) p.push(`${at}: a chart series holds points`);
      }
      if (b?.kind === 'image' && b.image_url != null) p.push(`${at}: an image holds a URL`);
      if (['video', 'audio', 'link'].includes(b?.kind)) p.push(`${at}: a ${b.kind} block`);
    }
  });
  for (const s of visibleStrings(t)) {
    const n = numberIn(s);
    if (n) { p.push(`"${s.slice(0, 40)}" holds a figure (${n})`); break; }
    for (const m of s.matchAll(/\[[^\]]*\]?/g)) if (!PLACEHOLDER.test(m[0])) { p.push(`${m[0].slice(0, 44)} is not a placeholder`); break; }
  }
  if (/@cf\//.test(JSON.stringify(t))) p.push('a template names no model');
  const prov = t.provenance;
  if (!prov || prov.attestation !== ATTESTATION || (prov.origin !== 'original' && prov.origin !== 'member')) p.push('provenance records the origin and the attestation');
  return p;
}

/** The Gallery's tile: the metadata only. */
export function metaOf(t: any): TemplateMeta {
  return {
    uid: t.uid, name: t.name, description: t.description ?? null, stage: t.stage ?? null, audience_tags: Array.isArray(t.audience_tags) ? t.audience_tags : [],
    deck_audience: t.deck_audience ?? null, style: t.style ?? null, swatch: t.swatch ?? null, card_count: Number(t.card_count) || 0,
  };
}

/** A template's cards as deck cards: layout, structure and areas, blocks, background, decor and notes. The slide model sanitises them. */
export function toSlides(t: any): any[] {
  return (Array.isArray(t?.cards) ? t.cards : []).map((c: any) => {
    const out: Record<string, unknown> = { layout: c.layout, blocks: Array.isArray(c.blocks) ? c.blocks : [] };
    if (c.structure) out.structure = c.structure;
    if (Array.isArray(c.areas)) out.areas = c.areas.map((a: any, i: number) => ({ id: a.id, ...(a.grid ?? {}), order: i + 1, inset: 0, align: 'start' }));
    if (c.background) out.background = c.background;
    if (Array.isArray(c.decor)) out.decor = c.decor;
    if (isStr(c.notes)) out.notes = c.notes;
    if (isStr(c.title)) out.title = c.title;
    if (isStr(c.card)) out.card = c.card;
    return out;
  });
}

const STYLE_PLACEHOLDER: Record<string, string> = { display: '[Headline]', heading: '[Heading]', subheading: '[Subheading]', paragraph: '[Text]', list: '[List item]', caption: '[Caption]' };

/** "Save as my template": structure, theme and decor kept; text and figures removed. */
export function stripDeck(slides: unknown): any[] {
  return (Array.isArray(slides) ? slides : []).map((s: any) => {
    const out: Record<string, unknown> = {};
    for (const k of ['layout', 'structure', 'areas', 'background', 'decor', 'card', 'section', 'hidden']) if (s?.[k] != null) out[k] = s[k];
    if (s?.background?.image_url) out.background = { ...s.background, image_url: null };
    out.title = '[Card title]';
    out.blocks = (Array.isArray(s?.blocks) ? s.blocks : []).map((b: any) => {
      const kept: Record<string, unknown> = { kind: b?.kind };
      for (const k of ['id', 'grid', 'style', 'chart_type', 'graphic', 'ratio', 'tag', 'range']) if (b?.[k] != null) kept[k] = b[k];
      if (b?.binding?.source_key) kept.binding = { source_key: b.binding.source_key };
      if (b?.kind === 'text') kept.text = STYLE_PLACEHOLDER[b.style] ?? '[Text]';
      if (b?.kind === 'metric') { kept.label = '[Metric]'; kept.value = null; }
      if (b?.kind === 'chart') kept.series = (Array.isArray(b.series) ? b.series : []).map((x: any) => ({ label: '[Series]', ...(x?.binding?.source_key ? { binding: { source_key: x.binding.source_key } } : {}) }));
      if (b?.kind === 'image') { kept.image_url = null; kept.alt = '[Image]'; }
      if (b?.kind === 'graphic' && b?.diagram?.type) kept.diagram = { v: 1, type: b.diagram.type, items: (b.diagram.items ?? []).map(() => ({ label: '[Step]' })), ...(b.diagram.axes ? { axes: { x: '[Axis]', y: '[Axis]' } } : {}) };
      if (b?.kind === 'table') kept.rows = (Array.isArray(b.rows) ? b.rows : []).map((r: unknown[]) => (Array.isArray(r) ? r.map(() => '[Cell]') : []));
      return kept;
    });
    return out;
  });
}

/** A string's FNV-1a hash: the pick's tie-break, the same on every run. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The one-click run's pick (dk-auto AUTO-2): the stage's templates tagged
 * with the audience, else the stage's, else any; ties broken by a hash of the
 * inputs over the templates sorted by uid. `{ template_id: null }` only when
 * there are no templates.
 */
export function pickTemplate(templates: readonly TemplateMeta[], q: { stage?: string | null; audience?: string | null; sector?: string | null }): { template_id: string | null; reason: string } {
  const all = [...templates].sort((a, b) => a.uid.localeCompare(b.uid));
  if (!all.length) return { template_id: null, reason: 'No template is in the gallery yet.' };
  const stage = q.stage && (STAGES as readonly string[]).includes(q.stage) ? q.stage as Stage : null;
  const audience = q.audience && (AUDIENCES as readonly string[]).includes(q.audience) ? q.audience : null;
  const tiers: Array<[TemplateMeta[], string]> = [
    [all.filter((t) => t.stage === stage && audience && t.audience_tags.includes(audience)), 'its stage and audience'],
    [all.filter((t) => t.stage === stage), 'its stage'],
    [all.filter((t) => audience && t.audience_tags.includes(audience)), 'its audience'],
    [all, 'the gallery'],
  ];
  const [list, why] = tiers.find(([l]) => l.length)!;
  const t = list[fnv(`${stage ?? ''}|${audience ?? ''}|${(q.sector ?? '').trim().toLowerCase()}`) % list.length];
  const parts = [stage ? STAGE_LABEL[stage] : null, audience ? AUDIENCE_LABEL[audience] : null].filter(Boolean).join(' · ');
  return { template_id: t.uid, reason: `Picked ${t.name} because it matches ${why}${parts ? ` (${parts})` : ''}.` };
}
