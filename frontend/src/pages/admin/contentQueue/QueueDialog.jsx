/**
 * D1295 (#3391, ART6) — one in-page dialog, 560 wide, for every change the
 * Pipeline makes: what it changes, the reason the author reads where there is
 * one, and Schedule's date and time in the admin's zone. The words are
 * `pipelineModel.dialogFor`'s. Never a browser pop-up.
 */
import React, { useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { REASON_MIN, dialogFor, reasonOk, scheduleAt, scheduleFields, utcLabel } from './pipelineModel';

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your browser’s zone'; } catch { return 'your browser’s zone'; } };

export default function QueueDialog({ kind, article, busy = false, error = null, onConfirm, onClose }) {
  const d = dialogFor(kind, article);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => scheduleFields(article?.publish_at).date);
  const [time, setTime] = useState(() => scheduleFields(article?.publish_at).time);
  if (!d) return null;
  const at = d.when ? scheduleAt(date, time) : null;
  const ready = !busy && (!d.reason || reasonOk(reason)) && (!d.when || Boolean(at));
  const send = () => { if (ready) onConfirm({ reason: d.reason ? reason.trim() : null, publishAt: at }); };
  const footer = (
    <div className="flex w-full flex-wrap justify-end gap-2">
      <button type="button" onClick={onClose} className={actionGhost} data-testid="cq-dialog-cancel">Cancel</button>
      <button type="button" disabled={!ready} onClick={send} className={d.danger ? actionDanger : actionPrimary} data-testid="cq-dialog-confirm">{busy ? 'Working…' : d.confirm}</button>
    </div>
  );
  return (
    <Lightbox label={d.title} title={d.title} onClose={onClose} width={560} phone="sheet" footer={footer} testId={`cq-dialog-${kind}`}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300" data-testid="cq-dialog-line">{d.line}</p>
        {d.reason && (
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">
            {d.reason.label}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={2000}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" data-testid="cq-dialog-reason" />
            <span className="text-[12px] font-normal text-slate-500 dark:text-slate-400">{d.reason.hint}{reason && !reasonOk(reason) ? ` ${REASON_MIN - reason.trim().length} more to go.` : ''}</span>
          </label>
        )}
        {d.when && article?.publish_at && <p className="m-0 text-[12.5px] text-slate-600 dark:text-slate-400" data-testid="cq-dialog-current">Set now: {utcLabel(article.publish_at) || 'a time that does not read'}. Moving it is recorded under your name.</p>}
        {d.when && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" data-testid="cq-dialog-date" />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" data-testid="cq-dialog-time" />
            </label>
            <span className="pb-2 text-[12px] text-slate-500 dark:text-slate-400" data-testid="cq-dialog-zone">Your zone: {zone()}{at ? ` · ${new Date(at).toISOString().slice(11, 16)} UTC` : ''}</span>
          </div>
        )}
        {error && <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert" data-testid="cq-dialog-error">{error}</p>}
      </div>
    </Lightbox>
  );
}
