/**
 * D962 (#2795) — Programs part 9: the program pages complete for Mentor cohort
 * access, Refer & Earn, Perks and Learning. Pure: no React, no fetch, so the
 * tests read every rule without a browser. D953's rules stay in
 * `programsModel.js`; this file holds what part 9 adds on the reads parts 1, 4
 * and 7 serve (D954, D957, D960).
 *
 * WHAT IS READ, beyond D953's R1–R12:
 *   P1  `GET /api/admin/programs/:key`: the registry row and the published
 *       playbook; a Super Admin also gets the draft (D954 §2);
 *   P2  `GET /api/admin/programs/:key/activity`: 50 rows a page, newest
 *       first, with `next_before` and `not_audited` (D954 §10);
 *   P3  `GET /api/admin/programs/mentor-cohorts/sessions`: sessions booked
 *       with a mentor, per cycle (D954 §9);
 *   P4  `GET /api/learning/programs/mine/enrolments?weeks=12` (D954 §6);
 *   P5  `GET /api/learning/programs/:uid/learners/:userUid` (D954 §7);
 *   M1  `GET /api/advisors/admin/cohort-assignments/history`: 565's grants
 *       and ends, newest first, 200 a page (D960 §3);
 *   F1  `GET /api/refer-earn/admin/submissions?…&offset=`: `{ items, total }`,
 *       paged, with comma-separated statuses (D957);
 *   F2  `GET /api/refer-earn/admin/submissions/:uid`: one referral and its timeline;
 *   F3  `GET /api/refer-earn/admin/submissions/weekly?weeks=12`;
 *   F4  `GET /api/refer-earn/admin/strategic-access`: `{ items, total }`, oldest first;
 *   K1  `GET /api/perks/admin/listings?status=&offset=`: `{ items, total }`;
 *   K2  `GET /api/perks/admin/claims?weeks=12`.
 *
 * THE WORDS FOR WHAT IS NOT KNOWN are D915's, as in D953, and every figure
 * states its window, because a program page has no period control (S-PER).
 */

import {
  COULD_NOT_READ, FROZEN, NOT_READ_YET, NOT_RECORDED, OPEN_STATUSES, SUSPENDED, TRY_AGAIN, bandCounts, cohortName, dataOf,
  hoursSince, isFailed, isLoading, isReady, needsMentor, parseStamp, plural, stateOf,
} from './programsModel.js';

export { NOT_RECORDED };

const nf = (n) => Number(n).toLocaleString('en-US');
/** A sort comparison that is safe for ±Infinity, which an unparsed stamp sorts as. */
const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "20 Oct", in UTC as the Worker stores it; null when the stamp will not parse. */
export function shortDay(stamp) {
  const ms = parseStamp(stamp);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "1–28 Dec", or "28 Nov–25 Dec" across a month. */
export function dayRange(from, to) {
  const a = parseStamp(from);
  const b = parseStamp(to);
  if (a === null || b === null) return null;
  const x = new Date(a);
  const y = new Date(b);
  return x.getUTCMonth() === y.getUTCMonth()
    ? `${x.getUTCDate()}–${y.getUTCDate()} ${MONTHS[y.getUTCMonth()]}`
    : `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}–${y.getUTCDate()} ${MONTHS[y.getUTCMonth()]}`;
}

/** A paged read's total (`{ items, total }`), or null: a reply without a number is a failed read, never 0. */
export function totalOf(read) {
  if (!isReady(read)) return null;
  const n = Number(read.data?.total);
  return Number.isFinite(n) ? n : null;
}

export const PAGE_SIZE = 25;

/** "1–25 of 140", "0 of 0" for none. */
export function countLine(offset, shown, total) {
  if (!total) return '0 of 0';
  return `${nf(offset + 1)}–${nf(offset + shown)} of ${nf(total)}`;
}

/* ------------------------------------------------------------------ *
 * Refusals (N9): one sentence in place, keyed on `code`
 * ------------------------------------------------------------------ */

const code = (err) => err?.code || err?.data?.code || (typeof err?.data?.error === 'string' ? err.data.error : null);

/**
 * The sentences each write's refusals read, keyed on the Worker's code. A
 * refusal with no code (today's `{ detail }` 400s and 404s on the mentor
 * routes) reads the Worker's own sentence, which `request()` puts in
 * `message`; the fallback says nothing changed.
 */
export const REFUSALS = Object.freeze({
  admin_frozen: FROZEN,
  branch_suspended: SUSPENDED,
  // D960, Mentor cohort access.
  account_inactive: 'This account is deactivated, so it cannot be given a cohort. Nothing changed.',
  already_assigned: 'This mentor already has access to this cohort, so nothing changed.',
  already_ended: 'This access has already ended, so nothing changed. Refresh to see the list as it is.',
  // D957, Refer & Earn.
  bad_transition: 'This referral changed while you were reading it. Nothing was saved; open it again.',
  already_decided: 'This request was decided while you were reading it. Nothing changed.',
  // D957, Perks.
  not_reviewable: 'This listing changed while you were reading it, so that does not apply now. Nothing changed.',
  note_required: 'Write the reason. The partner sees it on their listing.',
  // D608, credits.
  user_not_found: 'No account matches this member. Nothing was changed.',
  already_recorded: 'This adjustment was already recorded, so it was not recorded twice.',
  // D954, the playbook.
  nothing_to_publish: 'The draft is what is published, so there is nothing to publish.',
  publish_conflict: 'Another publish landed first. Read the playbook again before you publish.',
  computed_section: 'This section is drawn from live data, so it holds no text.',
  unknown_section: 'This section is not in the playbook any more. Read it again.',
  // D954 §7, the learner.
  not_assigned: 'This program is not assigned to you, so its learners are not read here.',
  not_enrolled: 'This learner is not in this program now.',
});

export function refusalSentence(err, fallback = TRY_AGAIN) {
  const c = code(err);
  if (c && REFUSALS[c]) return REFUSALS[c];
  if (Number(err?.status) === 423) return SUSPENDED;
  const said = typeof err?.message === 'string' && err.message.trim() && !/^Request failed$/.test(err.message) ? err.message.trim() : null;
  if (!c && said && (Number(err?.status) === 400 || Number(err?.status) === 404)) return said.endsWith('.') ? `${said} Nothing changed.` : `${said}. Nothing changed.`;
  return fallback;
}

/* ------------------------------------------------------------------ *
 * Activity (P2): every page's Activity tab and Mentor's Recent activity
 * ------------------------------------------------------------------ */

export const RECENT_SHOWN = 5;
export const ACTIVITY_PAGE = 50;
/** Mentor's Activity says what the read does not list yet (item 1). */
export const MENTOR_ACTIVITY_GAP = 'Founders hiding from a mentor, and mentors’ role changes, are not listed here yet.';
export const ACTIVITY_EMPTY = 'Nothing has been recorded on this program yet.';

/** P2's page: its rows, its cursor, and what it says is not audited yet. A reply without rows is a failed read. */
export function activityFrom(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const rows = read.data?.rows;
  if (!Array.isArray(rows)) return { state: 'unreadable' };
  const na = read.data?.not_audited;
  return {
    state: 'ready',
    rows,
    next: typeof read.data?.next_before === 'string' && read.data.next_before ? read.data.next_before : null,
    notAudited: na && na.recorded === false && typeof na.reason === 'string' ? na.reason : null,
    assignedOnly: read.data?.scope === 'assigned',
  };
}

const by = (row) => (row?.by === 'hq' ? 'by HQ' : 'by an admin');

const STATUS_WORD = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', more_info_needed: 'More info needed', qualified: 'Qualified',
  in_conversation: 'In conversation', converted: 'Converted', reward_eligible: 'Reward eligible', reward_issued: 'Reward issued',
  rejected: 'Rejected', closed: 'Closed',
};
export const statusWord = (s) => STATUS_WORD[s] || NOT_RECORDED;

