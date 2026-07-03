import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Megaphone, Loader2, Sparkles, Plus, Trash2, RefreshCw, Download,
  Save, ExternalLink, ChevronRight, Search, AlertCircle, Check,
} from 'lucide-react';
import { api } from '../lib/api';

// Competitor Analysis — in-house, Cloudflare-native competitive intelligence.
// Discovery + controlled public-web crawl + Workers AI synthesis. Prefills from
// an existing startup/project or runs against a custom market. Results are fully
// editable and exportable (JSON / markdown). See cloudflare-worker/src/routes/
// competitors.ts + services/competitorAnalysis.ts + services/webFetch.ts.

// Class constants keep dark-mode pairs in one place (and out of raw className
// literals, which the drift dark-mode guard scans).
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl';
const INPUT = 'w-full border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-400/40';
const LABEL = 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1';
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 rounded-full bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const BTN_GHOST = 'inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-sm px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors';
const PILL_ON = 'px-4 py-1.5 rounded-full text-sm font-medium bg-orange-600 text-white';
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

export default function CompetitorAnalysisPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [mode, setMode] = useState('custom'); // startup | custom
  const [inputs, setInputs] = useState(emptyInputs());
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [saved, setSaved] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [savingEdits, setSavingEdits] = useState(false);
  const [manual, setManual] = useState({ name: '', url: '', category: 'direct', crawl: true, summary: '' });
  const [showManual, setShowManual] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [projs, list] = await Promise.all([
          api.listProjects().catch(() => []),
          api.competitors.list().catch(() => ({ analyses: [] })),
        ]);
        if (!alive) return;
        const ps = Array.isArray(projs) ? projs : projs?.projects || [];
        setProjects(ps);
        setSaved(list?.analyses || []);
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

  // Prefill inputs from the selected project.
  useEffect(() => {
    if (mode !== 'startup' || !projectId) return;
    let alive = true;
    (async () => {
      try {
        const p = await api.getProject(projectId);
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
  }, [mode, projectId]);

  const setInput = (k, v) => setInputs((prev) => ({ ...prev, [k]: v }));

  async function loadAnalysis(id) {
    setError('');
    try {
      const full = await api.competitors.get(id);
      setAnalysis(full);
      setDirty(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      const list = await api.competitors.list().catch(() => null);
      if (list) setSaved(list.analyses || []);
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

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-3">
        <ArrowLeft size={16} /> Back
      </button>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Competitor analysis</h1>

      {/* Intro banner */}
      <div className={`${CARD} p-4 mb-4 flex items-start gap-3`}>
        <div className="shrink-0 h-9 w-9 rounded-full bg-orange-100 dark:bg-orange-950/50 flex items-center justify-center">
          <Megaphone size={18} className="text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <div className="font-semibold text-gray-900 dark:text-gray-100">Map your competitive landscape</div>
          <p className="text-sm text-gray-600 dark:text-gray-400">Pick a startup or describe a market. We surface players, gaps, and your wedge — crawled and synthesized in-house.</p>
        </div>
      </div>

      {/* Inputs form */}
      <div className={`${CARD} p-5 mb-5`}>
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
              No startup yet — using custom mode. <Link to="/projects" className="text-orange-600 dark:text-orange-400 underline font-medium">Create one</Link> to pull your context.
            </p>
          )}
        </div>

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
          <Loader2 size={28} className="animate-spin text-orange-500 mx-auto mb-3" />
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

      {/* Saved analyses */}
      {saved.length > 0 && (
        <div className={`${CARD} p-5 mt-6`}>
          <div className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Saved analyses</div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {saved.map((a) => (
              <button key={a.id} onClick={() => loadAnalysis(a.id)} className="w-full flex items-center justify-between py-2.5 text-left group">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{a.title || 'Untitled'}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">{a.mode} · {new Date(a.updated_at + 'Z').toLocaleDateString()}{a.edited ? ' · edited' : ''}</div>
                </div>
                <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 group-hover:text-orange-500" />
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
    orange: 'bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300',
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
          className="flex-1 min-w-[200px] text-lg font-semibold bg-transparent text-gray-900 dark:text-gray-100 border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-orange-400 focus:outline-none py-1"
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
              className="font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-orange-400 focus:outline-none"
            />
            <select value={c.category} onChange={(e) => onUpdate({ category: e.target.value })} className="text-[11px] rounded-full px-2 py-0.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300">
              <option value="direct">direct</option>
              <option value="adjacent">adjacent</option>
            </select>
            <Badge tone="orange">relevance {Math.round(c.relevance_score)}</Badge>
            {c.origin && <Badge>{c.origin}</Badge>}
          </div>
          {c.url && (
            <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 mt-0.5 hover:underline">
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
        className="w-full mt-2 text-sm bg-transparent text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-800 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
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
            <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400" title={s.url}>
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
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />
            <input
              value={it}
              onChange={(e) => onChange(items.map((x, xi) => (xi === i ? e.target.value : x)))}
              className="flex-1 text-sm bg-transparent text-gray-700 dark:text-gray-300 border-b border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-orange-400 focus:outline-none"
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
