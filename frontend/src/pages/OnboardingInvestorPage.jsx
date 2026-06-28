import React from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, ChoiceField, MultiChoiceField, SliderField } from '../components/OnboardingWizard';
import { api } from '../lib/api';

// Phase 0.2 / Task #23 — Investor onboarding wizard.
// Task #4 (2026-05-10) — extended into a 6-step profiling chatbot whose
// answers are also persisted to /api/investor-profile/me on finish so they
// flow into the anonymized "Axal VC Investor Signals" aggregate.
export default function OnboardingInvestorPage() {
  const navigate = useNavigate();

  const SECTORS = ['AI/ML','Climate','Fintech','Healthtech','Consumer','Enterprise SaaS','Crypto','Bio','Defense','Robotics','Energy'];
  const STAGES = ['Pre-seed','Seed','Series A','Series B+','Growth'];
  const GEOS = ['North America','Europe','LATAM','APAC','MENA','Africa'];
  const TICKETS = ['<$10k', '$10k-$50k', '$50k-$250k', '$250k-$1M', '$1M+'];

  const steps = [
    {
      key: 'profile',
      title: 'Welcome, investor',
      description: 'A few questions so we can match you with the right deal flow.',
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
      validate: (v) => (!v.accreditation_status ? 'Confirm your accreditation status' : null),
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
          <TextField label="Country of residence" value={values.country} onChange={(x) => set('country', x)} placeholder="United States" />
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
      description: 'Pick the areas you actively look at — we use these to surface relevant deals and to compute the anonymized Axal VC Investor Signals heatmap.',
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
      description: 'A few sentences on what you look for. Words you mention may surface (anonymized, only if 5+ investors say the same thing) in the public thesis cloud.',
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
      description: 'We will NEVER match you with projects that fall in these sectors or stages.',
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
      key: 'value-weights',
      title: 'What matters most to you',
      description: 'Weight how much each dimension matters in founder-investor matching. Weights are auto-normalized.',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <SliderField label="Mission-driven founders" value={values.mission_driven || 0.5} onChange={(x) => set('mission_driven', x)} />
          <SliderField label="Technical depth" value={values.technical_depth || 0.5} onChange={(x) => set('technical_depth', x)} />
          <SliderField label="Growth trajectory" value={values.growth_trajectory || 0.5} onChange={(x) => set('growth_trajectory', x)} />
          <SliderField label="Team diversity" value={values.team_diversity || 0.5} onChange={(x) => set('team_diversity', x)} />
          <SliderField label="Market timing" value={values.market_timing || 0.5} onChange={(x) => set('market_timing', x)} />
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

  const handleFinish = async (values) => {
    // Mirror the chatbot answers to the investor-profile endpoint so they
    // feed the anonymized Axal VC Investor Signals aggregate. Failure must
    // never block onboarding completion — it's a soft enrichment.
    try {
      const value_weights = {
        mission_driven: values.mission_driven ?? 0.5,
        technical_depth: values.technical_depth ?? 0.5,
        growth_trajectory: values.growth_trajectory ?? 0.5,
        team_diversity: values.team_diversity ?? 0.5,
        market_timing: values.market_timing ?? 0.5,
      };
      await api.saveInvestorProfile({
        investor_type: values.investor_type || null,
        sectors: values.sectors || [],
        stages: values.stages || [],
        geos: values.geos || [],
        ticket_band: values.check_size || null,
        thesis_text: values.thesis_text || null,
        contribute_to_signals: values.contribute_to_signals !== false,
        anti_thesis_sectors: values.anti_thesis_sectors || [],
        anti_thesis_stages: values.anti_thesis_stages || [],
        value_weights,
      });
    } catch {
      // Surfacing this in the wizard would be confusing; the user can
      // re-save anytime from Settings → Privacy.
    }
    navigate('/studio');
  };

  return (
    <div className="py-8">
      <OnboardingWizard
        flow="investor"
        steps={steps}
        finishLabel="See deal flow"
        onFinish={handleFinish}
      />
    </div>
  );
}
