// D1337 (#3542, part 2 of the member flow, #3517 and #2318) — what the
// member's Product testing blocks say, kept pure so every state is tested
// without a fetch. The Worker is D1336 (`routes/testing.ts`); the canvas is
// `design/incoming/Product Testing Member Page.dc.html`, PT-M1 to PT-M5.
//
// No email and no other tester's name is ever read or drawn here: the reads
// carry none (D1336 §1), and nothing below would show one if they did.

export const UNREADABLE = 'Could not be read. That isn’t the same as having none.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-17` or an ISO stamp → { d, m, y }; null when it is not a date. */
function parts(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const name = MONTHS.at(Number(m[2]) - 1);
  if (Number(m[2]) < 1 || !name) return null;
  return { d: Number(m[3]), m: name, y: Number(m[1]) };
}

/** "17 Oct 2026", or null. */
export function fmtDate(value) {
  const p = parts(value);
  return p ? `${p.d} ${p.m} ${p.y}` : null;
}

/** "1–15 Nov 2026", "28 Oct – 4 Nov 2026", "28 Dec 2026 – 4 Jan 2027"; one end alone when only one is set; null with neither. */
export function dateRange(from, to) {
  const a = parts(from), b = parts(to);
  if (!a && !b) return null;
  if (!a) return `until ${fmtDate(to)}`;
  if (!b) return `from ${fmtDate(from)}`;
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return a.d === b.d ? `${a.d} ${a.m} ${a.y}` : `${a.d}–${b.d} ${a.m} ${a.y}`;
}

/** An Admin or Super Admin account: no card is drawn and nothing is read (D1335 §3). */
export function isAdminAccount(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'super_admin' || user?.is_super_admin === true || user?.is_super_admin === 1;
}

// ---------------------------------------------------------------------------
// PT-M1: the Studio card
// ---------------------------------------------------------------------------

export const CARD_ACTIONS = Object.freeze({ become: 'become', pool: 'pool', programmes: 'programmes', support: 'support' });

/**
 * The card for the member's pool read (`GET /api/testing/tester`). `kind` is
 * the tester's status, or `none` with no row; `tone` picks the pill; `action`
 * is what its one button opens, or null when the canvas draws none.
 */
export function testerCard(read) {
  const t = read?.tester || { status: null };
  const canApply = read?.can_apply === true;
  const reapply = fmtDate(t.reapply_after);
  switch (t.status) {
    case 'applied':
      return {
        kind: 'applied', pill: 'Waiting on Axal VC', tone: 'wait', title: 'Product tester',
        text: `${t.applied_at && fmtDate(t.applied_at) ? `You applied on ${fmtDate(t.applied_at)}.` : 'You applied.'} An Axal VC admin decides, and you’re told in Inbox.`,
        action: { label: 'View my application', open: CARD_ACTIONS.pool },
      };
    case 'active':
      return {
        kind: 'active', pill: 'Active tester', tone: 'pos', title: 'Product tester',
        text: 'You can apply to open programmes. You choose which ones.',
        action: { label: 'See open programmes', open: CARD_ACTIONS.programmes },
      };
    case 'paused':
      return {
        kind: 'paused', pill: 'Paused', tone: 'mut', title: 'Product tester',
        text: 'You won’t be picked for new programmes. Programmes you’re already in carry on.',
        action: { label: 'View my place', open: CARD_ACTIONS.pool },
      };
    case 'declined': {
      const reason = t.reason ? `Reason given: “${t.reason}”` : 'No reason was recorded.';
      // From `reapply_after` the Worker takes the join again (D1336 §1), and the card says so.
      if (canApply) {
        return {
          kind: 'declined', pill: 'Not approved', tone: 'neg', title: 'Product tester',
          text: `${reason} You can apply again now.`,
          action: { label: 'See what testers do', open: CARD_ACTIONS.become },
        };
      }
      return {
        kind: 'declined', pill: 'Not approved', tone: 'neg', title: 'Product tester',
        text: `${reason} ${reapply ? `You can apply again from ${reapply}.` : 'When you can apply again is not recorded.'}`,
        action: null,
      };
    }
    case 'removed':
      if (t.left_by_member) {
        return {
          kind: 'left', pill: 'Left', tone: 'mut', title: 'Product tester',
          text: 'You left the tester pool. You can join again whenever you like.',
          action: canApply ? { label: 'See what testers do', open: CARD_ACTIONS.become } : null,
        };
      }
      return {
        kind: 'removed', pill: 'Removed', tone: 'mut', title: 'Product tester',
        text: 'You’re no longer in the tester pool. If you think this is wrong, open a ticket with Support.',
        action: { label: 'Open a ticket', open: CARD_ACTIONS.support },
      };
    default:
      return {
        kind: 'none', pill: 'New', tone: 'vio', title: 'Become a Product tester',
        text: 'Try products before they launch and tell the team what works. Usually 1 to 3 hours a week.',
        action: { label: 'See what testers do', open: CARD_ACTIONS.become },
      };
  }
}

