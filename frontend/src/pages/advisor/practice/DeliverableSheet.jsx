import React, { useId, useState } from 'react';
import { Lightbox, Sheet } from '../../../ui';
import { Field, Pill, Unrecorded, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import {
  VERSION_STATUS_LABEL, VERSION_STATUS_TONE, readyAction, readyMark, receiptLine, recipientNote, sendConfirmation, versionDocument, versionDraft, versionStatus,
  versionSummary, versionTag,
} from './deliveryTrail';
import { sendPreview } from './practiceTools';
import VersionFile, { FileChoice } from './VersionFile';

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
 *
 * #5961 (D4833-p3): a version shows its summary when one was recorded (D5959)
 * and nothing for it when none was, and a stored file as its name, size and
 * a Download (D5960). Both are facts of the version: nothing here edits them.
 */

/**
 * The document a version points at: a stored file (name, size, Download), or
 * a link a reader can check.
 */
function DocumentPreview({ version, onDownload = null, testid }) {
  const doc = versionDocument(version);
  if (doc?.kind === 'file') {
    return (
      <VersionFile name={doc.name} sizeLabel={doc.sizeLabel} testid={testid}
        download={onDownload ? () => onDownload(version) : null} />
    );
  }
  if (!doc) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
        No document attached to this version
      </div>
    );
  }
  return (
    <a href={doc.href} target="_blank" rel="noreferrer noopener" data-testid={testid}
      className="block truncate rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink hover:border-emerald-400 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-100">
      <span aria-hidden="true">↗ </span>{doc.host}<span className="text-axal-faint dark:text-gray-400">{doc.path}</span>
    </a>
  );
}

