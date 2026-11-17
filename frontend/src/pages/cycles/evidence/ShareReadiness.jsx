/**
 * D6897 (#6897, canvas D6054 RA-30) — Fundraising readiness shared outside Axal as a dated link.
 *
 * `ShareReadinessButton` sits on the readiness page; it opens `ShareReadinessSheet`, which says what the reader sees
 * (seven areas with score, evidence, what is missing and the day scored; Team assessed by a person; no overall score
 * and no Product-market fit), takes who it is for, an optional one-sentence covering line, the expiry and the view
 * limit, and makes the link. Making it sends nothing: the founder copies the address. The link is listed and revoked
 * on Raise › Evidence › Shared links with the evidence packs. The Worker refuses anyone but the venture's founders.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { raiseEvidenceShareApi } from '../../../lib/api/raiseEvidenceShare';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';
import { day } from './evidenceView';
import { BTN_P, BTN_S, LINK, MUTED } from './EvidenceParts';
import { NOTHING_SENT, COVERING_LINE_MAX, SNAPSHOT_IS_DATED, SNAPSHOT_SHOWS, snapshotErrors, snapshotBody } from './shareOutsideModel';

const FIELD = 'min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[36px]';
const LABEL = 'flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';
const ERR = 'm-0 text-[12px] font-normal text-red-700 dark:text-red-300';
const origin = () => (typeof window !== 'undefined' && window.location ? window.location.origin : '');

export function ShareReadinessSheet({ projectId, onClose }) {
  const [form, setForm] = useState({ label: '', covering_line: '', expires_in_days: 14, view_limit: 10 });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [made, setMade] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = async () => {
    const full = { ...form, expires_in_days: Number(form.expires_in_days), view_limit: Number(form.view_limit) };
    const errs = snapshotErrors(full);
    setErrors(errs); if (Object.keys(errs).length) return;
    setBusy(true); setFailed('');
    try { setMade(await raiseEvidenceShareApi.createReadiness(projectId, snapshotBody(full))); }
    catch (e) { setFailed(userFacingRaiseError(e, { fallback: 'Nothing was saved and nothing left Axal. Try again.' })); }
    finally { setBusy(false); }
  };
  if (made) {
    const url = origin() + made.path;
    return (
      <Sheet label="Snapshot ready" title="Snapshot ready" eyebrow="Share outside Axal" onClose={onClose} testId="share-readiness-made"
        footer={<div className="flex justify-end"><button type="button" className={BTN_P} onClick={onClose}>Done</button></div>}>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13.5px]" data-testid="share-readiness-nothing-sent">{NOTHING_SENT}</p>
          <label className={LABEL}>Link
            <input readOnly className={FIELD} value={url} onFocus={(e) => e.target.select?.()} data-testid="share-readiness-url" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_S} onClick={() => navigator?.clipboard?.writeText?.(url)} data-testid="share-readiness-copy">Copy link</button>
          </div>
          <p className={MUTED}>{made.item_count} areas · expires {day(made.expires_at) || 'Not recorded'} · {made.view_limit} views</p>
          <p className={MUTED}>{SNAPSHOT_IS_DATED}</p>
          <p className={MUTED}>It is listed with your evidence packs on <Link className={LINK} to="/raise/evidence/shared">Shared links</Link>, where you can revoke it.</p>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet label="Share outside Axal" title="Readiness snapshot" eyebrow="Share outside Axal" onClose={busy ? () => {} : onClose} width={560} testId="share-readiness"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={MUTED}>{NOTHING_SENT}</span>
          <div className="flex gap-2">
            <button type="button" className={BTN_S} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={BTN_P} onClick={create} disabled={busy} data-testid="share-readiness-create">{busy ? 'Making…' : 'Create link'}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[13px]" data-testid="share-readiness-shows">{SNAPSHOT_SHOWS}</p>
        <label className={LABEL}>Who it is for
          <input className={FIELD} value={form.label} onChange={set('label')} maxLength={80} aria-invalid={!!errors.label} data-testid="share-readiness-label" />
          {errors.label ? <span className={ERR} role="alert">{errors.label}</span> : null}
        </label>
        <label className={LABEL}>Covering line (optional)
          <input className={FIELD} value={form.covering_line} onChange={set('covering_line')} maxLength={COVERING_LINE_MAX + 20} aria-invalid={!!errors.covering_line} data-testid="share-readiness-line" />
          <span className="text-[12px] font-normal text-axal-muted dark:text-gray-400">One sentence above the snapshot, at most {COVERING_LINE_MAX} characters.</span>
          {errors.covering_line ? <span className={ERR} role="alert">{errors.covering_line}</span> : null}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={LABEL}>Expires after (days)
            <input type="number" min={1} max={90} className={FIELD} value={form.expires_in_days} onChange={set('expires_in_days')} aria-invalid={!!errors.expires_in_days} />
            {errors.expires_in_days ? <span className={ERR} role="alert">{errors.expires_in_days}</span> : null}
          </label>
          <label className={LABEL}>Views allowed
            <input type="number" min={1} max={100} className={FIELD} value={form.view_limit} onChange={set('view_limit')} aria-invalid={!!errors.view_limit} />
            {errors.view_limit ? <span className={ERR} role="alert">{errors.view_limit}</span> : null}
          </label>
        </div>
        <p className={MUTED}>{SNAPSHOT_IS_DATED}</p>
        {failed ? <p role="alert" className={ERR} data-testid="share-readiness-failed">{failed}</p> : null}
      </div>
    </Sheet>
  );
}

export function ShareReadinessButton({ projectId }) {
  const [open, setOpen] = useState(false);
  if (!projectId) return null;
  return (
    <>
      <button type="button" className={BTN_S} onClick={() => setOpen(true)} data-testid="share-readiness-open">Share outside Axal</button>
      {open ? <ShareReadinessSheet projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
