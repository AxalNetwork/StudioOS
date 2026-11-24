/**
 * D6046 (#6046, Raise V2 build 2/5) — the pure view rules of Raise › Overview,
 * drawn to `design/incoming/Raise v2 Page.dc.html` boards RA-01 to RA-09 and
 * RA-13 (D4863). No React and no fetch: each builder reads only the overview
 * the Worker sent (`GET /api/cycles/raise/overview`, D663, D1610, D6045) and
 * works nothing out that the read did not record.
 *
 *   stage, primary_action   RA-03's rule, chosen on the Worker (D6045); the page never picks the step
 *   cards[]                 the seven module cards (D663); the Pitch card carries `pitch_state` (RA-05)
 *   next_steps              readiness steps with their reason and gain (D1610)
 *   follow_ups_due          prospects with a next step due this week (D8256)
 *   open_objections         objections no narrative section answers yet, with who raised them (D8256)
 *   connectors              the connected sources and when each was last read (D1610)
 *   investor_activity       pipeline, deck-view and call-response counts, each with its own read meta (D6045)
 *
 * The states are #5129's (RA-08): a measured 0 is a value; nothing recorded is
 * Not recorded; a source that could not be read is Unavailable, its figures
 * never 0; a measure that does not apply is Not applicable.
 */
import { linkSearch, nextHref, safeHref } from './cycleModel.js';

/** D1466 (RO04): "+N points" for a known gain; null when the gain is not recorded (never "+0" for an unknown). */
export function gainLabel(g) {
  return Number.isFinite(g) && g > 0 ? `+${Math.round(g)} points` : null;
}

/** D1466 (RO04): the steps listed: Team never (a person assesses it), at most three, biggest known gain first. */
export function nextStepItems(part) {
  const items = Array.isArray(part?.items) ? part.items.filter((i) => i && i.item_key !== 'team') : [];
  const gain = (i) => (Number.isFinite(i.gain_points) ? i.gain_points : -1);
  return items.map((i, n) => ({ i, n })).sort((a, b) => gain(b.i) - gain(a.i) || a.n - b.n).map((x) => x.i).slice(0, 3);
}

/** D1466 (RO07): a source's last read in plain words; a missing one is "Not recorded", never a date or 0. */
export function lastRead(asOf) {
  return asOf ? `Read ${asOf}` : 'Last read · Not recorded';
}

export const RAISE_SUB = 'From story to capital: get ready, build the materials, run the raise.';

/**
 * RA-01, RA-02: the four stages of the journey strip and the tools under each, in RA-12's order
 * (`RAISE_STAGES` in `cycleModel.js` is the same list as navigation). `slug` names the card that
 * marks the tool; Evidence has no card on the overview, so it is a link with no mark.
 */
export const JOURNEY = [
  { key: 'prepare', label: 'Prepare', items: [{ key: 'evidence', name: 'Evidence', path: '/raise/evidence' }, { key: 'fundraising-readiness', name: 'Readiness' }] },
  { key: 'build_the_story', label: 'Build the story', items: [{ key: 'investor-narrative', name: 'Narrative' }, { key: 'pitch-deck', name: 'Pitch' }] },
  { key: 'prepare_diligence', label: 'Prepare diligence', items: [{ key: 'data-room', name: 'Data room' }, { key: 'cap-table', name: 'Cap table' }, { key: 'use-of-funds', name: 'Use of funds' }] },
  { key: 'run_the_raise', label: 'Run the raise', items: [{ key: 'capital-relationships', name: 'Capital relationships' }] },
];

/** The five fundraising materials (RA-01's status table, RA-02's rich cards), in the Worker's order. */
export const MATERIALS = ['investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds'];

/** Each journey mark: its glyph and the words a screen reader hears after the tool's name. */
export const MARKS = {
  recorded: { glyph: '✓', words: 'has records' },
  started: { glyph: '•', words: 'started' },
  empty: { glyph: '', words: 'nothing recorded yet' },
  unavailable: { glyph: '!', words: 'could not be read' },
};

