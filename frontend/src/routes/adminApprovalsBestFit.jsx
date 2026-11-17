import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const ApprovalsBestFitBoard = lazy(() => import('../pages/admin/approvals/BestFitBoard'));

/**
 * `/admin/approvals/best-fit` and its tabs and item — D5885 (#5885, part of
 * #4716, AP-20 to AP-31): the Best-Fit consultations board, under
 * `guard(['admin'])` as the other Approvals boards in `App.jsx` are. Any
 * admin decides (D5884); the Worker's `requireAdmin` is the gate.
 */
export default function adminApprovalsBestFitRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/approvals/best-fit" element={guard(['admin'], <ApprovalsBestFitBoard />)} />
      <Route path="/admin/approvals/best-fit/confirmed" element={guard(['admin'], <ApprovalsBestFitBoard />)} />
      <Route path="/admin/approvals/best-fit/completed" element={guard(['admin'], <ApprovalsBestFitBoard />)} />
      <Route path="/admin/approvals/best-fit/cancelled" element={guard(['admin'], <ApprovalsBestFitBoard />)} />
      <Route path="/admin/approvals/best-fit/:item" element={guard(['admin'], <ApprovalsBestFitBoard />)} />
    </>
  );
}
