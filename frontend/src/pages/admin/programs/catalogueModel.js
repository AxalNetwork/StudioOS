/**
 * D961 (#2794) — Programs part 8: the catalogue's figures, from part 1's
 * catalogue read (D954 §3, `GET /api/admin/programs?weeks=&scope=`), as pure
 * functions. No React here, so `node --test` loads it.
 *
 * ONE RULE FOR EVERY BLOCK PART 1 ANSWERS (`blockState`):
 *   · `{ available: true, … }` is read, and its figure is drawn;
 *   · `pending: true` is a figure that waits on another part's read. It draws
 *     "Not read here yet" with the reason part 1 gives, never 0 and never
 *     "Could not be read";
 *   · `unreadable: true` is a read that failed. It draws "Could not be read"
 *     with Try again;
 *   · `recorded: false` is a figure no store holds: "Not recorded".
 * A read that did not answer at all is loading or unreadable for every block it feeds.
 */
import {
  COULD_NOT_READ, NOT_READ_YET, NOT_RECORDED, NONE_CLAIM, OVERDUE_HOURS, PROGRAMS, ageText, isFailed, isLoading,
  plural, programByKey,
} from './programsModel';

const nf = (n) => Number(n).toLocaleString('en-US');

/** The period control (PG1, `dc:469`): 4, 12 and 52 weeks, with 12 chosen. */
export const PERIODS = Object.freeze([
  { weeks: 4, label: '4 weeks' },
  { weeks: 12, label: '12 weeks' },
  { weeks: 52, label: '52 weeks' },
]);
export const DEFAULT_WEEKS = 12;

/** `?weeks=` as the page reads it; anything but 4, 12 or 52 is the default. */
export function weeksFrom(search) {
  const w = Number(new URLSearchParams(search || '').get('weeks'));
  return PERIODS.some((p) => p.weeks === w) ? w : DEFAULT_WEEKS;
}

/** The search with `weeks` set, the default left out of the address. */
export function withWeeks(search, weeks) {
  const q = new URLSearchParams(search || '');
  if (weeks === DEFAULT_WEEKS) q.delete('weeks'); else q.set('weeks', String(weeks));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const READ_FAILED = 'The programs could not be read. That is not the same as none.';
export const NOT_PER_STUDIO = 'This figure is read from HQ’s own database. It has no per-studio form yet.';

/** One block of part 1's answer, in its state. */
export function blockState(b) {
  if (!b || typeof b !== 'object') return { state: 'unreadable', reason: READ_FAILED };
  if (b.available === true) return { state: 'ready', data: b };
  if (b.pending === true) return { state: 'pending', reason: String(b.reason || '') };
  if (b.recorded === false) return { state: 'unrecorded', reason: String(b.reason || '') };
  return { state: 'unreadable', reason: String(b.reason || READ_FAILED) };
}

/** A block picked out of the catalogue read: loading or unreadable with the read, else the block's own state. */
export function pick(read, path) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable', reason: READ_FAILED };
  let b = read.data;
  for (const k of path) b = b && typeof b === 'object' ? b[k] : undefined;
  return blockState(b);
}

/** A tile for a block that is not ready: Reading…, Not read here yet or Not recorded with its reason, or Could not be read. */
function waitingState(key, label, s) {
  if (s.state === 'loading') return { key, label, state: 'loading' };
  if (s.state === 'pending') return { key, label, state: 'placeholder', word: NOT_READ_YET, reason: s.reason };
  if (s.state === 'unrecorded') return { key, label, state: 'placeholder', word: NOT_RECORDED, reason: s.reason };
  return { key, label, state: 'unreadable', reason: s.reason };
}

