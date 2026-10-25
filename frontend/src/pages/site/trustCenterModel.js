/**
 * D1072 (#2425) — the public trust center's pure rules: its tabs and
 * addresses, the facts each tab may state, and what is not recorded yet. No
 * React here, so `node --test` loads it alone.
 *
 * Every fact below is one the code on `main` shows (D1072 §2 names the file
 * for each). None carries a "Checked" date yet: the dated content store is
 * part 3's, so each says "Checked: Not recorded". Nothing here is a
 * certification, an audit or a figure the platform does not hold.
 */

import { NOT_RECORDED } from '../../lib/absence.js';

export const TITLE = 'How we protect your data and your money';
export const LINE = 'Facts we can show. Anything we cannot show yet says Not recorded.';
export { NOT_RECORDED };
export const CHECKED_WAIT = 'Checked: Not recorded';

export const TABS = [
  { id: 'overview', label: 'Overview', path: '/trust' },
  { id: 'security', label: 'Security', path: '/trust/security' },
  { id: 'data', label: 'Data and privacy', path: '/trust/data' },
  { id: 'subprocessors', label: 'Subprocessors', path: '/trust/subprocessors' },
  { id: 'documents', label: 'Documents', path: '/trust/documents' },
  { id: 'disclosure', label: 'Disclosure', path: '/trust/disclosure' },
];

/** The signed-in member's own part, kept at its own address (owner question 1, read from the canvas). */
export const YOUR_TRUST = { id: 'me', label: 'Your trust', path: '/trust/me' };

export const PUBLIC_PATHS = TABS.map((t) => t.path);

/** The tab an address names; any other address under /trust is the overview. */
export const tabOf = (pathname = '') => (TABS.find((t) => t.path === String(pathname).replace(/\/+$/, '')) || TABS[0]).id;

/** One line per status, from `/api/public/status`'s overall state. */
export function statusLine(overall) {
  switch (overall) {
    case 'operational': return 'All systems operational';
    case 'degraded': return 'Some systems degraded';
    case 'down': return 'A major outage is reported';
    default: return 'Status not known';
  }
}

/** A fact the code shows, or one it does not (`missing`), with the line that says what is missing. */
const fact = (text) => ({ text, recorded: true });
const missing = (text, why) => ({ text, recorded: false, why });

export const SECURITY = [
  { title: 'Hosting and network', facts: [
    fact('One production deployment, on a global edge network.'),
    fact('HTTPS only, with HSTS for two years and preload.'),
    fact('Pages cannot be framed by other sites.'),
    fact('A content security policy limits what scripts can run.'),
  ] },
  { title: 'Signing in', facts: [
    fact('Password plus an authenticator app.'), fact('Passkeys.'), fact('Sign in with Google.'), fact('SMS codes.'), fact('Account recovery.'),
  ] },
  { title: 'Inside the team', facts: [
    fact('Sensitive admin actions ask for a fresh code.'),
    fact('Admin actions are written to an audit log.'),
  ] },
  { title: 'Encryption', facts: [
    fact('Phone numbers, connector credentials, due-diligence files and signed documents are encrypted with AES-GCM before storage.'),
    missing('Storage-level encryption by our host', 'Not stated by us yet.'),
  ] },
  { title: 'Backups and recovery', facts: [
    fact('Backups: a backups bucket is bound to the platform.'),
    missing('Last recovery drill', 'No drill date is published yet.'),
  ] },
  { title: 'Testing', facts: [
    missing('Independent penetration test', 'None is on record.'),
    fact('Certifications: none held.'),
  ] },
];

export const DATA = [
  fact('Axal VC Management LLC is the data controller.'),
  fact('No third-party analytics run on the platform.'),
  fact('You are told of a significant breach within 30 days of it being found.'),
  fact('You can download your data or ask to delete your account from your account settings.'),
];

export const SUBPROCESSORS_WAIT = 'Our subprocessor list is being reviewed by counsel. Ask privacy@axal.vc for it.';

/** Severity, acknowledgement, updates, fix target: SECURITY.md's Response SLAs. */
export const RESPONSE_TIMES = [
  ['Critical', '4 business hours', 'every 24 hours', '7 days'],
  ['High', '1 business day', 'every 3 business days', '30 days'],
  ['Medium', '3 business days', 'weekly', '90 days'],
  ['Low', '5 business days', 'at milestones', 'best effort'],
];

export const DISCLOSURE_GAPS = [
  missing('PGP key', 'Ask by email and we reply with one.'),
  missing('Researchers we thank', 'No report has been credited yet.'),
  missing('Report a security issue in the app', 'Not built yet. Use the private advisory or email.'),
];

/** The documents and their last update, from the legal pages' own dates; a version is not recorded yet. */
export function documentRows({ terms, privacy, risk }) {
  return [
    { name: 'Terms of Service', to: '/terms', updated: terms || null, appliesTo: 'Everyone' },
    { name: 'Privacy Policy', to: '/privacy', updated: privacy || null, appliesTo: 'Everyone' },
    { name: 'Risk Disclosures', to: '/risk-disclosures', updated: risk || null, appliesTo: 'Investors' },
    { name: 'Interview notice', to: '/privacy/interviews', updated: null, appliesTo: 'Recorded sessions' },
    { name: 'Data Processing Addendum', to: null, updated: null, appliesTo: 'Being reviewed by counsel' },
  ];
}
