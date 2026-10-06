import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { api } from '../../../lib/api';
import { titleCase } from '../../../lib/absence';
import { Card, EmptyState, Pill, SectionLabel, Skeleton, Unreadable, Unrecorded } from '../../../ui';
import WorkspaceShell from '../../../workspaces/WorkspaceShell';
import ZoneNav from '../../../workspaces/ZoneNav';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { StatedLimit } from '../kit';
import { BADGE_LABELS, EARNINGS_AREA, countOf, rankBoard } from '../../../lib/partnerEarnings';
import { Panel, RowTable } from './parts';

/**
 * Partner · Leaderboard — `/partner/leaderboard` (canvas `pe-board`, D569).
 *
 * WHAT THE ROUTE RETURNS, AND NOTHING ELSE. `api.partnerLeaderboard` asks
 * `/partnernet/leaderboard` (admin only, with names, emails and earnings) and
 * falls back to `/partnernet/leaderboard/public` (initials, role, score,
 * relationships, reach, badges). Both return at most 25 rows with a network
 * score above zero, ordered by that score, across every member with one — not
 * partners alone. So:
 *
 *   · the board ranks by network score only; the canvas's Introductions,
 *     Referrals and Commissions chips are drawn, disabled, with the reason;
 *   · it has no period and no history, so there is no "this quarter" and no
 *     change against last time;
 *   · a rank is read off the returned order (`rankBoard`), equal scores
 *     sharing one, and a viewer outside the 25 is "Not ranked", never given a
 *     number the route did not return.
 *
 * OTHER MEMBERS ARE SHOWN BY RANK AND ROLE. The canvas says names are never
 * shown, and the admin arm of the route does return them; this page shows
 * neither the name nor the initials of anyone but the viewer, whoever reads it.
 *
 * NO WORKER RAIL, by the canvas (`rail: false` on `pe-board`).
 */

const BOARD_COLS = 'md:grid-cols-[64px_minmax(0,1.6fr)_110px_110px_80px_minmax(0,1fr)]';

/** The viewer's own standing, or why there is none. */
export function ViewerStanding({ state, ranked }) {
  if (state !== 'ready') return null;
  const mine = ranked.find((r) => r.isViewer);
  return (
    <Card padding="md" data-testid="card-viewer-standing">
      <SectionLabel>Your rank</SectionLabel>
      {mine && mine.rank !== null ? (
        <p className="mt-1.5 text-[13px] text-axal-ink dark:text-gray-100" data-testid="text-viewer-rank">
          <span className="text-[22px] font-extrabold tabular-nums">{mine.rank}</span>
          <span className="text-axal-muted"> of the {ranked.length} the board shows, with a network score of {mine.score}.</span>
        </p>
      ) : (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-axal-muted" data-testid="text-viewer-unranked">
          <Unrecorded reason="The route returns no rank for a member outside its list.">Not ranked</Unrecorded>
          {' '}
          {ranked.length
            ? `You are not among the ${ranked.length} member${ranked.length === 1 ? '' : 's'} the board returns. It lists the top 25 network scores above zero, and leaves out anyone hidden from the directory.`
            : 'The board has nobody on it yet.'}
        </p>
      )}
    </Card>
  );
}

