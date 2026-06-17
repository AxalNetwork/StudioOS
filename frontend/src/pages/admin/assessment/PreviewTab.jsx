// Task #3 — Preview a draft play-through. Plays the game locally using the same
// mechanic renderers players see (components/play/mechanics.jsx), collects the
// responses, then POSTs them ONCE to /preview which scores in memory and
// persists NOTHING. No player session endpoints are touched.
import React, { useState, useMemo, useCallback } from 'react';
import { RotateCcw, AlertTriangle, Trophy, Info } from 'lucide-react';
import { adminAssessment } from '../../../lib/api';
import { MECHANICS } from '../../../components/play/mechanics';
import SkillRadar from '../../../components/play/SkillRadar';
import {
  valueLabel, spectrumLean, skillLabel, VALUE_SPECTRUMS,
} from '../../../lib/assessmentMeta';
import { Button, SectionCard } from './forms';

function orderItems(detail) {
  const chapters = detail?.chapters || [];
  const order = new Map(chapters.map((c) => [c.id, c.display_order ?? 0]));
  return (detail?.items || [])
    .filter((i) => i.is_active)
    .slice()
    .sort((a, b) => {
      const co = (order.get(a.chapter_id) ?? 0) - (order.get(b.chapter_id) ?? 0);
      if (co) return co;
      if ((a.display_order ?? 0) !== (b.display_order ?? 0)) return (a.display_order ?? 0) - (b.display_order ?? 0);
      return a.id - b.id;
    });
}

function ValueSpectra({ valueVector }) {
  const keys = Object.keys(VALUE_SPECTRUMS);
  return (
    <div className="space-y-2">
      {keys.map((k) => {
        const v = Number(valueVector?.[k] ?? 0);
        const pct = ((v + 2) / 4) * 100; // −2..2 → 0..100
        const meta = VALUE_SPECTRUMS[k];
        return (
          <div key={k}>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{meta.low}</span>
              <span className="font-medium text-slate-700 dark:text-slate-200">{valueLabel(k)}: {spectrumLean(k, v)}</span>
              <span>{meta.high}</span>
            </div>
            <div className="relative h-2 rounded-full bg-slate-200 dark:bg-slate-700 mt-1">
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-violet-600 border-2 border-white dark:border-slate-900"
                style={{ left: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function confidenceLabel(k) {
  return VALUE_SPECTRUMS[k] ? valueLabel(k) : skillLabel(k);
}

function ResultView({ result, onRestart }) {
  const { valueVector = {}, skillVector = {}, confidence = {}, flags = [], archetype } = result;
  const skills = Object.entries(skillVector).sort((a, b) => b[1] - a[1]);
  const confidenceEntries = Object.entries(confidence && typeof confidence === 'object' ? confidence : {})
    .sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      <SectionCard className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-violet-600" /> Preview result
          </h3>
          <Button variant="ghost" size="sm" onClick={onRestart}><RotateCcw className="w-3.5 h-3.5" /> Replay</Button>
        </div>
        {archetype ? (
          <div className="mt-3 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-violet-600 dark:text-violet-300">Assigned archetype</div>
            <div className="text-lg font-bold text-violet-800 dark:text-violet-200">{archetype.label}</div>
            <div className="text-xs font-mono text-violet-600/80 dark:text-violet-300/80">
              {archetype.slug}{typeof archetype.distance === 'number' ? ` · distance ${archetype.distance.toFixed(2)}` : ''}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            No archetype matched — add archetypes with centroids to assign one.
          </div>
        )}
        {confidenceEntries.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Per-dimension confidence</div>
            <div className="flex flex-wrap gap-1.5">
              {confidenceEntries.map(([k, v]) => (
                <span key={k} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {confidenceLabel(k)} {Math.round((Number(v) || 0) * 100)}%
                </span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid md:grid-cols-2 gap-4">
        <SectionCard className="p-4">
          <h4 className="font-medium text-slate-800 dark:text-slate-100 mb-2">Skill radar</h4>
          {skills.length ? (
            <>
              <SkillRadar skillVector={skillVector} height={260} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skills.map(([k, v]) => (
                  <span key={k} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {skillLabel(k)} {Number(v).toFixed(1)}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500 dark:text-slate-400">No skill signal — add per-option loads on skill axes.</div>
          )}
        </SectionCard>

        <SectionCard className="p-4">
          <h4 className="font-medium text-slate-800 dark:text-slate-100 mb-3">Value spectrums</h4>
          <ValueSpectra valueVector={valueVector} />
        </SectionCard>
      </div>

      {flags.length > 0 && (
        <SectionCard className="p-4">
          <h4 className="font-medium text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-500" /> Flags
          </h4>
          <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {flags.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[11px] mt-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{f.type}</span>
                <span>{f.detail}{f.dimension ? ` (${f.dimension})` : ''}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

export default function PreviewTab({ slug, detail, toast }) {
  const items = useMemo(() => orderItems(detail), [detail]);
  const [idx, setIdx] = useState(0);
  const [responses, setResponses] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reset = useCallback(() => {
    setIdx(0); setResponses([]); setResult(null); setErr('');
  }, []);

  const submit = useCallback(async (all) => {
    setBusy(true);
    setErr('');
    try {
      const res = await adminAssessment.preview(slug, all);
      setResult(res);
    } catch (e) {
      const msg = e?.data?.message || e?.message || 'Preview failed';
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [slug, toast]);

  const onAnswer = useCallback((response, meta = {}) => {
    if (busy) return;
    const item = items[idx];
    if (!item) return;
    const entry = {
      itemId: item.id,
      itemSlug: item.slug,
      response,
      latencyMs: meta.latencyMs ?? null,
      confidenceWager: meta.confidenceWager ?? null,
    };
    const all = [...responses, entry];
    setResponses(all);
    if (idx + 1 >= items.length) {
      submit(all);
    } else {
      setIdx(idx + 1);
    }
  }, [busy, items, idx, responses, submit]);

  if (!items.length) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-4 py-10 text-center">
        No active items to preview. Add items (and keep them active) first.
      </div>
    );
  }

  if (result) return <ResultView result={result} onRestart={reset} />;

  if (busy && responses.length >= items.length) {
    return <div className="text-sm text-slate-500 dark:text-slate-400 px-4 py-10 text-center">Scoring preview…</div>;
  }

  const item = items[idx];
  const Mechanic = MECHANICS[item.mechanic];
  const pct = Math.round((idx / items.length) * 100);

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Item {idx + 1} of {items.length} · <code className="font-mono">{item.mechanic}</code></span>
        <button type="button" onClick={reset} className="hover:text-slate-800 dark:hover:text-slate-100 inline-flex items-center gap-1">
          <RotateCcw className="w-3 h-3" /> Restart
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-1.5 rounded-full bg-violet-600 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {err && (
        <div className="flex items-center gap-2 text-sm rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
      )}

      <SectionCard className="p-5">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{item.prompt}</h3>
        {item.subprompt && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-3">{item.subprompt}</p>}
        <div className="mt-3">
          {Mechanic ? (
            <Mechanic item={item} onAnswer={onAnswer} busy={busy} />
          ) : (
            <div className="text-sm text-red-600 dark:text-red-400">Unknown mechanic "{item.mechanic}" — cannot render.</div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
