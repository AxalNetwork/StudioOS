/**
 * D1253 (#2428) and D1259 (#3282, part 6) — SC13 "Platform › Scoring" at
 * `/admin/platform/scoring`, HQ only: the venture model's versions and
 * Publish, the country index sources and their editions, and the fairness
 * check.
 *
 * Two reads, each failing alone: `GET /api/venture-scores/hq/models` and
 * `GET /api/venture-scores/hq/indices`. Publish and Import are a Super
 * Admin's, each in an in-page dialog that says what it changes; the global
 * step-up prompt asks for the authenticator code. The fairness check is part
 * 3's (#3279) and still waits.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScorecardWait } from '../../components/scoring/scorecard/Scorecard';
import { METHOD } from '../../components/scoring/scorecard/scorecardModel';
import { ventureScoreModelsApi } from '../../lib/api/ventureScoreModels';
import { reportError } from '../../lib/log';
import { isSuperAdminUser } from '../../lib/shellRole';
import { useAuth } from '../../hooks/useAuthSync';
import { Lightbox, actionGhost, actionPrimary } from '../../ui';
import { changeCell, editionLine, licenceLine, parseCodes, publishLines, versionRow } from './hqScoringModel';

const box = 'flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const TH = 'px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400';
const TD = 'px-2 py-2 align-top text-[13px]';
const SUB = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const INPUT = 'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

/** A read's three states: undefined reading, null unreadable, else the payload. */
function useRead(load) {
  const [state, setState] = useState({ value: undefined });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ value: undefined });
    load().then(
      (value) => { if (live) setState({ value }); },
      (e) => { reportError('hq-scoring:read', e); if (live) setState({ value: null }); },
    );
    return () => { live = false; };
  }, [load, tick]);
  return [state.value, useCallback(() => setTick((t) => t + 1), [])];
}

function Unreadable({ what, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testId}>
      <span><strong>Unreadable.</strong> {what} could not be read. That is not the same as none.</span>
      <button type="button" className={actionGhost} onClick={onRetry}>Try again</button>
    </div>
  );
}

const Reading = ({ testId }) => <span className="font-mono text-[12px] text-axal-muted" data-testid={testId}>Reading…</span>;

