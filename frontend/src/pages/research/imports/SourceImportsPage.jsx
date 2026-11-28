/**
 * D7753 (#7753) — `/research/source-imports`: runs and sources (FND-I01), and a new run in the shared Sheet: choose a
 * file and check it, class its columns, preview (FND-I02), apply in batches (FND-I03), result and Reconcile (FND-I04).
 *
 * The file is read in this browser and held in memory only, for as long as this page is open: never in storage, never
 * in an address. Counts, record ids, digests, states and reason codes are drawn; no record's value is. Every failure
 * reads as a fixed sentence (`importRun.js`); a 403 draws the existing Super Admin only notice.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, DataState, Unrecorded } from '../../../ui';
import { researchSourceImportsApi } from '../../../lib/api/researchSourceImports.js';
import { reportError } from '../../../lib/log';
import { useLeaveGuard } from '../../../lib/leaveGuard';
import { resultLabel } from '../sheetsSyncModel';
import SuperAdminOnlyNotice from '../../hq/SuperAdminOnlyNotice';
import {
  CLASS_LABEL, COLUMN_CLASSES, SENTENCES, announcement, buildPlan, checkSummary, createRun, emptyClasses, failureKind,
  missingClass, openRunOf, outcomesLine, phaseLabel, problemSentence, readPackage, shortUid, storedCount,
} from './importRun';
import { ConsoleHeader, Crumb, Digest, Panel, ResultChip, Table, btn, foot, linkCls, mono, primaryBtn, utcStamp } from './consoleKit';

const RUNNING = ['opening', 'sending', 'waiting', 'step_up', 'sealing', 'reading', 'reconciling'];
const STEPS = ['Scope · file and check', 'Review · preview', 'Apply', 'Result'];
const LEAVE = 'Leave while the run is going? The run stops after the batch in flight, and the batches sent stay stored. Resume later with the same file.';
/** Anything unexpected is reported by a fixed sentence under one scope; never the error's own text. */
const report = () => reportError('researchSourceImports:run', new Error(SENTENCES.unexpected()));