/** D957's three categories, in the canvas's words (`customer` is a platform user). */
export const CATEGORY_WORD = Object.freeze({ startup: 'Startup or founder', customer: 'Platform user', strategic: 'Strategic and capital' });
export const categoryWord = (c) => CATEGORY_WORD[c] || NOT_RECORDED;

/**
 * One activity row as a sentence. No person is named: P2 never serves one,
 * and a mentor's row names its cohort only. `cycles` names a cohort by its
 * month when R7 has it, else by its cycle number.
 */
export function activityText(row, cycles = []) {
  const k = String(row?.kind || '');
  const c = row?.concerns || {};
  const learning = c.learning_program?.name || 'A learning program';
  const cohort = () => {
    const hit = (cycles || []).find((x) => Number(x.id) === Number(c.cohort_cycle_id));
    return hit ? cohortName(hit) : Number.isFinite(Number(c.cohort_cycle_id)) ? `cycle #${c.cohort_cycle_id}` : 'a cohort';
  };
  switch (k) {
    case 'program.registry.update': return `The program’s details were changed ${by(row)}`;
    case 'program.playbook.edit': return `A playbook section was edited ${by(row)}`;
    case 'program.playbook.publish': return Number.isFinite(c.version) ? `Playbook version ${c.version} was published ${by(row)}` : `The playbook was published ${by(row)}`;
    case 'program.registry.create': return `The program was added ${by(row)}`;
    case 'program.proposal.decide': return c.outcome ? `A proposal was ${c.outcome} ${by(row)}` : `A proposal was decided ${by(row)}`;
    case 'learning.program.create': return `${learning} was created ${by(row)}`;
    case 'learning.program.update': return `${learning} was edited ${by(row)}`;
    case 'learning.program.contents': return `${learning}’s contents were changed ${by(row)}`;
    case 'learning.program.admin.assign': return `An admin was assigned to ${learning} ${by(row)}`;
    case 'learning.program.admin.unassign': return `An admin was unassigned from ${learning} ${by(row)}`;
    case 'learning.program.enrol': return `A learner was enrolled in ${learning} ${by(row)}`;
    case 'learning.program.unenrol': return `A learner was removed from ${learning} ${by(row)}`;
    case 'referral.review': return c.status
      ? `A ${categoryWord(c.category).toLowerCase()} referral moved to ${statusWord(c.status)} ${by(row)}`
      : `A ${categoryWord(c.category).toLowerCase()} referral was annotated ${by(row)}`;
    case 'referral_strategic_access.granted': return `Strategic referral access was granted ${by(row)}`;
    case 'referral_strategic_access.declined': return `Strategic referral access was declined ${by(row)}`;
    case 'advisor_cohort.assigned': return `A mentor was assigned to ${cohort()} ${by(row)}`;
    case 'advisor_cohort.ended': return `A mentor’s access to ${cohort()} was ended ${by(row)}`;
    case 'perk.approved': return `A listing was approved ${by(row)}`;
    case 'perk.rejected': return `A listing was rejected ${by(row)}`;
    case 'perk.paused': return `A listing was paused ${by(row)}`;
    case 'perk.feature_updated': return `A live listing’s feature was changed ${by(row)}`;
    default: return `A change was recorded ${by(row)}`;
  }
}

/* ------------------------------------------------------------------ *
 * The playbook (P1): How it runs, read from part 1's store
 * ------------------------------------------------------------------ */

export const PLAYBOOK_NOT_PUBLISHED = 'No version of this playbook is published yet.';
export const PLAYBOOK_NOT_SET = 'Not set';
export const PLAYBOOK_HQ_WRITES = 'HQ writes the playbook.';
export const PUBLISH_LINE = 'Members and admins read the published version. Publishing makes this draft the next one.';

/**
 * P1 as How it runs draws it. An Admin reads the published version only; a
 * Super Admin edits the draft, so the page draws the draft with the version
 * it would follow and when it was last edited. A section's body is lines of
 * text; a computed section (Mentor's cycle) holds none and the page draws it.
 */