function PublishDialog({ draft, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const publish = async () => {
    setBusy(true); setError('');
    try {
      await ventureScoreModelsApi.publish(draft.version);
      onDone(`Model v${draft.version} is published. Its recompute runs a batch of ventures each minute.`);
    } catch (e) {
      setError(e?.message || 'The model could not be published. Nothing changed.');
      setBusy(false);
    }
  };
  return (
    <Lightbox label={`Publish Model v${draft.version}`} title={`Publish Model v${draft.version}?`} onClose={busy ? () => {} : onClose} testId="hq-scoring-publish-dialog"
      footer={<div className="flex justify-end gap-2">
        <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Back</button>
        <button type="button" className={actionPrimary} onClick={publish} disabled={busy} data-testid="hq-scoring-publish-go">{busy ? 'Publishing…' : `Publish v${draft.version}`}</button>
      </div>}>
      <div className="flex flex-col gap-2 text-[13px]">
        {publishLines(draft).map((l) => <p key={l} className="m-0">{l}</p>)}
        {error && <p role="alert" className="m-0 text-red-700 dark:text-red-300" data-testid="hq-scoring-publish-refusal">{error}</p>}
      </div>
    </Lightbox>
  );
}

function ImportDialog({ source, onClose, onDone }) {
  const [edition, setEdition] = useState('');
  const [publishedOn, setPublishedOn] = useState('');
  const [lists, setLists] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isList = source.kind === 'list';
  const parsed = Object.fromEntries(Object.keys(source.indicators).map((k) => [k, parseCodes(lists[k])]));
  const bad = Object.values(parsed).flatMap((p) => p.bad);
  const ready = edition.trim() && /^\d{4}-\d{2}-\d{2}$/.test(publishedOn) && !bad.length;
  const go = async () => {
    setBusy(true); setError('');
    try {
      const body = { edition: edition.trim(), published_on: publishedOn };
      if (isList) body.countries = Object.fromEntries(Object.entries(parsed).map(([k, p]) => [k, p.good]));
      const out = await ventureScoreModelsApi.importIndex(source.key, body);
      onDone(`${source.publisher} ${out.edition} is imported: ${out.countries} ${out.countries === 1 ? 'country' : 'countries'}.`);
    } catch (e) {
      setError(e?.message || 'The edition could not be imported. Nothing was written.');
      setBusy(false);
    }
  };
  return (
    <Lightbox label={`Import ${source.name}`} title={`Import an edition of ${source.publisher}’s ${source.name}`}
      sub={isList ? 'Enter the countries exactly as the publisher’s edition lists them. A country not listed is stored as nothing, never as a 0.' : 'The Worker fetches this edition from the World Bank. Nothing is written unless every indicator reads.'}
      onClose={busy ? () => {} : onClose} testId="hq-scoring-import-dialog"
      footer={<div className="flex justify-end gap-2">
        <button type="button" className={actionGhost} onClick={onClose} disabled={busy}>Back</button>
        <button type="button" className={actionPrimary} onClick={go} disabled={busy || !ready} data-testid="hq-scoring-import-go">{busy ? 'Importing…' : 'Import edition'}</button>
      </div>}>
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1">{isList ? 'Edition' : 'Edition (the data year)'}
          <input className={INPUT} value={edition} onChange={(e) => setEdition(e.target.value)} disabled={busy} data-testid="hq-scoring-import-edition" /></label>
        <label className="flex flex-col gap-1">Published on
          <input type="date" className={INPUT} value={publishedOn} onChange={(e) => setPublishedOn(e.target.value)} disabled={busy} data-testid="hq-scoring-import-published" /></label>
        {isList && Object.entries(source.indicators).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1">{label}
            <textarea className={INPUT} rows={2} value={lists[k] || ''} onChange={(e) => setLists((l) => ({ ...l, [k]: e.target.value }))} disabled={busy}
              placeholder="Two-letter codes, separated by spaces or commas" data-testid={`hq-scoring-import-list-${k}`} /></label>
        ))}
        {bad.length > 0 && <p role="alert" className="m-0 text-red-700 dark:text-red-300">Not a two-letter code: {bad.slice(0, 5).join(', ')}.</p>}
        <p className={SUB}>This edition is imported once and never edited. You are asked for your authenticator code first.</p>
        {error && <p role="alert" className="m-0 text-red-700 dark:text-red-300" data-testid="hq-scoring-import-refusal">{error}</p>}
      </div>
    </Lightbox>
  );
}

const readModels = () => ventureScoreModelsApi.models();
const readIndices = () => ventureScoreModelsApi.indices();

