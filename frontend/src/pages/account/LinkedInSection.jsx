import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { contactsBookApi } from '../../lib/api/contacts';
import { BTN } from './AccountCenter';
import {
  CAN, CANNOT, LINKEDIN_EXPORT_URL, deleteChoice, grantedScopes, lastImportLine, previewCounts, reviewActions,
} from './linkedinModel';

/**
 * D1352 (#3567, part 3 of #3564) — LinkedIn's own section on its connector
 * page, in Your connection's provider slot (as GitHub's repositories are).
 *
 *   WHAT WAS GRANTED: the scopes `GET /api/linkedin/status` names (D1350), and
 *   what Axal VC can and cannot do. It claims no API access.
 *   IMPORT: 1. download Connections.csv from LinkedIn; 2. upload it and see the
 *   preview (new, already in your Network, possible duplicates, errors) —
 *   nothing is written; 3. import; 4. review the possible duplicates: Merge,
 *   Keep both, Dismiss (D1351). The last import's counts and time are shown.
 *
 * It reads `GET /api/linkedin/status` itself; `books` and `statusRead` are the
 * clients (swapped in tests). Every write reads the status again, so the counts
 * are the Worker's.
 */
export default function LinkedInSection({ onChanged, books = contactsBookApi, statusRead = api.linkedinStatus }) {
  const [status, setStatus] = useState({ state: 'loading', value: null });
  const load = useCallback(async () => {
    try { setStatus({ state: 'ready', value: await statusRead() }); } catch { setStatus({ state: 'unreadable', value: null }); }
  }, [statusRead]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged?.(); };
  return (
    <div className="flex flex-col gap-4" data-testid="linkedin-section">
      {status.state === 'unreadable'
        ? <p className={MUTED} data-testid="linkedin-status-unreadable">What LinkedIn granted could not be read. <button type="button" className={BTN.link} onClick={load}>Try again</button></p>
        : <Granted status={status.value} />}
      <ImportFlow status={status.value} onChanged={changed} books={books} />
    </div>
  );
}

