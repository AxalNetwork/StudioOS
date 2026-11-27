import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MOVED_HELD, PROGRAMS_PATH } from './programsModel';

/**
 * D953 (#2371, D894's redirect rule) — /admin/held/programs was the Programs
 * landing until the catalogue was built to its canvas. A bookmark keeps its
 * query and hash and gains `?moved=held`, which shows "Programs has a new
 * address. Update your bookmark." under the title. The redirect is not
 * guarded: the page it lands on is, by guard(['admin']).
 */
export default function HeldProgramsRedirect() {
  const loc = useLocation();
  const next = new URLSearchParams(loc.search);
  next.set('moved', MOVED_HELD);
  return <Navigate to={{ pathname: PROGRAMS_PATH, search: `?${next.toString()}`, hash: loc.hash }} replace />;
}
