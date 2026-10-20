// Temporary D789 browser harness; removed after validation.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import UsageOverview from '../src/pages/account/UsageOverview';
import CostPage from '../src/pages/account/CostPage';
import '../src/index.css';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[location.pathname.includes('cost') ? '/account/usage/cost' : '/account/usage']}>
    <div className="min-h-screen bg-axal-ground p-[22px] text-axal-ink dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-[1000px]">{location.pathname.includes('cost') ? <CostPage role="founder" /> : <UsageOverview role="founder" />}</div>
    </div>
  </MemoryRouter>
);
