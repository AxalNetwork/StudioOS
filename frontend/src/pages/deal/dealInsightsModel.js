/**
 * D1154 (#3059, part 6 of #2421) — the pure model of the reading tabs Team
 * (DL4), Market (DL5) and Traction (DL6), over D1151's reads
 * (`GET /api/deals/:id/team`, `/market`, `/traction`, `dealInsightsApi`).
 *
 * Each read answers one of three ways, and each is drawn as itself:
 *   · masked: the viewer has no NDA on file with the founder. Only the
 *     company's name, sector, stage and headline come back, and the tab says
 *     the NDA opens the rest;
 *   · unreadable: the read failed. "Unreadable" with Try again, never empty;
 *   · open: every block carries `state` (recorded, not_recorded,
 *     unreadable), and each block is drawn from its own state alone.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A figure the read holds as null is "Not
 * recorded" with the read's reason; a month the founder did not report is a
 * gap in the series, never a 0. A recorded 0 stays 0.
 *
 * NO TOTAL SCORE. Coverage is the read's coarse band per skill axis (covered,
 * partial, gap), never a number. The scorecard rows on each tab are slots for
 * SCORING's canvas (#2428), which draws them once its per-deal read lands.
 */

import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };
export const NOT_REPORTED = 'Not reported';

/** How a whole read is drawn: masked, unreadable or open. */
export function insightState(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const d = read.data;
  if (d?.masked === true) {
    const p = d.project && typeof d.project === 'object' ? d.project : {};
    return { state: 'masked', project: { name: p.name || null, sector: p.sector || null, stage: p.stage || null, headline: p.headline || null } };
  }
  if (d?.masked === false) return { state: 'open', data: d };
  return { state: 'unreadable' };
}

/** What the masked tab says. The NDA is signed from Documents (D1153). */
export const MASKED = {
  title: 'This opens once you sign the NDA',
  line: 'The founder shares the team, the market and the figures with investors who have an NDA on file with them. Until then you see the company’s name, sector, stage and headline.',
  act: 'Sign the NDA on Documents',
};

/** One block of an open read: its rows, or why there are none. */
export function blockOf(block) {
  if (!block || typeof block !== 'object') return { state: 'unreadable' };
  if (block.state === 'recorded') return { state: 'recorded', data: block.data };
  if (block.state === 'not_recorded') return { state: 'not_recorded', reason: block.reason || NOT_RECORDED };
  return { state: 'unreadable' };
}

// ---------------------------------------------------------------- figures

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** A figure in its unit; a missing one is null, never "0". */
export function figureText(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (unit === 'usd') return usd0.format(value);
  if (unit === 'pct') return `${num.format(value)}%`;
  if (unit === 'months') return `${num.format(value)} ${value === 1 ? 'month' : 'months'}`;
  return num.format(value);
}

/** A source as the canvas's chip says it: a typed figure says so. */
export function sourceText(source) {
  if (typeof source !== 'string' || !source.trim()) return null;
  const s = source.trim();
  return /^(typed|manual)$/i.test(s) ? 'Typed · the founder’s own figure' : `From ${s}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-10` → `Oct 2026`; `2026-10-09` → `9 Oct 2026`. */
export function dateText(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(s ?? ''));
  if (!m) return null;
  const mon = MONTHS[Number(m[2]) - 1];
  if (!mon) return null;
  return m[3] ? `${Number(m[3])} ${mon} ${m[1]}` : `${mon} ${m[1]}`;
}

// ---------------------------------------------------------------- DL4 Team

