import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMovedNotice } from '../../../ui/AdminPageHeader';
import { MOVED_NOTICES, builderTarget, movedTarget } from './pitchStudioModel';

/**
 * D894 (#2434) — the old editor address, `/raise/pitch?mode=workspace`, opens
 * the editor at its new one, `/raise/pitch/edit`, with `?moved=pitch-workspace`
 * so it says "Pitch deck has a new address" once. The query (the venture) and
 * the hash are kept; only `mode` is dropped. It shares its path with the studio
 * home, so it is chosen inside that route, not mounted as a route of its own.
 */
export default function PitchWorkspaceMoved() {
  const loc = useLocation();
  return <Navigate to={movedTarget(loc.search, loc.hash)} replace />;
}

/**
 * D898 group E (#2676) — the retired template builder, `/raise/pitch/builder`,
 * opens the studio with `?moved=pitch-builder`, the query and the hash kept.
 */
export function PitchBuilderMoved() {
  const loc = useLocation();
  return <Navigate to={builderTarget(loc.search, loc.hash)} replace />;
}

/** The moved notice a studio page draws for its `?moved=` key, until it is dismissed. */
export function PitchMovedNotice() {
  const { text, dismiss } = useMovedNotice(MOVED_NOTICES);
  if (!text) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="pitch-moved">
      <span>{text}</span>
      <button type="button" aria-label="Dismiss" className="flex h-8 w-8 items-center justify-center text-[16px] leading-none" onClick={dismiss}>×</button>
    </div>
  );
}
