/**
 * Task #16 (DE) — Auto-fill engine.
 *
 * Walks each method's slide spec, resolves every field's source list in
 * order: project columns → financials.computed_json → cap table holders
 * → AI fallback (best-effort, single batched call) → literal
 * `[Founder, fill in]` placeholder.
 *
 * All field values come back as either:
 *   { value: string, source: 'data' | 'ai' | 'placeholder', empty: boolean }
 *
 * The render layer (HTML/PPTX) chooses how to display each kind.
 */
import type { Env } from '../../types';
import type { DeckMethodSpec, DeckSlideField } from './methods';
import { formatUseOfFundsText } from '../../util/useOfFunds';
import { run as aiRun, type RailContext } from '../aiRouter';
import { AI_SURFACE } from '../aiSurfaces';

export type FilledFieldValue =
  | { kind: 'title' | 'subtitle' | 'paragraph' | 'quote'; value: string; source: 'data' | 'ai' | 'placeholder' }
  | { kind: 'bullets'; value: string[]; source: 'data' | 'ai' | 'placeholder' }
  | { kind: 'metric_grid'; value: Array<{ label: string; value: string }>; source: 'data' | 'ai' | 'placeholder' }
  | { kind: 'image'; value: string | null; source: 'data' | 'placeholder' };

export type FilledSlide = {
  spec_id: string;
  title: string;
  subtitle: string | null;
  appendix: boolean;
  fields: Record<string, FilledFieldValue>;
  /** Coverage = filled-by-data fields ÷ total non-optional fields. */
  coverage_pct: number;
};

export type FilledDeck = {
  method_id: string;
  slides: FilledSlide[];
  total_coverage_pct: number;
};

// Task #14 — single em-dash placeholder; the editor renders this verbatim
// and the autofill test asserts no whole-slide stays this way once the
// project + financials + cap-table are populated.
const PLACEHOLDER = '—';

