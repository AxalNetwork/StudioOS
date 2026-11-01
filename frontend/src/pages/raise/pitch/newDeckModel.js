/**
 * D897 (#2677, part 3 of #2434) — New deck's words and derivations, pure.
 *
 * Every figure here comes from a read: the context (`GET /api/decks/new/context`),
 * the sources (`GET /api/decks/sources`), a quote, or a proposal the Worker
 * built. A value nobody recorded reads "Not recorded on StudioOS" with its
 * module link, never 0. Costs are AI tokens, in dollars of tokens, to four
 * places under a dollar, as the receipt prints them.
 */
import { ADD_TOKENS_PATH } from '../../../lib/aiTokens';
import { NOT_ON_STUDIOOS } from './sourcesModel';

export const NEW_PATH = '/raise/pitch/new';
export const NO_ROUND = 'No active round yet.';
export const ROUND_LINK = { text: 'Plan it in Raise › Round planner ›', path: '/raise/calls' };
export const PROPOSED_BY_EADWYN = 'Proposed by Eadwyn';
export const PROPOSAL_LINE = 'Figures come from your records. Eadwyn wrote the wording.';
export const TITLES_ONLY_LINE = 'Figures come from your records. The cards carry their titles.';
export const FAST_TITLE = 'Build a standard deck now';
export { NOT_ON_STUDIOOS };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** AI tokens as dollars: `$0.0060` under a dollar, `$1.25` above; null when there is no figure. */
export function aiTokens(micro) {
  if (micro == null || !Number.isFinite(Number(micro))) return null;
  const usd = Number(micro) / 1_000_000;
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

// The Worker's `numberIn` (services/decks/newDeck.ts), so the prompt is flagged as it is typed.
const NUMBER_WORDS = ['zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty',
  'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'hundreds', 'thousand', 'thousands', 'million', 'millions', 'billion',
  'billions', 'trillion', 'dozen', 'dozens', 'half', 'double', 'doubled', 'triple', 'tripled', 'twice', 'percent'];
const NUMBER_RE = new RegExp(`\\d|[%$€£¥]|\\b(?:${NUMBER_WORDS.join('|')})\\b`, 'i');
export const numberIn = (text) => (typeof text === 'string' ? NUMBER_RE.exec(text)?.[0] ?? null : null);

/** The prompt's own warning before anything is sent; the Worker's 422 is the rule. */
export const promptWarning = (text) => (numberIn(text) ? 'Figures come from your records, never from the prompt. Take the figure out, or record it in its module.' : null);

/** The plan gate's link (PD-9): the plans page, as the AIRail's "See plans ›". */
export const SEE_PLANS = 'See plans ›';
export const PLANS_PATH = '/pricing';

/** A refused press, as the page draws it: the sentence, and the module to record the figure in. */
export function refusalOf(e) {
  if (!e) return null;
  const data = e.data && typeof e.data === 'object' ? e.data : {};
  const code = e.code || data.error || null;
  const message = e.message || data.message || 'That did not work. Nothing was changed.';
  // D1604 (PD-9 plan gate): a press the plan does not include links to the plans, never to a top-up.
  const link = code === 'figure_in_prompt' && typeof data.href === 'string' && data.href.startsWith('/')
    ? { text: data.module ? `Open ${data.module} ›` : 'Open your sources ›', href: data.href }
    : code === 'tier_required' ? { text: SEE_PLANS, href: PLANS_PATH } : null;
  const topUp = e.status === 402 && code !== 'tier_required' ? { text: 'Add tokens', href: ADD_TOKENS_PATH } : null;
  return { code, message, link, topUp };
}

const instrumentLabel = (v) => ({ safe: 'SAFE', equity: 'Equity', convertible_note: 'Convertible note' }[v] || (v ? String(v) : null));

export function dayText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** PD3's round line: name · instrument · amount · close, each part Not recorded when missing. */
export function roundLine(round) {
  if (!round) return null;
  const amount = round.target_amount != null && Number(round.target_amount) > 0 ? `$${Math.round(Number(round.target_amount)).toLocaleString('en-US')}` : 'amount not recorded';
  const close = dayText(round.close_date);
  return [round.name || 'Round', instrumentLabel(round.instrument) || 'instrument not recorded', amount, close ? `close ${close}` : 'close not recorded'].join(' · ');
}

/** PD3's Start from: blank, each past version, then the templates, premium ones behind the plan lock. */
export function startOptions(versions = [], methods = []) {
  return [
    { kind: 'blank', id: 'blank', label: 'Blank' },
    ...versions.filter((v) => v?.id != null).map((v) => ({ kind: 'version', id: v.id, label: `Past version v${v.version ?? '?'}` })),
    ...methods.filter((m) => m?.id).map((m) => ({ kind: 'template', id: m.id, label: m.label || m.id, locked: Boolean(m.locked) })),
  ];
}

// ─────────────────────────────────────────────────────────── the outline

/** Move a row from one place to another (drag, or the arrows). */
export function moveRow(rows, from, to) {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = rows.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}
export const removeRow = (rows, i) => rows.filter((_, j) => j !== i);
export const editRow = (rows, i, patch) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r));

