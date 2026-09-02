import React from 'react';
import { useNavigate } from 'react-router-dom';
import OnboardingWizard, { TextField, TextArea, ChoiceField } from '../components/OnboardingWizard';
import AuthShell, { authV2 } from '../components/auth/AuthShell';
import { spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import { reportError } from '../lib/log';

// Auth & Onboarding v2 — Founder wizard (A3a–c).
const STAGE_NOT_FORMED = 'not_formed';
const STAGE_FORMED = 'formed';
const ORIGIN_INDEPENDENT = 'independent';
const ORIGIN_UNIVERSITY = 'university';
const ORIGIN_CORPORATE = 'corporate';

const IP_STATUSES = ['Disclosed to TTO', 'Licence negotiated', 'Assigned to company', 'Patent filed', 'Not yet disclosed'];

export default function OnboardingFounderPage() {
  useForcedLightTheme();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const exploring = user?.role === 'exploring';

  const steps = [
    {
      key: 'stage',
      title: 'Where is the company?',
      description: 'One question, two answers — they lead to different paths. Neither is the smaller path.',
      validate: (v) => (!v.stage ? 'Pick one to continue' : null),
      render: ({ values, set }) => (
        <div className="space-y-4">
          <ChoiceField
            label="Stage"
            options={[
              {
                value: STAGE_NOT_FORMED,
                label: 'Not formed yet — an idea, a prototype, or research',
              },
              {
                value: STAGE_FORMED,
                label: 'Formed and operating',
              },
            ]}
            value={values.stage}
            onChange={(x) => set('stage', x)}
          />
          <div
            className="rounded-xl border px-4 py-3 text-[13px] leading-relaxed"
            style={{ background: authV2.purpleTint, borderColor: '#ddd0fb', color: authV2.ink }}
          >
            <strong>Why this order:</strong> an operating founder skips origin entirely and reaches setup in two steps.
            The Spin-Out Lab is only offered when the company does not exist yet.
          </div>
        </div>
      ),
    },
    {
      key: 'origin',
      title: 'Where does the company come from?',
      description: 'Most founders answer in one click. Only a spin-out needs the extra fields.',
      validate: (v) => {
        if (v.stage === STAGE_FORMED) return null;
        if (!v.origin) return 'Pick an origin to continue';
        if (v.origin !== ORIGIN_INDEPENDENT && !v.institution?.trim()) return 'Name the institution';
        return null;
      },
      render: ({ values, set }) => {
        if (values.stage === STAGE_FORMED) {
          return (
            <p className="text-sm text-gray-600">
              You indicated your company is already operating — origin does not apply. Continue to company setup.
            </p>
          );
        }
        const spinout = values.origin === ORIGIN_UNIVERSITY || values.origin === ORIGIN_CORPORATE;
        return (
          <div className="space-y-4">
            <ChoiceField
              label="Origin"
              options={[
                { value: ORIGIN_INDEPENDENT, label: 'Independent — built outside an institution' },
                { value: ORIGIN_UNIVERSITY, label: 'University spin-out — IP needs assignment or licence' },
                { value: ORIGIN_CORPORATE, label: 'Corporate spin-out — carved out of an employer' },
              ]}
              value={values.origin}
              onChange={(x) => set('origin', x)}
            />
            {spinout && (
              <>
                <TextField
                  label="Institution"
                  value={values.institution}
                  onChange={(x) => set('institution', x)}
                  placeholder="e.g. Delft University of Technology"
                />
                <div>
                  <div className="text-xs font-medium text-gray-700 mb-2 dark:text-gray-300">IP status</div>
                  <div className="flex flex-wrap gap-2">
                    {IP_STATUSES.map((chip) => {
                      const on = (values.ip_status || []).includes(chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => {
                            const cur = values.ip_status || [];
                            set(
                              'ip_status',
                              on ? cur.filter((c) => c !== chip) : [...cur, chip],
                            );
                          }}
                          className="rounded-full border px-3 py-1 text-xs font-medium"
                          style={{
                            borderColor: on ? authV2.purple : authV2.hair,
                            background: on ? authV2.purpleTint : '#fff',
                            color: on ? authV2.purpleDark : authV2.muted,
                          }}
                        >
                          {chip}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {values.stage === STAGE_NOT_FORMED && (
              <div
                className="rounded-xl border px-4 py-3 space-y-3"
                style={{ background: '#fffdf5', borderColor: '#fcd34d' }}
              >
                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">Spin-Out Lab · eligible, not enrolled</div>
                <p className="text-xs text-gray-700 leading-relaxed dark:text-gray-300">
                  A 28-day programme for companies not yet formed. Applying does not stop you working — Validate opens either way.
                </p>
                <ChoiceField
                  label="Lab"
                  options={[
                    { value: 'apply', label: 'Apply to the next cohort (admin decision)' },
                    { value: 'skip', label: 'Not now — set up the company anyway' },
                  ]}
                  value={values.lab_choice || 'skip'}
                  onChange={(x) => set('lab_choice', x)}
                />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'company',
      title: 'Set up the company',
      description: 'Four answers — the last decides which workspace opens first. Nothing here is permanent.',
      validate: (v) => {
        if (!v.company_name?.trim()) return 'Add a working name for the venture';
        if (!v.primary_need) return 'Pick your primary need';
        return null;
      },
      render: ({ values, set }) => (
        <div className="space-y-4">
          <TextField label="Company name" value={values.company_name} onChange={(x) => set('company_name', x)} placeholder="Meridian Robotics" />
          <TextField
            label="Jurisdiction"
            value={values.jurisdiction}
            onChange={(x) => set('jurisdiction', x)}
            placeholder='e.g. Netherlands — or "Not yet"'
          />
          <ChoiceField
            label="Stage"
            options={['Idea', 'Prototype', 'MVP', 'Revenue', 'Scaling']}
            value={values.stage_detail}
            onChange={(x) => set('stage_detail', x)}
          />
          <ChoiceField
            label="What should open first?"
            options={['Validate · customer discovery', 'Build · this week', 'Research · ask the library', 'Raise · cap table']}
            value={values.first_workspace}
            onChange={(x) => set('first_workspace', x)}
          />
          <ChoiceField
            label="Primary need from Axal VC"
            options={['Capital', 'Co-founders', 'GTM help', 'Legal & ops', 'Advisorship']}
            value={values.primary_need}
            onChange={(x) => set('primary_need', x)}
          />
          <TextArea label="What problem are you solving?" value={values.problem} onChange={(x) => set('problem', x)} rows={2} />
          <TextField label="Your full name" value={values.full_name} onChange={(x) => set('full_name', x)} placeholder="Jane Doe" />
        </div>
      ),
    },
  ];

  const handleFinish = async (values) => {
    const wantsLab =
      values?.stage === STAGE_NOT_FORMED &&
      values?.lab_choice === 'apply';

    if (wantsLab) {
      try {
        await spinoutLab.start();
      } catch (e) {
        reportError('spinout-lab:start', e);
      }
    }

    try {
      await refresh({ force: true });
    } catch { /* no-op */ }

    if (exploring) {
      navigate('/exploring', { replace: true });
      return;
    }
    if (wantsLab) {
      navigate('/spinout-lab', { replace: true });
      return;
    }
    navigate('/studio', { replace: true });
  };

  return (
    <AuthShell email={user?.email} platformNote="Founder onboarding">
      <div className="w-full max-w-2xl mx-auto">
        <OnboardingWizard
          flow="founder"
          steps={steps}
          finishLabel={exploring ? 'Continue while review runs' : 'Continue to Studio'}
          onFinish={handleFinish}
        />
      </div>
    </AuthShell>
  );
}
