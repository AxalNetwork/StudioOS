// Pipeline workspace — the investor/founder deal board at `/pipeline`, with a
// tab bar that is now entirely doors rather than sub-tabs.
//
// WHAT CHANGED, AND WHY THE TABS DID NOT SIMPLY GO (D119). This workspace used
// to render four pages: the board plus Screening, Commit and Transactions, each
// deep-linked to its own `/pipeline/*` route. Those three retired to `/deals/*`
// (D118 ported the search and counted chips they had and the zones did not), so
// their routes are redirects and this workspace can only ever see `/pipeline`.
//
// Deleting the three tabs would have been the wrong reading of that. The
// comment below already recorded the fact that matters: **this tab bar is the
// only inbound link an investor has left** to those surfaces, because the
// investor shell collapsed the former sidebar rows into one "Deals" row landing
// here. So the three tabs stay and point at `/deals/*` — they join the two that
// were already cross-route doors, and the distinction the old comment drew
// between "tabs this workspace renders" and "doors" now covers every row.
//
// Roles still mirror each destination's own guard in App.jsx. Founder sees the
// Board tab only, which is correct: `/deals/*` is admin+partner+investor, and a
// tab a founder cannot follow would be a door into a refusal.
import React from 'react';
import { Layers, ClipboardCheck, Gavel, Receipt, Handshake, Shield } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import WorkspaceTabs, { WorkspaceHeader } from '../components/WorkspaceTabs';
import PipelinePage from './PipelinePage';

export default function PipelineWorkspace() {
  const { role } = useAuth();

  // No `active` derivation any more: `/pipeline` is the one route that renders
  // this workspace, so the board is the only body it can show. Deriving a tab
  // from a pathname that can no longer vary would be a branch nothing reaches.
  const tabs = [
    { to: '/pipeline', label: 'Board', icon: Layers, roles: ['admin', 'founder', 'partner', 'investor'] },
    { to: '/deals/screening', label: 'Screening', icon: ClipboardCheck, roles: ['admin', 'investor'] },
    { to: '/deals/commit', label: 'Commit', icon: Gavel, roles: ['admin', 'investor'] },
    { to: '/deals/closing', label: 'Closing', icon: Receipt, roles: ['admin', 'investor'] },
    // The two that were already doors. Neither /deals nor /raise/data-room
    // renders this workspace, so arriving there drops the tab bar. Roles mirror
    // each route's own guard in App.jsx: /deals is admin+partner+investor,
    // /raise/data-room is admin+founder+investor — minus founder, who keeps a
    // Data Room row of their own in the founder nav.
    { to: '/deals', label: 'Deal Flow', icon: Handshake, roles: ['admin', 'partner', 'investor'] },
    { to: '/raise/data-room', label: 'Data Room', icon: Shield, roles: ['admin', 'investor'] },
  ].filter((t) => !role || t.roles.includes(role));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Layers}
        title="Pipeline"
        description="Deal flow from screening through investment committee to close."
      />
      <WorkspaceTabs tabs={tabs} />
      <PipelinePage embedded />
    </div>
  );
}
