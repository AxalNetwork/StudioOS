import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { contractsApi } from '../../../lib/api/contracts';
import { useAuth } from '../../../hooks/useAuthSync';
import { branchOfUser, isSuperAdminUser } from '../../../lib/shellRole';
import { RailFrame, WorkerRail } from '../../../ui';
import { CONTRACTS_MOVED_NOTICE } from '../LegacyContractsRedirect';
import { ContractRegistryTab } from '../../hq/ContractRegistry';
import AdminTemplates from '../AdminTemplates';
import AdminForms from '../AdminForms';
import AgreementList from './AgreementList';
import AgreementDetail from './AgreementDetail';
import RelatedLists from './RelatedLists';
import EnvelopeWizard from './EnvelopeWizard';
import { BankAccountsLink, FundStructureDoor } from './FundStructureSheet';
import { useRead, ReadState, button } from './parts';
import HeaderAsk from '../../../ui/HeaderAsk.jsx';
import ContractSearch from './ContractSearch';
import TemplateWorkspace from './TemplateWorkspace';
import { AgreementCategories, LIBRARY_ITEMS, LibraryMenu, isLibrary, primaryOf, tabClass } from './ContractsNav';
import MetricStrip from './MetricStrip';
import GovernanceTab from './GovernanceTab';

const tabs = [['agreements', 'Agreements'], ['ndas', 'NDAs'], ['partner-deals', 'Partner deals'], ['templates', 'Templates'], ['forms', 'Forms'], ['document-types', 'Document types']];
const filterKeys = ['status', 'q', 'doc_type', 'party_role', 'provider', 'sort', 'direction', 'offset', 'template', 'signed_recent', 'attention', 'open'];
/**
 * `section="governance"` (D4563, #4563) draws Corporate Governance, the tab at its own
 * address `/admin/contracts/governance` (tabs are paths), after Templates. HQ only.
 */
