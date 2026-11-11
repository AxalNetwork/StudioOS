import React, { useId, useState } from 'react';
import { Lightbox, Sheet } from '../../../ui';
import { Field, Pill, Unrecorded, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import {
  VERSION_STATUS_LABEL, VERSION_STATUS_TONE, receiptLine, recipientNote, sendConfirmation,
  versionStatus, versionTag,
} from './deliveryTrail';
import { attachmentBody, sendPreview } from './practiceTools';

/**
 * #4833 (D4833) — Practice v2 Delivery: one work product's detail sheet, its
 * Add version form and its send confirmation (`design/incoming/Practice v2
 * Page.dc.html`, PX-06 B, C and D).
 *
 * THE SHEET IS READ-ONLY ABOUT THE PAST. The latest version leads; below it,
 * every version (the latest included) is listed with ITS OWN recipient and ITS
 * OWN receipts, read from its own row. No control here edits a recorded
 * version: the Worker has no route that could (D4712), so the history is drawn
 * as a list of facts rather than as rows with buttons.
 *
 * WRITES GO THROUGH THE PAGE. The sheet and both dialogs call back into
 * `DeliveryZone`, which owns the reload and the success note; a refusal comes
 * back as a sentence and is shown in the dialog that caused it.
 */

/** The document a version points at, as a link a reader can check. */
function DocumentPreview({ link }) {
  const href = typeof link === 'string' ? link.trim() : '';
  let host = '';
  let path = '';
  try {
    const u = new URL(href);
    if (u.protocol === 'https:') { host = u.hostname; path = u.pathname === '/' ? '' : u.pathname; }
  } catch { host = ''; }
  if (!host) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
        No document attached to this version
      </div>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener"
      className="block truncate rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink hover:border-emerald-400 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100">
      <span aria-hidden="true">↗ </span>{host}<span className="text-axal-faint dark:text-gray-400">{path}</span>
    </a>
  );
}

function StatusPill({ version }) {
  const s = versionStatus(version);
  if (!s) return null;
  return <Pill tone={VERSION_STATUS_TONE[s]}>{VERSION_STATUS_LABEL[s]}</Pill>;
}

function RecipientNote({ item, version, testid }) {
  const note = recipientNote(item, version);
  if (!note) return null;
  return (
    <p data-testid={testid} data-kind={note.kind}
      className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
      {note.kind === 'not_recorded' ? <Unrecorded>{note.text}</Unrecorded> : note.text}
    </p>
  );
}

/**
 * PX-06 B — the deliverable's detail. `children` is where the page puts the
 * details editor when it is open.
 */
