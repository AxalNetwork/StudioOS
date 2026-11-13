// D4297 (#4297, D4289 P8) — `/influencers`, the public Influencer program page
// (IN8): the hero, how it works, the tiers (read from GET /api/influencer/tiers,
// never typed), bonuses, benefits, rules, questions, and Apply. Signed out,
// Apply registers for the program and comes back to the sheet
// (`/register?program=influencer&next=/influencers?apply=1`); signed in, it
// opens the sheet, or shows where the application stands.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import SitePage from '../../components/site/SitePage';
import { ButtonLink, FaqList, PageHero, Section, SectionHead } from '../../components/site/SiteBlocks';
import { useAuth } from '../../hooks/useAuthSync';
import { setSuppressAuthRedirect } from '../../lib/api';
import { influencerProgramApi } from '../../lib/api/influencerProgram';
import ApplySheet, { ApplicationStatus } from './ApplySheet';
import {
  BONUS_MILESTONES, REGISTER_TO_APPLY, SECTION_PATH, TIERS_UNREAD, commonDuration, rateRange, standing, tierRows,
} from './influencerPublicModel';

const FAQ = [
  { q: 'When am I paid?', a: 'Monthly, once your payable balance reaches the payout minimum in your terms. Commission is held 30 days in case of a refund.' },
  { q: 'What if someone cancels?', a: 'You stop earning on that member. A refund reverses the line it refunds.' },
  { q: 'Can I promote a startup on Axal?', a: 'No. You promote Axal memberships, which are software.' },
];

function useRead(load, on = true) {
  const [read, setRead] = useState({ status: on ? 'loading' : 'off', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) { setRead({ status: 'off', data: null }); return undefined; }
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    load().then((data) => { if (live) setRead({ status: 'ready', data }); }, (e) => { if (live) setRead({ status: 'error', data: null, error: e }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, tick]);
  return [read, () => setTick((t) => t + 1)];
}

export default function InfluencersPage() {
  const user = useAuth()?.user ?? null;
  const { search } = useLocation();
  const [tiers] = useRead(() => influencerProgramApi.tiers());
  const [me, reloadMe] = useRead(() => influencerProgramApi.me(), Boolean(user));
  const [open, setOpen] = useState(false);

  // A public page: an anonymous visitor's background 401s must not bounce it to /login.
  useLayoutEffect(() => { setSuppressAuthRedirect(true); return () => setSuppressAuthRedirect(false); }, []);

  const state = me.status === 'ready' ? standing(me.data) : null;
  // `?apply=1` (back from registering) opens the sheet once, when the member can apply.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || new URLSearchParams(search).get('apply') !== '1' || state?.kind !== 'none') return;
    autoOpened.current = true;
    setOpen(true);
  }, [search, state?.kind]);

  const list = tiers.status === 'ready' ? tiers.data?.tiers || [] : [];
  const range = rateRange(list);
  const duration = commonDuration(list);
  const earnLine = range
    ? `${range} of each subscription${duration ? `, for ${duration} per member` : ''}.`
    : 'A share of each subscription, for the paid invoices your tier sets.';

  let apply;
  if (!user) apply = <ButtonLink to={REGISTER_TO_APPLY} data-testid="influencers-apply">Apply</ButtonLink>;
  else if (state?.kind === 'admitted') apply = <ButtonLink to={SECTION_PATH} data-testid="influencers-open-section">Open your Influencer section</ButtonLink>;
  else if (state?.kind === 'none') apply = <button type="button" className="ax-btn ax-btn-lg ax-btn-primary" onClick={() => setOpen(true)} data-testid="influencers-apply">Apply</button>;
  else apply = null;

  return (
    <SitePage title="Influencers" description="Earn recurring revenue by bringing people to Axal VC. Share your own handle; when someone subscribes through it, you earn part of every invoice.">
      <PageHero eyebrow="Axal VC Influencers" title="Earn recurring revenue by bringing people to Axal VC." id="influencers-h"
        copy={['Share your own handle. When someone subscribes through it, you earn part of every invoice they pay.']}
        actions={apply} />

      {user && me.status === 'ready' ? (
        <Section narrow>
          <ApplicationStatus state={state} onAddDetails={() => setOpen(true)} />
        </Section>
      ) : null}
      {user && me.status === 'error' ? (
        <Section narrow><p className="ax-empty" data-testid="influencers-me-unread">Your application could not be read just now. That is not the same as having none.</p></Section>
      ) : null}

      <Section id="how" labelledBy="how-h">
        <SectionHead id="how-h" eyebrow="How it works" title="Apply, share, earn" />
        <div className="ax-grid-3" data-testid="influencers-how">
          <div className="ax-card"><h3>1 · Apply</h3><p>Tell us where you publish and who reads you. We reply within 5 business days.</p></div>
          <div className="ax-card"><h3>2 · Share your handle</h3><p>axal.vc/@you, with channel links and an offer from HQ.</p></div>
          <div className="ax-card"><h3>3 · Earn</h3><p data-testid="influencers-earn">{earnLine}</p></div>
        </div>
      </Section>

      <Section id="tiers" labelledBy="tiers-h" band>
        <SectionHead id="tiers-h" eyebrow="Tiers" title="What each tier earns" lede="HQ sets the rates. Signed terms keep their own until they are replaced." />
        {tiers.status === 'loading' ? <p className="ax-empty" data-testid="influencers-tiers-loading">Reading the tiers…</p> : null}
        {tiers.status === 'error' ? <p className="ax-empty" data-testid="influencers-tiers-unread">{TIERS_UNREAD}</p> : null}
        {tiers.status === 'ready' ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="ax-table" style={{ width: '100%', minWidth: 560 }} data-testid="influencers-tiers">
              <thead><tr><th scope="col">Tier</th><th scope="col">Rate</th><th scope="col">Duration</th><th scope="col">For</th></tr></thead>
              <tbody>
                {tierRows(list).map((t) => (
                  <tr key={t.tier} data-testid={`influencers-tier-${t.tier}`}><td>{t.label}</td><td>{t.rate}</td><td>{t.duration}</td><td>{t.who}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section>
        <div className="ax-grid-2">
          <div className="ax-card" data-testid="influencers-bonuses">
            <h3>Bonuses</h3>
            <p>{`A one-time bonus at ${BONUS_MILESTONES.slice(0, -1).join(', ')} and ${BONUS_MILESTONES[BONUS_MILESTONES.length - 1]} paid members. Your terms set each amount.`}</p>
          </div>
          <div className="ax-card"><h3>Benefits</h3><p>Investor Pro included, premium research, and private events with the team.</p></div>
        </div>
        <div className="ax-card" style={{ marginTop: 18 }} data-testid="influencers-rules">
          <h3>Rules</h3>
          <p>Label every post as a paid partnership. Never promote a deal, a fund or investment returns. No sign-ups through your own handle.</p>
        </div>
      </Section>

      <Section id="faq" labelledBy="faq-h">
        <SectionHead id="faq-h" eyebrow="Questions" title="Before you apply" />
        <FaqList items={FAQ} />
      </Section>

      <Section narrow>
        <p className="ax-lede">Have an audience? Apply in about 5 minutes.</p>
        {apply}
      </Section>

      {open && me.status === 'ready' ? (
        <ApplySheet consentVersion={me.data?.consent_version || null} answers={state?.kind === 'more' ? state.answers : null}
          onClose={() => setOpen(false)} onSent={() => { setOpen(false); reloadMe(); }} />
      ) : null}
    </SitePage>
  );
}
