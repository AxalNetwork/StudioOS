// D953 (#2371) — Programs › Refer & Earn (PG9, PG9q, PG9s), from the reads
// that exist. This file is the routed page at `/admin/programs/refer-and-earn`
// (Overview), `/how-it-runs`, `/queue` and `/settings` (`guard(['admin'])` in
// App.jsx; `/admin/refer-earn` redirects to Queue with `?moved=refer-earn`)
// and board S9's file: its default export is one `AdminBoardFrame` named
// "Referrals", board S9's name, and the page sits in `ReferBody` inside it.
// Queue mounts the review console's body, never its default export, so the
// page has one rail.
//
// D962 (#2795) completes it on part 4's reads (D957): Overview's tiles from
// exact totals with their window, Waiting for review's counts and bands, the
// funnel's current tags, Referrals per week by category, and Strategic
// referral access with Grant and Decline; the Queue paged with its total and
// its referral dialog; Activity; and the phone pages.
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Lightbox } from '../../../ui';
import { api } from '../../../lib/api';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import AdminBoardFrame from '../AdminBoardFrame';
import { ReferralReviewBody } from '../ReferralReview';
import ActivityTab from './ActivityTab';
import PlaybookEditor, { useProgramDetail } from './PlaybookEditor';
import ProgramFrame from './ProgramFrame';
import { ReferTabs } from './ProgramTabs';
import {
  BlockFailed, Card, ChartCard, DIALOG_BODY, DIALOG_LINES, DialogButtons, Field, Pill, Skeleton, SUB, Tile, Unread,
} from './parts';
import { useReferReads } from './useProgramReads';
import {
  ALL_TIME, FUNNEL_REASON, FUNNEL_TAGS, STRATEGIC_DECLINE, STRATEGIC_DONE, STRATEGIC_EMPTY, STRATEGIC_FOOT, STRATEGIC_GRANT, WEEKS_LINE,
  referWaiting, referWeeklyChart, refusalSentence, strategicRow, totalOf,
} from './programPagesModel';
import {
  BANDS, COULD_NOT_READ, NOT_READ_YET, OPEN_STATUSES, OPEN_WORDS, READING, WHO_CAN_REFER, ageText,
  isFailed, isReady, laneFrom, routeFor,
} from './programsModel';

const nf = (n) => Number(n).toLocaleString('en-US');
const STATUS_WHAT = { submitted: 'The submitted referrals', under_review: 'The referrals under review', more_info_needed: 'The referrals waiting on the member' };

/** A tile on one exact total (F1), with its window. */
const totalTile = (key, label, read, sub) => {
  const n = totalOf(read);
  if (n !== null) return { key, label, state: 'ready', value: nf(n), sub };
  return { key, label, state: isFailed(read) || isReady(read) ? 'unreadable' : 'loading', reason: `${label} could not be read. That is not the same as none.` };
};