const cardsOf = (raw) => (Array.isArray(raw?.cards) ? raw.cards.filter((c) => c && c.slug) : []);
const cardOf = (raw, slug) => cardsOf(raw).find((c) => c.slug === slug) || null;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "Team", "Team and Market", "Team, Market and Pitch". */
export const listWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** A Raise module's address for the chosen venture; Pitch's is the Studio's (#4853). */
export const moduleHref = (slug, search = '') => nextHref(`/raise/${slug}`, search);
/** A Pitch Studio address (`/raise/pitch`, `/raise/pitch/share`, …) for the chosen venture. */
export const pitchHref = (path = '', search = '') => `/raise/pitch${path}${linkSearch(search)}`;

/** The Pitch card's state when the Worker sent one it can be drawn from; null otherwise (an older read). */
function pitchStateOf(card) {
  const p = card?.pitch_state;
  return p && (p.state === 'ok' || p.state === 'unreadable') ? p : null;
}

/** One tool's mark on the strip, from its card (and, for Pitch, its state); null with no card. */
export function journeyMark(card) {
  if (!card) return null;
  const pitch = pitchStateOf(card);
  if (pitch) {
    if (pitch.state === 'unreadable') return 'unavailable';
    if (pitch.key === 'no_deck') return 'empty';
    return pitch.key === 'draft' || pitch.key === 'saved' ? 'started' : 'recorded';
  }
  if (card.state === 'ok') return 'recorded';
  if (card.state === 'too_little') return 'started';
  if (card.state === 'empty' || card.state === 'not_recorded') return 'empty';
  return 'unavailable';
}

/**
 * The journey strip (RA-01, RA-02). The current stage is the Worker's (`stage`, D6045); the one after it
 * is Next and the rest Later. A stage before the current one is Earlier, never Done: no store says a stage
 * is complete, and the rule reads the most advanced fact first (a prospect can exist before a narrative).
 * A stage the Worker could not work out marks none current and says so.
 */
export function journeyView(raw, search = '') {
  const stage = raw?.stage;
  const known = stage?.state === 'ok' ? JOURNEY.findIndex((s) => s.key === stage.key) : -1;
  const stages = JOURNEY.map((s, i) => ({
    key: s.key,
    label: s.label,
    status: known < 0 ? null : i === known ? 'current' : i < known ? 'earlier' : i === known + 1 ? 'next' : 'later',
    items: s.items.map((it) => {
      const mark = it.path ? null : journeyMark(cardOf(raw, it.key));
      return { key: it.key, name: it.name, href: it.path ? `${it.path}${linkSearch(search)}` : moduleHref(it.key, search), mark };
    }),
  }));
  const word = { current: 'You are here', earlier: 'Earlier', next: 'Next', later: 'Later' };
  for (const s of stages) s.word = s.status ? word[s.status] : null;
  return {
    stages,
    rule: stage?.state === 'ok' && typeof stage.rule === 'string' ? stage.rule : null,
    unavailable: stage?.state === 'unreadable' ? (stage.reason || 'The stage could not be worked out.') : null,
  };
}

// ---------- Readiness (RA-04 summary, RA-07 detailed) ---------------------

/** RA-16 (D6049): Product-market fit is supporting evidence, shown on Fundraising readiness, never an area here. */
const PMF = /^product[- ]market fit$/i;

/**
 * The readiness areas from the Fundraising readiness card's bar chart (`readinessCard`, D663): each area's
 * newest score out of 10, or null when nothing assessed it. Product-market fit is left out (RA-16).
 *   { state: 'loading' }                       no read yet
 *   { state: 'unavailable', reason }           the card could not be read
 *   { state: 'none', next }                    no area is scored yet (an empty card)
 *   { state: 'ready', areas, assessed, total, unassessed, next }
 */
