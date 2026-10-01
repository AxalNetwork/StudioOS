/**
 * Admin Studio — the admin profile's front door.
 *
 * Eadwyn (the chat, the ticket, Proposed / Pending / Completed) is
 * PersonalAdvisor, mounted through StudioInterview, which collapses it to one
 * row once the interview is complete (D324). Under it, in the canvas's order (D246): the operating
 * posture, what needs a decision, then one card per other Admin page in the
 * sidebar's order. The needs-a-decision tiles read the same four props the
 * cards do; the posture makes its own read because the bank is the admin's,
 * not the branch's, so it renders on and off a branch. Skills, values and archetype are a founder's fit block and do not
 * belong here.
 */
import React, { useEffect, useState } from 'react';
import StudioInterview from '../../components/advisor/StudioInterview';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { branchOfUser } from '../../lib/shellRole';
import { AdminStudioOverview } from './AdminStudioOverview';
import { UNAVAILABLE } from './adminStudioOverview';
import StudioPosture from './StudioPosture';
import { StudioNeedsDecisionView } from './StudioNeedsDecision';

export default function AdminStudioHome({ user }) {
  const onBranch = Boolean(branchOfUser(user));
  const [home, setHome] = useState(null);
  const [licence, setLicence] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [insights, setInsights] = useState(null);

  useEffect(() => {
    if (!onBranch) return undefined;
    let cancelled = false;
    const take = (setter) => (value) => {
      if (!cancelled) setter(value);
    };
    const miss = (setter) => () => {
      if (!cancelled) setter(UNAVAILABLE);
    };
    api.branchHome().then(take(setHome), (e) => {
      reportError('admin-studio:home', e);
      miss(setHome)();
    });
    api.myLicence().then(take(setLicence), (e) => {
      reportError('admin-studio:licence', e);
      miss(setLicence)();
    });
    api.branchTemplates().then(take(setTemplates), (e) => {
      reportError('admin-studio:templates', e);
      miss(setTemplates)();
    });
    api.branchInsights().then(take(setInsights), (e) => {
      reportError('admin-studio:insights', e);
      miss(setInsights)();
    });
    return () => { cancelled = true; };
  }, [onBranch]);

  return (
    <div data-testid="admin-studio-home">
      <header className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight text-axal-ink">Studio</h1>
      </header>
      <StudioInterview persona="admin" />
      <StudioPosture />
      <StudioNeedsDecisionView
        user={user}
        home={home}
        licence={licence}
        templates={templates}
        insights={insights}
      />
      <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-axal-muted">
        The other Admin pages, in the order the sidebar lists them.
      </p>
      <AdminStudioOverview
        user={user}
        home={home}
        licence={licence}
        templates={templates}
        insights={insights}
      />
    </div>
  );
}
