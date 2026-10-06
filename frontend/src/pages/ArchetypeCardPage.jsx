/**
 * Full archetype page — `/studio/archetype`.
 *
 * Compact /studio stays the pixel-art preview. This route is the cinematic
 * card: a 21:9 banner (sex-aware; `both` is a 50/50 split), overlay well on
 * the left, and the locked ARCHETYPES strengths / blind spots / matching.
 * Copy is static per-slug metadata, not user data. Missing banner files hide
 * that slot rather than leaving a hole.
 *
 * D602 — the assessment fallback is retired (PROFILING_V2.md decision a): the
 * card reads Eadwyn's conversational archetype (`GET /best-fit/me`) and
 * nothing else. A person with no conversational signal sees the empty state,
 * never a gamified-assessment result standing in for it.
 *
 * D619 (#1006) — below the card, the canvas's three sections (`Studio ·
 * Archetype card` A24–A30): the two-layer skills radar, the evolution
 * timeline, and the matches with the members who published them. Each reads
 * its own source and retries on its own (components/profile/ArchetypeSections).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { api, assessment } from '../lib/api';
import { reportError } from '../lib/log';
import { Unreadable } from '../ui';
import { XpBar } from '../components/profile/xpBar';
import { openPaywall } from '../components/PaywallModal';
import { archetypeLock, lockedLine, lockedPlanName } from '../lib/archetypeLock';
import { cardArchetype, matchGroups, matchSlugs, radarLayers, radarModel, timelineView } from '../lib/archetypeCardV2';
import { HistorySection, MatchesSection, SkillsSection } from '../components/profile/ArchetypeSections';
import {
  archetypeAudienceFromRole,
  archetypeBanner,
  archetypeLicenceTitle,
  archetypeMeta,
} from '../lib/assessmentMeta';

function confidencePct(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value * 100))) : null;
  }
  if (typeof value === 'object') {
    const nums = Object.values(value).map(Number).filter(Number.isFinite);
    if (!nums.length) return null;
    return Math.max(0, Math.min(100, Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100)));
  }
  return null;
}

function BannerImg({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt=""
      className={className}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export default function ArchetypeCardPage({ activeRole }) {
  const audience = archetypeAudienceFromRole(activeRole);
  const [fit, setFit] = useState({ data: null, error: '' });
  const [xp, setXp] = useState({ state: 'loading', data: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setFit({ data: null, error: '' });
    const wire = (p, set, onErr) => p
      .then((d) => { if (alive) set({ data: d, error: '' }); })
      .catch((e) => {
        onErr(e);
        if (alive) set({ data: null, error: e?.message || 'Failed to load' });
      });
    wire(api.bestFit.me(), setFit, (e) => reportError('ArchetypeCard:bestFit', e));
    return () => { alive = false; };
  }, [retry]);

  // D325 — the Level / XP bar reads its own source, and retries on its own.
  const readXp = useCallback(() => {
    setXp({ state: 'loading', data: null });
    assessment.myXp()
      .then((d) => setXp({ state: 'ready', data: d }))
      .catch((e) => { reportError('ArchetypeCard:xp', e); setXp({ state: 'unreadable', data: null }); });
  }, []);
  useEffect(() => { readXp(); }, [readXp]);

  const fitData = fit.data;
  // D594 — a locked reply carries no archetype; draw the canvas's locked state
  // (board S12) and nothing else. No banner, no copy, nothing blurred behind.
  const lock = archetypeLock(fitData);
  const latest = lock ? null : cardArchetype(fitData);
  const meta = latest ? archetypeMeta(latest.slug) : null;
  const sex = fitData?.archetype_sex === 'm' || fitData?.archetype_sex === 'f' || fitData?.archetype_sex === 'both'
    ? fitData.archetype_sex
    : 'both';
  const loading = !fit.data && !fit.error;
  const failed = !lock && !latest && !!fit.error && !loading;
  const pct = latest ? confidencePct(latest.confidence) : null;
  const title = latest?.label || meta?.label || latest?.slug;
  const accent = meta?.accent || '#7c3aed';

  // D619 — the skills radar reads its own source. Skills are never locked
  // (D594), so it shows whatever the archetype read said.
  const [skills, setSkills] = useState({ state: 'loading', data: null });
  const readSkills = useCallback(() => {
    setSkills({ state: 'loading', data: null });
    api.skills.getMyEvidence()
      .then((d) => setSkills(Array.isArray(d?.axes) && d.axes.length ? { state: 'ready', data: d } : { state: 'unreadable', data: null }))
      .catch((e) => { reportError('ArchetypeCard:skills', e); setSkills({ state: 'unreadable', data: null }); });
  }, []);
  useEffect(() => { readSkills(); }, [readSkills]);
  const skillsModel = useMemo(
    () => (skills.state === 'ready' ? radarModel(radarLayers(skills.data), skills.data.corroborated_at) : null),
    [skills],
  );

  // The timeline is the shown archetype's persona: someone with two personas
  // sees the one the card shows.
  const slug = latest?.slug || null;
  const persona = latest ? (fitData?.archetype?.persona || audience) : null;
  const [history, setHistory] = useState({ state: 'loading', items: null });
  const readHistory = useCallback(() => {
    if (!persona) return;
    setHistory({ state: 'loading', items: null });
    api.profileHistory(persona)
      .then((d) => setHistory(Array.isArray(d?.items) ? { state: 'ready', items: d.items } : { state: 'unreadable', items: null }))
      .catch((e) => { reportError('ArchetypeCard:history', e); setHistory({ state: 'unreadable', items: null }); });
  }, [persona]);
  useEffect(() => { readHistory(); }, [readHistory]);
  const historyView = useMemo(
    () => (history.state === 'ready' ? timelineView(history.items, persona, slug) : null),
    [history, persona, slug],
  );

  // Matches: the types in the copy, and the members who published one of them.
  const slugKey = useMemo(() => (slug ? matchSlugs(slug).join(',') : ''), [slug]);
  const [members, setMembers] = useState({ state: 'loading', reply: null });
  const readMembers = useCallback((quiet = false) => {
    if (!slug) return;
    if (!slugKey) { setMembers({ state: 'ready', reply: { items: [], more: false } }); return; }
    if (!quiet) setMembers({ state: 'loading', reply: null });
    api.profilePublishedMembers(slugKey.split(','))
      .then((d) => setMembers(
        d?.locked ? { state: 'locked', reply: null }
          : Array.isArray(d?.items) ? { state: 'ready', reply: d }
            : { state: 'unreadable', reply: null },
      ))
      .catch((e) => { reportError('ArchetypeCard:matches', e); setMembers({ state: 'unreadable', reply: null }); });
  }, [slug, slugKey]);
  useEffect(() => { readMembers(); }, [readMembers]);
  const groups = useMemo(() => (slug ? matchGroups(slug, members.reply) : []), [slug, members.reply]);

  const [publish, setPublish] = useState({ state: 'loading', published: null, saving: false, saveFailed: false });
  const readPublish = useCallback(() => {
    setPublish({ state: 'loading', published: null, saving: false, saveFailed: false });
    api.archetypePublished()
      .then((d) => setPublish(typeof d?.published === 'boolean'
        ? { state: 'ready', published: d.published, saving: false, saveFailed: false }
        : { state: 'unreadable', published: null, saving: false, saveFailed: false }))
      .catch((e) => {
        reportError('ArchetypeCard:published', e);
        setPublish({ state: 'unreadable', published: null, saving: false, saveFailed: false });
      });
  }, []);
  useEffect(() => { if (slug) readPublish(); }, [slug, readPublish]);
  const togglePublish = useCallback((next) => {
    setPublish((p) => ({ ...p, saving: true, saveFailed: false }));
    api.setArchetypePublished(next)
      .then((d) => {
        setPublish({ state: 'ready', published: d?.published === true, saving: false, saveFailed: false });
        // D605 compares values only for a caller who has published, so the
        // list is read again for its values lines.
        readMembers(true);
      })
      .catch((e) => {
        reportError('ArchetypeCard:publish', e);
        setPublish((p) => ({ ...p, saving: false, saveFailed: true }));
      });
  }, [readMembers]);

  return (
    <div className="acp-root max-w-5xl mx-auto" data-testid="archetype-card-page">
      <style>{`
        .acp-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
        .acp-mono { font-family: 'Roboto Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
        .acp-card { border-radius: 16px; box-shadow: 0 1px 2px rgba(24,24,27,.03); overflow: hidden; }
        .acp-hero { position: relative; aspect-ratio: 21 / 9; background: linear-gradient(115deg, #5b21b6 0%, #7c3aed 48%, #6d28d9 100%); overflow: hidden; }
        .acp-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
        .acp-split { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr 1fr; }
        .acp-split img { position: relative; width: 100%; height: 100%; object-fit: cover; }
        .acp-well {
          position: absolute; inset: 0 auto 0 0; width: min(46%, 440px);
          padding: 28px 26px 24px;
          background: linear-gradient(115deg, rgba(20,12,38,.94) 0%, rgba(91,33,182,.62) 58%, rgba(20,12,38,.06) 100%);
          color: #f5f3ff;
          display: flex; flex-direction: column; justify-content: flex-end;
          pointer-events: none;
        }
        .acp-bloom { color: #c4b5fd; }
        @media (max-width: 720px) {
          .acp-hero { aspect-ratio: 4 / 3; }
          .acp-well {
            inset: auto 0 0 0; width: 100%;
            background: linear-gradient(180deg, rgba(20,12,38,0) 0%, rgba(20,12,38,.94) 55%);
          }
        }
      `}</style>

      <Link
        to="/studio"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#7c3aed] dark:text-violet-300 hover:text-[#6d28d9] mb-4"
        data-testid="archetype-back"
      >
        <ArrowLeft size={14} strokeWidth={2.5} /> Back to studio
      </Link>

      {loading && (
        <div className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 p-[48px] flex justify-center text-gray-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      )}

      {failed && (
        <div className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 p-[22px]" data-testid="archetype-unreadable">
          <Unreadable what="Your archetype" claim="This is not a claim that you have none." onRetry={() => setRetry((n) => n + 1)} />
        </div>
      )}

      {lock && (
        <div
          className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700 p-[22px]"
          data-testid="archetype-page-locked"
        >
          <div className="acp-lbl text-[#a1a1aa] dark:text-gray-400">{archetypeLicenceTitle(audience)}</div>
          <div
            className="mt-[14px] rounded-[16px] border border-[#ece8f5] dark:border-[#d4cce8] bg-[#f8f7fb] dark:bg-[#ece8f5] flex flex-col items-center justify-center gap-[10px] px-[22px] py-[48px] text-center cursor-not-allowed"
            aria-disabled="true"
          >
            <Lock size={22} className="text-[#71717a]" aria-hidden="true" />
            <span className="text-[13.5px] leading-[1.5] text-[#52525b]" data-testid="archetype-locked-line">{lockedLine(lock)}</span>
          </div>
          <button
            type="button"
            onClick={() => openPaywall(lock.tier || 'growth', lockedLine(lock))}
            className="mt-4 rounded-lg bg-[#7c3aed] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#6d28d9]"
            data-testid="archetype-upgrade"
          >
            {lockedPlanName(lock) ? `See the ${lockedPlanName(lock)} plan` : 'See the plans'}
          </button>
        </div>
      )}

      {!loading && !failed && !lock && !latest && (
        <div className="acp-card border border-dashed border-[#e4e4e7] dark:border-gray-700 bg-[#fafafa] dark:bg-gray-800/40 p-[22px] text-[12.5px] text-[#71717a] dark:text-gray-400 leading-[1.5]">
          Answer a few archetype questions with Eadwyn to reveal your archetype.
        </div>
      )}

      {latest && (
        <article className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700" style={{ '--arch-accent': accent }}>
          <div className="acp-hero" data-testid="archetype-banner" data-sex={sex}>
            {sex === 'both' ? (
              <div className="acp-split">
                <BannerImg src={archetypeBanner(latest.slug, 'f')} />
                <BannerImg src={archetypeBanner(latest.slug, 'm')} />
              </div>
            ) : (
              <BannerImg src={archetypeBanner(latest.slug, sex)} />
            )}
            <div className="acp-well">
              <div className="acp-lbl acp-bloom mb-2">{archetypeLicenceTitle(audience)}</div>
              <h1 className="text-[28px] font-extrabold tracking-[-0.03em] leading-tight text-white" data-testid="archetype-title">
                {title}
              </h1>
              {meta?.tagline && (
                <p className="mt-1.5 text-[13.5px] text-[#e9d5ff] leading-snug">{meta.tagline}</p>
              )}
              <div className="mt-3 acp-mono text-[12px] font-bold text-[#c4b5fd]">
                {pct != null ? `${pct}% confidence` : 'Confidence not recorded'}
              </div>
            </div>
          </div>

          <div className="p-[22px] flex flex-col gap-5">
            <XpBar xp={xp} onRetry={readXp} />
            {meta?.lean && (
              <div className="acp-lbl text-[#7c3aed] dark:text-violet-300">{meta.lean}</div>
            )}
            {meta?.description && (
              <p className="text-[13.5px] text-[#3f3f46] dark:text-gray-300 leading-[1.55]">{meta.description}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div data-testid="archetype-strengths">
                <div className="acp-lbl text-[#15803d] dark:text-green-500 mb-2">Strengths</div>
                <div className="flex flex-col gap-1.5">
                  {(meta?.strengths || []).map((s) => (
                    <div key={s} className="text-[12.5px] text-[#3f3f46] dark:text-gray-300 flex gap-2">
                      <span className="font-bold text-[#16a34a] dark:text-green-400">+</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div data-testid="archetype-blindspots">
                <div className="acp-lbl text-[#b45309] dark:text-amber-500 mb-2">Likely blind spots</div>
                <div className="flex flex-col gap-1.5">
                  {(meta?.blindSpots || []).map((b) => (
                    <div key={b} className="text-[12.5px] text-[#3f3f46] dark:text-gray-300 flex gap-2">
                      <span className="font-bold text-[#d97706] dark:text-amber-500">!</span>
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div data-testid="archetype-complements">
                <div className="acp-lbl text-[#7c3aed] dark:text-violet-300 mb-2">Compatible complements</div>
                <div className="flex flex-wrap gap-1.5">
                  {(meta?.complements || []).map((c) => (
                    <span
                      key={c}
                      className="text-[11.5px] font-semibold text-[#6d28d9] dark:text-violet-300 bg-[#f5f3ff] dark:bg-violet-900/30 border border-[#ede9fe] dark:border-violet-800 rounded-lg px-2.5 py-1"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </article>
      )}

      {/* D619 — the three sections, once the archetype read has settled. Skills
          always; the history and the matches belong to an archetype, so they
          show with one (or the history's "not classified" line, or the
          matches' lock when the plan withholds the archetype). */}
      {!loading && (
        <div className="mt-9 flex flex-col gap-9" data-testid="archetype-sections">
          <SkillsSection state={skills.state} model={skillsModel} onRetry={readSkills} />
          {latest && (
            <HistorySection state={history.state} view={historyView} cardLabel={title} onRetry={readHistory} />
          )}
          {!latest && !lock && !failed && <HistorySection state="unclassified" />}
          {(latest || lock) && (
            <MatchesSection
              state={lock ? 'locked' : members.state}
              groups={groups}
              reply={members.reply}
              publish={publish}
              onTogglePublish={togglePublish}
              onRetryPublish={readPublish}
              onRetry={() => readMembers()}
            />
          )}
        </div>
      )}
    </div>
  );
}
