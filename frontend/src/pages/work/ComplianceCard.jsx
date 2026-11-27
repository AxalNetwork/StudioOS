import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NOT_RECORDED } from '../../lib/absence';
import { companyCompliancePath } from '../../lib/settingsScope.js';
import { Failed, INK, LINK, MUTED, PCard, Reading } from '../account/companies/portfolioUi.jsx';
import { workAdapter } from './workAdapter.js';
import { NO_TASKS_RECORDED, complianceTiles, gutter, nextTasks } from './workModel.js';

/**
 * D1614 (#3976) — the company's next five compliance tasks, in Company
 * settings › Legal and the Portfolio company's CO1 card (#4420). It
 * fails alone: an unread list says so, and an empty one is "Not recorded",
 * never a plausible zero.
 */
export default function ComplianceCard({ uid }) {
  const [s, set] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    set({ status: 'loading' });
    try {
      const r = await workAdapter.complianceTasks(uid);
      if (r.available && !Array.isArray(r.data?.tasks)) throw new Error('Compliance tasks unreadable');
      set(r.available ? { status: 'ready', tasks: r.data.tasks || [] } : { status: 'off', reason: r.reason });
    } catch { set({ status: 'error' }); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  const next = s.status === 'ready' ? nextTasks(s.tasks) : [];
  const overdue = s.status === 'ready' ? complianceTiles(s.tasks).overdue : 0;
  return (
    <PCard title="Compliance" testId="company-compliance-card"
      aside={<Link to={companyCompliancePath(uid)} className={LINK} data-testid="company-compliance-open">See all compliance tasks ›</Link>}>
      {overdue > 0 ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" data-testid="company-compliance-overdue">{overdue} overdue</span> : null}
      {s.status === 'loading' ? <Reading /> : null}
      {s.status === 'off' ? <p className={`m-0 ${MUTED}`} data-testid="company-compliance-off">{s.reason}</p> : null}
      {s.status === 'error' ? <Failed what="Compliance" onRetry={load} testId="company-compliance-unread" /> : null}
      {s.status === 'ready' && !next.length ? <p className={`m-0 ${MUTED}`} data-testid="company-compliance-none">{s.tasks.length ? 'No open compliance tasks.' : NO_TASKS_RECORDED}</p> : null}
      {next.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="company-compliance-next">
          {next.map((t) => {
            const g = gutter(t.due);
            return (
              <li key={t.uid} className={`flex items-baseline gap-3 text-[13px] ${INK}`}>
                <span className="min-w-[52px] font-mono text-[11px] text-axal-muted dark:text-gray-400">{g ? `${g.day} ${g.month}` : NOT_RECORDED}</span>
                <b className="font-semibold">{t.title}</b>
                <span className={`ml-auto ${MUTED}`}>{t.owner?.name || 'No owner'}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Link to="/calendar?layer=compliance" className={`${LINK} mt-3 inline-flex`} data-testid="company-compliance-calendar">Open in Calendar ›</Link>
    </PCard>
  );
}
