/**
 * Task #2 (AU) — Admin Publication Exports.
 *
 * Helpers for the admin publications route:
 *   - loadSectionAggregates(): pulls k≥5 aggregate rows for an MI section
 *   - draftSummary(): calls aiRouter.run('publication', …) to draft 3-5 bullets
 *   - sectionToCsv(): CSV export with n<5 row suppression
 *   - publicationHtml(): five-page printable HTML for Browser Rendering
 *   - signPublicationToken / verifyPublicationToken: 24h HMAC download tokens
 *   - generateSlug(): URL-safe slug + uniqueness collision resistance
 */
import type { Env } from '../types';
import * as ai from './aiRouter';

// k-anonymity floor — mirrors K_MIN in routes/market_intel.ts. Any aggregate
// row with n<5 is suppressed both server-side (here) AND defensively
// re-checked at the read endpoint so a partial mid-rebuild row never leaks.
export const K_MIN = 5;

export const ALLOWED_SECTIONS = [
  'sentiment', 'talc', 'demand_supply', 'sector_heat', 'sentiment_geo',
  'fit_match', 'thesis_embedding',
] as const;
export type SectionKey = typeof ALLOWED_SECTIONS[number];

export const ALLOWED_AUDIENCES = ['internal', 'lp', 'founder', 'media', 'partners'] as const;
export type Audience = typeof ALLOWED_AUDIENCES[number];

export interface AggregateRow {
  dimension_key: string;
  period_key: string;
  n: number;
  value: number | null;
  payload: Record<string, unknown>;
}

interface RawRow {
  dimension_key: string;
  period_key: string;
  n: number;
  value: number | null;
  payload_json: string | null;
}

/**
 * Pull aggregates for a section. Filters: { sector?, period_from?, period_to?, limit? }.
 * Always enforces n>=K_MIN.
 */
export async function loadSectionAggregates(
  env: Env, section: string, filters: Record<string, unknown>,
): Promise<AggregateRow[]> {
  if (!ALLOWED_SECTIONS.includes(section as SectionKey)) return [];
  const limit = clampInt(filters.limit, 200, 1, 500);
  const sector = typeof filters.sector === 'string' ? filters.sector.slice(0, 64) : null;
  const periodFrom = typeof filters.period_from === 'string' ? filters.period_from.slice(0, 16) : null;
  const periodTo = typeof filters.period_to === 'string' ? filters.period_to.slice(0, 16) : null;

  const where: string[] = ['extractor = ?', 'n >= ?'];
  const params: Array<string | number> = [section, K_MIN];
  if (sector) {
    where.push('dimension_key LIKE ?');
    params.push(`%${sector}%`);
  }
  if (periodFrom) { where.push('period_key >= ?'); params.push(periodFrom); }
  if (periodTo)   { where.push('period_key <= ?'); params.push(periodTo); }

  const sql = `SELECT dimension_key, period_key, n, value, payload_json
                 FROM market_intel_aggregates
                 WHERE ${where.join(' AND ')}
                 ORDER BY period_key DESC, value DESC NULLS LAST
                 LIMIT ?`;
  params.push(limit);
  let res;
  try {
    res = await env.DB.prepare(sql).bind(...params).all();
  } catch (e) {
    console.warn('[publications] aggregate query failed:', (e as Error).message);
    return [];
  }
  return (res.results as RawRow[] || []).map((r) => ({
    dimension_key: String(r.dimension_key),
    period_key: String(r.period_key),
    n: Number(r.n) || 0,
    value: r.value === null ? null : Number(r.value),
    payload: safeJson(r.payload_json),
  }));
}

