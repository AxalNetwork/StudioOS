/**
 * D661 (#1474) — Validate's read (#1487, D659) in the page's shape.
 *
 * WHY AN ADAPTER. D659's read returns each card's `series` as the module's own
 * data (`{ themes, more }`, `{ weeks, funnel, lab }`, …), `records.cols` as
 * labels and `records.rows` as plain objects. D661's components draw chart
 * specs and `{ id, cells }` rows. S1 decided on #1474 (2026-10-09) that the
 * page adapts and the Worker is not changed: the read carries meaning (a
 * theme's severity, a claim's status), and which chart draws it is the page's
 * call. Each function below follows the canvas's helper for that card
 * (`Cycle Overview.dc.html`, `D.Validate.cards` and `LISTS`).
 *
 * THE RULES IT KEEPS:
 * - A missing value is null, drawn as "Not recorded", never 0.
 * - A series it cannot read gives no spec, so an `ok` card with nothing to
 *   draw reads as unreadable (`cardView`), never as an invented chart.
 * - Nothing here fetches. `cycle_adapters_d661.test.mjs` runs the Worker's
 *   real output through every function.
 */

import { formatMinorOrCount } from '../../../lib/money.js';

/**
 * The seven modules, as `services/cycleValidate.ts` lists them. The module page
 * builds its tabs from this rather than reading the whole overview again;
 * `cycle_adapters_d661.test.mjs` holds it to the Worker's own list.
 */
export const MODULES = [
  { slug: 'problem-discovery', name: 'Problem discovery' },
  { slug: 'customer-research', name: 'Customer research' },
  { slug: 'ideal-customer-profile', name: 'Ideal customer profile' },
  { slug: 'market-intelligence', name: 'Market intelligence' },
  { slug: 'demand-signals', name: 'Demand and urgency signals' },
  { slug: 'experiments', name: 'Experiments and evidence' },
  // D693 (#1704): Verdict is the seventh (board MV7).
  { slug: 'verdict', name: 'Verdict' },
];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const list = (v) => (Array.isArray(v) ? v : []);
const nonEmpty = (s) => (typeof s === 'string' && s.trim() ? s : null);

/** "W41" for the ISO week a YYYY-MM-DD falls in; null for anything else. */
export function isoWeek(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `W${Math.ceil(((d - yearStart) / 86400000 + 1) / 7)}`;
}

/** First, middle and last tick of a weekly axis, as the canvas labels it. */
function weekTicks(days) {
  const n = days.length;
  if (!n) return [];
  const at = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return at.map((i) => ({ at: i, label: isoWeek(days[i]) })).filter((t) => t.label);
}

/** $4.2B, $610M, $38k: the canvas's market figures. Null stays null. */
export function usdShort(v) {
  if (!num(v)) return null;
  const a = Math.abs(v);
  const t = (n) => (Math.round(n * 10) / 10).toString();
  if (a >= 1e9) return `$${t(v / 1e9)}B`;
  if (a >= 1e6) return `$${t(v / 1e6)}M`;
  if (a >= 1e3) return `$${t(v / 1e3)}k`;
  return `$${v.toLocaleString('en-US')}`;
}

const SEVERITY_TONE = { severe: 'v1', real: 'v2', mild: 'v3' };
const SEVERITY_WORD = { severe: 'Severe', real: 'Real', mild: 'Mild' };
// #6006 (V17): a severity carries a word and a glyph, three dots to one; an unjudged theme says so.
const SEVERITY_GLYPH = { severe: '●●●', real: '●●○', mild: '●○○' };
export const severityPill = (v) => (SEVERITY_WORD[v]
  ? { text: `${SEVERITY_GLYPH[v]} ${SEVERITY_WORD[v]}`, tone: SEVERITY_TONE[v] }
  : { text: '○ Not judged', tone: 'grey' });

// ---------- Cards ------------------------------------------------------------

function problemDiscovery(s) {
  const themes = list(s?.themes);
  if (!themes.length) return [];
  const unjudged = themes.some((t) => !SEVERITY_TONE[t?.severity]);
  return [{
    kind: 'hbar',
    items: themes.map((t) => ({ label: String(t?.theme ?? ''), value: num(t?.mentions) ? t.mentions : null, tone: SEVERITY_TONE[t?.severity] || 'grey' })),
    more: num(s?.more) && s.more > 0 ? `+${s.more} more` : undefined,
    legend: [
      { label: 'Severe', tone: 'v1' }, { label: 'Real', tone: 'v2' }, { label: 'Mild', tone: 'v3' },
      ...(unjudged ? [{ label: 'Not judged', tone: 'grey' }] : []),
    ],
  }];
}

