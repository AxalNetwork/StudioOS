/**
 * D4800 (#4800, D4803) — the Security v2 workspace registry.
 *
 * Seven workspaces under one header, in the canvas's order, each addressable
 * as `/admin/security?tab=<key>`. This list is the one place a workspace is
 * named: the desktop nav, the phone section select, the deep-link parser and
 * the keyboard order all read it. #4801 to #4803 replace a workspace's BODY
 * (the `workspaces` map in `SecurityPage.jsx`'s `SecurityConsole`); they do not add a second list.
 */
export const SECURITY_TABS = Object.freeze([
  { key: 'overview', label: 'Overview', sub: 'What needs action, the evidence behind it, and the audit trail.' },
  { key: 'events', label: 'Events', sub: 'Investigate activity across security and administrative sources.' },
  { key: 'access', label: 'Access', sub: 'Sessions, administrator sign-in strength and support access.' },
  { key: 'privacy', label: 'Privacy', sub: 'Data-subject requests and their statutory clock.' },
  { key: 'trust', label: 'Trust', sub: 'Sanctions screening and KYC, each its own store.' },
  { key: 'ai-safety', label: 'AI Safety', sub: 'Content safety, delivery enforcement and usage anomalies.' },
  { key: 'resilience', label: 'Resilience', sub: 'The restore drill and the backup evidence, as separate facts.' },
]);

export const DEFAULT_TAB = 'overview';

const KEYS = SECURITY_TABS.map((t) => t.key);

/**
 * The workspace a `?tab=` value opens. Anything unknown, empty or missing
 * opens Overview: a stale bookmark lands on the triage view, never on a
 * blank page.
 */
export function tabFromSearch(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return KEYS.includes(v) ? v : DEFAULT_TAB;
}

export const tabHref = (key) => `?tab=${encodeURIComponent(key)}`;

export const tabOf = (key) => SECURITY_TABS.find((t) => t.key === key) || SECURITY_TABS[0];

/**
 * Where an arrow key moves from `current` (WAI-ARIA tabs: Left and Right
 * wrap, Home and End go to the ends). Null for any other key, so the caller
 * leaves the event alone.
 */
export function tabAfterKey(current, key) {
  const at = Math.max(0, KEYS.indexOf(current));
  if (key === 'ArrowRight') return KEYS[(at + 1) % KEYS.length];
  if (key === 'ArrowLeft') return KEYS[(at - 1 + KEYS.length) % KEYS.length];
  if (key === 'Home') return KEYS[0];
  if (key === 'End') return KEYS[KEYS.length - 1];
  return null;
}