/** The board, in the route's order, the viewer's row highlighted. */
export function LeaderboardTable({ state, ranked, onRetry }) {
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Table rows={6} cols={4} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="The leaderboard" claim="This is not a claim that nobody is ranked." onRetry={onRetry} /></div>;
  } else if (!ranked.length) {
    body = (
      <div className="p-4">
        <EmptyState size="sm" icon={Trophy} title="Nobody is ranked yet" body="No member has a network score above zero, so the board has no one to list." data-testid="empty-board" />
      </div>
    );
  } else {
    body = (
      <RowTable
        testid="table-board"
        cols={BOARD_COLS}
        head={['Rank', 'Member', 'Network score', 'Relationships', 'Reach', 'Change']}
        rows={ranked.map((r, i) => {
          const badges = (Array.isArray(r.row?.verified_badges) ? r.row.verified_badges : [])
            .map((b) => BADGE_LABELS[b] || titleCase(b)).filter(Boolean);
          const role = titleCase(r.row?.role);
          return {
            key: r.row?.id ?? i,
            testid: r.isViewer ? 'row-board-viewer' : `row-board-${i}`,
            className: r.isViewer ? 'bg-amber-50 font-semibold dark:bg-amber-950/30' : '',
            cells: [
              r.rank === null ? <Unrecorded>Not ranked</Unrecorded> : <span className="tabular-nums">{r.rank}</span>,
              <span className="flex flex-wrap items-center gap-1.5">
                {r.isViewer
                  ? <span className="font-extrabold text-axal-ink dark:text-gray-100">You</span>
                  : <span className="text-axal-muted">{role || 'Member'}</span>}
                {r.isViewer && role ? <span className="text-axal-muted">{role}</span> : null}
                {badges.map((b) => <Pill key={b} tone="neutral">{b}</Pill>)}
              </span>,
              r.score === null ? <Unrecorded>Not recorded</Unrecorded> : <span className="tabular-nums">{r.score}</span>,
              countOf(r.row?.active_relationships) === null ? <Unrecorded>Not recorded</Unrecorded> : <span className="tabular-nums">{countOf(r.row.active_relationships)}</span>,
              countOf(r.row?.network_reach) === null ? <Unrecorded>Not recorded</Unrecorded> : <span className="tabular-nums">{countOf(r.row.network_reach)}</span>,
              <Unrecorded reason="The board keeps no earlier standing to compare with.">Not recorded</Unrecorded>,
            ],
          };
        })}
      />
    );
  }
  return (
    <Panel
      title="Ranked by network score"
      meta={state === 'ready' && ranked.length ? `${ranked.length} member${ranked.length === 1 ? '' : 's'}, as the route orders them` : null}
      testid="panel-board"
    >
      {body}
      {state === 'ready' && ranked.length
        ? <p className="border-t border-axal-hairline px-4 py-2.5 text-[12px] text-axal-muted dark:border-gray-700">Other members appear by rank and role only. Names are never shown.</p>
        : null}
    </Panel>
  );
}

export default function PartnerLeaderboard({ user }) {
  const [board, setBoard] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    setBoard({ status: 'loading', data: null });
    api.partnerLeaderboard()
      .then((d) => setBoard({ status: 'ready', data: Array.isArray(d) ? d : [] }))
      .catch(() => setBoard({ status: 'unreadable', data: null }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const ranked = useMemo(() => rankBoard(board.data, user?.id), [board.data, user?.id]);

  const none = 'No route ranks members by this. The board ranks by network score only.';
  return (
    <WorkspaceShell
      role="partner"
      title="Leaderboard"
      intro="Members ranked by network score. Your own row is highlighted; everyone else is shown by rank and role only."
    >
      <ZoneNav bucket={EARNINGS_AREA} role="partner" />
      <ZoneToolbar
        role="partner"
        className="mb-3"
        filters={[
          { label: 'Network score', testid: 'chip-metric-score', active: true, onSelect: () => {} },
          { label: 'Introductions', testid: 'chip-metric-introductions', disabled: true, title: none },
          { label: 'Referrals', testid: 'chip-metric-referrals', disabled: true, title: none },
          { label: 'Commissions', testid: 'chip-metric-commissions', disabled: true, title: none },
          { label: 'This period', testid: 'chip-period', disabled: true, title: 'The board has no period: it ranks the score as it stands now.' },
        ]}
      />
      <div className="max-w-4xl space-y-3">
        <ViewerStanding state={board.status} ranked={ranked} />
        <LeaderboardTable state={board.status} ranked={ranked} onRetry={load} />
        <StatedLimit title="What this board does not claim">
          <p><strong>One measure.</strong> The network score is the platform’s own composite of accepted relationships, referral reach, activity in the last 30 days and lifetime commissions. No route ranks by any one of those alone.</p>
          <p className="mt-2"><strong>No period and no change.</strong> The score is the one stored now, so there is no quarter to pick and no earlier standing to compare with.</p>
          <p className="mt-2"><strong>Not only partners.</strong> Every member with a score is on it, so the role is shown beside each rank.</p>
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
