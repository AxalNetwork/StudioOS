/**
 * D7753 (#7753) — `/research/source-imports/runs/:uid`: one run (FND-I05) and Remove (FND-I06). Who applied it, when,
 * the deployed commit, the digests labelled by what proves them, cells stored, withheld and blank per source, and each
 * refused record by its id and reason code; never record content. Remove takes a record's private fields, one record
 * or one source behind the typed confirmation the board draws, and says the count the Worker removed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DataState, Unrecorded } from '../../../ui';
import { researchSourceImportsApi } from '../../../lib/api/researchSourceImports.js';
import { resultLabel } from '../sheetsSyncModel';
import SuperAdminOnlyNotice from '../../hq/SuperAdminOnlyNotice';
import { cellTotals, failureKind, refusalSentence, removalCounts, removalWord, shortUid } from './importRun';
import { ConsoleHeader, Crumb, Digest, Panel, ResultChip, Table, btn, foot, inputCls, mono, primaryBtn, utcStamp } from './consoleKit';

const SCOPES = [
  ['private_fields', 'A record\'s private fields', 'Its held private fields go. The record, its fields as captured, ids and hashes stay.'],
  ['record', 'One record', 'The record\'s fields as captured, its flags and private fields go. Its id and row hash stay in the run records.'],
  ['source', 'One source', 'Every record of the source goes. Run ids, hashes and counts stay.'],
];

/** Every page of the run's members: ids, row hashes, outcomes and codes. */
async function readRun(uid) {
  const first = await researchSourceImportsApi.run(uid);
  const members = [...(first?.members ?? [])];
  let next = first?.next_offset ?? null;
  while (Number.isSafeInteger(next) && next > 0) {
    const page = await researchSourceImportsApi.run(uid, next);
    members.push(...(page?.members ?? []));
    next = page?.next_offset ?? null;
  }
  return { ...first, members };
}

