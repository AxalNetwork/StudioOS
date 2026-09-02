import React from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, MultiChoiceField, ChoiceField } from '../components/OnboardingWizard';
import { useAuth } from '../hooks/useAuthSync';

// Phase 0.2 / Task #23 — Service-provider partner onboarding.
// Collects: firm details, service catalogue, specialties.
//
// Task #2 — The legacy KYB step deep-linked to /kyc, but KYC is now
// investor-only. Partner KYB lives in a separate flow and is no longer
// nudged from this wizard.
export default function OnboardingPartnerPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const steps = [
    {
      key: 'firm',
      title: 'Your firm',
      validate: (v) => (!v.firm_name?.trim() ? 'Add your firm name' : null),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <TextField label="Firm name" value={values.firm_name} onChange={(x) => set('firm_name', x)} />
          <TextField label="Website" value={values.website} onChange={(x) => set('website', x)} placeholder="https://" />
          <ChoiceField
            label="Firm type"
            options={['Solo / freelancer', 'Boutique (2–10)', 'Mid-market (11–50)', 'Large (50+)']}
            value={values.firm_size}
            onChange={(x) => set('firm_size', x)}
          />
        </div>
      ),
    },
    {
      key: 'catalog',
      title: 'Service catalog',
      description: 'Pick the services you offer to the studio and its portfolio.',
      validate: (v) => (Array.isArray(v.services) && v.services.length > 0 ? null : 'Pick at least one service'),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <MultiChoiceField
            label="Services"
            options={[
              'Legal — incorporation', 'Legal — contracts', 'Legal — IP',
              'Accounting / bookkeeping', 'Tax', 'Audit',
              'Recruiting', 'Engineering / fractional CTO', 'Design / brand',
              'Marketing / GTM', 'PR / comms', 'BD / sales',
              'HR / equity admin', 'Compliance / KYC',
            ]}
            value={values.services}
            onChange={(x) => set('services', x)}
          />
          <TextField
            label="Typical engagement fee (USD, optional)"
            type="number"
            value={values.fee_usd}
            onChange={(x) => set('fee_usd', x)}
          />
        </div>
      ),
    },
    {
      key: 'specialties',
      title: 'Specialties',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <MultiChoiceField
            label="Sectors you specialize in"
            options={['AI/ML', 'Climate', 'Fintech', 'Healthtech', 'Consumer', 'Enterprise SaaS', 'Crypto', 'Bio', 'Defense']}
            value={values.sectors}
            onChange={(x) => set('sectors', x)}
          />
          <MultiChoiceField
            label="Stages you serve"
            options={['Pre-seed', 'Seed', 'Series A', 'Series B+', 'Growth']}
            value={values.stages}
            onChange={(x) => set('stages', x)}
          />
          <TextArea label="Anything that makes you stand out?" value={values.differentiator} onChange={(x) => set('differentiator', x)} rows={3} />
        </div>
      ),
    },
  ];

  return (
    <div className="py-8">
      <OnboardingWizard
        flow="partner"
        steps={steps}
        finishLabel="Open Partner Portal"
        onFinish={() => navigate(user?.role === 'exploring' ? '/exploring' : '/partner-portal')}
      />
    </div>
  );
}