export function readinessView(raw) {
  if (!raw) return { state: 'loading' };
  const card = cardOf(raw, 'fundraising-readiness');
  if (!card) return { state: 'unavailable', reason: 'The readiness card was not in this read.' };
  if (card.state === 'unreadable' || !['ok', 'empty', 'too_little', 'not_recorded'].includes(card.state)) {
    return { state: 'unavailable', reason: card.reason || 'The readiness scores could not be read.' };
  }
  const next = card.next?.text ? { text: card.next.text, href: card.next.href } : null;
  const hbar = card.state === 'ok' && Array.isArray(card.series) ? card.series.find((s) => s?.kind === 'hbar' && Array.isArray(s.items)) : null;
  if (!hbar) return { state: 'none', next };
  const areas = hbar.items
    .filter((i) => i && typeof i.label === 'string' && !PMF.test(i.label.trim()))
    .map((i) => ({ label: i.label, score: isNum(i.value) ? i.value : null }));
  if (!areas.length) return { state: 'none', next };
  const assessed = areas.filter((a) => a.score != null);
  return { state: 'ready', areas, assessed: assessed.length, total: areas.length, unassessed: areas.filter((a) => a.score == null).map((a) => a.label), next };
}

/** "6 of 8 areas assessed". */
export const coverageWords = (v) => `${v.assessed} of ${plural(v.total, 'area', 'areas')} assessed`;

/** Why the unassessed areas carry no score: "Team and Market have no score yet, so they are not counted." */
export function unassessedWords(v) {
  if (!v.unassessed.length) return 'Every area has a score.';
  return `${listWords(v.unassessed)} ${v.unassessed.length === 1 ? 'has' : 'have'} no score yet, so ${v.unassessed.length === 1 ? 'it is' : 'they are'} not counted.`;
}

/** RA-07's text summary beside the chart: coverage, the highest and lowest scored areas, and what is not scored. */
export function chartSummary(v) {
  const scored = v.areas.filter((a) => a.score != null);
  const parts = [`Summary: ${coverageWords(v)}.`];
  if (scored.length) {
    const hi = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const lo = scored.reduce((a, b) => (b.score < a.score ? b : a));
    parts.push(hi === lo ? `${hi.label} is scored ${hi.score} of 10.` : `Highest ${hi.label} (${hi.score} of 10), lowest ${lo.label} (${lo.score} of 10).`);
  }
  if (v.unassessed.length) parts.push(`${listWords(v.unassessed)} ${v.unassessed.length === 1 ? 'is' : 'are'} not scored.`);
  return parts.join(' ');
}

/** RA-02: detailed readiness is collapsed once the raise is running; open before that, and when the stage is not known. */
export const detailedOpenByDefault = (raw) => !(raw?.stage?.state === 'ok' && raw.stage.key === 'run_the_raise');

// ---------- Next actions (RA-04) ------------------------------------------

/** A day as "21 Nov"; the stored day itself when it is not one. */
const shortDay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  return m ? `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]}` : String(d || '');
};
const partOk = (p) => p && p.state === 'ok' && Array.isArray(p.items);

/**
 * D8256 (RA-02): the follow-ups due as one action: who, how many are overdue, and the earliest day.
 * A staff read carries no names, so it says how many. Null with none due.
 */
