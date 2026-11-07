import { useCallback, useState } from 'react';
import { DRAFT_REFUSED, draftEstimateLine } from './relationshipsModel';

/**
 * D4330 (#4330, part 8b, merged) — the one press behind every "Ask Eadwyn to
 * draft…" button: `IntroductionsDesk.jsx` (RI4 "the intro", RI6 "a
 * follow-up") and `WhoKnowsStrip.jsx` (RI3 "from this record"). Each is a
 * quoted proposal, never a surprise charge:
 *
 *   idle → estimating → confirm → running → idle (opened) | error
 *
 * `run({ estimate })` is the one `relationshipsApi` call for this draft
 * (`draftIntro`, `draftFollowUp`, `draftAskReason`), already bound to
 * whatever it needs (the request's uid, the ask's teammate and ref). The
 * first press quotes it (`estimate: true` runs nothing and is never
 * charged); the member reads the quote and presses again to run it, which is
 * metered like any other Eadwyn run. A refusal is always the mapped
 * sentence (`error.data.message`, never `error.message`) — this hook never
 * reads the raw one.
 */
export function useDraftFlow(run) {
  const [state, setState] = useState({ status: 'idle' });

  const ask = useCallback(async () => {
    setState({ status: 'estimating' });
    try {
      const res = await run({ estimate: true });
      setState({ status: 'confirm', estimate: res?.estimate ?? null });
    } catch (e) {
      setState({ status: 'error', error: e?.data?.message || DRAFT_REFUSED });
    }
  }, [run]);

  const confirm = useCallback(async () => {
    setState((s) => ({ ...s, status: 'running' }));
    try {
      const res = await run({});
      setState({ status: 'idle' });
      return res?.draft ?? null;
    } catch (e) {
      setState({ status: 'error', error: e?.data?.message || DRAFT_REFUSED });
      return null;
    }
  }, [run]);

  const cancel = useCallback(() => setState({ status: 'idle' }), []);
  return { state, ask, confirm, cancel };
}

/**
 * The quote and its confirmation, drawn under the button that opened it.
 * `idle` draws nothing — the button itself is `DraftFlow`'s caller's.
 */
export default function DraftFlow({ state, onConfirm, onCancel, testId, confirmLabel = 'Draft it' }) {
  if (state.status === 'idle') return null;
  if (state.status === 'estimating') {
    return <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" role="status" data-testid={`${testId}-estimating`}>Reading the estimate…</p>;
  }
  if (state.status === 'error') {
    return <p className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid={`${testId}-error`}>{state.error}</p>;
  }
  const line = draftEstimateLine(state.estimate) || 'Reading what this draft holds…';
  const running = state.status === 'running';
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-confirm`}>
      <span className="text-[12px] text-axal-muted dark:text-gray-400">{line}</span>
      <button type="button" className="inline-flex min-h-[28px] items-center justify-center rounded-[9px] bg-axal-violet px-2.5 text-[11.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50"
        disabled={running} onClick={onConfirm} data-testid={`${testId}-confirm-run`}>{running ? 'Drafting…' : confirmLabel}</button>
      <button type="button" className="text-[11.5px] font-bold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100" disabled={running} onClick={onCancel} data-testid={`${testId}-cancel`}>Cancel</button>
    </div>
  );
}