function customerResearch(s) {
  const weeks = list(s?.weeks);
  const out = [];
  if (weeks.length) {
    out.push({
      kind: 'vbars',
      values: weeks.map((w) => (num(w?.interviews) ? w.interviews : null)),
      labels: weekTicks(weeks.map((w) => w?.week_start)),
    });
  }
  const f = s?.funnel;
  if (f && typeof f === 'object') {
    out.push({
      kind: 'funnel',
      steps: [['Lead', f.lead], ['Invited', f.invited], ['Booked', f.booked], ['Done', f.done]]
        .map(([label, value]) => ({ label, value: num(value) ? value : null })),
    });
  }
  return out;
}

function idealCustomerProfile(s) {
  const segs = list(s?.segments);
  if (!segs.length) return [];
  const anyUnrecorded = segs.some((g) => num(g?.not_recorded) && g.not_recorded > 0);
  const out = [{
    kind: 'stack',
    rows: segs.map((g) => ({
      label: String(g?.name ?? ''),
      parts: [g?.strong, g?.partial, g?.weak, ...(anyUnrecorded ? [g?.not_recorded] : [])].map((v) => (num(v) ? v : 0)),
    })),
    tones: ['v1', 'v2', 'grey', 'muted'],
    legend: [
      { label: 'Strong', tone: 'v1' }, { label: 'Partial', tone: 'v2' }, { label: 'Weak', tone: 'grey' },
      ...(anyUnrecorded ? [{ label: 'Fit not recorded', tone: 'muted' }] : []),
    ],
  }];
  if (num(s?.unassigned) && s.unassigned > 0) {
    out.push({ kind: 'rows', items: [{ label: 'Interviews in no segment', value: s.unassigned, tone: 'warn' }] });
  }
  return out;
}

/**
 * D6011 (#6011): a figure's source and the date it was set, from its
 * `market_figures` row. Saved before that store, it has neither and says so;
 * saved with none named, it says that and keeps its date.
 */
export function marketBandSource(f) {
  const day = typeof f?.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.as_of) ? f.as_of : null;
  if (!day) return nonEmpty(f?.source) || 'source not recorded';
  return `${nonEmpty(f?.source) || 'no source named'} · as of ${day}`;
}

function marketIntelligence(s) {
  if (!s || typeof s !== 'object') return [];
  // A figure the founder typed carries no source yet (D659 says so rather
  // than guessing), so the band names the gap instead of inventing one.
  const band = (label, f) => ({
    label,
    value: usdShort(f?.value),
    source: num(f?.value) ? marketBandSource(f) : undefined,
  });
  const out = [{ kind: 'bands', items: [band('Total addressable', s.tam), band('Serviceable', s.sam), band('Obtainable', s.som)] }];
  if (num(s.competitors_tracked)) {
    out.push({ kind: 'big', value: s.competitors_tracked.toLocaleString('en-US'), label: s.competitors_tracked === 1 ? 'competitor tracked' : 'competitors tracked' });
  }
  return out;
}

function demandSignals(s) {
  if (!s || typeof s !== 'object') return [];
  const out = [];
  const signups = list(s.signups);
  if (s.chart_ready !== false && signups.length) {
    out.push({
      kind: 'line',
      values: signups.map((w) => (num(w?.total) ? w.total : null)),
      ...(num(s.bar) ? { target: s.bar, target_label: `bar · ${s.bar.toLocaleString('en-US')}` } : {}),
      labels: weekTicks(signups.map((w) => w?.week_start)),
    });
  }
  if (s.signals && typeof s.signals === 'object' && !Array.isArray(s.signals)) {
    out.push({ kind: 'rows', showWhenSparse: true, items: Object.entries(SIGNAL).map(([key, label]) => ({
      label, value: num(s.signals[key]) ? s.signals[key].toLocaleString('en-US') : '0',
    })) });
  }
  const committed = list(s.committed).filter(row => typeof row?.currency === 'string' && num(row.amount_cents));
  if (committed.length) {
    out.push({ kind: 'rows', showWhenSparse: true, items: committed.map(row => ({
      label: `Committed · ${row.currency}`,
      value: money(row.amount_cents, row.currency, row.period)
        + (row.period === 'not_recorded' ? ' · period not recorded' : row.period === 'once' ? ' · once' : ''),
    })) });
  }
  const n = s.need_to_have;
  if (n && num(n.interviews) && num(n.of) && n.of > 0) {
    out.push({ kind: 'big', value: `${Math.round((100 * n.interviews) / n.of)}%`, label: `of interviewees called it a need-to-have · ${n.interviews} of ${n.of}` });
  } else {
    out.push({ kind: 'rows', items: [{ label: 'Need-to-have share', value: null }] });
  }
  return out;
}

const STATUS_PARTS = [
  // D6016: the methodology's words (METHOD_WORD below), as the Hypotheses list draws them.
  ['untested', 'Not started', 'grey'], ['testing', 'Testing', 'v2'], ['supported', 'Supported', 'ok'],
  ['contested', 'Mixed', 'warn'], ['refuted', 'Contradicted', 'bad'], ['inconclusive', 'Inconclusive', 'muted'], ['not_recorded', 'Fit not recorded', 'warn'],
];

