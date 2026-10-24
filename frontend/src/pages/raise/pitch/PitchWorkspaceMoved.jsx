import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { movedTarget } from './pitchStudioModel';

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
