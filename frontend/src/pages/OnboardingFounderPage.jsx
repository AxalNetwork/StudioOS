import React from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, ChoiceField } from '../components/OnboardingWizard';

// Phase 0.2 / Task #23 — Founder onboarding wizard.
// Light intake before handing off to the existing FounderPortal where
// the rich project-submission flow lives.
export default function OnboardingFounderPage() {
  const navigate = useNavigate();

  const steps = [
    {
      key: 'intro',
      title: 'Welcome to Axal VC',
      description: "Let's set up your founder profile. Takes about a minute.",
      validate: (v) => (!v.full_name?.trim() ? 'Tell us your name' : null),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <TextField label="Your full name" value={values.full_name} onChange={(x) => set('full_name', x)} placeholder="Jane Doe" />
          <TextField label="LinkedIn (optional)" value={values.linkedin} onChange={(x) => set('linkedin', x)} placeholder="https://linkedin.com/in/…" />
        </div>
      ),
    },
    {
      key: 'company',
      title: 'About your venture',
      validate: (v) => (!v.company_name?.trim() ? 'Add a working name for the venture' : null),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <TextField label="Working name" value={values.company_name} onChange={(x) => set('company_name', x)} placeholder="Acme AI" />
          <TextField label="One-line pitch" value={values.tagline} onChange={(x) => set('tagline', x)} placeholder="What do you do, in one sentence?" />
          <ChoiceField
            label="Stage"
            options={['Idea', 'Prototype', 'MVP', 'Revenue', 'Scaling']}
            value={values.stage}
            onChange={(x) => set('stage', x)}
          />
        </div>
      ),
    },
    {
      key: 'thesis',
      title: 'Problem & solution',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <TextArea label="What problem are you solving?" value={values.problem} onChange={(x) => set('problem', x)} rows={3} />
          <TextArea label="How are you solving it?" value={values.solution} onChange={(x) => set('solution', x)} rows={3} />
          <TextArea label="Why now?" value={values.why_now} onChange={(x) => set('why_now', x)} rows={2} />
        </div>
      ),
    },
    {
      key: 'needs',
      title: 'What do you need from Axal?',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="Primary need"
            options={['Capital', 'Co-founders', 'GTM help', 'Legal & ops', 'Mentorship']}
            value={values.primary_need}
            onChange={(x) => set('primary_need', x)}
          />
          <TextArea label="Anything else we should know?" value={values.notes} onChange={(x) => set('notes', x)} rows={3} />
        </div>
      ),
    },
  ];

  return (
    <div className="py-8">
      <OnboardingWizard
        flow="founder"
        steps={steps}
        finishLabel="Open Founder Portal"
        onFinish={() => navigate('/founder')}
      />
    </div>
  );
}