/** The runs list's read: loading, ok, unavailable (a failed read, never an empty list) or refused (a 403). */
function useRuns() {
  const [read, setRead] = useState({ state: 'loading', runs: [] });
  const load = useCallback(async () => {
    setRead((r) => ({ ...r, state: 'loading' }));
    try {
      const answer = await researchSourceImportsApi.runs();
      setRead({ state: 'ok', runs: Array.isArray(answer?.runs) ? answer.runs : [] });
    } catch (e) {
      setRead({ state: failureKind(e) === 'refused' ? 'refused' : 'unavailable', runs: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return [read, load];
}

export default function SourceImportsPage() {
  const [runsRead, reloadRuns] = useRuns();
  const [open, setOpen] = useState(false);
  const chooser = useRef(null);
  const opener = useRef(null);
  const [refused, setRefused] = useState(false);

  if (refused || runsRead.state === 'refused') return <SuperAdminOnlyNotice />;
  const openRun = openRunOf(runsRead.runs);

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-4 px-4 py-6 sm:px-6" data-testid="source-imports">
      <Crumb />
      <ConsoleHeader action={(
        <button ref={opener} type="button" className={primaryBtn} onClick={() => setOpen(true)}>Choose a file</button>
      )} />
      {openRun ? (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-axal-ink dark:border-amber-800 dark:bg-amber-900/20 dark:text-gray-100" data-testid="source-imports-open-run">
          Run <Link className={`${linkCls} ${mono}`} to={`/research/source-imports/runs/${encodeURIComponent(openRun.uid)}`}>{shortUid(openRun.uid)}</Link> is {resultLabel(openRun)?.text ?? openRun.status}. A new run waits until it is settled: choose the same file to resume it, or open the run.
        </p>
      ) : null}

      <Panel title="Everything staged · five outcomes">
        <p className="text-[13px] text-axal-ink dark:text-gray-100">
          <Unrecorded reason="Counted once source records are reviewed and decided, which is not built yet" reasonVisible />
        </p>
        <p className={`mt-2 ${foot}`}>Counts are of source records, not funds. The same organisation can appear in more than one source.</p>
      </Panel>

      <Panel title="Runs · newest first" testId="source-imports-runs">
        <RunsList read={runsRead} onRetry={reloadRuns} />
      </Panel>

      {open ? (
        <NewRun
          chooser={chooser}
          returnFocusTo={opener}
          onClose={() => { setOpen(false); reloadRuns(); }}
          onRefused={() => setRefused(true)}
        />
      ) : null}
    </div>
  );
}

function RunsList({ read, onRetry }) {
  if (read.state === 'loading') {
    return (
      <div className="grid gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => <span key={i} className="block h-4 w-full animate-pulse rounded bg-axal-ground dark:bg-gray-800" />)}
        <p role="status" className={foot}>Loading runs…</p>
      </div>
    );
  }
  if (read.state === 'unavailable') {
    return <DataState state="unavailable" what="Runs" claim="This is not a claim that no run exists." onRetry={onRetry} retryLabel="Try again" announce="always" />;
  }
  if (!read.runs.length) {
    return (
      <div className="py-4 text-center" data-testid="source-imports-empty">
        <h3 className="text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Nothing is staged yet</h3>
        <p className="mx-auto mt-1 max-w-[560px] text-[13px] text-axal-muted dark:text-gray-400">
          A file must hold, per source, its records exactly as captured, its columns in source order, a record id per row and a manifest of counts and row hashes. Nothing is written until you review the preview and press Apply.
        </p>
      </div>
    );
  }
  const rows = read.runs.map((r) => ({
    key: r.uid,
    run: <Link className={`${linkCls} ${mono}`} to={`/research/source-imports/runs/${encodeURIComponent(r.uid)}`}>{shortUid(r.uid)}</Link>,
    started: <span className={mono}>{utcStamp(r.started_at) || 'Not recorded'}</span>,
    who: r.acted_by_user_id == null ? <Unrecorded /> : `User ${r.acted_by_user_id}`,
    status: <ResultChip label={resultLabel(r)} />,
    stored: storedCount(r) ?? <Unrecorded />,
    outcomes: outcomesLine(r) ?? <Unrecorded />,
  }));
  return (
    <Table
      caption="Runs, newest first"
      testId="source-imports-runs-table"
      columns={[
        { key: 'run', label: 'Run' }, { key: 'started', label: 'Started (UTC)' }, { key: 'who', label: 'Who' },
        { key: 'status', label: 'Status' }, { key: 'stored', label: '# Stored', num: true },
        { key: 'outcomes', label: 'New · unchanged · changed · refused' },
      ]}
      rows={rows}
    />
  );
}

/* ------------------------------------------------------------------ a new run, in the Sheet */

function Steps({ at }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className={i === at ? 'font-bold text-axal-violet dark:text-violet-300' : i < at ? 'text-axal-ink dark:text-gray-200' : 'text-axal-muted dark:text-gray-400'}>
          <span className={mono}>{i < at ? '✓' : i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}

function NewRun({ chooser, returnFocusTo, onClose, onRefused }) {
  // The file and its plan live here, in memory, and go when the Sheet closes.
  const pkgRef = useRef(null);
  const planRef = useRef(null);
  const runRef = useRef(null);
  const stepUp = useRef(null);
  const [checked, setChecked] = useState(null);     // { size, sha256, summary, columns }
  const [problem, setProblem] = useState(null);
  const [reading, setReading] = useState(false);
  const [classes, setClasses] = useState(null);
  const [state, setState] = useState(null);
  const [planInfo, setPlanInfo] = useState(null);   // counts only

  const busy = state && RUNNING.includes(state.phase);
  useLeaveGuard(Boolean(busy), LEAVE);
  useEffect(() => () => { runRef.current?.stop(); pkgRef.current = null; planRef.current = null; }, []);
  useEffect(() => { if (state?.phase === 'refused') onRefused(); }, [state?.phase, onRefused]);

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProblem(null); setChecked(null); setState(null); setPlanInfo(null);
    pkgRef.current = null; planRef.current = null; runRef.current = null;
    setReading(true);
    try {
      const pkg = await readPackage(await file.arrayBuffer());
      pkgRef.current = pkg;
      setChecked({ size: pkg.size, sha256: pkg.sha256, summary: checkSummary(pkg), columns: pkg.sources.map((s) => ({ source_key: s.source_key, columns: s.columns })) });
      setClasses(emptyClasses(pkg));
    } catch (err) {
      setProblem(problemSentence(err));
    } finally {
      setReading(false);
    }
  };

  const gap = checked && classes ? missingClass(pkgRef.current, classes) : null;

  const startRun = (plan) => createRun({
    plan,
    transport: researchSourceImportsApi,
    onChange: setState,
    report,
    confirmStepUp: () => new Promise((resolve) => { stepUp.current = resolve; }),
  });

  const preview = async () => {
    if (!pkgRef.current || gap) return;
    try {
      const plan = await buildPlan(pkgRef.current, classes);
      planRef.current = plan;
      setPlanInfo({
        records: plan.entries.length, chunks: plan.chunks.length,
        sources: plan.sources.map((s) => ({ source_key: s.source_key, sent: s.sent, persons: s.persons + s.declared_excluded, contact: s.contact_columns, withheld: s.withheld_cells })),
      });
      runRef.current = startRun(plan);
      await runRef.current.preview();
    } catch (err) {
      setProblem(problemSentence(err));
    }
  };

  const apply = () => runRef.current?.apply();
  const reconcile = () => runRef.current?.reconcile();
  const confirm = () => { const r = stepUp.current; stepUp.current = null; r?.(); };

  const phase = state?.phase ?? null;
  const step = !phase || phase === 'idle' ? 0
    : ['previewing', 'previewed', 'preview_failed'].includes(phase) ? 1
      : RUNNING.includes(phase) || phase === 'stopped' ? 2 : 3;
  const said = announcement(state);
  const title = step === 3 && phase === 'complete' && planInfo ? `Run complete: ${planInfo.records.toLocaleString('en-US')} records stored and read back`
    : step === 2 && planInfo ? `Applying ${planInfo.records.toLocaleString('en-US')} records · batch ${Math.min((state?.chunks_done ?? 0) + 1, state?.chunks_total ?? 0)} of ${state?.chunks_total ?? 0}`
      : step === 1 && planInfo ? `Review: apply ${planInfo.records.toLocaleString('en-US')} records from ${planInfo.sources.length} sources`
        : 'Choose a file';

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className={foot}>{step < 2 ? 'Nothing has been written.' : state?.run_uid ? <>Run <span className={mono}>{shortUid(state.run_uid)}</span></> : null}</span>
      <span className="flex flex-wrap gap-2">
        {step === 2 && phase !== 'stopped' ? <button type="button" className={btn} onClick={() => runRef.current?.stop()}>Pause after this batch</button> : null}
        {!busy ? <button type="button" className={btn} onClick={onClose}>{step === 3 ? 'Close' : 'Cancel'}</button> : null}
        {step === 0 ? (
          <button type="button" className={primaryBtn} aria-disabled={!checked || Boolean(gap)} onClick={() => { if (checked && !gap) preview(); }}>Preview</button>
        ) : null}
        {phase === 'previewed' && !state.preview?.all_unchanged ? (
          <button type="button" className={primaryBtn} onClick={apply}>Apply {planInfo?.records.toLocaleString('en-US')} records</button>
        ) : null}
        {phase === 'stopped' ? <button type="button" className={primaryBtn} onClick={apply}>Resume with the same file</button> : null}
        {phase === 'uncertain' ? <button type="button" className={primaryBtn} onClick={reconcile}>Reconcile</button> : null}
        {phase === 'partial' ? <button type="button" className={primaryBtn} onClick={reconcile}>Apply again</button> : null}
        {phase === 'complete' && state?.run_uid ? <Link className={primaryBtn} to={`/research/source-imports/runs/${encodeURIComponent(state.run_uid)}`}>Open the run</Link> : null}
      </span>
    </div>
  );

  return (
    <Sheet title={title} eyebrow="Source imports · new run" width={760} onClose={busy ? () => {} : onClose} returnFocusTo={returnFocusTo} footer={footer} testId="source-imports-run-sheet">
      <div className="grid gap-4 px-5 py-4">
        <Steps at={step} />
        <div aria-live="polite" role="status" className="sr-only">{said?.role === 'status' ? said.text : ''}</div>
        <div aria-live="assertive" role="alert" className="sr-only">{said?.role === 'alert' ? said.text : ''}</div>

        {step === 0 ? (
          <FileStep chooser={chooser} reading={reading} choose={choose} problem={problem} checked={checked} classes={classes} setClasses={setClasses} gap={gap} />
        ) : null}
        {step === 1 ? <ReviewStep state={state} planInfo={planInfo} checked={checked} onRetry={preview} /> : null}
        {step === 2 ? <ApplyStep state={state} planInfo={planInfo} onConfirm={confirm} /> : null}
        {step === 3 ? <ResultStep state={state} planInfo={planInfo} /> : null}
      </div>
    </Sheet>
  );
}

function FileStep({ chooser, reading, choose, problem, checked, classes, setClasses, gap }) {
  return (
    <>
      <section className="grid gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">The chosen file</h3>
          <label className={btn}>
            {checked ? 'Choose another file' : 'Choose a file'}
            <input ref={chooser} type="file" accept="application/json,.json" className="sr-only" onChange={choose} data-testid="source-imports-file" />
          </label>
        </div>
        {reading ? <p role="status" className={foot}>Reading and checking the file in this browser…</p> : null}
        {problem ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200" data-testid="source-imports-problem">
            <p className="font-bold">Check failed</p>
            <p>{problem}</p>
            <p className="mt-1 text-[12px]">No Apply is offered. Nothing has been written.</p>
          </div>
        ) : null}
        {checked ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className={foot}>Size</dt><dd className={mono}>{checked.size.toLocaleString('en-US')} bytes</dd>
            <dt className={foot}>SHA-256</dt><dd className={`${mono} break-all`}>{checked.sha256}</dd>
          </dl>
        ) : null}
        <p className={foot}>Worked out in this browser. The file is never sent whole and never kept in the browser.</p>
      </section>

      {checked ? (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Manifest check · the file against its own manifest</h3>
          <Table
            caption="Manifest check"
            testId="source-imports-manifest"
            columns={[
              { key: 'source', label: 'Source' }, { key: 'records', label: '# Records', num: true }, { key: 'columns', label: '# Columns', num: true },
              { key: 'persons', label: '# About people · left out', num: true }, { key: 'digest', label: 'List digest' }, { key: 'rows', label: 'Row hashes' },
            ]}
            rows={checked.summary.map((s) => ({ key: s.source_key, source: s.source_key, records: s.records, columns: s.columns, persons: s.persons, digest: 'Matches', rows: 'Declared, not checked' }))}
          />
          <p className={foot}>Records and the list digest per source, as the manifest declares and as counted here. No package hash recipe is registered, so each row hash is kept as declared and not checked.</p>
        </section>
      ) : null}

      {checked && classes ? (
        <section className="grid gap-3">
          <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Column classes · set once per source</h3>
          {checked.columns.map((s) => (
            <fieldset key={s.source_key} className="grid gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
              <legend className="px-1 text-[12px] font-bold text-axal-ink dark:text-gray-100">{s.source_key} · {s.columns.length} columns</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {s.columns.map((c) => (
                  <label key={c} className="grid gap-1 text-[12px] text-axal-ink dark:text-gray-100">
                    <span className="truncate font-semibold" title={c}>{c}</span>
                    <select
                      className="min-h-[44px] rounded-[9px] border border-axal-hairline bg-white px-2 text-[13px] dark:border-gray-700 dark:bg-gray-900"
                      value={classes[s.source_key][c] ?? ''}
                      onChange={(e) => setClasses((all) => ({ ...all, [s.source_key]: { ...all[s.source_key], [c]: e.target.value || null } }))}
                    >
                      <option value="">No class</option>
                      {COLUMN_CLASSES.map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className={foot}>A contact column, a personal profile link included, is withheld: left out of what is sent and only counted. A source's classes are fixed by its first run; a later run must set them the same.</p>
          {gap ? <p className="text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="source-imports-gap">{SENTENCES.class_missing(gap)}</p> : null}
        </section>
      ) : null}
    </>
  );
}

function ReviewStep({ state, planInfo, checked, onRetry }) {
  if (!state || state.phase === 'previewing') return <p role="status" className={foot}>Previewing against what is staged now…</p>;
  if (state.phase === 'preview_failed') {
    return <DataState state="unavailable" what="The preview" claim={state.sentence ?? 'Nothing was written.'} onRetry={onRetry} retryLabel="Try again" announce="always" />;
  }
  const p = state.preview;
  const withheld = planInfo.sources.reduce((a, s) => a + s.withheld, 0);
  const persons = planInfo.sources.reduce((a, s) => a + s.persons, 0);
  return (
    <>
      {p.all_unchanged ? (
        <div role="status" className="rounded-lg border border-axal-hairline p-3 text-[13px] dark:border-gray-700" data-testid="source-imports-unchanged">
          <p className="font-bold text-axal-ink dark:text-gray-100">Every record unchanged.</p>
          <p className="text-axal-muted dark:text-gray-400">SHA-256 <Digest value={checked?.sha256} /> holds nothing the store does not already hold. Nothing to apply. Nothing has been written.</p>
        </div>
      ) : null}
      <section className="grid gap-2">
        <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Preview · against what is staged now</h3>
        <Table
          caption="Preview"
          testId="source-imports-preview"
          columns={[
            { key: 'source', label: 'Source' }, { key: 'new', label: '# New', num: true }, { key: 'unchanged', label: '# Unchanged', num: true },
            { key: 'changed', label: '# Changed', num: true }, { key: 'removed', label: '# Removed', num: true }, { key: 'sent', label: '# Records sent', num: true },
          ]}
          rows={p.sources.map((s) => ({ key: s.source_key, source: s.source_key, new: s.new, unchanged: s.unchanged, changed: s.changed, removed: s.removed, sent: s.sent }))}
          total={{ source: 'All', ...['new', 'unchanged', 'changed', 'removed', 'sent'].reduce((a, k) => ({ ...a, [k]: p.sources.reduce((x, s) => x + s[k], 0) }), {}) }}
        />
        <p className={foot}>A preview writes nothing. Removed records arrive as removed and are refused.</p>
      </section>
      <section className="grid gap-2">
        <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Left out before upload</h3>
        <Table
          caption="Left out before upload"
          columns={[{ key: 'source', label: 'Source' }, { key: 'contact', label: '# Contact columns', num: true }, { key: 'withheld', label: '# Cells withheld', num: true }, { key: 'persons', label: '# Records about people', num: true }]}
          rows={planInfo.sources.map((s) => ({ key: s.source_key, source: s.source_key, contact: s.contact, withheld: s.withheld, persons: s.persons }))}
        />
      </section>
      {!p.all_unchanged ? (
        <p className="rounded-lg bg-axal-ground p-3 text-[13px] text-axal-ink dark:bg-gray-800 dark:text-gray-100">
          <b>Nothing has been written.</b> Apply sends {planInfo.records.toLocaleString('en-US')} records in {planInfo.chunks} batches of 50 at most, then reads every record back. Not sent: {withheld.toLocaleString('en-US')} contact {withheld === 1 ? 'cell' : 'cells'} and {persons} {persons === 1 ? 'record' : 'records'} about people.
        </p>
      ) : null}
    </>
  );
}

function ApplyStep({ state, planInfo, onConfirm }) {
  const done = state?.chunks_done ?? 0;
  const total = state?.chunks_total ?? planInfo?.chunks ?? 0;
  return (
    <>
      <div className="grid gap-1">
        <ResultChip label={phaseLabel(state)} />
        {state?.phase === 'waiting' ? <p className="text-[13px] text-axal-ink dark:text-gray-100">The Worker allows 60 requests a minute. Continuing in {Math.ceil((state.wait_ms || 0) / 1000)} s. A wait is never a failure.</p> : null}
        {state?.phase === 'stopped' ? <p className="text-[13px] text-axal-ink dark:text-gray-100">Batches 1–{done} are stored. Resume with the same file sends only the batches the Worker does not hold.</p> : null}
      </div>
      {state?.phase === 'step_up' ? (
        <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-[13px] text-axal-ink dark:text-gray-100">Your step-up has lapsed. Batches 1–{done} are stored. Nothing is written while you confirm, and the run continues from batch {done + 1}.</p>
          <div><button type="button" className={primaryBtn} onClick={onConfirm}>Confirm and continue</button></div>
        </div>
      ) : null}
      <section className="grid gap-2">
        <h3 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Batches sent</h3>
        <div role="progressbar" aria-label="Batches sent" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total} batches`} className="h-2 w-full overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
          <span className="block h-full bg-axal-violet dark:bg-violet-500" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
        </div>
        <p className={mono}>{done} of {total} batches</p>
      </section>
      <p className={foot}>Keep this page open. Leaving asks first; the run stops after the batch in flight and can be resumed with the same file.</p>
    </>
  );
}

function ResultStep({ state, planInfo }) {
  const phase = state?.phase;
  const rb = state?.readback;
  return (
    <>
      <div className="grid gap-1">
        <ResultChip label={phaseLabel(state)} />
        {phase === 'complete' ? <p className="text-[13px] text-axal-ink dark:text-gray-100">Every source: what is stored was read back and equals what was sent.</p> : null}
        {phase === 'failed' ? <p className="text-[13px] text-axal-ink dark:text-gray-100">{state.sentence ?? 'The run was refused before any write.'} Nothing changed.</p> : null}
        {phase === 'uncertain' ? <p className="text-[13px] text-axal-ink dark:text-gray-100">{state.sentence} A new run is refused until this one is reconciled.</p> : null}
        {phase === 'partial' ? <p className="text-[13px] text-axal-ink dark:text-gray-100">{state.sentence ? `${state.sentence} ` : ''}Not every record was stored and read back. Apply again sends only what is missing.</p> : null}
        {phase === 'blocked' ? (
          <p className="text-[13px] text-axal-ink dark:text-gray-100" data-testid="source-imports-blocked">
            {state.sentence}{' '}
            {state.blocking_run?.uid ? <Link className={linkCls} to={`/research/source-imports/runs/${encodeURIComponent(state.blocking_run.uid)}`}>Open run {shortUid(state.blocking_run.uid)}</Link> : null}
          </p>
        ) : null}
      </div>
      {state?.unconfirmed?.length ? <p className={foot}>Not confirmed: batch {state.unconfirmed.map((i) => i + 1).join(', ')}.</p> : null}
      {rb ? (
        <>
          <Table
            caption="Read back per source"
            testId="source-imports-readback"
            columns={[
              { key: 'source', label: 'Source' }, { key: 'file', label: '# In file', num: true }, { key: 'sent', label: '# Sent', num: true },
              { key: 'back', label: '# Read back', num: true }, { key: 'stored', label: '# Cells stored', num: true },
              { key: 'withheld', label: '# Withheld', num: true }, { key: 'blank', label: '# Blank', num: true }, { key: 'refused', label: '# Refused', num: true },
            ]}
            rows={rb.sources.map((s) => ({
              key: s.source_key, source: s.source_key, file: s.in_file, sent: s.sent,
              back: s.read_back ?? <Unrecorded />, stored: s.cells ? s.cells.stored : <Unrecorded />,
              withheld: s.cells ? s.cells.withheld : <Unrecorded />, blank: s.cells ? s.cells.blank : <Unrecorded />, refused: s.refused.length,
            }))}
          />
          <p className={foot}>Cells stored + withheld + blank = cells of the records sent. {planInfo ? `Records about people left out before upload: ${planInfo.sources.reduce((a, s) => a + s.persons, 0)}.` : ''} Row hashes are declared, not checked.</p>
          {rb.sources.some((s) => s.refused.length) ? (
            <Table
              caption="Refused records"
              columns={[{ key: 'id', label: 'Record id' }, { key: 'source', label: 'Source' }, { key: 'code', label: 'Reason code' }]}
              rows={rb.sources.flatMap((s) => s.refused.map((r) => ({ key: `${s.source_key}/${r.provider_record_id}`, id: <span className={mono}>{r.provider_record_id}</span>, source: s.source_key, code: <span className={mono}>{r.code}</span> })))}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

