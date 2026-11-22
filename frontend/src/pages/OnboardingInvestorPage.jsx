import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, ChoiceField, MultiChoiceField, SelectField } from '../components/OnboardingWizard';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { COUNTRIES } from '../lib/countries';
import { NFX_SECTORS } from '../lib/nfxSectors';
import { investorFundHref, investorLanding, investorProfilePayload, investorResumeStep } from '../lib/onboarding';
import { OnboardingCanvas } from '../components/auth/AuthShell';

const ENTITY_FIELDS = [
  ['entity_name', 'Legal entity name'], ['registration_number', 'Registration number'],
  ['signing_authority_name', 'Signing authority · name'], ['signing_authority_title', 'Signing authority · title'],
];
const ENTITY_TYPES = ['llc', 'c_corp', 's_corp', 'b_corp', 'ltd', 'plc', 'gmbh', 'ug', 'ag', 'sa', 'sas', 'sarl', 'bv', 'nv', 'spa', 'srl', 'ab', 'as', 'oy', 'pte_ltd', 'pty_ltd', 'kk', 'gk', 'sole_proprietorship', 'partnership', 'other'];
function EntityDetails({ values, set }) {
  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (values._entity || values._entity_skipped) { setState('ready'); return; }
    let live = true;
    setState('loading');
    api.getCorporateProfile().then(row => {
      if (!live) return;
      const keys = [...ENTITY_FIELDS.map(([key]) => key), 'entity_type', 'registered_country'];
      set('_entity', Object.fromEntries(keys.map(key => [key, row?.[key] || '']))); setState('ready');
    }).catch(() => { if (live) setState('unreadable'); });
    return () => { live = false; };
  }, [attempt, set]);
  const change = (key, value) => { set('_entity', { ...values._entity, [key]: value }); set('_entity_dirty', true); };
  return <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700" aria-label="Entity details">
    <h3 className="font-semibold">Entity details <span className="text-sm font-normal">(optional)</span></h3>
    <p className="my-2 text-sm text-gray-600 dark:text-gray-300">Saves to your account’s entity record when you continue. Add these later in Trust → Entity.</p>
    {values._entity_skipped ? <><p>Skipped</p><button type="button" onClick={() => { set('_entity_skipped', false); setAttempt(n => n + 1); }}>Add entity details</button></>
      : <>
        <button type="button" className="mb-3 min-h-11 text-sm underline" onClick={() => { set('_entity_skipped', true); set('_entity_dirty', false); }}>Skip entity for now</button>
        {state === 'loading' ? <p role="status">Reading entity details…</p> : state === 'unreadable' ? <div role="alert">Entity details are unreadable. <button type="button" onClick={() => setAttempt(n => n + 1)}>Try entity again</button></div> :
          <div className="grid gap-4 sm:grid-cols-2">
            {ENTITY_FIELDS.map(([key, label]) => <TextField key={key} label={label} value={values._entity?.[key]} onChange={value => change(key, value)} />)}
            <SelectField label="Entity type" options={ENTITY_TYPES} value={values._entity?.entity_type} onChange={value => change('entity_type', value)} />
            <SelectField label="Registered country" options={COUNTRIES} value={values._entity?.registered_country} onChange={value => change('registered_country', value)} />
          </div>}
      </>}
  </section>;
}

