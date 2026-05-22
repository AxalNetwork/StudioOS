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

function fmtMonths(n: any): string | null {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return null;
  return `${Math.round(v)} mo`;
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
      const use = (project.use_of_funds || '').toString().trim();
      return use ? `Raising ${f} — ${use.slice(0, 80)}` : `Raising ${f}.`;
    }
    if (k === 'runway_target') {
      const f = Number(project.funding_needed);
      return f > 0 ? `${f >= 5_000_000 ? '24+' : '18-24'} months runway` : null;
    }
    return null;
  }
  const v = project?.[col];
  if (v === undefined || v === null || v === '') return null;
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
  if (k === 'runway_months') return fmtMonths(v);
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
// hint → string|string[]. If OPENAI_API_KEY is not configured (or the
// call times out) we just leave fields as placeholders.
// ---------------------------------------------------------------------
async function aiBatchFill(
  env: Env, project: any, hints: string[], aiHint: string,
): Promise<Record<string, any>> {
  const key = (env as any).OPENAI_API_KEY;
  if (!key || hints.length === 0) return {};
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
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a senior VC associate. Always return valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5, max_tokens: 2200,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) return {};
    const j: any = await r.json();
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
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
    if (val) cells.push({ label, value: val });
  }
  return cells.length
    ? { kind: 'metric_grid', value: cells, source: 'data' }
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

// ---------------------------------------------------------------------
// Public entry-point.
// ---------------------------------------------------------------------
export async function autofillDeck(
  env: Env, method: DeckMethodSpec, projectId: number,
): Promise<FilledDeck> {
  // Load project + financials.computed_json + cap table holders.
  const project: any = await env.DB
    .prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<any>() || {};
  let fin: any = null;
  try {
    const fmRow = await env.DB
      .prepare('SELECT computed_json, assumptions_json FROM financial_models WHERE project_id = ?')
      .bind(projectId).first<any>();
    if (fmRow?.computed_json) {
      try { fin = JSON.parse(fmRow.computed_json); } catch { fin = null; }
    }
    if (!fin && fmRow?.assumptions_json) {
      try { fin = JSON.parse(fmRow.assumptions_json); } catch { fin = null; }
    }
  } catch { /* table may not exist */ }
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

  const aiOut = await aiBatchFill(env, project, Array.from(aiHints), method.ai_fill_hint);

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
        if (val.source === 'data' || val.source === 'ai') hit += 1;
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
