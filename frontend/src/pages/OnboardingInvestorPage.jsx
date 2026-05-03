import React from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, ChoiceField, MultiChoiceField } from '../components/OnboardingWizard';

// Phase 0.2 / Task #23 — Investor onboarding wizard.
// Collects: accreditation, check size, sector / stage focus, LP intent.
export default function OnboardingInvestorPage() {
  const navigate = useNavigate();

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
      key: 'thesis',
      title: 'Check size & focus',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="Typical check size per deal"
            options={['<$10k', '$10k – $50k', '$50k – $250k', '$250k – $1M', '$1M+']}
            value={values.check_size}
            onChange={(x) => set('check_size', x)}
          />
          <MultiChoiceField
            label="Stages you invest in"
            options={['Pre-seed', 'Seed', 'Series A', 'Series B+', 'Growth']}
            value={values.stages}
            onChange={(x) => set('stages', x)}
          />
          <MultiChoiceField
            label="Sectors of interest"
            options={['AI/ML', 'Climate', 'Fintech', 'Healthtech', 'Consumer', 'Enterprise SaaS', 'Crypto', 'Bio', 'Defense']}
            value={values.sectors}
            onChange={(x) => set('sectors', x)}
          />
        </div>
      ),
    },
    {
      key: 'lp_intent',
      title: 'LP commitment intent',
      description: 'Are you exploring an LP commitment to the Axal main fund?',
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

  return (
    <div className="py-8">
      <OnboardingWizard
        flow="investor"
        steps={steps}
        finishLabel="See deal flow"
        onFinish={() => navigate('/dashboard')}
      />
    </div>
  );
}
