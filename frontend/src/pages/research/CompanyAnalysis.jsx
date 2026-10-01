import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Pill, Unrecorded, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { StatedLimit } from '../advisor/expertise/kit';
import { download, fetchMarkdown } from '../../components/CompetitorAnalysis';
import {
  analysisTiles, featureGrid, inputsRow, landscapeRead, notesWithRead, signalColumns, sourceFetched,
} from './companyAnalysisRead';

/**
 * `/research/companies/:id` — one saved competitor analysis (canvas 90eb4cf2).
 *
 * IT REPLACES `/build/competitors?id=` FOR FOUNDERS (D313). That route opened
 * the same analysis inside `CompetitorAnalysis`'s in-place panel; this page is
 * the canvas's reading of it, and the old route now redirects here. The
 * component stays: the startup page embeds it, and the Companies zone lists
 * saved analyses through it and links each one here.
 *
 * THREE STATES, THREE SHAPES (`companyAnalysisRead.js`): a failed read draws
 * no tiles, a failed run draws Not recorded tiles and withholds the body, and
 * a finished run draws its numbers — 0 included, because a run that found
 * nothing is a fact.
 *
 * SAVE SENDS THE TITLE AND THE OUTPUT, NEVER THE CANDIDATE SET. The bulk
 * candidate write re-inserts every row and turns a blank relevance into 0, so
 * a category is changed through the one-company route, which touches only
 * that column, and the set is added to and removed from one row at a time.
 *
 * THE LANDSCAPE READ IS A RESTATEMENT, NOT A MODEL, as the canvas draws it:
 * it repeats the summary, the companies and the source kinds already on the
 * page, and Accept appends it to your notes.
 */

const STATUS_TONE = { complete: 'ok', running: 'info', error: 'danger', draft: 'neutral' };
const ORIGIN_TONE = { known: 'neutral', discovered: 'info', manual: 'warn' };
const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const th = 'pb-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint';
const inputClass = 'w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const primaryBtn = 'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-800 '
  + 'disabled:cursor-not-allowed disabled:bg-violet-200 disabled:text-violet-800';
const ghostBtn = 'rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground '
  + 'disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

