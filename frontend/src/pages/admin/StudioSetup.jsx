/**
 * D8728 (#8728) — Admin Studio's "Setup": the unfinished admin interview as
 * one resumable row below the decisions (canvas SAD01, SAD02).
 *
 * ⚑3 OPTION A (owner question open): while the admin bank is incomplete,
 * Eadwyn's chat is closed to one row — "Admin setup with Eadwyn · 11 answers
 * remaining", "0 of 11 admin-bank questions recorded" — and Resume setup opens
 * it in place with focus in the answer field. D324 alone collapsed the chat
 * only on completion; once the bank is complete the chat is mounted as before
 * and collapses itself to its D324 row.
 *
 * The chat is the page's: `AdminStudioHome` mounts `<StudioInterview
 * persona="admin" />` and hands it in as `chat`, so this file imports no
 * assistant and the one-mount rule (D324) holds where it is pinned.
 *
 * The row's figures are the posture's (`GET /api/advisor/admin-posture`), the
 * server's count over the bank, never the values on screen. A failed read says
 * Unavailable with Try again, and Resume setup still works.
 */
import React, { useEffect, useState } from 'react';
import { Unreadable } from '../../ui';
import { CHAT_ANCHOR, StudioPostureView, setupCount, usePosture } from './StudioPosture';

const SECTIONS = 'Oversight, Operations, Governance, Preferences';
const BTN = 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-4 text-[13px] font-bold text-axal-ink hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-axal-violet sm:min-h-[40px] sm:w-auto dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const SUB = 'text-[12.5px] leading-snug text-axal-muted dark:text-gray-400';

/** The meter: one segment per bank question, drawn, never announced (the words carry it). */
function Meter({ recorded, bankSize }) {
  return (
    <span aria-hidden="true" className="mt-2 flex gap-[3px]" data-testid="studio-setup-meter">
      {Array.from({ length: bankSize }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < recorded ? 'bg-axal-violet dark:bg-violet-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
      ))}
    </span>
  );
}

/** Presentational: the row. `posture` as `usePosture` gives it. */
export function StudioSetupRow({ posture, open, onToggle, onRetry }) {
  const count = setupCount(posture);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 sm:flex-row sm:items-center dark:border-gray-700 dark:bg-gray-900" data-testid="studio-setup-row">
      <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-axal-violet text-[13px] font-extrabold text-white dark:bg-violet-500 dark:text-white">E</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">
          Admin setup with Eadwyn
          {count ? <> · <span className="font-mono" data-testid="studio-setup-remaining">{count.remaining}</span> {count.remaining === 1 ? 'answer' : 'answers'} remaining</> : null}
        </p>
        {count ? (
          <>
            <p className={`m-0 ${SUB}`} data-testid="studio-setup-count">
              {count.recorded} of {count.bankSize} admin-bank questions recorded · {SECTIONS}
            </p>
            <Meter recorded={count.recorded} bankSize={count.bankSize} />
          </>
        ) : posture === null ? (
          <p className={`m-0 ${SUB}`}>Reading what is recorded…</p>
        ) : (
          <div className="mt-1"><Unreadable what="Setup progress" claim="This is not a claim that none of it is recorded." onRetry={onRetry} /></div>
        )}
      </div>
      <button type="button" className={BTN} aria-expanded={open} aria-controls={CHAT_ANCHOR} onClick={onToggle} data-testid="studio-setup-resume">
        {open ? 'Close setup' : 'Resume setup'}
      </button>
    </div>
  );
}

/** SAD02: focus the answer field once the chat has drawn it (the chat loads its own state first). */
function useFocusAnswer(open) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      const field = document.querySelector(`#${CHAT_ANCHOR} textarea:not([disabled])`);
      if (field) { field.focus(); clearInterval(id); } else if (tries > 40) clearInterval(id);
    }, 75);
    return () => clearInterval(id);
  }, [open]);
}

export default function StudioSetup({ chat }) {
  const [posture, reload] = usePosture();
  const [open, setOpen] = useState(false);
  useFocusAnswer(open);
  const count = setupCount(posture);
  const complete = count !== null && count.remaining === 0;
  return (
    <section className="mt-6" aria-labelledby="studio-setup-heading" data-testid="studio-setup">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="studio-setup-heading" className="text-[15px] font-extrabold tracking-tight text-axal-ink">Setup</h2>
        <span className="text-[12px] text-axal-muted">Optional · nothing above waits on it</span>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {complete ? chat : (
          <>
            <StudioSetupRow posture={posture} open={open} onToggle={() => setOpen((o) => !o)} onRetry={reload} />
            {open ? chat : null}
          </>
        )}
      </div>
      {count ? <StudioPostureView posture={posture} onRetry={reload} /> : null}
    </section>
  );
}