const nameOf = (key) => programByKey(key)?.name || key;
const list = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** "+8%" or "−3%" against the period before; null when the period before had none, so no delta is drawn. */
export function deltaText(now, before) {
  if (!Number.isFinite(Number(now)) || !(Number(before) > 0)) return null;
  const pct = Math.round(((Number(now) - Number(before)) / Number(before)) * 100);
  return pct === 0 ? '0%' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/**
 * The four tiles (`dc:333`). Programs running counts the registry's `live`
 * rows; People taking part names what it covers and that the Lab is left
 * out; Waiting for you sums the queues part 1 reads and names the one it
 * leaves out; Credits paid out is HQ's.
 */
export function catalogueTiles(read) {
  const running = pick(read, ['tiles', 'running']);
  const people = pick(read, ['tiles', 'people']);
  const waiting = pick(read, ['tiles', 'waiting']);
  const credits = pick(read, ['tiles', 'credits']);
  const tiles = [];

  if (running.state === 'ready') {
    const d = running.data;
    const by = d.by_status || {};
    const proposed = Number(by.proposed) || 0;
    const notOffered = Math.max(0, Number(d.total) - Number(d.running) - proposed);
    tiles.push({ key: 'running', label: 'Programs running', state: 'ready', value: `${nf(d.running)} of ${nf(d.total)}`, sub: `${nf(notOffered)} not offered yet · ${nf(proposed)} proposed` });
  } else tiles.push(waitingState('running', 'Programs running', running));

  if (people.state === 'ready') {
    const d = people.data;
    const covers = Array.isArray(d.covers) ? d.covers.map(nameOf) : [];
    const leftOut = (Array.isArray(d.left_out) ? d.left_out : []).map((x) => `${nameOf(x.program)} is left out: ${x.reason}`);
    tiles.push({
      key: 'people', label: 'People taking part', state: 'ready', value: nf(d.count), delta: deltaText(d.count, d.previous),
      sub: 'active in the period, across programs',
      extra: [covers.length ? `Counts ${list(covers)}.` : null, ...leftOut].filter(Boolean),
    });
  } else tiles.push(waitingState('people', 'People taking part', people));

  // Waiting for you keeps D953 §2's rule: unreadable when any queue it sums fails.
  const leftOutWaiting = (s) => (Array.isArray(s.data?.left_out) ? s.data.left_out : [])
    .map((x) => `${x.queue === 'strategic' ? 'Strategic referral access' : x.queue}: ${NOT_READ_YET}. ${x.reason}`);
  if (waiting.state === 'ready') {
    const d = waiting.data;
    const count = Number(d.count) || 0;
    const oldest = d.oldest_hours === null || d.oldest_hours === undefined ? null : Number(d.oldest_hours);
    tiles.push({
      key: 'waiting', label: 'Waiting for you', state: 'ready', value: nf(count),
      sub: count === 0 ? 'Nothing is waiting.' : oldest !== null ? `oldest ${ageText(oldest)}` : null,
      overdue: count > 0 && oldest !== null && oldest >= OVERDUE_HOURS,
      cover: 'cohort applications, Refer & Earn reviews, perk listings and office-hours hosts',
      extra: leftOutWaiting(waiting),
    });
  } else {
    const t = waitingState('waiting', 'Waiting for you', waiting);
    tiles.push(t);
  }

  if (credits.state === 'ready') {
    const d = credits.data;
    tiles.push({ key: 'credits', label: 'Credits paid out', state: 'ready', value: `${nf(d.granted)} paid out`, sub: `${nf(d.spent)} spent on perks` });
  } else tiles.push(waitingState('credits', 'Credits paid out', credits));

  return tiles;
}

/* ------------------------------------------------------------------ *
 * The charts (PG1's chart blocks; PG17 loading, PG18a failed)
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "3 Aug" from a Monday `YYYY-MM-DD`. */
export const weekLabel = (day) => {
  const [, m, d] = String(day || '').split('-').map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : String(day || '');
};
/** "Aug" from `YYYY-MM`. */
export const monthLabel = (ym) => MONTHS[Number(String(ym || '').split('-')[1]) - 1] || String(ym || '');

/** Joins per week's four series, in the canvas's order and colours. */
export const JOIN_SERIES = Object.freeze([
  { key: 'lab', label: 'Lab applications', tone: 'violet' },
  { key: 'referrals', label: 'Referrals submitted', tone: 'sky' },
  { key: 'learning', label: 'Learning enrolments', tone: 'amber' },
  { key: 'perks', label: 'Perk claims', tone: 'emerald' },
]);
export const REENROLMENT_LINE = 'A re-enrolment counts again.';

/** The whole chart's state, before its series: loading or failed with the read. */
const chartGate = (read) => (isLoading(read) ? { state: 'loading' } : isFailed(read) ? { state: 'unreadable', reason: READ_FAILED } : null);

/**
 * Joins per week (`dc:334-336`). Each series answers alone: one part 1 marks
 * `unreadable` draws no line and is named under the chart as "Could not be
 * read"; one it marks `pending` is named as "Not read here yet" with its
 * reason. A week with no value is a gap, never 0. The y-axis reads "per
 * week": a referral and a Lab application are not people joining.
 */
export function joinsChart(read, { superAdmin = false, perStudio = false } = {}) {
  const gate = chartGate(read);
  if (gate) return { key: 'joins', title: 'Joins per week', ...gate };
  const axis = Array.isArray(read.data?.week_axis) ? read.data.week_axis : [];
  const current = read.data?.current_week;
  const labels = axis.map(weekLabel);
  const series = [];
  const missing = [];
  for (const def of JOIN_SERIES) {
    const label = def.key === 'learning' && !superAdmin ? `${def.label} in the programs assigned to you` : def.label;
    if (def.key === 'lab' && perStudio) { missing.push({ key: def.key, label, word: NOT_READ_YET, reason: NOT_PER_STUDIO }); continue; }
    const s = blockState(read.data?.joins_weekly?.[def.key]);
    if (s.state === 'ready') {
      const by = new Map((s.data.weeks || []).map((w) => [w.week, Number.isFinite(Number(w.count)) ? Number(w.count) : null]));
      series.push({ key: def.key, label, tone: def.tone, values: axis.map((w) => (by.has(w) ? by.get(w) : null)), total: Number(s.data.total) || 0, previous: s.data.previous_total });
    } else {
      missing.push({ key: def.key, label, word: s.state === 'pending' ? NOT_READ_YET : s.state === 'unrecorded' ? NOT_RECORDED : COULD_NOT_READ, reason: s.reason });
    }
  }
  if (!series.length) {
    return { key: 'joins', title: 'Joins per week', state: 'unreadable', reason: 'No series of Joins per week could be read. That is not the same as none.', missing };
  }
  const currentIndex = axis.indexOf(current);
  const ref = series.find((x) => x.key === 'referrals');
  const foot = ref && Number(ref.previous) > 0
    ? (() => {
      const d = Math.round(((ref.total - Number(ref.previous)) / Number(ref.previous)) * 100);
      return d > 0 ? `Referrals rose ${d}% on the period before.` : d < 0 ? `Referrals fell ${Math.abs(d)}% on the period before.` : 'Referrals were level with the period before.';
    })()
    : null;
  const sentence = `Joins per week for ${plural(axis.length, 'week', 'weeks')}: ${series.map((x) => `${x.label} ${nf(x.total)}`).join('; ')}${currentIndex >= 0 ? '; the current week is not finished' : ''}.`;
  return {
    key: 'joins', title: 'Joins per week', state: 'ready',
    chart: { type: 'lines', labels, currentIndex: currentIndex >= 0 ? currentIndex : -1, series: series.map(({ label, tone, values }) => ({ label, tone, values })) },
    alt: sentence,
    axis: 'per week',
    legend: series.map((x) => ({ label: x.label, tone: x.tone })),
    missing,
    lines: series.some((x) => x.key === 'learning') ? [REENROLMENT_LINE] : [],
    foot,
  };
}

/** Waiting by program's rows: each queue Waiting for you sums, labelled as what it counts, with its literal door. */
export const WAITING_ROWS = Object.freeze([
  { key: 'cohort', label: 'Cohort applications', to: '/admin/spinout-lab' },
  { key: 'referrals', label: 'Refer & Earn reviews', to: '/admin/programs/refer-and-earn/queue' },
  { key: 'strategic', label: 'Strategic referral access', to: '/admin/programs/refer-and-earn' },
  { key: 'perks', label: 'Perk listings', to: '/admin/programs/perks/queue' },
  { key: 'hosts', label: 'Office-hours hosts', to: '/admin/spinout-lab' },
]);
/** S-AGE and S1-BANDS: under 24 hours, 24 to 72, and 72 or more, in the canvas's first three colours. */
export const WAIT_BANDS = Object.freeze([
  { key: 'under_24', label: 'Under 24 hours', tone: 'violet' },
  { key: 'from_24_to_72', label: '24 to 72 hours', tone: 'sky' },
  { key: 'over_72', label: '72 hours or more', tone: 'amber' },
]);
export const NOTHING_OVER_72 = 'Of the queues read, nothing has waited 72 hours or more.';

/**
 * Waiting by program (`dc:337-338`). A queue that was read is a bar in the
 * three bands; one part 1 marks `pending` or `unreadable` is a row in words,
 * so a total is never drawn over a queue that was not read.
 */
export function waitingChart(read) {
  const gate = chartGate(read);
  if (gate) return { key: 'waiting', title: 'Waiting by program', ...gate };
  const rows = WAITING_ROWS.map((def) => {
    const s = blockState(read.data?.waiting?.[def.key]);
    if (s.state !== 'ready') {
      return { ...def, state: s.state, word: s.state === 'pending' ? NOT_READ_YET : s.state === 'unrecorded' ? NOT_RECORDED : COULD_NOT_READ, reason: s.reason };
    }
    const d = s.data;
    const bands = d.bands || {};
    const parts = WAIT_BANDS.map((b) => ({ key: b.key, label: b.label, tone: b.tone, value: Number(bands[b.key]) || 0 }));
    const memberLine = def.key === 'referrals' && Number(d.waiting_on_member) > 0 ? `${nf(d.waiting_on_member)} waiting on the member` : null;
    return {
      ...def, state: 'ready', count: Number(d.count) || 0, parts,
      text: `${nf(Number(d.count) || 0)} waiting`,
      sub: [d.aged, d.oldest_hours !== null && d.oldest_hours !== undefined && Number(d.count) > 0 ? `oldest ${ageText(d.oldest_hours)}` : null, memberLine,
        Number(d.age_not_recorded) > 0 ? `${nf(d.age_not_recorded)} with no recorded age` : null].filter(Boolean).join(' · '),
    };
  });
  const ready = rows.filter((r) => r.state === 'ready');
  if (!ready.length) return { key: 'waiting', title: 'Waiting by program', state: 'unreadable', reason: 'No queue could be read. That is not the same as none.', rows };
  const over = ready.some((r) => r.parts.find((p) => p.key === 'over_72').value > 0);
  return {
    key: 'waiting', title: 'Waiting by program', state: 'ready', rows,
    chart: { type: 'stackbars', head: 'Queue', parts: WAIT_BANDS, rows: ready.map((r) => ({ key: r.key, label: r.label, total: r.text, parts: r.parts })) },
    alt: `Items waiting by queue: ${ready.map((r) => `${r.label} ${nf(r.count)}`).join(', ')}.`,
    legend: WAIT_BANDS.map((b) => ({ label: b.label, tone: b.tone })),
    foot: over ? null : NOTHING_OVER_72,
  };
}

/** Credits in and out's sources above the axis, in the canvas's order and colours. */
export const CREDIT_SOURCES = Object.freeze([
  { key: 'lab', label: 'Lab milestones', tone: 'violet' },
  { key: 'bounty', label: 'Bounties', tone: 'sky' },
  { key: 'referral', label: 'Referrals', tone: 'amber' },
  { key: 'manual', label: 'Granted by HQ', tone: 'emerald' },
  { key: 'other', label: 'Other rules', tone: 'muted' },
]);
export const CREDIT_FOOT = '1 credit is worth $1 of perk value.';

/**
 * Credits in and out by month (`dc:339`), a Super Admin's. Granted above the
 * axis by source, spent on perk claims below it. Referrals read "Not
 * recorded" until part 12 pays one: never a zero bar. Deducted and refunded
 * are named apart, never netted. For an Admin the block is "Not read here
 * yet" with "HQ reads these figures.", which is not a failure.
 */
export function creditsChart(read) {
  const gate = chartGate(read);
  if (gate) return { key: 'credits', title: 'Credits in and out by month', ...gate };
  const s = blockState(read.data?.credits_monthly);
  if (s.state !== 'ready') return { key: 'credits', title: 'Credits in and out by month', ...s, word: s.state === 'pending' ? NOT_READ_YET : s.state === 'unrecorded' ? NOT_RECORDED : COULD_NOT_READ };
  const months = Array.isArray(s.data.months) ? s.data.months : [];
  const referral = blockState(s.data.referral);
  const sources = CREDIT_SOURCES.filter((x) => x.key !== 'referral' || referral.state === 'ready');
  const valueOf = (m, key) => (key === 'other'
    ? (Number(m.granted?.other_rule) || 0) + (Number(m.granted?.no_rule) || 0)
    : (m.granted?.[key] === null || m.granted?.[key] === undefined ? null : Number(m.granted[key])));
  const label = (m) => `${monthLabel(m.month)}${m.partial ? ' (part)' : ''}`;
  const rows = months.map((m) => ({
    label: label(m),
    parts: sources.map((x) => ({ key: x.key, value: valueOf(m, x.key) || 0, tone: x.tone })),
    below: Number(m.spent) || 0, belowTone: 'muted',
  }));
  const cell = (v) => (v === null || v === undefined ? NOT_RECORDED : nf(v));
  const table = {
    head: ['Month', ...CREDIT_SOURCES.map((x) => x.label), 'Spent on perk claims', 'Deducted', 'Refunded'],
    rows: months.map((m) => [label(m), ...CREDIT_SOURCES.map((x) => (x.key === 'referral' && referral.state !== 'ready' ? NOT_RECORDED : cell(valueOf(m, x.key)))),
      nf(Number(m.spent) || 0), nf(Number(m.deducted) || 0), nf(Number(m.refunded) || 0)]),
  };
  const granted = months.reduce((t, m) => t + (Number(m.granted_total) || 0), 0);
  const spent = months.reduce((t, m) => t + (Number(m.spent) || 0), 0);
  const deducted = months.reduce((t, m) => t + (Number(m.deducted) || 0), 0);
  const refunded = months.reduce((t, m) => t + (Number(m.refunded) || 0), 0);
  return {
    key: 'credits', title: 'Credits in and out by month', state: 'ready',
    chart: { type: 'columns', rows, table },
    alt: `Credits granted and spent by month: ${months.map((m) => `${label(m)} ${nf(Number(m.granted_total) || 0)} granted, ${nf(Number(m.spent) || 0)} spent on perk claims`).join('; ')}.`,
    legend: [...sources.map((x) => ({ label: x.label, tone: x.tone })), { label: 'Spent on perk claims', tone: 'muted' }],
    referral: referral.state === 'ready' ? null : { word: NOT_RECORDED, reason: referral.reason },
    lines: [`${nf(granted)} granted · ${nf(spent)} spent · ${nf(deducted)} deducted · ${nf(refunded)} refunded, each counted apart.`],
    foot: CREDIT_FOOT,
  };
}

/* ------------------------------------------------------------------ *
 * The cards (`dc:340-357`), from part 1's per-program block
 * ------------------------------------------------------------------ */

/** The registry's status in the canvas's words (D954 §1). */
export const STATUS_WORD = Object.freeze({
  live: 'Live', partly_built: 'Partly built', not_built: 'Not built yet', proposed: 'Proposed', paused: 'Paused',
});

/**
 * The cards in the registry's order, each merged with the frontend constant
 * for what the registry does not serve (the held-mode grant badges, S-HELD,
 * and the reasons a missing purpose or Who reads). While the registry has not
 * answered, or failed, the constant stands, so the doors are always drawn.
 */
export function catalogueCards(read) {
  const reg = pick(read, ['programs']);
  if (reg.state !== 'ready') return { state: reg.state, reason: reg.reason, cards: PROGRAMS.map((p) => ({ ...p, row: null })) };
  const rows = Array.isArray(reg.data.rows) ? reg.data.rows : [];
  const cards = rows.map((r) => {
    const base = programByKey(r.key) || { key: r.key, grant: 'Not offered yet', hqGrant: 'HQ only' };
    return {
      ...base,
      key: r.key,
      group: r.group || base.group,
      name: r.name || base.name,
      purpose: r.purpose ?? null,
      purposeReason: base.purposeReason || 'No purpose is recorded for this program yet.',
      who: r.who ?? null,
      join: r.join_method ?? null,
      whoReason: base.whoReason || 'Who joins and how is not recorded for this program yet.',
      status: STATUS_WORD[r.status] || 'Status not recorded',
      row: r,
    };
  });
  return { state: 'ready', cards };
}

/** One figure block of a card, in its state. */
export const figureOf = (card, key) => (card?.row ? blockState(card.row.figures?.[key]) : { state: 'loading' });

/** A card's Needs you: `{ state, count }`; null when the program has none. */
export function needsOf(card) {
  if (!card?.row) return { state: 'loading' };
  if (!card.row.needs_you) return null;
  const s = blockState(card.row.needs_you);
  return s.state === 'ready' ? { state: 'ready', count: Number(s.data.count) || 0 } : { state: s.state === 'loading' ? 'loading' : 'unreadable', reason: s.reason };
}

export const labCohortLine = (d) => plural(Number(d.count) || 0, 'cohort application waiting', 'cohort applications waiting');
export const mentorLine = (m, c) => `${plural(Number(m.count) || 0, 'mentor', 'mentors')} · ${nf(c.covered)} of ${nf(c.cohorts)} ${Number(c.cohorts) === 1 ? 'cohort' : 'cohorts'} covered`;
export const referLine = (d) => plural(Number(d.count) || 0, 'open referral', 'open referrals');
export const learningLine = (d) => `${plural(Number(d.published_programs) || 0, 'published program', 'published programs')} · ${plural(Number(d.active_enrolments) || 0, 'active enrolment', 'active enrolments')} in them`;
const JOIN_WORD = { open: 'Open', invite: 'By invitation' };
export const learningJoinOf = (d) => {
  const words = (Array.isArray(d.join_methods) ? d.join_methods : []).map((m) => JOIN_WORD[m]).filter(Boolean);
  return words.length === 2 ? 'Open or by invitation' : words[0] || NOT_RECORDED;
};
export const testingLine = (d) => `${nf(d.open)} open · ${nf(d.applications)} applied, not withdrawn`;

/**
 * Lab applications on the Spin-Out Lab card (S-LAB): `counts.pending` from
 * `GET /api/admin/spinout-applications` (D960), exact and uncapped. A failed
 * read is "Could not be read" on that line only. Under a studio's name it is
 * "Not read here yet": the read has no per-studio form.
 */
export function labApplications(read, { perStudio = false } = {}) {
  if (perStudio) return { state: 'placeholder', word: NOT_READ_YET, reason: NOT_PER_STUDIO };
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable', reason: `Lab applications could not be read. ${NONE_CLAIM}` };
  const pending = Number(read.data?.counts?.pending);
  if (!read.data?.counts || typeof read.data.counts !== 'object') return { state: 'unreadable', reason: `Lab applications came back with no counts. ${NONE_CLAIM}` };
  // `counts` holds only the statuses that have rows, so no `pending` key is a real none.
  const n = Number.isFinite(pending) ? pending : 0;
  return { state: 'ready', count: n, text: `${plural(n, 'Lab application', 'Lab applications')} waiting` };
}

/* ------------------------------------------------------------------ *
 * The studio filter (PG2's "Studio", D893's Scope select)
 * ------------------------------------------------------------------ */

export const STUDIO_CHIP_SOURCE = 'counts read from its own database';

/** R12's lines for `scopeState`: its list once it answers, `[]` when it failed (HQ-held alone), `null` while it reads. */
export const scopeLinesOf = (scopesRead) => (isLoading(scopesRead) ? null : isFailed(scopesRead) ? [] : (Array.isArray(scopesRead.data?.scopes) ? scopesRead.data.scopes : []));

/**
 * The chip under the title. A picked studio is named, as Insights names it;
 * HQ's own keeps D953's chip, whose `title=` carries R12's reason.
 */
export function studioChip(scope, ownChip) {
  if (scope?.kind === 'branch') return { label: `${scope.label} · ${STUDIO_CHIP_SOURCE}`, title: ownChip.title };
  if (scope?.kind === 'pending') return { label: 'Reading the scope…', title: 'Reading the scope…' };
  return ownChip;
}