/** Whether the member may leave the pool from here (D1336: applied, active or paused). */
export const canLeave = (read) => ['applied', 'active', 'paused'].includes(read?.tester?.status);

/** The Become sheet's availability choices; the Worker takes free text, at most 1,000 characters. */
export const AVAILABILITY = ['1 hour a week', '2 hours a week', '3 hours a week', 'More than 3 hours a week'];

/** The body for `POST /api/testing/tester/apply`, or null until consent is ticked. */
export function joinBody(read, { agreed, availability }) {
  const version = read?.consent?.version;
  if (!agreed || !version) return null;
  return { consentVersion: version, availability: AVAILABILITY.includes(availability) ? availability : null };
}

// ---------------------------------------------------------------------------
// PT-M2: open programmes
// ---------------------------------------------------------------------------

/** "6 of 20 left". */
export const placesLine = (p) => (Number.isFinite(Number(p?.places)) && Number.isFinite(Number(p?.places_left))
  ? `${Number(p.places_left)} of ${Number(p.places)} left` : 'Not recorded');

/** One row of Open programmes. */
export function programmeRow(p) {
  return {
    uid: p.uid,
    product: p.product_name || 'Untitled programme',
    firm: p.owner_name || 'Not recorded',
    asks: p.summary || p.tester_tasks || 'Not described yet.',
    dates: dateRange(p.testing_starts, p.testing_ends) || 'Dates not set',
    places: placesLine(p),
    applied: p.my_status != null && p.my_status !== 'withdrawn',
    mine: p.my_status ?? null,
  };
}

/** The Apply body for one programme: one answer per question, each trimmed, every one required. */
export function applyBody(programme, answers, consentEmail) {
  const qs = Array.isArray(programme?.questions) ? programme.questions : [];
  const out = qs.map((_, i) => String(answers?.[i] ?? '').trim());
  if (out.some((a) => !a || a.length > 2000)) return null;
  return { answers: out, consentEmail: consentEmail === true };
}

// ---------------------------------------------------------------------------
// PT-M3: my applications
// ---------------------------------------------------------------------------

/** Applied or picked, on a programme not yet finished: the one state Withdraw is offered on. */
export const isOpenApplication = (a) => a?.status === 'applied' || (a?.status === 'picked' && !a?.finished);

