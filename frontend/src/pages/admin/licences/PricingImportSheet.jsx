/**
 * D7715 (#7715) — the Import country data sheet on the HQ catalogue (`/admin/licences/pricing`), drawn by canvas
 * LCD-01 A to F, LCD-05, phone LCD-06 A to C and dark LCD-07 A and B (D7703, owner options A). Super Admin at HQ.
 *
 * It reads the body the import-file builder wrote (`scripts/build-country-import.mjs`, D7714) in the browser and
 * keeps nothing; says what it will change (countries, fields, rows, the revision each country was read at); asks for
 * the reason; and sends it ONCE to `POST /api/admin/licence-pricing/countries/import` behind the write bar (the
 * shared StepUpModal asks for the authenticator code through `request()`).
 *
 * NEVER THE SAME BODY TWICE. Once the Worker has answered with a write (200 or 207), or the answer is unknown (no
 * answer, or a 5xx), the page keeps the file's text in `spent` and this sheet will not send it again: a 207 names the
 * countries that changed since the file was built and says to read the catalogue again and rebuild. A refusal (4xx)
 * wrote nothing; it is shown in the Worker's words and the file must be chosen again before anything is sent.
 * Nothing on the page changes unless the Worker wrote; then the page reads the catalogue again.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Sheet } from '../../../ui';
import { importOutcome, importRowView, parseImportFile, refusalOf } from './pricingHqModel';
import { Tag, thClass, tdClass } from './PricingShell';

const btn = 'inline-flex min-h-[36px] items-center justify-center rounded-lg px-3.5 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[44px]';
// D7715 part 2: dark hover darkens (violet-700); the violet-500 it lightened to held white text at 4.2:1, under AA.
export const primaryBtn = `${btn} bg-violet-700 text-white hover:bg-violet-800 dark:bg-violet-600 dark:text-white dark:hover:bg-violet-700`;
export const ghostBtn = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800`;
const box = 'rounded-lg border p-3 text-[12.5px]';
export const badBox = `${box} border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200`;
export const warnBox = `${box} border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200`;
export const okBox = `${box} border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200`;
export const infoBox = `${box} border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300`;
export const fieldInput = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
const IMPORT_STEPS = ['Choose file', 'Review and reason', 'Result'];
const ROWS_SHOWN = 8;
const REVS_SHOWN = 6;

/**
 * The live region both write sheets speak through (LCD-08): polite for what was written, assertive when nothing
 * was saved. The page draws `region`; a sheet calls `announce(text, politeness)`.
 */
export function useLiveRegion(testId = 'pricing-live') {
  const [said, setSaid] = useState({ text: '', politeness: 'polite' });
  const announce = useCallback((text, politeness = 'polite') => setSaid({ text: String(text || ''), politeness }), []);
  const region = (
    <p className="sr-only" aria-live={said.politeness} role={said.politeness === 'assertive' ? 'alert' : 'status'} data-testid={testId}>{said.text}</p>
  );
  return [region, announce];
}

/** HH:MM UTC now: when a read answered or a file was read, as the sheets say it. */
export const utcMinute = () => new Date().toISOString().slice(11, 16);

export const reasonOk = (r) => { const t = String(r || '').trim(); return t.length >= 3 && t.length <= 500; };

/** The Super Admin write line every sheet carries above its reason (LCD-01 B, LCD-02). */
export function WriteBar({ what }) {
  return (
    <p className="text-[12px] text-gray-600 dark:text-gray-400" data-testid="pricing-write-bar">
      <span className="font-semibold text-gray-800 dark:text-gray-200">Super Admin write · {what}.</span> Asks for your authenticator code if your step-up has lapsed; recorded with your name, the time and your reason.
    </p>
  );
}

