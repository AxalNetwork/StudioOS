import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Pill, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { StatedLimit } from '../advisor/expertise/kit';
import {
  categoryLabel,
  detailRows,
  draftExplanation,
  draftText,
  exampleHost,
  httpUrl,
  keepNote,
  originSub,
  othersNote,
  recordedRelevance,
  removeConsequence,
} from './companyCandidateRead';

/**
 * `/research/companies/:analysisId/:candidateId` — one competitor in one analysis.
 *
 * THE SHELL ALREADY DRAWS the sidebar, the zone pills and the COLLECTION mark.
 * This page is the row. Dark mode is the app theme.
 *
 * A BLANK SCORE IS NOT ZERO. `recordedRelevance` prints a number only when one
 * was stored, and treats a 0 with no subscores as the column default.
 *
 * THE DRAFT CONCATENATES. It repeats the summary and the source titles already
 * on the page. Accept writes that text into `summary`. It does not add a
 * source and it does not call a model.
 *
 * ADD URL IS ONE PUBLIC GET. It records a source. It does not set the
 * homepage, and Crawl site stays absent until a URL is already on the row.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const selectClass =
  'rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const primaryBtn =
  'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:opacity-70';

const ghostBtn =
  'rounded-lg border border-axal-hairline bg-axal-ground px-3 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'hover:bg-axal-ground/80 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

const dangerBtn =
  'rounded-lg border border-red-200 px-3 py-1.5 text-[12px] font-semibold text-red-700 '
  + 'hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40';

function Nr({ children = 'Not recorded' }) {
  return (
    <span className="inline-flex rounded border border-axal-hairline bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {children}
    </span>
  );
}

function when(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function kindTone(kind) {
  if (kind === 'pricing') return 'warn';
  if (kind === 'features' || kind === 'funding') return 'info';
  if (kind === 'news' || kind === 'content') return 'ok';
  if (kind === 'careers' || kind === 'hiring') return 'cite';
  return 'neutral';
}

function Tile({ k, v, sub, nr, tone = 'ink' }) {
  const ink = tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-axal-ink';
  return (
    <Card>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{k}</div>
      {nr
        ? <div className="mt-2"><Nr /></div>
        : <div className={`mt-1.5 font-mono text-[17px] font-bold tracking-tight ${ink}`}>{v}</div>}
      <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

function SourceCard({ source }) {
  const href = httpUrl(source.url);
  return (
    <div className="rounded-[10px] border border-axal-hairline px-3 py-2 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={kindTone(source.kind)}>{source.kind || 'page'}</Pill>
        <span className="text-[12px] font-bold text-axal-ink">{source.title || 'Untitled'}</span>
        <span className={`ml-auto font-mono text-[10px] font-bold ${source.status === 200 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
          {source.status ?? '—'}
        </span>
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="mt-1 block truncate font-mono text-[10px] text-violet-700 underline dark:text-violet-300">
          {source.url}{exampleHost(source.url) ? ' · placeholder' : ''}
        </a>
      ) : (
        <div className="mt-1"><Nr /></div>
      )}
      <div className="mt-0.5 font-mono text-[10px] text-axal-muted">
        {when(source.fetched_at) ? `fetched ${when(source.fetched_at)}` : 'fetch time not recorded'}
      </div>
    </div>
  );
}

export default function CompanyCandidate({ role = 'founder' }) {
  const { analysisId, candidateId } = useParams();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [preview, setPreview] = useState('');
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const adopt = useCallback((full) => {
    const cand = (full?.candidates || []).find((c) => c.id === candidateId);
    if (!cand) {
      setAnalysis(full);
      setCandidate(null);
      setError('This company is not in that analysis.');
      return null;
    }
    setAnalysis(full);
    setCandidate(cand);
    setName(cand.name || '');
    setSummary(cand.summary || '');
    setError(null);
    return cand;
  }, [candidateId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const full = await api.competitors.get(analysisId);
      adopt(full);
    } catch (e) {
      setAnalysis(null);
      setCandidate(null);
      setError(e?.status === 404
        ? 'This analysis is not on your list.'
        : (e?.message || 'The company did not load.'));
    } finally {
      setLoading(false);
    }
  }, [analysisId, adopt]);

  useEffect(() => { load(); }, [load]);

  const sources = (analysis?.sources || []).filter((s) => s.candidate_id === candidate?.id);
  const signals = (analysis?.signals || []).filter((g) => g.candidate_id === candidate?.id);
  const rel = candidate ? recordedRelevance(candidate) : null;
  const site = candidate ? httpUrl(candidate.url) : null;
  const canDraft = Boolean(String(candidate?.summary || '').trim() || sources.length);
  const explanation = draftExplanation(candidate?.summary, sources);
  const manual = candidate?.origin === 'manual';

  const run = async (fn) => {
    setNotice(null);
    setBusy(true);
    try {
      const full = await fn();
      if (full) adopt(full);
      setNotice({ ok: true, text: 'Saved.' });
      return full;
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'That did not save.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const tiles = candidate ? [
    { k: 'Category', v: categoryLabel(candidate.category), sub: 'how they sit in this analysis' },
    { k: 'Origin', v: candidate.origin || 'Not recorded', sub: originSub(candidate.origin) },
    sources.length
      ? { k: 'Sources', v: `${sources.length} fetched`, sub: 'public GETs of one URL each' }
      : { k: 'Sources', nr: true, sub: 'a name you are willing to defend without a URL' },
    rel != null
      ? { k: 'Relevance', v: `${rel} / 100`, tone: rel >= 70 ? 'ok' : 'ink', sub: 'from the scan; blank is not 0' }
      : { k: 'Relevance', nr: true, sub: 'blank, not zero' },
  ] : [];

  return (
    <WorkspaceShell
      role={role}
      title={candidate?.name || 'Company'}
      activeSlug="companies"
      rail={(
        <WorkerRail
          workspace="Research"
          role={role}
          stance="This page does not track a company or invent a homepage"
          note="Accept writes the summary already on this page. It does not add a source."
          coverage={[candidate
            ? `${candidate.name}: ${categoryLabel(candidate.category)} · ${candidate.origin || 'origin not recorded'}`
            : 'One company in one analysis']}
          unavailable={[
            ['A relationship', 'Direct and adjacent describe this analysis. Nothing here stores a client, a prospect, or a comparable.'],
            ['Headcount and funding', 'Those are not fields on a competitor row.'],
          ]}
        />
      )}
    >
      <div data-testid="company-candidate" className="space-y-3">
        {loading && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] text-axal-muted">Loading this company.</p>
          </Card>
        )}
        {error && !candidate && (
          <Card variant="dashed" padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">This did not load</h2>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-muted">
              {error} Nothing is shown rather than an empty company, because an empty page here would
              say the row has no reading — and that is not something this page can currently know.
            </p>
            <button type="button" onClick={load} className={`${ghostBtn} mt-3`}>Try again</button>
          </Card>
        )}

        {candidate && (
          <>
            {notice && (
              <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="block">
                      <span className="sr-only">Category</span>
                      <select
                        aria-label={`Category for ${candidate.name}`}
                        className={selectClass}
                        value={candidate.category === 'adjacent' ? 'adjacent' : 'direct'}
                        disabled={busy}
                        onChange={(e) => run(() => api.competitors.candidateUpdate(analysisId, candidateId, { category: e.target.value }))}
                      >
                        <option value="direct">Direct</option>
                        <option value="adjacent">Adjacent</option>
                      </select>
                    </label>
                    <Pill tone={manual ? 'info' : candidate.origin === 'discovered' ? 'cite' : 'neutral'}>
                      {candidate.origin || 'origin not recorded'}
                    </Pill>
                    {rel != null
                      ? <Pill tone={rel >= 70 ? 'ok' : 'neutral'}>{rel} / 100</Pill>
                      : <Nr>Relevance not recorded</Nr>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <input
                      aria-label="Company name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="min-w-0 border-b border-dashed border-axal-hairline bg-transparent text-2xl font-extrabold tracking-tight text-axal-ink focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:text-gray-100"
                    />
                    <span className="text-[12px] text-axal-muted">editable</span>
                  </div>
                  <p className="mt-1 text-[12px] text-axal-muted">
                    {categoryLabel(candidate.category)} · {candidate.origin || 'origin not recorded'} · in “{analysis?.title || 'Untitled analysis'}”
                  </p>
                  <div className="mt-2">
                    {site ? (
                      <>
                        <a href={site} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">
                          {(candidate.domain || site)} →
                        </a>
                        {exampleHost(site) && (
                          <span className="ml-2 font-mono text-[10px] text-axal-muted">placeholder domain</span>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Nr />
                        <span className="text-[12px] text-axal-muted">no URL — nothing here will invent one</span>
                      </span>
                    )}
                  </div>
                  <p className={`mt-2 text-[12px] leading-relaxed ${manual ? 'text-violet-800 dark:text-violet-200' : 'text-amber-800 dark:text-amber-300'}`}>
                    {keepNote(candidate.origin)}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={busy}
                    onClick={() => run(() => api.competitors.candidateUpdate(analysisId, candidateId, { name }))}
                  >
                    Save
                  </button>
                  {site && (
                    <button
                      type="button"
                      className={ghostBtn}
                      disabled={busy}
                      onClick={() => run(() => api.competitors.crawlCandidate(analysisId, candidateId))}
                    >
                      Crawl site
                    </button>
                  )}
                  <button type="button" className={dangerBtn} disabled={busy} onClick={() => setRemoving(true)}>
                    Remove from analysis
                  </button>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiles.map((t) => <Tile key={t.k} {...t} />)}
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Summary</span>
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={busy}
                    onClick={() => run(() => api.competitors.candidateUpdate(analysisId, candidateId, { summary }))}
                  >
                    Save
                  </button>
                </div>
                <textarea
                  aria-label="Summary"
                  className={`${inputClass} min-h-[96px]`}
                  value={summary}
                  placeholder="What this company is, in your words…"
                  onChange={(e) => setSummary(e.target.value)}
                />
                {!candidate.summary && (
                  <div className="mt-2"><Nr /></div>
                )}
              </Card>
              <Card>
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Details</div>
                <div className="mt-2.5 grid gap-3">
                  {detailRows(candidate.details).map((d) => (
                    <div key={d.k}>
                      <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{d.k}</div>
                      {d.chips && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {d.chips.map((ch) => (
                            <span key={ch} className="rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                              {ch}
                            </span>
                          ))}
                        </div>
                      )}
                      {d.text && <p className="mt-1 text-[12.5px] leading-relaxed text-axal-ink">{d.text}</p>}
                      {d.nr && <div className="mt-1.5"><Nr /></div>}
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Sources</span>
                <span className="font-mono text-[11px] text-axal-muted">{sources.length ? `${sources.length} fetched` : 'none'}</span>
              </div>
              {sources.length > 0 ? (
                <>
                  <div className="mt-2 hidden md:block">
                    <div className="grid grid-cols-[.8fr_1.6fr_1.6fr_1fr_.6fr] gap-3 text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      <span>Kind</span><span>Title</span><span>URL</span><span>Fetched</span><span>HTTP</span>
                    </div>
                    {sources.map((s) => {
                      const href = httpUrl(s.url);
                      return (
                        <div key={s.id || s.url} className="grid grid-cols-[.8fr_1.6fr_1.6fr_1fr_.6fr] items-center gap-3 border-t border-axal-hairline py-2 text-[12px] dark:border-gray-800">
                          <Pill tone={kindTone(s.kind)}>{s.kind || 'page'}</Pill>
                          <span className="font-semibold text-axal-ink">{s.title || 'Untitled'}</span>
                          {href ? (
                            <a href={href} target="_blank" rel="noreferrer" className="truncate font-mono text-[10.5px] text-violet-700 underline dark:text-violet-300">
                              {s.url}{exampleHost(s.url) ? ' · placeholder' : ''}
                            </a>
                          ) : <Nr />}
                          <span className="font-mono text-[10.5px] text-axal-muted">{when(s.fetched_at) || 'Not recorded'}</span>
                          <span className={`font-mono text-[10.5px] font-bold ${s.status === 200 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{s.status ?? '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 grid gap-2 md:hidden">
                    {sources.map((s) => <SourceCard key={s.id || s.url} source={s} />)}
                  </div>
                </>
              ) : (
                <div className="mt-2.5 rounded-xl border border-dashed border-axal-hairline px-4 py-4 dark:border-gray-700">
                  <div className="text-[13px] font-extrabold tracking-tight">No source on this company</div>
                  <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-axal-muted">
                    A competitor with no URL is a name. Fetch is a controlled public GET of one URL, not a database. Do not invent a homepage to look complete.
                  </p>
                  <div className="mt-3 flex max-w-lg flex-wrap gap-2">
                    <input
                      aria-label="Source URL"
                      className={`${inputClass} mt-0 min-w-0 flex-1 font-mono`}
                      value={sourceUrl}
                      placeholder="https://"
                      onChange={(e) => setSourceUrl(e.target.value)}
                    />
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={busy || !sourceUrl.trim()}
                      onClick={() => run(async () => {
                        const page = await api.competitors.fetchUrl(sourceUrl.trim());
                        if (!page?.ok) {
                          const err = new Error(page?.error || 'That URL did not return a page.');
                          throw err;
                        }
                        setSourceUrl('');
                        return api.competitors.addSource(analysisId, candidateId, { url: page.url || sourceUrl.trim() });
                      })}
                    >
                      Add URL
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-axal-muted">
                    POST /competitors/fetch needs a url. This is that field, nothing more. A page that comes back is recorded as a source. It does not become the homepage.
                  </p>
                </div>
              )}
            </Card>

            {signals.length > 0 && (
              <Card className="hidden md:block">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Signals</div>
                <div className="mt-2.5 grid gap-2">
                  {signals.map((g) => (
                    <div key={g.id || `${g.signal_type}-${g.label}`} className="flex flex-wrap items-baseline gap-2">
                      <Pill tone={kindTone(g.signal_type)}>{g.signal_type}</Pill>
                      <span className="text-[12.5px] text-axal-ink">
                        <strong>{g.label}</strong>
                        {g.detail ? ` — ${g.detail}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">In this analysis</div>
                  <div className="mt-1 text-[13px] font-extrabold tracking-tight">{analysis?.title || 'Untitled analysis'}</div>
                  <p className="mt-1 text-[12px] text-axal-muted">
                    <Pill tone="neutral">{analysis?.mode || 'mode not recorded'}</Pill>
                    <span className="ml-2">updated {when(analysis?.updated_at) || 'not recorded'}</span>
                    <span className="ml-2">· {othersNote((analysis?.candidates || []).length)}</span>
                  </p>
                </div>
                <Link to="/research/companies" className="text-[12px] font-bold text-violet-700 dark:text-violet-300">
                  ‹ Back to analysis
                </Link>
              </div>
            </Card>

            <div
              data-testid="company-candidate-draft"
              className="rounded-[14px] border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-900 dark:bg-indigo-950/50"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-700 px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white">ZONEDRAFT</span>
                <span className="text-[13px] font-extrabold tracking-tight">Company · what we know</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-axal-ink">{explanation}</p>
              {preview && (
                <textarea
                  aria-label="Draft preview"
                  className={`${inputClass} min-h-[72px]`}
                  value={preview}
                  onChange={(e) => setPreview(e.target.value)}
                />
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={!canDraft || busy}
                  onClick={() => setPreview(draftText(candidate.summary, sources))}
                >
                  Draft
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-[12px] font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950/40"
                  disabled={!preview.trim() || busy}
                  onClick={async () => {
                    const saved = await run(() => api.competitors.candidateUpdate(analysisId, candidateId, { summary: preview }));
                    if (saved) setPreview('');
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                  disabled={!preview || busy}
                  onClick={() => setPreview('')}
                >
                  Discard
                </button>
                <span className="text-[12px] text-axal-muted sm:ml-auto">
                  Accept writes the summary. It does not add sources.
                </span>
              </div>
            </div>

            <StatedLimit title="This is not a company you track">
              Direct and adjacent describe how they sit in this analysis. Nothing here stores whether they are a client, a prospect, or a comparable. Headcount and funding are not fields. A missing source is Not recorded, not Stale.
            </StatedLimit>
          </>
        )}

        {removing && candidate && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/40 px-4" role="dialog" aria-modal="true" aria-labelledby="company-remove-title">
            <Card className="w-full max-w-md">
              <div id="company-remove-title" className="text-[15px] font-extrabold tracking-tight">Remove from this analysis?</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">{removeConsequence(candidate.origin)}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={ghostBtn} disabled={busy} onClick={() => setRemoving(false)}>Keep it</button>
                <button
                  type="button"
                  className="rounded-lg bg-red-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-800 disabled:opacity-40"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.competitors.removeCandidate(analysisId, candidateId);
                      navigate('/research/companies');
                    } catch (e) {
                      setBusy(false);
                      setRemoving(false);
                      setNotice({ ok: false, text: e?.message || 'That did not remove the company.' });
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
