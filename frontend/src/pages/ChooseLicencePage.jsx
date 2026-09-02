import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Briefcase, TrendingUp, Users } from 'lucide-react';
import AuthShell, { AuthCard, authV2 } from '../components/auth/AuthShell';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import useForcedLightTheme from '../hooks/useForcedLightTheme';
import { track } from '../lib/funnel';

const LICENCES = [
  {
    key: 'founder',
    name: 'Founder',
    desc: 'I\u2019m building a company.',
    meta: 'Incorporation, cap table, raise, customer discovery',
    icon: Building2,
    tint: authV2.purpleTint,
    ink: authV2.purpleDark,
  },
  {
    key: 'investor',
    name: 'Investor / LP',
    desc: 'I back companies and funds.',
    meta: 'Deal flow, portfolio, fund reporting \u00b7 accreditation required',
    icon: TrendingUp,
    tint: '#eef0ff',
    ink: '#4338ca',
  },
  {
    key: 'advisor',
    name: 'Advisor',
    desc: 'I coach founders and run office hours.',
    meta: 'Practice, cohorts, expertise profile',
    icon: Users,
    tint: '#eefbf5',
    ink: '#047857',
  },
  {
    key: 'partner',
    name: 'Partner',
    desc: 'My firm provides services to portfolio companies.',
    meta: 'Pipeline, delivery, offers \u00b7 firm-level licence',
    icon: Briefcase,
    tint: '#fff6e9',
    ink: '#92400e',
  },
];

const WIZARD_FOR_LICENCE = {
  founder: '/onboarding/founder',
  investor: '/onboarding/investor',
  partner: '/onboarding/partner',
};

export default function ChooseLicencePage() {
  useForcedLightTheme();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [selected, setSelected] = useState(user?.suggested_role || 'founder');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    track('onboarding_licence_submit', { licence: selected });
    try {
      await api.onboardingChooseLicence(selected);
      await refresh({ force: true });
      const wizard = WIZARD_FOR_LICENCE[selected];
      navigate(wizard || '/exploring', { replace: true });
    } catch (e) {
      setError(e?.message || 'Could not save your licence choice.');
    } finally {
      setBusy(false);
    }
  };

  const selectedMeta = LICENCES.find((l) => l.key === selected);

  return (
    <AuthShell email={user?.email} platformNote="First sign-in">
      <AuthCard>
        <h1 className="m-0 text-[25px] font-extrabold tracking-tight leading-tight text-[#241f38]">
          Choose your licence
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#6b6577]">
          This decides which workspace opens and which agreement we send. You can start working while membership is reviewed.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LICENCES.map((lic) => {
            const on = selected === lic.key;
            const Icon = lic.icon;
            return (
              <button
                key={lic.key}
                type="button"
                onClick={() => setSelected(lic.key)}
                className="rounded-2xl border p-5 text-left transition-shadow"
                style={{
                  borderColor: on ? authV2.purple : authV2.hair,
                  borderWidth: on ? 1.5 : 1,
                  boxShadow: on ? '0 0 0 3px rgba(124,58,237,.09)' : 'none',
                  background: '#fff',
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-[11px]"
                    style={{ background: lic.tint, color: lic.ink }}
                  >
                    <Icon size={18} />
                  </span>
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full border flex-none"
                    style={{ borderColor: on ? authV2.purple : authV2.hair, borderWidth: on ? 1.5 : 1 }}
                  >
                    {on && <span className="block h-2 w-2 rounded-full" style={{ background: authV2.purple }} />}
                  </span>
                </div>
                <div className="mt-3.5 text-[17px] font-extrabold tracking-tight text-[#241f38]">{lic.name}</div>
                <div className="mt-1.5 text-[13.5px] leading-relaxed text-[#4a4459]">{lic.desc}</div>
                <div className="mt-3 border-t pt-2.5 font-mono text-[10.5px] text-[#6b6577]" style={{ borderColor: '#f0eef5' }}>
                  {lic.meta}
                </div>
              </button>
            );
          })}
        </div>

        <p className="mt-5 font-mono text-[10.5px] leading-relaxed text-[#6b6577]">
          Admin access is invite-only. Territory operators receive their licence by email from HQ — it is never self-selected here.
        </p>

        <button
          type="button"
          disabled={busy || !selected}
          onClick={submit}
          className={authV2.btnPrimary}
          style={{ background: authV2.purple, borderColor: authV2.purple, marginTop: 18, width: 'auto', paddingLeft: 28, paddingRight: 28 }}
        >
          {busy ? 'Saving…' : `Continue as ${selectedMeta?.name || 'member'}`}
        </button>
      </AuthCard>
    </AuthShell>
  );
}
