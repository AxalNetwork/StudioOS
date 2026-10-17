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

function marketIntelligence(s) {
  if (!s || typeof s !== 'object') return [];
  // A figure the founder typed carries no source yet (D659 says so rather
  // than guessing), so the band names the gap instead of inventing one.
  const band = (label, f) => ({
    label,
    value: usdShort(f?.value),
    source: num(f?.value) ? (nonEmpty(f?.source) || 'source not recorded') : undefined,
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
  if (signups.length) {
    out.push({
      kind: 'line',
      values: signups.map((w) => (num(w?.total) ? w.total : null)),
      ...(num(s.bar) ? { target: s.bar, target_label: `bar · ${s.bar.toLocaleString('en-US')}` } : {}),
      labels: weekTicks(signups.map((w) => w?.week_start)),
    });
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
  ['untested', 'Untested', 'grey'], ['testing', 'Testing', 'v2'], ['supported', 'Supported', 'ok'],
  ['refuted', 'Refuted', 'bad'], ['inconclusive', 'Inconclusive', 'muted'], ['not_recorded', 'Fit not recorded', 'warn'],
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

const CLAIM_TONE = { supported: 'ok', refuted: 'bad', testing: 'v2', untested: 'grey', inconclusive: 'muted', not_recorded: 'warn' };
const CLAIM_WORD = { supported: 'Supported', refuted: 'Refuted', testing: 'Testing', untested: 'Untested', inconclusive: 'Inconclusive', not_recorded: 'Fit not recorded' };
const FIT = { strong: ['Strong', 'ok'], partial: ['Partial', 'v2'], none: ['None', 'grey'] };
const CONSENT = { agreed: ['Agreed', 'ok'], declined: ['Declined', 'bad'] };
/** D690 decision 9: an interview's state, by the key the Worker sends. */
export const STATE = {
  failed: 'Failed',
  recording: 'Recording',
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
export const CHANNEL = { in_person: 'In person', video: 'Video call', phone: 'Audio call', text: 'Text chat', manual: 'Entered by hand' };

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
// Eadwyn's mark (D424), in the retired board's own words (#1523). A founder's
// own claim has no mark; a provenance read that failed says so per row.
const PROVENANCE = {
  eadwyn: ['Proposed by Eadwyn', 'v1'],
  eadwyn_edited: ['Proposed by Eadwyn · you edited it', 'v2'],
  unreadable: ['Unreadable', 'muted'],
};

const pill = (map, v) => (map[v] ? { text: map[v][0], tone: map[v][1] } : null);
const word = (map, v) => (v == null ? null : map[v] || String(v));
const money = (cents, currency, period) => {
  if (!num(cents)) return null;
  const amount = (cents / 100).toLocaleString('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 });
  return `${amount}${PERIOD[period] ?? ''}`;
};
const trend = (n) => (!num(n) ? null : n === 0 ? 'no change' : `${n > 0 ? '▲' : '▼'} ${Math.abs(n)}`);
const seg = (id) => (id == null ? null : String(id));

/** Column keys in the order the read lists its labels; each row builder fills them. */
export const RECORDS = {
  'problem-discovery': {
    keys: ['theme', 'mentions', 'severity', 'trend', 'supports'],
    row: (r, i) => ({ id: `theme-${i}-${r.theme}`, cells: {
      theme: r.theme ?? null,
      mentions: num(r.mentions) ? `${r.mentions} ${r.mentions === 1 ? 'interview' : 'interviews'}` : null,
      severity: SEVERITY_WORD[r.severity] ? { text: SEVERITY_WORD[r.severity], tone: SEVERITY_TONE[r.severity] } : null,
      trend: trend(r.trend),
      supports: Array.isArray(r.supports) && r.supports.length ? r.supports.join(', ') : null,
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
    // D690 decision 10: the canvas's five columns plus State. Channel stays a
    // filter and a cell (its words are pinned), but no column names it.
    keys: ['interviewee', 'company', 'date', 'icp_fit', 'consent', 'state'],
    row: (r) => ({ id: r.id, cells: {
      // D685 §5.11: the interviewee opens the interview's review. The scoped
      // read carries the project, so no ?project_id= is threaded.
      interviewee: r.interviewee == null || r.interviewee === '' ? null
        : r.id != null && /^\d+$/.test(String(r.id)) ? { text: r.interviewee, href: `/validate/interviews/${r.id}` } : r.interviewee,
      company: r.company ?? null,
      date: r.date ?? null,
      icp_fit: pill(FIT, r.icp_fit),
      consent: r.consent ? pill(CONSENT, r.consent) : { text: 'Not asked', tone: 'grey' },
      channel: word(CHANNEL, r.channel),
      state: word(STATE, r.state),
    } }),
    filters: [
      { key: 'icp', label: 'ICP fit', options: [{ value: 'strong', label: 'Strong' }, { value: 'partial', label: 'Partial' }, { value: 'none', label: 'None' }, { value: 'not_recorded', label: 'Not recorded' }] },
      // D697 decision 4: FVW's Deck-eligible view is the Agreed rows, and Stage
      // gave way to State (the Worker keeps `stage:pipeline` for the recruiting picker).
      { key: 'consent', label: 'Consent', options: [{ value: 'agreed', label: 'Agreed · deck-eligible' }, { value: 'declined', label: 'Declined' }, { value: 'not_asked', label: 'Not asked' }] },
      { key: 'channel', label: 'Channel', options: ['in_person', 'video', 'phone', 'text'].map((value) => ({ value, label: CHANNEL[value] })) },
    ],
    sorts: [{ key: 'newest', label: 'Newest' }, { key: 'oldest', label: 'Oldest' }, { key: 'name', label: 'Name' }],
  },
  'ideal-customer-profile': {
    keys: ['segment', 'interviews', 'strong_fit', 'evidence', 'updated'],
    row: (r, i) => ({ id: seg(r.id) ?? `segment-${i}`, cells: {
      segment: r.segment ?? null,
      interviews: num(r.interviews) ? r.interviews : null,
      strong_fit: num(r.strong_fit) ? r.strong_fit : null,
      evidence: pill(EVIDENCE, r.evidence),
      updated: typeof r.updated === 'string' ? r.updated.slice(0, 10) : null,
    } }),
    filters: [{ key: 'evidence', label: 'Evidence', options: [{ value: 'anecdote', label: 'Anecdote' }, { value: 'pattern', label: 'Pattern' }, { value: 'not_recorded', label: 'Not recorded' }] }],
    sorts: [{ key: 'interviews', label: 'Interviews' }, { key: 'strong', label: 'Strong fit' }, { key: 'name', label: 'Name' }],
  },
  'market-intelligence': {
    keys: ['company', 'kind', 'latest_signal', 'date', 'source'],
    row: (r, i) => ({ id: r.id ?? `competitor-${i}`, cells: {
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
    row: (r, i) => ({ id: r.id ?? `signal-${i}`, cells: {
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
  experiments: {
    keys: ['hypothesis', 'status', 'evidence', 'sprint', 'owner', 'source'],
    row: (r) => ({ id: r.id, cells: {
      hypothesis: r.hypothesis ?? null,
      // D697: a retired claim reads Retired; one whose lane moved in the last 14 days says so beside its status.
      status: r.retired === true ? { text: 'Retired', tone: 'grey' }
        : CLAIM_WORD[r.status] ? { text: `${CLAIM_WORD[r.status]}${r.moved === 'recent' ? ' · Moved' : ''}`, tone: CLAIM_TONE[r.status] } : null,
      evidence: num(r.evidence) && r.evidence > 0
        ? `${r.evidence}${EVIDENCE[r.strength] ? ` · ${EVIDENCE[r.strength][0]}` : ''}`
        : null,
      sprint: r.sprint ?? null,
      owner: r.owner ?? null,
      source: pill(PROVENANCE, r.provenance),
    } }),
    filters: [
      // D697: the Worker's options, in its order. Sprint's are the venture's own, so only the read can list them.
      { key: 'status', label: 'Status', options: ['untested', 'testing', 'supported', 'refuted', 'inconclusive', 'not_recorded']
        .map((value) => ({ value, label: CLAIM_WORD[value] })).concat([{ value: 'retired', label: 'Retired' }]) },
      { key: 'sprint', label: 'Sprint', options: [] },
      { key: 'strength', label: 'Strength', options: [{ value: 'anecdote', label: 'Anecdote' }, { value: 'pattern', label: 'Pattern' }, { value: 'measured', label: 'Measured' }, { value: 'not_recorded', label: 'Not recorded' }] },
      // FVW's Recently moved, and the verdict zone's two history views (decision 19).
      { key: 'moved', label: 'Recently moved', options: [{ value: 'recent', label: 'Recently moved' }] },
      { key: 'history', label: 'History', options: [{ value: 'last_week', label: 'As of last week' }, { value: 'this_month', label: 'Changed this month' }] },
    ],
    sorts: [{ key: 'updated', label: 'Updated' }, { key: 'status', label: 'Status' }, { key: 'code', label: 'Code' }],
  },
  // D693 (#1704): the Decisions table (CO:610). A Withheld row's Decision is
  // "Withheld" and its Reasoning the Worker's "<n> of 5 pieces of evidence";
  // every row reads "<d Mon> · <Name>" (decision 10).
  verdict: {
    keys: ['decision', 'for', 'reasoning', 'evidence', 'date'],
    row: (r) => ({ id: r.id, cells: {
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
