/**
 * D949 (#2754) — Participants (SL7) and one participant (SL8), pure. The
 * words, the rows, the standing bar, the filters, the drawer's sections and
 * the three dialogs' copy, all from D946's read
 * (`GET /api/admin/cohort/participants`, `…/:uid`). A figure the read could not
 * give says so; nothing here is a zero for a missing value, or a sample.
 *
 * Times are the Lab's clock (ET); D1's zone-less stamps are UTC.
 */
import { LAB_PATH } from './labModel';
import { dataOf, etDay, isFailed, isLoading, parseStamp, plural } from './labDesksModel';

export const PARTICIPANTS_PATH = `${LAB_PATH}/participants`;
export const participantHref = (uid) => `${PARTICIPANTS_PATH}/${encodeURIComponent(uid)}`;

/** `/participants/:uid` → the uid, else null. */
export function participantOf(pathname) {
  const m = new RegExp(`^${PARTICIPANTS_PATH.replace(/[/-]/g, (c) => `\\${c}`)}/([^/]+)/?$`).exec(String(pathname || ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

const nf = (n) => Number(n).toLocaleString('en-US');

/* ------------------------------------------------------------------ *
 * This week's outcome (D946 §3)
 * ------------------------------------------------------------------ */

export const THIS_WEEK = [
  { key: 'on_track', word: 'On track', tone: 'green', glyph: '✓', bar: 'emerald' },
  { key: 'at_risk', word: 'At risk', tone: 'amber', glyph: '!', bar: 'amber' },
  { key: 'grace', word: 'In grace', tone: 'violet', glyph: '◷', bar: 'violet' },
  { key: 'failed', word: 'Failed a week', tone: 'red', glyph: '×', bar: 'sky' },
  { key: 'graduated', word: 'Graduated', tone: 'green', glyph: '★', bar: 'muted' },
  { key: 'not_in_cohort', word: 'Not in a cohort', tone: 'muted', glyph: '·', bar: 'muted' },
];
export const thisWeekOf = (key) => THIS_WEEK.find((t) => t.key === key) || null;

export const STATUS_WORDS = { active: 'Active', admitted: 'Admitted, not started', graduated: 'Graduated' };

export const MODERATION_WORDS = { under_review: 'Under review', suspended: 'Suspended', ejected: 'Ejected' };

/* ------------------------------------------------------------------ *
 * Milestones and tools, in words. The Worker sends keys (D946 §3);
 * these are the workspace's own labels (AdminSpinoutLab, SpinoutLabWorkspace).
 * ------------------------------------------------------------------ */

export const MILESTONE_WORDS = Object.freeze({
  project_created: 'Create startup record',
  customer_interview_logged_1: 'Log customer interview 1',
  customer_interview_logged_2: 'Log customer interview 2',
  customer_interview_logged_3: 'Log customer interview 3',
  okrs_created: 'Set 3+ OKRs',
  brand_basics_filled: 'Draft Brand v1',
  pitch_deck_drafted: 'Draft pitch deck v1',
  scoring_run_completed: 'Run venture-readiness score',
  advisor_meeting_booked: 'Establish advisor cadence',
  cofounder_request_sent: 'Decide co-founder track',
  incorporation_completed: 'Incorporate',
});

/** A milestone key in words; `any_of:a|b` reads "one of A or B". An unknown key is said as such, never dropped. */
export function milestoneWord(key) {
  const k = String(key || '');
  if (k.startsWith('any_of:')) {
    const parts = k.slice('any_of:'.length).split('|').map((x) => MILESTONE_WORDS[x] || 'an item not named here');
    return `One of: ${parts.join(' or ')}`;
  }
  return MILESTONE_WORDS[k] || 'An item not named here';
}

export const TOOL_WORDS = Object.freeze({
  'spinout-lab': 'Spin-Out Lab', projects: 'Startups', 'customer-discovery': 'Customer Discovery', 'market-intelligence': 'Market Intel',
  profiling: 'Profiling', roadmap: 'Roadmap', 'brand-builder': 'Brand & Landing Pages', 'pitch-deck': 'Pitch Deck Builder',
  'cofounder-match': 'Co-founder Match', advisors: 'Advisors', 'office-hours': 'Office Hours', scoring: 'Scoring Engine',
  revenue: 'Revenue', incorporate: 'Incorporate', captable: 'Cap Table', 'section-83b': '83(b) Election',
  'cofounder-agreement': 'Co-founder Agreement', capital: 'Capital', compliance: 'Compliance Calendar', 'use-of-funds': 'Use of Funds',
});
export const toolWord = (key) => TOOL_WORDS[key] || 'A tool not named here';

/* ------------------------------------------------------------------ *
 * Times on the Lab's clock
 * ------------------------------------------------------------------ */

/** "14 Nov 23:59 ET": a week's deadline, which the Worker stores as the next 00:00 ET (D946 §3, inclusive). */
export function deadlineText(stamp, now = Date.now()) {
  const ms = parseStamp(stamp);
  if (ms === null) return null;
  return `${etDay(ms - 60_000, now)} 23:59 ET`;
}

/** "15 Nov 14:00 ET": a time on the Lab's clock. */
export function etTime(ms, now = Date.now()) {
  if (ms === null || !Number.isFinite(ms)) return null;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  return `${etDay(ms, now)} ${hm} ET`;
}

/* ------------------------------------------------------------------ *
 * The list (SL7)
 * ------------------------------------------------------------------ */

export const PAGE_SIZE = 25;
export const SORTS = [
  { key: 'days_left', label: 'Days left' },
  { key: 'progress', label: 'Progress' },
  { key: 'cohort', label: 'Cohort, newest' },
  { key: 'name', label: 'Name' },
];
export const STATUS_FILTERS = [{ value: '', label: 'Status: any' }, ...Object.entries(STATUS_WORDS).map(([value, w]) => ({ value, label: `Status: ${w}` }))];
export const WEEK_FILTERS = [{ value: '', label: 'Week: any' }, ...[1, 2, 3, 4].map((w) => ({ value: String(w), label: `Week ${w}` }))];
export const THIS_WEEK_FILTERS = [{ value: '', label: 'This week: any' }, ...THIS_WEEK.map((t) => ({ value: t.key, label: `This week: ${t.word}` }))];
export const INCORPORATED_FILTERS = [{ value: '', label: 'Incorporated: any' }, { value: 'yes', label: 'Incorporated: yes' }, { value: 'no', label: 'Incorporated: no' }];

/** The query the read takes: only what was chosen, and the page as an offset. */
export function queryOf({ show = 'needs', cohort = '', status = '', week = '', thisWeek = '', incorporated = '', q = '', sort = 'days_left', page = 1 } = {}) {
  return {
    cohort: cohort || undefined, status: status || undefined, week: week || undefined, this_week: thisWeek || undefined,
    incorporated: incorporated || undefined, needs: show === 'needs', q: q.trim() || undefined, sort,
    limit: PAGE_SIZE, offset: (Math.max(1, page) - 1) * PAGE_SIZE,
  };
}

/** One row as SL7 draws it. Every cell says what it is when the read could not give it. */
export function participantRow(r, now = Date.now()) {
  const tw = thisWeekOf(r.this_week);
  const missing = Array.isArray(r.missing) ? r.missing.map(milestoneWord) : null;
  let weekDay;
  if (r.week === null || r.week === undefined) weekDay = r.status === 'active' ? 'Not read' : '—';
  else weekDay = r.paused ? `W${r.week} · paused` : `W${r.week} · D${r.day ?? '?'}`;
  let thisWeek;
  if (!tw) thisWeek = { word: 'Not read', tone: 'muted', glyph: '·', sub: null };
  else {
    let sub = null;
    if (tw.key === 'grace' && r.grace_until) sub = `In grace until ${etDay(r.grace_until, now)}`;
    if (tw.key === 'failed' && r.failed_week) sub = `Failed Week ${r.failed_week}`;
    thisWeek = { word: tw.word, tone: tw.tone, glyph: tw.glyph, sub };
  }
  return {
    userId: r.user_id ?? null,
    uid: r.uid,
    name: r.name || 'No name given',
    company: r.company || 'No company yet',
    sector: r.sector || null,
    cohort: r.cohort || 'No cohort',
    status: STATUS_WORDS[r.status] || 'Not read',
    weekDay,
    progress: r.progress ? { text: `${nf(r.progress.done)} / ${nf(r.progress.required)}`, pct: r.progress.required ? Math.round((r.progress.done / r.progress.required) * 100) : 0 } : null,
    thisWeek,
    deadline: r.deadline_at ? deadlineText(r.deadline_at, now) : null,
    missing: missing === null ? null : missing.length ? (missing.length > 2 ? `${missing.slice(0, 2).join(', ')} +${missing.length - 2}` : missing.join(', ')) : 'Nothing',
    moderation: r.moderation === undefined ? { text: 'Not read', muted: true } : r.moderation === null ? { text: 'No open case', muted: true }
      : { text: MODERATION_WORDS[r.moderation.state] || 'An open case', muted: false },
    incorporated: r.incorporated ? 'Yes' : 'No',
    // What the dialogs need, and why one may not open.
    cycleId: r.cohort_cycle_id ?? null,
    decideWeek: r.failed_week ?? r.week ?? null,
    canDecide: Boolean(r.user_id && r.cohort_cycle_id && (r.failed_week ?? r.week)),
    raw: r,
  };
}

/** "Where [Nov 2026] stands": one segment per outcome, its sentence, and what the toggles count. */
export function standingOf(data, cohortLabel) {
  const s = data?.standing;
  if (!s) return null;
  const parts = THIS_WEEK.filter((t) => t.key !== 'not_in_cohort').map((t) => ({ key: t.key, label: t.word, value: Number(s[t.key]) || 0, tone: t.bar }));
  const everyone = Number(s.everyone) || 0;
  const said = parts.map((p) => `${nf(p.value)} ${p.label.toLowerCase()}`).join(', ');
  const outside = Number(s.not_in_cohort) || 0;
  const notRead = Number(s.not_read) || 0;
  const lines = [];
  if (outside) lines.push(`${plural(outside, 'founder is', 'founders are')} not in a cohort now, and ${outside === 1 ? 'is' : 'are'} not in the bar.`);
  if (notRead) lines.push(`${plural(notRead, 'founder’s week', 'founders’ weeks')} could not be read, and ${notRead === 1 ? 'is' : 'are'} not in the bar.`);
  return {
    title: `Where ${cohortLabel || 'the Lab'} stands`,
    head: `${plural(everyone, 'founder', 'founders')}`,
    chart: { type: 'bar100', parts },
    alt: `Of ${plural(everyone, 'founder', 'founders')}: ${said}.`,
    legend: parts.map((p) => ({ label: `${p.label} ${nf(p.value)}`, tone: p.tone })),
    lines,
    needs: Number(s.needs_decision) || 0,
    everyone,
  };
}

/** A cohort label "2026-11" as the canvas writes it, "Nov 2026". */
export function cohortWord(label) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(label || ''));
  if (!m) return null;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}`;
}

/** The cohort select's options, from the cohort calendar (`GET /api/admin/cohort/timeline`). */
export function cohortOptions(timelineRead) {
  const cycles = dataOf(timelineRead)?.cycles;
  const known = Array.isArray(cycles)
    ? cycles.map((c) => `${c.year}-${String(c.month).padStart(2, '0')}`).filter((v, i, a) => a.indexOf(v) === i).sort().reverse()
    : [];
  return [{ value: '', label: 'Cohort: any' }, ...known.map((v) => ({ value: v, label: `Cohort: ${cohortWord(v)}` }))];
}

/** The inner reads that failed, each in its own sentence (D946 §4). */
export const unreadLines = (data) => Object.values(data?.unreadable || {});

/** The page's count for the header tab: everyone the read lists, or a dash with its reason. */
export function participantsCount(read) {
  if (isLoading(read)) return { kind: 'load' };
  const n = Number(dataOf(read)?.standing?.everyone);
  if (isFailed(read) || !Number.isFinite(n)) return { kind: 'dash', tip: 'Could not be read: the participants list did not answer.' };
  return { kind: 'num', value: nf(n) };
}

/* ------------------------------------------------------------------ *
 * One participant (SL8)
 * ------------------------------------------------------------------ */

export const WEEK_STATUS = {
  passed: { word: 'Passed', tone: 'green' }, failed: { word: 'Failed', tone: 'red' }, grace: { word: 'In grace', tone: 'violet' },
  pending: { word: 'Not decided', tone: 'muted' }, locked: { word: 'Not started', tone: 'muted' },
};

/** The strip under the name: started, week, day, days left, incorporated. */
export function stripText(r, now = Date.now()) {
  const bits = [];
  bits.push(r.started_at ? `Started ${etDay(r.started_at, now)}` : 'Not started');
  if (r.week) bits.push(r.paused ? `Paused at Week ${r.failed_week ?? r.week}` : `Week ${r.week} of 4`);
  if (r.day) bits.push(`Day ${r.day} of 28`);
  if (r.days_left !== null && r.days_left !== undefined) bits.push(`${plural(r.days_left, 'day', 'days')} left`);
  bits.push(`Incorporated: ${r.incorporated ? 'Yes' : 'No'}`);
  return bits.join(' · ');
}

/** Each week's card: its status, deadline and checklist; null when the calendar could not be read. */
export function weekCards(detail, now = Date.now()) {
  if (!Array.isArray(detail?.weeks)) return null;
  return detail.weeks.map((w) => {
    // An undecided week is `pending`: "Not decided" once it has opened, "Not started" before.
    const st = w.status && w.status !== 'pending' ? WEEK_STATUS[w.status] || { word: 'Another state', tone: 'muted' } : w.unlocked ? WEEK_STATUS.pending : WEEK_STATUS.locked;
    const items = Array.isArray(w.required)
      ? w.required.map((it) => ({ key: it.key, word: milestoneWord(it.key), done: Boolean(it.completed) }))
      : null;
    return {
      week: w.week,
      status: st,
      deadline: w.deadline_at ? deadlineText(w.deadline_at, now) : null,
      items,
    };
  });
}

/** Tools unlocked: "[n] of [total]" and every tool, unlocked or locked; null when unread. */
export function toolsOf(detail) {
  const t = detail?.tools;
  if (!t || !Array.isArray(t.unlocked) || !Array.isArray(t.all)) return null;
  const on = new Set(t.unlocked);
  return { title: `Tools unlocked ${nf(on.size)} of ${nf(t.total ?? t.all.length)}`, tools: t.all.map((k) => ({ key: k, word: toolWord(k), on: on.has(k) })) };
}

/** History, newest first: each decision with who made it — the Lab's clock or an admin, never a name. */
export function historyRows(detail, now = Date.now()) {
  if (!Array.isArray(detail?.history)) return null;
  return detail.history.map((h) => {
    const st = WEEK_STATUS[h.status]?.word || 'Decided';
    return {
      key: `${h.week}-${h.at}-${h.status}`,
      text: `Week ${h.week} ${st.toLowerCase()} (${h.by === 'admin' ? 'an admin' : 'the Lab’s clock'})`,
      at: etTime(parseStamp(h.at), now) || 'Not recorded',
    };
  });
}

/* ------------------------------------------------------------------ *
 * The three dialogs (SL8a–c)
 * ------------------------------------------------------------------ */

export const GRACE_PRESETS = [24, 48, 72];
export const GRACE_MIN = 1;
export const GRACE_MAX = 168;
export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const CODE_RE = /^\d{6}$/;

/** Hours from the field, or null: a whole number from 1 to 168. */
export function graceHours(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= GRACE_MIN && n <= GRACE_MAX ? n : null;
}

export function graceCopy(row, hours, now = Date.now()) {
  const who = row.name;
  return {
    title: `Give ${who} grace for Week ${row.decideWeek}`,
    sub: 'The deadline moves for this founder only.',
    cutoff: hours ? `New cutoff: ${etTime(now + hours * 3_600_000, now)}. ${who} is told now.` : 'Choose from 1 to 168 hours.',
    action: 'Give grace',
    done: (reply) => (reply?.grace_until ? `Grace given until ${etTime(parseStamp(reply.grace_until), now)}. ${who} has been told.` : `Grace given. ${who} has been told.`),
  };
}

export function weekCopy(row) {
  const w = row.decideWeek;
  return {
    title: `Change Week ${w} for ${row.name}`,
    sub: 'The Lab’s clock decides each week at its deadline. Your change replaces it.',
    options: [
      { value: 'pass', label: 'Passed', line: w < 4 ? `Week ${w + 1} opens for them now.` : 'Their last week is passed.' },
      { value: 'fail', label: 'Failed', line: `Their workspace pauses at Week ${w}. They are told.` },
    ],
    action: 'Change the outcome',
    done: (decision) => (decision === 'pass' ? `Week ${w} is passed. ${row.name} has been told.` : `Week ${w} is failed. ${row.name} has been told.`),
  };
}

export function workspaceCopy(row) {
  return {
    title: `Open ${row.name}’s workspace`,
    sub: 'This is a support session, recorded with your reason. A banner shows while you are inside.',
    reasonLabel: 'Reason · ten characters or more',
    codeLabel: 'Authenticator code',
    codeSub: 'It needs a recent authenticator code.',
    action: 'Open workspace',
  };
}

export const reasonOk = (s) => { const t = String(s || '').trim(); return t.length >= REASON_MIN && t.length <= REASON_MAX; };
export const reasonLeft = (s) => Math.max(0, REASON_MIN - String(s || '').trim().length);

/** Refusals in the page's words, by the Worker's code. */
export const PARTICIPANT_REFUSALS = Object.freeze({
  impersonation_reason_required: 'A reason of at least ten characters is required to open a support session.',
  super_admin_required: 'Only a Super Admin can open a support session as another admin.',
  cannot_impersonate_super_admin: 'Only a Super Admin can open a support session as a Super Admin.',
  step_up_required: 'Opening a workspace needs a recent authenticator code. Confirm your code, then try again.',
  totp_required: 'Opening a workspace needs an authenticator app on your account.',
});

/** Why a decision cannot be made for this row, or null when it can. */
export function cannotDecide(row) {
  if (!row.userId) return 'This row carries no account id, so nothing can be changed from here.';
  if (!row.cycleId || !row.decideWeek) return `${row.name} is not in a cohort now, so there is no week to change.`;
  return null;
}
