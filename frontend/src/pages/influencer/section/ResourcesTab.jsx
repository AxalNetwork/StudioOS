import React from 'react';
import { Link } from 'react-router-dom';
import { Pill } from '../../../ui';
import { RESOURCES, benefitView } from './influencerSectionModel';
import { BODY, INK, MUTED, Panel, SECONDARY } from './InfluencerParts';

/**
 * D4289 P7 (#4296), IN6 — Resources at `/influencer/resources`. Static: the
 * disclosure rules and what may not be promoted (the rules the influencer
 * agreed to when applying), the brand kit (HQ has published no files, so its
 * downloads are off and say so), the questions, and the Investor Pro benefit
 * from the membership's own flag. No read of its own and no invented one.
 */
export default function ResourcesTab({ membership }) {
  const benefit = benefitView(membership);
  return (
    <div className="flex flex-col gap-4" data-testid="influencer-resources">
      <Panel title="Brand kit" sub={RESOURCES.brandKitLine} testId="resources-brand-kit">
        <div className="grid gap-3 sm:grid-cols-3">
          {RESOURCES.brandKit.map((b) => (
            <div key={b.key} className="rounded-lg border border-[#ececf1] p-3 dark:border-gray-700">
              <span className={`block text-sm font-semibold ${INK}`}>{b.title}</span>
              <span className={`block text-xs ${MUTED}`}>{b.sub}</span>
              <button type="button" className={`${SECONDARY} mt-2`} disabled title="HQ has not published this file yet">Download</button>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Disclosure" testId="resources-disclosure">
          <ul className={`list-disc pl-5 text-sm ${BODY}`}>{RESOURCES.disclosure.map((t) => <li key={t}>{t}</li>)}</ul>
        </Panel>
        <Panel title="What you may not promote" testId="resources-not-promote">
          <ul className={`list-disc pl-5 text-sm ${BODY}`}>{RESOURCES.notPromote.map((t) => <li key={t}>{t}</li>)}</ul>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Questions" testId="resources-faq">
          <dl className="flex flex-col gap-2">
            {RESOURCES.faq.map((f) => (
              <div key={f.q}><dt className={`text-sm font-semibold ${INK}`}>{f.q}</dt><dd className={`text-sm ${BODY}`}>{f.a}</dd></div>
            ))}
          </dl>
          <Link to="/help" className={`mt-3 inline-block ${SECONDARY}`}>Ask HQ through Help</Link>
        </Panel>
        <Panel title="Investor Pro benefit" testId="resources-benefit">
          <Pill tone={benefit.on ? 'ok' : 'neutral'}>{benefit.text}</Pill>
          {benefit.on && <p className={`mt-2 text-xs ${MUTED}`}>It stays while your membership is active.</p>}
        </Panel>
      </div>
    </div>
  );
}
