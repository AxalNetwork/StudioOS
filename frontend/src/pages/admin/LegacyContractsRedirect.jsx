import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export const CONTRACTS_MOVED_NOTICE = 'The Admin Console has moved: Legal now lives under Contracts.';
// The owner's ruling (2026-10-20): Integration keys and GitHub Sync left the
// Admin Console for HQ's own row. A plain admin who follows an old link lands
// on the route's Super Admin notice, which is the answer for them now.
const MOVED_TABS = {
  legal: '/admin/contracts?moved=legal',
  'integration-keys': '/admin/integration-keys',
  github: '/admin/integration-keys#github',
};

export function legacyContractsTarget(search) {
  const tab = new URLSearchParams(search || '').get('tab');
  return Object.hasOwn(MOVED_TABS, tab ?? '') ? MOVED_TABS[tab] : null;
}

/** D647 — redirects before mounting the console and its unrelated data reads. */
export default function LegacyContractsRedirect({ children }) {
  const { search } = useLocation();
  const target = legacyContractsTarget(search);
  return target ? <Navigate to={target} replace /> : children;
}
