/**
 * D5882 (#5882): the Approvals page's source. `AdminApprovals.jsx` picks the view and draws
 * Inbox, Lanes, Decided, the assignment pieces and the doors from the files beside it, so a
 * test that reads "the page" reads all of them, in this order.
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);

/** The page's files, repository-relative: the page first, then what it draws from. */
export const APPROVALS_PAGE_FILES = Object.freeze([
  'AdminApprovals', 'approvalsUi', 'approvalDoors', 'ApprovalsAssign', 'ApprovalsInbox', 'ApprovalsLanes', 'ApprovalsDecided',
].map((f) => `frontend/src/pages/admin/approvals/${f}.jsx`));

/** The page's source, its files joined. */
export function approvalsPageSource() {
  return APPROVALS_PAGE_FILES.map((f) => readFileSync(new URL(f, ROOT), 'utf8')).join('\n');
}