export function DeliverableSheet({
  item, engagementName = null, busy = '', onClose, onAddVersion, onSend, onEdit, editing = false, children = null,
}) {
  const latest = item.latest_version;
  const versions = Array.isArray(item.versions) ? item.versions : (latest ? [latest] : []);
  const sendable = latest && !latest.sent_at;
  const conf = sendable ? sendConfirmation(item) : null;
  const preview = sendable ? sendPreview(item) : null;
  const eyebrow = ['Work product', item.client_name, engagementName].filter(Boolean).join(' · ');
  return (
    <Sheet title={item.title} eyebrow={eyebrow} onClose={onClose} width={560} testId={`deliverable-sheet-${item.id}`}>
      <div className="grid gap-4 px-5 py-4">
        {latest ? (
          <section data-testid={`latest-version-${item.id}`} aria-label="Latest version"
            className="grid gap-2 rounded-xl border-[1.5px] border-emerald-300 p-3.5 dark:border-emerald-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b className="text-[16px] font-extrabold tabular-nums">{versionTag(latest)}</b>
              <StatusPill version={latest} />
            </div>
            <p className="text-[13px]">
              {latest.summary ? `“${latest.summary}”` : <Unrecorded>No change note recorded</Unrecorded>}
            </p>
            <DocumentPreview link={latest.link_url} />
            <span className="text-[11px] tabular-nums text-axal-faint dark:text-gray-400">{receiptLine(latest)}</span>
            <RecipientNote item={item} version={latest} testid={`latest-recipient-note-${item.id}`} />
          </section>
        ) : (
          <section className="rounded-xl border border-dashed border-axal-hairline p-3.5 text-[12.5px] text-axal-muted dark:border-gray-700 dark:text-gray-400"
            data-testid={`no-version-${item.id}`}>
            No version is recorded yet. Add version records v1 with its note and document.
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass} disabled={busy === `a-${item.id}`}
            onClick={onAddVersion} data-testid={`version-pr3-${item.id}`}>Add version</button>
          {/* No Send once it has gone out: a sent date is a fact, and the Worker
              answers 409 rather than overwriting it. Send opens the
              confirmation; nothing is sent from this button. */}
          {sendable && (
            <button type="button" className={ghostButtonClass} disabled={busy === `s-${item.id}` || !conf.sendable}
              onClick={onSend} data-testid={`send-pr3-${item.id}`}>
              Send {versionTag(latest)}…
            </button>
          )}
          <button type="button" className={ghostButtonClass} onClick={onEdit} data-testid={`edit-pr3-${item.id}`}>
            {editing ? 'Close details' : 'Edit details'}
          </button>
          {sendable && (
            <span className={`w-full text-[10.5px] leading-relaxed ${conf.sendable ? 'text-axal-faint dark:text-gray-400' : 'text-amber-700 dark:text-amber-300'}`}
              data-testid={`send-preview-pr3-${item.id}`}>
              {conf.sendable ? preview.line : conf.reason}
            </span>
          )}
        </div>
        {children}

        <section aria-labelledby={`history-${item.id}`}>
          <h3 id={`history-${item.id}`} className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint dark:text-gray-400">
            Version history · immutable
          </h3>
          {versions.length === 0
            ? <p className="mt-2 text-[12px] text-axal-muted dark:text-gray-400">Nothing recorded yet.</p>
            : (
              <ol className="mt-2 divide-y divide-axal-hairline rounded-xl border border-axal-hairline dark:divide-gray-800 dark:border-gray-700"
                data-testid={`history-list-${item.id}`}>
                {versions.map((v) => (
                  <li key={v.uid || v.version} data-testid={`history-${item.id}-v${v.version}`} className="grid gap-1 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-14 shrink-0 text-[12px] font-extrabold tabular-nums text-emerald-700 dark:text-emerald-300">{versionTag(v)}</span>
                      <span className="min-w-0 flex-1 text-[11.5px] tabular-nums text-axal-muted dark:text-gray-300">{receiptLine(v)}</span>
                      <StatusPill version={v} />
                    </div>
                    <p className="pl-16 text-[11.5px] text-axal-faint dark:text-gray-400">
                      {v.summary || <Unrecorded>No change note recorded</Unrecorded>}
                    </p>
                    <div className="pl-16"><RecipientNote item={item} version={v} testid={`recipient-note-${item.id}-v${v.version}`} /></div>
                  </li>
                ))}
              </ol>
            )}
          <p className="mt-2 text-[11px] leading-relaxed text-axal-faint dark:text-gray-400">
            Each version keeps the recipient it was originally sent to, and its own opened and accepted
            receipts. A recorded version is never edited: changes go in a new version.
          </p>
        </section>
      </div>
    </Sheet>
  );
}

/**
 * PX-06 C — Add version. A change note and a document link are both
 * required: there is no one-click empty version (D4712). It saves the next
 * version unsent; sending is its own confirmed step.
 */
export function AddVersionDialog({ item, busy = false, onCancel, onSave }) {
  const [draft, setDraft] = useState({ summary: '', link_url: '' });
  const [error, setError] = useState('');
  const formId = useId();
  const next = Number(item.latest_version?.version || item.version_count || 0) + 1;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const res = attachmentBody(draft);
    if (res.error) { setError(res.error); return; }
    const refusal = await onSave?.(item, res.body);
    if (refusal) setError(refusal);
  };

  return (
    <Lightbox title={`Add version v${next}`} onClose={onCancel} width={560} testId={`add-version-${item.id}`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={onCancel}>Cancel</button>
          <button type="submit" form={formId} className={buttonClass} disabled={busy}
            data-testid={`add-version-save-${item.id}`}>
            {busy ? 'Saving…' : `Save v${next} as draft`}
          </button>
        </div>
      )}>
      <form id={formId} onSubmit={submit} data-testid={`add-version-form-${item.id}`} className="grid gap-3 px-5 py-4">
        <Field label="Change note · required" hint="What is different from the last version. The history shows this line.">
          <textarea rows={2} className={inputClass} value={draft.summary} data-testid={`add-version-note-${item.id}`}
            onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))} />
        </Field>
        <Field label="Document link · required" hint="Where the client opens this version: a web address that starts with https://.">
          <input className={inputClass} value={draft.link_url} placeholder="https://…" data-testid={`add-version-link-${item.id}`}
            onChange={(e) => setDraft((d) => ({ ...d, link_url: e.target.value }))} />
        </Field>
        <p className="text-[11px] leading-relaxed text-axal-faint dark:text-gray-400">
          A version can’t be saved or sent without a note and a document. This saves <strong>v{next}, not sent</strong>;
          {next > 1 ? ` v${next - 1} stays exactly as recorded.` : ' sending is its own step.'}
        </p>
        {error && <p className="text-[12px] font-semibold text-red-700 dark:text-red-300" role="alert">{error}</p>}
      </form>
    </Lightbox>
  );
}

