import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../../lib/api.js';
import { accountLicencesApi } from '../../../lib/api/accountLicences.js';
import { dealFlowApi } from '../../../lib/api/dealFlow.js';
import { dealViewsApi } from '../../../lib/api/dealViews.js';
import { reportError } from '../../../lib/log';
import FirmStatusBlocks, { useRead } from './FirmStatusBlocks.jsx';
import FirmDealFit, { useDealFitSession } from './FirmDealFit.jsx';
import FirmTeamSeats from './FirmTeamSeats.jsx';
import { firmCompleteness, seatsIncluded } from './firmSettingsModel.js';

/**
 * D6287 part 2: every read and write the status blocks, the fit panel and Team
 * seats make, looked up at call time so a test can replace one method.
 * The two deal reads draw their own plan refusal, so the paywall modal stays shut.
 */
export const firmSettingsClient = {
  kycStatus: () => api.kycStatus(),
  fundsList: () => api.fundsList(),
  licences: () => accountLicencesApi.mine(),
  seats: () => api.listInvestorSeats(),
  inviteSeat: (email) => api.inviteInvestorSeat(email),
  revokeSeat: (id) => api.revokeInvestorSeat(id),
  dealFlow: () => dealFlowApi.flowInline(),
  dealFit: (ids) => dealViewsApi.fitInline(ids),
};

const SECTORS = ['AI/ML', 'Climate', 'Fintech', 'Healthtech', 'Consumer', 'Enterprise SaaS', 'Crypto', 'Bio', 'Defense', 'Robotics', 'Energy'];
const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B+', 'Growth'];
const GEOS = ['North America', 'Europe', 'LATAM', 'APAC', 'MENA', 'Africa'];
const TICKETS = ['<$10k', '$10k-$50k', '$50k-$250k', '$250k-$1M', '$1M+'];
const TYPES = [
  ['angel', 'Angel investor'], ['family_office', 'Family office'],
  ['institutional', 'Institutional LP'], ['fund_gp', 'Fund GP'],
];
const WEIGHTS = [
  ['mission_driven', 'Mission-driven founders'], ['technical_depth', 'Technical depth'],
  ['growth_trajectory', 'Growth trajectory'], ['team_diversity', 'Team diversity'], ['market_timing', 'Market timing'],
];
const FIELD = 'block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900';
const GROUP = 'min-w-0 space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800';