function Granted({ status }) {
  const scopes = grantedScopes(status?.scopes);
  return (
    <section aria-labelledby="linkedin-granted" className={CARD} data-testid="linkedin-granted">
      <h3 id="linkedin-granted" className={H3}>What you granted</h3>
      {scopes.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="linkedin-scopes">
          {scopes.map((s) => <li key={s.scope} className={CHIP} title={s.scope}>{s.label}</li>)}
        </ul>
      ) : <p className={MUTED} data-testid="linkedin-scopes-none">No scopes are recorded for this connection.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div data-testid="linkedin-can">
          <div className={LABEL}>Axal VC can</div>
          <ul className="m-0 list-disc pl-5 text-[12.5px] text-axal-ink dark:text-gray-200">{CAN.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div data-testid="linkedin-cannot">
          <div className={LABEL}>Axal VC cannot</div>
          <ul className="m-0 list-disc pl-5 text-[12.5px] text-axal-ink dark:text-gray-200">{CANNOT.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

function ImportFlow({ status, onChanged, books }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [reviews, setReviews] = useState({ state: 'loading', items: [] });

  const loadReviews = useCallback(async () => {
    try { setReviews({ state: 'ready', items: (await books.reviews())?.reviews || [] }); }
    catch { setReviews({ state: 'unreadable', items: [] }); }
  }, [books]);
  useEffect(() => { loadReviews(); }, [loadReviews]);

  const choose = async (e) => {
    const f = e.target.files?.[0] || null;
    setError(''); setPreview(null); setDone(null); setFile(f);
    if (!f) return;
    setBusy('preview');
    try { setPreview((await books.previewLinkedinCsv(f))?.preview || null); }
    catch (err) { setError(err?.data?.detail || err?.message || 'The file could not be read. Try again.'); setFile(null); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  };
  const commit = async () => {
    if (!file || !preview) return;
    setBusy('commit'); setError('');
    try {
      const r = await books.importLinkedinCsv(file);
      setDone(r?.preview || preview); setPreview(null); setFile(null);
      await loadReviews(); onChanged?.();
    } catch (err) { setError(err?.data?.detail || err?.message || 'The import did not finish. Nothing more was changed.'); }
    finally { setBusy(null); }
  };
  const decide = async (uid, decision) => {
    setBusy(`review-${uid}`); setError('');
    try { await books.decideReview(uid, decision); await loadReviews(); onChanged?.(); }
    catch (err) { setError(err?.data?.detail || err?.message || 'That could not be saved. Try again.'); }
    finally { setBusy(null); }
  };

  const last = lastImportLine(status?.last_import);
  return (
    <section aria-labelledby="linkedin-import" className={CARD} data-testid="linkedin-import">
      <h3 id="linkedin-import" className={H3}>Import your connections</h3>
      {last && <p className={MUTED} data-testid="linkedin-last-import">{last}</p>}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        <li className={STEP} data-testid="linkedin-step-1">
          <span className={NUM}>1</span>
          <div className="min-w-0">
            <div className="font-semibold">Download your connections from LinkedIn</div>
            <p className={MUTED}>On LinkedIn: Settings → Data privacy → Get a copy of your data → Connections. LinkedIn emails you the file, Connections.csv.</p>
            <a href={LINKEDIN_EXPORT_URL} target="_blank" rel="noopener noreferrer" className={BTN.link} data-testid="linkedin-export-link">Open LinkedIn’s data download</a>
          </div>
        </li>
        <li className={STEP} data-testid="linkedin-step-2">
          <span className={NUM}>2</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Upload Connections.csv and check the preview</div>
            <p className={MUTED}>Nothing is imported until you press Import.</p>
            <label className={`${BTN.ghost} mt-1 inline-flex cursor-pointer`}>
              {busy === 'preview' ? 'Reading…' : file ? 'Choose another file' : 'Choose Connections.csv'}
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={choose} disabled={!!busy} data-testid="linkedin-file" />
            </label>
            {preview && <Preview preview={preview} />}
          </div>
        </li>
        <li className={STEP} data-testid="linkedin-step-3">
          <span className={NUM}>3</span>
          <div className="min-w-0">
            <div className="font-semibold">Import</div>
            <p className={MUTED}>Adds the new contacts to your Network and fills only blanks on the ones already there.</p>
            <button type="button" className={BTN.primary} disabled={!preview || !!busy} onClick={commit} data-testid="linkedin-commit">
              {busy === 'commit' ? 'Importing…' : 'Import'}
            </button>
            {done && <p className="mt-2 text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status" data-testid="linkedin-imported">Imported. {done.new ?? 0} added; {done.suggestions ?? 0} to review below. <Link className={BTN.link} to="/network/relationships">Open your Network</Link></p>}
          </div>
        </li>
        <li className={STEP} data-testid="linkedin-step-4">
          <span className={NUM}>4</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Review possible duplicates</div>
            <Reviews reviews={reviews} busy={busy} onDecide={decide} onRetry={loadReviews} />
          </div>
        </li>
      </ol>
      {error && <p role="alert" className="text-[12.5px] text-red-700 dark:text-red-300" data-testid="linkedin-error">{error}</p>}
    </section>
  );
}

function Preview({ preview }) {
  return (
    <div className="mt-2 rounded-axal-sm border border-axal-hairline p-3 dark:border-gray-700" data-testid="linkedin-preview">
      <div className={LABEL}>Preview of {preview.rows ?? 0} rows{preview.truncated ? ' (only the first 20,000 are read)' : ''}</div>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] sm:grid-cols-3">
        {previewCounts(preview).map((c) => (
          <div key={c.key} data-testid={`linkedin-preview-${c.key}`}>
            <dt className="text-axal-muted dark:text-gray-400">{c.label}</dt>
            <dd className="m-0 font-semibold">{c.n == null ? 'Not recorded' : c.n}</dd>
          </div>
        ))}
      </dl>
      {preview.sample?.length > 0 && (
        <ul className="m-0 mt-2 list-none p-0 text-[12px]" data-testid="linkedin-preview-sample">
          {preview.sample.slice(0, 8).map((s) => (
            <li key={s.line} className="flex justify-between gap-2 border-t border-axal-ground py-1 dark:border-gray-800">
              <span className="min-w-0 truncate">{s.name || `Line ${s.line}`}{s.company ? ` · ${s.company}` : ''}</span>
              <span className="text-axal-muted dark:text-gray-400">{KIND[s.kind] || s.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
const KIND = { new: 'New', duplicate: 'Already in your Network', suggestion: 'Possible duplicate', skipped: 'Repeated', error: 'Not read' };

function Reviews({ reviews, busy, onDecide, onRetry }) {
  if (reviews.state === 'loading') return <p className={MUTED}>Reading…</p>;
  if (reviews.state === 'unreadable') return <p className={MUTED} data-testid="linkedin-reviews-unreadable">The suggestions could not be read. <button type="button" className={BTN.link} onClick={onRetry}>Try again</button></p>;
  if (!reviews.items.length) return <p className={MUTED} data-testid="linkedin-reviews-empty">Nothing to review.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="linkedin-reviews">
      {reviews.items.map((r) => (
        <li key={r.uid} className="rounded-axal-sm border border-axal-hairline p-2.5 text-[12.5px] dark:border-gray-700" data-testid={`linkedin-review-${r.uid}`}>
          <div className="min-w-0"><span className="font-semibold">{r.imported?.name || 'Imported contact'}</span>{r.imported?.company ? ` · ${r.imported.company}` : ''}</div>
          <div className="text-axal-muted dark:text-gray-400">May be {r.candidate?.name || 'a record you keep'}{r.candidate?.company ? ` · ${r.candidate.company}` : ''} ({REASON[r.reason] || r.reason})</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {reviewActions(r).map((a) => (
              <button key={a.decision} type="button" className={a.decision === 'merge' ? BTN.primary : BTN.ghost} disabled={!!busy}
                onClick={() => onDecide(r.uid, a.decision)} data-testid={`linkedin-review-${r.uid}-${a.decision}`}>{a.label}</button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
const REASON = { url: 'the same LinkedIn profile', email: 'the same email', name_company: 'the same name and company' };

/**
 * Disconnect's choice (D1350's `delete_imported`), drawn inside the page's
 * Disconnect dialog: what it deletes and keeps, said before it is pressed.
 */
export function LinkedInDisconnectChoice({ checked, onChange, statusRead = api.linkedinStatus }) {
  const [imported, setImported] = useState(undefined);
  useEffect(() => { let live = true; statusRead().then((s) => live && setImported(s?.imported ?? null)).catch(() => live && setImported(null)); return () => { live = false; }; }, [statusRead]);
  const choice = deleteChoice(imported);
  return (
    <div className="px-5 pb-4 text-[13px] text-axal-ink dark:text-gray-200" data-testid="linkedin-disconnect-choice">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="linkedin-delete-imported" />
        <span>{choice.label}</span>
      </label>
      <p className={`${MUTED} mt-1 pl-6`} data-testid="linkedin-delete-note">{imported === undefined ? 'Reading how many…' : choice.note}</p>
    </div>
  );
}

const CARD = 'flex flex-col gap-3 rounded-axal-sm border border-axal-hairline bg-white p-4 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const H3 = 'm-0 text-[14px] font-bold text-axal-ink dark:text-gray-100';
const LABEL = 'mb-1 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const CHIP = 'rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-200';
const STEP = 'flex items-start gap-3';
const NUM = 'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-axal-ground text-[12px] font-bold text-axal-ink dark:bg-gray-800 dark:text-gray-100';
