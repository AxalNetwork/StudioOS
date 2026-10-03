import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { formatCost } from '../ui/assistCost';
import RunEstimate from './RunEstimate';

/**
 * The band every artboard with an AI proposal closes with.
 *
 * ONE COMPONENT, EVERY ARTBOARD THAT HAS ONE. `Pages · Partner
 * {Research,Network,Offers,Pipeline,Delivery}.dc.html` and `Founder Workspaces
 * Canvas.dc.html` draw the same block — an accent label, a cost, a drafted
 * paragraph, then `Accept …` / `Edit first` / `Discard` and a footnote. Only
 * the words and the accent change, so only those are props.
 *
 * NOTHING RUNS ON MOUNT. It reads whatever draft already exists and stops
 * there; the model is called when someone presses the run button.
 * `FillProposals` states the reason for the founder's copy of this rule and
 * it is the same one: a component that drafted on render would spend a reader's
 * budget for visiting a page. Which is also why the cost is shown BEFORE the
 * run and not only after it — where the host passes `ai`, its `useAiSpend()`
 * result (D424). This used to claim the cost came first on every mount while
 * the band drew one only once a draft existed, from the draft's own row. The
 * founder desks pass `ai` now and show the reader's own average for
 * `DRAFT_TASK` above the run button; a mount that passes nothing still shows
 * the cost after the run and nothing before it, and does not fetch.
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
// commits an AI draft — which is the convention `FillProposals` follows and
// the canvases are consistent about.
//
// TWO PALETTES, ONE COMPONENT. The Partner canvases draw this band in amber and
// the Founder canvases in violet — `Founder Workspaces Canvas.dc.html` uses
// `#6d28d9` for every `prop` band on A2–A5, which is the accent
// `FillProposals` already ships. Amber stays the default so that none of
// the 23 existing mounts changes, and the whole palette moves together: a band
// whose eyebrow was violet and whose button stayed amber would read as two
// different things on one card. Tailwind needs the class names whole, so these
// are complete strings per accent rather than an interpolated colour.
const ACCENTS = {
  amber: {
    band: 'rounded-[10px] border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900 dark:bg-amber-950/25',
    ink: 'text-axal-amber-deep dark:text-amber-300',
    edit: 'mt-2 w-full rounded-[8px] border border-amber-200 bg-white p-2.5 text-[12px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-amber-900 dark:bg-gray-900 dark:text-gray-100',
    button: 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
      + 'border-amber-600 bg-amber-600 px-[11px] py-1.5 text-[11px] font-bold text-white '
      + 'transition-colors hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 '
      + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
  },
  // The investor canvases (b6a5f992, the diligence room) draw the band in the
  // investor shell's indigo, `#4f46e5`.
  indigo: {
    band: 'rounded-[10px] border border-indigo-200 bg-indigo-50/60 p-3.5 dark:border-indigo-900 dark:bg-indigo-950/25',
    ink: 'text-indigo-700 dark:text-indigo-300',
    edit: 'mt-2 w-full rounded-[8px] border border-indigo-200 bg-white p-2.5 text-[12px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-indigo-900 dark:bg-gray-900 dark:text-gray-100',
    button: 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
      + 'border-indigo-600 bg-indigo-600 px-[11px] py-1.5 text-[11px] font-bold text-white '
      + 'transition-colors hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 '
      + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
  },
  violet: {
    band: 'rounded-[10px] border border-violet-200 bg-violet-50/60 p-3.5 dark:border-violet-900 dark:bg-violet-950/25',
    ink: 'text-violet-700 dark:text-violet-300',
    edit: 'mt-2 w-full rounded-[8px] border border-violet-200 bg-white p-2.5 text-[12px] leading-relaxed text-axal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-violet-900 dark:bg-gray-900 dark:text-gray-100',
    button: 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border '
      + 'border-violet-600 bg-violet-600 px-[11px] py-1.5 text-[11px] font-bold text-white '
      + 'transition-colors hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 '
      + 'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
  },
};

// A drafted body that carries a WARNING reads as one, and the canvases say so:
// `Founder Workspaces Canvas.dc.html` draws the Legal engine's clause read in a
// red box (`#fef2f2` on `#fecaca`) while every other band on the same artboard
// uses plain body text. It is the same draft through the same surface — only
// the reading changes — so it is a tone on the body rather than a second
// component. `null` is the default and leaves the body exactly as it was.
//
// The semantic tokens (D424) rather than Tailwind's reds: `destructive-edge`
// and `-tint` are the canvas's own `#fecaca` / `#fef2f2`, and the text is the
// System Sheet's destructive rather than a darker red it never names.
const BODY_TONES = {
  warn: 'mt-2 whitespace-pre-wrap rounded-[8px] border border-axal-destructive-edge bg-axal-destructive-tint p-2.5 text-[11.5px] '
    + 'leading-relaxed text-axal-destructive dark:border-red-900 dark:bg-red-950/30 dark:text-red-200',
};
const BODY_PLAIN = 'mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700 dark:text-gray-300';

/**
 * The router task every zone draft runs: `POST /api/research/drafts` calls
 * `runAI({ task: 'workspace_explain' })` whatever the surface
 * (routes/research.ts), and `zone_draft_run_estimate_d424` holds the two
 * equal. The rail's "Read this page back" runs the same task, which is why
 * the estimate names it.
 */
