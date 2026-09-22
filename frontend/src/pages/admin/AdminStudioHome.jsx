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
    // THE SCOPE IS A LITERAL AT EACH CALL SITE, not a `tag` threaded through
    // the closure — which is what shipped and what turned `main` red.
    //
    // `scripts/check-frontend-logging.mjs` requires `reportError`'s first
    // argument to be a quoted string or template literal, and that narrowness
    // is load-bearing rather than pedantic: an identifier in first position is
    // indistinguishable from the reversed `reportError(err, { where })` defect
    // the guard exists for — 27 call sites shipped that way, and each one sent
    // no stack, a message of "[object Object]", and the error's own text into
    // the one field `redact` does not clean. A guard that accepted identifiers
    // could not tell the two apart, so `fail` takes the REPORTER, not the tag.
    const fail = (setter, report) => (e) => {
      report(e);
      if (!cancelled) setter(UNAVAILABLE);
    };
    api.branchHome().then(take(setHome), fail(setHome, (e) => reportError('admin-studio:home', e)));
    api.myLicence().then(take(setLicence), fail(setLicence, (e) => reportError('admin-studio:licence', e)));
    api.branchTemplates().then(take(setTemplates), fail(setTemplates, (e) => reportError('admin-studio:templates', e)));
    api.branchInsights().then(take(setInsights), fail(setInsights, (e) => reportError('admin-studio:insights', e)));
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
