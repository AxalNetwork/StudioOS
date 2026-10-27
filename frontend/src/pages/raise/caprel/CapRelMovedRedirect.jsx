import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { capRelMovedTo } from './capRelModel';

/**
 * D1194 (#3128, part 6 of #2457) — the old investor pipeline and Investor match
 * land on Capital relationships' tab with the venture and the moved notice
 * (CRL13). The query and the hash are kept (`capRelMovedTo`).
 */
export default function CapRelMovedRedirect({ tab, moved = null }) {
  const loc = useLocation();
  return <Navigate replace to={{ ...capRelMovedTo(tab, loc.search, moved), hash: loc.hash }} />;
}
