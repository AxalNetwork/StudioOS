import React, { useCallback, useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { api } from '../../../lib/api';
import { titleCase } from '../../../lib/absence';
import { Card, EmptyState, SectionLabel, Skeleton, Unreadable, Unrecorded } from '../../../ui';
import WorkspaceShell from '../../../workspaces/WorkspaceShell';
import ZoneNav from '../../../workspaces/ZoneNav';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { StatedLimit } from '../kit';
import { BOARD_METRICS, BOARD_PERIODS, EARNINGS_AREA, boardValueLabel, changeText } from '../../../lib/partnerEarnings';
import { Panel, RowTable } from './parts';

/**
 * Partner · Leaderboard — `/partner/leaderboard` (canvas `pe-board`, D569;
 * metrics, periods and change since D572 part 3b).
 *
 * WHAT THE ROUTE RETURNS, AND NOTHING ELSE. `GET /partnernet/leaderboard/board`
 * ranks members by one metric over one period:
 *
 *   · Network score, as it stands now (a standing has no period);
 *   · Referrals made, and Commissions earned, each a COUNT, all time or this
 *     calendar quarter. A count and not a sum: commissions are held in more
 *     than one currency, and a sum would publish what each member earned.
 *
 * Introductions stays a chip drawn disabled, with the reason: no store records
 * an introduction a member made.
 *
 * THE CHANGE is against a stored standing at least a week old, written daily.
 * Until one exists, or in a quarter's first week, the column says why there is
 * none rather than drawing a dash.
 *
 * OTHER MEMBERS ARE SHOWN BY RANK AND ROLE. The route sends no id, name or
 * email for anyone, and the viewer's own standing wherever it falls.
 *
 * NO WORKER RAIL, by the canvas (`rail: false` on `pe-board`).
 */

const BOARD_COLS = 'md:grid-cols-[64px_minmax(0,1.6fr)_140px_120px]';
const CHANGE_TONE = {
  up: 'text-emerald-700 dark:text-emerald-300',
  down: 'text-red-700 dark:text-red-300',
  same: 'text-axal-muted',
  new: 'text-axal-muted',
};

function ChangeCell({ change, compare }) {
  if (!compare?.available) return <Unrecorded reason={compare?.reason}>Not recorded</Unrecorded>;
  const c = changeText(change);
  if (!c) return <Unrecorded>Not recorded</Unrecorded>;
  return <span className={`tabular-nums ${CHANGE_TONE[c.dir]}`} data-dir={c.dir}>{c.text}</span>;
}

/** The viewer's own standing, or why there is none. */
export function ViewerStanding({ state, data }) {
  if (state !== 'ready' || !data) return null;
  const v = data.viewer || {};
  return (
    <Card padding="md" data-testid="card-viewer-standing">
      <SectionLabel>Your rank</SectionLabel>
      {v.ranked ? (
        <p className="mt-1.5 text-[13px] text-axal-ink dark:text-gray-100" data-testid="text-viewer-rank">
          <span className="text-[22px] font-extrabold tabular-nums">{v.rank}</span>
          <span className="text-axal-muted"> of {data.total_ranked} ranked, with {boardValueLabel(data.metric).toLowerCase()} of {v.value}.</span>
          {' '}
          <span className="text-axal-muted">Change: </span><ChangeCell change={v.change} compare={data.compare} />
        </p>
      ) : (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-axal-muted" data-testid="text-viewer-unranked">
          <Unrecorded reason={v.reason}>Not ranked</Unrecorded> {v.reason}
        </p>
      )}
    </Card>
  );
}

/** The board, in the route's order, the viewer's row highlighted. */
export function LeaderboardTable({ state, data, onRetry }) {
  const rows = data?.rows || [];
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Table rows={6} cols={4} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="The leaderboard" claim="This is not a claim that nobody is ranked." onRetry={onRetry} /></div>;
  } else if (!rows.length) {
    body = (
      <div className="p-4">
        <EmptyState size="sm" icon={Trophy} title="Nobody is ranked yet" body="No member has anything counted for this metric and period, so the board has no one to list." data-testid="empty-board" />
      </div>
    );
  } else {
    body = (
      <RowTable
        testid="table-board"
        cols={BOARD_COLS}
        head={['Rank', 'Member', boardValueLabel(data.metric), 'Change']}
        rows={rows.map((r, i) => ({
          key: i,
          testid: r.is_viewer ? 'row-board-viewer' : `row-board-${i}`,
          className: r.is_viewer ? 'bg-amber-50 font-semibold dark:bg-amber-950/30' : '',
          cells: [
            <span className="tabular-nums">{r.rank}</span>,
            r.is_viewer
              ? <span><span className="font-extrabold text-axal-ink dark:text-gray-100">You</span> <span className="text-axal-muted">{titleCase(r.role)}</span></span>
              : <span className="text-axal-muted">{titleCase(r.role) || 'Member'}</span>,
            <span className="tabular-nums">{r.value}</span>,
            <ChangeCell change={r.change} compare={data.compare} />,
          ],
        }))}
      />
    );
  }
  const shown = rows.length;
  return (
    <Panel
      title={`Ranked by ${boardValueLabel(data?.metric).toLowerCase()}`}
      meta={state === 'ready' && shown ? `${shown} of ${data.total_ranked} ranked` : null}
      testid="panel-board"
    >
      {body}
      {state === 'ready' && shown ? (
        <p className="border-t border-axal-hairline px-4 py-2.5 text-[12px] text-axal-muted dark:border-gray-700" data-testid="text-board-compare">
          Other members appear by rank and role only. Names are never shown.{' '}
          {data.compare?.available
            ? `Change is against the standing stored on ${data.compare.date}, at least ${data.compare.days} days ago.`
            : data.compare?.reason}
        </p>
      ) : null}
    </Panel>
  );
}