/** "+ Add slide": a catalogue card at the end, with its own title and purpose. */
export function addRow(rows, card, catalogue = []) {
  const spec = catalogue.find((c) => c.card === card);
  return spec ? [...rows, { card: spec.card, title: spec.title, purpose: spec.purpose }] : rows;
}

/** The first outline row whose words name a number, as the Worker would refuse it; null when none does. */
export function rowWarning(rows) {
  const i = rows.findIndex((r) => numberIn(`${r.title} ${r.purpose}`));
  return i < 0 ? null : `Row ${i + 1} names a figure. Figures come from your records; take it out of the title or the purpose.`;
}

/** The chips one outline row will use: each source slot of its card, as the records hold it now. */
export function chipsFor(row, catalogue = [], items = [], excluded = new Set()) {
  const spec = catalogue.find((c) => c.card === row.card);
  if (!spec) return [];
  const keys = spec.appendix ? items.filter((it) => it.state === 'recorded' && !it.optional).map((it) => it.source_key) : spec.sources || [];
  return keys.filter((k) => !excluded.has(k)).map((k) => {
    const it = items.find((x) => x.source_key === k);
    return { key: k, label: it?.label || k, recorded: it?.state === 'recorded', source: it?.source || null, module: it?.module || null };
  });
}

/** PD5's estimate line: the quote, and the member's own average when they have runs. */
export function estimateLine(quote, average) {
  const est = quote?.ai ? aiTokens(quote.hold_microusd) : null;
  if (quote && quote.ai === false) return quote.reason === 'assist_off' ? 'AI is off on this page: the cards are your figures with their titles, at no cost.' : (quote.message || 'The price could not be worked out.');
  if (!est) return null;
  const avg = average?.runs ? ` · Your average ${aiTokens(average.average_microusd)} over ${average.runs} run${average.runs === 1 ? '' : 's'}` : '';
  return `Estimated ${est}${avg}`;
}

// ─────────────────────────────────────────────────────────── the dialogs

export function outlineSentence(quote, regenerate) {
  const price = quote?.ai ? `It holds up to ${aiTokens(quote.hold_microusd)} in AI tokens and is charged for what it uses.` : 'AI is off on this page, so StudioOS proposes its standard outline at no cost.';
  return `${regenerate ? 'Eadwyn proposes a new outline in place of this one' : 'Eadwyn proposes an outline'} for the audience and length you chose. ${price} It replaces any deck proposal you have not kept; no deck version changes.`;
}

export function buildSentence(quote, cards) {
  const price = quote?.ai ? `Eadwyn writes the wording, holding up to ${aiTokens(quote.hold_microusd)} in AI tokens and charging for what it uses.` : 'AI is off on this page, so the cards carry their titles, at no cost.';
  const what = cards == null ? 'the deck' : `${cards} card${cards === 1 ? '' : 's'}`;
  return `StudioOS builds ${what} from your records. ${price} The deck is a proposal: you review it, and nothing is saved until you accept it.`;
}

export const DISCARD_SENTENCE = 'The whole proposal is deleted, with any cards you kept from it. No deck version changes.';

/**
 * D1604 (#3716, §3.2 step 1) — the one-click's brief, from the context read
 * (`GET /api/decks/new/context`): #3877's `inferred` when the read carries
 * it, else the Worker's `fast_path`. `label` is the audience's own label
 * from the same read and `cards` the standard outline's count for that
 * length. Null until the read answers: the client never guesses a brief
 * (never a literal audience or length of its own).
 */
export function fastBrief(ctx) {
  const inf = ctx?.inferred;
  const pick = inf?.audience && inf?.length ? inf : ctx?.fast_path;
  if (!pick?.audience || !pick?.length) return null;
  const label = (Array.isArray(ctx.audiences) ? ctx.audiences : []).find((a) => a?.id === pick.audience)?.label || null;
  const outline = ctx?.standard?.[pick.length];
  return { audience: pick.audience, length: pick.length, label, cards: Array.isArray(outline) && outline.length ? outline.length : null, why: (pick === inf && inf.why) || null };
}

/** The one-click's line under its title: the brief it will build, then the quote's price. Before the context read, no brief is named. */
export function fastPathLine(quote, brief = null) {
  const price = quote?.ai ? ` About ${aiTokens(quote.hold_microusd)} in AI tokens.` : quote?.ai === false && quote.reason === 'assist_off' ? ' AI is off on this page: figures and titles only, at no cost.' : '';
  const what = brief?.cards ? `${brief.cards} cards` : 'A deck';
  const who = brief?.label ? `, for the ${brief.label} audience` : '';
  return `${what} from everything on record${who}. Review sources afterwards.${price}`;
}
