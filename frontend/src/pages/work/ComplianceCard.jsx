import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { NOT_RECORDED } from '../../lib/absence';
import { companyCompliancePath } from '../../lib/settingsScope.js';
import { Failed, INK, LINK, MUTED, PCard, Reading } from '../account/companies/portfolioUi.jsx';
import { workAdapter } from './workAdapter.js';
import { NO_TASKS_RECORDED, gutter, nextTasks } from './workModel.js';

/**
 * D1614 (#3976) — the company's next five compliance tasks, in Company
 * settings › Legal (and, when #3947's company page lands, its CO1 card). It
 * fails alone: an unread list says so, and an empty one is "Not recorded",
 * never a plausible zero.
 */
export default function ComplianceCard({ uid }) {
  const [s, set] = useState({ status: 'loading' });
  const load = useCallback(async () => {
    set({ status: 'loading' });
    try {
      const r = await workAdapter.complianceTasks(uid);
      set(r.available ? { status: 'ready', tasks: r.data.tasks || [] } : { status: 'off', reason: r.reason });
    } catch { set({ status: 'error' }); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  const next = s.status === 'ready' ? nextTasks(s.tasks) : [];
  return (
    <PCard title="Compliance" testId="company-compliance-card"
      aside={<Link to={companyCompliancePath(uid)} className={LINK} data-testid="company-compliance-open">Open compliance tasks ›</Link>}>
      {s.status === 'loading' ? <Reading /> : null}
      {s.status === 'off' ? <p className={`m-0 ${MUTED}`} data-testid="company-compliance-off">{s.reason}</p> : null}
      {s.status === 'error' ? <Failed what="Compliance" onRetry={load} testId="company-compliance-unread" /> : null}
      {s.status === 'ready' && !next.length ? <p className={`m-0 ${MUTED}`} data-testid="company-compliance-none">{NO_TASKS_RECORDED}</p> : null}
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
    </PCard>
  );
}