function OptionGroup({ name, label, options, draft, onChange }) {
  const selected = draft[name] || [];
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {selected.length === 0 && <span className="w-full text-sm text-gray-500 dark:text-gray-400">Not recorded</span>}
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <button
              key={option} type="button" aria-pressed={checked}
              onClick={() => onChange(name, checked ? selected.filter((item) => item !== option) : [...selected, option])}
              className={`rounded-full border px-3 py-1 text-sm ${checked ? 'border-violet-600 bg-violet-100 dark:bg-violet-900' : 'border-gray-300 dark:border-gray-700'}`}
            >{option}</button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function InvestorFirmEditor({ profile, onSave, onEdit }) {
  const [changes, setChanges] = useState({});
  const [saveState, setSaveState] = useState('idle');
  const draft = { ...profile, ...changes };
  const dirty = Object.keys(changes).length > 0;
  function change(key, value) {
    setChanges((previous) => ({ ...previous, [key]: value }));
    setSaveState('idle');
    onEdit?.();
  }

  async function save(event) {
    event.preventDefault();
    if (!dirty || saveState === 'saving') return;
    setSaveState('saving');
    try {
      await onSave({ ...changes, contribute_to_signals: draft.contribute_to_signals !== false });
      setChanges({});
      setSaveState('saved');
    } catch (error) {
      reportError('InvestorFirmSettings.save', error);
      setSaveState('error');
    }
  }

  return (
    <form onSubmit={save} className="min-w-0 space-y-4">
      <fieldset disabled={saveState === 'saving'} className="min-w-0 space-y-4">
        <section className={GROUP} aria-labelledby="firm-profile">
          <h2 id="firm-profile" className="text-base font-semibold">Firm profile</h2>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label>Firm name
              <input className={FIELD} maxLength={120} placeholder="Not recorded" value={draft.firm_name ?? ''} onChange={(e) => change('firm_name', e.target.value)} />
            </label>
            <label>Investor type
              <select className={FIELD} value={draft.investor_type ?? ''} onChange={(e) => change('investor_type', e.target.value || null)}>
                <option value="">Not recorded</option>
                {draft.investor_type && !TYPES.some(([value]) => value === draft.investor_type) && (
                  <option value={draft.investor_type}>{draft.investor_type}</option>
                )}
                {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Check size
              <select className={FIELD} value={draft.ticket_band ?? ''} onChange={(e) => change('ticket_band', e.target.value || null)}>
                <option value="">Not recorded</option>
                {TICKETS.map((ticket) => <option key={ticket}>{ticket}</option>)}
              </select>
            </label>
          </div>
        </section>
        <section className={GROUP} aria-labelledby="my-thesis">
          <h2 id="my-thesis" className="scroll-mt-6 text-base font-semibold">My thesis</h2>
          <OptionGroup name="sectors" label="Sectors" options={SECTORS} draft={draft} onChange={change} />
          <OptionGroup name="stages" label="Stages" options={STAGES} draft={draft} onChange={change} />
          <OptionGroup name="geos" label="Geographies" options={GEOS} draft={draft} onChange={change} />
          <label className="block">Thesis statement
            <textarea className={FIELD} rows={3} maxLength={2000} placeholder="Not recorded" value={draft.thesis_text ?? ''} onChange={(e) => change('thesis_text', e.target.value)} />
          </label>
          <OptionGroup name="anti_thesis_sectors" label="Excluded sectors" options={SECTORS} draft={draft} onChange={change} />
          <OptionGroup name="anti_thesis_stages" label="Excluded stages" options={STAGES} draft={draft} onChange={change} />
          <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Value weights</legend>
            {WEIGHTS.map(([key, label]) => (
              <label key={key}>{label}
                <input
                  type="number" min="0" max="1" step="0.05" placeholder="Not recorded" className={FIELD}
                  value={draft.value_weights?.[key] ?? ''}
                  onChange={(e) => {
                    const next = { ...draft.value_weights };
                    if (e.target.value === '') delete next[key];
                    else next[key] = e.target.valueAsNumber;
                    change('value_weights', next);
                  }}
                />
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={draft.contribute_to_signals !== false}
              onChange={(e) => change('contribute_to_signals', e.target.checked)} />
            Contribute my answers to anonymized Investor Signals
          </label>
        </section>
      </fieldset>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <p role="status" className="text-sm text-gray-600 dark:text-gray-400">
          {saveState === 'error' ? 'Save failed. Your changes are still here.' : saveState === 'saved' ? 'Saved' : 'Saves firm profile and thesis together.'}
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={!dirty || saveState === 'saving'} onClick={() => { setChanges({}); setSaveState('idle'); }}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Discard</button>
          <button type="submit" disabled={!dirty || saveState === 'saving'}
            className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}

function Completeness({ profile }) {
  const c = firmCompleteness(profile);
  if (!c) return null;
  return c.complete
    ? <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" data-testid="firm-complete">✓ Complete</span>
    : <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300" data-testid="firm-complete">▲ Needs: {c.needs.join(', ')}</span>;
}

export default function InvestorFirmSettings({ companyLink, client = firmSettingsClient }) {
  const { hash, search } = useLocation();
  const from = new URLSearchParams(search).get('from');
  const back = from === 'home' ? { to: '/studio', label: 'Back to Investor Home' }
    : from === 'deal-flow' ? { to: '/deals', label: 'Back to Deal flow' } : null;
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState({ status: 'loading' });
  // The licences and seats reads are shared by the status blocks and Team seats.
  const [licencesRead, retryLicences] = useRead(() => client.licences(), (e) => reportError('FirmSettings:licences', e));
  const [seatsRead, retrySeats] = useRead(() => client.seats(), (e) => reportError('FirmSettings:seats', e));
  const licences = useMemo(() => ({ read: licencesRead, retry: retryLicences }), [licencesRead, retryLicences]);
  const seats = useMemo(() => ({ read: seatsRead, retry: retrySeats }), [seatsRead, retrySeats]);
  const included = seatsIncluded(licencesRead);
  const fit = useDealFitSession(client);

  useEffect(() => {
    let active = true;
    setRead({ status: 'loading' });
    Promise.resolve().then(() => api.getInvestorProfile()).then(({ profile }) => {
      if (active) setRead(profile ? { status: 'ready', profile } : { status: 'error' });
    }, (error) => {
      reportError('InvestorFirmSettings.read', error);
      if (active) setRead({ status: 'error' });
    });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (hash === '#my-thesis' && read.status === 'ready') document.getElementById?.('my-thesis')?.scrollIntoView?.();
  }, [hash, read.status]);

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl space-y-4 px-4 py-6 md:px-7">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Firm Settings</h1>
          {read.status === 'ready' && <Completeness profile={read.profile} />}
        </div>
        {companyLink && <Link to={companyLink.to} className="break-words text-sm font-medium text-violet-700 underline dark:text-violet-300">{companyLink.label}</Link>}
      </header>
      {back && <Link to={back.to} className="text-sm font-medium text-violet-700 underline dark:text-violet-300">{back.label}</Link>}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {read.status === 'loading' && <p role="status">Loading firm settings…</p>}
          {read.status === 'error' && (
            <div role="status" className={GROUP}>
              <p className="font-semibold">Firm settings unavailable.</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">No form is shown, so nothing on this page can overwrite what is saved. The status blocks read separately.</p>
              <button type="button" className="font-semibold underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            </div>
          )}
          {read.status === 'ready' && (
            <InvestorFirmEditor profile={read.profile} onEdit={fit.prime} onSave={async (body) => {
              const before = await fit.beforeSave();
              const { profile } = await api.saveInvestorProfile(body);
              if (!profile) throw new Error('Profile missing from save response');
              setRead({ status: 'ready', profile });
              fit.afterSave(before);
            }} />
          )}
          {fit.round && <FirmDealFit client={client} round={fit.round} onRead={fit.remember} />}
          <FirmTeamSeats client={client} read={seatsRead} retry={retrySeats} included={included} />
        </div>
        <aside aria-label="Firm status" className="order-first min-w-0 lg:order-none">
          <FirmStatusBlocks client={client} profileRead={read} licences={licences} seats={seats} included={included} />
        </aside>
      </div>
    </main>
  );
}