const EMPTY_MANUAL = { name: '', url: '', summary: '', category: 'direct', crawl: true };
const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const day = (v) => {
  if (!v) return null;
  const s = String(v);
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(t.getTime()) ? s : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

function Tile({ k, v, sub, nr }) {
  return (
    <Card>
      <div className={eyebrow}>{k}</div>
      {nr
        ? <div className="mt-2"><Unrecorded /></div>
        : <div className="mt-1.5 font-mono text-[20px] font-bold tracking-tight text-axal-ink dark:text-gray-100">{v}</div>}
      <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

/** One editable text field, with Not recorded under it while it is empty. */
function TextSection({ title, value, onChange, placeholder, emptyReason, rows = 3 }) {
  return (
    <Card>
      <div className={eyebrow}>{title}</div>
      <textarea
        aria-label={title}
        className={`${inputClass} mt-2`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {!String(value || '').trim() && (
        <p className="mt-1.5 text-[11.5px] text-axal-muted"><Unrecorded /> <span className="ml-1">{emptyReason}</span></p>
      )}
    </Card>
  );
}

export default function CompanyAnalysis({ role = 'founder' }) {
  const { id } = useParams();
  const [analysis, setAnalysis] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | unreadable
  const [draft, setDraft] = useState(null); // { title, market_summary, gaps, wedge, next_actions, notes }
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [preview, setPreview] = useState('');

  const take = useCallback((full) => {
    setAnalysis(full);
    const out = full?.output || {};
    setDraft({
      title: full?.title || '',
      market_summary: out.market_summary || '',
      gaps: (out.gaps || []).join('\n'),
      wedge: out.wedge || '',
      next_actions: (out.next_actions || []).join('\n'),
      notes: out.notes || '',
    });
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      take(await api.competitors.get(id));
      setState('ready');
    } catch (e) {
      setAnalysis(null);
      // D278 — branch on the code; the route answers `not_found` for an id
      // that is not the caller's and for one that does not exist alike.
      setState(e?.status === 404 || e?.code === 'not_found' ? 'missing' : 'unreadable');
    }
  }, [id, take]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn, ok) => {
    setBusy(key);
    setNotice(null);
    try {
      const full = await fn();
      if (full) take(full);
      if (ok) setNotice({ ok: true, text: ok });
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'That did not go through.' });
    } finally {
      setBusy('');
    }
  };

  const out = analysis?.output || {};
  const dirty = Boolean(analysis && draft && (
    draft.title !== (analysis.title || '')
    || draft.market_summary !== (out.market_summary || '')
    || draft.gaps !== (out.gaps || []).join('\n')
    || draft.wedge !== (out.wedge || '')
    || draft.next_actions !== (out.next_actions || []).join('\n')
    || draft.notes !== (out.notes || '')
  ));
  const outputFrom = (d) => ({
    ...out,
    market_summary: d.market_summary.trim(),
    gaps: lines(d.gaps),
    wedge: d.wedge.trim(),
    next_actions: lines(d.next_actions),
    notes: d.notes.trim(),
  });
  // Title and output only — see the docblock on why the candidate set never
  // travels with a save.
  const save = () => run('save',
    () => api.competitors.save(id, { title: draft.title.trim().slice(0, 200), output: outputFrom(draft) }),
    'Saved.');

  const status = analysis?.status || 'draft';
  const running = status === 'running';
  const errored = status === 'error';
  const tiles = analysisTiles(analysis, { readFailed: state === 'unreadable' });
  const inputs = inputsRow(analysis?.inputs);
  const grid = featureGrid(out);
  const signals = signalColumns(out);
  const read = landscapeRead(analysis);
  const candidates = analysis?.candidates || [];
  const sourcesBy = useMemo(() => {
    const m = {};
    for (const s of analysis?.sources || []) {
      if (!sourceFetched(s)) continue;
      (m[s.candidate_id] = m[s.candidate_id] || []).push(s);
    }
    return m;
  }, [analysis]);

  const exportJson = () => download(`competitor-analysis-${String(id).slice(0, 8)}.json`, JSON.stringify(analysis, null, 2), 'application/json');
  const exportMd = async () => {
    try {
      download(`competitor-analysis-${String(id).slice(0, 8)}.md`, await fetchMarkdown(api.competitors.exportUrl(id, 'md')), 'text/markdown');
    } catch {
      setNotice({ ok: false, text: 'The Markdown export could not be read.' });
    }
  };

  return (
    <WorkspaceShell
      role={role}
      title={analysis?.title || 'Competitor analysis'}
      activeSlug="companies"
      rail={(
        <WorkerRail
          workspace="Research"
          role="founder"
          stance="This page maps the players a run returned or you named, with the URLs behind them"
          note="Re-run replaces discovered rows and keeps the ones you added by hand. Nothing here is a relationship, a headcount or a comparable."
          coverage={[analysis
            ? `${analysis.title || 'Untitled'}: ${candidates.length} ${candidates.length === 1 ? 'competitor' : 'competitors'}`
            : 'One saved competitor analysis']}
          unavailable={[
            ['A client', 'An analysis is stored against the person who ran it and carries no company.'],
            ['An invented company', 'The run lists only what it fetched or what you added.'],
          ]}
        />
      )}
    >
      <div data-testid="company-analysis" className="space-y-3">
        <Link to="/research/companies" className="text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">
          ‹ Companies
        </Link>

        <Card variant="sunken" padding="md" data-testid="analysis-scope-band">
          <p className="max-w-3xl text-[12px] leading-relaxed text-axal-muted">
            These analyses are yours, not a client’s. An analysis is stored against the person who ran it and
            carries no company, so there is no client to switch between.
          </p>
        </Card>

        {state === 'loading' && (
          <Card variant="dashed" padding="lg"><p className="text-[12.5px] text-axal-muted">Loading this analysis.</p></Card>
        )}

        {state === 'unreadable' && (
          <Card variant="dashed" padding="lg" data-testid="analysis-read-failed">
            <h2 className="text-sm font-extrabold tracking-tight">Your saved analyses could not be read.</h2>
            <p className="mt-1.5 max-w-2xl text-[12.5px] text-axal-muted">
              A failed read is not an empty list — nothing here is drawn as 0 until the store answers.
            </p>
            <button type="button" className={`${ghostBtn} mt-3`} onClick={load}>Try again</button>
          </Card>
        )}

        {state === 'missing' && (
          <Card padding="lg">
            <h1 className="text-[15px] font-extrabold tracking-tight">This analysis is not on your list.</h1>
            <p className="mt-1.5 text-[12.5px] text-axal-muted">An analysis belongs to the person who ran it.</p>
            <Link to="/research/companies" className={`${ghostBtn} mt-3 inline-block`}>‹ Companies</Link>
          </Card>
        )}

        {state === 'ready' && analysis && draft && (
          <>
            {notice && (
              <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card>
              <label className="block">
                <span className={eyebrow}>Title · editable, max 200</span>
                <input
                  aria-label="Analysis title"
                  maxLength={200}
                  className="mt-1 w-full border-b border-transparent bg-transparent text-2xl font-extrabold tracking-tight text-axal-ink hover:border-axal-hairline focus:border-violet-500 focus:outline-none dark:text-gray-100"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted">
                <Pill tone="neutral">{analysis.mode}</Pill>
                <Pill tone={STATUS_TONE[status] || 'neutral'}>{status}</Pill>
                <span>{`updated ${day(analysis.updated_at)}`}</span>
                {analysis.edited ? <span className="font-semibold text-violet-700 dark:text-violet-300">· edited since last run</span> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className={primaryBtn} onClick={save} disabled={!dirty || busy !== ''}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={ghostBtn} disabled={busy !== '' || running}
                  onClick={() => run('rerun', () => api.competitors.rerun(id, { inputs: analysis.inputs, keep_manual: true }), 'Re-run finished.')}>
                  {busy === 'rerun' ? 'Running…' : 'Re-run'}
                </button>
                <button type="button" className={ghostBtn} disabled={busy !== '' || running}
                  onClick={() => run('refresh', () => api.competitors.refresh(id), 'Sources refreshed.')}>
                  {busy === 'refresh' ? 'Refreshing…' : 'Refresh sources'}
                </button>
                <button type="button" className={ghostBtn} onClick={exportJson}>JSON</button>
                <button type="button" className={ghostBtn} onClick={exportMd}>Markdown</button>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="analysis-inputs">
              {inputs.map((i) => (
                <div key={i.k} className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800">
                  <div className={eyebrow}>{i.k}</div>
                  <div className="mt-1 text-[12px] text-axal-ink dark:text-gray-100">{i.nr ? <Unrecorded /> : i.v}</div>
                </div>
              ))}
            </div>

            {running && (
              <Card variant="dashed" padding="lg" data-testid="analysis-running">
                <p className="text-[13px] font-bold">Discovering candidates, crawling public sites…</p>
                <p className="mt-1 text-[12px] text-axal-muted">Nothing is listed until the run returns. No names appear while it is working.</p>
              </Card>
            )}

            {tiles && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {tiles.map((t) => <Tile key={t.k} {...t} />)}
              </div>
            )}

            {errored && (
              <Card padding="lg" className="border-red-200 dark:border-red-900" data-testid="analysis-errored">
                <p className="text-[13px] font-bold text-red-700 dark:text-red-300">The analysis pipeline failed. Try again or reduce depth.</p>
                <p className="mt-1 text-[12px] text-axal-muted">A failed run is not an empty landscape. Nothing was discovered, so nothing is listed.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className={primaryBtn} disabled={busy !== ''}
                    onClick={() => run('rerun', () => api.competitors.rerun(id, { inputs: analysis.inputs, keep_manual: true }), 'Re-run finished.')}>
                    Re-run
                  </button>
                  <button type="button" className={ghostBtn} disabled={busy !== ''}
                    onClick={() => run('rerun', () => api.competitors.rerun(id, { inputs: { ...(analysis.inputs || {}), depth: 'quick' }, keep_manual: true }), 'Quick scan finished.')}>
                    Quick scan
                  </button>
                </div>
              </Card>
            )}

            {!running && !errored && (
              <>
                <Card>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={eyebrow}>Market summary</span>
                    <button type="button" className={ghostBtn} onClick={save} disabled={!dirty || busy !== ''}>Save</button>
                  </div>
                  <textarea
                    aria-label="Market summary"
                    className={`${inputClass} mt-2`}
                    rows={3}
                    value={draft.market_summary}
                    placeholder="What this landscape looks like, in your words…"
                    onChange={(e) => setDraft({ ...draft, market_summary: e.target.value })}
                  />
                  {!draft.market_summary.trim() && (
                    <p className="mt-1.5 text-[11.5px] text-axal-muted">
                      <Unrecorded /> <span className="ml-1">the run returned no summary, and none is generated to fill the box</span>
                    </p>
                  )}
                </Card>

                <Card data-testid="analysis-competitors">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={eyebrow}>Competitors</span>
                    <span className="text-[11px] text-axal-muted">{`${candidates.length} ${candidates.length === 1 ? 'competitor' : 'competitors'}`}</span>
                  </div>
                  {candidates.length ? (
                    <div className="mt-2.5 overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-[12px]">
                        <thead>
                          <tr>{['Company', 'Category', 'Origin', 'Relevance', 'Sources', 'Summary', ''].map((h) => <th key={h || 'x'} className={th}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {candidates.map((c) => (
                            <tr key={c.id} className="border-t border-axal-hairline align-top dark:border-gray-800">
                              <td className="py-2.5 pr-2">
                                <Link
                                  to={`/research/companies/${encodeURIComponent(id)}/${encodeURIComponent(c.id)}`}
                                  className="font-bold text-violet-700 hover:underline dark:text-violet-300"
                                >
                                  {c.name}
                                </Link>
                                <div className="text-[11px] text-axal-muted">{c.domain || <Unrecorded />}</div>
                              </td>
                              <td className="py-2.5 pr-2">
                                <select
                                  aria-label={`Category for ${c.name}`}
                                  className="rounded-md border border-axal-hairline bg-white px-1.5 py-1 text-[11.5px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                                  value={c.category === 'adjacent' ? 'adjacent' : 'direct'}
                                  disabled={busy !== ''}
                                  onChange={(e) => run('category', () => api.competitors.candidateUpdate(id, c.id, { category: e.target.value }))}
                                >
                                  <option value="direct">Direct</option>
                                  <option value="adjacent">Adjacent</option>
                                </select>
                              </td>
                              <td className="py-2.5 pr-2"><Pill tone={ORIGIN_TONE[c.origin] || 'neutral'}>{c.origin || 'known'}</Pill></td>
                              <td className="py-2.5 pr-2 font-mono">
                                {c.relevance_score == null ? <Unrecorded /> : `${c.relevance_score} / 100`}
                              </td>
                              <td className="py-2.5 pr-2">
                                {(sourcesBy[c.id] || []).length
                                  ? <span className="flex flex-wrap gap-1">{[...new Set(sourcesBy[c.id].map((s) => s.kind))].map((k) => <Pill key={k} tone="neutral">{k}</Pill>)}</span>
                                  : <Unrecorded />}
                              </td>
                              <td className="py-2.5 pr-2 text-axal-muted">{c.summary || <Unrecorded />}</td>
                              <td className="py-2.5">
                                <button type="button" className="text-[11.5px] font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
                                  disabled={busy !== ''}
                                  onClick={() => run('remove', () => api.competitors.removeCandidate(id, c.id))}>
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="mt-2.5 rounded-xl border-[1.5px] border-dashed border-axal-hairline p-4 dark:border-gray-700">
                      <p className="text-[13px] font-extrabold">No competitors yet</p>
                      <p className="mt-1 text-[12px] text-axal-muted">Add one manually or re-run. The product will not invent a top-10.</p>
                    </div>
                  )}

                  <div className="mt-3 rounded-xl border border-dashed border-axal-hairline p-3 dark:border-gray-700" data-testid="analysis-add">
                    <div className={eyebrow}>Add competitor</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                      <input aria-label="Name" className={inputClass} placeholder="Name *" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
                      <input aria-label="Website" className={inputClass} placeholder="https://" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} />
                      <input aria-label="Summary" className={inputClass} placeholder="Summary" value={manual.summary} onChange={(e) => setManual({ ...manual, summary: e.target.value })} />
                      <select aria-label="Category" className={inputClass} value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })}>
                        <option value="direct">Direct</option>
                        <option value="adjacent">Adjacent</option>
                      </select>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 text-[12px] text-axal-muted">
                        <input type="checkbox" checked={manual.crawl} onChange={(e) => setManual({ ...manual, crawl: e.target.checked })} />
                        Crawl site
                      </label>
                      <button type="button" className={primaryBtn} disabled={!manual.name.trim() || busy !== ''}
                        onClick={() => run('add', async () => {
                          const full = await api.competitors.addCandidate(id, { ...manual, name: manual.name.trim() });
                          setManual(EMPTY_MANUAL);
                          return full;
                        })}>
                        {busy === 'add' ? 'Adding…' : 'Add'}
                      </button>
                      <span className="text-[11px] text-axal-muted">
                        Origin becomes manual, and the row takes the next position — it is appended, not stacked on the first.
                      </span>
                    </div>
                  </div>
                </Card>

                {grid && (
                  <Card data-testid="analysis-features">
                    <div className={eyebrow}>Feature comparison</div>
                    <div className="mt-2.5 overflow-x-auto">
                      <table className="w-full text-left text-[12px]">
                        <thead><tr><th className={th}>Feature</th>{grid.head.map((h, i) => <th key={`${h}-${i}`} className={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {grid.rows.map((r, ri) => (
                            <tr key={`${r.feature}-${ri}`} className="border-t border-axal-hairline dark:border-gray-800">
                              <td className="py-2 pr-3 font-semibold">{r.feature}</td>
                              {r.cells.map((v, ci) => <td key={ci} className="py-2 pr-3 text-axal-muted">{v === null ? <Unrecorded /> : v}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}

                {signals.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {signals.map((col) => (
                      <Card key={col.k}>
                        <div className={eyebrow}>{col.k}</div>
                        <ul className="mt-2 space-y-1.5 text-[12px]">
                          {col.lines.map((l, i) => (
                            <li key={i} className="text-axal-muted"><span className="font-semibold text-axal-ink dark:text-gray-100">{l.who}:</span> {l.text}</li>
                          ))}
                        </ul>
                      </Card>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 lg:grid-cols-2">
                  <TextSection title="Gaps & opportunities" value={draft.gaps} placeholder="One per line"
                    emptyReason="the run listed none" onChange={(v) => setDraft({ ...draft, gaps: v })} />
                  <TextSection title="Suggested wedge" value={draft.wedge} rows={2}
                    emptyReason="the run returned none" onChange={(v) => setDraft({ ...draft, wedge: v })} />
                  <TextSection title="Next steps the run listed" value={draft.next_actions} placeholder="One per line"
                    emptyReason="the run listed none" onChange={(v) => setDraft({ ...draft, next_actions: v })} />
                  <TextSection title="Notes" value={draft.notes} placeholder="Your own conclusions…"
                    emptyReason="yours to write" onChange={(v) => setDraft({ ...draft, notes: v })} />
                </div>
                {dirty && (
                  <div className="flex justify-end">
                    <button type="button" className={primaryBtn} onClick={save} disabled={busy !== ''}>
                      {busy === 'save' ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}

                <div data-testid="analysis-draft" className="rounded-[14px] border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-900 dark:bg-violet-950/40">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-violet-700 px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white">ZONEDRAFT</span>
                    <span className="text-[13px] font-extrabold tracking-tight">Analysis · landscape read</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-axal-ink dark:text-gray-100">
                    {read
                      ? 'Restates only what is on this page: the market summary, the companies and their summaries, and the source kinds already fetched. It will not invent a wedge, a price, or a company.'
                      : 'Add a competitor or a summary first.'}
                  </p>
                  {preview && (
                    <textarea aria-label="Landscape read" className={`${inputClass} mt-2`} rows={5} value={preview}
                      onChange={(e) => setPreview(e.target.value)} />
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button type="button" className={primaryBtn} disabled={!read || busy !== ''} onClick={() => setPreview(read)}>Draft</button>
                    <button type="button" className={ghostBtn} disabled={!preview.trim() || dirty || busy !== ''}
                      onClick={() => run('accept', async () => {
                        const notes = notesWithRead(out.notes, preview.trim());
                        const full = await api.competitors.save(id, { output: { ...out, notes } });
                        setPreview('');
                        return full;
                      }, 'Written into your notes.')}>
                      Accept
                    </button>
                    <button type="button" className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                      disabled={!preview} onClick={() => setPreview('')}>
                      Discard
                    </button>
                    <span className="text-[11px] text-axal-muted sm:ml-auto">
                      {dirty && preview ? 'Save your edits first — Accept writes the saved notes. ' : ''}
                      Accept writes your notes. It does not add competitors.
                    </span>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <StatedLimit title="What this page will not do">
          An analysis maps players you named or that a run returned, with the URLs that fed them. Direct and
          adjacent are filed per competitor. Nothing here is a relationship, a headcount, or a comparable.
          Re-run replaces discovered rows and keeps origin=manual.
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
