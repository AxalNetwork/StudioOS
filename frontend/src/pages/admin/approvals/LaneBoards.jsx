import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { AdminPageHeader, HeaderTab } from '../../../ui';
import AdminBoardFrame from '../AdminBoardFrame';
import { BandPill } from './AdminApprovals';
import {
  BOARDS, EXPERT_TABS, NOT_YET, PITCH_TABS, RAIL_NOTE,
  attributionTotals, boardOf, expertBoard, pitchRows,
} from './approvalsModel';

/**
 * D1038 (#2390) — the three lane boards this canvas draws (APR4, APR6, APR8),
 * at /admin/approvals/product-testers, /co-marketing and /wellbeing-experts,
 * each tab a sub-path.
 *
 * THEY READ; THEY DO NOT DECIDE YET (D1038 §3). Co-marketing's decisions skip
 * the HQ freeze and tell nobody (parts 1 and 5), and wellbeing's record
 * nothing (part 5), so the canvas's dialogs, which promise both, wait for
 * part 8.
 * Until then each board names the page that decides today. Product testers
 * have no store (part 4): their board says so and lists nothing.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const TH = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2.5 align-top text-[13px] text-axal-ink dark:text-gray-100';
const TYPE = 'ml-1.5 rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';
const NEW_PILL = { label: 'New lane', tone: 'held' };
const CRUMB = (current) => ({ to: '/admin/approvals', label: 'Approvals', current });
const nf = (n) => Number(n).toLocaleString('en-US');

function Failed({ what, onRetry, testId }) {
  return (
    <div role="alert" className={`${CARD} flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-axal-destructive dark:text-red-300`} data-testid={testId}>
      <span>{what} could not be read. That is not the same as having none.</span>
      <button type="button" className="font-bold underline" onClick={onRetry}>Try again</button>
    </div>
  );
}

function Tile({ label, children, sub, testId }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1 px-4 py-3`} data-testid={testId}>
      <span className={EYE}>{label}</span>
      <div className="text-[22px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{children}</div>
      {sub ? <span className={SUB}>{sub}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Product testers (APR4)
 * ------------------------------------------------------------------ */

