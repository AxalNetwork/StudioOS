import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useActiveCompany as _useActiveCompany } from '../contexts/ActiveCompanyContext';
import { api } from '../lib/api';

/**
 * CompanySwitcher — the ONLY way the active company changes.
 *
 * Lifted out of App.jsx with SidebarNav, which is its sole caller. Context is
 * declared in ../contexts/ActiveCompanyContext and provided by ProtectedLayout,
 * so this reads and writes that one context rather than owning company state.
 * It fetches the user's memberships from the membership-scoped
 * /company/memberships endpoint (not the public company directory), populates
 * the context, and lets the user switch between them. "Add a new company" is
 * disabled until task #5 ships.
 *
 * No page may show more than one company's data, and no page may change the
 * active company on its own — pages read ActiveCompanyContext, and this
 * component is the single writer.
 */

function CompanySwitcher({ collapsed }) {
  const { company, setCompany, companies, setCompanies } = _useActiveCompany();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);

  // Fetch all companies the current user is a member of.
  useEffect(() => {
    api.listMyCompanies()
      .then(list => {
        const arr = Array.isArray(list) ? list : [];
        setCompanies(arr);
        // Set the primary company (is_primary_admin=true comes first from the API)
        // as active if nothing is selected yet.
        if (arr.length > 0 && !company) setCompany(arr[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const displayName = loading ? '…' : (company?.company_name ?? 'My Company');
  const abbr = (displayName === '…' ? '…' :
    displayName.replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?');

  const dropdownContent = (
    <div className={
      collapsed
        ? 'absolute left-full top-0 ml-2 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden min-w-[200px]'
        : 'absolute left-3 right-3 top-full mt-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden'
    }>
      {loading && <div className="px-3 py-2.5 text-xs text-gray-500">Loading…</div>}
      {!loading && companies.length === 0 && (
        <div className="px-3 py-2.5 text-xs text-gray-500">No company yet.</div>
      )}
      {!loading && companies.map((co) => {
        const coAbbr = (co.company_name || '?').trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const isActive = company?.id === co.id;
        return (
          <button
            key={co.uid ?? co.id}
            type="button"
            onClick={() => { setCompany(co); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-colors ${
              isActive
                ? 'text-violet-700 dark:text-violet-300 font-medium bg-violet-50 dark:bg-violet-900/30'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="w-5 h-5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[9px] font-bold flex items-center justify-center flex-none">
              {coAbbr}
            </div>
            <span className="truncate flex-1">{co.company_name}</span>
            {isActive && <span className="flex-none">✓</span>}
          </button>
        );
      })}
      <div className={companies.length > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}>
        <button
          type="button"
          disabled
          title="Creating additional companies is coming soon"
          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-gray-400 dark:text-gray-600 cursor-not-allowed"
        >
          <Plus size={12} />
          Add a new company
        </button>
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <div ref={ref} className="relative flex justify-center py-2 px-1 border-b border-gray-200 dark:border-gray-700 flex-none">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          title={displayName}
          className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-bold flex items-center justify-center hover:bg-violet-200 dark:hover:bg-violet-900/60 transition-colors"
        >
          {abbr}
        </button>
        {open && dropdownContent}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex-none">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 transition-colors text-left"
      >
        <div className="w-6 h-6 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] font-bold flex items-center justify-center flex-none">
          {abbr}
        </div>
        <span className="flex-1 text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{displayName}</span>
        <ChevronDown size={12} className={`flex-none text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && dropdownContent}
    </div>
  );
}

export default CompanySwitcher;