function experiments(s) {
  if (!s || typeof s !== 'object') return [];
  const out = [];
  const st = s.statuses && typeof s.statuses === 'object' ? s.statuses : null;
  if (st) {
    const shown = STATUS_PARTS.filter(([k], i) => i < 5 || (num(st[k]) && st[k] > 0));
    out.push({
      kind: 'stack', bare: true,
      rows: [{ label: '', parts: shown.map(([k]) => (num(st[k]) ? st[k] : 0)) }],
      tones: shown.map(([, , t]) => t),
      legend: shown.map(([, label, tone]) => ({ label, tone })),
    });
  }
  const weeks = list(s.weeks);
  if (weeks.length) {
    const anyUnrecorded = weeks.some((w) => num(w?.not_recorded) && w.not_recorded > 0);
    out.push({
      kind: 'vstack',
      rows: weeks.map((w) => [w?.anecdote, w?.pattern, w?.measured, ...(anyUnrecorded ? [w?.not_recorded] : [])].map((v) => (num(v) ? v : 0))),
      tones: ['v3', 'v2', 'v1', 'muted'],
      labels: weekTicks(weeks.map((w) => w?.week_start)),
      legend: [
        { label: 'Anecdote', tone: 'v3' }, { label: 'Pattern', tone: 'v2' }, { label: 'Measured', tone: 'v1' },
        ...(anyUnrecorded ? [{ label: 'Strength not recorded', tone: 'muted' }] : []),
      ],
    });
  }
  // Before a project-level claim exists, the Lab's per-interview claims are
  // the record (D659's hypotheses figure counts them the same way).
  const lab = s.interview_claims;
  if (lab && num(lab.total) && lab.total > 0) {
    out.push({
      kind: 'rows',
      items: [
        { label: 'Claims logged on interviews', value: lab.total },
        { label: 'Validated', value: num(lab.validated) ? lab.validated : null, tone: 'ok' },
        { label: 'Invalidated', value: num(lab.invalidated) ? lab.invalidated : null, tone: 'bad' },
      ],
    });
  }
  return out;
}

// ---------- Verdict (D693 decision 9) ---------------------------------------

const DECISION_WORD = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };
const DECISION_TONE = { proceed: 'ok', pivot: 'v2', stop: 'bad' };
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Oct" from a YYYY-MM-DD, as the canvas writes it ("3 Sep", whatever the runtime's locale data); null for anything else. */
const dayMonth = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && MONTH[Number(d.slice(5, 7)) - 1]
  ? `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]}`
  : null);

/**
 * The venture's verdict (CO:542): its decisions as a timeline, oldest first,
 * Withheld ones hollow and named so, then a hollow Next at the nearest sprint;
 * and the current verdict, big, with what it rests on. A decision from the old
 * page rests on no recorded evidence, so its clause is dropped (decision 5).
 */
function verdict(s) {
  if (!s || typeof s !== 'object') return [];
  const out = [];
  const steps = list(s.decisions).map((d) => ({
    label: d?.state === 'withheld' ? 'Withheld' : DECISION_WORD[d?.decision] ?? null,
    date: dayMonth(d?.date),
    done: d?.state === 'given',
  })).filter((st) => st.label);
  if (s.next && dayMonth(s.next.date)) steps.push({ label: 'Next', date: dayMonth(s.next.date), done: false });
  if (steps.length >= 2) out.push({ kind: 'timeline', steps });
  const c = s.current;
  if (c && DECISION_WORD[c.decision]) {
    const rests = num(c.evidence) ? ` · rests on ${c.evidence} ${c.evidence === 1 ? 'piece' : 'pieces'} of evidence` : '';
    out.push({ kind: 'big', value: DECISION_WORD[c.decision], label: `the venture’s current verdict${dayMonth(c.date) ? ` · ${dayMonth(c.date)}` : ''}${rests}` });
  }
  return out;
}

export const CARDS = {
  'problem-discovery': problemDiscovery,
  'customer-research': customerResearch,
  'ideal-customer-profile': idealCustomerProfile,
  'market-intelligence': marketIntelligence,
  'demand-signals': demandSignals,
  experiments,
  verdict,
};

// ---------- Figures ----------------------------------------------------------

/**
 * D659's figures name their unit in words ("interviews", "themes",
 * "sign-ups") and the supported count as `unit: "of 7"`. The page's units are
 * `count` and the pair `of`; the words stay in the label.
 */
export function figure(f) {
  if (!f || typeof f !== 'object') return f;
  const m = typeof f.unit === 'string' ? f.unit.match(/^of (\d+)$/) : null;
  if (m && num(f.value)) return { ...f, value: [f.value, Number(m[1])], unit: 'of' };
  if (['usd', 'pct', 'score', 'of', 'count'].includes(f.unit)) return f;
  return { ...f, unit: 'count' };
}

