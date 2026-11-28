import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const HqAiAgentsPage = lazy(() => import('../pages/hq/aiAgents/HqAiAgentsPage'));

/**
 * `/hq/ai-agents/operations/policies/capabilities` — D8070 part 2 (#8070), HQ › AI agents › Operations ›
 * Policies › Capabilities: the agent capability matrix (boards SA10 to SA14, D4137-p2). The same page as the
 * other HQ › AI agents addresses in `App.jsx`, which reads the address with `viewFor`. HQ only; every route
 * behind it re-checks with `requireSuperAdmin`.
 */
export default function hqAiAgentsCapabilitiesRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/hq/ai-agents/operations/policies/capabilities" element={guard(['admin'], hqOnly(<HqAiAgentsPage />))} />
    </>
  );
}