export function followUpAction(part, search = '') {
  if (!partOk(part)) return null;
  const items = part.items.filter((f) => f && typeof f.due_on === 'string');
  if (!items.length) return null;
  const n = items.length;
  const names = items.map((f) => f.investor).filter((x) => typeof x === 'string' && x);
  const overdue = items.filter((f) => f.overdue === true).length;
  const who = names.length === n ? listWords(names.length > 3 ? [...names.slice(0, 3), plural(n - 3, 'other', 'others')] : names) : plural(n, 'investor', 'investors');
  const earliest = items.map((f) => f.due_on).sort()[0];
  return {
    key: 'follow-ups',
    kind: 'follow_up',
    title: n === 1 && names.length === 1 ? `Follow up with ${names[0]}` : `Follow up with ${plural(n, 'investor', 'investors')}`,
    reason: `${who} ${n === 1 ? 'has a next step' : 'have a next step'} due this week${overdue ? `; ${overdue} ${overdue === 1 ? 'is' : 'are'} overdue` : ''}.`,
    source: `From Capital relationships · earliest due ${shortDay(earliest)}${part.capped ? ' · more not listed' : ''}`,
    impact: null,
    cta: 'Open Outreach',
    label: `Open Outreach for ${plural(n, 'follow-up', 'follow-ups')} due`,
    href: nextHref(part.href, search),
  };
}

/** D8256 (RA-02): the most heard objection no narrative section answers, with who raised it. Null with none open. */
export function objectionAction(part, search = '') {
  if (!partOk(part)) return null;
  const o = part.items.find((x) => x && typeof x.text === 'string' && x.text && typeof x.key === 'string');
  if (!o) return null;
  const by = Array.isArray(o.investors) && o.investors.length ? `Raised by ${listWords(o.investors.length > 3 ? [...o.investors.slice(0, 3), plural(o.investors.length - 3, 'other', 'others')] : o.investors)}` : null;
  const n = isNum(o.prospects) ? o.prospects : null;
  const more = part.items.length - 1;
  return {
    key: `objection-${o.key}`,
    kind: 'objection',
    title: 'Answer an open objection',
    reason: `“${o.text}” was raised by ${n == null ? 'investors' : plural(n, 'investor', 'investors')} and has no answer in the narrative.`,
    source: [`From investor feedback${by ? ` · ${by}` : ''}`, more > 0 ? `${plural(more, 'more objection', 'more objections')} open` : null].filter(Boolean).join(' · '),
    impact: null,
    cta: 'Answer objection',
    label: `Answer the objection “${o.text}”`,
    href: nextHref(o.href, search),
  };
}

/** D8256: the board's order (RA-02): follow-ups due, then an open objection, then readiness steps. */
export const NEXT_ACTIONS_MAX = 3;

/**
 * RA-02, RA-04: at most three next actions in the board's order: the follow-ups due (one action), the most
 * heard open objection, then readiness steps, biggest known gain first and Team never (`nextStepItems`).
 * Each names its reason and its source record and has one action. A readiness step's impact is a neutral
 * label; a gain the read does not know is Not recorded, never "+0".
 *   { state: 'unavailable' }                     nothing could be read (every part unreadable or absent)
 *   { state: 'ready', items, unread }            `unread` names the parts that could not be read, so a
 *                                                missing follow-up is never read as "none due"
 *   null                                         the read carries no next actions at all
 */
export function nextActionsView(raw, search = '') {
  const part = raw?.next_steps;
  const fu = raw?.follow_ups_due;
  const ob = raw?.open_objections;
  if (part == null && fu == null && ob == null) return null;
  const unread = [];
  if (fu?.state === 'unreadable') unread.push('Follow-ups due');
  if (ob?.state === 'unreadable') unread.push('Open objections');
  if (part?.state === 'unreadable') unread.push('Readiness steps');
  const read = [part, fu, ob].filter((x) => x != null && x.state !== 'unreadable');
  if (!read.length) return { state: 'unavailable' };
  const names = new Map(cardsOf(raw).map((c) => [c.slug, c.name || c.slug]));
  const steps = part && part.state !== 'unreadable' ? nextStepItems(part).map((i) => {
    const module = names.get(i.module_slug) || i.label;
    const gain = gainLabel(i.gain_points);
    return {
      key: i.item_key,
      kind: 'readiness',
      title: i.label,
      reason: i.text || 'Not recorded',
      source: null,
      impact: gain ? `Readiness impact ${gain}` : null,
      cta: `Open ${module}`,
      label: `Open ${module} for ${i.label}`,
      href: nextHref(i.href, search),
    };
  }) : [];
  const items = [followUpAction(fu, search), objectionAction(ob, search), ...steps].filter(Boolean).slice(0, NEXT_ACTIONS_MAX);
  return { state: 'ready', items, unread };
}

