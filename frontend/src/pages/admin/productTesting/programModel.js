/**
 * D1203 (#3153, part 8 of #2382) — one program (TST5, TST6) and the
 * Applicants tab (TST8), pure: every figure is derived here from a read, so
 * the tests read it without a browser.
 *
 * WHAT IS READ:
 *   - `GET /api/admin/testing/programmes` → the program itself (places,
 *     picked, dates, status);
 *   - `GET /api/admin/testing/programmes/:uid/events` (D1197) → the stepper's
 *     dates, the partner's review lines and Activity;
 *   - `GET /api/admin/testing/programmes/:uid/applicants` (D1197, D1200) →
 *     the applicants, each with `tester`; `can_decide` false on a partner's;
 *   - `GET /api/admin/testing/applications` (D1197; D1203 adds `scope` and
 *     `counts`) → the withdrawn on one program, and the Applicants tab;
 *   - `GET /api/admin/testing/overview` (D1196) → Reachable by Mail.
 *
 * THE RULES. Never an email address. A value nothing recorded reads "Not
 * recorded", never 0. A read that failed says so where its figure would be.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { APPLICATION_LABEL, ROLE_OPTIONS } from '../../testing/programmeModel';
import { profileWord } from './productTestingModel';

export { NOT_RECORDED };
export const PARTNER_LINE = (firm) => `${firm || 'The partner firm'} picks its testers. HQ can read this list, not change it.`;
export const MAIL_LINE = 'Testers hear from you through Axal VC Mail. No email address is shown here.';
export const BOTH_LINE = 'An applicant applied to one program. A tester is in the pool. Someone can be both.';
export const STEPS_PAGE_SIZE = 100;
export const STEPS_PAGES_MAX = 10;

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const ms = (v) => {
  if (!v) return null;
  const s = String(v);
  const t = Date.parse(s.includes('T') ? s : s.length <= 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : null;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "16 Oct 2026" from a date or a stamp, in UTC; programme dates are date-only, which `dayOf` does not read. */
