/**
 * D1414 (#3696) — THE SEAM between Incorporate and what is not on main yet,
 * in `agentsAdapter.js`'s style (D1497). Each answers `{ available: true,
 * value }` or `{ available: false, reason, waitsOn }`. A body changes when its
 * route lands; nothing else does.
 *
 *   #3855  orderCompany  the company an order created or filled. Owner answer
 *                        Q9: the company appears at payment, marked "Filing
 *                        in progress", and the UI follows `company_uid` when
 *                        the order carries it. `GET /api/legal/incorporate/
 *                        status` does not carry it yet (D1415 part 3), so
 *                        "Open company" and "now appears in Portfolio" are
 *                        not drawn, never promised.
 *   #3706  askPanel      the Ask panel and its quote. Until it exists the Ask
 *                        button draws nothing (Team's `AskButton`, D1497), and
 *                        no field trigger is drawn.
 */

export const unavailable = (reason, waitsOn) => ({ available: false, reason, waitsOn });

/** The order's company, when the order names one (`company_uid`). */
export function orderCompany(order) {
  if (order && order.company_uid) return { available: true, value: { uid: order.company_uid, name: order.company_name || null } };
  return unavailable('The company is linked when the order carries it.', '#3855');
}

/** The Ask panel on Incorporate's steps. */
export const askPanel = () => unavailable('Ask opens when its panel is built.', '#3706');

/** D6688: an order has exactly one subject. A new company still starts with a project. */
export function orderSubject(companyUid, projectId) {
  if (companyUid) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(companyUid)) throw new Error('Choose a recorded company.');
    return { company_uid: companyUid };
  }
  if (!Number.isSafeInteger(Number(projectId)) || Number(projectId) < 1) throw new Error('Choose a recorded project.');
  return { project_id: Number(projectId) };
}

export function startSubjects(companies, projects) {
  const admin = row => !row.archived_at && (row.is_primary_admin || ['Owner', 'Admin', 'Founder'].includes(row.my_role));
  const mine = (projects || []).filter(row => row.my_seat === 'owner' && row.company_id == null && !row.company_uid);
  const managed = (companies || []).filter(admin);
  return {
    companies: managed.filter(row => row.formation_state === 'not_incorporated'),
    projects: mine.filter(row => row.formation_state === 'not_incorporated'),
    excluded: [...managed, ...mine].filter(row => ['in_formation', 'incorporated'].includes(row.formation_state)).length,
    unreadable: [...managed, ...mine].some(row => !['not_incorporated', 'in_formation', 'incorporated'].includes(row.formation_state)),
  };
}