/**
 * PX-06 D — the send confirmation: "Send v3 to Acme?", naming the recipient
 * and the document before anything is sent.
 */
export function SendConfirmDialog({ item, busy = false, onCancel, onConfirm }) {
  const conf = sendConfirmation(item);
  const [error, setError] = useState('');
  const confirm = async () => {
    setError('');
    const refusal = await onConfirm?.(item);
    if (refusal) setError(refusal);
  };
  return (
    <Lightbox title={conf.heading || 'Send this version?'} onClose={onCancel} width={560} testId={`send-confirm-${item.id}`}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={onCancel}>Cancel</button>
          <button type="button" className={buttonClass} disabled={busy || !conf.sendable} onClick={confirm}
            data-testid={`send-confirm-go-${item.id}`}>
            {busy ? 'Sending…' : conf.confirm}
          </button>
        </div>
      )}>
      <div className="px-5 py-4">
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
          <dt className="text-axal-faint dark:text-gray-400">Recipient</dt>
          <dd data-testid={`send-confirm-recipient-${item.id}`}>{conf.recipient || <Unrecorded>No client account linked</Unrecorded>}</dd>
          <dt className="text-axal-faint dark:text-gray-400">Document</dt>
          <dd data-testid={`send-confirm-document-${item.id}`}>
            {conf.document}
            {conf.host && <span className="text-axal-faint dark:text-gray-400"> · opens {conf.host}</span>}
          </dd>
          <dt className="text-axal-faint dark:text-gray-400">Change note</dt>
          <dd>{conf.note || <Unrecorded>No change note recorded</Unrecorded>}</dd>
          <dt className="text-axal-faint dark:text-gray-400">After sending</dt>
          <dd>{conf.after}</dd>
        </dl>
        {!conf.sendable && conf.reason && (
          <p className="mt-3 text-[12px] font-semibold text-amber-700 dark:text-amber-300" role="alert">{conf.reason}</p>
        )}
        {error && <p className="mt-3 text-[12px] font-semibold text-red-700 dark:text-red-300" role="alert">{error}</p>}
        <p className="mt-3 text-[11px] leading-relaxed text-axal-faint dark:text-gray-400">
          Earlier versions keep the person they were sent to and their own receipts.
        </p>
      </div>
    </Lightbox>
  );
}
