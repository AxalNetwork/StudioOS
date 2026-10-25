/**
 * D940 (#2745) — the words of the two refusal cards on admin pages (SHL7a and
 * SHL7b of the owner's "Admin page header" canvas), kept pure for the tests.
 *
 * SHL7a is what a studio admin sees on a page only the Super Admin opens
 * (`hqOnly` in App.jsx). Its first sentence names what HQ manages on that
 * page; `hqOnly` passes no subject, so the notice reads its own path, and a
 * page with no named subject says "HQ manages this page."
 *
 * SHL7b is what a member who is not an admin sees on an `/admin/*` page,
 * instead of being sent home with no word.
 */

export const HQ_EYEBROW = 'HQ only';

/** Payments and its sub-addresses (D1008, D1012). */
const PAYMENTS_PATH = /^\/admin\/platform\/payments(\/|$)/;
export const HQ_TITLE = 'This page belongs to the Super Admin';
export const HQ_REST = 'You are signed in as a studio admin, so this page stays closed rather than opening and refusing each action.';

/** What HQ manages on each HQ-only page, by its path; the canvas names bank accounts for Funds. */
const SUBJECTS = [
  [/^\/admin\/funds(\/|$)/, 'HQ manages bank accounts.'],
  // D1012 (#2831): PAY11, Payments' closed card.
  [PAYMENTS_PATH, 'HQ sets what members pay.'],
];

export function hqLine(pathname = '') {
  const hit = SUBJECTS.find(([re]) => re.test(String(pathname)));
  return `${hit ? hit[1] : 'HQ manages this page.'} ${HQ_REST}`;
}

export const HQ_LINKS = [
  { label: 'Go to Studio', href: '/studio', primary: false },
  { label: 'My licence', href: '/admin/my-licence', primary: false },
];

/** D1012 (#2831): PAY11 sends a studio admin on Payments to Studio or the public pricing page. */
export const PAYMENTS_LINKS = [
  { label: 'Go to Studio', href: '/studio', primary: false },
  { label: 'See the public pricing page', href: '/pricing', primary: false },
];

/** The card's links for a path: Payments' own, else Studio and My licence. */
export const hqLinks = (pathname = '') => (PAYMENTS_PATH.test(String(pathname)) ? PAYMENTS_LINKS : HQ_LINKS);

export const ADMIN_TITLE = 'This page is for studio admins';
export const ADMIN_LINE = 'If you run a studio, ask HQ for admin access.';
export const ADMIN_HOME_LABEL = 'Go to your home';

/** An `/admin` address: the console itself or any page under it. */
export const ADMIN_PATH = /^\/admin(\/|$)/;

/**
 * Whether RoleGuard draws SHL7b instead of its redirect: an `/admin/*` page,
 * refused to a signed-in member whose own account is not an admin. A real
 * admin previewing another role (View as) and an admin impersonating a member
 * keep today's redirect, which also carries the impersonation handoff.
 */
export function adminRefusal({ pathname, realRole, isImpersonating }) {
  return ADMIN_PATH.test(String(pathname || '')) && !isImpersonating && !!realRole && realRole !== 'admin';
}