// ---------- Materials (RA-01 table, RA-02 cards, RA-05 Pitch) --------------

/**
 * Which materials draw as rows of the one status table (nothing in them yet) and which as cards.
 * Pitch with `pitch_state` follows its state: No deck is a row, every other state is the Pitch card.
 */
export function materialsSplit(raw) {
  const table = [];
  const cards = [];
  for (const slug of MATERIALS) {
    const card = cardOf(raw, slug);
    if (!card) continue;
    const pitch = slug === 'pitch-deck' ? pitchStateOf(card) : null;
    const empty = pitch ? pitch.state === 'ok' && pitch.key === 'no_deck' : card.state === 'empty' || card.state === 'not_recorded';
    (empty ? table : cards).push(card);
  }
  return { table, cards, allEmpty: table.length > 0 && cards.length === 0 };
}

/** One status-table row: the module, its state word, the read's own reason and its first step. */
export function statusRow(card, search = '') {
  const pitch = card.slug === 'pitch-deck' ? pitchStateOf(card) : null;
  const next = pitch ? { text: 'Build pitch', href: pitchHref('', search) } : card.next?.text ? { text: card.next.text, href: nextHref(card.next.href, search) } : null;
  return {
    slug: card.slug,
    name: card.name || card.slug,
    href: moduleHref(card.slug, search),
    detail: pitch ? 'No deck yet' : card.reason || 'Nothing recorded here yet.',
    next: next?.href ? next : null,
  };
}

/**
 * RA-05: the Pitch card in five states plus Unavailable. `rows` are the card's facts as [term, value]
 * (a value of null is Not recorded); `actions` its links, the first the primary; `blocked` an action
 * that is not offered yet, with why.
 */
export function pitchView(card, activity, search = '') {
  const p = pitchStateOf(card);
  if (!p) return null;
  if (p.state === 'unreadable') return { key: 'unavailable', reason: p.reason || 'The deck could not be read, so its state is not known.' };
  const v = isNum(p.version) ? `v${p.version}` : null;
  const studio = { label: 'Open Pitch Studio', href: pitchHref('', search) };
  const edit = { label: 'Continue editing', href: pitchHref('/edit', search) };
  const share = { label: 'Share', href: pitchHref('/share', search) };
  const unsaved = p.unsaved_changes === true ? 'Unsaved changes beside the saved version' : null;
  switch (p.key) {
    case 'no_deck':
      return { key: 'no_deck', label: 'No deck', rows: [], note: 'Share isn’t offered until a saved version exists.', actions: [{ label: 'Build pitch', href: pitchHref('', search) }] };
    case 'draft':
      return { key: 'draft', label: 'Working draft only', rows: [['Saved version', null]], note: 'A draft is being built; nothing can be shared until a version is saved.', actions: [edit] };
    case 'saved':
      return {
        key: 'saved', label: 'Saved, not reviewed', note: unsaved,
        rows: [['Saved version', v], ['Preflight', isNum(p.to_fix) ? `Needs attention · ${plural(p.to_fix, 'item', 'items')} to fix` : null]],
        actions: [{ label: 'Review preflight', href: pitchHref('/review', search) }],
        blocked: { label: 'Share', why: 'Share is offered once the preflight passes.' },
      };
    case 'reviewed':
      return { key: 'reviewed', label: 'Reviewed, ready to send', note: unsaved, rows: [['Saved version', v], ['Preflight', 'Reviewed · ready to send']], actions: [share, edit] };
    case 'shared': {
      const views = activity?.deck_views_8_weeks;
      const viewsRead = activity?.sources?.deck_views?.status;
      return {
        key: 'shared', label: 'Shared', note: unsaved,
        rows: [['Shared version', v], ['Live links', isNum(p.live_links) ? String(p.live_links) : null],
          ['Views · 8 weeks', isNum(views) ? String(views) : viewsRead === 'unavailable' ? 'unavailable' : null]],
        actions: [{ label: 'Manage links', href: pitchHref('/share', search) }, studio],
      };
    }
    default:
      return { key: 'unavailable', reason: 'The deck came back in a state this page does not know.' };
  }
}

