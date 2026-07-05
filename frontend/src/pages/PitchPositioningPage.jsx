import React, { useEffect, useMemo, useState } from 'react';
import {
  Megaphone, Sparkles, Loader2, Copy, Check, Users, TrendingUp,
  FileText, Calculator, AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import PageExplainer from '../components/PageExplainer';

/**
 * Task #10 — Pitch Positioning Generator.
 *
 * "One-click positioning": pick a startup → the Worker pulls its team
 * (cap-table founders), traction (project columns + financial model +
 * latest score) and recent updates, then the AI writes a punchy one-liner,
 * a short elevator pitch and 3-5 alternate positioning lines.
 *
 * Explicit states throughout (loading / empty / error). The AI provider is
 * hard-required server-side: a 503 `ai_unavailable` surfaces a clear message
 * rather than fabricated lines. In the dev FastAPI preview the route 404s;
 * that degrades to the same explicit error state (never fake output).
 *
 * `embedded` drops the standalone header so it sits inside the Pitch
 * workspace tab; standalone renders its own icon + title + explainer.
 */
export default function PitchPositioningPage({ embedded = false }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  useEffect(() => {
    let alive = true;
    api.listProjects().then((r) => {
      if (!alive) return;
      const list = Array.isArray(r) ? r : (r?.projects || []);
      setProjects(list);
      if (list.length) setProjectId(String(list[0].id));
    }).catch((e) => {
      if (!alive) return;
      reportError(e);
      setError('Could not load your startups. Please refresh and try again.');
    }).finally(() => { if (alive) setLoadingProjects(false); });
    return () => { alive = false; };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => String(p.id) === String(projectId)) || null,
    [projects, projectId],
  );

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? '' : k)), 1600);
    } catch (e) {
      reportError(e);
    }
  }

  function copyAll() {
    if (!result) return;
    const parts = [];
    if (result.one_liner) parts.push(`One-liner:\n${result.one_liner}`);
    if (result.elevator_pitch) parts.push(`Elevator pitch:\n${result.elevator_pitch}`);
    if (result.positioning_lines?.length) {
      parts.push(`Alternate positioning:\n${result.positioning_lines.map((l) => `• ${l}`).join('\n')}`);
    }
    copy(parts.join('\n\n'), 'all');
  }

  async function generate() {
    if (!projectId) return;
    setGenerating(true);
    setError('');
    setAiUnavailable(false);
    setResult(null);
    try {
      const r = await api.deckPositioning(projectId);
      setResult(r);
    } catch (e) {
      const code = e?.data?.code || e?.data?.error;
      if (e?.status === 503 || code === 'ai_unavailable') {
        setAiUnavailable(true);
        setError(
          e?.message ||
          'Positioning generation needs an AI provider that isn’t configured in this environment.',
        );
      } else if (e?.status === 404 || e?.status === 405) {
        // Dev FastAPI has no POST /decks/positioning (its /decks/:id is
        // GET/PUT only → 405). Be explicit about the preview gap, not fake.
        setAiUnavailable(true);
        setError('Positioning generation isn’t available in this preview environment.');
      } else {
        reportError(e);
        setError(e?.message || 'The positioning generator failed. Please try again.');
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={embedded ? '' : 'p-6 max-w-4xl mx-auto'}>
      {!embedded && (
        <>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-violet-600" /> Positioning
          </h1>
          <PageExplainer>
            Turn a startup’s team, traction and updates into a punchy one-liner,
            a 20-second elevator pitch and a set of alternate positioning lines.
          </PageExplainer>
        </>
      )}

      {/* Picker + generate */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mb-6">
        <label
          htmlFor="positioning-project"
          className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2"
        >
          Startup
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            id="positioning-project"
            data-testid="positioning-project"
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setResult(null); setError(''); setAiUnavailable(false); }}
            disabled={loadingProjects || generating}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-60"
          >
            {loadingProjects && <option>Loading…</option>}
            {!loadingProjects && projects.length === 0 && <option value="">No startups yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name || `Project #${p.id}`}</option>
            ))}
          </select>
          <button
            type="button"
            data-testid="positioning-generate"
            onClick={generate}
            disabled={!projectId || generating || loadingProjects}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 text-sm font-medium whitespace-nowrap"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {generating ? 'Generating…' : result ? 'Regenerate' : 'Generate positioning'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          One-click positioning pulls this startup’s team, traction and recent updates — nothing is invented.
        </p>
      </div>

      {/* Error / AI-unavailable state */}
      {error && (
        <div
          data-testid="positioning-error"
          className={`rounded-2xl border p-5 mb-6 ${
            aiUnavailable
              ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
              : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={18}
              className={aiUnavailable ? 'text-amber-600 dark:text-amber-400 mt-0.5' : 'text-red-600 dark:text-red-400 mt-0.5'}
            />
            <div>
              <p className={`text-sm font-medium ${aiUnavailable ? 'text-amber-800 dark:text-amber-200' : 'text-red-800 dark:text-red-200'}`}>
                {aiUnavailable ? 'Positioning generation is unavailable' : 'Something went wrong'}
              </p>
              <p className={`text-sm mt-0.5 ${aiUnavailable ? 'text-amber-700 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>
                {error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {generating && !result && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-600 mx-auto mb-3" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Writing positioning for {selectedProject?.name || 'your startup'}…
          </p>
        </div>
      )}

      {/* Empty state (no result yet, not generating, no error) */}
      {!result && !generating && !error && (
        <div
          data-testid="positioning-empty"
          className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center"
        >
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
            <Megaphone size={22} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            One-click positioning
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Pick a startup and hit <span className="font-medium">Generate positioning</span> to get a
            one-liner, an elevator pitch and alternate positioning lines you can copy straight into a deck.
          </p>
        </div>
      )}

      {/* Results */}
      {result && !generating && (
        <div data-testid="positioning-result" className="space-y-6">
          <SourcedFrom sourced={result.sourced_from} />

          {result.one_liner && (
            <ResultCard
              label="One-liner"
              copyKey="one_liner"
              copiedKey={copiedKey}
              onCopy={() => copy(result.one_liner, 'one_liner')}
            >
              <p className="text-xl font-semibold leading-snug text-gray-900 dark:text-white">
                {result.one_liner}
              </p>
            </ResultCard>
          )}

          {result.elevator_pitch && (
            <ResultCard
              label="Elevator pitch"
              copyKey="elevator_pitch"
              copiedKey={copiedKey}
              onCopy={() => copy(result.elevator_pitch, 'elevator_pitch')}
            >
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {result.elevator_pitch}
              </p>
            </ResultCard>
          )}

          {result.positioning_lines?.length > 0 && (
            <ResultCard
              label={`Alternate positioning (${result.positioning_lines.length})`}
              copyKey="lines"
              copiedKey={copiedKey}
              onCopy={() => copy(result.positioning_lines.map((l) => `• ${l}`).join('\n'), 'lines')}
            >
              <ul className="space-y-2">
                {result.positioning_lines.map((line, i) => (
                  <li key={i} className="flex items-start gap-2 group">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{line}</span>
                    <button
                      type="button"
                      onClick={() => copy(line, `line-${i}`)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-gray-400 hover:text-violet-600 dark:hover:text-violet-400"
                      title="Copy line"
                      aria-label="Copy line"
                    >
                      {copiedKey === `line-${i}` ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </li>
                ))}
              </ul>
            </ResultCard>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={copyAll}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 px-4 py-2 text-sm font-medium"
            >
              {copiedKey === 'all' ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
              {copiedKey === 'all' ? 'Copied all' : 'Copy all'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({ label, children, onCopy, copyKey, copiedKey }) {
  const copied = copiedKey === copyKey;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {children}
    </div>
  );
}

function SourcedFrom({ sourced }) {
  if (!sourced) return null;
  const chips = [
    {
      key: 'team',
      icon: Users,
      label: sourced.team ? `${sourced.team} founder${sourced.team === 1 ? '' : 's'}` : 'No team data',
      on: !!sourced.team,
    },
    { key: 'traction', icon: TrendingUp, label: sourced.traction ? 'Traction' : 'No traction data', on: !!sourced.traction },
    {
      key: 'updates',
      icon: FileText,
      label: sourced.updates ? `${sourced.updates} update${sourced.updates === 1 ? '' : 's'}` : 'No updates',
      on: !!sourced.updates,
    },
    { key: 'financials', icon: Calculator, label: sourced.financials ? 'Financials' : 'No financials', on: !!sourced.financials },
  ];
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
        Grounded in
      </p>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const Icon = chip.icon;
          return (
            <span
              key={chip.key}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                chip.on
                  ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
              }`}
            >
              <Icon size={13} /> {chip.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
