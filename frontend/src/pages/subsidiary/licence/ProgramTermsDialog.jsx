/**
 * D988 (#2779) — one program's terms, read only (canvas GR8; GR15c on a
 * phone, where it takes the whole screen with "Request a change" at the foot).
 *
 * Every term the program carries, each with the schedule that states it; a
 * term HQ has not entered says so (GR13 E). Then the dates the grant itself
 * records. Nothing here writes: "Request a change" opens the request sheet.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { PROGRAM_PAGE, grantDates, isHeld, termRows } from '../../../lib/studioPrograms';
import { longDate } from '../../../lib/licencePage';

const FRAME = 'fixed inset-0 z-50 flex flex-col overflow-auto bg-white dark:bg-gray-900 sm:inset-x-auto sm:inset-y-8 sm:left-1/2 sm:w-[600px] sm:-translate-x-1/2 sm:rounded-xl sm:border sm:border-gray-200 sm:shadow-2xl dark:sm:border-gray-800';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-gray-500 dark:text-gray-400';

export default function ProgramTermsDialog({ program, status, onClose, onRequestChange }) {
  if (!program) return null;
  const rows = termRows(program);
  const dates = grantDates(program);
  const page = PROGRAM_PAGE[program.program_key] || null;
  return (
    <>
      <div className="fixed inset-0 z-40 hidden bg-black/30 sm:block" aria-hidden="true" onClick={onClose} />
      <section className={FRAME} role="dialog" aria-modal="true" aria-label={`${program.name} · your terms`} data-testid="program-terms-dialog">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{program.name} · your terms</h2>
            <span className="self-start rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">{status?.word || program.word}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-gray-100"><X size={16} /></button>
        </div>
        <div className="flex-1 space-y-4 px-4 py-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800">
            <h3 className="border-b border-gray-100 px-3.5 py-2.5 text-[13px] font-extrabold text-gray-900 dark:border-gray-800 dark:text-gray-100">Grant terms</h3>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <li key={r.eye} className="flex flex-col gap-0.5 px-3.5 py-2.5" data-testid={`program-term-${r.eye.toLowerCase().replace(/\s+/g, '-')}`}>
                  <span className={EYE}>{r.eye}</span>
                  <span className={`text-[13px] font-semibold leading-snug ${r.unset ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{r.text}</span>
                  {r.sub && <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{r.sub}</span>}
                  {r.chip && <span className="mt-0.5 self-start rounded-full border border-gray-200 px-2 py-px text-[10.5px] font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300">{r.chip}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800" data-testid="program-terms-dates">
            <h3 className="border-b border-gray-100 px-3.5 py-2.5 text-[13px] font-extrabold text-gray-900 dark:border-gray-800 dark:text-gray-100">What HQ recorded on this grant</h3>
            {dates.length ? (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {dates.map((d) => (
                  <li key={d.t} className="flex flex-col gap-0.5 px-3.5 py-2">
                    <span className={EYE}>{longDate(d.at)}</span>
                    <span className="text-[13px] text-gray-900 dark:text-gray-100">{d.t}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-3.5 py-2.5 text-xs text-gray-500">No date is recorded on this grant.</p>}
            <p className="border-t border-gray-100 px-3.5 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
              Each change, with HQ’s reason, is on HQ’s record of your licence. This page reads the grant as it stands.
            </p>
          </div>
        </div>
        <div className="sticky bottom-0 flex gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
          {isHeld(program) && (
            <button type="button" onClick={() => onRequestChange?.(program)} className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 sm:flex-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800" data-testid="program-terms-change">
              Request a change
            </button>
          )}
          {page && <Link to={page} className="hidden rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 sm:inline-block">Open program</Link>}
        </div>
      </section>
    </>
  );
}