// ---------- Records ----------------------------------------------------------

// D4586 (#4586): Contested is methodology v2's, for a claim past the bar with material contradiction.
const CLAIM_TONE = { supported: 'ok', contested: 'warn', refuted: 'bad', testing: 'v2', untested: 'grey', inconclusive: 'muted', not_recorded: 'warn' };
const CLAIM_WORD = { supported: 'Supported', contested: 'Contested', refuted: 'Refuted', testing: 'Testing', untested: 'Untested', inconclusive: 'Inconclusive', not_recorded: 'Fit not recorded' };
/**
 * D6016 (#6016): the methodology's words for a computed evidence state (V7, V8). S1 (2026-11-14): they win over
 * CLAIM_WORD. Contested is Mixed (past the bar with material contradiction), Refuted is Contradicted and Untested is
 * Not started; Testing and Supported keep their words. Inconclusive is the founder's own mark and Fit not recorded the
 * D4586 lane, so both keep theirs. A state is computed from linked evidence, never proof and never a decision.
 */
export const METHOD_WORD = { supported: 'Supported', contested: 'Mixed', refuted: 'Contradicted', testing: 'Testing', untested: 'Not started', inconclusive: 'Inconclusive', not_recorded: 'Fit not recorded' };
/** The same words by the record's pill text (the record read sends CLAIM's words, `services/records/validate.ts`). */
export const METHOD_BY_CLAIM_WORD = Object.fromEntries(Object.entries(CLAIM_WORD).map(([k, w]) => [w, METHOD_WORD[k]]));
/** D4586 § 6: a lane move inside 14 days, and one made only by the methodology changing on unchanged evidence. */
const MOVED_WORD = { recent: ' · Moved', method: ' · Method changed' };
const FIT = { strong: ['Strong', 'ok'], partial: ['Partial', 'v2'], none: ['None', 'grey'] };
const CONSENT = { agreed: ['Agreed · deck-eligible', 'ok'], declined: ['Declined', 'bad'] };
/** #4411: a recording pill never borrows the quote permission. */
const RECORDING_METHOD = { verbal: 'Said yes out loud', written: 'In writing', in_app: 'In the app', pre_agreed: 'Agreed beforehand', chat_reply: 'Agreed in the chat' };
function recordingConsentPill(value) {
  if (value?.status === 'declined') return { text: 'Declined', tone: 'bad' };
  if (value?.status !== 'given') return { text: 'Not asked', tone: 'grey' };
  const method = Object.hasOwn(RECORDING_METHOD, value.method) ? RECORDING_METHOD[value.method] : null;
  return { text: method ? `Given · ${method}` : 'Given', tone: 'ok' };
}
/** D690 decision 9: an interview's state, by the key the Worker sends. */
export const STATE = {
  failed: 'Failed',
  recording: 'Recording',
  waiting_consent: 'Waiting for consent',
  consent_declined: 'Declined in WhatsApp',
  waiting_messages: 'Waiting for messages',
  waiting_transcript: 'Waiting for the call transcript',
  processing: 'Processing',
  ready: 'Ready to review',
  reviewed: 'Reviewed',
  lead: 'Lead',
  invited: 'Invited',
  booked: 'Booked',
  logged: 'Logged',
};
/**
 * The channel as words (D685 §5.4.5), over the four the Worker stores
 * (`in_person | video | phone | text`). `manual` is the old "Entered by hand"
 * row. A value this table does not know is shown as the Worker wrote it, never
 * dropped; a missing one is "Not recorded".
 */
// Video and audio calls are one "Call" (the owner, 2026-10-21); `call` is the filter that matches both.
export const CHANNEL = { in_person: 'In person', video: 'Call', phone: 'Call', call: 'Call', text: 'Text chat', manual: 'Entered by hand' };

/**
 * Each list's title where the module's name is not it (CO:611, :612, :616):
 * the interview log, the pain themes and the hypotheses (D697, #1659). A
 * `records_title` the read sends wins.
 */
