import { useEffect, useState } from 'react';
import { BrandIcon, Pill, Unreadable } from '../ui';
import { reportError } from '../lib/log';
import {
  NONE_SHARED, NOT_ACCREDITATION, PILL_TONE, PROOF_CHIP, coverText, otherActiveText,
} from '../lib/proofOfFunds';

// D752 (#1890) — an investor's shared proof of funds, as Axal's admins read it.
// Three parts, one per need: the queue's chip, one statement, and the LP
// application's row, which reads once per selection. Every value is drawn as
// text. A revoked statement, or none, draws no Mercury mark: no Mercury figure
// is shown. Built from the parts on main: Pill, BrandIcon and Unreadable.

/** The LP application queue's chip for a state; `none` and null draw nothing. */
export function ProofChip({ state }) {
  const chip = state ? PROOF_CHIP[state] : null;
  if (!chip) return null;
  return <Pill tone={chip[1]} data-testid="proof-chip">{chip[0]}</Pill>;
}

/** One statement: active or expired with the Mercury tile and the figures; revoked with its date only. */
export function ProofStatement({ item, figureDollars = null, mark = true }) {
  if (!item) return null;
  if (item.state === 'revoked') {
    return (
      <div className="min-w-0 flex-1 text-[12px] text-axal-muted dark:text-gray-400" data-testid="proof-statement">
        <span className="break-words">{item.statement}</span>{' '}
        <Pill tone="neutral">Revoked</Pill>
      </div>
    );
  }
  const cover = coverText(item.amount_floor_cents, figureDollars);
  const others = otherActiveText(item);
  return (
    <div className="min-w-0 flex-1 space-y-1 text-[12px] text-axal-ink dark:text-gray-200" data-testid="proof-statement">
      <div className="flex min-w-0 items-start gap-2">
        {mark && <BrandIcon provider="mercury" name="Mercury" size={24} />}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-axal-muted dark:text-gray-400">Mercury</div>
          <div className="break-words">{item.statement}</div>
        </div>
        <Pill tone={PILL_TONE[item.label] || 'neutral'}>{item.label}</Pill>
      </div>
      {cover && <div className="text-axal-muted dark:text-gray-400">{cover}</div>}
      {others && <div className="break-words text-axal-muted dark:text-gray-400">{others}</div>}
      <div className="text-axal-muted dark:text-gray-400">{NOT_ACCREDITATION}</div>
    </div>
  );
}

/**
 * The LP application's "Proof of funds" row. Null draws nothing; `none` says
 * so and makes no read; any other state reads once (an audited request that
 * counts a view) on mount, so the page keys it by the application.
 */
export function ProofOfFundsRow({ state, load, figureDollars = null }) {
  const [read, setRead] = useState({ status: state && state !== 'none' ? 'loading' : 'idle', item: null, error: null });
  useEffect(() => {
    if (!state || state === 'none') return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await load();
        if (alive) setRead({ status: 'ok', item: res?.items?.[0] ?? null, error: null });
      } catch (e) {
        reportError('proof-of-funds:application', e);
        // A Worker answer carries a status and our sentence; anything else is a read that failed.
        if (alive) setRead({ status: e?.status ? 'refused' : 'unreadable', item: null, error: e });
      }
    })();
    return () => { alive = false; };
    // One read per mount: the page keys this row by the application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!state) return null;
  if (state === 'none') {
    return (
      <div className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="proof-none">
        <div>{NONE_SHARED}</div>
        <div>{NOT_ACCREDITATION}</div>
      </div>
    );
  }
  if (read.status === 'loading') return <span className="text-[12px] text-axal-muted dark:text-gray-400">Reading the proof of funds…</span>;
  if (read.status === 'unreadable') return <Unreadable what="The proof of funds" claim="This is not a claim that none was shared." />;
  if (read.status === 'refused') return <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{read.error?.message || 'The proof of funds could not be read.'}</p>;
  if (!read.item) {
    return (
      <div className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="proof-none">
        <div>{NONE_SHARED}</div>
        <div>{NOT_ACCREDITATION}</div>
      </div>
    );
  }
  return <ProofStatement item={read.item} figureDollars={figureDollars} />;
}
