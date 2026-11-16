/**
 * D4708 part 3 (#4708) — the Trust workspace's two zones from the overview read, moved out of
 * `../SecurityPage.jsx` unchanged: H23's Sanctions card and the KYC review queue.
 */
import React from 'react';
import { Unrecorded, Unreadable } from '../../../ui';
import { NotRecordedList, Stat, Zone } from './SecurityParts.jsx';
import { day, num } from './securityShared.js';

/**
 * D200 — H23's Sanctions card, from the store's own figures.
 *
 * The card this replaced was one `<Stat value={null}>` reading the server's
 * refusal, and that refusal — "No sanctions screening runs on the platform" —
 * was false: `sanctions_screenings` has existed since migration 035 and
 * `screenUser` writes one row per on-request run. Four figures now, plus the
 * server's sentence about HOW a run happens, because a count of zero on a
 * store nothing schedules is a measured zero and must not read as a store
 * that does not exist. Unreadable is its own state, with the reason.
 */
export function Sanctions({ block, unreadable }) {
  // `!block` is loading OR a failed overview read, and those are different
  // claims: under a failed read "Loading…" would say an answer is coming.
  if (!block) {
    return unreadable
      ? (
        <Unreadable
          what="The security overview"
          claim="This is not a claim that nothing happened."
        />
      )
      : <p className="text-[12px] text-axal-muted">Loading…</p>;
  }
  if (!block.available) {
    return (
      <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-sanctions-unreadable">
        <Unrecorded reason={block.reason} />
      </p>
    );
  }
  return (
    <div data-testid="hq-sanctions">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Screening runs" value={num(block.runs_total)} note={block.runs_total === 0 ? 'none has been asked for' : 'recorded, one row per run'} />
        <Stat label="Last run" value={block.last_run_at ? day(block.last_run_at) : 'never'} note="on request, never scheduled" />
        <Stat label="Hits" value={num(block.hits_total)} note="runs that matched a list" tone={block.hits_total ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'} />
        <Stat label="Unreviewed hits" value={num(block.unreviewed_hits)} note="awaiting a reviewer's note" tone={block.unreviewed_hits ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-muted">
        {block.how} <a href={block.path} className="underline">Open the Trust Center →</a>
      </p>
    </div>
  );
}

/** The KYC review queue, a trust fact apart from sanctions screening. */
export function KycZone({ ready, data, kyc, kycReadable }) {
  return (
    <Zone title="KYC" sub="the review queue">
      {ready && !kycReadable && (
        <div className="mb-2" data-testid="hq-kyc-unreadable">
          <Unreadable what="The KYC queue" claim="This is not a claim that the queue is empty." />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="KYC pending" value={kycReadable ? num(kyc.pending) ?? '0' : null} note="documents submitted, unverified" tone={kyc.pending ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
        <Stat label="KYC approved" value={kycReadable ? num(kyc.approved) ?? '0' : null} note="active accounts" />
        <Stat label="KYC rejected" value={kycReadable ? num(kyc.rejected) ?? '0' : null} note="active accounts" />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-muted">
        KYC status is one trust fact; sanctions screening is another and has its own card above, because the
        two are different stores that fail apart.
      </p>
      {ready && <NotRecordedList items={data.kyc_not_recorded} testid="hq-kyc-not-recorded" />}
    </Zone>
  );
}
