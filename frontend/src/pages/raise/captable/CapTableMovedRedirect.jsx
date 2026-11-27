import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * D1029 (#2866, part 14 of #2432) — the old Cap table pages land on the tool.
 * The query and the hash are kept; `?project=` becomes `?project_id=`, the
 * tool's word, and `moved` names the notice the tool shows (`MOVED_NOTICES`).
 * A variant's uid is its scenario id, so `/variants/:variant` opens that scenario.
 */
export function capTableMovedTo(pathname, search = '', moved = null) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (q.has('project')) {
    if (!q.has('project_id')) q.set('project_id', q.get('project'));
    q.delete('project');
  }
  if (moved) q.set('moved', moved);
  const out = q.toString();
  return { pathname, search: out ? `?${out}` : '' };
}

export default function CapTableMovedRedirect({ to, moved = null }) {
  const loc = useLocation();
  const { variant } = useParams();
  const pathname = variant ? `${to}/${encodeURIComponent(variant)}` : to;
  return <Navigate replace to={{ ...capTableMovedTo(pathname, loc.search, moved), hash: loc.hash }} />;
}
