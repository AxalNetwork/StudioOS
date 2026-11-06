// D4297 (#4297, D4289 P8) — the Influencer card on Refer & Earn (IN10): Apply,
// where the application stands, or "Open your Influencer section" for an
// admitted influencer. It reads `GET /api/influencer/me` and the tiers' rates
// (`GET /api/influencer/tiers`); no rate is typed. Apply opens the sheet here.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { actionPrimary } from '../../ui';
import { influencerProgramApi } from '../../lib/api/influencerProgram';
import ApplySheet, { ApplicationStatus } from './ApplySheet';
import { SECTION_PATH, commonDuration, rateRange, standing } from './influencerPublicModel';

const CARD = 'flex flex-col gap-2 rounded-[13px] border border-[#ececf1] bg-white p-4 dark:border-gray-800 dark:bg-gray-900';

export default function InfluencerCard() {
  const [me, setMe] = useState({ status: 'loading', data: null });
  const [tiers, setTiers] = useState(null);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setMe((m) => ({ ...m, status: 'loading' }));
    influencerProgramApi.me().then((d) => { if (live) setMe({ status: 'ready', data: d }); }, () => { if (live) setMe({ status: 'error', data: null }); });
    return () => { live = false; };
  }, [tick]);
  useEffect(() => {
    let live = true;
    influencerProgramApi.tiers().then((d) => { if (live) setTiers(d?.tiers || []); }, () => { if (live) setTiers(null); });
    return () => { live = false; };
  }, []);

  if (me.status === 'loading') return null;
  if (me.status === 'error') {
    return <section className={CARD} data-testid="influencer-card-unread"><p className="m-0 text-[13px] text-[#4a4553]">Your Influencer application could not be read just now. That is not the same as having none.</p></section>;
  }
  const state = standing(me.data);
  const range = rateRange(tiers);
  const duration = commonDuration(tiers);

  if (state.kind === 'admitted') {
    return (
      <section className={CARD} data-testid="influencer-card-admitted">
        <div className="text-[13.5px] font-extrabold tracking-tight">You’re an Axal Influencer</div>
        <span className="self-start rounded-full bg-violet-50 px-2.5 py-0.5 text-[12px] font-semibold text-violet-800 dark:bg-violet-900/30 dark:text-violet-200" data-testid="influencer-card-tier">{`✓ ${state.tier}`}</span>
        {state.paused ? <p className="m-0 text-[12px] text-[#8b8798]">HQ has paused your membership for now.</p> : null}
        <Link to={SECTION_PATH} className={`${actionPrimary} self-start`} data-testid="influencer-card-open">Open your Influencer section</Link>
      </section>
    );
  }
  if (state.kind === 'none') {
    return (
      <section className={CARD} data-testid="influencer-card-apply">
        <div className="text-[13.5px] font-extrabold tracking-tight">Have an audience? Become an Axal Influencer</div>
        <p className="m-0 text-xs leading-relaxed text-[#4a4553]" data-testid="influencer-card-earn">
          {range ? `Earn ${range} of every subscription you bring in${duration ? `, for ${duration} per member` : ''}.` : 'Earn a share of every subscription you bring in.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${actionPrimary} self-start`} onClick={() => setOpen(true)} data-testid="influencer-card-apply-open">Apply</button>
          <Link to="/influencers" className="self-center text-[12.5px] font-semibold text-violet-700 dark:text-violet-300">How it works</Link>
        </div>
        {open ? <ApplySheet consentVersion={me.data?.consent_version || null} onClose={() => setOpen(false)} onSent={() => { setOpen(false); setTick((t) => t + 1); }} /> : null}
      </section>
    );
  }
  return (
    <div data-testid="influencer-card-standing">
      <ApplicationStatus state={state} onAddDetails={() => setOpen(true)} />
      {open ? <ApplySheet consentVersion={me.data?.consent_version || null} answers={state.answers || null} onClose={() => setOpen(false)} onSent={() => { setOpen(false); setTick((t) => t + 1); }} /> : null}
    </div>
  );
}
