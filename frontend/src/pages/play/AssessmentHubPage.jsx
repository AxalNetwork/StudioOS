// Task #2 — Assessment hub (/play). Lists playable games, the caller's current
// archetype + skills radar, an XP/level bar, and a badge wall. Consumes only the
// `assessment` namespace in lib/api.js (games / myResults / myBadges).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, RotateCcw, IdCard, Trophy, Loader2 } from 'lucide-react';
import { assessment } from '../../lib/api';
import { useToast } from '../../components/useToast';
import PageExplainer from '../../components/PageExplainer';
import SkillRadar from '../../components/play/SkillRadar';
import { archetypeMeta, iconFor, humanize, levelProgress } from '../../lib/assessmentMeta';

function LevelBar({ xp }) {
  const p = levelProgress(xp);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-violet-600 dark:text-violet-300">Level</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-gray-50">{p.level}</div>
        </div>
        <div className="text-right text-xs text-gray-500 dark:text-gray-400">
          {p.xp} XP · {p.toNext} to level {p.level + 1}
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${p.pct}%` }} />
      </div>
    </div>
  );
}

function ArchetypeSummary({ result }) {
  const meta = archetypeMeta(result?.archetype_slug);
  const label = meta?.label || result?.archetype_label;
  if (!label) return null;
  const Icon = iconFor(meta?.icon);
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start gap-4">
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: meta?.accent || '#7c3aed' }}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Your archetype</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-50">{label}</div>
          {meta?.tagline && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{meta.tagline}</p>}
        </div>
      </div>
      {result?.skill_vector && Object.keys(result.skill_vector).length > 0 && (
        <div className="mt-3">
          <SkillRadar skillVector={result.skill_vector} height={240} />
        </div>
      )}
      <Link
        to="/play/card"
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:underline dark:text-violet-300"
      >
        <IdCard className="h-4 w-4" /> View &amp; share your card
      </Link>
    </div>
  );
}

function GameCard({ game, played, busy, onPlay }) {
  return (
    <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{game.title}</h3>
          {played && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
              Completed
            </span>
          )}
        </div>
        {game.subtitle && <p className="mt-0.5 text-sm font-medium text-violet-600 dark:text-violet-300">{game.subtitle}</p>}
        {game.description && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{game.description}</p>}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => onPlay(game.slug)}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : played ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        {played ? 'Play again' : 'Play'}
      </button>
    </div>
  );
}

export default function AssessmentHubPage() {
  const { toast, showToast } = useToast();
  const [games, setGames] = useState([]);
  const [results, setResults] = useState([]);
  const [badgeData, setBadgeData] = useState({ xp: 0, level: 1, badges: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, r, b] = await Promise.all([
        assessment.games().catch(() => ({ games: [] })),
        assessment.myResults().catch(() => ({ results: [] })),
        assessment.myBadges().catch(() => ({ xp: 0, level: 1, badges: [] })),
      ]);
      setGames(Array.isArray(g?.games) ? g.games : []);
      setResults(Array.isArray(r?.results) ? r.results : []);
      setBadgeData({
        xp: Number(b?.xp) || 0,
        level: Number(b?.level) || 1,
        badges: Array.isArray(b?.badges) ? b.badges : [],
      });
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load your profile.' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const playedTracks = useMemo(() => new Set(results.map((r) => r.track)), [results]);
  const latest = results[0] || null;

  const onPlay = useCallback((slug) => {
    // The player page owns start/resume; just deep-link to it.
    window.location.assign(`/play/${slug}`);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Play &amp; Discover</h1>
      <PageExplainer pageKey="assessment_hub" />

      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              {games.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                  No games are available yet. Check back soon.
                </div>
              ) : (
                games.map((g) => (
                  <GameCard key={g.slug} game={g} played={playedTracks.has(g.track)} busy={false} onPlay={onPlay} />
                ))
              )}
            </div>
          </div>

          <div className="space-y-6">
            <LevelBar xp={badgeData.xp} />
            {latest ? (
              <ArchetypeSummary result={latest} />
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                Play your first game to reveal your archetype.
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Badges</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">{badgeData.badges.length}</span>
              </div>
              {badgeData.badges.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No badges yet — earn them by completing games.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {badgeData.badges.map((b) => {
                    const Icon = iconFor(b.icon);
                    return (
                      <div
                        key={b.slug}
                        title={b.description || b.label}
                        className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 p-3 text-center dark:border-gray-700"
                      >
                        <Icon className="h-6 w-6 text-violet-600 dark:text-violet-300" />
                        <span className="text-xs font-medium leading-tight text-gray-700 dark:text-gray-300">
                          {b.label || humanize(b.slug)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            toast.kind === 'error' ? 'bg-red-600' : 'bg-gray-900 dark:bg-gray-700'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
