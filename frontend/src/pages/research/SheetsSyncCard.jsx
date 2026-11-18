import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Pill } from '../../ui';
import Sheet from '../../ui/Sheet';
import { researchFundSheetsApi as sheetsApi } from '../../lib/api/researchFundSheets.js';
import { inputClass } from '../advisor/expertise/kit';
import {
  ACTION_LABEL, EXPORT_LABEL, FIELD_LABEL, IMPORT_LABEL, announcement, cardState, disabledReason,
  importPrimaryLabel, listRows, newIdempotencyKey, primaryAction, resultLabel, runCounts, sheetHref,
  utcStamp, whatCanRun,
} from './sheetsSyncModel';

/**
 * Research › Funds › My funds — the Google Sheets card (D7035 canvas, boards
 * FND-G01 to FND-G09; D7170). Super-admin only: `FundsZone` mounts it behind
 * `isSuperAdminUser`, and every Worker route is `requireSuperAdmin`. Founders
 * keep a shortlist on Axal; they never see this card.
 *
 * Axal is the record and the workbook is a copy. Two named actions, Export
 * Axal funds to Sheets and Import from Sheets, each open the shared Sheet and
 * go Scope → Review → Result. Nothing is written until the workbook, tab,
 * range, record count and private fields have been reviewed and confirmed.
 * The tab is always a choice by gid: being first in the workbook never makes a
 * tab the destination, and a missing tab blocks both directions.
 *
 * One primary action per state. Disabled actions use `aria-disabled` and say
 * why beside them, so they stay focusable and explain themselves.
 */

const PRIMARY = 'inline-flex min-h-[36px] items-center justify-center rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white '
  + 'hover:bg-axal-violet-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 '
  + 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400 dark:focus-visible:ring-violet-300 dark:focus-visible:ring-offset-gray-950 '
  + 'max-sm:min-h-[44px] max-sm:w-full';
const SECONDARY = 'inline-flex min-h-[36px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink '
  + 'hover:bg-axal-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 '
  + 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:ring-violet-300 dark:focus-visible:ring-offset-gray-950 '
  + 'max-sm:min-h-[44px] max-sm:w-full';
const LINK = 'text-[12px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300';
const MUTED = 'text-axal-muted dark:text-gray-400';
const LABEL = 'text-[10.5px] font-extrabold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400';

/** A button that stays focusable when off, and says why beside it. */
function Action({ primary = false, off = null, onClick, children, buttonRef, testid }) {
  return (
    <button
      type="button"
      ref={buttonRef}
      data-testid={testid}
      className={primary ? PRIMARY : SECONDARY}
      aria-disabled={off ? 'true' : undefined}
      onClick={(e) => { if (off) { e.preventDefault(); return; } onClick?.(e); }}
    >
      {children}
    </button>
  );
}

function Section({ label, children }) {
  return (
    <div className="border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-800">
      <div className={LABEL}>{label}</div>
      <div className="mt-1.5 text-[12.5px]">{children}</div>
    </div>
  );
}

function ResultChip({ run }) {
  const r = resultLabel(run);
  return r ? <Pill tone={r.tone}>{r.text}</Pill> : null;
}

/** Empty from the start, so the sentence that lands in it is announced. */
function LiveRegions({ ann }) {
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{ann?.role === 'status' ? ann.text : ''}</div>
      <div role="alert" aria-atomic="true" className="sr-only">{ann?.role === 'alert' ? ann.text : ''}</div>
    </>
  );
}

function Steps({ current, steps = ['Scope', 'Review', 'Result'] }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-2 text-[11.5px]" aria-label="Steps">
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={`rounded-full border px-2.5 py-0.5 font-semibold ${i === current
            ? 'border-violet-300 bg-axal-lavender text-axal-violet-deep dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-200'
            : i < current ? 'border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300' : `border-axal-hairline ${MUTED} dark:border-gray-700`}`}
        >
          {i + 1} {s}
        </li>
      ))}
    </ol>
  );
}

function Direction({ from, to }) {
  return (
    <div className="mb-4 grid gap-2 rounded-xl border border-axal-hairline bg-axal-ground/60 p-3 text-[12.5px] sm:grid-cols-[1fr_auto_1fr] dark:border-gray-800 dark:bg-gray-900/60">
      <div><div className={LABEL}>From</div><div className="font-semibold">{from[0]}</div><div className={MUTED}>{from[1]}</div></div>
      <div aria-hidden="true" className="self-center text-axal-violet dark:text-violet-300">→</div>
      <div><div className={LABEL}>To</div><div className="font-semibold">{to[0]}</div><div className={MUTED}>{to[1]}</div></div>
    </div>
  );
}

