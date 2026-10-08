import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

export const CONTRACTS_MOVED_NOTICE = 'The Admin Console has moved: Legal now lives under Contracts.';
export function legacyContractsTarget(search) {
  return new URLSearchParams(search || '').get('tab') === 'legal' ? '/admin/contracts?moved=legal' : null;
}

/** D647 — redirects before mounting the console and its unrelated data reads. */
export default function LegacyContractsRedirect({ children }) {
  const { search } = useLocation();
  const target = legacyContractsTarget(search);
  return target ? <Navigate to={target} replace /> : children;
}
