/**
 * #4843 part 2 (D4843-p2, Offers v2 boards OF-06 and OF-09c): a testing programme's place in its
 * lifecycle and the one next action its state calls for. Pure, so
 * `frontend/test/offers_testing_of06_4843.test.mjs` loads it alone.
 *
 * The Worker's seven statuses (`PROGRAMME_STATUSES`, services/testing.ts) fold into the board's five
 * steps, as the canvas's backend-fit table (OF-10) says: submitted and approved are both HQ review,
 * open is Recruiting, closed is Complete. A programme HQ sent back is a draft again, marked as sent back.
 *
 * What the read carries and what it does not: `applicant_count` counts every application not withdrawn,
 * and `picked_count` the picked ones. No count says how many still wait for a decision, so a card
 * says "3 applicants · 1 picked", never "3 applicants need review". No results record exists either,
 * so a complete programme offers its testers, not "results".
 */

/** The board's five steps, in order. */
export const LIFECYCLE = ['Draft', 'HQ review', 'Recruiting', 'Testing', 'Complete'];

const STEP = { draft: 0, rejected: 0, submitted: 1, approved: 1, open: 2, testing: 3, closed: 4 };

/** The step a status sits on, or -1 for a status the Worker does not send. */
export const stepOf = (status) => (Object.prototype.hasOwnProperty.call(STEP, status) ? STEP[status] : -1);

/** The step's word, with a sent-back draft named as such. */
export function stageLabel(status) {
  if (status === 'rejected') return 'Sent back';
  const i = stepOf(status);
  return i < 0 ? 'Unknown status' : LIFECYCLE[i];
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "3 applicants · 1 picked", from the read's own counts; "No applicants yet" at zero. */
export function applicantsLine(p) {
  const applied = Math.max(0, Number(p?.applicant_count) || 0);
  const picked = Math.max(0, Number(p?.picked_count) || 0);
  if (applied === 0) return 'No applicants yet';
  return `${plural(applied, 'applicant', 'applicants')} · ${picked} picked`;
}

/**
 * What the card asks of the owner now: `{ title, line, action, label, primary }`. `action` is one of
 * `submit`, `edit`, `applicants`, or null while the programme waits on HQ.
 */
export function nextStep(p) {
  const picked = Math.max(0, Number(p?.picked_count) || 0);
  switch (p?.status) {
    case 'draft':
      return p?.owner_kind === 'hq'
        ? { title: 'Draft', line: 'HQ opens its own programmes.', action: null, label: null, primary: false }
        : { title: 'Waiting for you', line: 'Submit it to HQ when it is ready.', action: 'submit', label: 'Submit for approval', primary: true };
    case 'rejected':
      return { title: 'Sent back by HQ', line: p?.review_note ? `HQ: ${p.review_note}` : 'HQ sent it back without a note.', action: 'edit', label: 'Edit and resubmit', primary: true };
    case 'submitted':
      return { title: 'Waiting for HQ', line: 'HQ approves it or sends it back. You will hear in the bell.', action: null, label: null, primary: false };
    case 'approved':
      return { title: 'Waiting for HQ', line: 'Approved. HQ opens it to applicants.', action: null, label: null, primary: false };
    case 'open':
      return { title: applicantsLine(p), line: 'Members apply from their dashboard; you pick the testers.', action: 'applicants', label: 'Review applicants', primary: true };
    case 'testing':
      return { title: `${plural(picked, 'tester', 'testers')} testing`, line: 'Testing is under way.', action: 'applicants', label: 'Continue testing', primary: true };
    case 'closed':
      return { title: 'Complete', line: `${plural(picked, 'tester', 'testers')} took part.`, action: 'applicants', label: 'View testers', primary: false };
    default:
      return { title: 'Unknown status', line: 'Reload the list.', action: null, label: null, primary: false };
  }
}

/** The lifecycle strip's cells: each step done, current or to come. */
export function lifecycleCells(status) {
  const at = stepOf(status);
  return LIFECYCLE.map((label, i) => ({ label, state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo' }));
}

/** Programmes in the order the page lists them: the owner's work first, then by step, then by name. */
const RANK = { rejected: 0, draft: 1, open: 2, testing: 3, submitted: 4, approved: 5, closed: 6 };
export function programmeOrder(items) {
  const list = Array.isArray(items) ? [...items] : [];
  const r = (p) => (Object.prototype.hasOwnProperty.call(RANK, p?.status) ? RANK[p.status] : 7);
  return list.sort((a, b) => r(a) - r(b) || String(a?.product_name || '').localeCompare(String(b?.product_name || '')));
}
