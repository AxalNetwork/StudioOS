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
    const fail = (setter, tag) => (e) => {
      reportError(tag, e);
      if (!cancelled) setter(UNAVAILABLE);
    };
    api.branchHome().then(take(setHome), fail(setHome, 'admin-studio:home'));
    api.myLicence().then(take(setLicence), fail(setLicence, 'admin-studio:licence'));
    api.branchTemplates().then(take(setTemplates), fail(setTemplates, 'admin-studio:templates'));
    api.branchInsights().then(take(setInsights), fail(setInsights, 'admin-studio:insights'));
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
