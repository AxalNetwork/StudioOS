import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import OnboardingWizard, { TextField, TextArea, MultiChoiceField, ChoiceField } from '../components/OnboardingWizard';

// Phase 0.2 / Task #23 — Service-provider partner onboarding.
// Collects: service catalogue, KYB hand-off (Sumsub), specialties.
// The KYB step deep-links to the existing /kyc page, which already
// integrates Sumsub via the Cloudflare worker route.
export default function OnboardingPartnerPage() {
  const navigate = useNavigate();

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
    {
      key: 'kyb',
      title: 'Verify your firm (KYB)',
      description: 'KYB confirms you can transact with the studio. We use Sumsub.',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <div className="bg-violet-50 border border-violet-100 rounded-lg p-4 flex items-start gap-3">
            <ShieldCheck className="text-violet-600 mt-0.5" size={18} />
            <div className="text-sm text-violet-900">
              <div className="font-medium">Identity verification via Sumsub</div>
              <div className="text-violet-700 mt-1">
                You'll be redirected to our existing verification flow. Come back to finish onboarding when done.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.open('/kyc', '_blank', 'noopener')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-800"
          >
            Open verification in new tab <ArrowRight size={14} />
          </button>
          <ChoiceField
            label="Verification status"
            options={[
              { value: 'started', label: 'Started — will finish later' },
              { value: 'in_progress', label: 'Submitted, awaiting review' },
              { value: 'done', label: 'Verified' },
              { value: 'skip', label: 'Skip for now' },
            ]}
            value={values.kyb_status}
            onChange={(x) => set('kyb_status', x)}
          />
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
        onFinish={() => navigate('/partner-portal')}
      />
    </div>
  );
}
