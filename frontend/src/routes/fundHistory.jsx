import React, { lazy } from 'react';
import { Route } from 'react-router-dom';
import { hasInvestorTier } from '../sidebarConfig';

const FundHistoryPage = lazy(() => import('../pages/investor/FundHistoryPage'));
const InvestorWorkspacePage = lazy(() => import('../pages/investor/InvestorWorkspacePage'));

/**
 * `/funds/history?fund=<id>` — a fund's quarterly history (#6234, D6234; IF5).
 * IF5 drew `/funds/:id`, which `FundPage` holds (D6244), so the history is a
 * child of the Fund overview that takes the fund from `?fund=` like every Fund
 * zone (D6229). The static segment outranks `/funds/:fundId`. An investor sees
 * it inside the Fund workspace frame, as `/funds/performance` does.
 */
export default function fundHistoryRoutes({ guard, effectiveRole, user }) {
  const page = <FundHistoryPage />;
  return (
    <>
      <Route path="/funds/history" element={guard(['admin', 'investor'], effectiveRole === 'investor' ? <InvestorWorkspacePage page="fund" fundUnlocked={hasInvestorTier(user, 'institutional')}>{page}</InvestorWorkspacePage> : page)} />
    </>
  );
}
