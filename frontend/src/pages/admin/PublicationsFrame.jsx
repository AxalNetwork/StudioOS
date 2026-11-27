import React from 'react';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { RailFrame, WorkerRail } from '../../ui';

/**
 * D775 (#2101) — H20, Publications, is one board on three routes: the list
 * (`/admin/publications`), a new draft (`/new`) and one publication (`/:id`).
 * None of the three drew a rail. They share this frame, so the board draws one
 * rail under one name wherever the member is on it.
 *
 * A plain admin publishes here too, so the rail takes the viewer's tier, as
 * ContractsDesk does. "Draft with AI" on `/new` is this board's one option that
 * runs a model; its `useRailOption` call comes with the page map (D768).
 */
export default function PublicationsFrame({ children }) {
  const superAdmin = isSuperAdminUser(useAuth()?.user);
  const note = 'Eadwyn drafts a summary when you ask on a new publication. Nothing is published until you publish it.';
  const rail = superAdmin
    ? <WorkerRail workspace="Publications" role="super_admin" note={note} data-testid="hq-publications-rail" />
    : <WorkerRail workspace="Publications" role="admin" note={note} data-testid="admin-publications-rail" />;
  return <RailFrame rail={rail} data-testid="publications-page">{children}</RailFrame>;
}