function ProductTesters() {
  const b = BOARDS['product-testers'];
  return (
    <div className="flex flex-col gap-5" data-testid="approvals-board-product-testers">
      <AdminPageHeader crumb={CRUMB(b.title)} title={b.title} pills={[NEW_PILL]} line={b.line} scope data-testid="approvals-board-header" />
      <section className={`${CARD} flex flex-col items-start gap-2 px-5 py-5`} data-testid="approvals-testers-none">
        <h2 className={H2}>{NOT_YET}</h2>
        <p className={`m-0 ${SUB}`}>No product tester application is stored yet, so there is nothing to approve here. The tester store, its routes and the notices are part 4; how members apply waits on the intake decision (#2318).</p>
        <p className={`m-0 ${SUB}`}>Testing programs and who they pick stay on Platform › Product testing (HQ).</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Co-marketing pitches (APR6)
 * ------------------------------------------------------------------ */

const idle = { status: 'loading', data: null };

/** Each state's queue, read alone, so one failure costs only its tab. */
function usePitches() {
  const [reads, setReads] = useState(() => Object.fromEntries(PITCH_TABS.map((t) => [t.key, idle])));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setReads(Object.fromEntries(PITCH_TABS.map((t) => [t.key, idle])));
    for (const t of PITCH_TABS) {
      api.adminCoMarketingQueue(t.key).then(
        (d) => { if (live) setReads((r) => ({ ...r, [t.key]: { status: 'ready', data: d?.items || [] } })); },
        (e) => { reportError(`approvals:comarketing:${t.key}`, e); if (live) setReads((r) => ({ ...r, [t.key]: { status: 'error', data: null } })); },
      );
    }
    return () => { live = false; };
  }, [tick]);
  return { reads, reload: useCallback(() => setTick((t) => t + 1), []) };
}

const countOf = (read) => (read.status === 'loading' ? { kind: 'load' } : read.status === 'error' ? { kind: 'dash', tip: 'This list could not be read.' } : { kind: 'num', value: nf(read.data.length) });

function CoMarketing({ tab }) {
  const b = BOARDS['co-marketing'];
  const { reads, reload } = usePitches();
  const read = reads[tab];
  const rows = read.status === 'ready' ? pitchRows(read.data) : [];
  const published = reads.published.status === 'ready' ? attributionTotals(reads.published.data) : null;
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals/co-marketing" count={countOf(reads.proposed)} data-testid="pitches-tab-proposed">Proposed</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/approved" count={countOf(reads.approved)} data-testid="pitches-tab-approved">Approved, to publish</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/published" count={countOf(reads.published)} data-testid="pitches-tab-published">Published</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/declined" count={countOf(reads.rejected)} data-testid="pitches-tab-rejected">Declined</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/withdrawn" count={countOf(reads.withdrawn)} data-testid="pitches-tab-withdrawn">Withdrawn</HeaderTab>
    </>
  );
  return (
    <div className="flex flex-col gap-5" data-testid="approvals-board-co-marketing">
      <AdminPageHeader crumb={CRUMB(b.title)} title={b.title} pills={[NEW_PILL]} line={b.line} scope tabs={tabs} data-testid="approvals-board-header" />
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Tile label="Waiting" testId="pitches-tile-waiting">{reads.proposed.status === 'ready' ? <span className={MONO}>{nf(reads.proposed.data.length)}</span> : reads.proposed.status === 'error' ? '—' : '…'}</Tile>
        <Tile label="Approved, not yet published" testId="pitches-tile-approved">{reads.approved.status === 'ready' ? <span className={MONO}>{nf(reads.approved.data.length)}</span> : reads.approved.status === 'error' ? '—' : '…'}</Tile>
        <Tile label="Visits from published pitches" sub="All time; the 30-day window is part 5." testId="pitches-tile-visits">{published ? <span className={MONO}>{nf(published.visits)}</span> : '—'}</Tile>
        <Tile label="Sign-ups" sub="All time." testId="pitches-tile-signups">{published ? <span className={MONO}>{nf(published.signups)}</span> : '—'}</Tile>
      </div>
      <p className={`m-0 ${SUB}`} data-testid="pitches-decide-line">
        Approve, decline and publish stay on <Link to="/comarketing" className={LINK}>Co-marketing</Link> (its Review queue) until this board’s dialogs, which tell the partner, land (parts 5 and 8).
      </p>
      {read.status === 'error' ? <Failed what="These pitches" onRetry={reload} testId="pitches-failed" />
        : read.status === 'loading' ? <p className={`m-0 ${SUB}`}>Reading…</p>
          : rows.length ? (
            <section className={`${CARD} overflow-x-auto`} data-testid="pitches-table">
              <table className="w-full min-w-[720px]">
                <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Waiting</th><th className={TH}>Pitch</th><th className={TH}>Partner</th><th className={TH}>Proposed date</th><th className={TH}>{tab === 'published' ? 'Attribution' : 'Audience'}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`pitch-${r.key}`}>
                      <td className={TD}><span className={MONO}>{r.age || 'Age not recorded'}</span>{tab === 'proposed' ? <BandPill band={r.band} /> : null}</td>
                      <td className={TD}>{r.title}<span className={TYPE}>{r.type}</span>{tab === 'approved' && r.code ? <div className={`${SUB} ${MONO}`}>Attribution code {r.code}</div> : null}</td>
                      <td className={TD}>{r.partner}{r.submitter ? <div className={SUB}>{r.submitter}</div> : null}</td>
                      <td className={TD}>{r.date}</td>
                      <td className={TD}>{tab === 'published' && r.attribution
                        ? <span className={MONO}>{`${nf(r.attribution.visit || 0)} visits · ${nf(r.attribution.signup || 0)} sign-ups · ${nf(r.attribution.lead || 0)} leads · ${nf(r.attribution.conversion || 0)} conversions`}</span>
                        : r.audience}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : <p className={`m-0 ${SUB}`} data-testid="pitches-empty">No pitch is in this state.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Wellbeing experts (APR8)
 * ------------------------------------------------------------------ */

function useExperts() {
  const [read, setRead] = useState(idle);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setRead(idle);
    api.wellbeingExperts({ limit: 50 }).then(
      (d) => { if (live) setRead({ status: 'ready', data: d }); },
      (e) => { reportError('approvals:wellbeing', e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [tick]);
  return { read, reload: useCallback(() => setTick((t) => t + 1), []) };
}

function Wellbeing({ tab }) {
  const b = BOARDS['wellbeing-experts'];
  const { read, reload } = useExperts();
  const board = read.status === 'ready' ? expertBoard(read.data, tab) : null;
  const count = (k) => (read.status === 'loading' ? { kind: 'load' } : !board ? { kind: 'dash', tip: 'The experts could not be read.' }
    : board.partial ? { kind: 'dash', tip: `Counted over the first ${board.read} of ${board.total ?? 'an unknown number of'} experts.` } : { kind: 'num', value: nf(board.counts[k]) });
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals/wellbeing-experts" count={count('verify')} data-testid="experts-tab-verify">To verify</HeaderTab>
      <HeaderTab to="/admin/approvals/wellbeing-experts/incomplete" count={count('incomplete')} data-testid="experts-tab-incomplete">Profile incomplete</HeaderTab>
      <HeaderTab to="/admin/approvals/wellbeing-experts/verified" count={count('verified')} data-testid="experts-tab-verified">Verified</HeaderTab>
      <HeaderTab to="/admin/approvals/wellbeing-experts/hidden" count={count('hidden')} data-testid="experts-tab-hidden">Hidden</HeaderTab>
    </>
  );
  const word = EXPERT_TABS.find((t) => t.key === tab)?.label;
  return (
    <div className="flex flex-col gap-5" data-testid="approvals-board-wellbeing-experts">
      <AdminPageHeader crumb={CRUMB(b.title)} title={b.title} pills={[NEW_PILL]} line={b.line} scope tabs={tabs} data-testid="approvals-board-header" />
      <p className={`m-0 ${SUB}`} data-testid="experts-decide-line">
        Verify and hide stay on <Link to="/admin/wellbeing" className={LINK}>Wellbeing</Link> until this board’s dialogs land (part 8). Who decided, when and why, credentials and a declined state are part 5.
      </p>
      {read.status === 'error' ? <Failed what="The experts" onRetry={reload} testId="experts-failed" />
        : read.status === 'loading' ? <p className={`m-0 ${SUB}`}>Reading…</p>
          : (
            <>
              {board.partial ? <p className={`m-0 ${SUB}`} data-testid="experts-partial">{`This list is the first ${board.read} of ${board.total ?? 'an unknown number of'} active experts, so the counts are not drawn.`}</p> : null}
              {board.rows.length ? (
                <section className={`${CARD} overflow-x-auto`} data-testid="experts-table">
                  <table className="w-full min-w-[640px]">
                    <thead><tr className="border-b border-axal-hairline dark:border-gray-700"><th className={TH}>Expert</th><th className={TH}>Categories</th><th className={TH}>Pricing</th><th className={TH}>Profile complete</th><th className={TH}>Waiting</th></tr></thead>
                    <tbody>
                      {board.rows.map((r) => (
                        <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`expert-${r.key}`}>
                          <td className={TD}>{r.name}{r.headline ? <div className={SUB}>{r.headline}</div> : null}</td>
                          <td className={TD}>{r.categories.length ? r.categories.join(', ') : <span className={SUB}>None given</span>}</td>
                          <td className={TD}>{r.pricing}</td>
                          <td className={TD}><span className={MONO}>{r.pct}%</span>{r.pct < 70 ? <div className={SUB}>Too incomplete to list</div> : null}</td>
                          <td className={TD}><span title="Experts carry no created date in this read." className={`cursor-help ${SUB}`}>Not recorded</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : <p className={`m-0 ${SUB}`} data-testid="experts-empty">{`No expert is in ${word}.`}</p>}
            </>
          )}
    </div>
  );
}

function Board() {
  const loc = useLocation();
  const at = boardOf(loc.pathname) || { board: 'product-testers', tab: 'waiting' };
  if (at.board === 'co-marketing') return <CoMarketing tab={at.tab} />;
  if (at.board === 'wellbeing-experts') return <Wellbeing tab={at.tab} />;
  return <ProductTesters />;
}

export default function LaneBoards() {
  return (
    <AdminBoardFrame workspace="Approvals" note={RAIL_NOTE} data-testid="admin-board-approvals-lanes">
      <div className="pb-24 lg:pb-10"><Board /></div>
    </AdminBoardFrame>
  );
}
