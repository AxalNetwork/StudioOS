import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { contractsApi } from '../../../lib/api/contracts';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { RailFrame, WorkerRail } from '../../../ui';
import { CONTRACTS_MOVED_NOTICE } from '../LegacyContractsRedirect';
import { ContractRegistryTab } from '../../hq/ContractRegistry';
import AdminTemplates from '../AdminTemplates';
import AdminForms from '../AdminForms';
import AgreementList from './AgreementList';
import AgreementDetail from './AgreementDetail';
import RelatedLists from './RelatedLists';
import EnvelopeWizard from './EnvelopeWizard';
import { useRead, ReadState, Missing, button, card } from './parts';

const tabs = [['agreements', 'Agreements'], ['ndas', 'NDAs'], ['partner-deals', 'Partner deals'], ['templates', 'Templates'], ['forms', 'Forms'], ['document-types', 'Document types']];
const filterKeys = ['status', 'q', 'doc_type', 'party_role', 'provider', 'sort', 'direction', 'offset', 'template', 'signed_recent'];
export default function ContractsDesk() {
  const { user } = useAuth() || {};
  const superAdmin = isSuperAdminUser(user);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'agreements';
  const allowed = tabs.some(([id]) => id === tab) && (superAdmin || tab !== 'document-types');
  const [selected, setSelected] = useState(null);
  const [revision, setRevision] = useState(0);
  const stats = useRead(() => contractsApi.stats(), [revision]);
  const filters = Object.fromEntries(filterKeys.filter(key => params.has(key)).map(key => [key, params.get(key)]));
  function navigate(nextTab, nextFilters = {}) {
    const next = new URLSearchParams();
    if (nextTab !== 'agreements') next.set('tab', nextTab);
    if (params.get('moved') === 'legal') next.set('moved', 'legal');
    for (const [key, value] of Object.entries(nextFilters)) if (value !== '' && value != null) next.set(key, String(value));
    setParams(next); setSelected(null);
  }
  const cards = [
    ['Total', stats.data?.total, {}],
    ['Awaiting signature', stats.data?.pending_signature, { status: 'awaiting_signature' }],
    ['Signed', stats.data?.by_status?.signed, { status: 'signed' }],
    ['Average days to sign', stats.data?.avg_days_to_sign, { status: 'signed', sort: 'days_to_sign', direction: 'asc' }],
    ['Signed, last 30 days', stats.data?.signed_last_30d, { status: 'signed', signed_recent: true }],
  ];
  const railProps = { stance: 'Agreements and templates', note: 'Recorded agreements and the templates behind them. Resending or voiding requires an explicit action.' };
  const rail = superAdmin ? <WorkerRail {...railProps} workspace="Contracts" role="super_admin" data-testid="hq-contracts-rail" /> : <WorkerRail {...railProps} workspace="Contracts" role="admin" data-testid="admin-contracts-rail" />;
  return <RailFrame rail={rail} data-testid="hq-contracts-page"><div className="space-y-5 text-axal-ink dark:text-gray-100">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">{superAdmin ? 'HQ' : 'Admin'} · Contracts</p><h1 className="text-2xl font-extrabold tracking-tight">Contracts</h1><p className="mt-1 text-[12.5px] text-axal-muted">Every agreement the platform sends, signs or keeps, and the templates behind them.</p></div><button type="button" className={`${button} bg-violet-600 text-white`} onClick={() => { const next = new URLSearchParams(params); next.set('new', ''); setParams(next); }}>New envelope</button></header>
    {params.get('moved') === 'legal' && <p role="status">{CONTRACTS_MOVED_NOTICE}</p>}
    <ReadState read={stats} what="Contract counts"><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{cards.map(([label, value, target]) => <button key={label} type="button" className={`${card} p-3 text-left`} onClick={() => navigate('agreements', target)}><span className="block text-[11px] text-axal-muted">{label}</span><span className="mt-1 block text-2xl font-bold">{value == null ? <Missing reason={label === 'Average days to sign' ? 'No signed agreement has both a recorded sent and signed date.' : 'This count was not returned.'} /> : value}</span></button>)}</div></ReadState>
    <nav aria-label="Contracts tabs" className="flex gap-1 overflow-x-auto border-b border-axal-hairline">{tabs.filter(([id]) => superAdmin || id !== 'document-types').map(([id, label]) => <button key={id} type="button" className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${id === tab ? 'border-violet-600 text-axal-ink dark:text-white' : 'border-transparent text-axal-muted'}`} aria-current={id === tab ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav>
    {!allowed ? <p>That Contracts tab is not available to this account.</p> : tab === 'agreements' ? <AgreementList filters={filters} onFilters={next => navigate('agreements', next)} onOpen={setSelected} revision={revision} />
      : tab === 'ndas' || tab === 'partner-deals' ? <RelatedLists key={tab} kind={tab} onOpen={setSelected} />
        : tab === 'templates' ? <AdminTemplates recordedPublication onOpenUsage={slug => navigate('agreements', { template: slug })} />
          : tab === 'forms' ? <AdminForms /> : <ContractRegistryTab />}
    <p className="text-xs text-axal-muted">Formation orders live in Programs › Spin-Out Lab. <Link to="/admin/spinout-lab" className="underline">Open its Formation orders tab.</Link></p>
    {selected && <AgreementDetail uid={selected} onClose={() => setSelected(null)} onChanged={() => setRevision(n => n + 1)} />}
    {params.has('new') && <EnvelopeWizard onClose={() => { const next = new URLSearchParams(params); next.delete('new'); setParams(next); }} onTemplates={() => navigate('templates')} onSent={() => setRevision(n => n + 1)} />}
  </div></RailFrame>;
}