/** The reason field: 3 to 500 characters, kept on every history row; a Worker problem sits under it. */
export function ReasonField({ id, value, onChange, error, disabled }) {
  return (
    <label className="block" htmlFor={id}>
      <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">Reason <span className="font-normal text-gray-500 dark:text-gray-400">· required, 3 to 500 characters, kept on every history row</span></span>
      <textarea
        id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={2} maxLength={500}
        aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-err` : undefined}
        placeholder="Say why, in 3 to 500 characters" data-testid={`${id}-input`} className={`${fieldInput} mt-1`}
      />
      {error && <span id={`${id}-err`} className="mt-1 block text-[12px] font-semibold text-rose-700 dark:text-rose-300" data-testid={`${id}-error`}>✕ {error}</span>}
    </label>
  );
}

function Steps({ at }) {
  return (
    <ol className="flex flex-wrap gap-2 text-[11.5px] font-semibold" aria-label="Steps" data-testid="pricing-import-steps">
      {IMPORT_STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined}
          className={i === at ? 'text-violet-700 dark:text-violet-300' : 'text-gray-500 dark:text-gray-400'}>
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

function Section({ n, title, children, testId }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="text-[13px] font-bold text-gray-900 dark:text-gray-100"><span className="font-mono text-gray-500 dark:text-gray-400">{n}</span> {title}</h3>
      {children}
    </section>
  );
}

/** A sheet's table; its box scrolls sideways on a phone, so it takes Tab focus and is named (D7715 part 2). */
function Table({ head, rows, testId, label }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 dark:border-gray-800" tabIndex={0} role="region" aria-label={`${label}, scrolls sideways`}>
      <table className="w-full border-collapse text-[12px]" aria-label={label} data-testid={testId}>
        <thead><tr>{head.map((x) => <th key={x} scope="col" className={thClass}>{x}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}



/**
 * `send(body)` is the import write; `spent` the file texts this page already sent; `onSent(text)` records one;
 * `onWritten(outcome)` reads the page again after a 200 or 207; `onReread()` reads it again after an unknown answer.
 * `readable` is false when the catalogue read failed: no revision can be checked, so Import is off.
 */
export default function PricingImportSheet({ onClose, send, spent, onSent, onWritten, onReread, readable = true, announce = () => {} }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null); // { name, text, at, parsed }
  const [reading, setReading] = useState(false);
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState(null);
  const [unknown, setUnknown] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const parsed = file?.parsed || null;
  const body = parsed?.ok ? parsed.body : null;
  const summary = parsed?.ok ? parsed.summary : null;
  const already = Boolean(file && spent?.has(file.text));

  const choose = async (e) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    setReading(true);
    try {
      const text = await f.text();
      const p = parseImportFile(text, f.name || 'The file');
      setFile({ name: f.name || 'the file', text, at: utcMinute(), parsed: p });
      if (p.ok && !reason) setReason(p.body.reason || '');
      setRefused(null);
      setUnknown(false);
      setShowAll(false);
    } finally {
      setReading(false);
      if (e?.target) e.target.value = '';
    }
  };

  const submit = async () => {
    if (!body || sending || already || refused || !readable || !reasonOk(reason)) return;
    setSending(true);
    const sentBody = { ...body, reason: reason.trim() };
    try {
      const result = await send(sentBody);
      onSent(file.text);
      const o = importOutcome(result, sentBody);
      setOutcome(o);
      setStep(2);
      announce(o.live);
      onWritten(o);
    } catch (e) {
      const r = refusalOf(e, sentBody);
      if (r.answered) {
        setRefused(r);
        announce(r.sentence, 'assertive');
      } else {
        onSent(file.text);
        setUnknown(true);
        announce('The import did not reach the Worker, so its answer is unknown.', 'assertive');
      }
    } finally {
      setSending(false);
    }
  };

  const close = () => { if (!sending) onClose(); };
  // Nothing was written, but the file is chosen again before anything is sent: no Send again (LCD-05).
  const chooseAgain = () => { setStep(0); setRefused(null); setFile(null); };

  const fileChip = file && (
    <p className={`${infoBox} font-mono`} data-testid="pricing-import-file">
      ▤ {file.name}{summary ? ` · ${summary.rows} rows · ${summary.countries.length} countries` : ''} · read in this browser at {file.at} UTC · nothing is uploaded or kept
    </p>
  );

  let content;
  let footer;
  if (step === 2 && outcome) {
    content = (
      <>
        <Steps at={2} />
        <p className={outcome.partial ? warnBox : okBox} role="status" data-testid="pricing-import-outcome" data-partial={outcome.partial ? 'true' : 'false'}>
          {outcome.partial ? '! ' : '✓ '}{outcome.line}{outcome.partial ? ' The Worker answered 207: part of the import was written.' : ' The catalogue was read again. Each row is in its country’s history with your reason.'}
        </p>
        {outcome.partial && (
          <Section n="1" title="Not written" testId="pricing-import-conflicts">
            <Table
              label="Countries not written" head={['Country', 'Rows in the file', 'Revision in the file', 'Revision now', 'Written']} testId="pricing-import-conflicts-table"
              rows={outcome.notWritten.map((c) => (
                <tr key={c.code} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="pricing-import-conflict" data-code={c.code}>
                  <td className={`${tdClass} font-semibold`}>{c.code}</td>
                  <td className={`${tdClass} font-mono`}>{c.rows}</td>
                  <td className={`${tdClass} font-mono`}>{c.revisionInFile ?? '—'}</td>
                  <td className={`${tdClass} font-mono`}>{c.revisionNow ?? '—'}</td>
                  <td className={tdClass}><Tag c={{ state: 'not_recorded', label: 'Nothing written' }} /></td>
                </tr>
              ))}
            />
            <p className="text-[12px] text-gray-600 dark:text-gray-400">Someone changed these profiles after the file was built.</p>
          </Section>
        )}
        <Section n={outcome.partial ? '2' : '1'} title={outcome.partial ? 'Written' : 'Per country'} testId="pricing-import-written">
          <Table
            label="Countries written" head={['Country', 'Rows recorded', 'Revision read', 'Revision now']} testId="pricing-import-written-table"
            rows={outcome.written.map((w) => (
              <tr key={w.code} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                <td className={`${tdClass} font-semibold`}>{w.code}</td>
                <td className={`${tdClass} font-mono`}>{w.rows}</td>
                <td className={`${tdClass} font-mono`}>{w.revisionRead ?? '—'}</td>
                <td className={`${tdClass} font-mono`}>{w.revisionNow ?? '—'}</td>
              </tr>
            ))}
          />
        </Section>
        {outcome.partial && (
          <p className={infoBox} data-testid="pricing-import-rebuild">
            i Read the catalogue again and rebuild the file for {outcome.notWritten.map((c) => c.code).join(', ')}, then import that file. This sheet never sends the same file twice.
          </p>
        )}
      </>
    );
    footer = <div className="flex justify-end"><button type="button" className={primaryBtn} onClick={onClose} data-testid="pricing-import-back">Back to the catalogue</button></div>;
  } else if (unknown) {
    content = (
      <>
        <Steps at={1} />
        <p className={badBox} role="alert" data-testid="pricing-import-unknown">
          ✕ The import did not reach the Worker, so its answer is unknown. Read the catalogue again before sending anything: some countries may already be written. The catalogue and this sheet are unchanged; there is no Send again.
        </p>
      </>
    );
    footer = <div className="flex justify-end"><button type="button" className={primaryBtn} onClick={() => { onReread(); onClose(); }} data-testid="pricing-import-reread">Read the catalogue again</button></div>;
  } else if (step === 1 && body) {
    const shown = showAll ? body.observations : body.observations.slice(0, ROWS_SHOWN);
    const revs = summary.countries;
    content = (
      <>
        <Steps at={1} />
        {fileChip}
        {refused && (
          <div className={badBox} role="alert" data-testid="pricing-import-refused">
            <p className="font-semibold">✕ {refused.sentence}</p>
            {refused.countries.length > 0 && <p className="mt-1">No revision is named for {refused.countries.join(', ')}.</p>}
            <p className="mt-1">The Worker checked before writing anything. Fix the file and choose it again; the reason you typed is kept.</p>
          </div>
        )}
        {refused?.rows.length > 0 && (
          <Section n="!" title="Rows with fields to fix" testId="pricing-import-row-errors">
            <Table
              label="Rows with fields to fix" head={['Row', 'Country', 'Field', 'The Worker’s words']} testId="pricing-import-row-errors-table"
              rows={refused.rows.map((r) => (
                <tr key={`${r.n}-${r.field}`} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="pricing-import-row-error">
                  <td className={`${tdClass} font-mono`}>{r.n}</td>
                  <td className={tdClass}>{r.code}</td>
                  <td className={`${tdClass} font-mono`}>{r.field}</td>
                  <td className={tdClass}>{r.words}</td>
                </tr>
              ))}
            />
            <p className="text-[12px] text-gray-600 dark:text-gray-400">Rows count from 1 as in the file; the Worker numbers them from 0.</p>
          </Section>
        )}
        <Section n="1" title="What this will change" testId="pricing-import-summary">
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px] max-sm:grid-cols-1">
            <dt className="font-semibold text-gray-600 dark:text-gray-400">Countries</dt><dd className="font-mono" data-testid="pricing-import-countries">{revs.length}</dd>
            <dt className="font-semibold text-gray-600 dark:text-gray-400">Rows</dt><dd className="font-mono" data-testid="pricing-import-rows">{summary.rows} of at most 500</dd>
            <dt className="font-semibold text-gray-600 dark:text-gray-400">Fields</dt>
            <dd data-testid="pricing-import-fields">{summary.fields.map((f) => `${f.label} ${f.rows}`).join(' · ')}</dd>
            <dt className="font-semibold text-gray-600 dark:text-gray-400">Written as</dt><dd>Each row becomes the field’s current value and a history row, country by country</dd>
          </dl>
        </Section>
        <Section n="2" title="Each row as the file states it" testId="pricing-import-file-rows">
          <Table
            label="Rows in the file" head={['Row', 'Country', 'Field', 'Value', 'Status', 'Source', 'Reference', 'As of', 'Rev. read']} testId="pricing-import-rows-table"
            rows={shown.map((r, i) => {
              const v = importRowView(r, i, body);
              return (
                <tr key={v.n} className="border-b border-gray-100 last:border-0 dark:border-gray-800" data-testid="pricing-import-row">
                  <td className={`${tdClass} font-mono`}>{v.n}</td>
                  <td className={tdClass}>{v.code}</td>
                  <td className={tdClass}>{v.field}</td>
                  <td className={`${tdClass} font-mono`}>{v.value}</td>
                  <td className={tdClass}>{v.status}</td>
                  <td className={tdClass}>{v.source}</td>
                  <td className={tdClass}>{v.ref}</td>
                  <td className={`${tdClass} font-mono`}>{v.asOf}</td>
                  <td className={`${tdClass} font-mono`}>{v.revision ?? '—'}</td>
                </tr>
              );
            })}
          />
          <p className="flex flex-wrap items-center gap-3 text-[12px] text-gray-600 dark:text-gray-400">
            Showing {shown.length} of {summary.rows} rows
            {summary.rows > ROWS_SHOWN && (
              <button type="button" className="font-bold text-violet-700 underline dark:text-violet-300" onClick={() => setShowAll((s) => !s)} data-testid="pricing-import-show-all">
                {showAll ? `Show the first ${ROWS_SHOWN}` : `Show all ${summary.rows} rows`}
              </button>
            )}
          </p>
        </Section>
        <Section n="3" title="The revision each country was read at" testId="pricing-import-revisions">
          <p className="flex flex-wrap gap-1.5 font-mono text-[12px]">
            {revs.slice(0, showAll ? revs.length : REVS_SHOWN).map((c) => (
              <span key={c.code} className="rounded border border-gray-200 px-1.5 py-0.5 text-gray-800 dark:border-gray-700 dark:text-gray-200">{c.code} [{c.revision}]</span>
            ))}
            {!showAll && revs.length > REVS_SHOWN && <span className="text-gray-500 dark:text-gray-400">and {revs.length - REVS_SHOWN} more</span>}
          </p>
          <p className="text-[12px] text-gray-600 dark:text-gray-400">A country that changed after this revision gets none of its rows; the other countries are written.</p>
        </Section>
        <Section n="4" title="Reason" testId="pricing-import-reason">
          <WriteBar what={`import ${summary.rows} observations`} />
          <ReasonField id="pricing-import-reason" value={reason} onChange={setReason} disabled={sending} error={refused?.code === 'reason_required' ? refused.sentence : null} />
        </Section>
        {already && (
          <p className={warnBox} role="status" data-testid="pricing-import-already-sent">
            ! This file was already sent from this page. Read the catalogue again and rebuild the file; this sheet never sends the same file twice.
          </p>
        )}
        {!readable && (
          <p className={warnBox} role="status" data-testid="pricing-import-unreadable">
            The catalogue read failed, so no revision can be checked. Read the catalogue again before sending anything.
          </p>
        )}
        {sending && <p className="text-[12.5px] text-gray-600 dark:text-gray-400" role="status" data-testid="pricing-import-sending">Importing {summary.rows} observations… The sheet stays open until the Worker answers.</p>}
      </>
    );
    footer = (
      <div className="flex flex-wrap justify-end gap-2">
        {refused
          ? <button type="button" className={ghostBtn} onClick={chooseAgain} data-testid="pricing-import-choose-again">Choose a fixed file…</button>
          : <button type="button" className={ghostBtn} onClick={() => setStep(0)} disabled={sending} data-testid="pricing-import-back-step">Back</button>}
        <button
          type="button" className={primaryBtn} onClick={submit} data-testid="pricing-import-send"
          disabled={sending || already || Boolean(refused) || !readable || !reasonOk(reason)}
        >
          {sending ? 'Importing…' : `Import ${summary.rows} observations`}
        </button>
      </div>
    );
  } else {
    content = (
      <>
        <Steps at={0} />
        <Section n="1" title="The import file" testId="pricing-import-choose">
          <p className="text-[12.5px] text-gray-700 dark:text-gray-300">
            Choose the file the import-file builder wrote: one file of 1 to 500 observations, each with country, field, value, status, source, reference and as-of date, and the profile revision each country was read at.
          </p>
          <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" onChange={choose} data-testid="pricing-import-file-input" aria-label="Import file" />
          <div><button type="button" className={ghostBtn} onClick={() => fileRef.current?.click?.()} data-testid="pricing-import-choose-button">{file ? 'Choose another file…' : 'Choose file…'}</button></div>
          {reading && <p className="text-[12.5px] text-gray-600 dark:text-gray-400" role="status">Reading the file in the browser…</p>}
          {fileChip}
          {parsed && !parsed.ok && <p className={badBox} role="alert" data-testid="pricing-import-problem">✕ {parsed.problem}</p>}
          {!file && !reading && <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="pricing-import-no-file">No file chosen. Review is off until a file is chosen.</p>}
        </Section>
        <p className={infoBox}>i The sheet reads the file here, in your browser, and keeps nothing. Nothing is written until you review it and press Import.</p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">Eadwyn has nothing here: a country figure is never proposed by Eadwyn.</p>
      </>
    );
    footer = (
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={ghostBtn} onClick={close} data-testid="pricing-import-cancel">Cancel</button>
        <button type="button" className={primaryBtn} disabled={!body} onClick={() => setStep(1)} data-testid="pricing-import-review">
          {body ? `Review ${summary.rows} rows` : 'Review rows'}
        </button>
      </div>
    );
  }

  return (
    <Sheet
      eyebrow="Super Admin · country catalogue" title="Import country data" onClose={close} onEscape={close}
      footer={footer} width={760} phone="sheet" testId="pricing-import-sheet" focusKey={`${step}-${unknown}-${Boolean(outcome)}`}
    >
      <div className="flex flex-col gap-4 px-5 py-4">{content}</div>
    </Sheet>
  );
}
