import { useEffect, useState } from 'react';
import { lovableAppLinksApi } from '../../lib/api/lovableAppLinks.js';
import { LOVABLE_WORDS as W, slotView } from './lovableAppLink.js';

/**
 * D1083 (#2948, Lovable part 3 of #2398) — "From Lovable" (`id="from-lovable"`):
 * the address Lovable gave the founder, its last live check, and Check now.
 * Boards LV5 (the address part), LV6 (its states) and LV7's part.
 *
 * `part` is a read's `parts.lovable`: one slot per record. On an experiment's
 * claim each slot is one experiment; on Prototype / MVP there is one.
 *
 * - Check now is the only thing that fetches the address, once per press.
 * - Linking or removing an address asks first, in place, saying what changes.
 * - Unreadable says so and keeps nothing hidden; it is never an empty list.
 */
export default function FromLovable({ part, cycle, projectId, onRetry, api = lovableAppLinksApi }) {
  const [slots, setSlots] = useState(() => (part?.state === 'ok' && Array.isArray(part.slots) ? part.slots : []));
  useEffect(() => { setSlots(part?.state === 'ok' && Array.isArray(part.slots) ? part.slots : []); }, [part]);
  if (!part || typeof part !== 'object') return null;
  const many = slots.length > 1 || cycle === 'validate';
  const replace = (recordId, link) => setSlots((all) => all.map((s) => (s.record_id === recordId ? { ...s, link } : s)));
  return (
    <section id="from-lovable" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900"
      data-testid="cycle-part-lovable" aria-labelledby="from-lovable-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-lovable-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">{W.title}</h2>
        <span className="text-[11px] text-axal-faint dark:text-gray-500">{W.connector}</span>
      </div>
      {part.state !== 'ok'
        ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="lovable-unreadable">
            <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{W.unreadable}</p>
            {onRetry && <button type="button" onClick={onRetry} className={BUTTON} data-testid="lovable-retry">{W.retry}</button>}
          </div>
        )
        : slots.length === 0
          ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="lovable-no-records">No experiment on this claim yet. Add one, then link its app.</p>
          : slots.map((slot) => (
            <Slot key={slot.record_id} slot={slot} labelled={many} cycle={cycle} projectId={projectId} api={api}
              onLink={(link) => replace(slot.record_id, link)} />
          ))}
    </section>
  );
}

function Slot({ slot, labelled, cycle, projectId, api, onLink }) {
  const view = slotView(slot);
  const recordId = cycle === 'build' ? null : slot.record_id;
  const [draft, setDraft] = useState('');
  const [ask, setAsk] = useState(null); // 'link' | 'remove'
  const [busy, setBusy] = useState(null); // 'check' | 'write'
  const [error, setError] = useState(null);
  const id = `lovable-${slot.record_id}`;

  const run = async (kind, call, after) => {
    setBusy(kind); setError(null);
    try { const res = await call(); after?.(res); setAsk(null); }
    catch (e) { setError(e?.message || 'That could not be saved. Nothing was changed.'); }
    finally { setBusy(null); }
  };
  const link = () => run('write', () => api.link(cycle, projectId, recordId, draft.trim()), (res) => { onLink(res?.link ?? null); setDraft(''); });
  const remove = () => run('write', () => api.unlink(cycle, projectId, recordId), () => onLink(null));
  const check = () => run('check', () => api.check(cycle, projectId, view.uid), (res) => onLink(res?.link ?? null));

  return (
    <div className="flex flex-col gap-2 border-t border-axal-ground pt-2.5 first-of-type:border-t-0 first-of-type:pt-0 dark:border-gray-800" data-testid={id}>
      {labelled && <h3 className="m-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">{slot.label}</h3>}
      {busy === 'check'
        ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" aria-busy="true" data-testid={`${id}-loading`}>{W.loading}</p>
        : view.kind === 'empty'
          ? (
            <div className="flex flex-col gap-2" data-testid={`${id}-empty`}>
              <p className="m-0 text-[12.5px] text-axal-ink/80 dark:text-gray-300">{W.empty}</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`${id}-input`}>App address</label>
                <input id={`${id}-input`} type="url" inputMode="url" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={W.placeholder}
                  className="min-w-0 flex-1 rounded-lg border border-axal-hairline px-2.5 py-1.5 font-mono text-[12px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  data-testid={`${id}-input`} />
                <button type="button" disabled={!draft.trim() || !!busy} onClick={() => setAsk('link')} className={PRIMARY} data-testid={`${id}-link`}>{W.link}</button>
              </div>
            </div>
          )
          : (
            <div className="flex flex-col gap-1" data-testid={`${id}-linked`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-[12px] text-axal-ink dark:text-gray-100" data-testid={`${id}-address`}>{view.address}</span>
                <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL[view.tone]}`} data-testid={`${id}-pill`}>{view.pill}</span>
              </div>
              {view.line && <p className={`m-0 font-mono text-[11.5px] ${view.status === 'not_reachable' ? 'text-amber-800 dark:text-amber-200' : 'text-axal-muted dark:text-gray-400'}`} data-testid={`${id}-line`}>{view.line}</p>}
              {view.note && <p className="m-0 text-[12px] text-axal-ink/80 dark:text-gray-300" data-testid={`${id}-note`}>{view.note}</p>}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {view.status !== 'vercel' && <button type="button" disabled={!!busy} onClick={check} className={BUTTON} data-testid={`${id}-check`}>{W.check}</button>}
                <button type="button" disabled={!!busy} onClick={() => setAsk('remove')} className={QUIET} data-testid={`${id}-remove`}>{W.remove}</button>
              </div>
            </div>
          )}
      {ask && (
        <div role="group" aria-label={ask === 'link' ? 'Link the app?' : 'Remove the address?'} className="flex flex-col gap-2 rounded-lg border border-axal-lavender-edge bg-axal-lavender px-3 py-2.5 dark:border-violet-800 dark:bg-violet-950" data-testid={`${id}-confirm`}>
          <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{ask === 'link' ? 'Link this app?' : 'Remove the app’s address?'}</p>
          <p className="m-0 text-[12px] text-axal-ink/80 dark:text-gray-300">
            {ask === 'link'
              ? `From Lovable shows this address on ${slot.label}. Nothing is read until you press Check now.`
              : `From Lovable forgets this address and its last check on ${slot.label}. Nothing changes in Lovable.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={ask === 'link' ? link : remove} className={PRIMARY} data-testid={`${id}-confirm-button`}>{ask === 'link' ? W.link : 'Remove'}</button>
            <button type="button" disabled={!!busy} onClick={() => { setAsk(null); setError(null); }} className={QUIET} data-testid={`${id}-cancel`}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid={`${id}-error`}>{error}</p>}
    </div>
  );
}

const BUTTON = 'rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-700';
const QUIET = 'rounded-lg px-2 py-1.5 text-[12px] font-semibold text-axal-muted hover:text-axal-ink disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-100';
const PILL = {
  grey: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
};