export const TITLES = { 'customer-research': 'Interviews', 'problem-discovery': 'Pain themes', experiments: 'Hypotheses' };
const EVIDENCE = { anecdote: ['Anecdote', 'warn'], pattern: ['Pattern', 'v2'], measured: ['Measured', 'ok'] };
const SIGNAL = { loi: 'Letter of intent', pre_sale: 'Pre-sale', waitlist: 'Waitlist', need_to_have: 'Need-to-have', would_pay: 'Would pay' };
const COUNTS = { confirmed: ['Confirmed', 'ok'], counted: ['Counted', 'v2'], to_confirm: ['To confirm', 'warn'] };
const KIND = { direct: ['Direct', 'bad'], adjacent: ['Adjacent', 'warn'] };
const PERIOD = { year: ' / year', month: ' / month', once: '' };
// D1327 (#3488): Eadwyn's mark is Fill with Eadwyn's one `FillMark`, which the
// table's `Cell` draws from `{ fill }`. A founder's own claim has no mark; a
// provenance read that failed says "Unreadable" per row, never "typed".
const FILL_OF = {
  eadwyn: { source_kind: 'eadwyn', edited: false },
  eadwyn_edited: { source_kind: 'eadwyn', edited: true },
  unreadable: { state: 'unreadable' },
};
// `text` is the mark's own words, for the phone list and exports that read cells as text (`cellView`).
const FILL_WORDS = { eadwyn: 'Eadwyn', eadwyn_edited: 'Eadwyn · edited', unreadable: 'Unreadable' };
const fillCell = (v) => (FILL_OF[v] ? { fill: FILL_OF[v], text: FILL_WORDS[v] } : null);

const pill = (map, v) => (map[v] ? { text: map[v][0], tone: map[v][1] } : null);
const word = (map, v) => (v == null ? null : map[v] || String(v));
const money = (cents, currency, period) => {
  if (!num(cents)) return null;
  // D5373: at the currency's own decimals (a whole amount drops them); a missing or unlisted code names the stored count.
  const amount = formatMinorOrCount(cents, currency ? String(currency).toUpperCase() : 'USD', { locale: 'en-US', trimWhole: true });
  return `${amount}${PERIOD[period] ?? ''}`;
};
const trend = (n) => (!num(n) ? null : n === 0 ? 'no change' : `${n > 0 ? '▲' : '▼'} ${Math.abs(n)}`);
const seg = (id) => (id == null ? null : String(id));

/**
 * D696 (decision 7): the record a row opens, as the Worker's own id, or null
 * when the read sent none. A row keeps its `id` (fallback included) as its
 * key, but a fallback is never a record: a row with a null `recordId` is
 * never linked (`recordModel.js`).
 */
const workerId = (v) => (v == null || v === '' ? null : String(v));

