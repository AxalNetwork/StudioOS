import React, { useState } from 'react';
import { newOpKey } from '../../../lib/opKey';
import { trustCenterAdminApi } from '../../../lib/api/trustContent.js';
import ActionDialog, { BTN_PLAIN, BTN_PRIMARY, ScopeBox } from './ActionDialog.jsx';
import StatusBadge from './StatusBadge.jsx';
import { NOTE_MAX, confirmedCount, noteState, publishLine } from '../trustContentModel.js';
import { clockOf, publishResultOf, publishSections } from './trustModel.js';

/**
 * D4803 (#4803, canvas SE07b "Publish review", SE07c "Stale preview refused")
 * — publish the Trust Center's drafts from Security, Scope → Review → Result.
 *
 *   Scope   what publishing does: the public page changes, the change log
 *           gains an entry, and confirmed subscribers are emailed about a
 *           new subprocessor;
 *   Review  each block's draft compared line by line with the published
 *           revision, where it publishes, when the draft was read, and the
 *           change note (shown in the public change log);
 *   Result  only what the server answered. D4675's rules hold: the review
 *           token read with the drafts goes with the Publish, so drafts that
 *           changed since this read publish nothing (SE07c, "Reload and
 *           review"); one key per Publish, resent on its retries, and a new
 *           key once the note changes; no answer is "not confirmed".
 */