const day = (v) => { const t = ms(v); if (t == null) return null; const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

// ─────────────────────────────────────────────────────────── the stepper

/** The steps a program passes, by owner; each one's date is its event's in the history. */
const STEP = {
  draft: { label: 'Draft', action: 'created' },
  submitted: { label: 'Waiting for HQ', action: 'submitted' },
  approved: { label: 'Approved', action: 'approved' },
  open: { label: 'Open', action: 'opened' },
  testing: { label: 'Testing', action: 'testing_started' },
  closed: { label: 'Closed', action: 'closed' },
};
export const HQ_STEPS = ['draft', 'open', 'testing', 'closed'];
export const PARTNER_STEPS = ['draft', 'submitted', 'approved', 'open', 'testing', 'closed'];

/**
 * TST5's "Where it stands": each step done, now or next, with the day its
 * event was recorded. A done step whose event is not in the history reads
 * "Date not recorded"; Testing, when next, gives the day its dates say.
 * A program HQ sent back stands at Waiting for HQ, sent back.
 */
export function stepsFor(p, events = []) {
  if (!p) return [];
  const order = p.owner_kind === 'hq' ? HQ_STEPS : PARTNER_STEPS;
  const status = p.status === 'rejected' ? 'submitted' : p.status;
  const at = order.indexOf(status);
  const when = (action) => {
    const hits = (Array.isArray(events) ? events : []).filter((e) => e?.action === action).map((e) => e.at).filter(Boolean).sort();
    return hits.length ? hits[hits.length - 1] : null;
  };
  return order.map((key, i) => {
    const state = at < 0 ? 'next' : i < at ? 'done' : i === at ? 'now' : 'next';
    const recorded = when(STEP[key].action);
    let note = null;
    if (state !== 'next') note = recorded ? day(recorded) : 'Date not recorded';
    else if (key === 'testing' && p.testing_starts) note = `Dates say ${day(p.testing_starts)}`;
    if (key === 'submitted' && p.status === 'rejected') note = `Sent back${recorded ? ` · ${day(when('rejected') || recorded)}` : ''}`;
    return { key, label: STEP[key].label, state, note };
  });
}

/** TST5's foot: an open program whose testing dates have begun stays Open until someone moves it. */
export function stepsFoot(p, now = Date.now()) {
  const t = ms(p?.testing_starts);
  if (p?.status !== 'open' || t == null || t > now) return null;
  return `Its dates say testing began on ${day(p.testing_starts)}. It stays Open until someone moves it to Testing.`;
}

/** TST6's Review card on a partner's program: sent, approved or sent back, and opened, from the history. */
export function reviewLines(p, events = []) {
  if (!p || p.owner_kind === 'hq') return [];
  const list = (Array.isArray(events) ? events : []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const by = (e) => (e.actor?.name ? ` by ${e.actor.name}` : '');
  const out = [];
  for (const e of list) {
    if (e.action === 'submitted') out.push(`Sent ${day(e.at)}${by(e)}.`);
    if (e.action === 'approved') out.push(`Approved ${day(e.at)}${by(e)}.`);
    if (e.action === 'rejected') out.push(`Sent back ${day(e.at)}${by(e)}${e.detail?.note ? `: ${e.detail.note}` : '.'}`);
    if (e.action === 'opened') out.push(`Opened ${day(e.at)}.`);
  }
  return out;
}

// ─────────────────────────────────────────────────────────── the four mini stats

/**
 * TST5's four stats. `applicants` is the applicants read (or null when it
 * failed), `withdrawn` the withdrawn count (or null), `reach` D1196's
 * mail_reach block (or null when the overview failed).
 */
export function miniStats(p, { applicants = null, withdrawn = null, reach = null } = {}) {
  const items = Array.isArray(applicants?.items) ? applicants.items : null;
  const places = num(p?.places);
  const picked = num(p?.picked_count) ?? 0;
  const consented = items ? items.filter((a) => a.consented).length : null;
  const row = Array.isArray(reach?.programmes) ? reach.programmes.find((r) => r.uid === p?.uid) : undefined;
  return [
    {
      key: 'places', label: 'Places filled',
      value: places && places > 0 ? `${picked} of ${places}` : NOT_RECORDED,
      sub: places && places > 0 ? `${Math.max(0, places - picked)} ${places - picked === 1 ? 'place' : 'places'} left` : 'Places are not recorded for this program',
    },
    {
      key: 'applicants', label: 'Applicants',
      value: items ? String(items.length) : 'Unreadable',
      sub: withdrawn == null ? 'Withdrawn could not be read' : `${withdrawn} withdrawn, not counted`,
    },
    {
      key: 'consented', label: 'Agreed to email',
      value: consented == null ? 'Unreadable' : String(consented),
      sub: items ? `of ${items.length} ${items.length === 1 ? 'applicant' : 'applicants'}` : 'The applicants could not be read',
    },
    {
      key: 'reach', label: 'Reachable by Mail',
      value: reach == null ? 'Unreadable' : row ? `${num(row.reachable) ?? 0} of ${num(row.picked) ?? 0}` : NOT_RECORDED,
      sub: reach == null ? 'The overview could not be read' : row ? 'picked testers' : 'Counted for open programs only',
    },
  ];
}

/** The details card's facts, in the canvas's order. A field nobody filled is left out, never "0". */
export function programmeFacts(p) {
  if (!p) return [];
  const roles = (Array.isArray(p.eligible_roles) ? p.eligible_roles : []).map((r) => ROLE_OPTIONS.find(([k]) => k === r)?.[1] || r).join(', ');
  const span = (a, z) => (a || z ? `${day(a) || NOT_RECORDED} – ${day(z) || NOT_RECORDED}` : NOT_RECORDED);
  return [
    p.summary ? { k: 'Summary', v: p.summary } : null,
    p.tester_tasks ? { k: 'What testers do', v: p.tester_tasks } : null,
    p.time_needed ? { k: 'Time needed', v: p.time_needed } : null,
    { k: 'Who can apply', v: roles || 'No role chosen' },
    (p.questions || []).length ? { k: 'Screening questions', v: p.questions.map((q, i) => `${i + 1}. ${q}`).join('  ') } : null,
    { k: 'Places', v: num(p.places) && p.places > 0 ? String(p.places) : NOT_RECORDED },
    { k: 'Applications', v: span(p.opens_at, p.closes_at) },
    { k: 'Testing', v: span(p.testing_starts, p.testing_ends) },
  ].filter(Boolean);
}

// ─────────────────────────────────────────────────────────── Activity

/** One history row in words; an actor whose account is gone is "An account no longer here". */
export function eventLine(e) {
  const who = e?.actor?.name || (e?.actor ? 'Someone' : 'An account no longer here');
  const them = e?.applicant_name || 'an applicant';
  switch (e?.action) {
    case 'created': return `Created by ${who}`;
    case 'edited': return `Edited by ${who}`;
    case 'submitted': return `Sent to HQ by ${who}`;
    case 'approved': return `Approved by ${who}`;
    case 'rejected': return `Sent back by ${who}${e.detail?.note ? `: ${e.detail.note}` : ''}`;
    case 'opened': return `Opened by ${who}`;
    case 'testing_started': return `Moved to testing by ${who}`;
    case 'closed': return `Closed by ${who}`;
    case 'applied': return `${them} applied`;
    case 'withdrawn': return `${them} withdrew`;
    case 'withdrawn_by_hq': return `${who} withdrew ${them}’s application${e.detail?.reason ? `: ${e.detail.reason}` : ''}`;
    case 'picked': return `${who} picked ${them}`;
    case 'declined': return `${who} declined ${them}`;
    default: return `${String(e?.action || 'A change').replace(/_/g, ' ')} by ${who}`;
  }
}

/** "14 Oct 2026, 16:20" in UTC, the history's own clock. */
export function whenLine(v) {
  const t = ms(v);
  if (t == null) return NOT_RECORDED;
  const d = new Date(t);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

// ─────────────────────────────────────────────────────────── one program's applicants

export const APPLICANT_SORTS = [['newest', 'Applied, newest first'], ['oldest', 'Applied, oldest first'], ['name', 'Name']];
export const STATUS_FILTERS = [['', 'Every status'], ['applied', 'Applied'], ['picked', 'Picked'], ['declined', 'Not this time']];

/**
 * The applicants as the table draws them, filtered and sorted in the page:
 * one program's list is read whole. Search is the name, from two characters.
 */
export function applicantsView(items = [], { status = '', role = '', consented = '', q = '', sort = 'newest' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const rows = (Array.isArray(items) ? items : [])
    .filter((a) => !status || a.status === status)
    .filter((a) => !role || a.role === role)
    .filter((a) => consented === '' || (consented === 'yes') === Boolean(a.consented))
    .filter((a) => needle.length < 2 || String(a.name || '').toLowerCase().includes(needle))
    .map((a) => ({
      uid: a.uid, raw: a,
      name: String(a.name || '').trim() || 'Name not recorded',
      profile: profileWord(a.role),
      applied: day(a.applied_at) || NOT_RECORDED,
      appliedAt: a.applied_at || '',
      status: APPLICATION_LABEL[a.status] || a.status,
      statusKey: a.status,
      consented: a.consented ? 'Yes' : 'No',
      availability: a.availability || 'Not given',
      // D1200: null when the pool could not be read, so neither a badge nor its absence is claimed.
      tester: a.tester === true ? 'yes' : a.tester === false ? 'no' : 'unknown',
      answers: Array.isArray(a.answers) ? a.answers : [],
    }));
  const byName = (x, y) => x.name.localeCompare(y.name, 'en', { sensitivity: 'base' });
  if (sort === 'name') rows.sort(byName);
  else if (sort === 'oldest') rows.sort((x, y) => x.appliedAt.localeCompare(y.appliedAt));
  else rows.sort((x, y) => y.appliedAt.localeCompare(x.appliedAt));
  return { rows, searching: needle.length >= 2, tooShort: needle.length === 1 };
}

/** The answers panel: each question with its answer, or "No answer recorded". */
export function answersOf(questions = [], answers = []) {
  return (Array.isArray(questions) ? questions : []).map((q, i) => ({ q, a: (Array.isArray(answers) && String(answers[i] || '').trim()) || 'No answer recorded' }));
}

// ─────────────────────────────────────────────────────────── the Applicants tab (TST8)

export const SCOPES = [['open', 'Open programs'], ['all', 'All programs']];
export const STATUS_CHIPS = [['', 'All'], ['applied', 'Applied'], ['picked', 'Picked'], ['declined', 'Not this time'], ['withdrawn', 'Withdrawn']];

/**
 * The chips over TST8's list, from the read's `counts`. "All" is every status
 * but Withdrawn, as the list's default is; Withdrawn says it is not in All.
 */
export function statusChips(counts) {
  const c = counts && typeof counts === 'object' ? counts : null;
  const n = (k) => (c && Number.isFinite(Number(c[k])) ? Number(c[k]) : null);
  const all = c ? (n('applied') ?? 0) + (n('picked') ?? 0) + (n('declined') ?? 0) : null;
  return STATUS_CHIPS.map(([key, label]) => ({
    key, label: key === 'withdrawn' ? `${label} · not in All` : label,
    count: key === '' ? all : n(key),
  }));
}

/** One TST8 row; an Axal VC program says so, a partner's names its firm. */
export function applicationRow(a) {
  const hq = a?.programme?.owner_kind === 'hq';
  return {
    uid: a.uid, raw: a,
    name: String(a.name || '').trim() || 'Name not recorded',
    profile: profileWord(a.role),
    tester: a.in_pool === true,
    programme: a.programme?.product_name || 'Program name not recorded',
    programmeUid: a.programme?.uid || null,
    owner: hq ? 'Axal VC' : (a.programme?.owner_name || 'Partner not recorded'),
    hq,
    applied: day(a.applied_at) || NOT_RECORDED,
    status: APPLICATION_LABEL[a.status] || a.status,
    statusKey: a.status,
    consented: a.consented ? 'Yes' : 'No',
  };
}

/** "1–25 of 48", from the read's page, size and total. */
export function rangeLine(page, size, total, shown) {
  if (!total) return '0 of 0';
  const from = (page - 1) * size + 1;
  return `${from}–${from + shown - 1} of ${total}`;
}
