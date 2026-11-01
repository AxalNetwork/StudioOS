import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Unrecorded } from '../../ui/Honesty.jsx';
import { api } from '../../lib/api';
import { companyPathFor, projectPagePath } from '../account/companies/companiesModel.js';
import { BTN_PRIMARY, BTN_SECONDARY } from '../team/teamUi.jsx';
import { orderCompany } from './incorporateAdapter.js';
import { deadline83b } from './incorporateModel.js';

/**
 * D1414 (#3696, INC4) — "[Company] is on its way", with Back to the project
 * always and Open company only when the order carries its company (#3855).
 * Next steps: the 83(b) deadline from the founder's own trackers (`GET
 * /api/legal/83b/trackers?project_id=`; "Not recorded" when none, never a
 * date guessed) and the cap table. No bank link (owner answer Q7).
 */
export default function IncorporateDone({ order, projectId, companyName }) {
  const [tracker, setTracker] = useState({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    if (!projectId) { setTracker({ kind: 'none' }); return undefined; }
    api.legal83bList(projectId).then((r) => { if (alive) setTracker(deadline83b(r)); }).catch(() => { if (alive) setTracker({ kind: 'unread' }); });
    return () => { alive = false; };
  }, [projectId]);
  const company = orderCompany(order);
  const name = companyName || order?.company_name || 'Your company';
  return (
    <div className="flex flex-col gap-4" data-testid="incorporate-done">
      <section className="flex flex-col items-center gap-3 rounded-axal-lg border border-axal-hairline bg-white px-6 py-8 text-center dark:border-gray-700 dark:bg-gray-900">
        <span aria-hidden="true" className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full bg-emerald-50 text-[22px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓</span>
        <h2 className="m-0 text-[20px] font-extrabold text-axal-ink dark:text-gray-100">{name} is on its way</h2>
        <p className="m-0 max-w-[520px] text-[13px] text-axal-muted dark:text-gray-400">
          {company.available ? `The company is in Portfolio, marked “Filing in progress”. ` : ''}Its incorporation date is recorded when Axal VC files.
        </p>
        <span className="flex flex-wrap justify-center gap-2">
          {projectId ? <Link to={projectPagePath(projectId)} className={BTN_SECONDARY} data-testid="done-back-to-project">Back to the project</Link> : null}
          {company.available ? <Link to={companyPathFor(company.value.uid)} className={BTN_PRIMARY} data-testid="done-open-company">Open company</Link> : null}
        </span>
      </section>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">Next steps</span>
      <div className="grid gap-3 md:grid-cols-2">
        <section className={`flex flex-col gap-1.5 rounded-axal-lg border bg-white px-4 py-3 dark:bg-gray-900 ${tracker.kind === 'due' ? 'border-amber-300 dark:border-amber-700' : 'border-axal-hairline dark:border-gray-700'}`} data-testid="done-83b">
          <b className="text-[14px] text-axal-ink dark:text-gray-100">File your 83(b)</b>
          <span className="text-[12.5px] text-axal-muted dark:text-gray-400">
            {tracker.kind === 'loading' ? 'Reading…' : tracker.kind === 'due' ? <span className="font-semibold text-amber-800 dark:text-amber-300">{tracker.line}</span>
              : tracker.kind === 'unread' ? 'The 83(b) deadline could not be read' : <>Deadline <Unrecorded /></>}
          </span>
          <Link to="/incorporate/83b" className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Open the tracker</Link>
        </section>
        <section className="flex flex-col gap-1.5 rounded-axal-lg border border-axal-hairline bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900" data-testid="done-cap-table">
          <b className="text-[14px] text-axal-ink dark:text-gray-100">Set up your cap table</b>
          <span className="text-[12.5px] text-axal-muted dark:text-gray-400">Record the founders and the option pool.</span>
          <Link to="/raise/cap-table" className="text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Open Cap table</Link>
        </section>
      </div>
    </div>
  );
}