function ReviewAnswers({ values, edit }) {
  const display = value => Array.isArray(value) ? value.length ? value.join(', ') : 'None picked' : value || 'Not recorded';
  const type = { angel: 'Angel investor', family_office: 'Family office', institutional: 'Institutional LP', fund_gp: 'Fund GP' };
  const accreditation = { accredited: 'Accredited (US)', qp: 'Qualified Purchaser', non_us: 'Non-US investor', not_sure: 'Not sure yet' };
  const intent = { yes_now: 'Yes, ready to commit this cycle', maybe: 'Open, want more info', deal_only: 'Deal-by-deal only for now', no: 'Not at this time' };
  const entityLabels = Object.fromEntries([...ENTITY_FIELDS, ['entity_type', 'Entity type'], ['registered_country', 'Registered country']]);
  const groups = [
    ['profile', 'Who you are', [['Investor type', type[values.investor_type] || values.investor_type], ['Firm or family office', values.firm_name], ['Entity details', values._entity_skipped ? 'Skipped' : values._entity ? Object.entries(values._entity).filter(([key, v]) => entityLabels[key] && v).map(([key, v]) => `${entityLabels[key]}: ${v}`).join('; ') : null]]],
    ['accreditation', 'Accreditation', [['US accreditation status · You told us, not verified', accreditation[values.accreditation_status] || values.accreditation_status], ['Country of residence', values.country]]],
    ['check', 'Check size and stages', [['Typical check size', values.check_size], ['Stages', values.stages]]],
    ['sectors', 'Sectors and regions', [['Sectors', values.sectors], ['Regions', values.geos]]],
    ['anti-thesis', 'Exclusions', [['Excluded sectors', values.anti_thesis_sectors || []], ['Excluded stages', values.anti_thesis_stages || []]]],
    ['thesis', 'Investment thesis', [['Thesis', values.thesis_text], ['Contribute to Investor Signals', values.contribute_to_signals === false ? 'No' : 'Yes']]],
    ['lp_intent', 'Fund interest', [['LP intent', intent[values.lp_intent] || values.lp_intent], ['Target commitment (USD)', values.lp_target_usd], ['Notes', values.notes]]],
  ];
  return <div className="space-y-4">{groups.map(([key, title, rows]) => <section key={key} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{title}</h3><button type="button" className="min-h-11 shrink-0 text-sm text-violet-700 underline dark:text-violet-300" aria-label={`Edit ${title}`} onClick={() => edit(key)}>Edit</button></div>
    {values._skipped?.includes(key) ? <p className="text-sm">Skipped</p> : <dl className="space-y-2 text-sm">{rows.map(([label, value]) => <div key={label}><dt className="text-gray-600 dark:text-gray-400">{label}</dt><dd className="break-words text-gray-900 dark:text-gray-100">{display(value)}</dd></div>)}</dl>}
  </section>)}</div>;
}

// D6135 (#6135): saved onboarding answers, an honest profile-copy result,
// and an explicit, role-safe handoff after the final step.
export function InvestorOnboardingFinish({ values, role, onContinue, onFund, autoSave = true }) {
  const [status, setStatus] = useState(autoSave ? 'saving' : 'unconfirmed');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!autoSave && attempt === 0) return undefined;
    let alive = true;
    setStatus('saving');
    Promise.resolve().then(() => api.saveInvestorProfile(investorProfilePayload(values)))
      .then(() => { if (alive) setStatus('saved'); })
      .catch(() => { if (alive) setStatus('failed'); });
    return () => { alive = false; };
  }, [values, autoSave, attempt]);
  const fund = investorFundHref(role, values.lp_intent);
  const fundReady = status === 'saved' && fund && values.lp_intent === 'yes_now';
  const button = 'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold';
  return (
    <section className="mx-auto w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-6 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="investor-finish">
      {status === 'saving' ? <p aria-busy="true">Saving your investor profile…</p>
        : status === 'failed' || status === 'unconfirmed' ? <>
          <h2 className="text-lg font-semibold" role={status === 'failed' ? 'alert' : undefined}>{status === 'failed' ? 'Your profile was not saved' : 'Your onboarding answers are saved'}</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{status === 'failed' ? 'Your answers are kept in your onboarding progress.' : 'Save these answers to your investor profile, or continue without changing it.'}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={`${button} bg-violet-700 text-white dark:bg-violet-600`} data-testid="investor-profile-retry" onClick={() => { setStatus('saving'); setAttempt((n) => n + 1); }}>{status === 'failed' ? 'Try again' : 'Save profile'}</button>
            <button type="button" className={`${button} border border-gray-300 dark:border-gray-600`} data-testid="investor-profile-skip" onClick={() => setStatus('skipped')}>Continue anyway</button>
          </div>
        </> : <>
          <h2 className="text-lg font-semibold">{status === 'saved' ? 'Your profile is saved' : 'Continue without saving your profile'}</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {fundReady && <button type="button" className={`${button} bg-violet-700 text-white dark:bg-violet-600`} data-testid="investor-fund" onClick={() => onFund(fund)}>Review fund application</button>}
            <button type="button" className={`${button} ${fundReady ? 'border border-gray-300 dark:border-gray-600' : 'bg-violet-700 text-white dark:bg-violet-600'}`} data-testid="investor-deals" onClick={onContinue}>{role === 'exploring' ? 'See membership status' : 'See deal flow'}</button>
            {fund && !fundReady && <button type="button" className={`${button} border border-gray-300 dark:border-gray-600`} data-testid="investor-fund" onClick={() => onFund(fund)}>Open the Axal VC Fund</button>}
          </div>
        </>}
    </section>
  );
}

