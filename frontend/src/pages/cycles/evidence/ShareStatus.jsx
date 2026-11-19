/**
 * D6897 part 4 (#6897, canvas D6054 RA-31) — the Raise status page, shared outside Axal from the Overview on /raise.
 *
 * `ShareStatusButton` sits in the Overview's header (founders only; a read-only reader gets no header actions). It
 * opens `ShareStatusSheet`, which lists what is on the page (stage, five materials in state words, investor counts by
 * stage, readiness by area, the next three steps and the connected tools' read state) and what is left out (investor
 * names and commitment amounts), and makes it as a Link (expiry and view limit) or a PDF copy. Making it sends
 * nothing: the founder copies the address or the file. Both are listed on Raise › Evidence › Shared links, where a
 * link is revoked. When any part of the raise cannot be read the Worker makes nothing (RA-34) and the sheet says so.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { raiseEvidenceShareApi } from '../../../lib/api/raiseEvidenceShare';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';
import { downloadStatusPdf } from '../../../lib/raiseSharePdf';
import { day } from './evidenceView';
import { BTN_P, BTN_S, LINK, MUTED } from './EvidenceParts';
import { NOTHING_SENT, PDF_DOWNLOADED } from './shareOutsideModel';
import { COPY_LINE } from './sharePdfModel';
import { OutputChoice } from './ShareReadiness';
import { STATUS_IS_DATED, STATUS_LEFT_OUT, STATUS_ON_PAGE, STATUS_UNREADABLE, statusErrors, statusRequest } from './statusPageModel';

const FIELD = 'min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[36px]';
const LABEL = 'flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';
const ERR = 'm-0 text-[12px] font-normal text-red-700 dark:text-red-300';
const origin = () => (typeof window !== 'undefined' && window.location ? window.location.origin : '');
const SHARED = <>It is listed on <Link className={LINK} to="/raise/evidence/shared">Shared links</Link>.</>;

/** RA-31 A: what the reader gets, and the one thing left out. Pure; a word and a mark each, never colour alone. */
export function OnThePage() {
  return (
    <section aria-label="On the page" data-testid="share-status-on-page">
      <h3 className="m-0 mb-1 text-[13px] font-bold">On the page</h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
        {STATUS_ON_PAGE.map((r) => (
          <li key={r.key} className="flex gap-2" data-testid="share-status-on"><span aria-hidden="true">✓</span><span><b>{r.word}</b> <span className="text-axal-muted dark:text-gray-400">{r.line}</span></span></li>
        ))}
        <li className="flex gap-2" data-testid="share-status-left-out"><span aria-hidden="true">✕</span><span><b>{STATUS_LEFT_OUT.word}</b> <span className="text-axal-muted dark:text-gray-400">{STATUS_LEFT_OUT.line}</span></span></li>
      </ul>
    </section>
  );
}