/** #6006: "7 people · 7 organisations", each "not recorded" when no interview behind the theme names one. */
export function sourcesLine(sources) {
  if (!sources || typeof sources !== 'object') return null;
  const part = (n, one, many) => (num(n) ? `${n} ${n === 1 ? one : many}` : `${many} not recorded`);
  return `${part(sources.people, 'person', 'people')} · ${part(sources.organisations, 'organisation', 'organisations')}`;
}
/** #6006: the theme cell's notes. A grouped theme says why it ranks there; a phrase in no theme says it opens nothing. */
export function themeNotes(r) {
  const rank = num(r?.rank) ? r.rank : null;
  if (r?.grouped === false) return [`${rank != null ? `#${rank} · ` : ''}Not grouped · no record to open`];
  if (typeof r?.rank_reason === 'string' && r.rank_reason) return [`${rank != null ? `Why rank ${rank}: ` : ''}${r.rank_reason}`];
  return rank != null ? [`Rank ${rank}`] : null;
}
/** #6006: "+ H1 · − H2", with the counts in each direction under it; no link reads so in words. */
export function hypothesesCell(r) {
  const plus = Array.isArray(r?.supports) ? r.supports : [];
  const minus = Array.isArray(r?.contradicts) ? r.contradicts : [];
  if (!plus.length && !minus.length) return { text: 'No hypothesis linked' };
  const text = [...plus.map((c) => `+ ${c}`), ...minus.map((c) => `− ${c}`)].join(' · ');
  const counted = num(r?.supporting) && num(r?.contradicting);
  return { text, note: counted ? `${r.supporting} supporting · ${r.contradicting} contradicting` : null };
}

/** Column keys in the order the read lists its labels; each row builder fills them. */
export const RECORDS = {
  'problem-discovery': {
    keys: ['theme', 'mentions', 'severity', 'trend', 'supports'],
    // #6006 (V17): the ranked list. The theme says why it ranks there; a phrase in no theme ranks
    // as its own row, says Not grouped and opens no record (the Worker sends its `id` as null).
    row: (r, i) => ({ id: `theme-${i}-${r.theme}`, recordId: workerId(r.id), cells: {
      theme: r.theme == null ? null : { text: String(r.theme), note: themeNotes(r) },
      mentions: num(r.mentions) ? { text: `${r.mentions} ${r.mentions === 1 ? 'interview' : 'interviews'}`, note: r.grouped === false ? null : sourcesLine(r.sources) } : null,
      severity: r.grouped === false && !SEVERITY_WORD[r.severity] ? null : severityPill(r.severity),
      trend: trend(r.trend),
      supports: hypothesesCell(r),
    } }),
    filters: [
      { key: 'severity', label: 'Severity', options: [{ value: 'severe', label: 'Severe' }, { value: 'real', label: 'Real' }, { value: 'mild', label: 'Mild' }, { value: 'not_recorded', label: 'Not judged' }] },
      { key: 'hypothesis', label: 'Hypothesis', options: [{ value: 'linked', label: 'Linked' }, { value: 'unlinked', label: 'Not linked' }] },
      // D697: FVW's ICP only and Need-to-have chips, as the Worker filters them.
      { key: 'icp', label: 'ICP only', options: [{ value: 'yes', label: 'ICP only' }] },
      { key: 'need', label: 'Need-to-have', options: [{ value: 'yes', label: 'Need-to-have' }] },
    ],
    sorts: [{ key: 'mentions', label: 'Mentions' }, { key: 'trend', label: 'Trend' }, { key: 'theme', label: 'Theme' }, { key: 'recent', label: 'Most recent' }],
  },
  'customer-research': {
    // #4411 splits recording and quote permissions. Channel stays a
    // filter and a cell (its words are pinned), but no column names it.
    keys: ['interviewee', 'company', 'date', 'icp_fit', 'recording_consent', 'consent', 'state'],
    // D6001 (#6001): `stage` and `name` are what Move stage reads; neither is a column.
    row: (r) => ({ id: r.id, recordId: workerId(r.id), stage: typeof r.stage === 'string' ? r.stage : null, name: r.interviewee ?? null, cells: {
      // D685 §5.11: the interviewee opens the interview's review, Customer
      // research's record (D696 decision 6). A linked row draws it as text.
      // The scoped read carries the project, so no ?project_id= is threaded.
      interviewee: r.interviewee == null || r.interviewee === '' ? null
        : r.id != null && /^\d+$/.test(String(r.id)) ? { text: r.interviewee, href: `/validate/customer-research/${r.id}` } : r.interviewee,
      company: r.company ?? null,
      date: r.date ?? null,
      icp_fit: pill(FIT, r.icp_fit),
      recording_consent: recordingConsentPill(r.recording_consent),
      consent: r.consent ? pill(CONSENT, r.consent) : { text: 'Not asked', tone: 'grey' },
      channel: word(CHANNEL, r.channel),
      state: word(STATE, r.state),
    } }),
    filters: [
      { key: 'icp', label: 'ICP fit', options: [{ value: 'strong', label: 'Strong' }, { value: 'partial', label: 'Partial' }, { value: 'none', label: 'None' }, { value: 'not_recorded', label: 'Not recorded' }] },
      // D697 decision 4: FVW's Deck-eligible view is the Agreed rows. Stage gave
      // way to State there; D6001 lists it again, last, for the recruiting pipeline.
      { key: 'recording_consent', label: 'Recording consent', options: [{ value: 'given', label: 'Given' }, { value: 'declined', label: 'Declined' }, { value: 'not_asked', label: 'Not asked' }] },
      { key: 'consent', label: 'Quotes OK', options: [{ value: 'agreed', label: 'Agreed · deck-eligible' }, { value: 'declined', label: 'Declined' }, { value: 'not_asked', label: 'Not asked' }] },
      { key: 'channel', label: 'Channel', options: ['in_person', 'call', 'text'].map((value) => ({ value, label: CHANNEL[value] })) },
      // D6001 (#6001): Stage is listed again, beside State, as the Worker lists it.
      { key: 'stage', label: 'Stage', options: [{ value: 'lead', label: 'Lead' }, { value: 'invited', label: 'Invited' },
        { value: 'invited_no_slot', label: 'Invited · no slot yet' }, { value: 'booked', label: 'Booked' }, { value: 'done', label: 'Done · or no stage recorded' }] },
    ],
    sorts: [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'name', label: 'Name' }],
  },
  'ideal-customer-profile': {
    // D6007 (#6007, V21): Primary ICP, last. A segment that is not the primary reads a dash, never Not recorded.
    keys: ['segment', 'interviews', 'strong_fit', 'evidence', 'updated', 'primary'],
    row: (r, i) => ({ id: seg(r.id) ?? `segment-${i}`, recordId: workerId(r.id), primary: r.primary === true, cells: {
      segment: r.segment ?? null,
      interviews: num(r.interviews) ? r.interviews : null,
      strong_fit: num(r.strong_fit) ? r.strong_fit : null,
      evidence: pill(EVIDENCE, r.evidence),
      updated: typeof r.updated === 'string' ? r.updated.slice(0, 10) : null,
      primary: r.primary === true ? { text: '★ Primary', tone: 'v2' } : '—',
    } }),
    filters: [{ key: 'evidence', label: 'Evidence', options: [{ value: 'anecdote', label: 'Anecdote' }, { value: 'pattern', label: 'Pattern' }, { value: 'not_recorded', label: 'Not recorded' }] }],
    sorts: [{ key: 'evidence', label: 'Evidence' }, { key: 'interviews', label: 'Interviews' }, { key: 'strong', label: 'Strong fit' }, { key: 'name', label: 'Name' }],
  },
  'market-intelligence': {
    keys: ['company', 'kind', 'latest_signal', 'date', 'source'],
    row: (r, i) => ({ id: r.id ?? `competitor-${i}`, recordId: workerId(r.id), cells: {
      company: r.company ?? null,
      kind: pill(KIND, r.kind),
      latest_signal: r.latest_signal ?? null,
      date: r.date ?? null,
      // A source is a URL or a kind ("web", "manual"). An outside URL is shown
      // as text: the page links only within the app (`safeHref`).
      source: r.source ?? null,
    } }),
    filters: [
      { key: 'kind', label: 'Kind', options: [{ value: 'direct', label: 'Direct' }, { value: 'adjacent', label: 'Adjacent' }] },
      { key: 'signal', label: 'Signal', options: [{ value: 'has', label: 'Has a signal' }, { value: 'none', label: 'No signal' }] },
    ],
    sorts: [{ key: 'latest', label: 'Latest signal' }, { key: 'name', label: 'Name' }],
  },
  'demand-signals': {
    keys: ['signal', 'who', 'amount', 'date', 'counts'],
    row: (r, i) => ({ id: r.id ?? `signal-${i}`, recordId: workerId(r.id), cells: {
      signal: word(SIGNAL, r.signal),
      who: r.who ?? null,
      amount: r.signal === 'waitlist' ? '—' : money(r.amount_cents, r.currency, r.period),
      date: r.date ?? null,
      counts: pill(COUNTS, r.counts),
    } }),
    filters: [
      { key: 'kind', label: 'Kind', options: Object.entries(SIGNAL).map(([value, label]) => ({ value, label })) },
      { key: 'period', label: 'Period', options: [{ value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }] },
    ],
    sorts: [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }],
  },
  // D6016 (#6016, V7): the Hypotheses list in the canvas's columns, labelled by the read (D661); each cell is drawn from
  // what the read already sends.
  experiments: {
    keys: ['code', 'claim', 'status', 'relationships', 'sources', 'sprint', 'owner', 'source'],
    row: (r) => {
      const [code, claim] = splitClaim(r.hypothesis);
      return { id: r.id, recordId: workerId(r.id), cells: {
        code, claim,
        // D697: a retired claim reads Retired; one whose lane moved in the last 14 days says so beside its state.
        status: r.retired === true ? { text: 'Retired', tone: 'grey' }
          : METHOD_WORD[r.status] ? { text: `${METHOD_WORD[r.status]}${MOVED_WORD[r.moved] ?? ''}`, tone: CLAIM_TONE[r.status] } : null,
        relationships: relationshipsCell(r),
        sources: sourcesCell(r),
        sprint: r.sprint ?? null,
        owner: r.owner ?? null,
        source: fillCell(r.provenance),
      } };
    },
    // The Status filter's words follow the methodology too; its values are the Worker's.
    mapFilters: (filters) => (Array.isArray(filters) ? filters.map((f) => (f?.key === 'status' && Array.isArray(f.options)
      ? { ...f, label: 'Evidence state', options: f.options.map((o) => (METHOD_WORD[o?.value] ? { ...o, label: METHOD_WORD[o.value] } : o)) }
      : f)) : filters),
    filters: [
      // D697: the Worker's options, in its order. Sprint's are the venture's own, so only the read can list them.
      { key: 'status', label: 'Evidence state', options: ['untested', 'testing', 'supported', 'contested', 'refuted', 'inconclusive', 'not_recorded']
        .map((value) => ({ value, label: METHOD_WORD[value] })).concat([{ value: 'retired', label: 'Retired' }]) },
      { key: 'sprint', label: 'Sprint', options: [] },
      { key: 'strength', label: 'Strength', options: [{ value: 'anecdote', label: 'Anecdote' }, { value: 'pattern', label: 'Pattern' }, { value: 'measured', label: 'Measured' }, { value: 'not_recorded', label: 'Not recorded' }] },
      // FVW's Recently moved, and the verdict zone's two history views (decision 19).
      { key: 'moved', label: 'Recently moved', options: [{ value: 'recent', label: 'Recently moved' }] },
      { key: 'history', label: 'History', options: [{ value: 'last_week', label: 'As of last week' }, { value: 'this_month', label: 'Changed this month' }] },
    ],
    sorts: [{ key: 'updated', label: 'Updated' }, { key: 'status', label: 'Evidence state' }, { key: 'code', label: 'Code' }],
  },
  // D693 (#1704): the Decisions table (CO:610). A Withheld row's Decision is
  // "Withheld" and its Reasoning the Worker's "<n> of 5 pieces of evidence";
  // every row reads "<d Mon> · <Name>" (decision 10).
  verdict: {
    keys: ['decision', 'for', 'reasoning', 'evidence', 'date'],
    row: (r) => ({ id: r.id, recordId: workerId(r.id), cells: {
      decision: r.state === 'withheld' ? { text: 'Withheld', tone: 'grey' }
        : DECISION_WORD[r.decision] ? { text: DECISION_WORD[r.decision], tone: DECISION_TONE[r.decision] } : null,
      for: r.for ?? null,
      reasoning: r.reasoning ?? null,
      evidence: num(r.evidence) ? r.evidence : null,
      date: dayMonth(r.date) ? [dayMonth(r.date), r.by].filter(Boolean).join(' · ') : null,
    } }),
    filters: [
      { key: 'decision', label: 'Decision', options: [{ value: 'proceed', label: 'Proceed' }, { value: 'pivot', label: 'Pivot' }, { value: 'stop', label: 'Stop' }, { value: 'withheld', label: 'Withheld' }] },
      // For's hypotheses are the venture's own, so the read lists them.
      { key: 'for', label: 'For', options: [{ value: 'venture', label: 'The venture' }] },
    ],
    sorts: [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }],
  },
};