/** One row of My applications: the pill, its tone, and the line beside it. */
export function applicationRow(a) {
  const firm = a.owner_name || 'the firm';
  const when = fmtDate(a.updated_at);
  const testing = dateRange(a.testing_starts, a.testing_ends);
  let pill, tone, line;
  if (a.finished) {
    pill = 'Finished'; tone = 'vio'; line = testing ? `Programme closed · tested ${testing}` : 'Programme closed';
  } else if (a.status === 'picked') {
    pill = 'Picked'; tone = 'pos'; line = testing ? `Testing ${testing}` : 'Testing dates not set yet';
  } else if (a.status === 'applied') {
    const by = fmtDate(a.decides_by);
    pill = 'Applied'; tone = 'wait'; line = `Waiting on ${firm}${by ? ` · decides by ${by}` : ''}`;
  } else if (a.status === 'declined') {
    pill = 'Declined'; tone = 'mut'; line = `Not picked this time${when ? ` · ${when}` : ''}`;
  } else if (a.status === 'withdrawn') {
    pill = 'Withdrawn'; tone = 'mut';
    const who = a.withdrawn_by === 'hq' ? 'Withdrawn for you by HQ' : a.withdrawn_by === 'member' ? 'You withdrew' : 'Withdrawn';
    line = `${who}${when ? ` · ${when}` : ''}`;
  } else {
    pill = 'Not recorded'; tone = 'mut'; line = 'This application’s state is not recorded.';
  }
  return {
    uid: a.uid, product: a.product_name || 'Untitled programme', firm: a.owner_name || 'Not recorded',
    pill, tone, line, canWithdraw: isOpenApplication(a),
  };
}

/** The confirm before Withdraw (PT-M3). The second sentence is D1336 §5's rule, not the canvas's (D1337 §2). */
export const withdrawQuestion = (name) => `Withdraw from ${name}? The firm is told. You can’t apply to this programme again.`;
/** What the sheet says once it is done. */
export const withdrawnNote = (a) => `You withdrew from ${a.product_name || 'this programme'}. ${a.owner_name || 'The firm'} has been told.`;

/** The question and answer pairs for "Your answers"; a question with no answer reads "Not answered". */
export function answerPairs(a) {
  const qs = Array.isArray(a?.questions) ? a.questions : [];
  const as = Array.isArray(a?.answers) ? a.answers : [];
  const n = Math.max(qs.length, as.length);
  return Array.from({ length: n }, (_, i) => ({ q: qs[i] || `Question ${i + 1}`, a: as[i] ? String(as[i]) : 'Not answered' }));
}

// ---------------------------------------------------------------------------
// PT-M4: Inbox
// ---------------------------------------------------------------------------

const APPLICATION_NOTICES = new Set(['testing_applied', 'testing_picked', 'testing_not_picked', 'testing_withdrawn', 'testing_programme_closed']);

/**
 * Which sheet a notice opens: `{ kind: 'application', programmeUid, applicationUid }`
 * for a member's testing notice (those link `/inbox`; the firm's own of the
 * same type link nothing), `{ kind: 'pool' }` for HQ's tester-status notice,
 * else null and the notice behaves as before.
 */
export function noticeTarget(n) {
  const type = String(n?.type || '');
  if (APPLICATION_NOTICES.has(type) && n?.link === '/inbox' && n?.payload?.programme_uid) {
    return { kind: 'application', programmeUid: String(n.payload.programme_uid), applicationUid: n.payload.application_uid ? String(n.payload.application_uid) : null };
  }
  if (type.startsWith('product_tester_')) return { kind: 'pool' };
  return null;
}

/** The member's application a notice names: by its uid when the notice carries one, else by its programme. */
export function applicationFor(target, applications) {
  if (!target || target.kind !== 'application' || !Array.isArray(applications)) return null;
  return (target.applicationUid && applications.find((a) => a.uid === target.applicationUid))
    || applications.find((a) => a.programme_uid === target.programmeUid) || null;
}

/** A refusal's sentence from a thrown request error (`request()` puts the Worker's in `message`), else the fallback. */
export function refusalText(err, fallback) {
  const m = typeof err?.message === 'string' ? err.message.trim() : '';
  return err?.status && m && m !== 'Request failed' ? m : fallback;
}

/** The Worker's refusal code from a thrown request error, or null. */
export const refusalCode = (err) => err?.code || null;
