import React, { useState } from 'react';
import { TIER_PLANS } from '../../../components/PaywallModal';
import { api } from '../../../lib/api';
import {
  BlockFailed, CARD, Card, Done, INPUT, Refusal, Skeleton, SUB, Tile,
} from './parts';
import {
  CLAIMS_REASON, HQ_READS_MONEY, NOTHING_WAITING, NOT_READ_YET, OVERDUE_HOURS, PERK_APPROVED, PERK_REJECTED, PERKS_EMPTY,
  REJECT_NEEDS_NOTE, ageText, approveBody, hoursSince, livePerksFrom, perkPrice, perkQueueFrom, refusalText, rejectBody,
} from './programsModel';

/**
 * D953 (#2371) — Perks (PG10): Overview's tiles and the review Queue, from R3
 * (`in_review` and `draft`, the oldest 200) and R4 (the live listings, at
 * most 200). Only `in_review` rows are counted and listed: a draft is not
 * reviewer backlog. A listing waits from its last edit.
 */

const tierName = (t) => TIER_PLANS[t]?.label || (t === 'free' ? 'Free' : '');
const BALANCES_UNSUMMED = 'No read sums members’ balances yet.';

export function PerksOverview({ reads, superAdmin }) {
  const now = Date.now();
  const live = livePerksFrom(reads.perks);
  const q = perkQueueFrom(reads.perkQueue, now);
  const liveTile = live.state === 'ready'
    ? { key: 'live', label: 'Live perks', state: 'ready', value: live.text, cover: live.capped ? 'The catalogue read stops at 200 listings.' : null }
    : { key: 'live', label: 'Live perks', state: live.state, reason: 'The live perks could not be read. That is not the same as none.' };
  const waitTile = q.state === 'ready'
    ? {
      key: 'waiting', label: 'Waiting for review', state: 'ready', value: q.text,
      sub: q.count && q.oldestHours !== null ? `oldest ${ageText(q.oldestHours)} since last edit` : q.count ? null : NOTHING_WAITING,
      overdue: q.count > 0 && q.oldestHours !== null && q.oldestHours >= OVERDUE_HOURS,
      cover: q.atLeast ? 'The queue read stops at 200 listings, drafts included.' : null,
    }
    : { key: 'waiting', label: 'Waiting for review', state: q.state, reason: 'The review queue could not be read. That is not the same as none.' };
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="programs-perks-overview">
      <Tile t={liveTile} onRetry={reads.reload} />
      <Tile t={waitTile} onRetry={reads.reload} />
      <Tile t={{ key: 'claims', label: 'Claims', state: 'placeholder', word: NOT_READ_YET, reason: CLAIMS_REASON }} />
      <Tile t={{ key: 'credits', label: 'Credits held by members', state: 'placeholder', word: NOT_READ_YET, reason: superAdmin ? BALANCES_UNSUMMED : HQ_READS_MONEY }} />
    </div>
  );
}

/** One listing in the Queue: its offer, partner, price and age, and its own review, refusal and all. */
function QueueRow({ row, now, onDone }) {
  const [note, setNote] = useState('');
  const [editorial, setEditorial] = useState('');
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const age = ageText(hoursSince(row.updated_at || row.created_at, now));
  const typed = note.trim();
  const act = async (action) => {
    setBusy(true);
    setRefusal('');
    try {
      await api.perkReview(row.uid, action === 'approve' ? approveBody(row, { note, featured, editorial }) : rejectBody({ note }));
      onDone(action === 'approve' ? PERK_APPROVED : PERK_REJECTED);
    } catch (e) {
      setRefusal(refusalText(e, e?.message || 'That review did not save.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`${CARD} flex flex-col gap-2.5 px-4 py-3.5`} data-testid={`programs-perks-row-${row.uid}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{row.offer}</span>
        <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid={`programs-perks-row-${row.uid}-age`}>{age ? `${age} since last edit` : 'Last edit not recorded'}</span>
      </div>
      <span className={SUB} data-testid={`programs-perks-row-${row.uid}-meta`}>{`${row.partner_name || 'Partner not recorded'} · ${perkPrice(row, tierName)}`}</span>
      {row.review_note ? <span className={SUB} data-testid={`programs-perks-row-${row.uid}-stored`}>{`Stored note: ${row.review_note}`}</span> : null}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Note</span>
        <input className={`${INPUT} w-full`} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Required to reject; the partner reads it" data-testid={`programs-perks-row-${row.uid}-note`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Editorial line, shown if featured</span>
        <input className={`${INPUT} w-full`} maxLength={500} value={editorial} onChange={(e) => setEditorial(e.target.value)}
          data-testid={`programs-perks-row-${row.uid}-editorial`} />
      </label>
      <label className="flex items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
        <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} data-testid={`programs-perks-row-${row.uid}-feature`} />
        Feature it in “Featured this month”
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => act('approve')} data-testid={`programs-perks-row-${row.uid}-approve`}
          className="rounded-[9px] bg-axal-violet px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60 dark:bg-violet-600">Approve</button>
        <button type="button" disabled={busy || !typed} onClick={() => act('reject')} data-testid={`programs-perks-row-${row.uid}-reject`}
          className="rounded-[9px] border border-red-300 px-3.5 py-1.5 text-[12.5px] font-bold text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300">Reject</button>
        {!typed ? <span className={SUB}>{REJECT_NEEDS_NOTE}</span> : null}
      </div>
      <Refusal text={refusal} testId={`programs-perks-row-${row.uid}-refusal`} />
    </li>
  );
}

export function PerksQueue({ reads }) {
  const now = Date.now();
  const q = perkQueueFrom(reads.perkQueue, now);
  const [done, setDone] = useState('');
  return (
    <Card title="Review queue" meta={q.state === 'ready' ? `${q.text} in review` : null} testId="programs-perks-queue">
      {done ? <Done testId="programs-perks-done">{done}</Done> : null}
      {q.state === 'loading' ? <Skeleton lines={3} /> : null}
      {q.state === 'unreadable' ? <BlockFailed what="The review queue" onRetry={reads.reload} testId="programs-perks-queue-unreadable" /> : null}
      {q.state === 'ready' && q.atLeast ? <p className={`m-0 ${SUB}`} data-testid="programs-perks-queue-full">The queue read stops at 200 listings, drafts included, so at least this many wait.</p> : null}
      {q.state === 'ready' && !q.rows.length ? (
        <div className="flex flex-col gap-1" data-testid="programs-perks-queue-empty">
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{NOTHING_WAITING}</span>
          <span className={SUB}>{PERKS_EMPTY}</span>
        </div>
      ) : null}
      {q.state === 'ready' && q.rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {q.rows.map((row) => <QueueRow key={row.uid} row={row} now={now} onDone={(text) => { setDone(text); reads.reload(); }} />)}
        </ul>
      ) : null}
    </Card>
  );
}