/** D6016: the read's `hypothesis` is "<code> · <claim>"; split once, on the first separator. */
export function splitClaim(text) {
  if (typeof text !== 'string' || !text.trim()) return [null, null];
  const at = text.indexOf(' · ');
  return at > 0 ? [text.slice(0, at), text.slice(at + 3)] : [null, text];
}

/**
 * D6016 (V7 Relationships): supporting, contradicting and unknown fit together, each a word with a glyph, never
 * colour alone. These count relationships (interview links), not sources. Before the v2 counts, the D4585 interview
 * figure stands alone. Nothing at all is null ("Not recorded"), never "0".
 */
export function relationshipsCell(r) {
  const v2 = num(r?.supporting) && num(r?.contradicting);
  if (v2) {
    const parts = [`↑ ${r.supporting} supports`, `↓ ${r.contradicting} contradicts`];
    if (num(r.fit_unrecorded) && r.fit_unrecorded > 0) parts.push(`? ${r.fit_unrecorded} fit unknown`);
    if (!r.supporting && !r.contradicting && !(r.fit_unrecorded > 0)) return null;
    return parts.join(' · ');
  }
  return num(r?.evidence) && r.evidence > 0 ? `${r.evidence} interview ${r.evidence === 1 ? 'link' : 'links'}` : null;
}

