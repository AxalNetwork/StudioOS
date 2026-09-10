import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Stat } from '../ui';

import {
  ArrowLeft, Megaphone, Loader2, Sparkles, Plus, Trash2, RefreshCw, Download,
  Save, ExternalLink, ChevronRight, Search, AlertCircle, Check,
} from 'lucide-react';
import { api } from '../lib/api';
import ZoneToolbar from '../workspaces/ZoneToolbar';

// Competitor Analysis — in-house, Cloudflare-native competitive intelligence.
// Discovery + controlled public-web crawl + Workers AI synthesis. Prefills from
// an existing startup/project or runs against a custom market. Results are fully
// editable and exportable (JSON / markdown). See cloudflare-worker/src/routes/
// competitors.ts + services/competitorAnalysis.ts + services/webFetch.ts.
//
// Renders in two modes, plus one layout flag:
//   • standalone (default)  — full page with startup/custom mode toggle + picker.
//   • embedded ({ project, embedded }) — locked to a single startup, no toggle
//     or picker; used as an in-page section on the startup detail page.
//   • chromeless — SEPARATE from `embedded`, and separate on purpose. It drops
//     only the page furniture (back link, h1, intro banner, page padding) for a
//     caller whose shell already drew them; everything else — the project
//     fetch, the mode toggle, the picker — stays. `embedded` could not be
//     reused for this: it also means "locked to the project I was handed", so
//     passing it from a workspace that has no project skips the project fetch
//     and defaults the mode to `startup` with nothing to select. Research ·
//     Companies mounts this flag; the startup detail page keeps `embedded`.

// Class constants keep dark-mode pairs in one place (and out of raw className
// literals, which the drift dark-mode guard scans).
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl';
const INPUT = 'w-full border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-400/40';
const LABEL = 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1';
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-full bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const BTN_GHOST = 'inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-sm px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors';
const PILL_ON = 'px-4 py-1.5 rounded-full text-sm font-medium bg-violet-600 text-white';
const PILL_OFF = 'px-4 py-1.5 rounded-full text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800';

const REGIONS = ['Global', 'North America', 'Europe', 'UK', 'Asia', 'LATAM', 'Africa', 'MENA', 'Oceania'];

function emptyInputs() {
  return {
    market: '', target_customer: '', geography: '', known_competitors: '',
    problem: '', region_focus: 'Global', depth: 'quick', nudge: '',
  };
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fetchMarkdown(url) {
  const token = localStorage.getItem('token');
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  });
  return res.text();
}

/**
 * `zoneActions` is a render prop, called with the saved analyses on screen —
 * the ones this reader can actually see, after the embedded scoping below.
 * `/research/companies` is one route for four licences whose zone actions
 * differ; `/build/competitors` passes nothing and gets nothing.
 */
/**
 * THE CANVAS'S STAT STRIP, and the level mismatch that decides who gets one.
 *
 *   founder  Tracked · Changed this month · Comparables · Last refreshed
 *   advisor  Relationships · Researching · Prospects · Headcounts missing
 *
 * Every one of those eight labels counts COMPANIES. `competitor_analyses` is
 * keyed on `user_id` and names no company at all — direct and adjacent live one
 * level down, on `competitor_candidates`, and the list payload this page reads
 * carries no candidates. That mismatch is already recorded on the filter half of
 * this row (`founderZoneFilters.js`, `CATEGORY_IS_PER_COMPETITOR`); it decides
 * the strip too.
 *
 * FOUNDER draws it, because two of its four survive the mismatch. `Tracked` is
 * relabelled to what the store actually holds — an analysis, not a company —
 * which is the same move `LibraryZone` made turning the canvas's `Year` into
 * `Added`; and `Last refreshed` is a real `updated_at` on a real row. The other
 * two are not drawn.
 *
 * ADVISOR draws none of it. All four of its tiles are about a company register
 * with a relationship state — who is a client, who is a prospect, who is merely
 * researched — and nothing here stores a relationship or a company. An advisor's
 * analyses are their own, keyed on their own user id, which is the very thing
 * `CompanyScopeNote` says above this page.
 *
 * NEITHER ABSENCE IS NARRATED ANY MORE, and that is what changed (D56 stands;
 * its remedy does not). The two founder tiles with no source read "Not
 * recorded" under a sentence each, and advisor got a paragraph in place of the
 * strip explaining what the canvas had asked for. Both put design-review
 * commentary where a figure belongs, on a page a reader came to for competitor
 * work. A tile with no source is not drawn, and a licence with no tiles gets no
 * strip. The reasons stay here.
 */