export function playbookFrom(read, superAdmin) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const pb = read.data?.playbook;
  if (!pb || !Array.isArray(pb.sections)) return { state: 'unreadable' };
  const draft = superAdmin && read.data?.draft && Array.isArray(read.data.draft.sections) ? read.data.draft : null;
  const sections = (draft ? draft.sections : pb.sections).map((s) => ({
    key: s.key, title: s.title, computed: Boolean(s.computed), templates: Array.isArray(s.template_keys) ? s.template_keys : [],
    lines: typeof s.body === 'string' && s.body.trim() ? s.body.split('\n').map((l) => l.trim()).filter(Boolean) : [],
  }));
  return {
    state: 'ready',
    editing: Boolean(draft),
    published: Boolean(pb.published),
    version: Number.isFinite(Number(pb.version)) && pb.version !== null ? Number(pb.version) : null,
    publishedAt: pb.published_at || null,
    editedAt: draft?.edited_at || null,
    differs: Boolean(draft?.differs),
    sections,
  };
}

/** PG5s's line: "Version 3 · edited 2 Oct", or "Version 3 · not edited since it was published". */
export function versionLine(pb) {
  const v = pb.version === null ? 'No version published yet' : `Version ${pb.version}`;
  if (!pb.editing) return pb.publishedAt ? `${v} · published ${shortDay(pb.publishedAt) || NOT_RECORDED}` : v;
  return pb.editedAt ? `${v} · edited ${shortDay(pb.editedAt) || NOT_RECORDED}` : `${v} · not edited since it was published`;
}

export const SECTION_TITLE_MAX = 120;
export const SECTION_BODY_MAX = 4000;

