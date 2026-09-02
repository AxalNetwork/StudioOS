import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useActiveCompany as _useActiveCompany } from '../contexts/ActiveCompanyContext';
import { api, setActiveCompanyId, initActiveCompanyId } from '../lib/api';

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
 * WHAT SWITCHING DOES. The active company is sent as `X-Company-Id` on every
 * request and VERIFIED server-side against `user_company_links`, so a forged
 * value is ignored rather than obeyed. Migrations 189 and 193-198 put a
 * `company_id` on the rows each role owns, and the worker narrows on it: a
 * founder's projects and everything hanging off them, the investor's deal-flow
 * relationships and the funds they run, the partner's quotes, engagements,
 * catalog, pitches and perks, and the founder's advisor roster. A project
 * records the company it was created in, so this applies to new work and not
 * only to what the backfill reached.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, which is not the same as unfinished:
 *
 *   - SHARED MARKETPLACES stay whole. The deal list, the founder-needs board,
 *     the service and perk catalogues and syndication exist to show work from
 *     people you have no relationship with yet; narrowing them would hide the
 *     thing the page is for.
 *   - ACCOUNT-LEVEL THINGS stay yours rather than a firm's — your calendar,
 *     your perk credits, your referral code, your marketplace profile, an LP's
 *     own positions. A balance belongs to a person.
 *   - THE ADVISOR'S Practice and Expertise rows genuinely are not separated,
 *     and that one IS unfinished: both are served by `routes/advisors.ts`, the
 *     `/office-hours` implementation, which is task #124 and under a
 *     do-not-touch instruction. See UNRESOLVED_ITEMS.md U4.
 *
 * The notice below tells the first two to everyone and the third only to the
 * people it affects, rather than claiming the whole thing is still landing.
 *
 * No page may show more than one company's data, and no page may change the
 * active company on its own — pages read ActiveCompanyContext, and this
 * component is the single writer.
 */

/**
 * What the switcher does and does not move, said once, at the point of use.
 *
 * The old wording — "company separation is still rolling out" — was true when
 * nothing was scoped and became a lie as each stage landed: it told a founder
 * their data might be leaking between companies when it no longer was. It is
 * REPLACED rather than deleted, because deleting it would leave two real
 * things unsaid, and a person would read either as a bug:
 *
 *   1. Shared marketplaces and account-level data are the SAME in every
 *      company, by design and permanently.
 *   2. An advisor's Practice and Expertise rows really are unseparated,
 *      because they run on frozen code (task #124, UNRESOLVED_ITEMS.md U4).
 *
 * Only (2) is a limitation, and only advisors see it. Naming those two rows is
 * safe in a way the old notice's vagueness was not: if the freeze lifts and
 * they are scoped, this line goes — and the test pinning `routes/advisors.ts`
 * as unscoped fails at the same moment, so the claim cannot go stale quietly.
 */
const SHARED_NOTICE = 'Everything below is dedicated to the selected company. Marketplaces and account settings stay shared across your companies.';
const ADVISOR_NOTICE = 'Practice and Expertise are not yet separated by company.';

/** A date a person can compare, or nothing. Never an invented placeholder. */
function createdOn(value) {
  if (!value) return 'date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'date not recorded'
    : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * @param role  the caller's role, passed straight through from SidebarNav,
 *              which already has it. Used only to decide whether the advisor
 *              limitation applies — telling a founder that Practice is
 *              unseparated would name two rows their sidebar does not have.
 */
function CompanySwitcher({ collapsed, role }) {
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
    const savedId = initActiveCompanyId();
    api.listMyCompanies()
      .then(list => {
        const arr = Array.isArray(list) ? list : [];
        setCompanies(arr);
        // Restore the persisted company when it is still a membership; fall
        // back to the primary company (is_primary_admin=true comes first).
        const restored = savedId ? arr.find((co) => co.id === savedId) : null;
        const next = restored || arr[0] || null;
        if (next) { setActiveCompanyId(next.id); setCompany(next); }
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
        {SHARED_NOTICE}
        {role === 'advisor' ? <> {ADVISOR_NOTICE}</> : null}
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
