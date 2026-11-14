import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export const CONTRACTS_MOVED_NOTICE = 'The Admin Console has moved: Legal now lives under Contracts.';

/**
 * D938 (#2743) — the one redirect map for the retired Admin Console. Every
 * `/admin?tab=` forwards here before anything mounts, so no old read fires
 * (D647's rule). Each tab names its #2375 address and, when the page shows a
 * moved notice, the sentence in one of #2375's three forms. The forward keeps
 * every other query and the hash, and adds `?moved=<tab>`.
 *
 * A bare `/admin`, `?tab=users` and any tab not listed here open All accounts,
 * as the console opened Users (#2375's last row).
 *
 * Integration keys and GitHub Sync left for HQ's own row on the owner's ruling
 * (2026-10-20) and show no notice: a plain admin lands on the route's Super
 * Admin notice, which is the answer for them now.
 */
const MOVED = (page, section) => `The Admin Console has moved: ${page} now lives under ${section}.`;
const RENAMED = (from, to, section) => `${from} is now ${to}, under ${section}.`;

export const ADMIN_TAB_MOVES = {
  users: { to: '/admin/accounts/all', notice: RENAMED('Users', 'All accounts', 'Accounts') },
  profiles: { to: '/admin/partner-profiles', notice: MOVED('Partner profiles', 'Approvals') },
  kyc: { to: '/admin/kyc', notice: RENAMED('KYC Queue', 'KYC & KYB', 'Approvals') },
  // D937 (#2374): the Spin-Out Lab left for Programs; the Lab shows its own notice.
  'lab-applications': { to: '/admin/programs/spinout-lab/applications', moved: true },
  // D647: Contracts shows CONTRACTS_MOVED_NOTICE.
  legal: { to: '/admin/contracts', moved: true },
  personas: { to: '/admin/persona-segments', notice: RENAMED('Personas', 'Persona segments', 'Accounts') },
  directory: { to: '/admin/directory', notice: MOVED('Directory', 'Community') },
  wellbeing: { to: '/admin/wellbeing', notice: MOVED('Wellbeing', 'Community') },
  // D972 (#2369): the roster is the Deck roster tab of Advisors & Partners.
  'network-profiles': { to: '/admin/advisors-partners/deck', moved: true },
  payments: { to: '/admin/platform/payments', notice: MOVED('Payments', 'Platform') },
  'bank-accounts': { to: '/admin/platform/bank-accounts', notice: MOVED('Bank accounts', 'Platform') },
  'product-testing': { to: '/admin/platform/product-testing', notice: MOVED('Product testing', 'Platform') },
  promos: { to: '/admin/platform/promo-codes', notice: MOVED('Promo codes', 'Platform') },
  billing: { to: '/admin/revenue/billing', notice: MOVED('Billing', 'Revenue') },
  'integration-keys': { to: '/admin/integration-keys' },
  github: { to: '/admin/integration-keys', hash: '#github' },
};

/** The notices a page at `path` shows, keyed by the `?moved=` its old tabs add. */
export function movedNoticesFor(path) {
  return Object.fromEntries(Object.entries(ADMIN_TAB_MOVES)
    .filter(([, m]) => m.to === path && m.notice)
    .map(([tab, m]) => [tab, m.notice]));
}

/** Where `/admin` with this query and hash forwards: always somewhere. */
export function legacyContractsTarget(search, hash = '') {
  const params = new URLSearchParams(search || '');
  const asked = params.get('tab');
  const tab = Object.hasOwn(ADMIN_TAB_MOVES, asked ?? '') ? asked : 'users';
  const move = ADMIN_TAB_MOVES[tab];
  params.delete('tab');
  params.delete('moved');
  if (move.notice || move.moved) params.set('moved', tab);
  const q = params.toString();
  return `${move.to}${q ? `?${q}` : ''}${move.hash || hash || ''}`;
}

/** D647, D938 — `/admin` mounts nothing: it forwards before any console reads. */
export default function LegacyContractsRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={legacyContractsTarget(search, hash)} replace />;
}