export default function HqScoringPage() {
  const superAdmin = isSuperAdminUser(useAuth()?.user);
  const [models, retryModels] = useRead(readModels);
  const [indices, retryIndices] = useRead(readIndices);
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(null);
  const [done, setDone] = useState('');
  const draft = models?.draft ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="hq-scoring">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 font-mono text-[11px] uppercase tracking-[.07em] text-axal-muted">Platform › Scoring</p>
          <div className="flex items-center gap-2">
            <h1 className="m-0 text-2xl font-extrabold tracking-tight">Scoring</h1>
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">HQ only</span>
          </div>
          <p className="m-0 text-sm text-axal-muted">The model behind every venture scorecard: its versions, the country indices it reads, and the fairness check. <Link to={METHOD} className="font-semibold text-violet-700 underline dark:text-violet-300">How scoring works</Link></p>
        </div>
        {superAdmin && draft && <button type="button" className={actionPrimary} onClick={() => setPublishing(true)} data-testid="hq-scoring-publish">Publish v{draft.version}</button>}
      </div>
      {done && <p role="status" className="m-0 text-sm text-emerald-700 dark:text-emerald-300" data-testid="hq-scoring-done">{done}</p>}

      <section className={box} data-testid="hq-scoring-models">
        <h2 className="m-0 text-[15px] font-bold">Model versions</h2>
        {models === undefined && <Reading testId="hq-scoring-models-loading" />}
        {models === null && <Unreadable what="The model versions" onRetry={retryModels} testId="hq-scoring-models-unreadable" />}
        {models && <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse">
          <thead><tr>{['Version', 'State', 'Date', 'By', 'Ventures'].map((c) => <th key={c} scope="col" className={TH}>{c}</th>)}</tr></thead>
          <tbody>{models.versions.map((v) => {
            const row = versionRow(v);
            return <tr key={v.version} className="border-t border-gray-100 dark:border-gray-800" data-testid={`hq-scoring-version-${v.version}`}>
              <td className={`${TD} font-mono font-semibold`}>{row.version}</td>
              <td className={TD}>{row.state}{row.progress && <span className={`block ${SUB}`}>{row.progress}</span>}</td>
              <td className={`${TD} font-mono`}>{row.date}</td>
              <td className={TD}>{row.by}</td>
              <td className={`${TD} font-mono`}>{row.ventures}</td>
            </tr>;
          })}</tbody>
        </table></div>}
      </section>

      {draft && <section className={box} data-testid="hq-scoring-changes">
        <h2 className="m-0 text-[15px] font-bold">What v{draft.version} changes <span className="font-normal text-axal-muted">· {draft.changes.length} {draft.changes.length === 1 ? 'input' : 'inputs'}</span></h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse">
          <thead><tr>{['Scope', 'Input', `v${models.live}`, `v${draft.version}`].map((c) => <th key={c} scope="col" className={TH}>{c}</th>)}</tr></thead>
          <tbody>{draft.changes.map((ch) => <tr key={`${ch.scope}:${ch.input}`} className="border-t border-gray-100 dark:border-gray-800">
            <td className={TD}>{ch.scope_label}</td>
            <td className={TD}>{ch.input}<span className={`block ${SUB}`}>{ch.reads}</span></td>
            <td className={TD}>{changeCell(ch.from)}</td>
            <td className={`${TD} font-semibold`}>{changeCell(ch.to)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}

      <section className={box} data-testid="hq-scoring-indices">
        <h2 className="m-0 text-[15px] font-bold">Country index sources</h2>
        <p className={SUB}>Geographic and Political and regulatory read these from model v1.1, and only an edition imported under a recorded licence.</p>
        {indices === undefined && <Reading testId="hq-scoring-indices-loading" />}
        {indices === null && <Unreadable what="The country index sources" onRetry={retryIndices} testId="hq-scoring-indices-unreadable" />}
        {indices && indices.sources.map((s) => (
          <div key={s.key} className="flex flex-col gap-1 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700" data-testid={`hq-scoring-source-${s.key}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{s.publisher} · {s.name}</span>
              {superAdmin && s.licence && <button type="button" className={actionGhost} onClick={() => setImporting(s)} data-testid={`hq-scoring-import-${s.key}`}>Import an edition</button>}
            </div>
            <span className={SUB}>{licenceLine(s)}</span>
            {!s.licence && <span className={SUB}>{s.licence_note}</span>}
            {s.editions.length
              ? s.editions.map((e) => <span key={e.edition} className="text-[12.5px]" data-testid={`hq-scoring-edition-${s.key}-${e.edition}`}>{editionLine(e)}</span>)
              : <span className={SUB}>{s.licence ? 'Not recorded: no edition is imported yet.' : 'No edition is imported.'}</span>}
          </div>
        ))}
      </section>

      <section className={box} data-testid="hq-scoring-fairness"><h2 className="m-0 text-[15px] font-bold">Fairness check</h2><ScorecardWait id="fairness" /></section>

      {publishing && draft && <PublishDialog draft={draft} onClose={() => setPublishing(false)}
        onDone={(msg) => { setPublishing(false); setDone(msg); retryModels(); }} />}
      {importing && <ImportDialog source={importing} onClose={() => setImporting(null)}
        onDone={(msg) => { setImporting(null); setDone(msg); retryIndices(); }} />}
    </div>
  );
}

