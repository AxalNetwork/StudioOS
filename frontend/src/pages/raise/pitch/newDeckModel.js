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
export const ROUND_LINK = { text: 'Plan it in Raise › Round planner ›', path: '/raise/capital-relationships/calls' };
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

// ─────────────────────────────────────────────────────────── the price, as a state

/**
 * D4597 (#4597) — what the page knows about the price of the next run, and nothing it does not.
 *
 *   loading      the quote is being read
 *   unavailable  the read failed, or the Worker could not price the run, or it priced a metered run it could
 *                not pin: retry; nothing runs, and the page never says "free"
 *   free         the Worker said, explicitly, that the run costs nothing (AI off for this page, or the build
 *                model off): `ai: false` with one of NO_COST_REASONS
 *   metered      a price and its pinned `quote_uid`: the run is held to it
 *   stale        the Worker refused the quote the page held (`quote_stale`): price it again, confirm again
 *
 * A slot is `{ status: 'loading' | 'ok' | 'failed' | 'stale', quote?, message? }`. A missing quote is never
 * "free": only an explicit no-cost answer is.
 */
export const NO_COST_REASONS = Object.freeze(['assist_off', 'not_switched_on']);
export const PRICE_LOADING = 'Reading the price…';
export const PRICE_UNAVAILABLE = 'The price could not be read, so nothing will run yet. Try again.';
export const PRICE_STALE = 'The price you were shown has changed or lapsed. Here is the price now: confirm it again to go on.';
export const PRICE_RETRY = 'Read the price again';

/** A quote the Worker answered, as a price state. `pinned`: a metered run must name a `quote_uid` to be actionable. */
export function priceState(slot, { pinned = true } = {}) {
  if (slot && typeof slot === 'object' && typeof slot.kind === 'string') return slot;
  const status = slot == null ? 'loading' : slot.status;
  if (status === 'loading') return { kind: 'loading' };
  if (status === 'stale') return { kind: 'stale' };
  const q = slot?.quote;
  if (status !== 'ok' || !q || typeof q !== 'object') return { kind: 'unavailable', message: slot?.message || null };
  if (q.ai === true) {
    const quoteUid = typeof q.quote_uid === 'string' && q.quote_uid ? q.quote_uid : null;
    if (pinned && !quoteUid) return { kind: 'unavailable', message: null };
    return { kind: 'metered', hold: q.hold_microusd, quoteUid };
  }
  if (q.ai === false && NO_COST_REASONS.includes(q.reason)) return { kind: 'free', reason: q.reason };
  return { kind: 'unavailable', message: q.message || null };
}

/** A raw quote (or none) as the sentences below read it; a state passes through. */
export function asPrice(x) {
  if (x && typeof x === 'object' && typeof x.kind === 'string') return x;
  return priceState(x == null ? null : { status: 'ok', quote: x }, { pinned: false });
}

/** Whether the run may be confirmed: only a metered price or an explicit no-cost one. */
export const canConfirm = (price) => ['metered', 'free'].includes(asPrice(price).kind);
/** The exact quote the run is sent with: the metered state's, else none. */
export const quoteUidOf = (price) => { const p = asPrice(price); return p.kind === 'metered' && p.quoteUid ? p.quoteUid : undefined; };
/** The line for a price that is not yet actionable, or null when it is. */
export function priceNote(price) {
  const p = asPrice(price);
  if (p.kind === 'loading') return PRICE_LOADING;
  if (p.kind === 'stale') return PRICE_STALE;
  if (p.kind === 'unavailable') return p.message ? `${p.message} ${PRICE_UNAVAILABLE}` : PRICE_UNAVAILABLE;
  return null;
}

// The Worker's `numberIn` (services/decks/numbers.ts), so the prompt is flagged as it is typed.
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
  // D897 §9 (#3659): another tab moved the proposal; the page offers to read the latest, never to retry blind.
  if (code === 'proposal_changed') return { code, message: STALE_LINE, link: null, topUp: null, reload: true };
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
  const i = rows.findIndex((r) => numberIn(`${r.title} ${r.purpose} ${r.message || ''}`));
  return i < 0 ? null : `Row ${i + 1} names a figure. Figures come from your records; take it out of the title, the purpose or the message.`;
}

/** D897 §9 (#3659): a row's message, the one takeaway its card leaves; the Worker's cap. */
export const MESSAGE_MAX = 160;
export const MESSAGE_LABEL = 'Message';
export const MESSAGE_HINT = 'The one thing this card should leave the reader with. Words only: figures come from your records.';

// ─────────────────────────────────────────────────────────── one card, and other tabs

/** D897 §9 (#3659): the refusal a write gets when another tab moved the proposal since this page read it. */
export const STALE_CODE = 'proposal_changed';
export const STALE_LINE = 'This deck changed in another tab or window. Nothing was changed here.';
export const RELOAD_LATEST = 'Reload the latest';
export const STALE_GONE = 'The other tab kept or discarded this proposal, so it is no longer open.';
export const isStale = (e) => (e?.code || e?.data?.error) === STALE_CODE;