/** The chips: each metric, and the period, with the reason a chip cannot be chosen. */
export function boardFilters(metric, period, onMetric, onPeriod) {
  const m = BOARD_METRICS.find((x) => x.key === metric) || BOARD_METRICS[0];
  return [
    ...BOARD_METRICS.map((x) => ({
      label: x.label, testid: `chip-metric-${x.key}`, active: x.key === metric, onSelect: () => onMetric(x.key),
    })),
    { label: 'Introductions', testid: 'chip-metric-introductions', disabled: true, title: 'No store records an introduction a member made, so nothing ranks by it.' },
    ...BOARD_PERIODS.map((p) => (m.periods.includes(p.key)
      ? { label: p.label, testid: `chip-period-${p.key}`, active: p.key === period, onSelect: () => onPeriod(p.key) }
      : { label: p.label, testid: `chip-period-${p.key}`, disabled: true, title: 'The network score is a standing, not a tally, so it has no period.' })),
  ];
}

export default function PartnerLeaderboard() {
  const [metric, setMetric] = useState('score');
  const [period, setPeriod] = useState('all');
  const [board, setBoard] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    setBoard({ status: 'loading', data: null });
    api.partnerLeaderboardBoard({ metric, period })
      .then((d) => setBoard({ status: 'ready', data: d }))
      .catch(() => setBoard({ status: 'unreadable', data: null }));
  }, [metric, period]);
  useEffect(() => { load(); }, [load]);
  const chooseMetric = (key) => {
    const m = BOARD_METRICS.find((x) => x.key === key);
    if (m && !m.periods.includes(period)) setPeriod(m.periods[0]);
    setMetric(key);
  };

  return (
    <WorkspaceShell
      role="partner"
      title="Leaderboard"
      intro="Members ranked by one measure at a time. Your own row is highlighted; everyone else is shown by rank and role only."
    >
      <ZoneNav bucket={EARNINGS_AREA} role="partner" />
      <ZoneToolbar role="partner" className="mb-3" filters={boardFilters(metric, period, chooseMetric, setPeriod)} />
      <div className="max-w-4xl space-y-3">
        <ViewerStanding state={board.status} data={board.data} />
        <LeaderboardTable state={board.status} data={board.data} onRetry={load} />
        <StatedLimit title="What this board does not claim">
          <p><strong>Counts, not money.</strong> Referrals and commissions are counted, never summed: commissions are held in more than one currency, and a sum would show what each member earned.</p>
          <p className="mt-2"><strong>No introductions.</strong> No store records an introduction a member made, so the board cannot rank by it.</p>
          <p className="mt-2"><strong>A week&rsquo;s change.</strong> Standings are stored once a day, and the change compares with one at least a week old. Until one exists, and in a quarter&rsquo;s first week, there is no change to show.</p>
          <p className="mt-2"><strong>Not only partners.</strong> Every member with something counted is on it, so the role is shown beside each rank. A member hidden from the directory is not ranked.</p>
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