function fmtMoney(n: any): string | null {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return null;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtNum(n: any, digits = 0): string | null {
  const v = Number(n);
  if (!isFinite(v)) return null;
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatDeckRunway(n: any, unit: 'months' | 'mo' = 'months'): string | null {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!isFinite(v) || v < 0) return null;
  return `${Math.round(v)} ${unit}`;
}

// ---------------------------------------------------------------------
// Source resolvers: each maps a `source` expression to a string value.
// ---------------------------------------------------------------------
function resolveProjectSource(expr: string, project: any): string | null {
  const col = expr.replace(/^project\./, '');
  if (col.startsWith('derived.')) {
    const k = col.slice('derived.'.length);
    if (k === 'ask_line') {
      const f = fmtMoney(project.funding_needed);
      if (!f) return null;
      const use = formatUseOfFundsText(project.use_of_funds);
      return use ? `Raising ${f} — ${use.slice(0, 80)}` : `Raising ${f}.`;
    }
    if (k === 'runway_target') {
      const runway = formatDeckRunway(project._recordedRunway);
      return runway ? `${runway} runway` : null;
    }
    return null;
  }
  const v = project?.[col];
  if (v === undefined || v === null || v === '') return null;
  // Task #2 — render the structured Use-of-Funds allocation as readable text
  // (e.g. "Product & engineering 45%; …") rather than leaking raw JSON.
  if (col === 'use_of_funds') return formatUseOfFundsText(v) || null;
  if (col.endsWith('_pct')) return `${Math.round(Number(v) * 100) / 100}%`;
  if (typeof v === 'number') {
    if (col === 'tam' || col === 'sam' || col === 'som' || col === 'revenue' || col === 'funding_needed' || col === 'cost_to_mvp') {
      return fmtMoney(v);
    }
    if (col === 'users_count') return fmtNum(v);
    return String(v);
  }
  return String(v).slice(0, 4000);
}

function resolveFinancialsSource(expr: string, fin: any): string | null {
  if (!fin) return null;
  const k = expr.replace(/^financials\./, '');
  const v = fin?.[k];
  if (v == null) return null;
  if (k === 'runway_months') return formatDeckRunway(v, 'mo');
  if (k === 'breakeven_month') return v ? `month ${v}` : null;
  if (k === 'avg_monthly_burn' || k === 'ending_cash' || k === 'total_revenue_horizon' || k === 'ltv') {
    return fmtMoney(v);
  }
  if (k === 'ltv_cac_ratio') return `${fmtNum(v, 1)}×`;
  return String(v);
}

function resolveCaptableSource(expr: string, holders: Array<{ name: string; shares: number; kind: string }>): any {
  const k = expr.replace(/^captable\./, '');
  if (!holders.length) return null;
  const total = holders.reduce((s, h) => s + (Number(h.shares) || 0), 0);
  if (k === 'total_shares') return total > 0 ? fmtNum(total) : null;
  if (k === 'founders') {
    const fs = holders.filter((h) => /founder/i.test(h.kind || ''));
    return (fs.length ? fs : holders.slice(0, 3)).map((h) => h.name).filter(Boolean);
  }
  if (k === 'holders') {
    return holders.slice(0, 8).map((h) => {
      const pct = total > 0 ? `${((Number(h.shares) || 0) / total * 100).toFixed(1)}%` : '';
      return `${h.name}${pct ? ` — ${pct}` : ''}`;
    });
  }
  if (k === 'founder_pct') {
    const fs = holders.filter((h) => /founder/i.test(h.kind || ''));
    if (!fs.length || total === 0) return null;
    const pct = fs.reduce((s, h) => s + (Number(h.shares) || 0), 0) / total * 100;
    return `${pct.toFixed(1)}%`;
  }
  return null;
}

// ---------------------------------------------------------------------
// AI fallback (single batched call). Best effort — returns a map of
// hint → string|string[]. D767 (#2096): one router run on Workers AI, held,
// guarded and charged to the founder who pressed, with the Raise › Pitch deck
// page and option on its usage row. The task is that page's row in D764's
// matrix (`ai/railMatrix.json`: kind vision, `rail_vision`). A refusal or a failed
// run leaves the fields as placeholders, as a missing key used to.
// ---------------------------------------------------------------------
// A model's JSON answer, fences and prose around it tolerated (as `deckExtract.ts` reads one).
export function parseJsonLoose<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
/**
 * Who asked for a fill, for the router's hold and its usage row (D767). D778
 * part 5: a route that read the press's own context passes it as `rail`
 * (`railFor`), which wins over the surface page and `railOption`.
 */
export interface DeckFillRun { userId: number; projectId: number; railOption?: string; rail?: RailContext }

async function aiBatchFill(
  env: Env, project: any, hints: string[], aiHint: string, who: DeckFillRun | null,
): Promise<Record<string, any>> {
  if (!who || hints.length === 0) return {};
  const ctx = {
    name: project.name, sector: project.sector, stage: project.stage,
    description: project.description, problem: project.problem_statement,
    solution: project.solution, why_now: project.why_now,
    tam: project.tam, sam: project.sam, som: project.som,
    users: project.users_count,
    revenue: project.revenue, funding_needed: project.funding_needed,
    use_of_funds: project.use_of_funds, growth_signals: project.growth_signals,
    contact_email: project.contact_email,
    tagline: project.tagline, vision: project.vision,
    traction_summary: project.traction_summary,
    cac: project.cac, gross_margin_pct: project.gross_margin_pct,
  };
  const prompt = `You are a senior VC associate drafting a pitch deck. Style: ${aiHint}.
Startup data: ${JSON.stringify(ctx)}

For EACH hint below produce one of:
- A short headline (≤8 words) — for *_headline keys
- A 1-2 sentence paragraph — for *_story / *_pitch / *_contact / *_moat keys
- An array of 3-4 punchy bullets (≤18 words each) — for *_bullets / *_channels / *_motion / *_landscape / *_quarters / *_uses / *_milestones / *_hiring keys
- A short string — for *_cta keys

Return ONLY valid JSON of the form: {"<hint>": <value>, ...}.
Hints: ${JSON.stringify(hints)}`;

  try {
    const res = await aiRun(env, {
      task: 'rail_vision',
      userId: who.userId,
      surface: AI_SURFACE.raisePitch,
      // D765: the member's rail context; run() records it as D767's page, option and record.
      rail: who.rail ?? { page: AI_SURFACE.raisePitch, option: who.railOption ?? null, record: `project:${who.projectId}` },
      systemPrompt: 'You are a senior VC associate. Always return valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens: 2200,
    });
    if (!res.ok || !res.output) return {};
    const parsed = parseJsonLoose<Record<string, any>>(res.output);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

// ---------------------------------------------------------------------
// Field-level resolution.
// ---------------------------------------------------------------------
function emptyValueFor(field: DeckSlideField, source: 'data' | 'ai' | 'placeholder'): FilledFieldValue {
  switch (field.kind) {
    case 'bullets':
      return { kind: 'bullets', value: source === 'placeholder' ? [PLACEHOLDER] : [], source };
    case 'metric_grid':
      return { kind: 'metric_grid', value: [], source };
    case 'image':
      return { kind: 'image', value: null, source: 'placeholder' };
    default:
      return { kind: field.kind as any, value: source === 'placeholder' ? PLACEHOLDER : '', source };
  }
}

function resolveMetricGrid(field: DeckSlideField, project: any, fin: any): FilledFieldValue {
  const cells: Array<{ label: string; value: string }> = [];
  for (const src of field.sources) {
    let label = src.split('.').pop() || src;
    label = label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    let val: string | null = null;
    if (src.startsWith('project.')) val = resolveProjectSource(src, project);
    else if (src.startsWith('financials.')) val = resolveFinancialsSource(src, fin);
    else if (src.startsWith('captable.')) {
      const r = resolveCaptableSource(src, project._holders || []);
      val = typeof r === 'string' ? r : null;
    }
    if (!val && (src === 'project.derived.runway_target' || src === 'financials.runway_months')) val = 'Not recorded';
    if (val) cells.push({ label, value: val });
  }
  return cells.length
    ? { kind: 'metric_grid', value: cells, source: cells.some((cell) => cell.value !== 'Not recorded') ? 'data' : 'placeholder' }
    : emptyValueFor(field, 'placeholder');
}

function resolveScalarField(
  field: DeckSlideField, project: any, fin: any, aiOut: Record<string, any>,
): FilledFieldValue {
  for (const src of field.sources) {
    if (src.startsWith('project.')) {
      const v = resolveProjectSource(src, project);
      if (v) {
        if (field.kind === 'bullets') {
          // A project column treated as bullets: split by newline / pipe.
          const arr = v.split(/[\n;|]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
          if (arr.length) return { kind: 'bullets', value: arr, source: 'data' };
          continue;
        }
        return { kind: field.kind as any, value: v, source: 'data' } as FilledFieldValue;
      }
    } else if (src.startsWith('financials.')) {
      const v = resolveFinancialsSource(src, fin);
      if (v) return { kind: field.kind as any, value: v, source: 'data' } as FilledFieldValue;
    } else if (src.startsWith('captable.')) {
      const v = resolveCaptableSource(src, project._holders || []);
      if (v) {
        if (field.kind === 'bullets' && Array.isArray(v)) {
          return { kind: 'bullets', value: v, source: 'data' };
        }
        if (typeof v === 'string') return { kind: field.kind as any, value: v, source: 'data' } as FilledFieldValue;
      }
    } else if (src.startsWith('ai.')) {
      const hint = src.slice(3);
      const v = aiOut[hint];
      if (v != null) {
        if (field.kind === 'bullets') {
          const arr = Array.isArray(v) ? v : String(v).split(/\n+/);
          const norm = arr.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 6);
          if (norm.length) return { kind: 'bullets', value: norm, source: 'ai' };
        } else {
          return { kind: field.kind as any, value: String(v), source: 'ai' } as FilledFieldValue;
        }
      }
    }
  }
  return emptyValueFor(field, field.optional ? 'placeholder' : 'placeholder');
}

/** D895: a stored financial-model runway, otherwise the venture's measured Mercury fact. */
export async function recordedDeckRunway(env: Env, projectId: number): Promise<number | null> {
  const measured = (value: unknown): number | null => {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  try {
    const row = await env.DB.prepare('SELECT computed_json FROM financial_models WHERE project_id = ? AND updated_by IS NOT NULL ORDER BY id DESC LIMIT 1').bind(projectId).first<{ computed_json: string }>();
    const runway = measured(row?.computed_json ? JSON.parse(row.computed_json)?.runway_months : null);
    if (runway !== null) return runway;
  } catch { /* no readable recorded model */ }
  try {
    const row = await env.DB.prepare("SELECT value FROM mercury_raise_facts WHERE project_id = ? AND kind = 'runway' ORDER BY as_of DESC, id DESC LIMIT 1").bind(projectId).first<{ value: number | null }>();
    return measured(row?.value);
  } catch { return null; }
}

// ---------------------------------------------------------------------
// Public entry-point.
// ---------------------------------------------------------------------
export async function autofillDeck(
  env: Env, method: DeckMethodSpec, projectId: number, who: DeckFillRun | null = null,
): Promise<FilledDeck> {
  // Load project + financials.computed_json + cap table holders.
  const project: any = await env.DB
    .prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<any>() || {};
  project._recordedRunway = await recordedDeckRunway(env, projectId);
  let fin: any = null;
  try {
    const fmRow = await env.DB
      .prepare('SELECT computed_json, assumptions_json FROM financial_models WHERE project_id = ? AND updated_by IS NOT NULL')
      .bind(projectId).first<any>();
    if (fmRow?.computed_json) {
      try { fin = JSON.parse(fmRow.computed_json); } catch { fin = null; }
    }
    if (!fin && fmRow?.assumptions_json) {
      try { fin = JSON.parse(fmRow.assumptions_json); } catch { fin = null; }
    }
  } catch { /* table may not exist */ }
  // One recorded runway supplies both Ask cells, including the Mercury fallback.
  fin = { ...(fin || {}), runway_months: project._recordedRunway };
  let holders: Array<{ name: string; shares: number; kind: string }> = [];
  try {
    const hr = await env.DB.prepare(
      'SELECT name, shares, kind FROM cap_table_holders WHERE project_id = ?',
    ).bind(projectId).all<{ name: string; shares: number; kind: string }>();
    holders = hr.results || [];
  } catch { /* table may not exist */ }
  project._holders = holders;

  // First pass: resolve everything from data; collect AI hints for empties.
  const aiHints = new Set<string>();
  for (const slide of method.slides) {
    for (const field of slide.fields) {
      if (field.kind === 'image' || field.kind === 'metric_grid') continue;
      let dataHit = false;
      for (const src of field.sources) {
        if (src.startsWith('project.') && resolveProjectSource(src, project)) { dataHit = true; break; }
        if (src.startsWith('financials.') && resolveFinancialsSource(src, fin)) { dataHit = true; break; }
        if (src.startsWith('captable.') && resolveCaptableSource(src, holders)) { dataHit = true; break; }
      }
      if (!dataHit) {
        for (const src of field.sources) {
          if (src.startsWith('ai.')) aiHints.add(src.slice(3));
        }
      }
    }
  }

  const aiOut = await aiBatchFill(env, project, Array.from(aiHints), method.ai_fill_hint, who);

  // Second pass: build slides.
  const slides: FilledSlide[] = [];
  // (sanitizePublicHttpsUrl is hoisted below.)
  let totalRequired = 0; let totalFilled = 0;
  for (const spec of method.slides) {
    const subtitle = spec.subtitle
      ? spec.subtitle.replace(/\{project\.(\w+)\}/g, (_, k) => String(project[k] || '').trim())
      : null;
    const fields: Record<string, FilledFieldValue> = {};
    let req = 0; let hit = 0;
    for (const field of spec.fields) {
      let val: FilledFieldValue;
      if (field.kind === 'metric_grid') val = resolveMetricGrid(field, project, fin);
      else if (field.kind === 'image') {
        const raw = field.sources.map((s) => resolveProjectSource(s, project)).find((v) => !!v) || null;
        // Task #16 — SSRF guard at the source of truth. Project image
        // columns are user-controlled, so reject loopback / RFC1918 /
        // non-https hosts here, before the URL ever reaches a renderer.
        const url = raw ? sanitizePublicHttpsUrl(raw) : null;
        val = { kind: 'image', value: url, source: url ? 'data' : 'placeholder' };
      } else {
        val = resolveScalarField(field, project, fin, aiOut);
      }
      fields[field.key] = val;
      if (!field.optional) {
        req += 1;
        if (val.source === 'data') hit += 1;
      }
    }
    totalRequired += req; totalFilled += hit;
    slides.push({
      spec_id: spec.id,
      title: spec.title,
      subtitle: subtitle || null,
      appendix: !!spec.appendix,
      fields,
      coverage_pct: req > 0 ? Math.round((hit / req) * 100) : 100,
    });
  }
  return {
    method_id: method.id,
    slides,
    total_coverage_pct: totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 100,
  };
}

// ---------------------------------------------------------------------
// Convert FilledDeck → flat slide JSON shape used by the editor + DB.
// ---------------------------------------------------------------------
export type EditorSlide = {
  id: string;
  spec_id: string;
  title: string;
  subtitle: string | null;
  appendix: boolean;
  /** Per-field rendered values, plus their kind and source for the UI. */
  fields: Array<{
    key: string;
    label: string;
    kind: DeckSlideField['kind'];
    value: any;
    source: 'data' | 'ai' | 'placeholder';
    /** Set when the user has manually edited this field. */
    edited?: boolean;
  }>;
};

export function toEditorSlides(method: DeckMethodSpec, filled: FilledDeck): EditorSlide[] {
  return filled.slides.map((s, i) => {
    const spec = method.slides[i];
    return {
      id: `${s.spec_id}-${i}`,
      spec_id: s.spec_id,
      title: s.title,
      subtitle: s.subtitle,
      appendix: s.appendix,
      fields: spec.fields.map((field) => {
        const v = s.fields[field.key];
        return {
          key: field.key,
          label: field.label,
          kind: field.kind,
          value: v.value as any,
          source: v.source,
        };
      }),
    };
  });
}

// Task #16 — SSRF guard for project-supplied image URLs. Mirror of the
// route-level helper; kept here to avoid a cross-module import cycle.
function sanitizePublicHttpsUrl(input: string): string | null {
  const raw = String(input).trim();
  if (!raw || raw.length > 1000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' || host === '0.0.0.0' || host === '::1' ||
    host.endsWith('.local') || host.endsWith('.internal') ||
    /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) return null;
  return u.toString();
}
