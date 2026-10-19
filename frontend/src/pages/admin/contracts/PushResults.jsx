import React from 'react';
import { Pill } from '../../../ui';
import { card, button } from './parts';

// D717 (#1851) — Push to branches, one row per branch (canvas §3.5, board L9).
// The push sends the recorded publications as they stand and writes nothing,
// so Retry re-runs the whole push (decision 6) and the library is unchanged
// by any branch result. With no branch bound, the server's own sentence is
// printed (D131): this file keeps no copy of it.

// Decision 5: "did not answer" and "answered with an error" are different facts.
export function pushRowState(b) {
  if (b?.status === 'ok') return 'reached';
  if (b?.status === 'not_deployed' || (b?.status === 'unreadable' && b?.timed_out)) return 'not_reached';
  return 'failed';
}

const ROW = {
  reached: { label: 'Reached', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  not_reached: { label: 'Not reached', tone: 'warn' },
};

function message(b, state) {
  if (state === 'reached') return `${b.stored ?? 0} templates updated${b.withdrawn > 0 ? ` · ${b.withdrawn} withdrawn` : ''}`;
  if (state === 'not_reached') return 'The branch did not answer. Retry when it is online.';
  const reason = String(b.reason || b.status || '').trim().replace(/\.+$/, '');
  return `This branch could not save the library: ${reason}. Retry this branch.`;
}

function stamp(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export default function PushResults({ result, error, running, onRetry }) {
  if (error) return <p role="alert" data-testid="push-error" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (!result) return null;
  const branches = result.branches || [];
  return <section data-testid="push-results" className={`${card} overflow-hidden dark:border-[#2a2733] dark:bg-[#18161f]`}>
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-[#2a2733]">
      <h3 className="text-sm font-extrabold">Push to branches · {stamp(result.pushed_at)}</h3>
      <span className="text-[12.5px] font-semibold text-axal-muted dark:text-[#a29db0]">The library is unchanged by any branch result.</span>
    </header>
    {!branches.length && <p className="px-4 py-3 text-[13px] text-axal-muted dark:text-[#a29db0]">{result.branches_reason}</p>}
    {branches.map(b => {
      const state = pushRowState(b);
      return <div key={b.code} data-testid={`push-row-${b.code}`} className="grid grid-cols-[220px_120px_1fr_100px] items-center gap-3 border-b border-axal-hairline px-4 py-[11px] text-[13px] last:border-b-0 dark:border-[#2a2733]">
        <b className="font-mono uppercase">{b.code}</b>
        <span><Pill tone={ROW[state].tone}>{ROW[state].label}</Pill></span>
        <span className="text-axal-muted dark:text-[#a29db0]">{message(b, state)}</span>
        <span className="text-right">{state !== 'reached' && <button type="button" className={button} disabled={running} onClick={onRetry}>Retry</button>}</span>
      </div>;
    })}
  </section>;
}