export function ShareStatusSheet({ projectId, onClose }) {
  const [form, setForm] = useState({ output: 'link', label: '', expires_in_days: 14, view_limit: 10 });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [made, setMade] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = async () => {
    const full = { ...form, expires_in_days: Number(form.expires_in_days), view_limit: Number(form.view_limit) };
    const errs = statusErrors(full);
    setErrors(errs); if (Object.keys(errs).length) return;
    setBusy(true); setFailed('');
    try {
      if (full.output === 'pdf') {
        const copy = await raiseEvidenceShareApi.createStatusPdf(projectId, statusRequest(full));
        // The copy is recorded before it is drawn; a drawing failure still says what left (nothing reached the reader).
        let file = null; try { file = await downloadStatusPdf(copy.status); } catch { file = null; }
        setMade({ ...copy, file });
      } else setMade(await raiseEvidenceShareApi.createStatus(projectId, statusRequest(full)));
    } catch (e) {
      const code = e?.data?.error || e?.code;
      setFailed(code === 'status_unreadable' ? STATUS_UNREADABLE : userFacingRaiseError(e, { fallback: 'Nothing was saved and nothing left Axal. Try again.' }));
    } finally { setBusy(false); }
  };
  const done = (label, title, testId, children) => (
    <Sheet label={label} title={title} eyebrow="Share outside Axal" onClose={onClose} testId={testId}
      footer={<div className="flex justify-end"><button type="button" className={BTN_P} onClick={onClose}>Done</button></div>}>
      <div className="flex flex-col gap-3">{children}</div>
    </Sheet>
  );
  if (made?.kind === 'pdf') {
    return done('PDF downloaded', made.file ? 'PDF downloaded' : 'PDF not drawn', 'share-status-pdf', <>
      {made.file
        ? <p className="m-0 text-[13.5px]" role="status" data-testid="share-status-pdf-done">{PDF_DOWNLOADED} <span className="font-mono text-[12px]">{made.file.filename}</span></p>
        : <p role="alert" className={ERR} data-testid="share-status-pdf-failed">The PDF could not be drawn in this browser. The copy is listed on Shared links; try again to download it.</p>}
      <p className={MUTED}>{COPY_LINE}</p>
      <p className={MUTED}>{SHARED}</p>
    </>);
  }
  if (made) {
    const url = origin() + made.path;
    return done('Status page ready', 'Status page ready', 'share-status-made', <>
      <p className="m-0 text-[13.5px]" data-testid="share-status-nothing-sent">{NOTHING_SENT}</p>
      <label className={LABEL}>Link
        <input readOnly className={FIELD} value={url} onFocus={(e) => e.target.select?.()} data-testid="share-status-url" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN_S} onClick={() => navigator?.clipboard?.writeText?.(url)} data-testid="share-status-copy">Copy link</button>
      </div>
      <p className={MUTED}>Expires {day(made.expires_at) || 'Not recorded'} · {made.view_limit} views</p>
      <p className={MUTED}>{STATUS_IS_DATED}</p>
      <p className={MUTED}>{SHARED} You can revoke it there.</p>
    </>);
  }
  return (
    <Sheet label="Share outside Axal" title="Raise status" eyebrow="Share outside Axal · a one-page summary of the Overview" onClose={busy ? () => {} : onClose} width={560} testId="share-status"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={MUTED}>{NOTHING_SENT}</span>
          <div className="flex gap-2">
            <button type="button" className={BTN_S} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={BTN_P} onClick={create} disabled={busy} data-testid="share-status-create">{busy ? 'Making…' : form.output === 'pdf' ? 'Download PDF' : 'Create status page'}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-4">
        <OutputChoice value={form.output} onChange={(v) => setForm((f) => ({ ...f, output: v }))} name="status-output" testId="share-status-output" />
        <label className={LABEL}>Label
          <input className={FIELD} value={form.label} onChange={set('label')} maxLength={80} aria-invalid={!!errors.label} data-testid="share-status-label" />
          {errors.label ? <span className={ERR} role="alert">{errors.label}</span> : null}
        </label>
        {form.output === 'pdf' ? <p className={MUTED} data-testid="share-status-copy-line">{COPY_LINE}</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={LABEL}>Expires after (days)
            <input type="number" min={1} max={90} className={FIELD} value={form.expires_in_days} onChange={set('expires_in_days')} aria-invalid={!!errors.expires_in_days} />
            {errors.expires_in_days ? <span className={ERR} role="alert">{errors.expires_in_days}</span> : null}
          </label>
          <label className={LABEL}>View limit
            <input type="number" min={1} max={100} className={FIELD} value={form.view_limit} onChange={set('view_limit')} aria-invalid={!!errors.view_limit} />
            {errors.view_limit ? <span className={ERR} role="alert">{errors.view_limit}</span> : null}
          </label>
        </div>}
        <OnThePage />
        <p className={MUTED}>{STATUS_IS_DATED}</p>
        {failed ? <p role="alert" className={ERR} data-testid="share-status-failed">{failed}</p> : null}
      </div>
    </Sheet>
  );
}

export function ShareStatusButton({ projectId }) {
  const [open, setOpen] = useState(false);
  if (!projectId) return null;
  return (
    <>
      <button type="button" className={BTN_S} onClick={() => setOpen(true)} data-testid="share-status-open">Share outside Axal</button>
      {open ? <ShareStatusSheet projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
