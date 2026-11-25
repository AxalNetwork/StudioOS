/** #5830/#5841: existing connector page's venture-scoped survey/search task; membership list and OAuth remain canonical. */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { accountCompaniesApi } from '../../lib/api/accountCompanies';
import { connectorsApi } from '../../lib/api/connectors';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import { useAuth } from '../../hooks/useAuthSync';
import SearchConsoleResults from '../cycles/distribution/SearchConsoleResults';
import TypeformJourney from '../cycles/TypeformJourney';

const BUTTON = 'min-h-[44px] cursor-pointer rounded-lg border border-axal-hairline px-3 py-2 hover:border-axal-violet focus-visible:outline focus-visible:outline-2 disabled:cursor-default dark:border-gray-700';
const TARGETS = { google_search_console: '/grow/distribution/results', typeform: '/validate/customer-research' };
export default function ConnectorPilotSection({ provider }) {
  const { company } = useActiveCompany();
  const auth = useAuth();
  return <Pilot key={`${provider}:${auth?.user?.id}:${company?.id}`} provider={provider} companyId={company?.id} />;
}
function Pilot({ provider, companyId }) {
  const [params, setParams] = useSearchParams();
  const [ventures, setVentures] = useState(null), [round, setRound] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [region, setRegion] = useState('us');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const project = Number(params.get('project_id'));
  const selected = Array.isArray(ventures) ? ventures.find(v => Number(v.id) === project) : null;
  useEffect(() => {
    let live = true;
    accountCompaniesApi.projects().then(out => { if (live) setVentures((out.projects || []).filter(v => Number(v.company_id) === Number(companyId))); }).catch(() => { if (live) setVentures(false); });
    return () => { live = false; };
  }, [companyId, round]);
  const connect = async () => {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const out = await connectorsApi.oauthStart(provider, { return_to: provider === 'typeform' ? 'validate_research' : 'grow_results', project_id: String(project), ...(provider === 'typeform' ? { region } : {}) }, { companyId });
      if (!alive.current) return;
      const url = new URL(out?.authorize_url);
      const allowed = provider === 'typeform' ? ['https://api.typeform.com', 'https://api.eu.typeform.com'] : ['https://accounts.google.com'];
      if (!allowed.includes(url.origin) || url.username || url.password) throw new Error('unsafe_consent');
      window.location.assign(url.href);
    } catch { if (alive.current) { setError('Sign-in could not be opened. Use the connector’s availability and consent status above, then try again.'); setBusy(false); } }
  };
  return <section className="min-w-0 space-y-3" aria-label="Connector venture task">
    <h2 className="font-bold">Use this connection for a venture</h2>
    {ventures === null ? <p role="status">Reading ventures…</p> : ventures === false ? <><p role="alert">Your ventures could not be read.</p><button type="button" className={BUTTON} onClick={() => setRound(n => n + 1)}>Retry ventures</button></> : <label className="flex flex-col gap-1">Venture<select className={`${BUTTON} bg-white dark:bg-gray-900`} value={selected ? project : ''} onChange={e => { const next = new URLSearchParams(params); if (e.target.value) next.set('project_id', e.target.value); else next.delete('project_id'); setParams(next); }}><option value="">Choose a venture in the selected company</option>{ventures.map(v => <option key={v.id} value={v.id}>{v.name || 'Untitled venture'}</option>)}</select></label>}
    {selected && <>{provider === 'typeform' && <label className="flex flex-col gap-1">Typeform data center<select className={`${BUTTON} bg-white dark:bg-gray-900`} value={region} onChange={e => setRegion(e.target.value)}><option value="us">United States</option><option value="eu">Europe</option></select></label>}<div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={busy} onClick={connect}>{busy ? 'Opening sign-in…' : 'Connect for this venture'}</button><Link className={BUTTON} to={`${TARGETS[provider]}?project_id=${project}`}>Return to {provider === 'typeform' ? 'Customer research' : 'Distribution results'}</Link></div>{provider === 'typeform' ? <TypeformJourney projectId={project} /> : <SearchConsoleResults projectId={project} />}</>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
