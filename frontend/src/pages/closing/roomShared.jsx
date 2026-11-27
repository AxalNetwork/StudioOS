/**
 * D1218 (#3215), D8926 (#8926) — what the founder's and Admin's room
 * (`RecordRoom.jsx`) and the investor's room (`InvestorRoom.jsx`) share: the
 * read hook, each line's paper read, the no-access card, and the money and
 * Not recorded cells. Moved here unchanged from `RecordRoom.jsx` when the
 * investor's room was built to the #6188 v2 canvas.
 */
import { useEffect, useState } from 'react';
import { stagedSigningApi } from '../../lib/api/closings';
import { Unrecorded } from '../../ui';
import { BTN } from '../account/AccountCenter';
import { envelopesOf } from './deskModel';

export const box = 'flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
export const mutedText = 'm-0 text-[12.5px] text-gray-600 dark:text-gray-400';
export const pulse = 'animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800';

export function useLoad(run, deps, enabled = true) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'off', data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ status: 'off', data: null, error: null }); return undefined; }
    let live = true;
    setState({ status: 'loading', data: null, error: null });
    run().then((data) => { if (live) setState({ status: 'ok', data, error: null }); }, (error) => { if (live) setState({ status: 'error', data: null, error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick]);
  return { ...state, retry: () => setTick((n) => n + 1) };
}

/** Each commitment line's staged envelopes, one read per line: an array, null when that read failed, absent while it is read. */
export function usePapers(lines) {
  const ids = (Array.isArray(lines) ? lines : []).filter((l) => l.commitment_id != null).map((l) => [l.uid, l.commitment_id]);
  const key = ids.map((x) => x.join(':')).join(',');
  const [papers, setPapers] = useState({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setPapers({});
    for (const [uid, id] of ids) {
      stagedSigningApi.line(id).then(
        // D4811 part 24: an answer with no list could not be read; it is never "No paper sent".
        (r) => { if (live) setPapers((p) => ({ ...p, [uid]: envelopesOf(r) })); },
        () => { if (live) setPapers((p) => ({ ...p, [uid]: null })); },
      );
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { papers, retry: () => setTick((n) => n + 1) };
}

export const Money = ({ text, reason }) => (text ? <span className="tabular-nums">{text}</span> : <Unrecorded reason={reason} />);

/** D6199: Not recorded, with its reason in words as well as in the title. */
export const Why = ({ reason }) => (
  <span className="flex flex-col gap-0.5"><Unrecorded reason={reason} /><span className="text-[12px] font-normal text-gray-600 dark:text-gray-400">{reason}</span></span>
);

export function NoAccess({ text, back }) {
  return (
    <section className={`${box} max-w-[420px]`} data-testid="closing-no-access">
      <span aria-hidden="true" className="inline-grid h-8 w-8 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">🔒</span>
      <h2 className="m-0 text-[15px] font-bold">{text}</h2>
      {back}
    </section>
  );
}

/** CP11: the cap-table change as this viewer meets it; only the founder decides (D1218). */
export function CaptableCard({ view, onOpen }) {
  return (
    <section className={box} data-testid="closing-captable">
      <h3 className="m-0 text-[15px] font-bold">Cap table change</h3>
      <p className={mutedText}>{view.text}</p>
      {view.canDecide ? <button type="button" className={`${BTN.primary} w-fit`} onClick={onOpen} data-testid="closing-captable-open">Review the change</button> : null}
    </section>
  );
}
