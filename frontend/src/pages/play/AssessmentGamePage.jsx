// Task #2 — Assessment player (/play/:gameSlug). Full-screen state machine:
//   start(slug) → loop[ next() → render mechanic → respond() ] → next()={done}
//   → complete() → Scout Report reveal.
// Completion is STRICT: we only call complete() once next() reports done:true
// (the backend does not verify every item is answered), so the reflection item —
// which must be last — is answered like any other and the following next() drives
// the finish. Response shapes are produced by the per-mechanic renderers.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { X, Loader2, Sparkles, IdCard, RotateCcw, AlertTriangle } from 'lucide-react';
import { assessment } from '../../lib/api';
import { useToast } from '../../components/useToast';
import SkillRadar from '../../components/play/SkillRadar';
import SpectrumBar from '../../components/play/SpectrumBar';
import { MECHANICS, DilemmaMechanic } from '../../components/play/mechanics';
import { archetypeMeta, iconFor, humanize, levelProgress } from '../../lib/assessmentMeta';

function ProgressBar({ answered, total, chapter }) {
  const pct = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-gray-600 dark:text-gray-300">{chapter || 'In progress'}</span>
        <span className="text-gray-500 dark:text-gray-400">{answered} / {total}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Reveal({ slug, result, xp, badges, onReplay }) {
  const meta = archetypeMeta(result?.archetype_slug);
  const label = meta?.label || result?.archetype_label || 'Your profile';
  const Icon = iconFor(meta?.icon);
  const accent = meta?.accent || '#7c3aed';
  const valueEntries = Object.entries(result?.value_vector || {});
  const lvl = levelProgress(xp?.xp ?? 0);

  return (
    <div className="space-y-6">
      <div
        className="rounded-3xl p-8 text-center text-white"
        style={{ background: `linear-gradient(135deg, ${accent} 0%, #4c1d95 100%)` }}
      >
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15">
          <Icon className="h-9 w-9" />
        </div>
        <div className="text-xs font-medium uppercase tracking-widest text-white/70">Your archetype</div>
        <h2 className="mt-1 text-3xl font-bold">{label}</h2>
        {meta?.tagline && <p className="mt-1 text-white/90">{meta.tagline}</p>}
        {meta?.description && <p className="mx-auto mt-3 max-w-md text-sm text-white/80">{meta.description}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {xp?.gained ? (
          <span className="rounded-full bg-violet-100 px-4 py-1.5 text-sm font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-200">
            +{xp.gained} XP
          </span>
        ) : null}
        <span className="rounded-full bg-gray-100 px-4 py-1.5 text-sm font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
          Level {lvl.level}
        </span>
      </div>

      {result?.skill_vector && Object.keys(result.skill_vector).length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-50">Skills radar</h3>
          <SkillRadar skillVector={result.skill_vector} height={300} />
        </div>
      )}

      {valueEntries.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-50">Where you lean</h3>
          <div className="space-y-4">
            {valueEntries.map(([sslug, v]) => (
              <SpectrumBar key={sslug} slug={sslug} value={v} />
            ))}
          </div>
        </div>
      )}

      {badges.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-50">Badges unlocked</h3>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <span key={b} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                {humanize(b)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          to="/play/card"
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700"
        >
          <IdCard className="h-4 w-4" /> View &amp; share my card
        </Link>
        <button
          type="button"
          onClick={onReplay}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <RotateCcw className="h-4 w-4" /> Play again
        </button>
        <Link
          to="/play"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          Back to hub
        </Link>
      </div>
    </div>
  );
}

export default function AssessmentGamePage() {
  const { gameSlug } = useParams();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();

  const [phase, setPhase] = useState('loading'); // loading | playing | completing | reveal | error
  const [error, setError] = useState('');
  const [item, setItem] = useState(null);
  const [progress, setProgress] = useState({ answered: 0, total: 0 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [xp, setXp] = useState(null);
  const [badges, setBadges] = useState([]);
  const pidRef = useRef(null);
  const submittingRef = useRef(false); // synchronous lock — beats React state to block double-submits

  const finish = useCallback(async (pid) => {
    setPhase('completing');
    try {
      const res = await assessment.complete(pid);
      setResult(res?.result || null);
      setXp(res?.xp || null);
      const awarded = Array.isArray(res?.badges_awarded) ? res.badges_awarded : [];
      setBadges(awarded);
      setPhase('reveal');
      awarded.forEach((b, i) => {
        setTimeout(() => showToast({ kind: 'success', msg: `Badge unlocked: ${humanize(b)}` }), 500 + i * 350);
      });
    } catch (e) {
      setError(e?.message || 'Could not finish the game.');
      setPhase('error');
    }
  }, [showToast]);

  const advance = useCallback(async (pid) => {
    const res = await assessment.next(pid);
    if (res?.done) {
      await finish(pid);
      return;
    }
    setItem(res.item);
    setProgress({ answered: Number(res.answered) || 0, total: Number(res.total) || 0 });
    setPhase('playing');
    setBusy(false);
  }, [finish]);

  const init = useCallback(async () => {
    setPhase('loading');
    setError('');
    try {
      const s = await assessment.start(gameSlug);
      const pid = s?.public_id;
      if (!pid) throw new Error('Could not start this game.');
      pidRef.current = pid;
      await advance(pid);
    } catch (e) {
      setError(e?.message || 'Could not start this game.');
      setPhase('error');
    }
  }, [gameSlug, advance]);

  useEffect(() => { init(); }, [init]);

  const onAnswer = useCallback(async (response, extra = {}) => {
    const pid = pidRef.current;
    if (!pid || !item || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      await assessment.respond(pid, {
        itemId: item.id,
        response,
        latencyMs: extra.latencyMs,
        confidenceWager: extra.confidenceWager,
      });
      await advance(pid);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not save your answer.' });
      setBusy(false);
    } finally {
      submittingRef.current = false;
    }
  }, [item, advance, showToast]);

  const Mechanic = item ? (MECHANICS[item.mechanic] || DilemmaMechanic) : null;

  return (
    <div className="mx-auto min-h-[70vh] max-w-xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/play" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          <X className="h-4 w-4" /> Exit
        </Link>
        {phase === 'playing' && (
          <span className="text-xs font-medium uppercase tracking-wide text-violet-600 dark:text-violet-300">
            {humanize(gameSlug)}
          </span>
        )}
      </div>

      {(phase === 'loading' || phase === 'completing') && (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-sm">{phase === 'completing' ? 'Scoring your Scout Report…' : 'Loading…'}</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-900/20">
          <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <div className="mt-4 flex justify-center gap-3">
            <button type="button" onClick={init} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              Try again
            </button>
            <button type="button" onClick={() => navigate('/play')} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
              Back to hub
            </button>
          </div>
        </div>
      )}

      {phase === 'playing' && item && (
        <div>
          <ProgressBar answered={progress.answered} total={progress.total} chapter={item.chapter?.title} />
          <div className="mt-6">
            <h2 className="text-xl font-semibold leading-snug text-gray-900 dark:text-gray-50">{item.prompt}</h2>
            {item.subprompt && <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">{item.subprompt}</p>}
          </div>
          <div className="mt-6">
            <Mechanic item={item} onAnswer={onAnswer} busy={busy} />
          </div>
        </div>
      )}

      {phase === 'reveal' && (
        <Reveal slug={gameSlug} result={result} xp={xp} badges={badges} onReplay={init} />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-red-600' : toast.kind === 'success' ? 'bg-emerald-600' : 'bg-gray-900 dark:bg-gray-700'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