export const DRAFT_TASK = 'workspace_explain';

/**
 * The app path this band sits on, read when the run is pressed (D510).
 *
 * The worker records it as the run's `surface`, which is what lets the rail
 * count a band's runs under "This page this month" (D404); without it every
 * zone-draft run landed in the month's unattributed group. It is read in the
 * click, not in render, and from the window rather than the router: inside
 * the app the two are the same path, and several tests mount a band with no
 * router around it. Normalised the way the router stores a surface, as the
 * rail's is, so the two lookups match.
 */
export function bandPage() {
  if (typeof window === 'undefined') return undefined;
  const path = String(window.location?.pathname || '');
  return path.replace(/\/+$/, '') || (path === '/' ? '/' : undefined);
}

export default function ZoneDraft({
  surface,
  scopeKey = '',
  label,
  accept = 'Accept draft',
  foot,
  run = 'Draft it',
  empty,
  nothingToDraft,
  accent = 'amber',
  tone,
  // A band about ONE record (a room, keyed by `scopeKey`) reads only that
  // record's drafts. Unscoped bands read the surface's newest, as before.
  scoped = false,
  // Called with the accepted draft, for a page whose record Accept also wrote
  // (the fund dossier's note) and which must re-read it.
  onAccepted,
  // The host's `useAiSpend()` result, for the cost before a run (D424).
  ai,
}) {
  const skin = ACCENTS[accent] || ACCENTS.amber;
  const bodyClass = BODY_TONES[tone] || BODY_PLAIN;
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.research.zoneDrafts(surface, scoped ? scopeKey : undefined);
      // The newest, whether or not it has been accepted: the artboard shows one
      // block, and a reader who accepted a draft should still see what they
      // accepted rather than an empty slot inviting them to pay for it again.
      setItem((r?.items || [])[0] || null);
    } catch {
      // A band that cannot read its own drafts says nothing rather than
      // reporting an error over a page that is otherwise fine.
      setItem(null);
    }
  }, [surface, scoped, scopeKey]);
  useEffect(() => { load(); }, [load]);

  const doRun = async () => {
    setBusy('run'); setNote('');
    try {
      const r = await api.research.zoneDraftRun(surface, scopeKey, bandPage());
      setItem(r?.item || null);
      setEditing(null);
    } catch (e) {
      // 409 is the honest refusal, not a failure: there was nothing on the page
      // to draft over, and the worker declines rather than letting the model
      // write from its own knowledge in the voice of a grounded draft.
      // D258 — the refusal's code travels on `e.code`, compared whole.
      setNote(e?.code === 'nothing_to_draft'
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
      if (onAccepted) onAccepted(r?.item || item);
    } catch (e) {
      // D278 — a 409 is the surface refusing to write its record (a note that
      // would overflow), and its sentence is ours to print; anything else is
      // a failure with no more to say.
      setNote(e?.status === 409 && e?.message ? e.message : 'That could not be saved right now.');
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
      className={skin.band}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[.09em] ${skin.ink}`}>
          <Sparkles aria-hidden="true" className="h-3 w-3" />
          {label}
        </span>
        {item ? (
          <span className={`ml-auto whitespace-nowrap font-mono text-[10.5px] ${skin.ink}`}>
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
              className={skin.edit}
            />
          ) : (
            <p className={bodyClass}>{item.body}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={skin.button} onClick={doAccept} disabled={busy !== ''}>
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
              <span className="text-[10.5px] font-bold text-axal-positive dark:text-emerald-400">Accepted</span>
            ) : null}
            {foot ? <span className="ml-auto text-[10px] text-gray-600 dark:text-gray-400">{foot}</span> : null}
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{empty}</p>
          <RunEstimate ai={ai} task={DRAFT_TASK} shared="the rail's read-back" testId={`text-zone-draft-estimate-${surface.replace(/[^a-z0-9]+/gi, '-')}`} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={skin.button} onClick={doRun} disabled={busy !== ''}>
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
