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
export const STEPS = ['Audience', 'Sources', 'Outline', 'Build'];
export const PROMPT_HINT = 'Tone, emphasis, what to lead with. Figures always come from your records.';
export const NO_ROUND = 'No active round yet.';
export const ROUND_LINK = { text: 'Plan it in Raise › Round planner ›', path: '/raise/calls' };
export const PROPOSED_BY_EADWYN = 'Proposed by Eadwyn';
export const PROPOSAL_LINE = 'Figures come from your records. Eadwyn wrote the wording.';
export const TITLES_ONLY_LINE = 'Figures come from your records. The cards carry their titles.';
export const PAID_LINE = 'Paid in AI tokens. Figures from your records cost nothing; the cost is Eadwyn writing the wording.';
export const FAST_TITLE = 'Build a standard deck now';
export { NOT_ON_STUDIOOS };

const pad2 = (n) => String(n).padStart(2, '0');
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

/** A refused press, as the page draws it: the sentence, and the module to record the figure in. */
export function refusalOf(e) {
  if (!e) return null;
  const data = e.data && typeof e.data === 'object' ? e.data : {};
  const code = e.code || data.error || null;
  const message = e.message || data.message || 'That did not work. Nothing was changed.';
  const link = code === 'figure_in_prompt' && typeof data.href === 'string' && data.href.startsWith('/')
    ? { text: data.module ? `Open ${data.module} ›` : 'Open your sources ›', href: data.href } : null;
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
  return `StudioOS builds ${cards} card${cards === 1 ? '' : 's'} from your records. ${price} The deck is a proposal: nothing is a version until you keep cards and save.`;
}

export const keepSentence = (card) => `Card ${card.n} · ${card.title} joins the cards you keep. Nothing is a version until you save.`;
export const keepAllSentence = (count) => `All ${count} cards join the cards you keep. Nothing is a version until you save.`;
export const saveSentence = (kept, total, audience) =>
  `The ${kept} card${kept === 1 ? '' : 's'} you kept, of ${total}, become the new current version${audience ? ` for ${audience}` : ''}. The proposal is then removed; your earlier versions stay as they are.`;
export const DISCARD_SENTENCE = 'The whole proposal is deleted, with any cards you kept from it. No deck version changes.';

export function fastPathLine(quote, audienceLabel = 'a seed fund') {
  const price = quote?.ai ? ` About ${aiTokens(quote.hold_microusd)} in AI tokens.` : quote?.ai === false && quote.reason === 'assist_off' ? ' AI is off on this page: figures and titles only, at no cost.' : '';
  return `Twelve cards from everything on record, for ${audienceLabel}. Review sources afterwards.${price}`;
}

// ─────────────────────────────────────────────────────────── the proposal

/** A card of the proposal as PD6 B draws it: its words, and each figure from its own binding. */
export function proposalCards(proposal, items = []) {
  const slides = Array.isArray(proposal?.slides) ? proposal.slides : [];
  const kept = new Set(Array.isArray(proposal?.kept) ? proposal.kept : []);
  return slides.map((s, i) => {
    const blocks = Array.isArray(s?.blocks) ? s.blocks : [];
    const heading = blocks.find((b) => b?.kind === 'text' && b.style === 'heading');
    const body = blocks.find((b) => b?.kind === 'text' && b.style === 'paragraph');
    const figures = blocks.filter((b) => b?.kind === 'metric').map((b) => {
      const key = b.binding?.source_key || null;
      const it = items.find((x) => x.source_key === key);
      const recorded = b.value != null && b.binding?.grade && b.binding.grade !== 'Not recorded';
      return { key, label: b.label || it?.label || key, value: recorded ? String(b.value) : null, grade: recorded ? b.binding.grade : 'Not recorded', module: it?.module || null, href: it?.href || null };
    });
    return {
      index: i, n: pad2(i + 1), title: String(s?.title || `Card ${i + 1}`),
      headline: heading?.text || null, body: body?.text || null,
      figures, missing: figures.filter((f) => f.value == null), kept: kept.has(i),
    };
  });
}

/** PD6 A: per card, what it was filled from, and whether Eadwyn worded it. */
export function progressRows(progress = []) {
  return progress.map((p) => ({
    n: pad2(p.n), title: p.title,
    status: p.slots ? `Filled from records · ${p.filled} of ${p.slots}` : 'No figures on this card',
    words: p.worded ? 'Eadwyn wrote the words' : 'Title only',
    missing: p.missing || [],
  }));
}

/** PD6 A's totals: charged by the run, nothing held once it answered, and the estimate it was quoted. */
export function costRows(cost, quote) {
  return [
    { label: 'Used so far', value: cost?.charged_microusd == null ? 'Not known yet' : aiTokens(cost.charged_microusd) },
    { label: 'Held', value: aiTokens(0) },
    { label: 'Estimated for the whole deck', value: quote?.ai ? aiTokens(quote.hold_microusd) : quote ? aiTokens(0) : 'Not quoted' },
  ];
}