function Diff({ section }) {
  return (
    <section className="rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid={`trust-diff-${section.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-[13px] text-axal-ink dark:text-white">{section.label}</b>
        <small className="text-[11.5px] text-axal-muted dark:text-gray-400">{section.summary}</small>
      </div>
      {(section.removed.length > 0 || section.added.length > 0) && (
        <ul className="mt-2 flex flex-col gap-1 font-mono text-[12px]">
          {section.removed.map((l, i) => (
            <li key={`r${i}`} className="flex gap-2 rounded bg-red-50 px-2 py-1 text-red-900 dark:bg-red-950/30 dark:text-red-200">
              <span aria-hidden="true">−</span><span className="sr-only">Removed: </span><span className="min-w-0 break-words">{l}</span>
            </li>
          ))}
          {section.added.map((l, i) => (
            <li key={`a${i}`} className="flex gap-2 rounded bg-emerald-50 px-2 py-1 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              <span aria-hidden="true">+</span><span className="sr-only">Added: </span><span className="min-w-0 break-words">{l}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function TrustPublishDialog({ read, api = trustCenterAdminApi, onClose, onPublished, onReread, returnFocus, now = () => Date.now() }) {
  const [step, setStep] = useState(1);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [key, setKey] = useState(() => ({ value: newOpKey(), for: null }));
  const review = publishSections(read, now());
  const rev = read?.revision?.available === false ? null : read?.revision?.revision;
  const ns = noteState(note);
  const n = review.count;
  const what = `${n} change${n === 1 ? '' : 's'}`;

  const send = async () => {
    if (!ns.ok) { setNoteError(ns.hint); return; }
    setNoteError(null);
    const trimmed = note.trim();
    let k = key;
    if (key.for !== null && key.for !== trimmed) { k = { value: newOpKey(), for: trimmed }; setKey(k); }
    else if (key.for === null) { k = { ...key, for: trimmed }; setKey(k); }
    setBusy(true);
    let out;
    try {
      const res = await api.publish(trimmed, { pending_token: read?.pending_token, publish_key: k.value });
      out = publishResultOf(res, null);
    } catch (err) {
      out = publishResultOf(null, err);
    }
    setResult(out);
    setBusy(false);
    setStep(3);
    if (out.result === 'done') onPublished?.();
  };

  const title = step === 1 ? 'Publish Trust Center changes'
    : step === 2 ? `Review: publish ${what}`
      : result.result === 'done' ? `Published ${what}`
        : result.result === 'stale' ? 'The draft changed since you opened it'
          : result.result === 'unconfirmed' ? 'Not confirmed' : 'Nothing was published';

  let footer;
  if (step === 1) {
    footer = [
      <button key="c" type="button" onClick={onClose} className={BTN_PLAIN}>Cancel</button>,
      <button key="n" type="button" onClick={() => setStep(2)} className={BTN_PRIMARY} disabled={!review.any} data-testid="trust-continue">Continue to review</button>,
    ];
  } else if (step === 2) {
    footer = [
      <button key="b" type="button" onClick={() => setStep(1)} disabled={busy} className={BTN_PLAIN}>Back</button>,
      <button key="s" type="button" onClick={send} disabled={busy} className={BTN_PRIMARY} data-testid="trust-publish">{busy ? 'Waiting for the server…' : `Publish ${what}`}</button>,
    ];
  } else if (result.result === 'stale') {
    footer = [
      <button key="c" type="button" onClick={onClose} className={BTN_PLAIN}>Cancel</button>,
      <button key="r" type="button" onClick={() => { onReread?.(); onClose(); }} className={BTN_PRIMARY} data-testid="trust-reload">Reload and review</button>,
    ];
  } else if (result.result === 'unconfirmed') {
    footer = [
      <button key="c" type="button" onClick={() => { onReread?.(); onClose(); }} className={BTN_PLAIN}>Re-read the Trust Center</button>,
      <button key="t" type="button" onClick={() => { setResult(null); setStep(2); }} className={BTN_PRIMARY} data-testid="trust-retry">Try again</button>,
    ];
  } else {
    footer = [
      result.result === 'refused' && <button key="b" type="button" onClick={() => { setResult(null); setStep(2); }} className={BTN_PLAIN}>Back</button>,
      <button key="d" type="button" onClick={onClose} className={BTN_PRIMARY} data-testid="trust-done">Done</button>,
    ].filter(Boolean);
  }

  return (
    <ActionDialog id="trust-publish" title={title} step={step} busy={busy} onClose={onClose} returnFocus={returnFocus} footer={footer} testid="trust-dialog">
      {step === 1 && (
        <>
          <ScopeBox
            title="What publishing does"
            items={[
              `Puts ${what} live on the public Trust Center (/trust), for anyone to read.`,
              'Adds an entry to the public change log, with your change note.',
              publishLine(review, confirmedCount(read?.subscribers)),
              'A published change stays on the record. To undo one, publish a correcting change.',
            ]}
            testid="trust-scope"
          />
          <ul className="flex flex-col gap-1 text-[12.5px]" data-testid="trust-scope-list">
            {review.sections.map((s) => <li key={s.key}><b>{s.label}</b> · {s.summary}</li>)}
          </ul>
        </>
      )}
      {step === 2 && (
        <>
          <p className="text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="trust-against">
            Draft compared with {rev ? `published revision ${rev}` : 'what is published now (the revision could not be read)'}.
          </p>
          <div className="flex flex-col gap-2">{review.sections.map((s) => <Diff key={s.key} section={s} />)}</div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[130px_minmax(0,1fr)]">
            <dt className="font-semibold text-axal-muted dark:text-gray-400">Publishes to</dt>
            <dd>/trust — public</dd>
            <dt className="font-semibold text-axal-muted dark:text-gray-400">Draft read at</dt>
            <dd data-testid="trust-read-at">{clockOf(read?.read_at) || 'Not recorded'}</dd>
          </dl>
          <div className="flex flex-col gap-1">
            <label htmlFor="trust-note" className="text-[12px] font-bold text-axal-ink dark:text-white">
              Change note <span className="font-normal text-axal-muted dark:text-gray-400">· shown in the public change log</span>
            </label>
            <textarea
              id="trust-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={NOTE_MAX + 50}
              aria-invalid={noteError ? 'true' : undefined}
              aria-describedby="trust-note-hint"
              className="w-full rounded-md border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              data-testid="trust-note"
            />
            <span id="trust-note-hint" className="text-[11px] text-axal-muted dark:text-gray-400">{ns.hint}</span>
            {noteError && <span role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">✕ {noteError}</span>}
          </div>
          {busy && <p role="status" className="text-[12.5px] text-axal-muted dark:text-gray-300">Waiting for the server. Nothing is shown as published until it answers.</p>}
        </>
      )}
      {step === 3 && result.result === 'done' && (
        <div role="status" className="flex flex-col gap-1 text-[12.5px]" data-testid="trust-result" data-result="done">
          <span className="flex items-center gap-2"><StatusBadge state="verified" label="Published" /> {result.replayed ? 'This Publish was already on record from your earlier attempt.' : 'Confirmed by the server.'}</span>
          {result.notices && <span className="text-axal-muted dark:text-gray-300">Subscriber notices are queued. Their delivery shows under Subprocessor notices.</span>}
        </div>
      )}
      {step === 3 && result.result === 'stale' && (
        <div className="flex flex-col gap-2 text-[12.5px]" data-testid="trust-result" data-result="stale">
          <p role="alert" className="font-semibold text-amber-800 dark:text-amber-200">▲ Not published. The drafts changed after this review was read.</p>
          <p>You reviewed the draft as of {clockOf(read?.read_at) || 'an unrecorded time'}. Reload to see the newer draft and review again before publishing.</p>
        </div>
      )}
      {step === 3 && (result.result === 'unconfirmed' || result.result === 'refused') && (
        <p role="alert" className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="trust-result" data-result={result.result}>{result.message}</p>
      )}
    </ActionDialog>
  );
}