/** A version's summary (D5959) when one was recorded; nothing at all when not: the field is optional. */
function VersionSummary({ version, testid, className }) {
  const text = versionSummary(version);
  if (!text) return null;
  return <p data-testid={testid} className={className}>{text}</p>;
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
 * #4833 part 2 (D4833-p2) — who marked a version ready to send, and when.
 * A name that no longer reads back is "Not recorded", never left blank.
 */
function ReadyMark({ version, testid }) {
  const mark = readyMark(version);
  if (!mark) return null;
  return (
    <p data-testid={testid} className="text-[11px] leading-relaxed text-axal-violet-deep dark:text-violet-300">
      Marked ready to send {mark.day || <Unrecorded>day unreadable</Unrecorded>}
      {' by '}{mark.by || <Unrecorded>Not recorded</Unrecorded>}
    </p>
  );
}

/**
 * #4833 part 2 (D4833-p2) — Mark ready / Clear Ready on the latest unsent
 * version, with what it does said beside it before it is pressed. No pop-up:
 * the mark is reversible and sends nothing, so it needs no confirmation, and
 * its answer (or the Worker's refusal) is said here, where it was asked.
 */
function ReadyControl({ item, busy, onToggleReady }) {
  const action = readyAction(item);
  const [answer, setAnswer] = useState(null);
  // The answer outlives the control: a 409 `already_sent` reloads the version
  // as sent, which takes the control away, and the reason must still be said.
  if (!onToggleReady || (!action && !answer)) return null;
  const press = async () => {
    setAnswer(null);
    const res = await onToggleReady(action);
    if (res) setAnswer(res);
  };
  return (
    <div className="grid gap-1" data-testid={`ready-control-${item.id}`}>
      {action && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghostButtonClass} disabled={busy || !action.enabled}
          onClick={press} data-testid={`ready-toggle-${item.id}`} data-kind={action.kind}>
          {busy ? 'Saving…' : action.label}
        </button>
        <span className={`min-w-0 flex-1 text-[10.5px] leading-relaxed ${action.enabled ? 'text-axal-faint dark:text-gray-400' : 'text-amber-700 dark:text-amber-300'}`}
          data-testid={`ready-consequence-${item.id}`}>
          {action.consequence}
        </span>
      </div>}
      {answer && (
        <p role={answer.ok ? 'status' : 'alert'} data-testid={`ready-answer-${item.id}`}
          className={`text-[12px] font-semibold ${answer.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
          {answer.text}
        </p>
      )}
    </div>
  );
}

/**
 * PX-06 B — the deliverable's detail. `children` is where the page puts the
 * details editor when it is open.
 */
export function DeliverableSheet({
  item, engagementName = null, busy = '', onClose, onAddVersion, onSend, onEdit, onToggleReady = null,
  onDownloadFile = null, editing = false, children = null,
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
            <VersionSummary version={latest} testid={`latest-summary-${item.id}`}
              className="text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-300" />
            <DocumentPreview version={latest} onDownload={onDownloadFile} testid={`latest-document-${item.id}`} />
            <span className="text-[11px] tabular-nums text-axal-faint dark:text-gray-400">{receiptLine(latest)}</span>
            <ReadyMark version={latest} testid={`latest-ready-${item.id}`} />
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
        <ReadyControl item={item} busy={busy === `r-${item.id}`} onToggleReady={onToggleReady} />
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
                    <div className="pl-16">
                      <VersionSummary version={v} testid={`history-summary-${item.id}-v${v.version}`}
                        className="text-[11.5px] leading-relaxed text-axal-muted dark:text-gray-300" />
                    </div>
                    {versionDocument(v)?.kind === 'file' && (
                      <div className="pl-16">
                        <DocumentPreview version={v} onDownload={onDownloadFile} testid={`history-file-${item.id}-v${v.version}`} />
                      </div>
                    )}
                    <div className="pl-16"><ReadyMark version={v} testid={`history-ready-${item.id}-v${v.version}`} /></div>
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
 * PX-06 C — Add version: "Change note · required", "Document or URL ·
 * required", "Summary · optional". A change note and a document are both
 * required: there is no one-click empty version (D4712). The document is a
 * file or an https link, one of the two (D5960). It saves the next version
 * unsent; sending is its own confirmed step. A file the Worker refuses (too
 * large, not a PDF, JPEG or PNG) comes back as its sentence, and nothing is
 * saved.
 */
export function AddVersionDialog({ item, busy = false, onCancel, onSave }) {
  const [draft, setDraft] = useState({ summary: '', link_url: '', version_summary: '', file: null });
  const [error, setError] = useState('');
  const formId = useId();
  const fileId = useId();
  const next = Number(item.latest_version?.version || item.version_count || 0) + 1;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const res = versionDraft(draft);
    if (res.error) { setError(res.error); return; }
    const refusal = res.file ? await onSave?.(item, res.body, res.file) : await onSave?.(item, res.body);
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
        <div className="grid gap-1.5" role="group" aria-labelledby={`${fileId}-label`}>
          <span id={`${fileId}-label`} className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint dark:text-gray-400">
            Document or URL · required
          </span>
          <FileChoice file={draft.file} testid={`add-version-file-${item.id}`} buttonClass={ghostButtonClass}
            onChoose={(f) => setDraft((d) => ({ ...d, file: f }))} />
          <input className={inputClass} value={draft.link_url} placeholder="or https://…" aria-label="Document link"
            data-testid={`add-version-link-${item.id}`} disabled={!!draft.file}
            onChange={(e) => setDraft((d) => ({ ...d, link_url: e.target.value }))} />
          <span className="text-[11px] leading-relaxed text-axal-faint dark:text-gray-400">
            A file, or a web address that starts with https:// where the client opens this version. One of the two.
          </span>
        </div>
        <Field label="Summary · optional" hint="What this version says, for the client. Leave it empty if the note says enough.">
          <textarea rows={2} className={inputClass} value={draft.version_summary} data-testid={`add-version-summary-${item.id}`}
            onChange={(e) => setDraft((d) => ({ ...d, version_summary: e.target.value }))} />
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
            {conf.fileName && <span className="text-axal-faint dark:text-gray-400"> · file {conf.fileName}</span>}
            {conf.host && <span className="text-axal-faint dark:text-gray-400"> · opens {conf.host}</span>}
          </dd>
          <dt className="text-axal-faint dark:text-gray-400">Change note</dt>
          <dd>{conf.note || <Unrecorded>No change note recorded</Unrecorded>}</dd>
          {conf.summary && <>
            <dt className="text-axal-faint dark:text-gray-400">Summary</dt>
            <dd data-testid={`send-confirm-summary-${item.id}`}>{conf.summary}</dd>
          </>}
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
