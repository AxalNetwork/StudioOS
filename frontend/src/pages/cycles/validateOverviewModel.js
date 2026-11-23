// D5998 (#5998): the pure half of Validate's V2 overview (boards V1, V2, V13): the overview read's evidence, needs-attention, hypotheses and changes parts turned into what ValidateOverview.jsx draws.
/**
 * Every function reads one part of `GET /api/cycles/validate/overview` as D5996 sends it:
 * `{ state: 'ok', … }` or `{ state: 'unavailable', reason }`. A part a read does not carry (an older read)
 * is `{ state: 'absent' }` and draws nothing. A figure with no population is Not recorded, never 0; a
 * count over a population that exists stays a counted zero. Nothing here works out a figure the read did
 * not send.
 */

/** A part's view state: `ok`, `unavailable` (with the Worker's reason), or `absent` (the read predates it). */
export function partState(part) {
  if (!part || typeof part !== 'object') return { state: 'absent' };
  if (part.state === 'ok') return { state: 'ok' };
  return { state: 'unavailable', reason: typeof part.reason === 'string' && part.reason ? part.reason : null };
}

const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * V1's Evidence row: six figures, each with what it counts (`population`) and over what period (`window`),
 * so every count says which population it is. `value` is the figure as text ("4", "1 of 2"), or null for
 * Not recorded with the read's own reason.
 */
export function evidenceView(raw) {
  const part = raw?.evidence;
  const s = partState(part);
  if (s.state !== 'ok') return { ...s, figures: [] };
  const figures = (Array.isArray(part.figures) ? part.figures : []).map((f) => {
    const value = num(f?.value);
    const of = num(f?.of);
    return {
      key: String(f?.key ?? f?.label ?? ''),
      label: String(f?.label ?? ''),
      value: value == null ? null : of == null ? String(value) : `${value} of ${of}`,
      detail: typeof f?.detail === 'string' && f.detail ? f.detail : null,
      reason: typeof f?.reason === 'string' && f.reason ? f.reason : null,
      population: typeof f?.population === 'string' ? f.population : '',
      window: typeof f?.window === 'string' ? f.window : '',
    };
  });
  return { state: 'ok', figures };
}

/** The V13 word and tone for an attention item's or a hypothesis's state. */
export const STATE_TAGS = Object.freeze({
  needs_review: { label: 'Needs review', tone: 'review' },
  result_needed: { label: 'Result needed', tone: 'result' },
  not_recorded: { label: 'Not recorded', tone: 'not_recorded' },
  processing: { label: 'Processing', tone: 'processing' },
  not_expected: { label: 'Not expected yet', tone: 'muted' },
  locked: { label: 'Locked', tone: 'muted' },
});

/** Needs attention: at most the four the read sends, and the read's own total of candidates. */
export function attentionView(raw) {
  const part = raw?.attention;
  const s = partState(part);
  if (s.state !== 'ok') return { ...s, items: [], total: 0, line: '' };
  const items = (Array.isArray(part.items) ? part.items : []).map((a, i) => ({
    key: `${a?.kind || 'item'}-${i}`,
    kind: String(a?.kind || ''),
    tag: STATE_TAGS[a?.state] || STATE_TAGS.needs_review,
    label: String(a?.label || ''),
    detail: typeof a?.detail === 'string' && a.detail ? a.detail : null,
    action: typeof a?.action === 'string' && a.action ? a.action : null,
    href: typeof a?.href === 'string' && a.href.startsWith('/') ? a.href : null,
  }));
  const total = Number.isInteger(part.total) && part.total >= items.length ? part.total : items.length;
  const line = !items.length ? '' : total > items.length
    ? `${items.length} of ${total} · most useful first`
    : `${total} ${total === 1 ? 'item' : 'items'} · most useful first`;
  return { state: 'ok', items, total, line };
}

/** A claim's computed evidence status (the board's, never the founder's decision) in V7's words. */
export const CLAIM_WORDS = Object.freeze({
  untested: 'Not started',
  testing: 'Testing',
  contested: 'Mixed',
  supported: 'Supported',
  refuted: 'Refuted',
  inconclusive: 'Inconclusive',
});