const COMPANIES_STRIP_LICENCES = new Set(['founder']);

/**
 * A FAILED READ IS NOT AN EMPTY LIST, and this component could not tell them
 * apart.
 *
 * Both `competitors.list()` calls caught into `{ analyses: [] }`, and the
 * saved-analyses card rendered only when it HAD rows — so a server error and a
 * first-time reader produced the identical screen: nothing at all, with a
 * "Saved analyses 0" tile above it reading as a fact about the reader rather
 * than about the request. `/research/companies` is one of the two zones a
 * recent audit measured at zero rows on production and recorded as "empty, not
 * unbuilt, a different fact with a different fix"; this is that fix.
 *
 * The sentinel is module-level rather than a second piece of state because
 * there are two await sites, and a flag set beside each is how one of them
 * gets fixed and the other left.
 */
const READ_FAILED = Symbol('competitors.list failed');

export default function CompetitorAnalysis({ project = null, embedded = false, chromeless = false, zoneActions, zoneFilters, role = 'founder' }) {
  // Page furniture only. Never gate data or controls on this.
  const bare = embedded || chromeless;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sectionRef = useRef(null);
  // The run form, so the first-run card can send a reader to the control that
  // actually puts a row in this store rather than describing it.
  const formRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(embedded && project ? String(project.id) : '');
  const [mode, setMode] = useState(embedded ? 'startup' : 'custom'); // startup | custom
  const [inputs, setInputs] = useState(emptyInputs());
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [saved, setSaved] = useState([]);
  // 'loading' until the first answer, then 'ready' or 'failed'. Four screens,
  // because the reader's next move differs in each.
  const [savedState, setSavedState] = useState('loading');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [savingEdits, setSavingEdits] = useState(false);
  const [manual, setManual] = useState({ name: '', url: '', category: 'direct', crawl: true, summary: '' });
  const [showManual, setShowManual] = useState(false);
  const [dirty, setDirty] = useState(false);

  const applySaved = useCallback((list) => {
    if (list === READ_FAILED) { setSavedState('failed'); return; }
    setSaved(list?.analyses || []);
    setSavedState('ready');
  }, []);

  /** Retry, for the failed state — the one button that can clear it. */
  const reloadSaved = useCallback(async () => {
    setSavedState('loading');
    applySaved(await api.competitors.list().catch(() => READ_FAILED));
  }, [applySaved]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Embedded: locked to the current startup — don't fetch the project
        // list or auto-select; just load this caller's saved analyses.
        if (embedded) {
          const list = await api.competitors.list().catch(() => READ_FAILED);
          if (!alive) return;
          applySaved(list);
          return;
        }
        const [projs, list] = await Promise.all([
          api.listProjects().catch(() => []),
          api.competitors.list().catch(() => READ_FAILED),
        ]);
        if (!alive) return;
        const ps = Array.isArray(projs) ? projs : projs?.projects || [];
        setProjects(ps);
        applySaved(list);
        if (ps.length) {
          setMode('startup');
          setProjectId(String(ps[0].id));
        }
        const loadId = searchParams.get('id');
        if (loadId) loadAnalysis(loadId);
      } catch { /* noop */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill inputs from the selected startup.
  useEffect(() => {
    if (mode !== 'startup' || !projectId) return;
    let alive = true;
    (async () => {
      try {
        // Embedded already has the full startup object — no refetch.
        const p = embedded && project ? project : await api.getProject(projectId);
        if (!alive || !p) return;
        setInputs((prev) => ({
          ...prev,
          market: p.sector || p.name || prev.market,
          problem: p.problem_statement || p.description || prev.problem,
          target_customer: p.target_customer || prev.target_customer,
          geography: p.geography || prev.geography,
          known_competitors: p.competitors || prev.known_competitors,
        }));
      } catch { /* noop */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectId]);

  const setInput = (k, v) => setInputs((prev) => ({ ...prev, [k]: v }));

  function scrollToResults() {
    if (embedded) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadAnalysis(id) {
    setError('');
    try {
      const full = await api.competitors.get(id);
      setAnalysis(full);
      setDirty(false);
      scrollToResults();
    } catch (e) {
      setError(e.message || 'Failed to load analysis');
    }
  }

  async function onAnalyze() {
    if (!inputs.market.trim()) { setError('Enter a market / industry to analyze.'); return; }
    setError('');
    setStatus('');
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const payload = { ...inputs };
      if (mode === 'startup' && projectId) { payload.project_id = projectId; payload.mode = 'startup'; }
      else payload.mode = 'custom';
      const full = await api.competitors.analyze(payload);
      setAnalysis(full);
      setDirty(false);
      // A successful run clears a failed read: the list just answered.
      applySaved(await api.competitors.list().catch(() => READ_FAILED));
    } catch (e) {
      setError(e.message || 'Analysis failed. Try again or reduce depth.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function onRerun() {
    if (!analysis) return;
    setAnalyzing(true);
    setError('');
    try {
      const full = await api.competitors.rerun(analysis.id, { inputs: analysis.inputs || inputs, keep_manual: true });
      setAnalysis(full);
      setDirty(false);
    } catch (e) {
      setError(e.message || 'Re-run failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function onRefresh() {
    if (!analysis) return;
    setAnalyzing(true);
    setError('');
    try {
      const full = await api.competitors.refresh(analysis.id);
      setAnalysis(full);
      setDirty(false);
      setStatus('Sources refreshed.');
    } catch (e) {
      setError(e.message || 'Refresh failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function onSave() {
    if (!analysis) return;
    setSavingEdits(true);
    setError('');
    try {
      const full = await api.competitors.save(analysis.id, {
        title: analysis.title,
        output: analysis.output,
        candidates: analysis.candidates,
      });
      setAnalysis(full);
      setDirty(false);
      setStatus('Saved.');
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSavingEdits(false);
    }
  }

  async function onAddManual() {
    if (!analysis || !manual.name.trim()) return;
    setError('');
    try {
      const full = await api.competitors.addCandidate(analysis.id, manual);
      setAnalysis(full);
      setManual({ name: '', url: '', category: 'direct', crawl: true, summary: '' });
      setShowManual(false);
    } catch (e) {
      setError(e.message || 'Could not add competitor.');
    }
  }

  async function onRemoveCandidate(cid) {
    if (!analysis) return;
    try {
      const full = await api.competitors.removeCandidate(analysis.id, cid);
      setAnalysis(full);
    } catch (e) {
      setError(e.message || 'Could not remove competitor.');
    }
  }

  function updateCandidate(cid, patch) {
    setAnalysis((prev) => ({
      ...prev,
      candidates: prev.candidates.map((c) => (c.id === cid ? { ...c, ...patch } : c)),
    }));
    setDirty(true);
  }

  function updateOutput(patch) {
    setAnalysis((prev) => ({ ...prev, output: { ...prev.output, ...patch } }));
    setDirty(true);
  }

  const canAnalyze = inputs.market.trim() && !analyzing;
  // Embedded: scope the saved list to this startup only.
  const visibleSaved = embedded && project
    ? saved.filter((a) => Number(a.project_id) === Number(project.id))
    : saved;

  // `chromeless` IS THE ZONE ROUTE, and it is the only caller that should draw
  // canvas structure. `/build/competitors` mounts this page bare and
  // `ProjectDetail` mounts it `embedded`; only `ResearchWorkspace` passes
  // `chromeless`, so the strip cannot appear on a surface whose canvas never
  // asked for one.
  const zoneCanvas = chromeless;
  // The same `+ 'Z'` the saved list below already appends: these timestamps come
  // back without a zone and would otherwise be read as local time.
  const lastRefreshed = visibleSaved.reduce((newest, a) => {
    const at = Date.parse(`${a.updated_at}Z`);
    return Number.isFinite(at) && at > newest ? at : newest;
  }, 0);

  return (
    <div ref={sectionRef} className={bare ? '' : 'max-w-5xl mx-auto py-6 px-4'}>
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          // NO STATE, BECAUSE THERE IS NOTHING TO SWITCH BETWEEN. `All` is the
          // only live entry on either licence's table for this zone: the
          // canvas's other labels are a company's relation to you, and the rows
          // this row governs are saved ANALYSES, which name no company. So the
          // page reports which view is showing — the only one — rather than
          // holding a state that could never change.
          filters={zoneFilters ? zoneFilters({ value: 'all' }) : []}
          actions={zoneActions(visibleSaved)}
        />
      )}
      {/* THE CANVAS'S FOUR TILES, AND THE TWO OF THEM THAT HAVE A SOURCE.
          The canvas asks for Relationships, Researching, Prospects and
          Headcounts missing — all four counting companies, three of them
          counting a relationship state per company. This page stores neither:
          an analysis is keyed on the person who ran it and names no company,
          and the competitors inside one carry no relation to you.

          What it does have is the saved analyses themselves and their newest
          run date, so those two are drawn. `Changed this month` and
          `Comparables` used to read "Not recorded" with a sentence beneath,
          and the licences with no strip at all got a paragraph explaining the
          canvas instead — design-review commentary in the place a figure
          belongs. A tile with no source is now simply not drawn. */}
      {zoneCanvas && COMPANIES_STRIP_LICENCES.has(role) && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-4">
          {/* NOT `Tracked`. The canvas's word means a company you follow; the
              row this counts is an analysis you ran, and one analysis covers
              several companies. Counting analyses under a label that says
              companies would report the wrong number under the right word. */}
          {/* "across your runs" under a zero described runs that had not
              happened. With nothing read yet the tile has no figure to give
              at all — a 0 there is a claim about the reader, and until the
              list answers it is a claim about the request. */}
          <Stat label="Saved analyses"
            value={savedState === 'ready' ? visibleSaved.length : 'Not recorded'}
            note={savedState === 'failed' ? 'the list could not be read'
              : savedState === 'loading' ? 'reading your analyses'
              : visibleSaved.length === 0 ? 'nothing run yet'
              : `across ${visibleSaved.length === 1 ? 'one run' : 'your runs'}`} />
          {lastRefreshed > 0 && (
            <Stat label="Last refreshed" mono={false}
              value={new Date(lastRefreshed).toISOString().slice(0, 10)}
              note="the newest run across your saved analyses" />
          )}
        </div>
      )}

      {!bare && (
        <>
          <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-3">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Competitor analysis</h1>

          {/* Intro banner */}
          <div className={`${CARD} p-4 mb-4 flex items-start gap-3`}>
            <div className="shrink-0 h-9 w-9 rounded-full bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center">
              <Megaphone size={18} className="text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">Map your competitive landscape</div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Pick a startup or describe a market. We surface players, gaps, and your wedge — crawled and synthesized in-house.</p>
            </div>
          </div>
        </>
      )}

      {/* Inputs form */}
      <div ref={formRef} className={`${CARD} p-5 mb-5`}>
        {!embedded && (
          <div className="mb-4">
            <div className={LABEL}>Mode</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => projects.length && setMode('startup')}
                disabled={!projects.length}
                className={mode === 'startup' ? PILL_ON : PILL_OFF}
              >
                From my startup
              </button>
              <button type="button" onClick={() => setMode('custom')} className={mode === 'custom' ? PILL_ON : PILL_OFF}>
                Custom market
              </button>
            </div>
            {mode === 'startup' && projects.length > 0 && (
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${INPUT} mt-2 max-w-sm`}>
                {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            )}
            {!projects.length && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                No startup yet — using custom mode. <Link to="/build?new=1" className="text-violet-600 dark:text-violet-400 underline font-medium">Create one</Link> to pull your context.
              </p>
            )}
          </div>
        )}

        <div className="mb-3">
          <label className={LABEL}>Market / industry *</label>
          <input value={inputs.market} onChange={(e) => setInput('market', e.target.value)} placeholder="e.g. AI sales enablement for SMBs" className={INPUT} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className={LABEL}>Target customer</label>
            <input value={inputs.target_customer} onChange={(e) => setInput('target_customer', e.target.value)} placeholder="e.g. 10-50 person B2B SaaS sales teams" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Geography</label>
            <input value={inputs.geography} onChange={(e) => setInput('geography', e.target.value)} placeholder="e.g. US + UK" className={INPUT} />
          </div>
        </div>
        <div className="mb-3">
          <label className={LABEL}>Known competitors (optional)</label>
          <input value={inputs.known_competitors} onChange={(e) => setInput('known_competitors', e.target.value)} placeholder="comma-separated" className={INPUT} />
        </div>
        <div className="mb-3">
          <label className={LABEL}>Problem (optional)</label>
          <textarea value={inputs.problem} onChange={(e) => setInput('problem', e.target.value)} rows={2} placeholder="What pain are you solving?" className={INPUT} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className={LABEL}>Region focus</label>
            <select value={inputs.region_focus} onChange={(e) => setInput('region_focus', e.target.value)} className={INPUT}>
              {REGIONS.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Depth</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setInput('depth', 'quick')} className={inputs.depth === 'quick' ? PILL_ON : PILL_OFF}>Quick scan</button>
              <button type="button" onClick={() => setInput('depth', 'deep')} className={inputs.depth === 'deep' ? PILL_ON : PILL_OFF}>Deep dive</button>
            </div>
          </div>
        </div>
        <div className="mb-4">
          <label className={LABEL}>Optional nudge</label>
          <textarea value={inputs.nudge} onChange={(e) => setInput('nudge', e.target.value)} rows={2} placeholder="e.g. ignore enterprise incumbents, focus on bootstrapped SMB tools" className={INPUT} />
        </div>

        <button onClick={onAnalyze} disabled={!canAnalyze} className={`${BTN_PRIMARY} w-full`}>
          {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {analyzing ? 'Analyzing competitors…' : 'Analyze competitors'}
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
          Deep dive crawls pricing / features / about / news pages and takes longer.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {status && !error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <Check size={16} /> {status}
        </div>
      )}

      {analyzing && !analysis && (
        <div className={`${CARD} p-8 text-center mb-5`}>
          <Loader2 size={28} className="animate-spin text-violet-500 mx-auto mb-3" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Discovering candidates, crawling public sites, and synthesizing the landscape…</p>
        </div>
      )}

      {analysis && (
        <AnalysisResults
          analysis={analysis}
          dirty={dirty}
          savingEdits={savingEdits}
          analyzing={analyzing}
          onSave={onSave}
          onRerun={onRerun}
          onRefresh={onRefresh}
          onRemoveCandidate={onRemoveCandidate}
          updateCandidate={updateCandidate}
          updateOutput={updateOutput}
          setTitle={(t) => { setAnalysis((p) => ({ ...p, title: t })); setDirty(true); }}
          showManual={showManual}
          setShowManual={setShowManual}
          manual={manual}
          setManual={setManual}
          onAddManual={onAddManual}
        />
      )}

      {/* SAVED ANALYSES — four states, because this card used to have one.
          `{visibleSaved.length > 0 && …}` meant a failed read, a still-loading
          page and an empty store all rendered nothing, and nothing is the one
          thing that cannot be told apart from the others. */}
      {savedState === 'failed' && (
        <div className={`${CARD} p-5 mt-6`} role="alert">
          <div className="font-semibold text-gray-900 dark:text-gray-100">Your saved analyses could not be read.</div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            This is a problem with the request, not with your account — anything you have run is still stored.
            Running a new analysis below will also refresh this list.
          </p>
          <button type="button" onClick={reloadSaved}
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            Try again
          </button>
        </div>
      )}

      {savedState === 'ready' && visibleSaved.length === 0 && (
        <div className={`${CARD} border-dashed p-5 mt-6`}>
          <div className="font-semibold text-gray-900 dark:text-gray-100">
            {embedded && saved.length > 0
              ? 'No analyses for this startup yet.'
              : 'No saved analyses yet.'}
          </div>
          {/* THE STORE IS EMPTY, NOT MISSING, and the difference is the whole
              point of this card. `competitor_analyses` is keyed on the person
              who ran the analysis, so an empty list means this reader has not
              run one — not that the feature is unbuilt, which is what a blank
              space said. The embedded case is a third sentence again: rows
              exist, just none against this startup. */}
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {embedded && saved.length > 0
              ? `You have ${saved.length === 1 ? 'one analysis' : `${saved.length} analyses`} saved against other startups. `
                + 'Analyses are stored per startup, so this one starts empty.'
              : 'An analysis maps the players in a market, the gaps between them and where you sit. '
                + 'They are stored against you, so this list stays empty until you run the first one.'}
          </p>
          <button type="button"
            onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            Run the first one
          </button>
        </div>
      )}

      {savedState === 'ready' && visibleSaved.length > 0 && (
        <div className={`${CARD} p-5 mt-6`}>
          <div className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Saved analyses</div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {visibleSaved.map((a) => (
              <button key={a.id} onClick={() => loadAnalysis(a.id)} className="w-full flex items-center justify-between py-2.5 text-left group">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{a.title || 'Untitled'}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">{a.mode} · {new Date(a.updated_at + 'Z').toLocaleDateString()}{a.edited ? ' · edited' : ''}</div>
                </div>
                <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 group-hover:text-violet-500" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
    violet: 'bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300',
    blue: 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300',
  };
  return <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${tones[tone]}`}>{children}</span>;
}

function Section({ title, children, right }) {
  return (
    <div className={`${CARD} p-5 mb-4`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function AnalysisResults(props) {
  const {
    analysis, dirty, savingEdits, analyzing, onSave, onRerun, onRefresh,
    onRemoveCandidate, updateCandidate, updateOutput, setTitle,
    showManual, setShowManual, manual, setManual, onAddManual,
  } = props;
  const out = analysis.output || {};
  const candidates = analysis.candidates || [];
  const sources = analysis.sources || [];
  const sourcesByCandidate = useMemo(() => {
    const map = {};
    for (const s of sources) { (map[s.candidate_id] = map[s.candidate_id] || []).push(s); }
    return map;
  }, [sources]);

  function exportJson() {
    download(`competitor-analysis-${analysis.id.slice(0, 8)}.json`, JSON.stringify(analysis, null, 2), 'application/json');
  }
  async function exportMd() {
    const md = await fetchMarkdown(api.competitors.exportUrl(analysis.id, 'md'));
    download(`competitor-analysis-${analysis.id.slice(0, 8)}.md`, md, 'text/markdown');
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={analysis.title || ''}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 min-w-[200px] text-lg font-semibold bg-transparent text-gray-900 dark:text-gray-100 border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-violet-400 focus:outline-none py-1"
        />
        <button onClick={onSave} disabled={savingEdits || !dirty} className={BTN_PRIMARY}>
          {savingEdits ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
        </button>
        <button onClick={onRerun} disabled={analyzing} className={BTN_GHOST}><Sparkles size={15} /> Re-run</button>
        <button onClick={onRefresh} disabled={analyzing} className={BTN_GHOST}><RefreshCw size={15} className={analyzing ? 'animate-spin' : ''} /> Refresh sources</button>
        <button onClick={exportJson} className={BTN_GHOST}><Download size={15} /> JSON</button>
        <button onClick={exportMd} className={BTN_GHOST}><Download size={15} /> Markdown</button>
      </div>

      {/* Market summary */}
      <Section title="Market summary">
        <textarea
          value={out.market_summary || ''}
          onChange={(e) => updateOutput({ market_summary: e.target.value })}
          rows={3}
          className={INPUT}
        />
      </Section>

      {/* Competitors */}
      <Section
        title={`Competitors (${candidates.length})`}
        right={<button onClick={() => setShowManual((v) => !v)} className={BTN_GHOST}><Plus size={15} /> Add competitor</button>}
      >
        {showManual && (
          <div className="mb-4 p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
            <div className="grid sm:grid-cols-2 gap-2 mb-2">
              <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Competitor name" className={INPUT} />
              <input value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} placeholder="website (optional)" className={INPUT} />
            </div>
            <input value={manual.summary} onChange={(e) => setManual({ ...manual, summary: e.target.value })} placeholder="one-line summary (optional)" className={`${INPUT} mb-2`} />
            <div className="flex items-center gap-3 flex-wrap">
              <select value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })} className={`${INPUT} max-w-[160px]`}>
                <option value="direct">Direct</option>
                <option value="adjacent">Adjacent</option>
              </select>
              <label className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={manual.crawl} onChange={(e) => setManual({ ...manual, crawl: e.target.checked })} /> Crawl site
              </label>
              <button onClick={onAddManual} disabled={!manual.name.trim()} className={BTN_PRIMARY}>Add</button>
            </div>
          </div>
        )}
        <div className="space-y-3">
          {candidates.map((c) => (
            <CandidateCard key={c.id} c={c} sources={sourcesByCandidate[c.id] || []} onRemove={() => onRemoveCandidate(c.id)} onUpdate={(patch) => updateCandidate(c.id, patch)} />
          ))}
          {!candidates.length && <p className="text-sm text-gray-500 dark:text-gray-400">No competitors yet. Add one manually or re-run.</p>}
        </div>
      </Section>

      {/* Feature comparison */}
      {out.feature_comparison?.features?.length > 0 && (
        <Section title="Feature comparison">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="py-2 pr-3 font-medium">Competitor</th>
                  {out.feature_comparison.features.map((f, i) => (<th key={i} className="py-2 px-3 font-medium">{f}</th>))}
                </tr>
              </thead>
              <tbody>
                {(out.feature_comparison.rows || []).map((r, ri) => (
                  <tr key={ri} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200">{r.competitor}</td>
                    {(r.values || []).map((v, vi) => (<td key={vi} className="py-2 px-3 text-gray-600 dark:text-gray-400">{v}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Pricing + positioning + traction as compact lists */}
      <div className="grid md:grid-cols-2 gap-4">
        {out.pricing_signals?.length > 0 && (
          <Section title="Pricing signals">
            <ul className="space-y-1.5 text-sm">
              {out.pricing_signals.map((p, i) => (
                <li key={i} className="text-gray-600 dark:text-gray-400"><span className="font-medium text-gray-800 dark:text-gray-200">{p.competitor}:</span> {p.signal}</li>
              ))}
            </ul>
          </Section>
        )}
        {out.positioning?.length > 0 && (
          <Section title="Positioning / messaging">
            <ul className="space-y-1.5 text-sm">
              {out.positioning.map((p, i) => (
                <li key={i} className="text-gray-600 dark:text-gray-400"><span className="font-medium text-gray-800 dark:text-gray-200">{p.competitor}:</span> {p.messaging}</li>
              ))}
            </ul>
          </Section>
        )}
        {out.traction_signals?.length > 0 && (
          <Section title="Traction signals">
            <ul className="space-y-1.5 text-sm">
              {out.traction_signals.map((p, i) => (
                <li key={i} className="text-gray-600 dark:text-gray-400"><span className="font-medium text-gray-800 dark:text-gray-200">{p.competitor}:</span> {p.signal}</li>
              ))}
            </ul>
          </Section>
        )}
        {out.activity_signals?.length > 0 && (
          <Section title="Hiring / content activity">
            <ul className="space-y-1.5 text-sm">
              {out.activity_signals.map((p, i) => (
                <li key={i} className="text-gray-600 dark:text-gray-400"><Badge tone="blue">{p.kind}</Badge> <span className="font-medium text-gray-800 dark:text-gray-200">{p.competitor}:</span> {p.detail}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      {/* Gaps + wedge */}
      <Section title="Gaps & opportunities">
        <EditableList items={out.gaps || []} onChange={(gaps) => updateOutput({ gaps })} placeholder="Add a gap…" />
      </Section>
      <Section title="Suggested wedge">
        <textarea value={out.wedge || ''} onChange={(e) => updateOutput({ wedge: e.target.value })} rows={2} className={INPUT} />
      </Section>
      <Section title="Recommended next actions">
        <EditableList items={out.next_actions || []} onChange={(next_actions) => updateOutput({ next_actions })} placeholder="Add an action…" />
      </Section>
      <Section title="Notes">
        <textarea value={out.notes || ''} onChange={(e) => updateOutput({ notes: e.target.value })} rows={3} placeholder="Your own conclusions…" className={INPUT} />
      </Section>
    </div>
  );
}

function CandidateCard({ c, sources, onRemove, onUpdate }) {
  const details = c.details || {};
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={c.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-violet-400 focus:outline-none"
            />
            <select value={c.category} onChange={(e) => onUpdate({ category: e.target.value })} className="text-[11px] rounded-full px-2 py-0.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300">
              <option value="direct">direct</option>
              <option value="adjacent">adjacent</option>
            </select>
            <Badge tone="violet">relevance {Math.round(c.relevance_score)}</Badge>
            {c.origin && <Badge>{c.origin}</Badge>}
          </div>
          {c.url && (
            <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 mt-0.5 hover:underline">
              {c.domain || c.url} <ExternalLink size={11} />
            </a>
          )}
        </div>
        <button onClick={onRemove} className="text-gray-300 dark:text-gray-600 hover:text-red-500 shrink-0" title="Remove"><Trash2 size={16} /></button>
      </div>
      <textarea
        value={c.summary || ''}
        onChange={(e) => onUpdate({ summary: e.target.value })}
        rows={2}
        placeholder="summary / notes"
        className="w-full mt-2 text-sm bg-transparent text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-800 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400/40"
      />
      {(details.features?.length || details.pricing?.length || details.positioning) && (
        <div className="mt-2 grid sm:grid-cols-3 gap-2 text-xs">
          {details.features?.length > 0 && (
            <div><div className="font-semibold text-gray-500 dark:text-gray-400 mb-0.5">Features</div><div className="text-gray-600 dark:text-gray-400">{details.features.slice(0, 4).join(', ')}</div></div>
          )}
          {details.pricing?.length > 0 && (
            <div><div className="font-semibold text-gray-500 dark:text-gray-400 mb-0.5">Pricing</div><div className="text-gray-600 dark:text-gray-400">{details.pricing.slice(0, 4).join(', ')}</div></div>
          )}
          {details.positioning && (
            <div><div className="font-semibold text-gray-500 dark:text-gray-400 mb-0.5">Positioning</div><div className="text-gray-600 dark:text-gray-400">{details.positioning}</div></div>
          )}
        </div>
      )}
      {sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400" title={s.url}>
              <Search size={10} /> {s.kind}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EditableList({ items, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <ul className="space-y-1.5 mb-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 group">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
            <input
              value={it}
              onChange={(e) => onChange(items.map((x, xi) => (xi === i ? e.target.value : x)))}
              className="flex-1 text-sm bg-transparent text-gray-700 dark:text-gray-300 border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-violet-400 focus:outline-none"
            />
            <button onClick={() => onChange(items.filter((_, xi) => xi !== i))} className="opacity-0 group-hover:opacity-100 text-gray-300 dark:text-gray-600 hover:text-red-500"><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } }}
          placeholder={placeholder}
          className="flex-1 text-sm border border-gray-200 dark:border-gray-800 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
        />
        <button onClick={() => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } }} className={BTN_GHOST}><Plus size={14} /></button>
      </div>
    </div>
  );
}
