import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { formatCost } from '../ui/assistCost';

/**
 * The band every Partner Research and Network artboard closes with.
 *
 * ONE COMPONENT, SEVEN ARTBOARDS. `Pages · Partner {Research,Network}.dc.html`
 * draw the same block on all seven pages — an accent label, a cost, a drafted
 * paragraph, then `Accept …` / `Edit first` / `Discard` and a footnote. Only
 * the words change, so only the words are props.
 *
 * NOTHING RUNS ON MOUNT. It reads whatever draft already exists and stops
 * there; the model is called when someone presses the run button.
 * `ValidateProposals` states the reason for the founder's copy of this rule and
 * it is the same one: a component that drafted on render would spend a reader's
 * budget for visiting a page. Which is also why the cost is shown BEFORE the
 * run and not only after it.
 *
 * `Edit first` AND `Accept` ARE ONE WRITE. Editing then accepting is the same
 * act with a different body, so the textarea opens in place and the accept
 * button sends whatever is in it. A separate "save edit" step would let a
 * reader leave an edited draft in a state that is neither the model's nor
 * theirs.
 *
 * WHAT ACCEPTING MEANS, STATED RATHER THAN IMPLIED. It stamps `accepted_at` on
 * the draft and nothing else — no other record is written, nothing is sent, and
 * the artboards' footnotes say what was preserved ("Citations preserved per
 * claim", "Read-only rows quoted, never rewritten"). A button called Accept
 * that quietly wrote somewhere else would be the failure this whole file is
 * careful about, one step further along.
 */

const GHOST = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
  + 'border-gray-200 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-700 '
  + 'transition-colors hover:border-gray-300 focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600';
// The ONE filled control on the artboard. Every zone-header action is a ghost
// and the accent appears exactly once per page, always on the button that
// commits an AI draft — which is the convention `ValidateProposals` follows and
// the canvases are consistent about.
const ACCENT = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
  + 'border-amber-600 bg-amber-600 px-[11px] py-1.5 text-[11px] font-bold text-white '
  + 'transition-colors hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export default function ZoneDraft({
  surface,
  scopeKey = '',
  label,
  accept = 'Accept draft',
  foot,
  run = 'Draft it',
  empty,
  nothingToDraft,
}) {
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.research.zoneDrafts(surface);
      // The newest, whether or not it has been accepted: the artboard shows one
      // block, and a reader who accepted a draft should still see what they
      // accepted rather than an empty slot inviting them to pay for it again.
      setItem((r?.items || [])[0] || null);
    } catch {
      // A band that cannot read its own drafts says nothing rather than
      // reporting an error over a page that is otherwise fine.
      setItem(null);
    }
  }, [surface]);
  useEffect(() => { load(); }, [load]);

  const doRun = async () => {
    setBusy('run'); setNote('');
    try {
      const r = await api.research.zoneDraftRun(surface, scopeKey);
      setItem(r?.item || null);
      setEditing(null);
    } catch (e) {
      // 409 is the honest refusal, not a failure: there was nothing on the page
      // to draft over, and the worker declines rather than letting the model
      // write from its own knowledge in the voice of a grounded draft.
      const detail = String(e?.message || '');
      setNote(detail.includes('nothing_to_draft')
        ? (nothingToDraft || 'There is nothing on this page to draft over yet.')
        : 'That draft could not be written right now.');
    } finally { setBusy(''); }
  };

  const doAccept = async () => {
    if (!item) return;
    setBusy('accept'); setNote('');
    try {
      const r = await api.research.zoneDraftAccept(item.uid, editing != null ? editing : undefined);
      setItem(r?.item || item);
      setEditing(null);
    } catch {
      setNote('That could not be saved right now.');
    } finally { setBusy(''); }
  };

  const doDiscard = async () => {
    if (!item) return;
    setBusy('discard'); setNote('');
    try {
      await api.research.zoneDraftDiscard(item.uid);
      setItem(null);
      setEditing(null);
    } catch {
      setNote('That could not be discarded right now.');
    } finally { setBusy(''); }
  };

  return (
    <div
      data-testid={`zone-draft-${surface.replace(/[^a-z0-9]+/gi, '-')}`}
      className="rounded-[10px] border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900 dark:bg-amber-950/25"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-amber-deep dark:text-amber-300">
          <Sparkles aria-hidden="true" className="h-3 w-3" />
          {label}
        </span>
        {item ? (
          <span className="ml-auto whitespace-nowrap font-mono text-[10.5px] text-axal-amber-deep dark:text-amber-300">
            {formatCost(item.cost_usd)}
          </span>
        ) : null}
      </div>

      {item ? (
        <>
          {editing != null ? (
            <textarea
              rows={5}
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              aria-label={`${label} — edit before accepting`}
              className="mt-2 w-full rounded-[8px] border border-amber-200 bg-white p-2.5 text-[12px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-amber-900 dark:bg-gray-900 dark:text-gray-100"
            />
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{item.body}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={ACCENT} onClick={doAccept} disabled={busy !== ''}>
              {busy === 'accept' ? 'Saving…' : accept}
            </button>
            <button
              type="button"
              className={GHOST}
              onClick={() => setEditing(editing != null ? null : item.body)}
              disabled={busy !== ''}
            >
              {editing != null ? 'Stop editing' : 'Edit first'}
            </button>
            <button type="button" className={GHOST} onClick={doDiscard} disabled={busy !== ''}>
              {busy === 'discard' ? 'Discarding…' : 'Discard'}
            </button>
            {item.accepted ? (
              <span className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400">Accepted</span>
            ) : null}
            {foot ? <span className="ml-auto text-[10px] text-gray-600 dark:text-gray-400">{foot}</span> : null}
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{empty}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={ACCENT} onClick={doRun} disabled={busy !== ''}>
              {busy === 'run' ? 'Drafting…' : run}
            </button>
            {foot ? <span className="ml-auto text-[10px] text-gray-600 dark:text-gray-400">{foot}</span> : null}
          </div>
        </>
      )}

      {note ? <p className="mt-2 text-[11px] text-gray-700 dark:text-gray-300">{note}</p> : null}
    </div>
  );
}