export default function SourceImportRun() {
  const { uid } = useParams();
  const [read, setRead] = useState({ state: 'loading', data: null });
  const load = useCallback(async () => {
    setRead((r) => ({ ...r, state: 'loading' }));
    try {
      setRead({ state: 'ok', data: await readRun(uid) });
    } catch (e) {
      const kind = failureKind(e);
      setRead({ state: kind === 'refused' ? 'refused' : Number(e?.status) === 404 ? 'missing' : 'unavailable', data: null });
    }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  if (read.state === 'refused') return <SuperAdminOnlyNotice />;
  const run = read.data?.run;
  const label = run ? resultLabel(run) : null;
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-4 px-4 py-6 sm:px-6" data-testid="source-import-run">
      <Crumb tail={<span className={mono}>{shortUid(uid)}</span>} />
      <ConsoleHeader
        title={`Run ${shortUid(uid)}`}
        sub={run ? `${label?.text ?? run.status} · started ${utcStamp(run.started_at) || 'at a time not recorded'}. Counts only: no record content on this page.` : 'Counts only: no record content on this page.'}
      />
      {read.state === 'loading' ? (
        <div className="grid gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <span key={i} className="block h-5 w-full animate-pulse rounded bg-axal-ground dark:bg-gray-800" />)}
          <p role="status" className={foot}>Loading the run…</p>
        </div>
      ) : null}
      {read.state === 'unavailable' ? <DataState state="unavailable" what="This run" claim="This is not a claim that the run has no records." onRetry={load} retryLabel="Try again" announce="always" /> : null}
      {read.state === 'missing' ? <p role="alert" className="text-[13px] text-axal-ink dark:text-gray-100">There is no such run.</p> : null}
      {read.state === 'ok' && run ? <RunBody data={read.data} onChanged={load} /> : null}
    </div>
  );
}

function RunBody({ data, onChanged }) {
  const { run } = data;
  const sources = run.sources ?? [];
  const refused = data.members.filter((m) => m.outcome === 'refused');
  const kept = data.members.length - refused.length;
  const rows = sources.map((s) => {
    const cells = cellTotals(run.counts, s.source_key);
    const d = data.list_digests?.[s.source_key];
    return {
      key: s.source_key, source: s.source_key, expected: s.expected_records,
      back: d ? Number(d.members) : <Unrecorded />, digest: d ? (d.matches ? 'Matches' : 'Differs') : <Unrecorded />,
      stored: cells ? cells.stored : <Unrecorded />, withheld: cells ? cells.withheld : <Unrecorded />, blank: cells ? cells.blank : <Unrecorded />,
      persons: s.excluded_person_records ?? <Unrecorded />,
      refused: refused.filter((m) => m.source_key === s.source_key).length,
    };
  });
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Who, when, what">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px] text-axal-ink dark:text-gray-100">
            <dt className={foot}>Status</dt><dd><ResultChip label={resultLabel(run)} /></dd>
            <dt className={foot}>Run by</dt><dd>{run.acted_by_user_id == null ? <Unrecorded /> : `User ${run.acted_by_user_id} · Super Admin`}</dd>
            <dt className={foot}>Started</dt><dd className={mono}>{utcStamp(run.started_at) || <Unrecorded />}</dd>
            <dt className={foot}>Read back</dt><dd className={mono}>{run.verified_at ? utcStamp(run.verified_at) : <Unrecorded reason="Not sealed Complete or Partial yet" />}</dd>
            <dt className={foot}>Worker commit</dt><dd className={mono}>{run.worker_version || <Unrecorded />}</dd>
            <dt className={foot}>File digest</dt><dd><Digest value={run.file_digest?.sha256} /> <span className={foot}>· as declared by the browser</span></dd>
            <dt className={foot}>Row hashes</dt><dd>Declared, not checked <span className={foot}>· no package hash recipe is registered</span></dd>
            <dt className={foot}>Batches held</dt><dd className={mono}>{(data.held_chunks ?? []).length}</dd>
            <dt className={foot}>Records</dt><dd className={mono}>{kept.toLocaleString('en-US')} stored · {refused.length.toLocaleString('en-US')} refused</dd>
          </dl>
        </Panel>
        <Panel title="Status history">
          <Unrecorded reason="The Worker keeps the run's current status, not each change" reasonVisible />
          {(run.uncertain_chunks ?? []).length ? <p className={`mt-2 ${foot}`}>Batches not confirmed: {run.uncertain_chunks.map((i) => i + 1).join(', ')}.</p> : null}
        </Panel>
      </div>

      <Panel title="Per source" testId="source-import-run-sources">
        {rows.length ? (
          <Table
            caption="Per source"
            columns={[
              { key: 'source', label: 'Source' }, { key: 'expected', label: '# Sent', num: true }, { key: 'back', label: '# Read back', num: true },
              { key: 'digest', label: 'List digest' }, { key: 'stored', label: '# Cells stored', num: true }, { key: 'withheld', label: '# Withheld', num: true },
              { key: 'blank', label: '# Blank', num: true }, { key: 'persons', label: '# About people · left out', num: true }, { key: 'refused', label: '# Refused', num: true },
            ]}
            rows={rows}
          />
        ) : <Unrecorded reason="The run holds no manifest" reasonVisible />}
        <p className={`mt-2 ${foot}`}>The list digest is recomputed by the Worker from what it stores. Records about people are left out by the browser and counted as it declared.</p>
      </Panel>

      <Panel title={`Refused records · ${refused.length.toLocaleString('en-US')}`} testId="source-import-run-refused">
        {refused.length ? (
          <Table
            caption="Refused records"
            columns={[{ key: 'id', label: 'Record id' }, { key: 'source', label: 'Source' }, { key: 'code', label: 'Reason code' }]}
            rows={refused.map((m) => ({ key: `${m.source_key}/${m.provider_record_id}`, id: <span className={mono}>{m.provider_record_id}</span>, source: m.source_key, code: <span className={mono}>{m.refusal_code ?? 'refused'}</span> }))}
          />
        ) : <p className="text-[13px] text-axal-ink dark:text-gray-100">No record was refused.</p>}
        <p className={`mt-2 ${foot}`}>Ids and reason codes only.</p>
      </Panel>

      {['partial', 'uncertain'].includes(run.status) ? <CloseRun uid={run.uid} onDone={onChanged} /> : null}
      <Remove sources={sources.map((s) => s.source_key)} />
    </>
  );
}