function safeJson(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// AI summary
// ---------------------------------------------------------------------------
export async function draftSummary(
  env: Env, userId: number, opts: {
    title: string; section: string; audience: string;
    filters: Record<string, unknown>; aggregates: AggregateRow[];
  },
): Promise<{ summary_text: string; ok: boolean; error?: string }> {
  // Spec: headline synthesis MUST use Anthropic claude-haiku-4-5 with
  // prompt caching. We route through the canonical aiRouter contract
  // (`task: 'publication'`) — ROUTE['publication'] is configured as
  // `provider: 'anthropic', model: 'claude-haiku-4-5'` so the primary
  // call hits Claude with the >1024-token system prompt carrying
  // `cache_control: ephemeral` (24h prompt cache). Workers AI llamas
  // are the cost-bounded fallback chain so the SPA never blocks on
  // an Anthropic outage.
  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(opts);
  const r = await ai.run(env, {
    task: 'publication',
    userId,
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 600,
    temperature: 0.3,
  });
  if (!r.ok || !r.output) {
    return {
      ok: false,
      error: r.error || r.refusal || 'ai_unavailable',
      summary_text: fallbackSummary(opts.aggregates),
    };
  }
  return { ok: true, summary_text: r.output.trim() };
}

// >1024 tokens of stable scaffolding. Matches the MI publication voice
// guide so the cached prefix doesn't drift across runs (any drift
// invalidates the 24h prompt cache and burns Anthropic spend).
function buildSystemPrompt(): string {
  return [
    'You are the Axal Venture Studio analyst editor producing concise, board-ready',
    'publication briefs distilled from anonymous, k-anonymised market-intelligence',
    'aggregates contributed by founders, investors, partners, and mentors across',
    'the Axal portfolio and observation set.',
    '',
    'OPERATING PRINCIPLES',
    ' - Write for sophisticated venture-studio audiences (LPs, GPs, repeat founders,',
    '   strategic partners). Keep tone factual, neutral, and reportorial.',
    ' - Surface only patterns supported by the data passed in the user message.',
    '   Never speculate, never name individual contributors, and never reveal the',
    '   underlying contributor population (the floor is n>=5 per cell; treat that',
    '   as a hard privacy invariant — do not infer or report subgroup details).',
    ' - Use $-thousand or $-million abbreviations only when the figures are clearly',
    '   in dollars; when units are unspecified, describe the metric without unit.',
    ' - Avoid superlatives ("biggest ever", "unprecedented"). Prefer comparative',
    '   framings ("up 12% week-on-week", "highest of the trailing eight weeks").',
    ' - Do not predict, recommend an action, or assert causation. Pattern + magnitude',
    '   + period is sufficient.',
    '',
    'SECTIONS YOU WILL RECEIVE',
    ' - sentiment: weekly mean valence + energy by sector. Higher valence = more',
    '   bullish operator/investor sentiment; higher energy = more conviction.',
    ' - talc: technology adoption life-cycle stage distribution by persona × sector.',
    '   The dominant mode (innovators / early_adopters / early_majority / …) is the',
    '   key signal.',
    ' - demand_supply: counts of demand vs. supply mentions by sector × side × topic.',
    ' - sector_heat: composite heat index per sector per week. Higher = more',
    '   capital + talent + research convergence.',
    ' - sentiment_geo: geo × sector cross-tab of mean valence.',
    ' - fit_match: top fit scores between investors and founders. PII-stripped.',
    ' - thesis_embedding: thesis cluster centroids across the investor pool.',
    '',
    'OUTPUT FORMAT',
    ' - Return between 3 and 5 bullets. Each bullet is one sentence, max 28 words.',
    ' - Lead each bullet with a bolded snake_case tag in square brackets that names',
    '   the dimension you are reporting (e.g., "[sector_heat:fintech]").',
    ' - End each bullet with the period key in parens, e.g., "(2026-W18)".',
    ' - Do NOT include a preamble, headline, or closing sentence. Just bullets.',
    ' - Do NOT use markdown other than the leading "- " bullet marker.',
    '',
    'AUDIENCE TUNING',
    ' - lp: emphasise capital flows, exit multiples, portfolio-level patterns.',
    ' - founder: emphasise demand/supply mismatches, talent density, sector heat.',
    ' - media: emphasise comparative shifts and named sectors over raw numerics.',
    ' - partners: emphasise sector heat and TALC dominance for sourcing alignment.',
    ' - internal: balanced; surface anything anomalous.',
    '',
    'PRIVACY HARD RULES',
    ' - Never include a person, fund, or company name from the data.',
    ' - Never include free-text quotes; you only receive numeric aggregates.',
    ' - If the data is empty or every cell is suppressed (n<5), respond with the',
    '   single bullet: "- [no_signal] No publishable cells in the requested window —',
    '   below k-anonymity floor (n<5)."',
    '',
    'CONFIDENTIALITY',
    ' - The downstream artifact carries an "Axal · Confidential" footer. Match',
    '   that posture: do not include URLs, emails, or any non-aggregate identifier.',
  ].join('\n');
}

function buildUserMessage(opts: {
  title: string; section: string; audience: string;
  filters: Record<string, unknown>; aggregates: AggregateRow[];
}): string {
  const compact = opts.aggregates.slice(0, 80).map(r => ({
    k: r.dimension_key,
    p: r.period_key,
    n: r.n,
    v: r.value,
    ...(Object.keys(r.payload).length > 0 ? { meta: r.payload } : {}),
  }));
  return JSON.stringify({
    title: opts.title,
    section: opts.section,
    audience: opts.audience,
    filters: opts.filters,
    n_cells: compact.length,
    aggregates: compact,
  }, null, 2);
}

function fallbackSummary(rows: AggregateRow[]): string {
  if (rows.length === 0) {
    return '- [no_signal] No publishable cells in the requested window — below k-anonymity floor (n<5).';
  }
  const top = rows.slice(0, 3).map(r =>
    `- [${r.dimension_key}] value=${r.value ?? '—'} across ${r.n} contributors (${r.period_key})`
  );
  return top.join('\n');
}

// ---------------------------------------------------------------------------
// CSV — n<5 rows are excluded by loadSectionAggregates already; we
// re-filter defensively here in case raw rows are passed in.
// ---------------------------------------------------------------------------
export function sectionToCsv(section: string, rows: AggregateRow[]): string {
  const safe = rows.filter(r => (r.n ?? 0) >= K_MIN);
  if (safe.length === 0) {
    return `# section=${csvEscape(section)}\n# k_min=${K_MIN}\n# rows=0\n`;
  }
  const header = ['dimension_key', 'period_key', 'n', 'value', 'payload_json'];
  const lines = [header.join(',')];
  for (const r of safe) {
    lines.push([
      csvEscape(r.dimension_key),
      csvEscape(r.period_key),
      String(r.n),
      r.value === null ? '' : String(r.value),
      csvEscape(JSON.stringify(r.payload || {})),
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

function csvEscape(s: string): string {
  const v = String(s ?? '');
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// ---------------------------------------------------------------------------
// HTML — five-page printable layout for Browser Rendering.
// ---------------------------------------------------------------------------
export interface RenderInput {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  audience: string;
  section: string;
  filters: Record<string, unknown>;
  summary_text: string;
  aggregates: AggregateRow[];
  generated_at: string;       // ISO timestamp
  period_label: string;       // e.g. "Trailing 8 weeks · 2026-W11 → 2026-W18"
}

export function publicationHtml(d: RenderInput): string {
  const esc = htmlEscape;
  const summaryBullets = (d.summary_text || '').split('\n')
    .map(s => s.trim()).filter(s => s.startsWith('-'))
    .map(s => `<li>${esc(s.replace(/^-\s*/, ''))}</li>`).join('');
  const tableRows = d.aggregates.slice(0, 60).map(r => `
    <tr>
      <td>${esc(r.dimension_key)}</td>
      <td>${esc(r.period_key)}</td>
      <td style="text-align:right">${r.n}</td>
      <td style="text-align:right">${r.value === null ? '—' : esc(String(r.value))}</td>
    </tr>`).join('');
  const chartSvg = barChart(d.aggregates.slice(0, 12).map(r => ({
    label: r.dimension_key.split(':').pop()?.slice(0, 12) || '',
    value: Number(r.value ?? 0),
  })));
  const filterList = Object.entries(d.filters || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(String(v))}</li>`).join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>${esc(d.title)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; }
  .page { page-break-after: always; padding: 8px 4px; }
  .page:last-child { page-break-after: auto; }
  .wordmark { font-weight: 700; font-size: 14px; color: #4c1d95; letter-spacing: 0.08em; }
  .audience { display: inline-block; padding: 2px 10px; border-radius: 999px;
              background: #ede9fe; color: #5b21b6; font-size: 11px; font-weight: 600;
              text-transform: uppercase; letter-spacing: 0.06em; }
  .cover { display: flex; flex-direction: column; justify-content: center;
           min-height: 86vh; border-top: 4px solid #7c3aed; padding-top: 36px; }
  .cover h1 { font-size: 40px; line-height: 1.15; margin: 18px 0 6px 0; color: #111; }
  .cover .sub { font-size: 18px; color: #555; margin-bottom: 24px; }
  .cover .meta { font-size: 12px; color: #777; margin-top: auto; }
  h2 { font-size: 18px; color: #4c1d95; border-bottom: 1px solid #ece9fe;
       padding-bottom: 4px; margin-top: 0; }
  ul.bullets li { margin: 6px 0; font-size: 13px; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
  th, td { padding: 5px 8px; border-bottom: 1px solid #eee; text-align: left; }
  th { background: #f8f7ff; color: #4c1d95; font-weight: 600; }
  .footer { position: fixed; bottom: 8mm; left: 16mm; right: 16mm;
            font-size: 9px; color: #888; display: flex; justify-content: space-between;
            border-top: 1px solid #eee; padding-top: 4px; }
  .chart { margin: 14px 0; padding: 10px; border: 1px solid #ece9fe;
           border-radius: 8px; background: #fbfaff; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; color: #444; }
  .meta-grid div { padding: 6px 10px; background: #f8f7ff; border-radius: 6px; }
</style></head>
<body>

<div class="footer">
  <span>Axal Venture Studio · Confidential · ${esc(d.audience)} distribution</span>
  <span>${esc(d.slug)} · Generated ${esc(d.generated_at)}</span>
</div>

<!-- Page 1 — Cover -->
<section class="page cover">
  <div class="wordmark">AXAL · VC</div>
  <span class="audience" style="margin-top:6px">${esc(d.audience)}</span>
  <h1>${esc(d.title)}</h1>
  ${d.subtitle ? `<div class="sub">${esc(d.subtitle)}</div>` : ''}
  <div class="meta">
    <div><strong>Section:</strong> ${esc(d.section)}</div>
    <div><strong>Period:</strong> ${esc(d.period_label)}</div>
    <div><strong>Generated:</strong> ${esc(d.generated_at)}</div>
  </div>
</section>

<!-- Page 2 — Summary -->
<section class="page">
  <h2>Headline summary</h2>
  ${summaryBullets ? `<ul class="bullets">${summaryBullets}</ul>` :
    `<p style="font-size:13px;color:#555">${esc(d.summary_text || 'No summary generated.')}</p>`}
  <div class="meta-grid" style="margin-top:18px">
    <div><strong>Audience:</strong> ${esc(d.audience)}</div>
    <div><strong>Section:</strong> ${esc(d.section)}</div>
    <div><strong>Aggregates:</strong> ${d.aggregates.length} cells (n≥${K_MIN})</div>
    <div><strong>Period:</strong> ${esc(d.period_label)}</div>
  </div>
</section>

<!-- Page 3 — Charts -->
<section class="page">
  <h2>Chart · top dimensions by value</h2>
  <div class="chart">${chartSvg}</div>
  <p style="font-size:11px;color:#777">
    Bars show the top dimension cells by reported value. Cells where the
    contributing population is below ${K_MIN} are suppressed and never appear here.
  </p>
</section>

<!-- Page 4 — Methodology -->
<section class="page">
  <h2>Methodology</h2>
  <p style="font-size:12px; line-height:1.55; color:#333">
    Aggregates are computed by the Axal market-intelligence reconciliation
    job from anonymised, persona-tagged contributions. Each cell shown
    here is grouped by <code>(dimension_key, period_key)</code> and is
    suppressed when the distinct contributor count <code>n</code> falls
    below the k-anonymity floor of <strong>${K_MIN}</strong>. The headline
    summary is drafted by Anthropic Claude haiku-4-5 from the same numeric
    payload (no free-text excerpts) and reviewed by an Axal admin before
    publication. Filters applied to this report:
  </p>
  ${filterList ? `<ul style="font-size:12px;color:#333">${filterList}</ul>` :
    `<p style="font-size:12px;color:#777">(no filters)</p>`}
</section>

<!-- Page 5 — Appendix -->
<section class="page">
  <h2>Appendix · cell-level table</h2>
  <table>
    <thead><tr>
      <th>Dimension</th><th>Period</th>
      <th style="text-align:right">n</th>
      <th style="text-align:right">value</th>
    </tr></thead>
    <tbody>${tableRows || `<tr><td colspan="4" style="color:#888">No cells available.</td></tr>`}</tbody>
  </table>
  <p style="font-size:10px;color:#888;margin-top:18px">
    © Axal Venture Studio. This document and its underlying data are
    confidential. Redistribution outside the named audience is prohibited.
  </p>
</section>

</body></html>`;
}

function barChart(data: Array<{ label: string; value: number }>): string {
  if (!data.length) return '<p style="font-size:11px;color:#888">No chartable cells.</p>';
  const max = Math.max(1, ...data.map(d => d.value || 0));
  const bw = 32, gap = 12, h = 160;
  const w = data.length * (bw + gap) + gap;
  const bars = data.map((d, i) => {
    const bh = Math.max(1, Math.round((d.value / max) * (h - 40)));
    const x = gap + i * (bw + gap);
    const y = h - 24 - bh;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="#7c3aed" rx="3"/>
      <text x="${x + bw/2}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#555">${htmlEscape(d.label)}</text>
      <text x="${x + bw/2}" y="${y - 3}" text-anchor="middle" font-size="9" fill="#333">${formatVal(d.value)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${bars}</svg>`;
}

function formatVal(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function htmlEscape(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

// ---------------------------------------------------------------------------
// HMAC download tokens — 24h TTL.
// ---------------------------------------------------------------------------
function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(env: Env): Promise<CryptoKey> {
  const secret = env.JWT_SECRET || 'dev-secret-do-not-use';
  if ((env as { ENVIRONMENT?: string }).ENVIRONMENT === 'production' &&
      (!env.JWT_SECRET || env.JWT_SECRET.length < 16)) {
    throw new Error('JWT_SECRET required to sign publication download tokens');
  }
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}
export async function signPublicationToken(env: Env, storageKey: string, ttlSec = 86400): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `pub|${storageKey}|${exp}`;
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
}
export async function verifyPublicationToken(env: Env, token: string): Promise<{ key: string } | null> {
  try {
    const [pB64, sB64] = token.split('.');
    if (!pB64 || !sB64) return null;
    const payloadBytes = b64urlDecode(pB64);
    const sigBytes = b64urlDecode(sB64);
    const key = await hmacKey(env);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!ok) return null;
    const payload = new TextDecoder().decode(payloadBytes);
    const [tag, storageKey, expStr] = payload.split('|');
    if (tag !== 'pub' || !storageKey || !expStr) return null;
    if (Math.floor(Date.now() / 1000) > Number(expStr)) return null;
    if (!storageKey.startsWith('publications/')) return null;
    return { key: storageKey };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------
export function baseSlug(title: string): string {
  return String(title || 'publication')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'publication';
}

export async function uniqueSlug(env: Env, title: string): Promise<string> {
  const base = baseSlug(title);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${randHex(3)}`;
    const r = await env.DB.prepare('SELECT id FROM admin_publications WHERE slug = ? LIMIT 1')
      .bind(candidate).first();
    if (!r) return candidate;
  }
  // Hard fallback — append timestamp.
  return `${base}-${Date.now().toString(36)}`;
}

function randHex(n: number): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

export function periodLabel(rows: AggregateRow[]): string {
  if (!rows.length) return 'No data in window';
  const periods = Array.from(new Set(rows.map(r => r.period_key))).sort();
  if (periods.length === 1) return periods[0];
  return `${periods[0]} → ${periods[periods.length - 1]} (${periods.length} periods)`;
}