/**
 * D6016 (V7 Distinct sources): how many separate things the relationships come from: distinct interviews (with the
 * organizations behind them when recorded) and the claim's other linked evidence by kind. Breadth, not studies.
 */
export function sourcesCell(r) {
  const parts = [];
  if (num(r?.interviews) && r.interviews > 0) {
    parts.push(`${r.interviews} interview${r.interviews === 1 ? '' : 's'}`);
    if (num(r.organizations)) parts.push(`${r.organizations} organization${r.organizations === 1 ? '' : 's'}`);
  }
  const l = r?.linked_evidence || {};
  for (const [k, one, many] of [['signal', 'signal', 'signals'], ['metric', 'metric', 'metrics'], ['experiment', 'experiment', 'experiments']]) {
    if (num(l[k]) && l[k] > 0) parts.push(`${l[k]} ${l[k] === 1 ? one : many}`);
  }
  if (num(l.interview) && l.interview > 0) parts.push(`${l.interview} direct interview${l.interview === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * D4585 (#4585): a claim's Interview support cell. The status counts interviews through pain links only, so the cell
 * names them as interviews; evidence linked another way (a direct interview, a demand signal, a metric, an experiment)
 * is said apart, as not counted in the status. Nothing at all is null (the table's "Not recorded"), never "0".
 */
export function supportCell(r) {
  const l = r?.linked_evidence || {};
  const other = ['interview', 'signal', 'metric', 'experiment'].reduce((t, k) => t + (num(l[k]) ? l[k] : 0), 0);
  // D4586 (#4586): with the v2 counts, each interview once, then support, contradiction and unknown fit together.
  // An interview touching both directions is in both counts and named once more as "in both".
  const v2 = num(r?.interviews) && num(r?.supporting) && num(r?.contradicting);
  const n = v2 ? r.interviews : num(r?.evidence) ? r.evidence : 0;
  if (!n && !other) return null;
  const parts = [`${n} interview${n === 1 ? '' : 's'}`];
  if (v2 && n) {
    parts.push(`${r.supporting} for`, `${r.contradicting} against`);
    if (num(r.fit_unrecorded) && r.fit_unrecorded > 0) parts.push(`${r.fit_unrecorded} fit not recorded`);
    if (num(r.both) && r.both > 0) parts.push(`${r.both} in both`);
  }
  if (n && EVIDENCE[r.strength]) parts.push(EVIDENCE[r.strength][0]);
  if (other) parts.push(`${other} other linked, not in status`);
  return parts.join(' · ');
}