export default function OnboardingInvestorPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // The thesis and the anti-thesis are drawn from ONE list — see
  // lib/nfxSectors.js for why it is the NFX taxonomy here and not the Axal
  // one that classifies companies.
  const SECTORS = NFX_SECTORS;
  const STAGES = ['Pre-seed','Seed','Series A','Series B+','Growth'];
  const GEOS = ['North America','Europe','LATAM','APAC','MENA','Africa'];
  const TICKETS = ['<$10k', '$10k-$50k', '$50k-$250k', '$250k-$1M', '$1M+'];

  const legacySteps = [
    {
      key: 'profile',
      title: 'Welcome, investor',
      description: 'A few questions to set the thesis fit shown on deals and, with your consent, contribute to anonymised Investor Signals.',
      validate: (v) => (!v.investor_type ? 'Pick what best describes you' : null),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="What best describes you?"
            options={[
              { value: 'angel', label: 'Angel investor' },
              { value: 'family_office', label: 'Family office' },
              { value: 'institutional', label: 'Institutional LP' },
              { value: 'fund_gp', label: 'Fund GP' },
            ]}
            value={values.investor_type}
            onChange={(x) => set('investor_type', x)}
          />
          <TextField label="Firm or family office (if applicable)" value={values.firm_name} onChange={(x) => set('firm_name', x)} />
          {['family_office', 'institutional', 'fund_gp'].includes(values.investor_type) && <EntityDetails values={values} set={set} />}
        </div>
      ),
    },
    {
      key: 'accreditation',
      title: 'Accreditation',
      description: 'You told us · not verified. Your answer is saved as you gave it. Verification happens in the identity check after onboarding.',
      validate: (v) => {
        if (!v.accreditation_status) return 'Confirm your accreditation status';
        // Required, because accreditation is a jurisdiction question: "Non-US
        // investor" and "Accredited (US)" mean different things in different
        // countries, and a blank country leaves the answer unreadable.
        if (!v.country) return 'Select your country of residence';
        return null;
      },
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="US accreditation status"
            options={[
              { value: 'accredited', label: 'Accredited (US)' },
              { value: 'qp', label: 'Qualified Purchaser' },
              { value: 'non_us', label: 'Non-US investor' },
              { value: 'not_sure', label: 'Not sure yet' },
            ]}
            value={values.accreditation_status}
            onChange={(x) => set('accreditation_status', x)}
          />
          <SelectField
            label="Country of residence"
            options={COUNTRIES}
            value={values.country}
            onChange={(x) => set('country', x)}
            placeholder="Select a country…"
            required
          />
        </div>
      ),
    },
    {
      key: 'check',
      title: 'Check size & stage',
      validate: (v) => (!v.check_size ? 'Pick a typical check size' : (!v.stages?.length ? 'Select at least one stage' : null)),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="Typical check size per deal"
            options={TICKETS}
            value={values.check_size}
            onChange={(x) => set('check_size', x)}
          />
          <MultiChoiceField
            label="Stages you invest in"
            options={STAGES}
            value={values.stages}
            onChange={(x) => set('stages', x)}
          />
        </div>
      ),
    },
    {
      key: 'sectors',
      title: 'Sectors of interest',
      description: 'These answers set the thesis fit shown on deals. With your consent, they also contribute to anonymised Axal VC Investor Signals.',
      validate: (v) => (!v.sectors?.length ? 'Select at least one sector' : null),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <MultiChoiceField
            label="Sectors"
            options={SECTORS}
            searchable
            value={values.sectors}
            onChange={(x) => set('sectors', x)}
          />
          <MultiChoiceField label="Regions" options={GEOS} value={values.geos} onChange={(x) => set('geos', x)} />
        </div>
      ),
    },
    {
      key: 'geo',
      title: 'Where do you invest?',
      description: 'Pick all regions where you actively deploy capital.',
      validate: (v) => (!v.geos?.length ? 'Select at least one region' : null),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <MultiChoiceField
            label="Regions"
            options={GEOS}
            value={values.geos}
            onChange={(x) => set('geos', x)}
          />
        </div>
      ),
    },
    {
      key: 'thesis',
      title: 'Your thesis in one paragraph',
      description: 'A few sentences on what you look for. With your consent, words may appear in the public thesis cloud, anonymised and only when shared by at least five investors.',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <TextArea
            label="Investment thesis"
            value={values.thesis_text}
            onChange={(x) => set('thesis_text', x)}
            placeholder="e.g. Pre-seed founders building AI-native infrastructure for vertical SaaS markets. Bias toward technical founders with prior exit."
            rows={5}
            className="min-h-[160px] resize-none"
          />
          <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={values.contribute_to_signals !== false}
              onChange={(e) => set('contribute_to_signals', e.target.checked)}
              className="w-4 h-4 text-violet-600 rounded"
            />
            Contribute my answers (fully anonymized, k≥5) to the Axal VC Investor Signals dashboard. You can change this later in Settings → Privacy.
          </label>
        </div>
      ),
    },
    {
      key: 'anti-thesis',
      title: 'Anti-thesis (hard exclusions)',
      description: 'These exclusions inform the thesis fit shown on deals.',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <MultiChoiceField
            label="Sectors you actively avoid"
            options={SECTORS}
            searchable
            disabledValues={values.sectors || []}
            value={values.anti_thesis_sectors || []}
            onChange={(x) => set('anti_thesis_sectors', x)}
          />
          <MultiChoiceField
            label="Stages you actively avoid"
            options={STAGES}
            value={values.anti_thesis_stages || []}
            onChange={(x) => set('anti_thesis_stages', x)}
          />
        </div>
      ),
    },
    {
      key: 'lp_intent',
      title: 'LP commitment intent',
      description: 'Are you exploring an LP commitment to the Axal VC main fund?',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="LP intent"
            options={[
              { value: 'yes_now', label: 'Yes, ready to commit this cycle' },
              { value: 'maybe', label: 'Open, want more info' },
              { value: 'deal_only', label: 'Deal-by-deal only for now' },
              { value: 'no', label: 'Not at this time' },
            ]}
            value={values.lp_intent}
            onChange={(x) => set('lp_intent', x)}
          />
          <TextField
            label="Target LP commitment (USD, optional)"
            type="number"
            value={values.lp_target_usd}
            onChange={(x) => set('lp_target_usd', x)}
          />
          <TextArea label="Anything else we should know?" value={values.notes} onChange={(x) => set('notes', x)} rows={3} />
        </div>
      ),
    },
  ];

  const byKey = Object.fromEntries(legacySteps.map(step => [step.key, step]));
  const optional = {
    'anti-thesis': ['anti_thesis_sectors', 'anti_thesis_stages'],
    thesis: ['thesis_text'], lp_intent: ['lp_intent', 'lp_target_usd', 'notes'],
  };
  const steps = ['profile', 'accreditation', 'check', 'sectors', 'anti-thesis', 'thesis', 'lp_intent'].map(key => ({
    ...byKey[key],
    ...(key === 'sectors' ? { title: 'Sectors and regions', validate: v => !v.sectors?.length ? 'Select at least one sector' : !v.geos?.length ? 'Select at least one region' : null } : {}),
    ...(optional[key] ? { skip: { label: 'Skip for now', clears: optional[key] } } : {}),
    ...(key === 'profile' ? { beforeAdvance: async v => {
      if (['family_office', 'institutional', 'fund_gp'].includes(v.investor_type) && v._entity_dirty && !v._entity_skipped) await api.updateCorporateProfile(v._entity);
    } } : {}),
  }));
  steps.push({ key: 'review', title: 'Review your answers', description: 'Check every answer before finishing your profile.', render: ReviewAnswers });

  const continueToDeals = () => navigate(investorLanding(user?.role), { replace: true });

  return (
    <OnboardingCanvas>
      <OnboardingWizard
        flow="investor"
        steps={steps}
        onDark
        finishLabel="Finish profile"
        requireFinalSave
        reviewFlow={{ resumeStep: investorResumeStep }}
        renderComplete={(values, { resumed }) => <InvestorOnboardingFinish values={values} role={user?.role} autoSave={!resumed}
          onContinue={continueToDeals} onFund={(href) => navigate(href, { replace: true })} />}
      />
    </OnboardingCanvas>
  );
}
