/**
 * D6864 (#6864, canvas D6054) — Raise › Evidence shared outside Axal:
 *
 * - `ShareOutsideSheet` (RA-27): the composer opened from "Share outside Axal", beside the in-Axal Share. Before an NDA
 *   (coverage only) is the default; "An NDA is signed outside Axal" needs the founder's confirmation and its date. Each
 *   row says what the reader sees, read from the Worker's own preview projection. Create pack sends nothing and hands
 *   off to Data room access (RA-19).
 * - `SharedLinks` (RA-29): every link made, with what it shares, items, created, expires, views of the limit and last
 *   opened. Expired, used-up and revoked rows stay, in grey with a word. "Changed since sent" offers Make a new pack;
 *   the reader's copy did not change. Revoke is scope, review, result.
 * - `AddEvidenceSheet` (RA-32): source fixed to Typed: stated by you, strength Anecdote, sharing Private.
 *
 * D6897 part 2 (RA-27, RA-28 C, RA-29): Output is Link or PDF. A PDF copy has no expiry and no view limit; the Worker
 * records it and returns the pack, the browser draws the A4 page. Shared links lists PDF copies apart, with no state.
 *
 * No browser pop-up anywhere; every write opens an in-page sheet or dialog first.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox } from '../../../ui';
import Sheet from '../../../ui/Sheet.jsx';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { raiseEvidenceShareApi } from '../../../lib/api/raiseEvidenceShare';
import { userFacingRaiseError } from '../../../lib/raiseErrors.js';
import { AREAS } from './evidenceModel';
import { day, itemTitle, sourceWord } from './evidenceView';
import { BTN_D, BTN_P, BTN_S, CARD, H2, LINK, MUTED } from './EvidenceParts';
import {
  READERS, NOTHING_SENT, COPY_IS_DATED, PDF_LINE, TYPED_FIXED, readerSees, readerWord, linkStateOf, isGrey, viewsLine,
  changedWord, composerErrors, composerBody, typedErrors, typedBody, whatItShares, PDF_DOWNLOADED,
} from './shareOutsideModel';
import { COPY_LINE, copyShares } from './sharePdfModel';
import { OutputChoice } from './ShareReadiness';
import { downloadPackPdf } from '../../../lib/raiseSharePdf';

const FIELD = 'min-h-[44px] w-full rounded-lg border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:min-h-[36px]';
const LABEL = 'flex flex-col gap-1 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100';
const ERR = 'm-0 text-[12px] font-normal text-red-700 dark:text-red-300';
const today = () => new Date().toISOString().slice(0, 10);
const origin = () => (typeof window !== 'undefined' && window.location ? window.location.origin : '');

/** RA-27 A/B: the rows the reader would see, from the founder's own preview (never logged as an investor open). */
function ReaderRows({ preview, reader, picked, onToggle }) {
  if (!preview) return <p className={MUTED} data-testid="share-outside-reading">Reading what the reader would see…</p>;
  if (preview.error) return <p role="alert" className={ERR} data-testid="share-outside-unreadable">{preview.error}</p>;
  if (reader === 'before_nda') {
    const groups = preview.coverage?.state === 'recorded' ? preview.coverage.groups : null;
    if (!groups) return <p role="alert" className={ERR} data-testid="share-outside-unreadable">The evidence could not be read. Nothing will leave Axal until it can.</p>;
    if (!groups.length) return <p className={MUTED} data-testid="share-outside-empty">Nothing is shared beyond Private yet, so there is no pack to make.</p>;
    return (
      <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="share-outside-coverage">
        {groups.map((g) => (
          <li key={`${g.area}-${g.kind}-${g.source_label}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-axal-hairline py-1.5 text-[12.5px] dark:border-gray-800">
            <span><b>{itemTitle(g)}</b> · {g.area} · {sourceWord(g.source_label) || 'Not recorded'}</span>
            <span className="text-axal-muted dark:text-gray-400">{g.count} · newest {day(g.newest) || 'Not recorded'} · The reader sees: coverage only</span>
          </li>
        ))}
      </ul>
    );
  }
  const rows = preview.items?.state === 'recorded' ? preview.items.rows : null;
  if (!rows) return <p role="alert" className={ERR} data-testid="share-outside-unreadable">The evidence could not be read. Nothing will leave Axal until it can.</p>;
  if (!rows.length) return <p className={MUTED} data-testid="share-outside-empty">Nothing is shared beyond Private yet, so there is no pack to make.</p>;
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="mb-1 text-[12.5px] font-semibold">Items in this pack</legend>
      {rows.map((r) => (
        <label key={r.uid} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 border-b border-axal-hairline py-1.5 text-[12.5px] dark:border-gray-800" data-testid="share-outside-row">
          <span className="flex items-center gap-2">
            <input type="checkbox" checked={picked.has(r.uid)} onChange={() => onToggle(r.uid)} aria-label={`Include ${itemTitle(r)} in the pack`} />
            <b>{itemTitle(r)}</b> · {r.area} · {day(r.observed_on) || 'Not recorded'}
          </span>
          <span className="text-axal-muted dark:text-gray-400" data-testid="share-outside-sees">The reader sees: {readerSees(r)}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function ShareOutsideSheet({ projectId, onClose, onMade }) {
  const [form, setForm] = useState({ output: 'link', label: '', reader: 'before_nda', nda_confirmed: false, nda_signed_on: '', expires_in_days: 14, view_limit: 10 });
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [made, setMade] = useState(null);
  const after = form.reader === 'after_nda';
  useEffect(() => {
    let live = true; setPreview(null);
    raiseEvidenceApi.preview(projectId, after).then((p) => {
      if (!live) return; setPreview(p);
      setPicked(new Set(p?.items?.state === 'recorded' ? p.items.rows.map((r) => r.uid) : []));
    }).catch((e) => { if (live) setPreview({ error: userFacingRaiseError(e, { fallback: 'The evidence could not be read. Try again.' }) }); });
    return () => { live = false; };
  }, [projectId, after]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const toggle = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const create = async () => {
    const all = after && preview?.items?.state === 'recorded' ? preview.items.rows.map((r) => r.uid) : null;
    const items = all && picked.size !== all.length ? [...picked] : undefined;
    const full = { ...form, expires_in_days: Number(form.expires_in_days), view_limit: Number(form.view_limit), ...(items ? { items } : {}) };
    const errs = composerErrors(full, today());
    setErrors(errs); if (Object.keys(errs).length) return;
    setBusy(true); setFailed('');
    try {
      if (full.output === 'pdf') {
        const copy = await raiseEvidenceShareApi.createPackPdf(projectId, composerBody(full));
        // Recorded first; a drawing failure still lists the copy, and nothing reached any reader.
        let file = null; try { file = await downloadPackPdf(copy.pack); } catch { file = null; }
        setMade({ ...copy, file }); onMade?.(copy);
      } else { const r = await raiseEvidenceShareApi.create(projectId, composerBody(full)); setMade(r); onMade?.(r); }
    }
    catch (e) { setFailed(userFacingRaiseError(e, { fallback: 'Nothing was saved and nothing left Axal. Try again.' })); }
    finally { setBusy(false); }
  };
  if (made?.kind === 'pdf') {
    return (
      <Sheet label="PDF downloaded" title={made.file ? 'PDF downloaded' : 'PDF not drawn'} eyebrow="Share outside Axal" onClose={onClose} testId="share-outside-pdf"
        footer={<div className="flex justify-end"><button type="button" className={BTN_P} onClick={onClose}>Done</button></div>}>
        <div className="flex flex-col gap-3">
          {made.file
            ? <p className="m-0 text-[13.5px]" role="status" data-testid="share-outside-pdf-done">{PDF_DOWNLOADED} <span className="font-mono text-[12px]">{made.file.filename}</span></p>
            : <p role="alert" className={ERR} data-testid="share-outside-pdf-failed">The PDF could not be drawn in this browser. The copy is listed on Shared links; try again to download it.</p>}
          <p className={MUTED}>{readerWord(made.reader)} · {made.item_count} {made.item_count === 1 ? 'item' : 'items'}</p>
          <p className={MUTED}>{COPY_LINE}</p>
          <p className={MUTED}>Files stay in the data room; a PDF carries no file. To let this reader open them, <Link className={LINK} to="/raise/data-room">give them Data room access</Link>.</p>
        </div>
      </Sheet>
    );
  }
  if (made) {
    const url = origin() + made.path;
    return (
      <Sheet label="Pack ready" title="Pack ready" eyebrow="Share outside Axal" onClose={onClose} testId="share-outside-made"
        footer={<div className="flex justify-end"><button type="button" className={BTN_P} onClick={onClose}>Done</button></div>}>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13.5px]" data-testid="share-outside-nothing-sent">{NOTHING_SENT}</p>
          <label className={LABEL}>Link
            <input readOnly className={FIELD} value={url} onFocus={(e) => e.target.select?.()} data-testid="share-outside-url" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_S} onClick={() => navigator?.clipboard?.writeText?.(url)} data-testid="share-outside-copy">Copy link</button>
          </div>
          <p className={MUTED}>{readerWord(made.reader)} · {made.item_count} {made.item_count === 1 ? 'item' : 'items'} · expires {day(made.expires_at) || 'Not recorded'} · {made.view_limit} views</p>
          <p className={MUTED}>{COPY_IS_DATED}</p>
          <p className={MUTED}>Files stay in the data room. To let this reader open them, <Link className={LINK} to="/raise/data-room">give them Data room access</Link>.</p>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet label="Share outside Axal" title="Evidence pack" eyebrow="Share outside Axal" onClose={busy ? () => {} : onClose} width={720} testId="share-outside"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={MUTED}>{NOTHING_SENT}</span>
          <div className="flex gap-2">
            <button type="button" className={BTN_S} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={BTN_P} onClick={create} disabled={busy} data-testid="share-outside-create">{busy ? 'Making…' : form.output === 'pdf' ? 'Download PDF' : 'Create pack'}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-4">
        <OutputChoice value={form.output} onChange={(v) => setForm((f) => ({ ...f, output: v }))} name="pack-output" testId="share-outside-output" />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[12.5px] font-semibold">Who reads it</legend>
          {READERS.map((r) => (
            <label key={r.key} className="flex min-h-[44px] items-start gap-2 text-[13px]">
              <input type="radio" name="reader" value={r.key} checked={form.reader === r.key} onChange={() => setForm((f) => ({ ...f, reader: r.key }))} data-testid={`share-outside-reader-${r.key}`} />
              <span><b>{r.word}</b><br /><span className="text-axal-muted dark:text-gray-400">{r.line}</span></span>
            </label>
          ))}
        </fieldset>
        {after ? (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30" data-testid="share-outside-nda">
            <label className="flex min-h-[44px] items-center gap-2 text-[13px]">
              <input type="checkbox" checked={form.nda_confirmed} onChange={set('nda_confirmed')} data-testid="share-outside-nda-confirm" />
              I confirm an NDA with this reader is signed outside Axal.
            </label>
            {errors.nda_confirmed ? <p className={ERR}>{errors.nda_confirmed}</p> : null}
            <label className={LABEL}>Day the NDA was signed
              <input type="date" className={FIELD} max={today()} value={form.nda_signed_on} onChange={set('nda_signed_on')} data-testid="share-outside-nda-day" />
              {errors.nda_signed_on ? <span className={ERR}>{errors.nda_signed_on}</span> : null}
            </label>
          </div>
        ) : null}
        <label className={LABEL}>Label
          <input className={FIELD} value={form.label} maxLength={80} onChange={set('label')} placeholder="Who it is for" data-testid="share-outside-label" />
          {errors.label ? <span className={ERR}>{errors.label}</span> : null}
        </label>
        {form.output === 'pdf' ? <p className={MUTED} data-testid="share-outside-copy-line">{COPY_LINE}</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={LABEL}>Expires after (days)
            <input type="number" min={1} max={90} className={FIELD} value={form.expires_in_days} onChange={set('expires_in_days')} data-testid="share-outside-days" />
            {errors.expires_in_days ? <span className={ERR}>{errors.expires_in_days}</span> : null}
          </label>
          <label className={LABEL}>View limit
            <input type="number" min={1} max={100} className={FIELD} value={form.view_limit} onChange={set('view_limit')} data-testid="share-outside-views" />
            {errors.view_limit ? <span className={ERR}>{errors.view_limit}</span> : null}
          </label>
        </div>}
        <section className="flex flex-col gap-2">
          <h3 className={H2}>The reader sees</h3>
          <ReaderRows preview={preview} reader={form.reader} picked={picked} onToggle={toggle} />
          {errors.items ? <p className={ERR}>{errors.items}</p> : null}
          {after && preview?.claims?.state === 'recorded' && preview.claims.rows.length
            ? <p className={MUTED} data-testid="share-outside-claims">{preview.claims.rows.length} {preview.claims.rows.length === 1 ? 'claim these items back shows' : 'claims these items back show'} its state in words. A Mismatch is never hidden.</p> : null}
        </section>
        <p className={MUTED}>{COPY_IS_DATED} Private items, unconsented quotes and files the data room refuses never leave.</p>
        {failed ? <p role="alert" className={ERR} data-testid="share-outside-error">{failed}</p> : null}
      </div>
    </Sheet>
  );
}

/** RA-29 B: Revoke as scope → review → result. */
function RevokeDialog({ link, projectId, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const go = async () => {
    setBusy(true); setError('');
    try { const r = await raiseEvidenceShareApi.revoke(projectId, link.uid); setDone(r); onDone?.(); }
    catch (e) { setError(userFacingRaiseError(e, { fallback: 'The link was not stopped. Try again.' })); }
    finally { setBusy(false); }
  };
  return (
    <Lightbox label="Revoke link" title={done ? 'Link stopped' : `Revoke “${link.label}”`} onClose={busy ? () => {} : onClose} width={520} phone="sheet" testId="share-revoke"
      footer={done
        ? <div className="flex justify-end"><button type="button" className={BTN_P} onClick={onClose}>Done</button></div>
        : <div className="flex justify-end gap-2"><button type="button" className={BTN_S} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={BTN_D} onClick={go} disabled={busy} data-testid="share-revoke-confirm">{busy ? 'Stopping…' : 'Revoke link'}</button></div>}>
      {done ? (
        <p className="m-0 text-[13.5px]" role="status" data-testid="share-revoke-result">Revoked. Anyone opening it now sees “This link was stopped by the founder.” The row stays on Shared links in grey.</p>
      ) : (
        <div className="flex flex-col gap-2 text-[13.5px]">
          <p className="m-0">This stops the link for everyone who has it: {link.output === 'readiness' ? 'a readiness snapshot' : readerWord(link.reader).toLowerCase()}, {link.item_count} {link.output === 'readiness' ? 'areas' : link.item_count === 1 ? 'item' : 'items'}, {viewsLine(link)} views.</p>
          <p className={MUTED}>{PDF_LINE}</p>
          {error ? <p role="alert" className={ERR} data-testid="share-revoke-error">{error}</p> : null}
        </div>
      )}
    </Lightbox>
  );
}

/** RA-29 A: the rows, as a table on a desktop and cards on a phone (44px targets). Pure in its inputs. */
export function SharedLinksList({ links, onRevoke, onMakeNew }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px] max-sm:hidden">
        <thead><tr>{['Label', 'What it shares', 'Items', 'Created', 'Expires', 'Views', 'Last opened', 'State', ''].map((h) => <th key={h} className="border-b border-axal-hairline px-2 py-1.5 text-[11px] uppercase tracking-wide text-axal-muted dark:border-gray-800 dark:text-gray-400">{h}</th>)}</tr></thead>
        <tbody>
          {links.map((l) => {
            const st = linkStateOf(l.state); const changed = changedWord(l);
            return (
              <tr key={l.uid} className={isGrey(l.state) ? 'text-axal-muted dark:text-gray-500' : ''} data-testid="shared-link-row" data-state={l.state}>
                <td className="border-b border-axal-hairline px-2 py-1.5 font-semibold dark:border-gray-800">{l.label}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{whatItShares(l)}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{l.item_count}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{day(l.created_at) || 'Not recorded'}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{day(l.expires_at) || 'Not recorded'}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{viewsLine(l)}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{day(l.last_viewed_at) || 'Not opened yet'}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800"><span data-testid="shared-link-state"><span aria-hidden="true">{st.glyph}</span> {st.word}</span>
                  {changed ? <div className="text-amber-800 dark:text-amber-300" data-testid="shared-link-changed">{changed}{l.changed_since_sent ? ' · the reader’s copy did not change' : ''}</div> : null}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">
                  <div className="flex flex-wrap gap-1">
                    {l.changed_since_sent ? (l.output === 'readiness'
                      ? <Link className={BTN_S} to="/raise/fundraising-readiness" data-testid="shared-link-new">Make a new snapshot</Link>
                      : <button type="button" className={BTN_S} onClick={onMakeNew} data-testid="shared-link-new">Make a new pack</button>) : null}
                    {l.state === 'live' ? <button type="button" className={BTN_D} onClick={() => onRevoke(l)} data-testid="shared-link-revoke">Revoke</button> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden" data-testid="shared-links-cards">
        {links.map((l) => {
          const st = linkStateOf(l.state); const changed = changedWord(l);
          return (
            <li key={l.uid} className={`rounded-lg border border-axal-hairline p-3 dark:border-gray-800 ${isGrey(l.state) ? 'text-axal-muted dark:text-gray-500' : ''}`}>
              <div className="flex justify-between gap-2"><b>{l.label}</b><span><span aria-hidden="true">{st.glyph}</span> {st.word}</span></div>
              <p className="m-0 text-[12.5px]">{whatItShares(l)} · {l.item_count} {l.output === 'readiness' ? 'areas' : 'items'} · {viewsLine(l)} views · expires {day(l.expires_at) || 'Not recorded'}</p>
              {changed ? <p className="m-0 text-[12.5px] text-amber-800 dark:text-amber-300">{changed}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {l.changed_since_sent ? (l.output === 'readiness'
                  ? <Link className={`${BTN_S} min-h-[44px]`} to="/raise/fundraising-readiness">Make a new snapshot</Link>
                  : <button type="button" className={`${BTN_S} min-h-[44px]`} onClick={onMakeNew}>Make a new pack</button>) : null}
                {l.state === 'live' ? <button type="button" className={`${BTN_D} min-h-[44px]`} onClick={() => onRevoke(l)}>Revoke</button> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** RA-29: the PDF copies, apart from the links. A copy has no state: it cannot be stopped or counted. Pure in its input. */
export function PdfCopiesList({ copies }) {
  return (
    <section className="flex flex-col gap-2" data-testid="pdf-copies">
      <h3 className="m-0 text-[14px] font-bold">PDF copies · {copies.length}</h3>
      <p className={MUTED}>Listed so you know what left Axal. {COPY_LINE}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {copies.map((c) => (
          <li key={c.uid} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-axal-hairline py-1.5 text-[12.5px] dark:border-gray-800" data-testid="pdf-copy-row">
            <b>{c.label}</b>
            <span>{copyShares(c)}</span>
            <span className="font-mono text-[12px]">Downloaded {day(c.created_at) || 'Not recorded'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SharedLinks({ projectId, onMakeNew }) {
  const [state, setState] = useState({ status: 'loading' });
  const [revoking, setRevoking] = useState(null);
  const load = useCallback(async () => {
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    try { setState({ status: 'ready', read: await raiseEvidenceShareApi.links(projectId) }); }
    catch (e) { setState(e?.status === 403 ? { status: 'forbidden' } : { status: 'error', message: userFacingRaiseError(e, { fallback: 'Shared links could not be read. Try again.' }) }); }
  }, [projectId]);
  useEffect(() => { if (projectId) load(); }, [projectId, load]);
  if (state.status === 'loading') return <section className={CARD} aria-busy="true" data-testid="shared-links-loading"><p className={MUTED}>Reading shared links…</p></section>;
  if (state.status === 'forbidden') return <section className={CARD} data-testid="shared-links-refused"><p className={MUTED}>Only this venture’s founders see what was shared outside Axal.</p></section>;
  if (state.status === 'error') return (
    <section className={CARD} data-testid="shared-links-unreadable">
      <p role="alert" className={ERR}>{state.message} This is not a claim that nothing was shared.</p>
      <button type="button" className={`${BTN_S} w-fit`} onClick={load}>Try again</button>
    </section>
  );
  const links = state.read?.links || [];
  return (
    <section className={CARD} data-testid="shared-links">
      <h2 className={H2}>Shared links</h2>
      <p className={MUTED}>Every evidence pack you made a link for. A pack does not update; {PDF_LINE.charAt(0).toLowerCase() + PDF_LINE.slice(1)}</p>
      {!links.length && !state.read?.copies?.length ? <p className={MUTED} data-testid="shared-links-empty">You have not shared evidence outside Axal yet.</p> : !links.length ? null : (
        <SharedLinksList links={links} onRevoke={setRevoking} onMakeNew={onMakeNew} />
      )}
      {state.read?.capped ? <p className={MUTED}>Showing the newest 100 links.</p> : null}
      {Array.isArray(state.read?.copies) && state.read.copies.length ? <PdfCopiesList copies={state.read.copies} /> : null}
      {state.read?.copies_capped ? <p className={MUTED}>Showing the newest 100 PDF copies.</p> : null}
      {revoking ? <RevokeDialog link={revoking} projectId={projectId} onClose={() => setRevoking(null)} onDone={load} /> : null}
    </section>
  );
}

export function AddEvidenceSheet({ projectId, onClose, onAdded }) {
  const [form, setForm] = useState({ area: '', summary: '', value: '', unit: '', observed_on: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const errs = typedErrors(form, AREAS, today()); setErrors(errs); if (Object.keys(errs).length) return;
    setBusy(true); setFailed('');
    try { const r = await raiseEvidenceShareApi.addTyped(projectId, typedBody(form)); onAdded?.(r); onClose(); }
    catch (e) { setFailed(userFacingRaiseError(e, { fallback: 'Nothing was saved. Your text is kept here. Try again.' })); }
    finally { setBusy(false); }
  };
  return (
    <Sheet label="Add evidence" title="Add evidence" eyebrow="Raise › Evidence" onClose={busy ? () => {} : onClose} width={560} testId="add-evidence"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN_S} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={BTN_P} onClick={save} disabled={busy} data-testid="add-evidence-save">{busy ? 'Saving…' : 'Add evidence'}</button></div>}>
      <div className="flex flex-col gap-3">
        <dl className="m-0 grid grid-cols-3 gap-2 text-[12.5px]" data-testid="add-evidence-fixed">
          <div><dt className="text-axal-muted dark:text-gray-400">Source</dt><dd className="m-0 font-semibold">{TYPED_FIXED.source}</dd></div>
          <div><dt className="text-axal-muted dark:text-gray-400">Strength</dt><dd className="m-0 font-semibold">{TYPED_FIXED.strength}</dd></div>
          <div><dt className="text-axal-muted dark:text-gray-400">Sharing</dt><dd className="m-0 font-semibold">{TYPED_FIXED.sharing}</dd></div>
        </dl>
        <label className={LABEL}>Area
          <select className={FIELD} value={form.area} onChange={set('area')} data-testid="add-evidence-area">
            <option value="">Choose an area</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {errors.area ? <span className={ERR}>{errors.area}</span> : null}
        </label>
        <label className={LABEL}>What it shows
          <input className={FIELD} maxLength={200} value={form.summary} onChange={set('summary')} data-testid="add-evidence-summary" />
          {errors.summary ? <span className={ERR}>{errors.summary}</span> : null}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={LABEL}>Value (optional)
            <input className={FIELD} inputMode="decimal" value={form.value} onChange={set('value')} data-testid="add-evidence-value" />
            {errors.value ? <span className={ERR}>{errors.value}</span> : null}
          </label>
          <label className={LABEL}>Unit
            <input className={FIELD} maxLength={24} value={form.unit} onChange={set('unit')} data-testid="add-evidence-unit" />
            {errors.unit ? <span className={ERR}>{errors.unit}</span> : null}
          </label>
          <label className={LABEL}>Day
            <input type="date" className={FIELD} max={today()} value={form.observed_on} onChange={set('observed_on')} data-testid="add-evidence-day" />
            {errors.observed_on ? <span className={ERR}>{errors.observed_on}</span> : null}
          </label>
        </div>
        <p className={MUTED}>A claim this backs stays Founder’s figure: it is what you stated, not what a record shows. It stays Private until you share it.</p>
        {failed ? <p role="alert" className={ERR} data-testid="add-evidence-error">{failed}</p> : null}
      </div>
    </Sheet>
  );
}
