import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useActiveCompany as _useActiveCompany } from '../contexts/ActiveCompanyContext';
import { api, setActiveCompanyId } from '../lib/api';

/**
 * CompanySwitcher — the ONLY way the active company changes.
 *
 * Lifted out of App.jsx with SidebarNav, which is its sole caller. Context is
 * declared in ../contexts/ActiveCompanyContext and provided by ProtectedLayout,
 * so this reads and writes that one context rather than owning company state.
 * It fetches the user's memberships from the membership-scoped
 * /company/memberships endpoint (not the public company directory), populates
 * the context, and lets the user switch between them.
 *
 * "Add a new company" now posts to /company/create, which has been complete on
 * the worker since it was written: it inserts the `company_profiles` row AND
 * the `user_company_links` row that makes the creator its primary admin. Only
 * this button was disabled, so the feature read as missing when the whole
 * server half already worked.
 *
 * WHAT SWITCHING DOES NOT YET DO. `useActiveCompany` is read by this file and
 * CompanySettingsPage — nothing else. No business table carries a company_id
 * (only `user_company_links` does), and `services/tenancyScope.ts` scopes by
 * user, founder_id, LP email and fund GP, never by company. So the active
 * company selects a PROFILE, not a data space: the rest of the sidebar shows
 * the same rows whichever company is selected. The dropdown says so rather
 * than letting the control imply an isolation that does not exist — a silent
 * no-op here would read as "my data vanished" the first time someone creates
 * a second company. Delete `SCOPE_NOTICE` in the commit that lands scoping.
 *
 * No page may show more than one company's data, and no page may change the
 * active company on its own — pages read ActiveCompanyContext, and this
 * component is the single writer.
 */

/**
 * Removed by the change that finishes company scoping — not by the one that
 * starts it. The wording is deliberately free of any section name: naming the
 * surfaces already scoped would need an edit every time another lands, and the
 * edit that gets forgotten is the one that leaves a stale claim in the UI.
 */
const SCOPE_NOTICE = 'Company separation is still rolling out. Some sections show all your data regardless of the company selected.';

/** A date a person can compare, or nothing. Never an invented placeholder. */
function createdOn(value) {
  if (!value) return 'date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'date not recorded'
    : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function CompanySwitcher({ collapsed }) {
  const { company, setCompany, companies, setCompanies } = _useActiveCompany();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const ref = useRef(null);

  // Create, then select. Appending to `companies` rather than refetching keeps
  // the one-writer rule intact: this component owns both writes.
  async function submitNew(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError('');
    try {
      const created = await api.createCompany({ company_name: name });
      setCompanies([...companies, created]);
      setActiveCompanyId(created.id);
      setCompany(created);
      setNewName('');
      setAdding(false);
      setOpen(false);
    } catch (err) {
      // Surface the server's reason. The endpoint 400s on a missing name and
      // can 401 on an expired session; both are worth reading verbatim rather
      // than flattening to "something went wrong".
      setError(err?.message || 'Could not create the company.');
    } finally {
      setSaving(false);
    }
  }

  // Fetch all companies the current user is a member of.
  useEffect(() => {
    api.listMyCompanies()
      .then(list => {
        const arr = Array.isArray(list) ? list : [];
        setCompanies(arr);
        // Set the primary company (is_primary_admin=true comes first from the API)
        // as active if nothing is selected yet.
        if (arr.length > 0 && !company) { setActiveCompanyId(arr[0].id); setCompany(arr[0]); }
      })
      // A failed read used to be swallowed here, which rendered exactly like an
      // account with no companies — the one state a user reports as "I created
      // one and nothing appeared". Keep the reason.
      .catch((err) => setLoadError(err?.message || "Could not load your companies."))
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

  // No fallback company name. "My Company" here read as a real company that the
  // dropdown then contradicted with "No company yet." — the button and the list
  // must agree about whether anything exists.
  const displayName = loading ? '…' : (company?.company_name || (loadError ? 'Unavailable' : 'No company'));
  const abbr = (displayName === '…' ? '…' :
    displayName.replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?');

  // How many entries share each name, so a duplicate can be labelled and a
  // unique name left alone.
  const sameName = new Map();
  for (const co of companies) sameName.set(co.company_name, (sameName.get(co.company_name) || 0) + 1);

  const dropdownContent = (
    <div className={
      collapsed
        ? 'absolute left-full top-0 ml-2 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden min-w-[200px]'
        : 'absolute left-3 right-3 top-full mt-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden'
    }>
      {loading && <div className="px-3 py-2.5 text-xs text-gray-500">Loading…</div>}
      {!loading && loadError && (
        <div className="px-3 py-2.5 text-xs text-red-600 dark:text-red-400">{loadError}</div>
      )}
      {!loading && !loadError && companies.length === 0 && (
        <div className="px-3 py-2.5 text-xs text-gray-500">No company yet.</div>
      )}
      {!loading && companies.map((co) => {
        const coAbbr = (co.company_name || '?').trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const isActive = company?.id === co.id;
        // Only when a name is genuinely ambiguous. `/company/create` now
        // refuses a name the caller already holds and migration 192 dedupes
        // repeated LINKS, but neither touches two SEPARATE companies that were
        // created with the same name before those landed — deleting one would
        // be deleting a company that may hold projects. So they stay, and the
        // list stops pretending they are interchangeable: without this the two
        // rows are pixel-identical and picking the wrong one shows an empty
        // workspace with no way to tell why. Silent on the normal path.
        const ambiguous = sameName.get(co.company_name) > 1;
        return (
          <button
            key={co.uid ?? co.id}
            type="button"
            onClick={() => { setActiveCompanyId(co.id); setCompany(co); setOpen(false); }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-colors ${
              isActive
                ? 'text-violet-700 dark:text-violet-300 font-medium bg-violet-50 dark:bg-violet-900/30'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="w-5 h-5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[9px] font-bold flex items-center justify-center flex-none">
              {coAbbr}
            </div>
            <span className="truncate flex-1">
              {co.company_name}
              {ambiguous && (
                <span className="block text-[10px] font-normal text-gray-500 dark:text-gray-400">
                  created {createdOn(co.created_at)}
                </span>
              )}
            </span>
            {isActive && <span className="flex-none">✓</span>}
          </button>
        );
      })}
      <div className={companies.length > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}>
        {!adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setError(''); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Plus size={12} />
            Add a new company
          </button>
        )}
        {adding && (
          <form onSubmit={submitNew} className="px-3 py-2.5 space-y-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setError(''); } }}
              placeholder="Company name"
              maxLength={200}
              className="w-full px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
            />
            {error && <div className="text-[11px] text-red-600 dark:text-red-400">{error}</div>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!newName.trim() || saving}
                className="flex-1 px-2 py-1.5 text-xs rounded bg-violet-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-violet-700 transition-colors"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setError(''); }}
                className="px-2 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
        {SCOPE_NOTICE}
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
