/**
 * Admin Studio — the admin profile's front door.
 *
 * Eadwyn (the chat, the ticket, Proposed / Pending / Completed) is
 * PersonalAdvisor. Under it, one card per other Admin page, in the sidebar's
 * order. Skills, values and archetype are a founder's fit block and do not
 * belong here.
 */
import React, { useEffect, useState } from 'react';
import PersonalAdvisor from '../../components/advisor/PersonalAdvisor';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { branchOfUser } from '../../lib/shellRole';
import { AdminStudioOverview } from './AdminStudioOverview';

const UNAVAILABLE = Symbol('unavailable');

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
      <PersonalAdvisor />
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