// ---------- Investor activity (RA-02) -------------------------------------

/**
 * The four counts, each a value, Unavailable (its source could not be read) or Not applicable
 * (calls for capital are off), and the three latest events for the venture's own readers. With a
 * pipeline read as empty and no deck view, it is RA-01's one line: `{ state: 'empty' }`.
 * Null when the read carries no investor activity (an older Worker).
 */
export function activityView(raw) {
  const a = raw?.investor_activity;
  if (!a || typeof a !== 'object') return null;
  const src = a.sources || {};
  const fig = (key, label, value, meta) => ({
    key, label,
    state: meta?.status === 'not_applicable' ? 'not_applicable' : isNum(value) ? 'value' : 'unavailable',
    value: isNum(value) ? value : null,
    reason: meta?.status === 'not_applicable' ? meta.reason || 'This measure does not apply.' : meta?.completeness_reason || null,
  });
  const figures = [
    fig('in_pipeline', 'In pipeline', a.in_pipeline, src.pipeline),
    fig('active_conversations', 'Active conversations', a.active_conversations, src.pipeline),
    fig('call_responses', 'Call responses this month', a.call_responses_this_month, src.round_calls),
    fig('deck_views', 'Deck views · 8 weeks', a.deck_views_8_weeks, src.deck_views),
  ];
  const recent = Array.isArray(a.recent) ? a.recent.filter((e) => e && e.investor).slice(0, 3) : [];
  const zero = (k) => { const f = figures.find((x) => x.key === k); return f.state === 'value' && f.value === 0; };
  const calls = figures.find((x) => x.key === 'call_responses');
  const empty = zero('in_pipeline') && zero('deck_views') && (calls.state === 'not_applicable' || (calls.state === 'value' && calls.value === 0)) && !recent.length;
  return { state: empty ? 'empty' : 'ready', figures, recent };
}

// ---------- Connected evidence (RA-06) ------------------------------------

/**
 * The sources Raise reads: `{ state: 'none' }` when nothing is connected (RA-06's one message),
 * `{ state: 'unavailable' }` when the list itself could not be read, else one row each.
 * Null when the read carries no list. A last read that is not recorded is never a date or 0.
 */
export function sourcesView(raw) {
  const c = raw?.connectors;
  if (c == null) return null;
  if (!Array.isArray(c)) return { state: 'unavailable' };
  const rows = c.filter((r) => r && (r.key || r.label)).map((r) => ({
    key: r.key || r.label,
    label: r.label || r.key,
    state: ['connected', 'not_connected', 'unreadable'].includes(r.state) ? r.state : 'unreadable',
    fact: typeof r.fact === 'string' && r.fact ? r.fact : null,
    asOf: typeof r.as_of === 'string' && r.as_of ? r.as_of : null,
  }));
  if (!rows.some((r) => r.state !== 'not_connected')) return { state: 'none', rows };
  return { state: 'ready', rows };
}

/** RA-01: Incorporate and the Co-Founder Agreement are Build's, linked under Related company setup. */
export const RELATED_SETUP = [
  { label: 'Incorporate', href: '/incorporate' },
  { label: 'Co-Founder Agreement', href: '/incorporate/cofounder-agreement' },
];

/** An in-app href or null (`cycleModel.safeHref`), re-exported so the page imports one model. */
export { safeHref };