function Counts({ items }) {
  return (
    <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value, tone, sub]) => (
        <div key={label} className={`rounded-xl border p-2.5 ${tone === 'a' ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20' : tone === 'g' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20' : 'border-axal-hairline dark:border-gray-800'}`}>
          <dt className={`text-[11px] ${MUTED}`}>{label}</dt>
          <dd className="text-[18px] font-extrabold tabular-nums">{value}</dd>
          {sub ? <dd className={`text-[11px] ${MUTED}`}>{sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function FieldTick({ label, checked, onChange, disabled = false, isPrivate = false, sub }) {
  return (
    <label className={`flex items-start gap-2.5 rounded-lg px-1 py-1.5 ${disabled ? 'opacity-70' : ''}`}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span>
        <span className="font-semibold">{label}</span>
        {isPrivate ? <span className="ml-1.5"><Pill tone="warn">Private</Pill></span> : null}
        {sub ? <span className={`block text-[11.5px] ${MUTED}`}>{sub}</span> : null}
      </span>
    </label>
  );
}

function Problem({ error }) {
  if (!error) return null;
  return <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{error}</p>;
}

const errText = (e, fallback) => (e?.message && e.message !== 'Request failed' ? e.message : fallback);

function useStepFocus(step) {
  const head = useRef(null);
  useEffect(() => { head.current?.focus?.(); }, [step]);
  return head;
}

function StepHeading({ headRef, children }) {
  return <h3 ref={headRef} tabIndex={-1} className="mb-3 text-[14px] font-extrabold tracking-tight outline-none">{children}</h3>;
}

function Footer({ left, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
      <div className="max-sm:w-full">{left}</div>
      <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:flex-col-reverse">{children}</div>
    </div>
  );
}

function workbookName(status) {
  return status?.workbook_title || 'The linked workbook';
}

// ── Destination (FND-G02, FND-G05) ──────────────────────────────────────────

export function DestinationFlow({ status, onClose, onSaved }) {
  const href = sheetHref(status);
  const [url, setUrl] = useState(href || '');
  const [listing, setListing] = useState(null);
  const [choice, setChoice] = useState(null); // gid as a string, or 'new'
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const head = useStepFocus(step);
  const missing = status?.tab_state === 'missing';

  const readTabs = async () => {
    setBusy('tabs'); setError(null); setChoice(null);
    try { setListing(await sheetsApi.tabs(url.trim())); } catch (e) {
      setListing(null);
      setError(errText(e, 'Could not read the workbook. Check the URL and that the connected account can open it.'));
    } finally { setBusy(null); }
  };
  useEffect(() => { if (url.trim()) readTabs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = listing?.tabs?.find((t) => String(t.gid) === choice) || null;
  const save = async () => {
    setBusy('save'); setError(null);
    try {
      await sheetsApi.saveDestination({ url: url.trim(), sheetGid: choice === 'new' ? null : Number(choice), createTab: choice === 'new' ? 'Axal funds' : null });
      onSaved();
    } catch (e) {
      setError(errText(e, 'The destination was not saved.'));
      setStep(0);
    } finally { setBusy(null); }
  };

  const tabs = (listing?.tabs || []).filter((t) => !(missing && t.gid === status?.sheet_gid));
  return (
    <Sheet
      eyebrow={missing ? 'Relink · destination' : 'Google Sheets · destination'}
      title={missing ? 'Choose a replacement tab' : 'Choose the workbook and tab'}
      onClose={onClose} width={560} phone="sheet" testId="rfg-destination" initialFocus={head}
      footer={(
        <Footer left={step === 1 ? <Action onClick={() => setStep(0)}>Back</Action> : <span className={`text-[11.5px] ${MUTED}`}>Saving writes no funds.</span>}>
          <Action onClick={onClose}>Cancel</Action>
          {step === 0 ? (
            <Action primary off={!choice ? 'Choose a tab first.' : null} onClick={() => setStep(1)}>Review tab</Action>
          ) : (
            <Action primary off={busy ? 'Saving…' : null} onClick={save} testid="rfg-destination-save">
              {busy === 'save' ? 'Saving…' : choice === 'new' ? 'Create tab and save' : 'Save destination'}
            </Action>
          )}
        </Footer>
      )}
    >
      <div className="px-5 py-4">
        {missing ? <Steps current={step} steps={['Choose tab', 'Review', 'Saved']} /> : null}
        <StepHeading headRef={head}>{step === 0 ? 'Workbook and tab' : 'Review the destination'}</StepHeading>
        <Problem error={error} />
        {missing ? (
          <p role="note" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            “{status?.sheet_title || 'The linked tab'}” (gid {status?.sheet_gid}) was deleted or is no longer shared. The first tab is not used in its place.
          </p>
        ) : null}
        {step === 0 ? (
          <>
            <label className="block text-[12.5px] font-semibold" htmlFor="rfg-url">Spreadsheet URL</label>
            <div className="mt-1 flex gap-2 max-sm:flex-col">
              <input id="rfg-url" className={inputClass} value={url} placeholder={status?.suggested_url || ''} onChange={(e) => setUrl(e.target.value)} />
              <Action off={!url.trim() ? 'Paste a URL first.' : busy ? 'Reading…' : null} onClick={readTabs}>{busy === 'tabs' ? 'Reading…' : 'Read tabs'}</Action>
            </div>
            <p className={`mt-1 text-[11.5px] ${MUTED}`}>Paste the URL. The tab is chosen below, not taken from the link.</p>
            {listing ? (
              <fieldset className="mt-4">
                <legend className="text-[12.5px] font-semibold">
                  Tab <span className={`font-normal ${MUTED}`}>· {listing.workbook_title || 'workbook'} · read {utcStamp(listing.read_at)} · {listing.tabs.length} tabs</span>
                </legend>
                <div className="mt-2 grid gap-1.5">
                  {tabs.map((t) => (
                    <label key={t.gid} className="flex items-start gap-2.5 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800">
                      <input type="radio" name="rfg-tab" className="mt-0.5 h-4 w-4 accent-violet-600" checked={choice === String(t.gid)} onChange={() => setChoice(String(t.gid))} />
                      <span>
                        <span className="font-semibold">{t.title}</span>
                        <span className={`block text-[11.5px] ${MUTED}`}>
                          gid {t.gid}{t.index === 0 ? ' · first tab' : ''} · {t.rows} rows · {t.headers_match ? 'headers match Axal' : 'other headers'}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label className="flex items-start gap-2.5 rounded-lg border border-dashed border-axal-hairline px-3 py-2 dark:border-gray-700">
                    <input type="radio" name="rfg-tab" className="mt-0.5 h-4 w-4 accent-violet-600" checked={choice === 'new'} onChange={() => setChoice('new')} />
                    <span><span className="font-semibold">Axal funds (new tab)</span><span className={`block text-[11.5px] ${MUTED}`}>Created on save · empty</span></span>
                  </label>
                </div>
                <p className={`mt-2 text-[11.5px] ${MUTED}`}>No tab is preselected. Being first in the workbook does not make a tab the destination.</p>
              </fieldset>
            ) : null}
          </>
        ) : (
          <dl className="grid gap-2 text-[12.5px]">
            <div><dt className={LABEL}>Will be saved</dt><dd className="font-semibold">{listing?.workbook_title || 'Workbook'} · {choice === 'new' ? 'Axal funds (new tab)' : `${chosen?.title} · gid ${chosen?.gid}`}</dd></div>
            <div><dt className={LABEL}>Writes now</dt><dd>{choice === 'new' ? 'Creates the empty tab. No funds are written until you review an export.' : 'Nothing. Export and Import each have their own review.'}</dd></div>
            {chosen && !chosen.headers_match && chosen.rows > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                “{chosen.title}” holds {chosen.rows} rows with other headers. The next export would replace A:K on it, and an import would not match its rows to funds.
              </div>
            ) : null}
          </dl>
        )}
      </div>
    </Sheet>
  );
}

// ── Export (FND-G03, FND-G06B) ──────────────────────────────────────────────

export function ExportFlow({ status, onClose, onDone }) {
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState({ thesis: true, note: false, pass_reason: false });
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [run, setRun] = useState(null);
  const key = useRef(null);
  const head = useStepFocus(step);
  const tab = status?.sheet_title || 'the tab';

  const review = async () => {
    setBusy('preview'); setError(null);
    try {
      const p = await sheetsApi.exportPreview(fields);
      setPreview(p); setConfirmed(false); key.current = newIdempotencyKey(); setStep(1);
    } catch (e) { setError(errText(e, 'The tab could not be read. Nothing was written.')); } finally { setBusy(null); }
  };
  const write = async () => {
    setBusy('run'); setError(null);
    try {
      const r = await sheetsApi.exportRun({ fields, idempotencyKey: key.current });
      setRun(r.run); setStep(2); onDone();
    } catch (e) { setError(errText(e, 'The export did not run. Nothing was written.')); } finally { setBusy(null); }
  };
  const again = () => { setRun(null); setPreview(null); setStep(0); };

  const avail = preview?.available || {};
  const title = step === 1 && preview ? `Review: replace ‘${preview.sheet_title}’!${preview.range} with ${preview.funds} funds` : EXPORT_LABEL;
  let footer;
  if (step === 0) {
    footer = (
      <Footer left={<span className={`text-[11.5px] ${MUTED}`}>Nothing has been written.</span>}>
        <Action onClick={onClose}>Cancel</Action>
        <Action primary off={busy ? 'Reading the tab…' : null} onClick={review}>{busy === 'preview' ? 'Reading the tab…' : 'Review export'}</Action>
      </Footer>
    );
  } else if (step === 1) {
    footer = (
      <Footer left={<Action onClick={() => setStep(0)}>Back</Action>}>
        <Action onClick={onClose}>Cancel</Action>
        <Action primary off={!confirmed ? 'Tick the confirmation first.' : busy ? 'Writing…' : null} onClick={write} testid="rfg-export-write">
          {busy === 'run' ? 'Writing…' : `Write ${preview?.funds ?? 0} funds to ${preview?.sheet_title || tab}`}
        </Action>
      </Footer>
    );
  } else {
    footer = (
      <Footer left={<span className={`text-[11.5px] ${MUTED}`}>Run {run?.uid} · {utcStamp(run?.created_at)}</span>}>
        <Action onClick={onClose}>Close</Action>
        {run && run.status !== 'complete' ? <Action primary onClick={again}>Export again</Action> : null}
      </Footer>
    );
  }

  return (
    <Sheet eyebrow="Export · Axal → Google Sheets" title={title} onClose={onClose} width={640} phone="sheet" testId="rfg-export" initialFocus={head} footer={footer}>
      <div className="px-5 py-4">
        <Steps current={step} />
        <LiveRegions ann={step === 2 ? announcement(run) : busy === 'run' ? { role: 'status', text: `Export running. Writing ${preview?.funds ?? 0} funds.` } : null} />
        <Problem error={error} />
        {step === 0 ? (
          <>
            <StepHeading headRef={head}>{EXPORT_LABEL}</StepHeading>
            <Direction from={['My funds · Axal', 'every fund you hold']} to={[workbookName(status), `Tab “${tab}” · gid ${status?.sheet_gid}`]} />
            <fieldset className="text-[12.5px]">
              <legend className="font-semibold">Fields to write</legend>
              <FieldTick label="Fund record (8 columns)" checked disabled sub="uid · Fund · Cheque min · Cheque max · Stage fit · Path · State · Source URL · always written" />
              <FieldTick label="Thesis" checked={fields.thesis} onChange={(v) => setFields({ ...fields, thesis: v })} sub={fields.thesis ? 'Written to column I' : 'Column I left blank'} />
              <FieldTick label="Notes" isPrivate checked={fields.note} onChange={(v) => setFields({ ...fields, note: v })} sub={fields.note ? 'Will be written to column J' : 'Column J left blank'} />
              <FieldTick label="Pass reasons" isPrivate checked={fields.pass_reason} onChange={(v) => setFields({ ...fields, pass_reason: v })} sub={fields.pass_reason ? 'Will be written to column H' : 'Column H left blank'} />
            </fieldset>
            <p className={`mt-3 text-[12px] ${MUTED}`}>Anyone the workbook is shared with can read what you write. Notes and pass reasons are off until ticked, on every run.</p>
          </>
        ) : null}
        {step === 1 && preview ? (
          <>
            <StepHeading headRef={head}>Review the export</StepHeading>
            <Direction from={['My funds · Axal', `${preview.funds} funds`]} to={[preview.workbook_title || workbookName(status), `Tab “${preview.sheet_title}” · gid ${preview.sheet_gid} · confirmed ${utcStamp(preview.checked_at)}`]} />
            <Counts items={[
              ['Funds to write', preview.funds, '', 'all of My funds'],
              ['Rows', `1–${preview.last_row}`, '', 'row 1 is the header'],
              ['Columns', 'A–K', '', '11 columns'],
              ['Private', (fields.note ? 1 : 0) + (fields.pass_reason ? 1 : 0), fields.note || fields.pass_reason ? 'a' : '', [fields.note && `Notes (${avail.note ?? 0})`, fields.pass_reason && `Pass reasons (${avail.pass_reason ?? 0})`].filter(Boolean).join(', ') || 'none'],
            ]} />
            <div className="mb-3 text-[12.5px]">
              <div className="font-semibold">Managed range · replaced</div>
              <p className={MUTED}>‘{preview.sheet_title}’!{preview.range} is written from Axal. What is there now ({preview.current.rows} rows in A–K) is replaced.</p>
            </div>
            {preview.cleared.count ? (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                <span className="font-semibold">{preview.cleared.count} cells below your rows are cleared too</span>: {preview.cleared.cells.join(', ')}{preview.cleared.count > preview.cleared.cells.length ? '…' : ''}. The export owns columns A–K.
              </div>
            ) : null}
            <div className="mb-3 text-[12.5px]">
              <div className="font-semibold">Other content in the workbook · not touched</div>
              {preview.other_columns.length ? (
                <p className={MUTED}>
                  Columns {preview.other_columns.map((c) => `${c.column}${c.header ? ` (${c.header})` : ''}`).join(', ')} on “{preview.sheet_title}”: {Math.max(...preview.other_columns.map((c) => c.filled))} filled rows.{' '}
                  <strong className="text-amber-800 dark:text-amber-300">They do not move with their funds</strong>: rows are written newest first, so a note typed beside a fund can end up beside another.
                </p>
              ) : <p className={MUTED}>Nothing beyond column K on this tab.</p>}
              {preview.other_tabs.length ? <p className={MUTED}>Tabs {preview.other_tabs.map((t) => `“${t}”`).join(', ')}.</p> : null}
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border border-axal-hairline px-3 py-2 text-[12.5px] dark:border-gray-800">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>I have checked the workbook, tab and range{fields.note || fields.pass_reason ? ', and that private fields go to this workbook' : ''}.</span>
            </label>
          </>
        ) : null}
        {step === 2 && run ? <RunResult headRef={head} run={run} label="Export" /> : null}
      </div>
    </Sheet>
  );
}

function RunResult({ headRef, run, label }) {
  const c = run.counts || {};
  return (
    <>
      <StepHeading headRef={headRef}>{label}: {resultLabel(run)?.text}</StepHeading>
      <div className="mb-3"><ResultChip run={run} /></div>
      {run.detail ? <p className="mb-3 text-[12.5px]">{run.detail}</p> : null}
      {run.direction === 'export' ? (
        <Counts items={[
          ['Written', c.written ?? '—', run.status === 'complete' ? 'g' : 'a', run.verified_at ? `read back ${utcStamp(run.verified_at)}` : 'not read back'],
          ['Expected', c.expected ?? '—', ''],
          ...(c.not_written ? [['Not written', c.not_written, 'a']] : []),
        ]} />
      ) : (
        <Counts items={[
          ['Created', c.created ?? '—', 'g'],
          ['Updated', c.updated ?? '—', ''],
          ['Skipped', c.planned?.skip ?? 0, ''],
          ['IDs on sheet', c.ids_expected ? `${c.ids_confirmed ?? 0} / ${c.ids_expected}` : '—', c.ids_expected && c.ids_confirmed !== c.ids_expected ? 'a' : 'g'],
        ]} />
      )}
    </>
  );
}

// ── Import (FND-G04) ────────────────────────────────────────────────────────

export function ImportFlow({ status, onClose, onDone }) {
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState({ thesis: true, note: false, pass_reason: false });
  const [resolutions, setResolutions] = useState({});
  const [preview, setPreview] = useState(null);
  const [show, setShow] = useState('look');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [run, setRun] = useState(null);
  const key = useRef(null);
  const head = useStepFocus(step);
  const tab = status?.sheet_title || 'the tab';

  const load = async (res = resolutions) => {
    setBusy('preview'); setError(null);
    try {
      const p = await sheetsApi.importPreview(fields, res);
      setPreview(p); key.current = newIdempotencyKey(); setStep(1);
    } catch (e) { setError(errText(e, 'The tab could not be read. Nothing was written.')); } finally { setBusy(null); }
  };
  const resolve = (row, value) => {
    const next = { ...resolutions, [row]: value };
    setResolutions(next);
    load(next);
  };
  const go = async () => {
    setBusy('run'); setError(null);
    try {
      const r = await sheetsApi.importRun({ fields, resolutions, idempotencyKey: key.current });
      setRun(r.run); setStep(2); onDone();
    } catch (e) { setError(errText(e, 'The import did not run.')); } finally { setBusy(null); }
  };

  const counts = preview?.counts || {};
  const rows = (preview?.rows || []).filter((r) => show === 'all' || !['unchanged'].includes(r.action));
  const blocked = preview?.open_run ? 'Off until the open import is reconciled.' : null;
  let footer;
  if (step === 0) {
    footer = (
      <Footer left={<span className={`text-[11.5px] ${MUTED}`}>Nothing has been written.</span>}>
        <Action onClick={onClose}>Cancel</Action>
        <Action primary off={busy ? 'Reading the tab…' : null} onClick={() => load()}>{busy === 'preview' ? 'Reading the tab…' : 'Review import'}</Action>
      </Footer>
    );
  } else if (step === 1) {
    footer = (
      <Footer left={<Action onClick={() => setStep(0)}>Back</Action>}>
        <Action onClick={onClose}>Cancel</Action>
        <Action primary off={blocked || (busy ? 'Working…' : null) || (!(counts.create || counts.update) ? 'Nothing to import.' : null)} onClick={go} testid="rfg-import-run">
          {busy === 'run' ? 'Importing…' : importPrimaryLabel(counts)}
        </Action>
      </Footer>
    );
  } else {
    footer = (
      <Footer left={<span className={`text-[11.5px] ${MUTED}`}>Run {run?.uid} · {utcStamp(run?.created_at)}</span>}>
        <Action onClick={onClose}>Close</Action>
      </Footer>
    );
  }

  return (
    <Sheet
      eyebrow="Import · Google Sheets → Axal"
      title={step === 1 && preview ? `Review: import ${counts.rows} rows from ‘${preview.sheet_title}’` : IMPORT_LABEL}
      onClose={onClose} width={760} phone="sheet" testId="rfg-import" initialFocus={head} footer={footer}
    >
      <div className="px-5 py-4">
        <Steps current={step} />
        <LiveRegions ann={step === 2 ? announcement(run) : busy === 'run' ? { role: 'status', text: 'Import running.' } : null} />
        <Problem error={error} />
        {step === 0 ? (
          <>
            <StepHeading headRef={head}>{IMPORT_LABEL}</StepHeading>
            <Direction from={[workbookName(status), `Tab “${tab}” · gid ${status?.sheet_gid} · from row 2`]} to={['My funds · Axal', 'never deleted']} />
            <fieldset className="text-[12.5px]">
              <legend className="font-semibold">Fields to read from the sheet</legend>
              <FieldTick label="Fund record" checked disabled sub="Fund · Cheque min · Cheque max · Stage fit · Path · State · Source URL · only columns present on the sheet" />
              <FieldTick label="Thesis" checked={fields.thesis} onChange={(v) => setFields({ ...fields, thesis: v })} />
              <FieldTick label="Notes" isPrivate checked={fields.note} onChange={(v) => setFields({ ...fields, note: v })} sub={fields.note ? 'On: changes are listed in the preview' : 'Off: Axal keeps its notes as they are'} />
              <FieldTick label="Pass reasons" isPrivate checked={fields.pass_reason} onChange={(v) => setFields({ ...fields, pass_reason: v })} sub={fields.pass_reason ? 'On: changes are listed in the preview' : 'Off: Axal keeps its pass reasons as they are'} />
            </fieldset>
            <p className={`mt-3 text-[12px] ${MUTED}`}>
              A field that is unticked, or a column missing from the sheet, is left as it is in Axal. Import creates or updates funds from the sheet — it never deletes one.
              Cheque amounts on the sheet are US dollars; blank is not zero.
            </p>
          </>
        ) : null}
        {step === 1 && preview ? (
          <>
            <StepHeading headRef={head}>Review the import</StepHeading>
            {preview.open_run ? <Problem error="The last import is not confirmed on the sheet. Reconcile it before importing again, or the same funds would be created twice." /> : null}
            <Direction from={[preview.workbook_title || workbookName(status), `Tab “${preview.sheet_title}” · gid ${preview.sheet_gid} · confirmed ${utcStamp(preview.checked_at)} · rows ${preview.first_row}–${preview.last_row}`]} to={['My funds · Axal', `${preview.funds_in_axal} funds · nothing is deleted`]} />
            <Counts items={[
              ['Create', counts.create || 0, counts.create ? 'g' : ''],
              ['Update', counts.update || 0, '', 'changed fields only'],
              ['Unchanged', counts.unchanged || 0, '', 'not written'],
              ['Resolve', counts.resolve || 0, counts.resolve ? 'a' : '', counts.skip ? `${counts.skip} skipped` : ''],
            ]} />
            <details className="mb-3 text-[12.5px]">
              <summary className="cursor-pointer font-semibold">Column mapping · header row 1{preview.mapping.uid_column ? ` · uid in column ${preview.mapping.uid_column}` : ''}</summary>
              <table className="mt-2 w-full text-left text-[12px]">
                <thead><tr className={MUTED}><th scope="col" className="py-1 pr-3">Col</th><th scope="col" className="py-1 pr-3">Sheet header</th><th scope="col" className="py-1">Field</th></tr></thead>
                <tbody>
                  {preview.mapping.columns.map((c) => (
                    <tr key={c.column} className="border-t border-axal-hairline dark:border-gray-800">
                      <th scope="row" className="py-1 pr-3 font-mono">{c.column}</th>
                      <td className="py-1 pr-3">{c.header || <span className={MUTED}>blank</span>}{c.private ? <span className="ml-1.5"><Pill tone="warn">Private</Pill></span> : null}</td>
                      <td className="py-1">{c.field ? FIELD_LABEL[c.field] : <span className={MUTED}>not read</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.mapping.uid_column ? <p className={`mt-1 ${MUTED}`}>Identifiers for new rows are written to column {preview.mapping.uid_column}, where the uid header is now.</p> : null}
            </details>
            <div className="mb-2 flex gap-2" role="group" aria-label="Rows to show">
              <Action primary={show === 'look'} onClick={() => setShow('look')}>Needs a look · {(preview.rows || []).filter((r) => r.action !== 'unchanged').length}</Action>
              <Action primary={show === 'all'} onClick={() => setShow('all')}>All {counts.rows} rows</Action>
            </div>
            <div className="overflow-x-auto max-sm:hidden">
              <table className="w-full text-left text-[12px]">
                <thead><tr className={MUTED}><th scope="col" className="py-1 pr-3">Sheet row</th><th scope="col" className="py-1 pr-3">Action</th><th scope="col" className="py-1 pr-3">Fund</th><th scope="col" className="py-1">What changes</th></tr></thead>
                <tbody>{rows.map((r) => <PreviewRow key={r.row} r={r} uidColumn={preview.mapping.uid_column} onResolve={resolve} />)}</tbody>
              </table>
            </div>
            <ul className="grid gap-2 sm:hidden">
              {rows.map((r) => (
                <li key={r.row} className="rounded-xl border border-axal-hairline p-3 text-[12.5px] dark:border-gray-800">
                  <div className="flex items-center gap-2"><span className="font-mono">Row {r.row}</span><ActionPill action={r.action} /><span className="font-semibold">{r.name || '—'}</span></div>
                  <RowDetail r={r} uidColumn={preview.mapping.uid_column} onResolve={resolve} />
                </li>
              ))}
            </ul>
            <p className={`mt-2 text-[11.5px] ${MUTED}`}>
              Row numbers are the sheet’s own. A blank row is shown, not removed, so later rows are not renumbered.
              {preview.not_on_sheet ? ` ${preview.not_on_sheet} funds in Axal are not on the sheet; they are kept.` : ''}
              {counts.resolve ? ' Resolve rows are not imported until you choose.' : ''}
            </p>
          </>
        ) : null}
        {step === 2 && run ? <RunResult headRef={head} run={run} label="Import" /> : null}
      </div>
    </Sheet>
  );
}

function ActionPill({ action }) {
  const tone = { create: 'ok', update: 'info', resolve: 'warn', skip: 'neutral', unchanged: 'neutral', blank: 'neutral' }[action] || 'neutral';
  return <Pill tone={tone}>{ACTION_LABEL[action] || action}</Pill>;
}

const shown = (v) => (v === null || v === undefined || v === '' ? 'blank' : String(v));

function RowDetail({ r, uidColumn, onResolve }) {
  return (
    <div className="mt-1">
      {r.action === 'create' && r.uid_cell ? <div className={MUTED}>new · id to {r.uid_cell}</div> : null}
      {r.changes.length && r.action !== 'create' ? (
        <ul>
          {r.changes.map((ch) => (
            <li key={ch.field}>{FIELD_LABEL[ch.field]} {ch.private ? <Pill tone="warn">Private</Pill> : null} {shown(ch.from)} → {shown(ch.to)}</li>
          ))}
        </ul>
      ) : null}
      {r.note ? <div className={MUTED}>{r.note}</div> : null}
      {r.resolve && r.resolve.options.includes('keep_axal') ? (
        <fieldset className="mt-1 flex flex-wrap gap-3">
          <legend className="sr-only">Resolve row {r.row}</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name={`rfg-res-${r.row}`} checked={r.resolution === 'keep_axal'} onChange={() => onResolve(r.row, 'keep_axal')} /> Keep Axal’s value</label>
          <label className="flex items-center gap-1.5"><input type="radio" name={`rfg-res-${r.row}`} checked={r.resolution === 'skip'} onChange={() => onResolve(r.row, 'skip')} /> Skip row {r.row}</label>
        </fieldset>
      ) : null}
      {r.resolve?.kind === 'foreign_uid' && uidColumn ? <div className={MUTED}>Clear {uidColumn}{r.row} on the sheet to import it as a new fund next time.</div> : null}
    </div>
  );
}

function PreviewRow({ r, uidColumn, onResolve }) {
  return (
    <tr className="border-t border-axal-hairline align-top dark:border-gray-800">
      <th scope="row" className="py-1.5 pr-3 font-mono">{r.row}</th>
      <td className="py-1.5 pr-3"><ActionPill action={r.action} /></td>
      <td className="py-1.5 pr-3 font-semibold">{r.name || '—'}</td>
      <td className="py-1.5"><RowDetail r={r} uidColumn={uidColumn} onResolve={onResolve} /></td>
    </tr>
  );
}

// ── Reconcile (FND-G06, FND-G06C) ───────────────────────────────────────────

export function ReconcileFlow({ run: initial, onClose, onDone }) {
  const [run, setRun] = useState(initial);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const head = useStepFocus(checked ? 1 : 0);
  const c = run?.counts || {};
  const empty = (run?.pending || []).filter((p) => p.state === 'empty' || !p.state).length;

  const act = async (write) => {
    setBusy(write ? 'write' : 'check'); setError(null);
    try {
      const r = await sheetsApi.reconcile(run.uid, write);
      setRun(r.run); setChecked(true); onDone();
    } catch (e) { setError(errText(e, 'The sheet could not be read. Nothing was written.')); } finally { setBusy(null); }
  };

  const done = run?.status === 'complete' || run?.status === 'partial';
  return (
    <Sheet
      eyebrow="Import · result" title={done ? `Import: ${resultLabel(run)?.text}` : 'Import: outcome uncertain'}
      onClose={onClose} width={640} phone="sheet" testId="rfg-reconcile" initialFocus={head}
      footer={(
        <Footer left={<span className={`text-[11.5px] ${MUTED}`}>Run {run?.uid} · {utcStamp(run?.created_at)}</span>}>
          <Action onClick={onClose}>Close</Action>
          {!done ? (
            checked && empty ? (
              <Action primary off={busy ? 'Writing…' : null} onClick={() => act(true)}>{busy === 'write' ? 'Writing…' : `Write ${empty} missing ${empty === 1 ? 'identifier' : 'identifiers'}`}</Action>
            ) : (
              <Action primary off={busy ? 'Reading…' : null} onClick={() => act(false)}>{busy === 'check' ? 'Reading…' : 'Check the sheet'}</Action>
            )
          ) : null}
        </Footer>
      )}
    >
      <div className="px-5 py-4">
        <Steps current={2} />
        <LiveRegions ann={announcement(run)} />
        <Problem error={error} />
        <StepHeading headRef={head}>{checked ? 'Check the sheet' : 'What is confirmed'}</StepHeading>
        <div className="mb-3"><ResultChip run={run} /></div>
        {run?.detail ? <p className="mb-3 text-[12.5px]">{run.detail}</p> : null}
        <div className="mb-3 grid gap-3 text-[12.5px] sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 p-3 dark:border-emerald-800">
            <div className={LABEL}>Confirmed</div>
            <p>Axal · {c.created ?? 0} created, {c.updated ?? 0} updated · read back</p>
            <p>Nothing deleted</p>
          </div>
          <div className="rounded-xl border border-amber-200 p-3 dark:border-amber-800">
            <div className={LABEL}>Not confirmed</div>
            <p>Sheet identifiers {(run?.pending || []).map((p) => p.cell).join(', ')} · {c.ids_confirmed ?? 0} of {c.ids_expected ?? (run?.pending || []).length} confirmed</p>
          </div>
        </div>
        {!done ? (
          <p className="mb-3 text-[12.5px]">
            Check the sheet: read {(run?.pending || []).map((p) => p.cell).join(', ')} and compare with the new funds. Write only the identifiers that are missing.
            Import becomes available again when every row has one. <strong>Retry is off until then.</strong> Importing now would create these funds a second time.
          </p>
        ) : null}
        {checked ? (
          <table className="w-full text-left text-[12px]">
            <thead><tr className={MUTED}><th scope="col" className="py-1 pr-3">Cell</th><th scope="col" className="py-1 pr-3">Fund</th><th scope="col" className="py-1">On the sheet</th></tr></thead>
            <tbody>
              {(run?.pending || []).map((p) => (
                <tr key={p.cell} className="border-t border-axal-hairline dark:border-gray-800">
                  <th scope="row" className="py-1 pr-3 font-mono">{p.cell}</th>
                  <td className="py-1 pr-3">{p.name}</td>
                  <td className="py-1">
                    {p.state === 'matches' ? <Pill tone="ok">matches</Pill> : p.state === 'differs' ? <Pill tone="warn">holds something else · left alone</Pill> : <Pill tone="neutral">Empty</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </Sheet>
  );
}

// ── The card (FND-G01, FND-G05) ─────────────────────────────────────────────

function LastResult({ direction, run }) {
  if (!run) return null;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span aria-hidden="true">{direction === 'export' ? '↗' : '↙'}</span>
      <span className="font-semibold">{direction === 'export' ? 'Export' : 'Import'} · {utcStamp(run.updated_at || run.created_at)}</span>
      <span className={MUTED}>{runCounts(run)}</span>
      <ResultChip run={run} />
    </li>
  );
}

/** `initialStatus` draws a status the page already holds (a server render, a test) before the read answers. */
export default function SheetsSyncCard({ initialStatus = null } = {}) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(!initialStatus);
  const [failed, setFailed] = useState(null);
  const [flow, setFlow] = useState(null);
  const [note, setNote] = useState(null);
  const headingRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setStatus(await sheetsApi.status());
      setFailed(null);
    } catch {
      setFailed(new Date().toISOString());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Back from Google consent: say what happened, drop the flag from the URL,
  // and put focus on the card so the sentence is read next.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const flash = params.get('sheets');
    if (!flash) return;
    if (flash === 'connected') setNote({ role: 'status', text: 'Google Sheets connected.' });
    else setNote({ role: 'alert', text: `Google Sheets did not connect (${params.get('reason') || 'callback_failed'}).` });
    params.delete('sheets');
    params.delete('reason');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
    headingRef.current?.focus?.();
  }, []);

  const state = cardState(status, { loading, failed: !!failed });
  const primary = primaryAction(state);
  const closeFlow = () => {
    setFlow(null);
    load();
    // From a result, focus goes to the card's heading so the new last-result line is read next.
    if (typeof window !== 'undefined') window.requestAnimationFrame?.(() => headingRef.current?.focus?.());
  };

  const connect = async () => {
    setNote(null);
    try {
      const r = await sheetsApi.connect();
      const href = r?.redirect_url || r?.auth_url;
      if (!href) throw new Error('Google did not return a consent URL.');
      window.location.assign(href);
    } catch (e) {
      setNote({ role: 'alert', text: e?.code === 'oauth_config_missing' ? 'Google Sheets is not configured on this server yet.' : errText(e, 'Google Sheets did not open.') });
    }
  };
  const disconnect = async () => {
    try { await sheetsApi.disconnect(); setNote({ role: 'status', text: 'Google Sheets disconnected.' }); load(); } catch (e) {
      setNote({ role: 'alert', text: errText(e, 'Google Sheets did not disconnect.') });
    }
  };

  const exportOff = state === 'ready' || state === 'pending' ? null : disabledReason(state, 'export') || 'Off.';
  const importOff = state === 'ready' ? null : disabledReason(state, 'import') || 'Off.';
  const runs = status?.last_runs || {};
  const href = sheetHref(status);
  const lines = whatCanRun(state, status);

  return (
    <Card padding="lg" data-testid="rfg-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-sm font-extrabold tracking-tight outline-none">Google Sheets</h3>
        <Pill tone="info">Super admin only</Pill>
      </div>
      <p className={`mt-1 text-[12px] ${MUTED}`}>A copy of My funds. Axal stays the record.</p>
      <div role="status" aria-live="polite" aria-atomic="true" className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">{note?.role === 'status' ? note.text : ''}</div>
      <div role="alert" aria-atomic="true" className="text-[12px] font-semibold text-red-700 dark:text-red-300">
        {note?.role === 'alert' ? note.text : state === 'tab_missing' ? `The linked tab ${status?.sheet_title || ''} is no longer in the workbook. Choose a tab.` : ''}
      </div>

      <div className="mt-2">
        <Section label="Connection">
          {state === 'loading' ? <span className={MUTED}>Checking the connection…</span> : null}
          {state === 'unavailable' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="neutral">Unavailable · status did not load</Pill>
              <span className={MUTED}>We could not read the Sheets status at {utcStamp(failed)}. This says nothing about whether the sheet changed.</span>
              <Action onClick={() => { setLoading(true); load(); }}>Try again</Action>
            </div>
          ) : null}
          {state === 'unconfigured' ? (
            <div>
              <Pill tone="neutral">Unavailable · integration not configured</Pill>
              <p className="mt-1.5">
                Google Sheets is not configured on this server yet.{status?.missing?.length ? ` Missing: ${status.missing.join(', ')}.` : ''} Your funds are unaffected; export a CSV from the toolbar meanwhile.
              </p>
            </div>
          ) : null}
          {state === 'disconnected' ? (
            <div>
              <Pill tone="neutral">Not connected</Pill>
              <p className={`mt-1.5 ${MUTED}`}>Connect the Google account that can edit the workbook. Axal asks Google for spreadsheet access only.</p>
            </div>
          ) : null}
          {status?.connected && !['loading', 'unavailable', 'unconfigured'].includes(state) ? (
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="ok">Connected</Pill>
              {status.google_email ? <span className="font-mono text-[12px]">{status.google_email}</span> : null}
              <button type="button" className={LINK} onClick={disconnect}>Disconnect</button>
            </div>
          ) : null}
        </Section>

        {!['loading', 'unavailable', 'unconfigured'].includes(state) ? (
          <Section label="Destination">
            {!status?.spreadsheet_id ? <span className={MUTED}>No workbook linked yet.</span> : (
              <div>
                <div className="font-semibold">{status.workbook_title || 'Linked workbook'}</div>
                {state === 'tab_missing' ? (
                  <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    Tab “{status.sheet_title || 'unnamed'}” · gid {status.sheet_gid} · not in the workbook. Checked {utcStamp(status.tab_checked_at)}.
                    No destination is confirmed. Nothing will be written to another tab.
                  </div>
                ) : (
                  <div className={MUTED}>
                    Tab “{status.sheet_title || 'unnamed'}” · gid {status.sheet_gid}
                    {status.tab_state === 'unknown' ? ' · not checked: Google did not answer' : ''}
                    <br />Managed range ‘{status.sheet_title || 'tab'}’!A:K · row 1 headers
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {href ? <a className={LINK} href={href} target="_blank" rel="noreferrer">Open in Google Sheets ↗</a> : null}
                  {state !== 'tab_missing' && status.connected ? <button type="button" className={LINK} onClick={() => setFlow({ kind: 'destination' })}>Change destination</button> : null}
                </div>
              </div>
            )}
          </Section>
        ) : null}

        {!['loading', 'unavailable', 'unconfigured'].includes(state) ? (
          <Section label={state === 'pending' ? 'Last result' : 'Last confirmed result'}>
            {runs.export || runs.import ? (
              <ul className="grid gap-1.5">
                <LastResult direction="export" run={runs.export} />
                <LastResult direction="import" run={runs.import} />
              </ul>
            ) : <Pill tone="neutral">Not applicable · nothing has run</Pill>}
          </Section>
        ) : null}

        {lines.length ? (
          <Section label="What can run">
            <ul className="grid gap-1">
              {lines.map((l) => (
                <li key={l.label} className="flex gap-2">
                  <span aria-hidden="true" className={l.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>{l.ok ? '✓' : '✕'}</span>
                  <span><span className="font-semibold">{l.label}</span> <span className={MUTED}>{l.text}</span></span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {state === 'disconnected' ? (
          <ol className={`mb-3 grid gap-1 text-[12px] sm:grid-cols-3 ${MUTED}`}>
            <li>1 Connect Google</li><li>2 Choose workbook and tab</li><li>3 Review the first export or import</li>
          </ol>
        ) : null}
      </div>

      {state === 'unconfigured' ? null : (
        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800 max-sm:flex-col max-sm:items-stretch">
          {primary === 'connect' ? <Action primary onClick={connect}>Connect Google Sheets</Action> : null}
          {primary === 'destination' ? <Action primary onClick={() => setFlow({ kind: 'destination' })}>{state === 'tab_missing' ? 'Choose a tab' : 'Choose workbook and tab'}</Action> : null}
          {primary === 'reconcile' ? <Action primary onClick={() => setFlow({ kind: 'reconcile', run: status.open_run })}>Reconcile the import</Action> : null}
          {state !== 'disconnected' ? (
            <>
              <Action primary={primary === 'export'} off={exportOff} onClick={() => setFlow({ kind: 'export' })} testid="rfg-export-open">{EXPORT_LABEL}</Action>
              <Action off={importOff} onClick={() => setFlow({ kind: 'import' })} testid="rfg-import-open">{IMPORT_LABEL}</Action>
            </>
          ) : null}
          <span className={`text-[11.5px] ${MUTED}`}>
            {state === 'ready' ? 'Nothing transfers until you review it and confirm.'
              : state === 'disconnected' ? 'Opens Google’s consent screen and returns here.'
                : state === 'pending' ? `Import: ${disabledReason(state, 'import')}${status?.open_run?.pending?.length ? ` Rows ${listRows(status.open_run.pending.filter((p) => p.state !== 'matches').map((p) => p.row))}.` : ''}`
                  : disabledReason(state, 'export')}
          </span>
        </div>
      )}
      {state === 'unconfigured' ? <p className={`mt-2 text-[11.5px] ${MUTED}`}>{EXPORT_LABEL} and {IMPORT_LABEL} stay off until the integration is configured.</p> : null}

      {flow?.kind === 'destination' ? <DestinationFlow status={status} onClose={closeFlow} onSaved={closeFlow} /> : null}
      {flow?.kind === 'export' ? <ExportFlow status={status} onClose={closeFlow} onDone={load} /> : null}
      {flow?.kind === 'import' ? <ImportFlow status={status} onClose={closeFlow} onDone={load} /> : null}
      {/* The run is held by the flow, so the Sheet stays open on its result after status stops listing it as open. */}
      {flow?.kind === 'reconcile' && flow.run ? <ReconcileFlow run={flow.run} onClose={closeFlow} onDone={load} /> : null}
    </Card>
  );
}