function WaitingForReview({ reads, w, lane }) {
  return (
    <Card title="Waiting for review" meta={w.state === 'ready' ? nf(w.total) : w.state === 'unreadable' ? COULD_NOT_READ : READING} testId="programs-refer-waiting">
      <ul className="m-0 flex list-none flex-col p-0">
        {OPEN_STATUSES.map((s) => {
          const read = reads.totals[s];
          const n = totalOf(read);
          return (
            <li key={s} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-refer-status-${s}`}>
              <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{OPEN_WORDS[s]}</span>
              {n !== null ? <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100">{nf(n)}</span> : null}
              {n === null && !isFailed(read) && !isReady(read) ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
              {n === null && (isFailed(read) || isReady(read)) ? <BlockFailed what={STATUS_WHAT[s]} onRetry={reads.reload} testId={`programs-refer-status-${s}-unreadable`} /> : null}
            </li>
          );
        })}
      </ul>
      {w.state === 'ready' ? (
        <span className={SUB} data-testid="programs-refer-bands">
          {`${BANDS.map((b) => `${b.label}: ${nf(w.bands[b.key])}`).join(' · ')}${w.bandsCover ? `, ${w.bandsCover}` : ''}`}
        </span>
      ) : null}
      {w.state === 'unreadable' ? <span className={SUB}>No total or bands are drawn while a status could not be read.</span> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-2 dark:border-gray-700" data-testid="programs-refer-oldest">
        {lane.state === 'ready' ? (
          <>
            <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{lane.count ? `Oldest: ${ageText(lane.oldestHours) || 'age not recorded'} since submitted` : 'Oldest: none waiting'}</span>
            {lane.sla === 'past' ? <Pill tone="amber" testId="programs-refer-overdue"><span aria-hidden="true">!</span>Overdue</Pill> : null}
          </>
        ) : null}
        {lane.state === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span> : null}
        {lane.state === 'unreadable' ? (
          <span className="flex flex-col gap-0.5">
            <span role="alert" className="text-[12.5px] font-bold text-red-700 dark:text-red-300">{`Oldest and Overdue: ${COULD_NOT_READ}`}</span>
            <span className={SUB}>The Referrals lane on the Studio glance could not be read. The counts above still stand.</span>
            <button type="button" onClick={reads.reload} className="self-start text-[12px] font-semibold text-red-700 underline dark:text-red-300">Try again</button>
          </span>
        ) : null}
      </div>
      <p className={`m-0 ${SUB}`}>Exact counts, all time.</p>
    </Card>
  );
}

/** The funnel (dc:416): no read serves the stages reached, so only the current tags draw. */
function Funnel({ reads }) {
  const tags = { more_info_needed: reads.totals.more_info_needed, rejected: reads.rejected, closed: reads.closed };
  return (
    <Card title="Referral funnel" testId="programs-refer-funnel">
      <Unread word={NOT_READ_YET} reason={FUNNEL_REASON} testId="programs-refer-funnel-bars" />
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400" data-testid="programs-refer-funnel-tags">
        {FUNNEL_TAGS.map((t) => {
          const n = totalOf(tags[t.key]);
          return <span key={t.key} data-testid={`programs-refer-funnel-${t.key}`}>{`${t.word} ${n !== null ? nf(n) : isFailed(tags[t.key]) ? COULD_NOT_READ.toLowerCase() : '…'}`}</span>;
        })}
      </p>
    </Card>
  );
}

function StrategicDialog({ row, decision, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const go = async () => {
    setBusy(true);
    setRefusal('');
    try {
      await api.adminStrategicAccessDecision(row.id, { decision, ...(note.trim() ? { note: note.trim() } : {}) });
      setDone(STRATEGIC_DONE[decision]);
      onDone?.();
    } catch (e) {
      setRefusal(refusalSentence(e, 'That decision was not recorded. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const label = `${decision === 'granted' ? 'Grant' : 'Decline'} strategic referral access for ${row.name}?`;
  return (
    <Lightbox label={label} title={label} sub={`${row.role} · asked ${row.asked}`} onClose={onClose} testId="programs-strategic-dialog"
      footer={<DialogButtons onClose={onClose} action={decision === 'granted' ? 'Grant' : 'Decline'} tone={decision === 'granted' ? 'primary' : 'danger'} busy={busy} onAction={go} refusal={refusal} done={done} testId="programs-strategic-go" />}>
      <div className={DIALOG_BODY}>
        {row.note ? <p className="m-0 text-[13px] italic text-axal-ink dark:text-gray-100">{`“${row.note}”`}</p> : null}
        <ul className={DIALOG_LINES}><li>{decision === 'granted' ? STRATEGIC_GRANT : STRATEGIC_DECLINE}</li></ul>
        <Field label="Note for the audit · optional" value={note} onChange={setNote} max={4000} rows={2} testId="programs-strategic-note" />
      </div>
    </Lightbox>
  );
}

function Strategic({ reads }) {
  const [dialog, setDialog] = useState(null);
  const read = reads.strategic;
  const rows = isReady(read) ? read.data.items.map(strategicRow) : [];
  const total = totalOf(read);
  return (
    <Card title="Strategic referral access" meta={total !== null ? `${nf(total)} asking` : null} testId="programs-refer-strategic">
      {read.status === 'loading' ? <Skeleton lines={2} /> : null}
      {read.status === 'error' ? <BlockFailed what="The strategic access requests" onRetry={reads.reload} testId="programs-refer-strategic-unreadable" /> : null}
      {isReady(read) && !rows.length ? <p className={`m-0 ${SUB}`} data-testid="programs-refer-strategic-none">{STRATEGIC_EMPTY}</p> : null}
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`programs-refer-strategic-${r.id}`}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{`${r.name} · ${r.role} · asked ${r.asked}`}</span>
                {r.note ? <span className={SUB}>{r.note}</span> : null}
              </span>
              <span className="flex gap-1.5">
                <button type="button" onClick={() => setDialog({ row: r, decision: 'granted' })} className="min-h-[36px] rounded-[9px] border border-axal-hairline px-3 text-[12.5px] font-bold dark:border-gray-700" data-testid={`programs-refer-strategic-${r.id}-grant`}>Grant</button>
                <button type="button" onClick={() => setDialog({ row: r, decision: 'declined' })} className="min-h-[36px] rounded-[9px] border border-axal-hairline px-3 text-[12.5px] font-bold dark:border-gray-700" data-testid={`programs-refer-strategic-${r.id}-decline`}>Decline</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {total !== null && total > rows.length ? <p className={`m-0 ${SUB}`}>{`The oldest ${nf(rows.length)} of ${nf(total)} are listed.`}</p> : null}
      <p className={`m-0 ${SUB}`}>{STRATEGIC_FOOT}</p>
      {dialog ? <StrategicDialog row={dialog.row} decision={dialog.decision} onClose={() => setDialog(null)} onDone={reads.reload} /> : null}
    </Card>
  );
}

function ReferOverview({ reads }) {
  const now = Date.now();
  const w = referWaiting(reads.totals, reads.oldest, now);
  const lane = laneFrom(reads.glance, 'referrals');
  const weekly = referWeeklyChart(reads.weekly);
  const waitTile = w.state === 'ready'
    ? {
      key: 'waiting', label: 'Waiting for review', state: 'ready', value: nf(w.total),
      sub: lane.state === 'ready' && lane.count && lane.oldestHours !== null ? `oldest ${ageText(lane.oldestHours)}` : null,
      overdue: lane.state === 'ready' && lane.sla === 'past',
    }
    : { key: 'waiting', label: 'Waiting for review', state: w.state, reason: 'An open status could not be read, so no total is drawn.' };
  return (
    <div className="flex flex-col gap-4" data-testid="programs-refer-overview">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <Tile t={totalTile('referrals', 'Referrals', reads.all, ALL_TIME)} onRetry={reads.reload} />
        <Tile t={waitTile} onRetry={reads.reload} />
        <Tile t={totalTile('converted', 'Converted', reads.converted, `Converted, reward eligible or reward issued. ${ALL_TIME}`)} onRetry={reads.reload} />
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <WaitingForReview reads={reads} w={w} lane={lane} />
        <Funnel reads={reads} />
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <ChartCard title="Referrals per week by category" testId="programs-refer-weekly" onRetry={reads.reload}
          b={weekly.state === 'ready' ? { ...weekly, window: WEEKS_LINE } : { state: weekly.state, what: 'The referrals per week' }} />
        <Strategic reads={reads} />
      </div>
    </div>
  );
}

function ReferSettings() {
  return (
    <Card title="Who can refer" meta="Read only" testId="programs-refer-settings">
      <p className="m-0 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100">{WHO_CAN_REFER}</p>
    </Card>
  );
}

function ReferBody() {
  const { pathname } = useLocation();
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const { tab } = routeFor(pathname);
  const reads = useReferReads(tab);
  const detail = useProgramDetail('refer-and-earn', tab === 'how');
  const open = totalOf(reads.open);
  const queue = open !== null ? { text: nf(open), amber: open > 0, title: 'Every open referral' } : null;
  return (
    <ProgramFrame program="refer-and-earn" superAdmin={superAdmin} tabs={<ReferTabs queue={queue} />}>
      {tab === 'overview' ? <ReferOverview reads={reads} /> : null}
      {tab === 'how' ? <PlaybookEditor program="refer-and-earn" superAdmin={superAdmin} detail={detail} testId="programs-refer-how" /> : null}
      {tab === 'queue' ? <ReferralReviewBody embedded onChanged={reads.reload} /> : null}
      {tab === 'settings' ? <ReferSettings /> : null}
      {tab === 'activity' ? <ActivityTab program="refer-and-earn" testId="programs-refer-activity" /> : null}
    </ProgramFrame>
  );
}

// D774 (#2100): S9 drew no rail. The board's page, in the Admin boards' frame.
export default function ReferAndEarn() {
  return (
    <AdminBoardFrame workspace="Referrals" note="Eadwyn reads the program figures on this page. Nothing changes until you act." data-testid="admin-board-referrals">
      <ReferBody />
    </AdminBoardFrame>
  );
}
