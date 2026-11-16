import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, ChoiceField, MultiChoiceField, SelectField } from '../components/OnboardingWizard';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { COUNTRIES } from '../lib/countries';
import { NFX_SECTORS } from '../lib/nfxSectors';
import { investorFundHref, investorLanding, investorProfilePayload } from '../lib/onboarding';
import { OnboardingCanvas } from '../components/auth/AuthShell';

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
            <button type="button" className={`${button} bg-violet-700 text-white dark:bg-violet-600`} data-testid="investor-deals" onClick={onContinue}>{role === 'exploring' ? 'See membership status' : 'See deal flow'}</button>
            {fund && <button type="button" className={`${button} border border-gray-300 dark:border-gray-600`} data-testid="investor-fund" onClick={() => onFund(fund)}>Open the Axal VC Fund</button>}
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

  const steps = [
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
        </div>
      ),
    },
    {
      key: 'accreditation',
      title: 'Accreditation',
      description: 'Required so we can show you private placement opportunities.',
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
            value={values.sectors}
            onChange={(x) => set('sectors', x)}
          />
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

  const continueToDeals = () => navigate(investorLanding(user?.role), { replace: true });

  return (
    <OnboardingCanvas>
      <OnboardingWizard
        flow="investor"
        steps={steps}
        onDark
        finishLabel="Finish profile"
        requireFinalSave
        renderComplete={(values, { resumed }) => <InvestorOnboardingFinish values={values} role={user?.role} autoSave={!resumed}
          onContinue={continueToDeals} onFund={(href) => navigate(href, { replace: true })} />}
      />
    </OnboardingCanvas>
  );
}
