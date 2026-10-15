import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { companySheetApi } from '../../lib/api/companySheet.js';
import { activeSupportSession } from '../../lib/supportSession.js';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext.js';
import { isCyclePath } from '../../pages/cycles/cyclePaths.js';
import { SHARED_NOTICE, createdOn, useCompanySwitch } from '../CompanySwitcher.jsx';
import { PhoneSheet, SheetRow } from './PhoneSheet.jsx';

const CYCLES = ['validate', 'build', 'raise', 'grow'];
const nameOf = cycle => cycle[0].toUpperCase() + cycle.slice(1);
const cycleOf = company => CYCLES.includes(company?.last_opened?.cycle) ? company.last_opened.cycle : 'validate';

export function companyRowDescription(co, active, now = new Date()) {
  if (active) return co.cycles_active === null ? '' : co.cycles_active?.length
    ? `Active · ${co.cycles_active.map(nameOf).join(', ')}` : 'Not started';
  if (co.last_opened?.cycle && co.last_opened?.at) {
    const date = new Date(co.last_opened.at);
    if (Number.isNaN(date.getTime())) return nameOf(co.last_opened.cycle);
    const dateText = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC',
      ...(date.getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }) });
    return `${nameOf(co.last_opened.cycle)} · last opened ${dateText}`;
  }
  if (co.cycles_active === null) return '';
  return co.cycles_active?.length ? co.cycles_active.map(nameOf).join(', ') : 'Not started';
}

export function CompanySheet({ onClose, opener }) {
  const navigate = useNavigate();
  const { company, switchTo, create } = useCompanySwitch();
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    api.listMyCompanies().then(rows => { if (alive) setList(Array.isArray(rows) ? rows : []); })
      .catch(err => { if (alive) setLoadError(`Unreadable — ${err?.message || 'Could not load your companies.'}`); });
    return () => { alive = false; };
  }, []);
  const ordered = list ? [...list].sort((a, b) => Number(b.id === company?.id) - Number(a.id === company?.id)) : [];
  const counts = new Map();
  ordered.forEach(co => counts.set(co.company_name, (counts.get(co.company_name) || 0) + 1));
  const openCompany = co => {
    if (co.id !== company?.id) switchTo(co);
    onClose();
    navigate(`/${cycleOf(co)}`);
  };
  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    try { await create(name.trim()); onClose(); navigate('/validate'); }
    catch (err) { setError(err?.message || 'Could not create the company.'); }
    finally { setSaving(false); }
  }
  return <PhoneSheet title="Switch company" onClose={onClose} opener={opener}>
    {!list && !loadError && <p className="py-3 text-gray-600 dark:text-gray-400">Loading…</p>}
    {loadError && <p role="alert" className="py-3 text-red-600 dark:text-red-400">{loadError}</p>}
    {list?.length === 0 && <p className="py-3 text-gray-600 dark:text-gray-400">No company yet.</p>}
    {ordered.map(co => {
      const active = co.id === company?.id;
      const mark = (co.company_name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
      const duplicate = counts.get(co.company_name) > 1;
      return <SheetRow key={co.uid ?? co.id} title={<>{co.company_name}{duplicate &&
        <span className="block text-[10px] font-normal text-gray-600 dark:text-gray-400">created {createdOn(co.created_at)}</span>}</>}
        description={companyRowDescription(co, active)} right={active ? 'Active' : null} mark={mark} onClick={() => openCompany(co)} />;
    })}
    {!adding ? <SheetRow title="Create a company" description="A new sidebar, scoped to it" right="+" onClick={() => setAdding(true)} />
      : <form onSubmit={submit} className="space-y-2 py-3">
        <input autoFocus value={name} maxLength={200} onChange={e => setName(e.target.value)} placeholder="Company name"
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 p-2 text-gray-900 dark:text-gray-100" />
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={saving || !name.trim()} className="mr-3 text-violet-700 dark:text-violet-300">{saving ? 'Creating…' : 'Create'}</button>
        <button type="button" onClick={() => { setAdding(false); setError(''); }}>Cancel</button>
      </form>}
    <div className="mt-2 border-t border-gray-200 dark:border-gray-800">
      <SheetRow title="Company Settings" description="Members, access, the public profile" to="/company-settings" onClose={onClose} />
      <p className="py-3 text-[11.5px] text-gray-600 dark:text-gray-400">{SHARED_NOTICE}</p>
    </div>
  </PhoneSheet>;
}

/** A visit is sent again for the same (company, cycle) only after an hour. */
export const VISIT_RESEND_MS = 60 * 60 * 1000;

/**
 * D699 decision 7: the visit to send for this route, or null.
 *
 * A cycle page is any path `isCyclePath` matches (D694), and its cycle is the
 * path's first segment. `last` is the last visit this tab sent,
 * `{ companyId, cycle, at }`. The same pair is not sent again within the hour.
 */
export function visitToRecord(pathname, companyId, last, now = Date.now()) {
  if (!Number.isInteger(companyId) || companyId <= 0 || !isCyclePath(pathname)) return null;
  const cycle = String(pathname).split('/')[1];
  if (!CYCLES.includes(cycle)) return null;
  if (last && last.companyId === companyId && last.cycle === cycle && now - last.at < VISIT_RESEND_MS) return null;
  return { companyId, cycle };
}

/**
 * Records the founder's last opened cycle in the active company, for the
 * company sheet. It renders nothing. The shell passes `record={false}` while
 * an operator impersonates or an admin views as a founder, and nothing is sent
 * during an HQ support session: an operator must never move a founder's
 * "last opened". A failed send is dropped, because "last opened" is a hint;
 * the next cycle change sends again.
 */
export function CompanyVisits({ role, record = true }) {
  const { pathname } = useLocation();
  const { company } = useActiveCompany();
  const last = useRef(null);
  const companyId = company?.id;
  useEffect(() => {
    if (role !== 'founder' || !record || activeSupportSession()) return;
    const now = Date.now();
    const visit = visitToRecord(pathname, companyId, last.current, now);
    if (!visit) return;
    last.current = { ...visit, at: now };
    companySheetApi.recordVisit(visit.companyId, visit.cycle).catch(() => {});
  }, [role, record, pathname, companyId]);
  return null;
}
