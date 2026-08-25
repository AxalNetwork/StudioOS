import React from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, ChoiceField } from '../components/OnboardingWizard';
import { spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';

// Phase 0.2 / Task #23 — Founder onboarding wizard.
// Light intake before handing off to the founder's Studio workspace where
// the rich project-submission flow lives.
//
// Task #11 (Spin-Out Lab) — adds a journey-stage step that branches the
// finish action: pre-incorp founders get flipped into the Spin-Out Lab
// (4-week guided sprint) and land on /spinout-lab; everyone else keeps
// the existing /founder handoff.
const JOURNEY_PRE_INCORP = 'pre_incorp';
const JOURNEY_INCORPORATED = 'incorporated';

export default function OnboardingFounderPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

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
      key: 'journey',
      title: 'Where are you in your journey?',
      description: 'This decides whether we drop you into our 4-week Spin-Out Lab sprint or the standard founder portal.',
      validate: (v) => (!v.journey ? 'Pick one to continue' : null),
      render: ({ values, set }) => (
        <ChoiceField
          label="Pick one"
          options={[
            { value: JOURNEY_PRE_INCORP, label: 'I have an idea / pre-incorporation' },
            { value: JOURNEY_INCORPORATED, label: 'I already have an incorporated company' },
          ]}
          value={values.journey}
          onChange={(x) => set('journey', x)}
        />
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
      title: 'What do you need from Axal VC?',
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="Primary need"
            options={['Capital', 'Co-founders', 'GTM help', 'Legal & ops', 'Advisorship']}
            value={values.primary_need}
            onChange={(x) => set('primary_need', x)}
          />
          <TextArea label="Anything else we should know?" value={values.notes} onChange={(x) => set('notes', x)} rows={3} />
        </div>
      ),
    },
  ];

  const handleFinish = async (values) => {
    if (values?.journey === JOURNEY_PRE_INCORP) {
      try {
        await spinoutLab.start();
      } catch (e) {
        // Surface the failure in the console but don't block the user —
        // they can still navigate manually if start() is degraded.
        reportError('spinout-lab:start', e);
      }
      try {
        await refresh({ force: true });
      } catch { /* no-op */ }
      navigate('/spinout-lab');
      return;
    }
    navigate('/studio');
  };

  return (
    <div className="py-8">
      <OnboardingWizard
        flow="founder"
        steps={steps}
        finishLabel="Continue to Studio"
        onFinish={handleFinish}
      />
    </div>
  );
}
