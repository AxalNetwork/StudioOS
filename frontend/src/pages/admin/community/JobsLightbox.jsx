import React, { useMemo, useState } from 'react';
import { communityApi } from '../../../lib/api/community';
import { BoxShell, BoxTable, Failed, ListControls, Pager, Reading, SUB, useBoxRead, useSettled } from './CommunityLightbox';
import { JOBS, JOBS_FOOT, JOBS_LINE, initialState, jobRow, jobsQuery, listPage } from './lightboxModel';

/**
 * D934 (#2718) — CM4, Job postings: every posting, every status, 25 rows a
 * page. #4717 package 4: one page from `GET /api/admin/community/jobs`, which
 * searches, filters, sorts and pages in SQL and says how many matched; the
 * whole job board is no longer read into the browser. A role opens the job
 * board, which decides; nothing is approved here.
 *
 * D1121: Posted and Days open read `published_at` (migration 609), the day an
 * admin last approved the posting. One approved before 609 reads Not recorded.
 */

const COLS = [
  { key: 'title', label: 'Role' },
  { key: 'company', label: 'Company' },
  { key: 'status', label: 'Status' },
  { key: 'place', label: 'Remote or on-site' },
  { key: 'seniority', label: 'Seniority' },
  { key: 'posted', label: 'Posted', mono: true },
  { key: 'daysOpen', label: 'Days open', mono: true },
  { key: 'applications', label: 'Applications', mono: true },
];

export default function JobsLightbox({ onClose, now: at }) {
  const [now] = useState(() => at ?? Date.now());
  const [state, setState] = useState(() => initialState(JOBS));
  const q = useSettled(state.q);
  const query = useMemo(() => jobsQuery({ ...state, q }), [state, q]);
  const { read, retry } = useBoxRead(() => communityApi.jobs(query), 'box-jobs', JSON.stringify(query));
  const view = useMemo(() => (read.status === 'ready' ? listPage(read.data, state.page) : null), [read, state.page]);
  const failed = read.status === 'error' || (read.status === 'ready' && !view);
  const id = 'community-box-jobs';

  return (
    <BoxShell id={id} title={JOBS.title} sub={JOBS_LINE} onClose={onClose}>
      {(phone) => (
        <>
          <ListControls id={id} spec={JOBS} state={state} setState={setState} phone={phone} />
          {read.status === 'loading' && <Reading id={id} />}
          {failed && <Failed id={id} reason="The job board could not be read. That is not the same as no jobs." onRetry={retry} />}
          {view && (
            <>
              <BoxTable id={id} cols={COLS} phone={phone} empty="No posting matches." rows={view.rows.map((j) => jobRow(j, now))}
                phoneLine={(r) => `${r.company} · ${r.status}`}
                phoneValue={(r) => `${r.applications} applications`} />
              <Pager id={id} view={view} none={JOBS.none} onPage={(page) => setState((s) => ({ ...s, page }))} />
              <p className={`${SUB} px-5 pb-3`}>{JOBS_FOOT}</p>
            </>
          )}
        </>
      )}
    </BoxShell>
  );
}