export default function ContractsDesk({ section = null }) {
  const { user } = useAuth() || {};
  const superAdmin = isSuperAdminUser(user);
  const [params, setParams] = useSearchParams();
  const go = useNavigate();
  const governance = section === 'governance';
  // D4811 part 10: a template's workspace, at /admin/contracts/templates/doc/:slug, under the Templates tab.
  const templateDoc = section === 'template';
  const { slug: docSlug } = useParams();
  const away = governance || templateDoc;
  const hqDesk = !branchOfUser(user);
  const tab = params.get('tab') || 'agreements';
  const primary = templateDoc ? 'templates' : primaryOf(tab, { governance });
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
    // From the governance address, a query tab is back on the desk's own path.
    if (away) go(`/admin/contracts${next.toString() ? `?${next}` : ''}`); else setParams(next);
    setSelected(null);
  }
  // D4811 part 4: a search result opens its record: a tab (with the template open), an agreement's panel, or a governance entity.
  const openResult = (target) => {
    // From the governance address the desk's panel is not mounted, so the agreement is found in the list instead.
    if (target.kind === 'agreement') { if (away) navigate('agreements', { q: target.title }); else setSelected(target.uid); return; }
    if (target.kind === 'path') { go(target.to); return; }
    navigate(target.tab, target.filters);
  };
  // D4811 part 3: the six-cell strip (board CT-01) opens the records behind each count.
  const drill = (target) => (target.kind === 'tab' ? navigate(target.tab) : navigate('agreements', target.filters));
  const railProps = { stance: 'Agreements and templates', note: 'Recorded agreements and the templates behind them. Resending or voiding requires an explicit action.' };
  const rail = superAdmin ? <WorkerRail {...railProps} workspace="Contracts" role="super_admin" data-testid="hq-contracts-rail" /> : <WorkerRail {...railProps} workspace="Contracts" role="admin" data-testid="admin-contracts-rail" />;
  return <RailFrame rail={rail} data-testid="hq-contracts-page"><div className="space-y-5 text-axal-ink dark:text-gray-100">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">{superAdmin ? 'HQ' : 'Admin'} · Contracts</p><h1 className="text-2xl font-extrabold tracking-tight">Contracts</h1><p className="mt-1 text-[12.5px] text-axal-muted">Every agreement the platform sends, signs or keeps, and the templates behind them.</p></div><div className="flex flex-wrap items-center gap-2">{!branchOfUser(user) && <FundStructureDoor />}{superAdmin && !branchOfUser(user) && <BankAccountsLink />}<button type="button" className={`${button} bg-violet-600 text-white`} onClick={() => { const next = new URLSearchParams(params); next.set('new', ''); setParams(next); }}>New envelope</button><HeaderAsk /></div></header>
    {params.get('moved') === 'legal' && <p role="status">{CONTRACTS_MOVED_NOTICE}</p>}
    <ContractSearch onOpen={openResult} />
    <ReadState read={stats} what="Contract counts"><MetricStrip stats={stats.data} onDrill={drill} /></ReadState>
    {/* D4811 part 7: four workflow tabs; NDAs and Partner deals are Agreements categories; Forms and Document types are under Library. */}
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-axal-hairline">
      <nav aria-label="Contracts tabs" className="flex gap-1 overflow-x-auto">
        <button type="button" className={tabClass(primary === 'agreements')} aria-current={primary === 'agreements' ? 'page' : undefined} onClick={() => navigate('agreements')}>Agreements</button>
        <button type="button" className={tabClass(primary === 'templates')} aria-current={primary === 'templates' ? 'page' : undefined} onClick={() => navigate('templates')}>Templates</button>
        {/* D4563 (#4563): Corporate Governance is at its own path. HQ only. */}
        {hqDesk && <Link to="/admin/contracts/governance" className={tabClass(primary === 'governance')} aria-current={primary === 'governance' ? 'page' : undefined} data-testid="contracts-tab-governance">Corporate Governance</Link>}
        {/* D1219 (#3216): Closings is its own page (D1213), reached from the tab row. */}
        <Link to="/admin/contracts/closings" className={tabClass(false)} data-testid="contracts-tab-closings">Closings</Link></nav>
      <LibraryMenu items={LIBRARY_ITEMS.filter(([k]) => superAdmin || k !== 'document-types')} current={!away && isLibrary(tab) ? tab : null} onTab={(id) => navigate(id)} />
    </div>
    {!away && allowed && primaryOf(tab) === 'agreements' && <AgreementCategories tab={tab} onTab={(id) => navigate(id)} />}
    {templateDoc ? <TemplateWorkspace slug={docSlug} /> : governance ? (hqDesk ? <GovernanceTab workspaceLink={(uid) => <Link to={`/admin/contracts/governance/doc/${encodeURIComponent(uid)}`} className="text-xs font-semibold text-violet-700 underline dark:text-violet-300">Open workspace →</Link>} /> : <p>Corporate Governance is HQ's alone.</p>) : !allowed ? <p>That Contracts tab is not available to this account.</p> : tab === 'agreements' ? <AgreementList filters={filters} onFilters={next => navigate('agreements', next)} onOpen={setSelected} revision={revision} />
      : tab === 'ndas' || tab === 'partner-deals' ? <RelatedLists key={tab} kind={tab} onOpen={setSelected} superAdmin={superAdmin} />
        : tab === 'templates' ? <AdminTemplates recordedPublication openSlug={params.get('open') || null} onOpenUsage={slug => navigate('agreements', { template: slug })}
            workspaceLink={(slug) => <Link to={`/admin/contracts/templates/doc/${encodeURIComponent(slug)}`} className="text-[11px] font-semibold text-violet-700 underline dark:text-violet-300">Open workspace →</Link>} />
          : tab === 'forms' ? <AdminForms /> : <ContractRegistryTab />}
    <p className="text-xs text-axal-muted">Formation orders live in Programs › Spin-Out Lab. <Link to="/admin/programs/spinout-lab/formation" className="underline">Open its Formation tab.</Link></p>
    {selected && <AgreementDetail uid={selected} onClose={() => setSelected(null)} onChanged={() => setRevision(n => n + 1)} />}
    {params.has('new') && <EnvelopeWizard onClose={() => { const next = new URLSearchParams(params); next.delete('new'); setParams(next); }} onTemplates={() => navigate('templates')} onSent={() => setRevision(n => n + 1)} />}
  </div></RailFrame>;
}
