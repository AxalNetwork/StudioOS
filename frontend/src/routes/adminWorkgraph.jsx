import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const WorkGraphPage = lazy(() => import('../pages/hq/workgraph/WorkGraphPage'));

/**
 * `/admin/workgraph/*` — D5580 part 5 (#5580), HQ › Platform › Infrastructure ›
 * WorkGraph: the owner's route A (`/admin/workgraph/in-flight`) and layout A,
 * one address per tab. HQ only; the read behind it is Super Admin only
 * (`GET /api/admin/workgraph/in-flight`), and a plain admin sees the page's
 * Refused state from that read's 403.
 */
export default function adminWorkgraphRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/workgraph/in-flight" element={guard(['admin'], hqOnly(<WorkGraphPage />))} />
      <Route path="/admin/workgraph/pairs" element={guard(['admin'], hqOnly(<WorkGraphPage />))} />
      <Route path="/admin/workgraph/evidence" element={guard(['admin'], hqOnly(<WorkGraphPage />))} />
    </>
  );
}
