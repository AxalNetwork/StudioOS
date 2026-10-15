import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
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
