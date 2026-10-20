// Temporary D789 browser harness; removed after validation.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UsageOverview from '../src/pages/account/UsageOverview';
import CostPage from '../src/pages/account/CostPage';
import '../src/index.css';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[location.pathname.includes('cost') ? '/account/usage/cost' : '/account/usage' + location.hash]}>
    <div className="min-h-screen bg-axal-ground p-[22px] text-axal-ink dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-[1000px]"><Routes><Route path="/account/usage" element={<UsageOverview role="founder" />} /><Route path="/account/usage/cost" element={<CostPage role="founder" />} /></Routes></div>
    </div>
  </MemoryRouter>
);
