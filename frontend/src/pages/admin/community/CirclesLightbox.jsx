import React, { useMemo, useState } from 'react';
import { communityApi } from '../../../lib/api/community';
import { BoxShell, BoxTable, Failed, ListControls, Pager, Reading, SUB, useBoxRead, useSettled } from './CommunityLightbox';
import { AS_ENTERED_FOOT, CIRCLES, CIRCLES_LINE, circleRow, circlesQuery, initialState, listPage } from './lightboxModel';

/**
 * D934 (#2718) — CM5, Circles: every circle, 25 rows a page. #4717 package 4:
 * one page from `GET /api/admin/community/circles`, searched, filtered,
 * sorted and paged in SQL with the total that matched. A name opens circles, which publishes and features; nothing
 * is changed here. Members and Activity are typed by an admin on each circle,
 * so both headers carry the "As entered" tag.
 */

const COLS = [
  { key: 'title', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'access', label: 'Access' },
  { key: 'published', label: 'Published' },
  { key: 'featured', label: 'Featured' },
  { key: 'members', label: 'Members', tag: 'As entered', mono: true },
  { key: 'activity', label: 'Activity', tag: 'As entered' },
];

export default function CirclesLightbox({ onClose }) {
  const [state, setState] = useState(() => initialState(CIRCLES));
  const q = useSettled(state.q);
  const query = useMemo(() => circlesQuery({ ...state, q }), [state, q]);
  const { read, retry } = useBoxRead(() => communityApi.circles(query), 'box-circles', JSON.stringify(query));
  const view = useMemo(() => (read.status === 'ready' ? listPage(read.data, state.page) : null), [read, state.page]);
  const failed = read.status === 'error' || (read.status === 'ready' && !view);
  const id = 'community-box-circles';

  return (
    <BoxShell id={id} title={CIRCLES.title} sub={CIRCLES_LINE} onClose={onClose}>
      {(phone) => (
        <>
          <ListControls id={id} spec={CIRCLES} state={state} setState={setState} phone={phone} />
          {read.status === 'loading' && <Reading id={id} />}
          {failed && <Failed id={id} reason="The circles could not be read. That is not the same as no circles." onRetry={retry} />}
          {view && (
            <>
              <BoxTable id={id} cols={COLS} phone={phone} empty="No circle matches." rows={view.rows.map(circleRow)}
                phoneLine={(r) => `${r.type} · ${r.access} · ${r.published === 'Yes' ? 'Published' : 'Draft'}`}
                phoneValue={(r) => `${r.members} members · as entered`} />
              <Pager id={id} view={view} none={CIRCLES.none} onPage={(page) => setState((s) => ({ ...s, page }))} />
              <p className={`${SUB} px-5 pb-3`} data-testid={`${id}-as-entered`}>{AS_ENTERED_FOOT}</p>
            </>
          )}
        </>
      )}
    </BoxShell>
  );
}
