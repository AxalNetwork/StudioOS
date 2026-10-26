/**
 * D1141 (#2433) — Product-market fit on Fundraising readiness: the words the
 * readiness page draws until it draws the stored score (part 4), and, since
 * D1146 (#3032), RD4's method and RD12's chip, each from a Worker read. Pure,
 * so the tests read it without a browser.
 */

export const TITLE = 'Product-market fit';
export const NOT_YET = 'Not scored yet. No score is computed from Validate yet, so none is shown. This is not a claim that the venture has no fit.';
export const READS = 'It will read only what Validate records: interviews, pains, segments, claims, demand, experiments, the Verdict, and product use once a product is live.';
/**
 * D1146 (#3032) — RD4, "How Product-market fit is scored", is drawn from the
 * stored model (`GET /api/cycles/raise/pmf/model`), never a copy kept here:
 * the inputs, their rules and weights, the confidence words and floor, the
 * bands and the freshness windows are the model's own. Only the grades' words
 * are the page's; their factors are SCORING's table, sent with the model.
 */
export const GRADE_WORDS = [
  ['measured', 'Measured', 'a recorded session, a connector, the platform\'s waitlist or a verified payment'],
  ['reviewed', 'Reviewed', 'set by someone other than the founder'],
  ['sourced', 'Sourced', 'typed with a file, a link, or a dated record'],
  ['stated', 'Stated', 'typed with no source'],
  ['not_recorded', 'Not recorded', 'nothing in Validate. It lowers confidence and is never a zero'],
];

/** The modules a model input may open; anything else is drawn without a link. */
const VALIDATE_MODULES = new Set(['customer-research', 'record', 'problem-discovery', 'ideal-customer-profile', 'experiments', 'demand-signals', 'verdict']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD…' → '25 Oct 2026'. */
export function dayText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
const two = (n) => Number(n).toFixed(2);

/**
 * The method dialog's content from the model read: `{ state }` while it reads
 * or when it failed, or every line RD4 draws. A refusal is its own state, so
 * a venture the caller cannot open is never drawn as a model.
 */
export function methodOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'refused') return { state: 'refused' };
  if (read.status !== 'ready' || !read.data?.model) return { state: 'unreadable' };
  const { model, grades = {}, stored, scored_with: scoredWith, published_at: publishedAt, version } = read.data;
  const inputs = (model.inputs || []).map((i) => ({
    key: i.key, name: i.label, reads: i.reads, weight: i.weight,
    module: VALIDATE_MODULES.has(i.module) ? i.module : null,
    freshness: i.freshness,
  }));
  const conf = [...(model.confidence || [])].sort((x, y) => y[0] - x[0]);
  const bands = [...(model.bands || [])].sort((x, y) => y[0] - x[0]);
  const ranges = (rows, fmt, top) => rows.map(([from, word], k) => {
    if (k === 0) return `${word} ${fmt(from)} or more`;
    if (k === rows.length - 1 && from === 0) return `${word} under ${fmt(rows[k - 1][0])}`;
    return `${word} ${fmt(from)}–${top(rows[k - 1][0])}`;
  });
  return {
    state: 'ready',
    title: `Model v${version || model.version}`,
    status: stored
      ? `Published ${dayText(publishedAt || model.published)}${scoredWith ? ' · the model this venture’s latest score used' : ''}`
      : `Not stored on this database yet. It is stored with the venture’s first score, as written here.`,
    inputs,
    total: inputs.reduce((t, i) => t + (Number(i.weight) || 0), 0),
    grades: GRADE_WORDS.map(([key, label, why]) => ({ key, label, why, factor: Number.isFinite(grades[key]) ? two(grades[key]) : null })),
    confidence: ranges(conf, two, (x) => two(x - 0.01)).join(' · '),
    floor: `Below ${two(model.floor)} confidence it shows "Not enough recorded" and no number.`,
    bands: ranges(bands, String, (x) => String(x - 1)).join(' · '),
    freshness: `An input older than ${model.freshness_days?.records} days (records) or ${model.freshness_days?.connector} days (a connector figure) is stale, and its grade counts half.`,
  };
}

const BAND_GLYPH = { Strong: '●', Fair: '◐', Weak: '○' };
const CONF_DOTS = { High: '●●●', Medium: '●●○', Low: '●○○' };

/**
 * RD12's chip on Validate's overview, from the venture's latest stored point
 * (`pmfHistory` with `limit: 1`). It reads the store only; the readiness page
 * is where a score is computed. A refused read names nothing: the chip is the
 * door alone, never "no score".
 */
export function chipOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading', text: 'Product-market fit · reading…' };
  if (read.status === 'refused') return { state: 'door', text: 'Product-market fit' };
  if (read.status !== 'ready') return { state: 'unreadable', text: 'Product-market fit · could not be read' };
  const p = (read.data?.items || []).at(-1);
  if (!p) return { state: 'none', text: 'Product-market fit · Not scored yet' };
  const conf = p.confidence_word ? `${CONF_DOTS[p.confidence_word] || ''} ${p.confidence_word}`.trim() : '';
  if (p.value === null || p.value === undefined || !p.band) {
    return { state: 'not_enough', text: 'Product-market fit · Not enough recorded', label: 'Product-market fit: not enough recorded for a score', when: dayText(p.computed_at) };
  }
  return {
    state: 'scored',
    text: `Product-market fit · ${BAND_GLYPH[p.band] || ''} ${p.band}${conf ? ` · ${conf}` : ''}`.replace(/\s+/g, ' '),
    label: `Product-market fit: ${p.band}${p.confidence_word ? `, ${p.confidence_word} confidence` : ''}`,
    when: dayText(p.computed_at),
  };
}

/** A Validate module's address, keeping the venture. */
export function validateHref(module, search = '') {
  const m = /[?&](?:project_id|project)=([1-9]\d*)/.exec(String(search || ''));
  return `/validate${module ? `/${module}` : ''}${m ? `?project_id=${m[1]}` : ''}`;
}

/** The readiness page's address, keeping the venture (RD12's door from Validate). */
export function readinessHref(search = '') {
  const m = /[?&](?:project_id|project)=([1-9]\d*)/.exec(String(search || ''));
  return `/raise/fundraising-readiness${m ? `?project_id=${m[1]}` : ''}`;
}