/** The hash a write sends back, or undefined when the page holds none (the Worker then does not check, as before). */
export const baseHash = (h) => (typeof h === 'string' && h ? h : undefined);
/** A write's body with `base_hash` when the page holds one, and without the key when it does not. */
export const withBase = (body, h) => (baseHash(h) ? { ...body, base_hash: h } : body);

/**
 * Whether the review may regenerate one card: a New deck proposal's card (its
 * outline has a row at that place, for the same card), not one already kept.
 * The Worker refuses the rest (`card_kept`, `outline_changed`); the button is
 * simply not offered for them.
 */
export function canRegenerate(proposal, index) {
  const rows = proposal?.outline?.rows;
  if (!Array.isArray(rows) || !rows[index]?.card) return false;
  if ((Array.isArray(proposal.kept) ? proposal.kept : []).includes(index)) return false;
  return proposal?.slides?.[index]?.spec_id === `new:${rows[index].card}`;
}

/** The card's quote: one row of the proposal's own outline, priced as that row's build run. */
export function cardQuoteBody(projectId, proposal, index) {
  const o = proposal?.outline || {};
  const exclude = Array.isArray(o.exclude) ? o.exclude : [];
  return { project_id: projectId, step: 'card', index, audience: o.audience, length: o.length, outline: o.rows, ...(exclude.length ? { exclude } : {}) };
}

export function regenerateSentence(quote, title) {
  const p = asPrice(quote);
  const price = p.kind === 'metered' ? `Eadwyn rewrites its wording, holding up to ${aiTokens(p.hold)} in AI tokens and charging for what it uses.`
    : p.kind === 'free' ? 'AI is off on this page, so the card is rebuilt from your records with its title, at no cost.'
      : priceNote(p);
  return `StudioOS rebuilds “${title}” from your records. ${price} Every other card stays as it is, and nothing is saved until you accept.`;
}

/** The line under a card after its regeneration: who wrote it, or why not, and what it used. */
export function regeneratedLine(r) {
  if (!r) return null;
  const spent = r.cost?.charged_microusd != null && Number(r.cost.charged_microusd) > 0 ? ` It used ${aiTokens(r.cost.charged_microusd)} in AI tokens.` : '';
  if (r.wording?.reason) return `${r.wording.reason}${spent}`;
  return `Eadwyn rewrote this card.${spent}`;
}

/** Keep one card now: it survives a rebuild, a regeneration and a reload, and Accept saves it. */
export const KEEP_ONE = 'Keep';
export const KEPT_LINE = 'Kept: a rebuild or a regeneration leaves it as it is.';

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
  const p = asPrice(quote);
  if (p.kind === 'free') return 'AI is off on this page: the cards are your figures with their titles, at no cost.';
  if (p.kind === 'unavailable' || p.kind === 'stale') return priceNote(p);
  const est = p.kind === 'metered' ? aiTokens(p.hold) : null;
  if (!est) return null;
  const avg = average?.runs ? ` · Your average ${aiTokens(average.average_microusd)} over ${average.runs} run${average.runs === 1 ? '' : 's'}` : '';
  return `Estimated ${est}${avg}`;
}

// ─────────────────────────────────────────────────────────── the dialogs

export function outlineSentence(quote, regenerate) {
  const p = asPrice(quote);
  const price = p.kind === 'metered' ? `It holds up to ${aiTokens(p.hold)} in AI tokens and is charged for what it uses.`
    : p.kind === 'free' ? 'AI is off on this page, so StudioOS proposes its standard outline at no cost.'
      : priceNote(p);
  return `${regenerate ? 'Eadwyn proposes a new outline in place of this one' : 'Eadwyn proposes an outline'} for the audience and length you chose. ${price} It replaces any deck proposal you have not kept; no deck version changes.`;
}

export function buildSentence(quote, cards) {
  const p = asPrice(quote);
  const price = p.kind === 'metered' ? `Eadwyn writes the wording, holding up to ${aiTokens(p.hold)} in AI tokens and charging for what it uses.`
    : p.kind === 'free' ? 'AI is off on this page, so the cards carry their titles, at no cost.'
      : priceNote(p);
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
  const p = asPrice(quote);
  const price = p.kind === 'metered' ? ` About ${aiTokens(p.hold)} in AI tokens.` : p.kind === 'free' ? ' AI is off on this page: figures and titles only, at no cost.' : ` ${priceNote(p)}`;
  const what = brief?.cards ? `${brief.cards} cards` : 'A deck';
  const who = brief?.label ? `, for the ${brief.label} audience` : '';
  return `${what} from everything on record${who}. Review sources afterwards.${price}`;
}