/** What an edit sends: only the fields that changed; a computed section never sends a body. */
export function sectionEdit(section, { title, body }) {
  const out = {};
  const t = String(title ?? '').trim();
  if (t && t !== section.title) out.title = t;
  if (!section.computed) {
    const b = String(body ?? '').trim();
    if (b !== section.lines.join('\n')) out.body = b || null;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Mentor cohort access (items 3–11)
 * ------------------------------------------------------------------ */

/** Ended this period: D962's window is the last 30 days, said on the tile (S-PER). */
export const ENDED_WINDOW_DAYS = 30;
export const ENDED_WINDOW_LINE = `In the last ${ENDED_WINDOW_DAYS} days.`;
export const HISTORY_LIMIT = 200;
const DAY = 86_400_000;

/**
 * Ended, from 565's history (M1, newest first, 200 a page): the `ended`
 * rows in the window. When the page is full and its oldest row is still
 * inside the window, more may be older, so the figure is "at least".
 */
export function endedInWindow(historyRead, now) {
  if (isLoading(historyRead)) return { state: 'loading' };
  if (isFailed(historyRead)) return { state: 'unreadable' };
  const items = Array.isArray(historyRead.data?.items) ? historyRead.data.items : null;
  if (!items) return { state: 'unreadable' };
  const since = now - ENDED_WINDOW_DAYS * DAY;
  const ended = items.filter((e) => e?.kind === 'ended' && (parseStamp(e.created_at) ?? -Infinity) >= since);
  const oldest = items.length ? parseStamp(items[items.length - 1].created_at) : null;
  const total = Number(historyRead.data?.total);
  const atLeast = items.length >= HISTORY_LIMIT && Number.isFinite(total) && total > items.length && oldest !== null && oldest >= since;
  return { state: 'ready', count: ended.length, atLeast, text: atLeast ? `at least ${nf(ended.length)}` : nf(ended.length) };
}

/** Founders hidden from a mentor: D960's `founders_hidden_total`; null is unreadable, never 0. */
export function hiddenFrom(assignRead) {
  if (isLoading(assignRead)) return { state: 'loading' };
  if (isFailed(assignRead)) return { state: 'unreadable', reason: 'The mentor assignments could not be read.' };
  const n = assignRead.data?.founders_hidden_total;
  if (n === null || n === undefined || !Number.isFinite(Number(n))) {
    return { state: 'unreadable', reason: 'Founders’ choices could not be counted. That is not the same as none.' };
  }
  return { state: 'ready', count: Number(n), text: nf(n) };
}
export const HIDDEN_LINE = 'A founder can hide from one mentor. Each founder counts once.';

const isAdvisorRow = (r) => String(r?.advisor_role || '').toLowerCase() === 'advisor';
const isOpenRow = (r) => r?.is_active === true || r?.is_active === 1;
const isLiveRow = (r) => isOpenRow(r) && isAdvisorRow(r) && r?.advisor_is_active === true;

/**
 * Mentors per cohort (item 4): one bar per cohort S-COV counts, mentors only.
 * A cohort with none is the amber "None" bar, with "[Cohort] has no mentor
 * yet." "· [n] founders" waits for O-FND, so no founder count is drawn.
 */
export function mentorsPerCohort(assignRead, timelineRead) {
  const state = stateOf(assignRead, timelineRead);
  if (state !== 'ready') return { state };
  const rows = (Array.isArray(assignRead.data?.items) ? assignRead.data.items : []).filter(isLiveRow);
  const cycles = (Array.isArray(timelineRead.data?.cycles) ? timelineRead.data.cycles : []).filter(needsMentor)
    .sort((a, b) => (Number(a.year) - Number(b.year)) || (Number(a.month) - Number(b.month)));
  const bars = cycles.map((c) => {
    const n = new Set(rows.filter((r) => Number(r.cohort_cycle_id) === Number(c.id)).map((r) => Number(r.advisor_user_id))).size;
    return { key: `c${c.id}`, label: cohortName(c), value: n, text: n ? plural(n, 'mentor', 'mentors') : '! None', tone: n ? 'violet' : 'amber' };
  });
  const none = bars.filter((b) => b.value === 0);
  return {
    state: 'ready',
    rows: bars,
    notes: none.map((b) => `${b.label} has no mentor yet.`),
    alt: bars.length ? `Mentors per cohort: ${bars.map((b) => `${b.label} ${b.value ? b.value : 'none'}`).join(', ')}.` : 'No cohort is scheduled or running.',
  };
}
export const FOUNDERS_WAIT = 'A cohort’s founder count waits for the owner’s answer on who a cohort’s founders are.';

/** Sessions booked with a mentor (P3), for How we measure it: per cycle, with P3's own rule. */
export function sessionsFrom(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const cycles = Array.isArray(read.data?.cycles) ? read.data.cycles : null;
  if (!cycles) return { state: 'unreadable' };
  const total = cycles.reduce((t, c) => t + (Number(c.sessions) || 0), 0);
  return {
    state: 'ready',
    total,
    rows: cycles.map((c) => ({ key: `s${c.cycle_id}`, label: cohortName(c), sessions: Number(c.sessions) || 0, mentors: Number(c.mentors) || 0 })),
    rule: typeof read.data?.rule === 'string' ? read.data.rule : null,
  };
}

/**
 * Needs you's rows with their actions (item 5): a no-mentor row opens Assign
 * with its cohort chosen; a role-changed row opens End access on that row.
 */
export function needsActions(f) {
  if (f.state !== 'ready') return [];
  const cohorts = f.uncovered.map((c) => ({
    key: `cycle-${c.id}`, kind: 'No mentor', action: 'Assign', open: { dialog: 'assign', cycleId: Number(c.id) },
    text: c.status === 'active' ? `${cohortName(c)} is running with no mentor.` : `${cohortName(c)} starts ${shortDay(c.start_at) || 'on a date not recorded'} with no mentor.`,
  }));
  const roles = f.stale.map((r) => ({
    key: `row-${r.id}`, kind: 'Role changed', action: 'End access', open: { dialog: 'end', row: r },
    text: `${r.advisor_name || r.advisor_email || 'An account with no name recorded'} is no longer an Advisor, but their access is still on.`,
  }));
  return [...cohorts, ...roles];
}

/** No mentors yet (item 10): the next scheduled cohort, not postponed, that the empty state names. */
export function nextCohort(timelineRead) {
  if (!isReady(timelineRead)) return null;
  const cycles = (Array.isArray(timelineRead.data?.cycles) ? timelineRead.data.cycles : [])
    .filter((c) => c?.status === 'scheduled' && c?.app_status !== 'postponed')
    .sort((a, b) => (parseStamp(a.start_at) ?? Infinity) - (parseStamp(b.start_at) ?? Infinity));
  return cycles[0] || null;
}
export const NO_MENTORS = 'No mentors yet.';
export const noMentorsLine = (c) => (c ? `Assign one before ${cohortName(c)} starts.` : null);

/**
 * A cohort's place for People's Cohort column: "· week [n]" while it runs
 * (the latest window that has opened), "· not started" before its first
 * window or start, and "· ended" once completed or past its end.
 */
export function cohortPlace(cycle, now) {
  if (!cycle) return null;
  const end = parseStamp(cycle.end_at);
  if (cycle.status === 'completed' || cycle.status === 'archived' || (end !== null && now >= end)) return 'ended';
  const windows = (Array.isArray(cycle.windows) ? cycle.windows : [])
    .filter((w) => (parseStamp(w.unlock_at) ?? Infinity) <= now)
    .sort((a, b) => Number(b.week_number) - Number(a.week_number));
  if (windows.length) return `week ${windows[0].week_number}`;
  return 'not started';
}

/** "October 2026 · week 2"; a cycle outside R7's twelve newest is "Cycle #[id]". */
export function cohortCell(row, byId, now) {
  const cycle = byId.get(Number(row.cohort_cycle_id));
  if (!cycle) return `Cycle #${row.cohort_cycle_id}`;
  const place = cohortPlace(cycle, now);
  return place ? `${cohortName(cycle)} · ${place}` : cohortName(cycle);
}

/** The row's earlier episodes, from 565's history: each grant with the end that followed it, oldest first. */
export function episodesOf(history, assignmentId) {
  const own = (history || []).filter((e) => Number(e.assignment_id) === Number(assignmentId))
    .sort((a, b) => cmp(parseStamp(a.created_at) ?? -Infinity, parseStamp(b.created_at) ?? -Infinity));
  const out = [];
  for (const e of own) {
    if (e.kind === 'assigned') out.push({ from: e.created_at, to: null });
    else if (e.kind === 'ended' && out.length && !out[out.length - 1].to) out[out.length - 1].to = e.created_at;
  }
  return out;
}

/** "3 Oct – 14 Oct", or "3 Oct – not recorded" for an episode whose end is not stored. */
const episodeText = (ep) => `${shortDay(ep.from) || NOT_RECORDED} – ${ep.to ? shortDay(ep.to) || NOT_RECORDED : 'end not recorded'}`;

export const VISIBLE_DASH = '—';
export const VISIBLE_WAITS = 'Waits for the owner’s answer on a cohort’s founders.';

/**
 * People (item 7): one row per assignment, in the canvas's columns. The
 * email is not drawn; the mentor's state is their current role, "Not an
 * Advisor now" and a deactivated flag. Founders visible is "—" on ended,
 * role-changed and deactivated rows, and otherwise waits for O-FND.
 */
export function peopleRows(assignRead, timelineRead, historyRead, now) {
  if (isLoading(assignRead)) return { state: 'loading' };
  if (isFailed(assignRead)) return { state: 'unreadable' };
  const items = Array.isArray(assignRead.data?.items) ? assignRead.data.items : [];
  const cycles = isReady(timelineRead) && Array.isArray(timelineRead.data?.cycles) ? timelineRead.data.cycles : [];
  const byId = new Map(cycles.map((c) => [Number(c.id), c]));
  const history = isReady(historyRead) && Array.isArray(historyRead.data?.items) ? historyRead.data.items : null;
  const rows = items.map((r) => {
    const open = isOpenRow(r);
    const notAdvisor = Boolean(r.advisor_role) && !isAdvisorRow(r);
    const deactivated = r.advisor_is_active === false;
    const episodes = history ? episodesOf(history, r.id) : null;
    // The current episode is the latest grant; the earlier ones are what a re-assign once overwrote (N16).
    const earlier = episodes ? episodes.slice(0, Math.max(0, episodes.length - 1)) : [];
    return {
      id: r.id,
      row: r,
      name: r.advisor_name || 'Name not recorded',
      role: r.advisor_role ? r.advisor_role.charAt(0).toUpperCase() + r.advisor_role.slice(1).toLowerCase() : 'Role not recorded',
      notAdvisor,
      deactivated,
      open,
      cohortId: Number(r.cohort_cycle_id),
      cohort: cohortCell(r, byId, now),
      cohortSort: (() => { const c = byId.get(Number(r.cohort_cycle_id)); return c ? Number(c.year) * 100 + Number(c.month) : -1; })(),
      assigned: `${shortDay(r.assigned_at) || NOT_RECORDED} by an admin`,
      assignedAt: parseStamp(r.assigned_at) ?? -Infinity,
      ended: open ? VISIBLE_DASH : shortDay(r.unassigned_at) || NOT_RECORDED,
      visible: !open || notAdvisor || deactivated ? VISIBLE_DASH : null,
      note: r.note && String(r.note).trim() ? String(r.note).trim() : VISIBLE_DASH,
      earlier: earlier.map(episodeText),
    };
  });
  return { state: 'ready', rows, capped: items.length >= 500, historyRead: history !== null, historyCapped: history !== null && history.length >= HISTORY_LIMIT };
}

/** The toolbar (item 7): search by mentor or cohort, Cohort, Status, Role changed, and Sort. */
export function filterPeople(rows, { q = '', cohort = '', status = ['active', 'ended'], roleChanged = false, sort = 'assigned' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = rows.filter((r) => {
    if (needle && !`${r.name} ${r.cohort}`.toLowerCase().includes(needle)) return false;
    if (cohort && String(r.cohortId) !== String(cohort)) return false;
    if (!status.includes(r.open ? 'active' : 'ended')) return false;
    if (roleChanged && !(r.open && r.notAdvisor)) return false;
    return true;
  });
  const by2 = {
    assigned: (a, b) => cmp(b.assignedAt, a.assignedAt) || b.id - a.id,
    cohort: (a, b) => b.cohortSort - a.cohortSort || cmp(b.assignedAt, a.assignedAt),
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || cmp(b.assignedAt, a.assignedAt),
  };
  return [...out].sort(by2[sort] || by2.assigned);
}

export const PEOPLE_FOOT = 'Ended access stays on record.';
export const PEOPLE_FOOT_UNREAD = 'Ended access stays on record. Earlier episodes could not be read, so a re-assigned row shows only its latest.';

/** The Assign dialog's cohorts: scheduled or running, not postponed, with their dates. */
export function assignableCohorts(timelineRead) {
  if (!isReady(timelineRead)) return [];
  return (Array.isArray(timelineRead.data?.cycles) ? timelineRead.data.cycles : []).filter(needsMentor)
    .sort((a, b) => (parseStamp(a.start_at) ?? Infinity) - (parseStamp(b.start_at) ?? Infinity))
    .map((c) => ({ id: Number(c.id), label: [cohortName(c), dayRange(c.start_at, c.end_at)].filter(Boolean).join(' · '), cycle: c }));
}

/** A pair that is already active: marked in the dialog, and nothing is sent for it. */
export function isActivePair(assignRead, advisorId, cycleId) {
  const items = isReady(assignRead) && Array.isArray(assignRead.data?.items) ? assignRead.data.items : [];
  return items.some((r) => isOpenRow(r) && Number(r.advisor_user_id) === Number(advisorId) && Number(r.cohort_cycle_id) === Number(cycleId));
}

export const ASSIGN_NOTE_MAX = 1000;
export const ACTIVE_PAIR = 'This mentor already has access to this cohort. Nothing will be sent.';
/** What the mentor reads (`cohortAdvisorAccess.ts`), and when founders are told (until O-FND). */
export const assignGrants = (name, cohort) => `This lets ${name || 'this mentor'} read the names and email addresses of the founders in ${cohort || 'this cohort'}, their week-by-week status and deliverables, who acted on their guidance, and the Lab’s dates.`;
export const ASSIGN_TOLD = 'Founders are told once their first week is recorded, and each can hide from one mentor.';
export const ASSIGNED_DONE = 'Assigned. The mentor sees a founder in that cohort once that founder’s first week is recorded.';
export const NO_PROFILE = 'No advisor profile yet';

/** End access (item 8): the three things the dialog says. */
export const endLines = (name, cohort) => [
  `${name || 'This mentor'} can no longer read ${cohort || 'this cohort'}’s founders.`,
  'Founders who were told they can see this mentor are told the access ended.',
  'The row stays on record, with the date it ended.',
];
export const ENDED_DONE = 'Access ended. The row stays on record.';

/* ------------------------------------------------------------------ *
 * Refer & Earn (items 12–14)
 * ------------------------------------------------------------------ */

/** D957's moves, as `REVIEW_MOVES` (`referralSubmissions.ts`); a test holds the two equal. */
export const REVIEW_MOVES = Object.freeze({
  draft: ['submitted', 'rejected', 'closed'],
  submitted: ['under_review', 'more_info_needed', 'qualified', 'rejected', 'closed'],
  under_review: ['more_info_needed', 'qualified', 'rejected', 'closed'],
  more_info_needed: ['under_review', 'qualified', 'rejected', 'closed'],
  qualified: ['in_conversation', 'rejected', 'closed'],
  in_conversation: ['converted', 'rejected', 'closed'],
  converted: ['reward_eligible', 'closed'],
  reward_eligible: ['reward_issued', 'closed'],
  reward_issued: [], rejected: [], closed: [],
});

/** The statuses the dialog offers: where it stands, then only the moves D957 allows from there. */
export const statusChoices = (status) => [status, ...(REVIEW_MOVES[status] || [])];

export const CONVERTED_STATUSES = Object.freeze(['converted', 'reward_eligible', 'reward_issued']);
export const ALL_TIME = 'All time.';
export const REFER_WEEKS = 12;
export const WEEKS_LINE = `The last ${REFER_WEEKS} weeks, this week so far.`;

/** The field limits D957's review keeps (`reviewSubmission`). */
export const LIMITS = Object.freeze({ nextStep: 240, reward: 120, fitNotes: 2000, note: 2000 });

/**
 * What Save sends (item 14): each field only when it changed, and `status`
 * only when it moved, because the Worker appends a history row whenever
 * `status` is present. The note to the referrer goes only when written.
 * Null when nothing changed.
 */
export function reviewPatch(row, draft) {
  const out = {};
  if (draft.status && draft.status !== row.status) out.status = draft.status;
  const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
  if (!same(draft.nextStep, row.next_step)) out.nextStep = String(draft.nextStep ?? '').trim().slice(0, LIMITS.nextStep) || null;
  if (!same(draft.rewardLabel, row.reward_label)) out.rewardLabel = String(draft.rewardLabel ?? '').trim().slice(0, LIMITS.reward) || null;
  if (!same(draft.fitNotes, row.fit_notes)) out.fitNotes = String(draft.fitNotes ?? '').trim().slice(0, LIMITS.fitNotes) || null;
  const note = String(draft.note ?? '').trim();
  if (note) out.note = note.slice(0, LIMITS.note);
  return Object.keys(out).length ? out : null;
}

export const REVIEW_TOLD = 'The referrer sees this on their page and is not notified.';
export const REVIEW_SAVED = 'Saved. The referrer sees it on their page.';

/** One timeline row: "Under review · 22 Oct", with its note. */
export const timelineRow = (e) => ({ label: e?.label || statusWord(e?.status), when: shortDay(e?.created_at) || NOT_RECORDED, note: e?.note || null });

/**
 * Waiting for review (item 12): each open status's exact total (F1), their
 * sum, and the bands, which come from the oldest 200 open referrals. When
 * the open total is above 200, the bands say what they cover.
 */
export function referWaiting(totals, oldestRead, now) {
  const reads = OPEN_STATUSES.map((s) => totals[s]);
  const state = stateOf(...reads, oldestRead);
  const each = Object.fromEntries(OPEN_STATUSES.map((s) => [s, totalOf(totals[s])]));
  const counted = OPEN_STATUSES.every((s) => each[s] !== null);
  if (state === 'unreadable' || (state === 'ready' && !counted)) return { state: 'unreadable', each };
  if (state !== 'ready') return { state, each };
  const total = OPEN_STATUSES.reduce((t, s) => t + each[s], 0);
  const rows = Array.isArray(oldestRead.data?.items) ? oldestRead.data.items : [];
  return {
    state,
    each,
    total,
    bands: bandCounts(rows, (r) => hoursSince(r.created_at, now)),
    bandsCover: rows.length < total ? `of the oldest ${nf(rows.length)} of ${nf(total)}` : null,
  };
}

/** The weekly chart (F3): one stacked column per week, by category, "Platform user" for `customer`. */
export function referWeeklyChart(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const items = Array.isArray(read.data?.items) ? read.data.items : null;
  if (!items) return { state: 'unreadable' };
  const TONES = { startup: 'violet', customer: 'sky', strategic: 'amber' };
  const rows = items.map((w, i) => {
    const parts = ['startup', 'customer', 'strategic'].map((k) => ({ value: Number(w[k]) || 0, tone: TONES[k] }));
    const value = parts.reduce((t, p) => t + p.value, 0);
    return { label: shortDay(`${w.week}T00:00:00Z`) || w.week, value, parts, toDate: false, last: i === items.length - 1 };
  });
  const total = rows.reduce((t, r) => t + r.value, 0);
  return {
    state: 'ready',
    chart: { type: 'stack', rows },
    legend: [{ label: CATEGORY_WORD.startup, tone: 'violet' }, { label: CATEGORY_WORD.customer, tone: 'sky' }, { label: CATEGORY_WORD.strategic, tone: 'amber' }],
    alt: `Referrals per week for ${rows.length} weeks by category; ${nf(total)} in total.`,
    total,
  };
}

/** The funnel (item 12): no read counts the referrals that reached each stage, so its bars are not drawn. */
export const FUNNEL_REASON = 'No read counts the referrals that reached each stage, so the stages are not drawn. The tags count where referrals stand now.';
export const FUNNEL_TAGS = Object.freeze([
  { key: 'more_info_needed', word: 'More info needed' }, { key: 'rejected', word: 'Rejected' }, { key: 'closed', word: 'Closed' },
]);

/** Once Grant and Decline ship, "No one can be granted access yet." goes from the Overview (item 12). */
export const STRATEGIC_FOOT = 'Strategic and capital introductions are invite-only.';
export const STRATEGIC_EMPTY = 'No member is waiting for strategic referral access.';
export const STRATEGIC_GRANT = 'They can submit strategic and capital introductions once granted. The decision is recorded in the admin audit.';
export const STRATEGIC_DECLINE = 'They cannot submit strategic and capital introductions. The decision is recorded in the admin audit.';
export const STRATEGIC_DONE = { granted: 'Granted. They can submit strategic introductions now.', declined: 'Declined. The request is closed.' };
const roleWord = (r) => (r ? r.charAt(0).toUpperCase() + r.slice(1).toLowerCase() : 'Role not recorded');
export const strategicRow = (x) => ({
  id: Number(x.user_id), name: x.name || 'Name not recorded', role: roleWord(x.role),
  asked: shortDay(x.requested_at) || NOT_RECORDED, note: x.note && String(x.note).trim() ? String(x.note).trim() : null,
});

/** The Queue's filters (item 13): it opens on the open statuses, waiting longest first. */
export const QUEUE_OPEN = 'open';
export const QUEUE_STATUSES = Object.freeze([QUEUE_OPEN, 'all', 'submitted', 'under_review', 'more_info_needed', 'qualified', 'in_conversation', 'converted', 'reward_eligible', 'reward_issued', 'rejected', 'closed']);
export const queueStatusWord = (s) => (s === QUEUE_OPEN ? 'Open' : s === 'all' ? 'All' : statusWord(s));
export function queueParams({ status = QUEUE_OPEN, category = '', sort = 'oldest', page = 0 } = {}) {
  const p = { limit: PAGE_SIZE, offset: page * PAGE_SIZE, sort };
  if (status === QUEUE_OPEN) p.status = OPEN_STATUSES.join(',');
  else if (status !== 'all') p.status = status;
  if (category) p.category = category;
  return p;
}

/* ------------------------------------------------------------------ *
 * Perks (items 15–18)
 * ------------------------------------------------------------------ */

export const PERK_WEEKS = 12;
export const PERK_WEEKS_LINE = `The last ${PERK_WEEKS} weeks, this week so far.`;
export const KIND_WORD = Object.freeze({ credits: 'Credits', tier: 'Included in plan', money: 'Paid to partner' });

/** K2's figures: claims and redeemed, the top eight perks, and claims per week by price type. */
export function perkClaimsFrom(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const d = read.data || {};
  if (!Array.isArray(d.by_listing) || !Array.isArray(d.by_week)) return { state: 'unreadable' };
  const claims = d.by_listing.reduce((t, x) => t + (Number(x.claims) || 0), 0);
  const redeemed = d.by_listing.reduce((t, x) => t + (Number(x.redeemed) || 0), 0);
  const top = d.by_listing.slice(0, 8).map((x) => ({
    key: x.uid, label: x.offer || 'Offer not recorded', value: Number(x.claims) || 0,
    text: `${nf(Number(x.claims) || 0)} · ${nf(Number(x.redeemed) || 0)} redeemed`,
  }));
  const weeks = [...new Set(d.by_week.map((x) => x.week))].sort();
  const TONES = { credits: 'violet', tier: 'sky', money: 'amber' };
  const rows = weeks.map((w) => {
    const parts = ['credits', 'tier', 'money'].map((k) => ({ value: Number(d.by_week.find((x) => x.week === w && x.kind_at_claim === k)?.claims) || 0, tone: TONES[k] }));
    return { label: shortDay(`${w}T00:00:00Z`) || w, value: parts.reduce((t, p) => t + p.value, 0), parts };
  });
  return {
    state: 'ready',
    claims,
    redeemed,
    text: `${nf(claims)} · ${nf(redeemed)} redeemed`,
    top: { chart: { type: 'hbar', rows: top, axis: 'claims' }, alt: top.length ? `Top perks by claims: ${top.map((t) => `${t.label} ${t.value}`).join(', ')}.` : 'No perk was claimed in this window.', empty: !top.length },
    weekly: { chart: { type: 'stack', rows }, alt: `Perk claims per week for ${rows.length} weeks by price type; ${nf(claims)} in total.` },
    legend: ['credits', 'tier', 'money'].map((k) => ({ label: KIND_WORD[k], tone: TONES[k] })),
  };
}

export const CREDITS_HELD_WAITS = 'Members’ balances are stored; the sum across members waits for the owner’s answer on which accounts it covers.';

/** The Queue's filter (item 16): every state, the open one first. */
export const LISTING_STATUSES = Object.freeze(['in_review', 'draft', 'live', 'paused', 'rejected', 'all']);
const LISTING_WORD = { in_review: 'In review', draft: 'Draft', live: 'Live', paused: 'Paused', rejected: 'Rejected', all: 'All' };
export const listingWord = (s) => LISTING_WORD[s] || NOT_RECORDED;

/**
 * What each listing can be asked (D957): Approve and Reject while in review
 * or a draft; Pause, and the feature switch, while live; Approve again
 * (resume) while paused; nothing once rejected, which is final.
 */
export function listingActions(p) {
  if (p?.status === 'in_review' || p?.status === 'draft') return ['approve', 'reject'];
  if (p?.status === 'live') return ['pause', Number(p.featured) ? 'unfeature' : 'feature'];
  if (p?.status === 'paused') return ['approve'];
  return [];
}

export const ACTION_WORD = Object.freeze({ approve: 'Approve', reject: 'Reject', pause: 'Pause', feature: 'Feature', unfeature: 'Stop featuring' });

/**
 * Each action's dialog: what it does, and what it sends. Approve keeps the
 * stored note unless one is typed (N8); Reject needs the note the partner
 * sees and is final; the feature switch is an approve on a live listing,
 * which the Worker treats as an edit of the feature only.
 */
export function listingDialog(action, p) {
  const offer = p?.offer || 'this listing';
  if (action === 'approve') return { title: p?.status === 'paused' ? `Make ${offer} live again?` : `Approve ${offer}?`, lines: ['It goes live on the perks page.', 'The partner sees it is live.'], note: 'optional', feature: true, button: 'Approve' };
  if (action === 'reject') return { title: `Reject ${offer}?`, lines: ['A rejection is final. The partner sees your reason on their listing.'], note: 'required', button: 'Reject', danger: true };
  if (action === 'pause') return { title: `Pause ${offer}?`, lines: ['Members can no longer claim it. Claims already made stay.', 'An admin can make it live again.'], note: 'optional', button: 'Pause' };
  if (action === 'feature') return { title: `Feature ${offer}?`, lines: ['It shows in “Featured this month” on the perks page.'], editorial: true, button: 'Feature' };
  return { title: `Stop featuring ${offer}?`, lines: ['It leaves “Featured this month”. It stays live.'], button: 'Stop featuring' };
}

export function listingBody(action, p, { note = '', editorial = '', featured = false } = {}) {
  const typed = String(note || '').trim();
  if (action === 'reject') return { action: 'reject', review_note: typed };
  if (action === 'pause') return { action: 'pause', ...(typed ? { review_note: typed } : {}) };
  if (action === 'feature' || action === 'unfeature') {
    const body = { action: 'approve', featured: action === 'feature' };
    const line = String(editorial || '').trim();
    if (action === 'feature' && line) body.editorial_note = line;
    return body;
  }
  const body = { action: 'approve', review_note: typed || p?.review_note || '' };
  if (featured) body.featured = true;
  const line = String(editorial || '').trim();
  if (line) body.editorial_note = line;
  return body;
}

export const LISTING_DONE = Object.freeze({
  approve: 'Approved. The listing is live.', reject: 'Rejected. The partner sees your reason on their listing.', pause: 'Paused. Members cannot claim it now.',
  feature: 'Featured. It shows in “Featured this month”.', unfeature: 'It is no longer featured. It stays live.',
});

/** Grant or deduct credits (item 17): the canvas's foot was wrong; the member sees the amount and the note. */
export const CREDITS_FOOT = 'The member sees the amount and the note. The reason is kept in the audit log.';
export const CREDITS_DONE = 'Recorded. The member sees the change on their balance.';

/* ------------------------------------------------------------------ *
 * Learning (items 19–20)
 * ------------------------------------------------------------------ */

/**
 * OD9, as D962 sets it: a content row is Done when a course or an item is
 * `completed`, an exercise's latest submission is `accepted`, and an exam
 * is `passed`. A learner has finished a program when every content row in
 * it is Done; a program with no contents has no one finished.
 */
export function isDone(cell) {
  const s = cell?.status;
  if (cell?.subject_kind === 'exercise') return s === 'accepted';
  if (cell?.subject_kind === 'exam') return s === 'passed';
  return s === 'completed';
}
export const hasFinished = (learner) => Array.isArray(learner?.completion) && learner.completion.length > 0 && learner.completion.every(isDone);

/** Completion by program: each published program's learners (R10), finished by OD9's rule. */
export function completionRows(programs, learnerReads) {
  return programs.map((p) => {
    const read = learnerReads[p.uid];
    if (!read || isLoading(read)) return { uid: p.uid, name: p.name, region: p.region, state: 'loading' };
    if (isFailed(read)) return { uid: p.uid, name: p.name, region: p.region, state: 'unreadable' };
    const learners = Array.isArray(read.data?.learners) ? read.data.learners : [];
    const finished = learners.filter(hasFinished).length;
    return {
      uid: p.uid, name: p.name, region: p.region, state: 'ready', learners: learners.length, finished,
      percent: learners.length ? Math.round((100 * finished) / learners.length) : null,
    };
  });
}

/** Finished: the sum over programs, unreadable if any program's learners could not be read. */
export function finishedTotal(rows) {
  if (rows.some((r) => r.state === 'unreadable')) return { state: 'unreadable' };
  if (rows.some((r) => r.state !== 'ready')) return { state: 'loading' };
  return { state: 'ready', count: rows.reduce((t, r) => t + r.finished, 0) };
}
export const FINISHED_LINE = 'Learners who are Done with every item in a published program: a course or item completed, an exercise accepted, an exam passed.';

/** Enrolled and Enrolments per week (P4), each with its window. */
export function enrolmentsFrom(read) {
  if (isLoading(read)) return { state: 'loading' };
  if (isFailed(read)) return { state: 'unreadable' };
  const d = read.data || {};
  if (!Array.isArray(d.by_week) || !Number.isFinite(Number(d.total))) return { state: 'unreadable' };
  const labels = d.by_week.map((w) => shortDay(`${w.week}T00:00:00Z`) || w.week);
  const values = d.by_week.map((w) => Number(w.count) || 0);
  return {
    state: 'ready',
    total: Number(d.total),
    weeks: Number(d.weeks) || d.by_week.length,
    chart: { type: 'lines', series: [{ label: 'Enrolments', tone: 'violet', values }], labels, currentIndex: labels.length - 1 },
    alt: `Enrolments per week for ${labels.length} weeks; ${nf(Number(d.total))} in total.`,
  };
}
export const enrolledLine = (weeks) => `The last ${weeks} weeks, this week so far. A re-enrolment counts again.`;

/** The learner dialog's rows (item 20): its kind, title, Done or Not yet, and the date it was reached. */
const KIND_LABEL = { course: 'Course', exercise: 'Exercise', exam: 'Exam' };
export function learnerRows(contents, learner) {
  const byUid = new Map((contents || []).map((c) => [`${c.subject_kind}|${c.subject_uid}`, c]));
  return (learner?.completion || []).map((cell) => {
    const c = byUid.get(`${cell.subject_kind}|${cell.subject_uid}`) || {};
    const kind = cell.subject_kind === 'item'
      ? (c.kind === 'video' ? 'Video' : c.kind === 'reading' ? 'Reading' : 'Item')
      : KIND_LABEL[cell.subject_kind] || 'Item';
    const done = isDone(cell);
    const when = cell.subject_kind === 'exam' ? cell.passed_at
      : cell.subject_kind === 'exercise' ? (done ? cell.reviewed_at : null)
        : cell.completed_at;
    const extra = cell.subject_kind === 'exam'
      ? (cell.attempts ? `Best ${cell.best_score_percent === null || cell.best_score_percent === undefined ? NOT_RECORDED.toLowerCase() : `${cell.best_score_percent}%`} · ${plural(cell.attempts, 'attempt', 'attempts')}` : 'No attempt yet')
      : null;
    return {
      key: `${cell.subject_kind}-${cell.subject_uid}`, kind, title: c.title || 'Title not recorded', done,
      word: done ? 'Done' : 'Not yet', date: done ? (shortDay(when) || NOT_RECORDED) : '—', extra,
    };
  });
}
export const LEARNER_FOOT = 'No email is shown here. Progress is read only.';

export { COULD_NOT_READ, NOT_READ_YET, dataOf, stateOf };