/** The experiment line of a hypothesis row: its title and where it stands, or that none is linked. */
function experimentLine(e) {
  if (!e || typeof e !== 'object') return { text: 'No experiment yet', resultNeeded: false };
  const title = typeof e.title === 'string' && e.title ? e.title : 'Experiment';
  if (e.result_needed === true) return { text: title, resultNeeded: true };
  const where = e.status === 'done' ? (e.result_recorded ? 'result recorded' : 'done')
    : e.status === 'running' ? 'running' : e.status === 'planned' ? 'planned' : String(e.status || '');
  return { text: where ? `${title} · ${where}` : title, resultNeeded: false };
}

/**
 * Active hypotheses: code, claim, computed status, direction counts, source breadth, the newest experiment
 * and one action. A reader is sent to open the hypothesis, never to a write.
 */
export function hypothesesView(raw, { writer = false } = {}) {
  const part = raw?.hypotheses;
  const s = partState(part);
  if (s.state !== 'ok') return { ...s, rows: [], total: 0 };
  const rows = (Array.isArray(part.items) ? part.items : []).map((h) => {
    const supporting = num(h?.supporting) ?? 0;
    const contradicting = num(h?.contradicting) ?? 0;
    const experiment = experimentLine(h?.experiment);
    const action = !writer ? 'Open'
      : experiment.resultNeeded ? 'Record the result'
        : supporting + contradicting === 0 ? 'Link evidence' : 'Review evidence';
    return {
      key: String(h?.id ?? h?.code ?? ''),
      code: String(h?.code || ''),
      claim: String(h?.claim || ''),
      status: CLAIM_WORDS[h?.status] || null,
      supporting, contradicting,
      sources: typeof h?.sources_label === 'string' ? h.sources_label : '',
      experiment,
      action,
      href: typeof h?.href === 'string' && h.href.startsWith('/') ? h.href : null,
    };
  });
  const total = Number.isInteger(part.total) ? part.total : rows.length;
  return { state: 'ok', rows, total };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-06 10:00:00" or an ISO stamp → "6 Nov"; anything else → null, never a made-up day. */
export function shortDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** Recent changes: the read's latest rows, each with its day and what changed in which module. */
export function changesView(raw) {
  const part = raw?.changes;
  const s = partState(part);
  if (s.state !== 'ok') return { ...s, rows: [] };
  const rows = (Array.isArray(part.items) ? part.items : []).map((c, i) => ({
    key: `${c?.at || ''}-${i}`,
    day: shortDay(c?.at),
    module: String(c?.module_name || c?.module || ''),
    text: typeof c?.summary === 'string' && c.summary ? c.summary : String(c?.action || '').replace(/_/g, ' '),
  }));
  return { state: 'ok', rows };
}

/**
 * V13's empty overview: with every module card empty, one "Still to establish" list (each card's own name
 * and reason, Not recorded) replaces the evidence, attention and hypothesis sections. A card that failed or
 * holds anything means the venture is not empty, and the sections draw as usual.
 */
export function stillToEstablish(raw) {
  const cards = (Array.isArray(raw?.cards) ? raw.cards : []).filter((c) => c && c.slug !== 'verdict');
  if (!cards.length || !cards.every((c) => c.state === 'empty')) return null;
  return cards.map((c) => ({
    key: String(c.slug),
    name: String(c.name || c.slug),
    reason: typeof c.reason === 'string' && c.reason ? c.reason : null,
    href: typeof c.next?.href === 'string' && c.next.href.startsWith('/') ? c.next.href : null,
    cta: typeof c.next?.text === 'string' && c.next.text ? c.next.text : null,
  }));
}

/** Whether this viewer writes: the read's own `can_write`, and never while the page is read-only (support, narrative admin). */
export const validateWriter = (raw, readOnly = false) => raw?.can_write === true && !readOnly;