/** A partial or uncertain run can be closed (Failed): its stored records stay, and it blocks no new run. */
function CloseRun({ uid, onDone }) {
  const [state, setState] = useState({ busy: false, sentence: null });
  const close = async () => {
    setState({ busy: true, sentence: null });
    try {
      await researchSourceImportsApi.reconcile(uid, { action: 'close' });
      setState({ busy: false, sentence: null });
      onDone();
    } catch (e) {
      setState({ busy: false, sentence: refusalSentence(e) });
    }
  };
  return (
    <Panel title="Settle this run">
      <p className="text-[13px] text-axal-ink dark:text-gray-100">To finish it, choose the same file on Source imports: Resume and Reconcile send only what the Worker does not hold. If it cannot be finished, close it: its stored records stay, it ends Failed, and a new run may open.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={btn} aria-disabled={state.busy} onClick={() => { if (!state.busy) close(); }}>Close the run</button>
        {state.sentence ? <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">{state.sentence}</p> : null}
      </div>
    </Panel>
  );
}

function Remove({ sources }) {
  const [scope, setScope] = useState('source');
  const [source, setSource] = useState(sources[0] ?? '');
  const [recordId, setRecordId] = useState('');
  const [typed, setTyped] = useState('');
  const [state, setState] = useState({ phase: 'scope', sentence: null, counts: null });
  const result = useRef(null);
  const word = removalWord(scope, source);
  const needsId = scope !== 'source';
  const ready = Boolean(source) && (!needsId || recordId.trim().length > 0) && typed === word;
  const why = !source ? 'Choose a source first' : needsId && !recordId.trim() ? 'Name the record first' : typed !== word ? `Type ${word} to confirm` : null;

  useEffect(() => { if (state.phase === 'done') result.current?.focus?.(); }, [state.phase]);

  const submit = async () => {
    if (!ready || state.phase === 'busy') return;
    setState({ phase: 'busy', sentence: null, counts: null });
    try {
      const answer = await researchSourceImportsApi.remove({ scope, source_key: source, ...(needsId ? { provider_record_id: recordId.trim() } : {}) });
      setState({ phase: 'done', sentence: null, counts: removalCounts(answer) });
      setTyped('');
    } catch (e) {
      setState({ phase: 'scope', sentence: refusalSentence(e), counts: null });
    }
  };

  if (!sources.length) return null;
  return (
    <Panel title="Remove" testId="source-import-remove">
      <div className="grid gap-3">
        <fieldset className="grid gap-2">
          <legend className="text-[12px] font-bold text-axal-ink dark:text-gray-100">What goes</legend>
          {SCOPES.map(([k, t, d]) => (
            <label key={k} className="flex min-h-[44px] items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100">
              <input type="radio" name="remove-scope" value={k} checked={scope === k} onChange={() => { setScope(k); setTyped(''); setState({ phase: 'scope', sentence: null, counts: null }); }} className="mt-1" />
              <span><b>{t}</b><small className={`block ${foot}`}>{d}</small></span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
            Source
            <select className={inputCls} value={source} onChange={(e) => { setSource(e.target.value); setTyped(''); }}>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {needsId ? (
            <label className="grid gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
              Record id
              <input className={`${inputCls} ${mono}`} value={recordId} maxLength={200} autoComplete="off" spellCheck={false} onChange={(e) => setRecordId(e.target.value)} />
            </label>
          ) : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px] text-axal-ink dark:text-gray-100">
          <dt className={foot}>Would go</dt>
          <dd><Unrecorded reason="No mounted route counts a removal before it is made; the count gone is shown after" reasonVisible /></dd>
        </dl>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[13px] font-semibold text-axal-ink dark:border-amber-800 dark:bg-amber-900/20 dark:text-gray-100">
          Applying the same file again will not restore it. Its records would arrive as removed and be refused.
        </p>
        <label className="grid gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
          <span>Type <b className={mono}>{word}</b> to confirm</span>
          <input className={`${inputCls} ${mono}`} value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} data-testid="source-import-remove-typed" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={primaryBtn} aria-disabled={!ready || state.phase === 'busy'} onClick={submit}>
            {scope === 'source' ? `Remove every record of ${source}` : scope === 'record' ? 'Remove record' : 'Remove private fields'}
          </button>
          {why ? <span className={foot}>{why}</span> : null}
        </div>
        {state.sentence ? <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">{state.sentence}</p> : null}
        {state.phase === 'done' ? (
          <div ref={result} tabIndex={-1} role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-axal-ink dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-gray-100" data-testid="source-import-remove-result">
            <p className="font-bold">Removed</p>
            {state.counts ? (
              <p className={mono}>
                {state.counts.records != null ? `${state.counts.records.toLocaleString('en-US')} records gone · ` : ''}
                {state.counts.private_fields != null ? `${state.counts.private_fields.toLocaleString('en-US')} private fields gone` : ''}
                {state.counts.flags != null ? ` · ${state.counts.flags.toLocaleString('en-US')} flags gone` : ''}
              </p>
            ) : <Unrecorded reason="The Worker sent no counts" reasonVisible />}
            <p className={foot}>Ids and counts are kept. Applying the same file again will not restore it.</p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