const ROLE_WORDS = { founder: 'Founder', cofounder: 'Co-founder', co_founder: 'Co-founder', owner: 'Founder', member: 'Team member', editor: 'Team member', viewer: 'Team member', advisor: 'Advisor' };
const roleWord = (r) => ROLE_WORDS[String(r ?? '').toLowerCase()] || (r ? String(r).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Team member');

/** One person as they published themselves. Nothing they did not publish is drawn. */
export function personView(p) {
  const roles = p.prior_roles_state === 'unreadable'
    ? { state: 'unreadable' }
    : Array.isArray(p.prior_roles) && p.prior_roles.length
      ? { state: 'recorded', rows: p.prior_roles.map((r) => {
        const head = [r.title, r.company].filter(Boolean).join(' at ') || NOT_RECORDED;
        const span = [r.start, r.end].filter(Boolean).join('–');
        return span ? `${head}, ${span}` : head;
      }) }
      : { state: 'not_published' };
  const initials = String(p.name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';
  return {
    key: p.uid || p.name,
    name: p.name || NOT_RECORDED,
    initials,
    role: roleWord(p.role),
    archetype: p.archetype?.label || null,
    roles,
    fullTime: p.full_time_since ? dateText(p.full_time_since) : null,
    fullTimeReason: p.full_time_reason || NOT_RECORDED,
    fit: p.founder_market_fit || null,
    fitReason: p.founder_market_fit_reason || NOT_RECORDED,
  };
}

/** The band words, in the canvas's tone. Coverage is a band, never a number. */
export const BANDS = {
  covered: { word: 'Covered', tone: 'done' },
  partial: { word: 'Partial', tone: 'wait' },
  gap: { word: 'Gap', tone: 'gap' },
};

/** The eight axes with their band, or why there is none; and the gaps by name. */
export function coverageView(block) {
  const b = blockOf(block);
  if (b.state !== 'recorded') return b;
  const axes = (Array.isArray(b.data) ? b.data : []).map((a) => (BANDS[a.coverage_band]
    ? { slug: a.slug, label: a.label, band: a.coverage_band, ...BANDS[a.coverage_band] }
    : { slug: a.slug, label: a.label, band: null, word: NOT_RECORDED, reason: a.reason || NOT_RECORDED }));
  const gaps = axes.filter((a) => a.band === 'gap').map((a) => a.label);
  return {
    state: 'recorded',
    axes,
    gaps,
    summary: gaps.length ? `Gaps: ${gaps.join(', ')}.` : axes.some((a) => a.band) ? 'No axis is a gap.' : 'No axis has two published team members yet.',
  };
}

export const COVERAGE_NOTE = 'The team’s band on each of the eight skill axes, from at least two members who published their background. Individual skills and values are never shown.';

// ---------------------------------------------------------------- DL5 Market

const SIZING = [['tam', 'TAM'], ['sam', 'SAM'], ['som', 'SOM']];

/** TAM, SAM and SOM: the figure, or Not recorded; and the source, or why there is none. */
export function sizingView(block) {
  const b = blockOf(block);
  if (b.state !== 'recorded') return b;
  return {
    state: 'recorded',
    tiles: SIZING.map(([key, label]) => {
      const f = b.data?.[key] || {};
      const value = typeof f.value === 'number' && Number.isFinite(f.value) ? f.value : null;
      return {
        key, label,
        value: value == null ? null : usd0.format(value),
        source: sourceText(f.source),
        reason: value == null ? (f.reason || NOT_RECORDED) : (f.source ? null : f.reason || 'No source recorded for this figure'),
      };
    }),
  };
}

/** A link HQ can open: http or https only, never a script address. */
export function safeUrl(u) {
  try { const x = new URL(String(u ?? '')); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
}

const DECISIONS = { go: 'Entering', enter: 'Entering', entering: 'Entering', served: 'Served', serve: 'Served', hold: 'On hold', no_go: 'Not entering', exit: 'Leaving' };

/** A company market: its name, where it stands, and when it was decided. */
export function marketRow(m) {
  const where = DECISIONS[String(m.decision ?? '').toLowerCase()] || (m.state ? String(m.state).replace(/_/g, ' ') : null);
  return { name: m.name || NOT_RECORDED, where: where || NOT_RECORDED, decided: m.decided_on ? dateText(m.decided_on) : null };
}

// ---------------------------------------------------------------- DL6 Traction

/** The tiles, in the canvas's order. ARR and NRR are the read's own Not recorded. */
export const TRACTION_TILES = [
  { key: 'mrr', label: 'MRR' },
  { key: 'growth', label: 'Growth', suffix: ' a month' },
  { key: 'burn', label: 'Net burn', suffix: ' a month' },
  { key: 'runway', label: 'Runway' },
  { key: 'customers', label: 'Paying accounts' },
];

/** The charts, each one figure across the twelve months. */
export const TRACTION_CHARTS = [
  { key: 'mrr', title: 'MRR by month', kind: 'line' },
  { key: 'burn', title: 'Net burn by month', kind: 'bar' },
  { key: 'customers', title: 'Paying accounts by month', kind: 'line' },
];

/**
 * The twelve months as the read gives them, one series per figure. A month
 * the founder did not report, or reported without this figure, is a gap
 * (`value: null`), never 0.
 */
export function tractionView(read) {
  const b = blockOf(read?.history);
  const history = b.state === 'recorded' && Array.isArray(b.data) ? b.data : null;
  const months = history ? history.map((m) => m.month) : [];
  const series = Object.fromEntries(TRACTION_TILES.map(({ key }) => {
    const points = (history || []).map((m) => {
      const f = m.state === 'reported' ? (m.figures || []).find((x) => x.key === key && typeof x.value === 'number' && Number.isFinite(x.value)) : null;
      return f ? { month: m.month, value: f.value, unit: f.unit, source: f.source, as_of: f.as_of } : { month: m.month, value: null };
    });
    return [key, points];
  }));
  const tiles = TRACTION_TILES.map((t) => {
    const latest = [...series[t.key]].reverse().find((p) => p.value != null);
    if (!latest) return { ...t, value: null, reason: history ? 'Not shared in the last twelve months' : NOT_RECORDED };
    const asOf = dateText(latest.as_of) || dateText(latest.month);
    return { ...t, value: `${figureText(latest.value, latest.unit)}${t.suffix || ''}`, source: sourceText(latest.source), asOf: asOf ? `As of ${asOf}` : null };
  });
  const extra = [
    { key: 'arr', label: 'ARR', value: null, reason: read?.arr?.reason || NOT_RECORDED },
    { key: 'nrr', label: 'Net revenue retention', value: null, reason: read?.nrr?.reason || NOT_RECORDED },
  ];
  return {
    state: history ? 'recorded' : b.state,
    months,
    reported: history ? history.filter((m) => m.state === 'reported').length : 0,
    series,
    tiles: [...tiles, ...extra],
  };
}

/** One chart's sentence for a screen reader, and which months are gaps. */
export function chartSummary(title, points) {
  const shown = points.filter((p) => p.value != null);
  const gaps = points.filter((p) => p.value == null).map((p) => dateText(p.month));
  if (!shown.length) return { text: `${title}: nothing reported in the last twelve months.`, gaps };
  const first = shown[0], last = shown[shown.length - 1];
  const fmt = (p) => figureText(p.value, p.unit);
  const gapText = gaps.length ? ` ${gaps.length === 1 ? `${gaps[0]} was` : `${gaps.length} months were`} not reported.` : '';
  return { text: `${title}: ${fmt(first)} in ${dateText(first.month)}, ${fmt(last)} in ${dateText(last.month)}.${gapText}`, gaps };
}

// ---------------------------------------------------------------- DL24 slots

/** The slots from sibling canvases on these tabs (DL24): each says where it comes from and why it is empty. */
export const SLOTS = {
  teamRow: { eye: 'SC row · Venture scorecard canvas', title: 'Team · on the scorecard', line: 'The Team row shows here once the per-deal score read lands (SCORING, #3280). This is not a score of zero.' },
  marketRows: { eye: 'SC rows · Venture scorecard canvas', title: 'Scorecard rows', line: 'Market, Product-market fit, Geographic and Political and regulatory show here once the per-deal score read lands (SCORING, #3280). This is not a score of zero.' },
  tractionRows: { eye: 'SC rows · Venture scorecard canvas', title: 'Scorecard rows', line: 'Traction and Financial show here once the per-deal score read lands (SCORING, #3280). This is not a score of zero.' },
  evidence: { eye: 'VR10 · Raise evidence canvas', title: 'Evidence the founder shared', line: 'The founder’s shared evidence shows here once the investor evidence read lands (PIPE-RAISE, #3291).' },
};

/** A slot fed by the read: its own reason when the read says one, Unreadable when the read failed. */
export function slotOf(slot, block) {
  if (block === undefined) return { ...slot, state: 'waiting' };
  const b = blockOf(block);
  if (b.state === 'unreadable') return { ...slot, state: 'unreadable', line: `${slot.title} could not be read. That is not the same as none. Try again.` };
  return { ...slot, state: 'waiting', line: b.reason ? `${b.reason}. ${slot.line}` : slot.line };
}

/** Words for the team values band, advisors and geography the read holds no figure for. */
export const ADVISORS_LINE = 'No advisor count is read for this deal yet.';
