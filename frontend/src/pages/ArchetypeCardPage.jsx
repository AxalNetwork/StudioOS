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
import { Loader2, Lock } from 'lucide-react';
import { api, assessment } from '../lib/api';
import { reportError } from '../lib/log';
import { PhoneBar, Unreadable, usePhoneWidth } from '../ui';
import { EadwynMenuButton } from './profile/ProfileFrame';
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
  ARCHETYPES,
} from '../lib/assessmentMeta';

// D620 — a complement chip is edged in that archetype's own colour. The chips
// are labels (ARCHETYPES[slug].complements), so the colour is looked up by
// label; a label no archetype carries keeps the hairline grey.
const ACCENT_BY_LABEL = Object.fromEntries(Object.values(ARCHETYPES).map((a) => [a.label, a.accent]));
export function complementAccent(label) {
  return ACCENT_BY_LABEL[label] || '#ececf1';
}

export function confidencePct(value) {
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

// The page's own styles, shared by both layouts. D702 (#1664) adds the phone
// banner's rules after them: a 4:3 ratio and the canvas's bottom gradient
// (SMP:25), in classes of their own, so `.acp-hero` keeps 21:9 and `.acp-well`
// draws no gradient (D620) at 1024px and up.
const ACP_STYLE = `
  .acp-lbl { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
  .acp-mono { font-family: 'Roboto Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .acp-card { border-radius: 16px; box-shadow: 0 1px 2px rgba(24,24,27,.03); overflow: hidden; }
  .acp-hero { position: relative; aspect-ratio: 21 / 9; background: linear-gradient(115deg, #5b21b6 0%, #7c3aed 48%, #6d28d9 100%); overflow: hidden; }
  .acp-hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
  .acp-split { position: absolute; inset: 0; display: grid; grid-template-columns: 1fr 1fr; }
  .acp-split img { position: relative; width: 100%; height: 100%; object-fit: cover; }
  /* D620 — the still carries its own #140c26 well down the left, so the
     overlay draws no gradient of its own: only a text shadow. */
  .acp-well {
    position: absolute; left: 0; bottom: 0; width: 42%; min-width: min(360px, 100%);
    padding: 0 24px 29px; box-sizing: border-box;
    color: #fff;
    pointer-events: none;
  }
  .acp-bloom { color: #c4b5fd; }
  .acp-chip { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; padding: 3px 9px; border-radius: 99px; white-space: nowrap; background: rgba(255,255,255,.16); color: #fff; border: 1px solid rgba(255,255,255,.3); }
  .acp-pill { background: #7c3aed; border-color: #7c3aed; text-transform: none; letter-spacing: 0; font-size: 11px; }
  .acp-title { margin: 8px 0 0; font-size: 32px; font-weight: 900; letter-spacing: -.025em; line-height: 1.05; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.55); }
  .acp-tagline { font-size: 15px; font-weight: 500; color: #f4f0fe; text-shadow: 0 1px 6px rgba(0,0,0,.5); }
  .acp-hairline { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; }
  .acp-wellbox { border-radius: 12px; padding: 16px 18px; background: #f8f7fb; border: 1px solid #ececf1; }
  .dark .acp-wellbox { background: #18181b; border-color: #27272a; }
  .acp-comp { display: inline-flex; align-items: center; font-size: 11.5px; font-weight: 600; padding: 5px 11px; border-radius: 99px; border: 1px solid #ececf1; background: #fff; color: #18181b; }
  .dark .acp-comp { background: #111827; color: #f4f4f5; }
  .acp-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; }
  @media (max-width: 720px) {
    .acp-well { width: 100%; min-width: 0; padding: 0 14px 15px; }
    .acp-title { font-size: 24px; }
    .acp-tagline { display: none; }
  }
  .acp-hero.acp-hero-phone { aspect-ratio: 4 / 3; border-radius: 16px; }
  .acp-fade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(20,12,38,0) 35%, rgba(20,12,38,.86) 100%); pointer-events: none; }
  .acp-phone-well { position: absolute; left: 16px; right: 16px; bottom: 14px; display: flex; flex-direction: column; gap: 4px; color: #fff; }
  .acp-phone-well .acp-tagline { display: block; font-size: 13px; color: #ede9fe; }
  .acp-phone-well .acp-title { margin: 4px 0 0; font-size: 24px; }
`;

// ---------------------------------------------------------------------------
// D702 (#1664) — board S8m, the card on a phone (SMP:25, :146-152).
// ---------------------------------------------------------------------------

export const PHONE_TITLE = 'Archetype card';
export const PHONE_SUB = 'Read from your conversations with Eadwyn, not a quiz.';
// The canvas's "Members see your archetype name and tagline" is not true:
// `/published-members` serves each member's name, role and archetype (and a
// values band to a caller who has published), and no tagline (D702).
export const PUBLISHED_SUB = 'Members see your name, role and archetype. Those who publish theirs also see how your values compare.';

function PhoneHeading({ children }) {
  return <h2 className="mb-2 text-[10px] font-extrabold uppercase tracking-wide text-gray-700 dark:text-gray-300">{children}</h2>;
}

function PhoneList({ items, dot, testid }) {
  return (
    <div className="border-t border-[#f0eff3] dark:border-gray-800" data-testid={testid}>
      {items.map((t) => (
        <div key={t} className="flex min-h-[44px] items-start gap-[9px] border-b border-[#f0eff3] py-2.5 text-[14px] leading-snug text-gray-900 dark:border-gray-800 dark:text-gray-100">
          <span className="mt-[7px] h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" />
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
}

/** "Shown to members": the existing publish toggle, as a row. */
export function PublishedRow({ publish, onToggle, onRetry }) {
  const ready = publish?.state === 'ready';
  const on = ready && publish.published === true;
  return (
    <div className="flex min-h-[56px] items-center gap-3 border-y border-[#f0eff3] py-[9px] dark:border-gray-800" data-testid="archetype-published-row">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-gray-900 dark:text-gray-100" id="archetype-published-label">Published</div>
        <div className="mt-0.5 text-[12px] text-[#615c6e] dark:text-gray-400">{PUBLISHED_SUB}</div>
        {ready && publish.saveFailed && <div role="alert" className="mt-0.5 text-[12px] font-semibold text-red-700 dark:text-red-300">Your choice was not saved. Try again.</div>}
      </div>
      {publish?.state === 'loading' && <span className="text-[12px] text-gray-600 dark:text-gray-400">Loading…</span>}
      {publish?.state === 'unreadable' && <Unreadable what="Whether yours is published" claim="" onRetry={onRetry} />}
      {ready && (
        <button
          type="button"
          role="switch"
          aria-checked={on ? 'true' : 'false'}
          aria-labelledby="archetype-published-label"
          disabled={publish.saving}
          onClick={() => onToggle?.(!on)}
          className={`relative h-6 w-10 flex-none rounded-full disabled:opacity-60 ${on ? 'bg-violet-600' : 'bg-[#d4d1dc] dark:bg-gray-600'}`}
          data-testid="archetype-published-switch"
        >
          <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white ${on ? 'right-[3px]' : 'left-[3px]'}`} />
        </button>
      )}
    </div>
  );
}

/**
 * The page below 1024px: `PhoneBar` in place of the crumb row, the 4:3 banner
 * with the canvas's gradient, the canvas's sections stacked, "Shown to
 * members", then the page's other sections, so nothing is lost. A founder's
 * bar carries the Eadwyn menu button; no other role's does, since the menu
 * is a founder's.
 */
export function PhoneArchetypePage({ activeRole, latest, meta, sex, pct, title, accent, licence, xp, onRetryXp, publish, onTogglePublish, onRetryPublish, states, sections }) {
  return (
    <div className="acp-root -m-4 min-h-full bg-white text-gray-900 md:-m-6 lg:m-0 dark:bg-gray-950 dark:text-gray-100" data-testid="archetype-card-page" data-phone="true">
      <style>{ACP_STYLE}</style>
      <PhoneBar
        back={{ label: 'Studio', to: '/studio' }}
        title={PHONE_TITLE}
        sub={PHONE_SUB}
        action={activeRole === 'founder' ? <EadwynMenuButton active="/studio/archetype" /> : undefined}
      />
      <div className="flex flex-col gap-5 px-[22px] pb-4 pt-4">
        {states}
        {latest && (
          <>
            <div className="acp-hero acp-hero-phone" data-testid="archetype-banner" data-sex={sex} style={{ '--arch-accent': accent }}>
              {sex === 'both' ? (
                <div className="acp-split">
                  <BannerImg src={archetypeBanner(latest.slug, 'f')} />
                  <BannerImg src={archetypeBanner(latest.slug, 'm')} />
                </div>
              ) : (
                <BannerImg src={archetypeBanner(latest.slug, sex)} />
              )}
              <div className="acp-fade" aria-hidden="true" />
              <div className="acp-phone-well">
                <span className="acp-chip self-start" data-testid="archetype-licence">{licence}</span>
                <span className="acp-lbl acp-bloom mt-1">Primary archetype</span>
                <span className="flex items-baseline gap-2">
                  <h2 className="acp-title" data-testid="archetype-title">{title}</h2>
                  {pct != null && <span className="text-[12px] font-extrabold text-[#c4b5fd]" data-testid="archetype-confidence-pill">{pct}%</span>}
                </span>
                {meta?.tagline && <span className="acp-tagline" data-testid="archetype-tagline">{meta.tagline}</span>}
              </div>
              <div className="acp-hairline" style={{ background: accent }} aria-hidden="true" />
            </div>
            {meta?.tagline && <section><PhoneHeading>Core approach</PhoneHeading><p className="text-[14.5px] leading-relaxed text-[#2b2735] dark:text-gray-200">{meta.tagline}</p></section>}
            {meta?.description && <section><PhoneHeading>Description</PhoneHeading><p className="text-[14.5px] leading-relaxed text-[#2b2735] dark:text-gray-200">{meta.description}</p></section>}
            <section><PhoneHeading>Strengths</PhoneHeading><PhoneList items={meta?.strengths || []} dot="#15803d" testid="archetype-strengths" /></section>
            <section><PhoneHeading>Blind spots</PhoneHeading><PhoneList items={meta?.blindSpots || []} dot="#b45309" testid="archetype-blindspots" /></section>
            <section data-testid="archetype-complements">
              <PhoneHeading>Complements</PhoneHeading>
              <div className="flex flex-wrap gap-2">
                {(meta?.complements || []).map((c) => (
                  <span key={c} className="acp-comp min-h-9" style={{ borderColor: complementAccent(c) }}>
                    <span className="acp-dot" style={{ background: complementAccent(c) }} aria-hidden="true" />
                    {c}
                  </span>
                ))}
              </div>
            </section>
            <section><PhoneHeading>Shown to members</PhoneHeading><PublishedRow publish={publish} onToggle={onTogglePublish} onRetry={onRetryPublish} /></section>
            <div className="acp-wellbox" data-testid="archetype-confidence">
              <div className="acp-lbl text-[#a1a1aa]">Confidence</div>
              <div className="mt-1.5 flex items-baseline gap-2.5">
                <span className="acp-mono text-[28px] font-bold tracking-[-0.02em] text-[#7c3aed] dark:text-violet-300">{pct != null ? `${pct}%` : 'N/A'}</span>
                <span className="text-[12.5px] text-[#71717a] dark:text-gray-400">{pct != null ? 'from your conversation with Eadwyn' : 'no reading recorded yet'}</span>
              </div>
              <div className="mt-4"><XpBar xp={xp} onRetry={onRetryXp} /></div>
            </div>
            <div className="acp-wellbox">
              <div className="acp-lbl text-[#a1a1aa]">How we read this</div>
              <div className="mt-1.5 text-[12.5px] leading-[1.5] text-[#3f3f46] dark:text-gray-300">From your conversation with Eadwyn, not a quiz.</div>
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="acp-lbl text-[#71717a] dark:text-gray-400">Illustration</span>
              <span className="acp-mono text-[11px] text-[#71717a] dark:text-gray-400" data-testid="archetype-illustration">{sex === 'both' ? 'm · f (both)' : sex}</span>
            </div>
          </>
        )}
        {sections}
      </div>
    </div>
  );
}

export default function ArchetypeCardPage({ activeRole }) {
  const audience = archetypeAudienceFromRole(activeRole);
  const phone = usePhoneWidth();
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
  const licence = archetypeLicenceTitle(audience).replace(/ archetype$/, '');

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

  // The desktop's crumb row; on a phone `PhoneBar` takes its place.
  const crumbs = (
    <>
      {/* D620 — board A5's crumb row. "‹ Back to studio" sits at the card's
          foot; this is the way back from every state, the empty and locked
          ones included. */}
      <div className="mb-4 flex items-center justify-between" data-testid="archetype-crumbs">
        <Link to="/studio" className="text-[12px] font-semibold text-[#a1a1aa] hover:text-[#7c3aed]" data-testid="archetype-crumb-studio">‹ Studio</Link>
        <span className="acp-mono text-[11px] text-[#a1a1aa]">Profile &amp; Fit · Archetype</span>
      </div>
    </>
  );
  // The states and the sections both layouts draw: loading, unreadable,
  // locked and empty stay as they are on a phone (D702, #1664).
  const stateBlocks = (
    <>
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

    </>
  );
  const sectionBlocks = (
    <>
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
    </>
  );

  if (phone) {
    return (
      <PhoneArchetypePage
        activeRole={activeRole} latest={latest} meta={meta} sex={sex} pct={pct} title={title} accent={accent} licence={licence}
        xp={xp} onRetryXp={readXp} publish={publish} onTogglePublish={togglePublish} onRetryPublish={readPublish}
        states={stateBlocks} sections={sectionBlocks}
      />
    );
  }

  return (
    <div className="acp-root max-w-5xl mx-auto" data-testid="archetype-card-page">
      <style>{ACP_STYLE}</style>

      {crumbs}

      {stateBlocks}

      {latest && (
        <article className="acp-card bg-white dark:bg-gray-900 border border-[#ececf1] dark:border-gray-700" style={{ '--arch-accent': accent }}>
          {/* D620 — board A5–A8: the banner keeps 21:9 and D325's split for
              `both` (an unset illustration also reads `both`, so resolving it
              to one still would show a man to everyone who never chose). The
              overlay sits in the still's own dark well, and the 3px hairline
              in the archetype's colour is the banner's own bottom edge. */}
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="acp-chip" data-testid="archetype-licence">{licence}</span>
                <span className="acp-lbl acp-bloom">Primary archetype</span>
              </div>
              <h1 className="acp-title" data-testid="archetype-title">{title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {meta?.tagline && <span className="acp-tagline">{meta.tagline}</span>}
                {pct != null && (
                  <span className="acp-chip acp-mono acp-pill" data-testid="archetype-confidence-pill">{pct}% confidence</span>
                )}
              </div>
            </div>
            <div className="acp-hairline" style={{ background: accent }} data-testid="archetype-hairline" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-[22px] md:px-[40px] md:pt-[28px] md:pb-[26px]">
            <div className="md:col-span-7 grid gap-[22px] content-start">
              {meta?.tagline && (
                <div>
                  <div className="acp-lbl text-[#15803d] dark:text-green-500">Core approach</div>
                  <div className="mt-1.5 text-[18px] font-bold tracking-[-0.015em] text-[#18181b] dark:text-gray-100">{meta.tagline}</div>
                  {meta?.lean && <div className="acp-lbl mt-2 text-[#7c3aed] dark:text-violet-300">{meta.lean}</div>}
                </div>
              )}
              {meta?.description && (
                <div>
                  <div className="acp-lbl text-[#b45309] dark:text-amber-500">Description</div>
                  <p className="mt-1.5 max-w-[560px] text-[14px] leading-[1.55] text-[#3f3f46] dark:text-gray-300">{meta.description}</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div data-testid="archetype-strengths">
                  <div className="acp-lbl text-[#15803d] dark:text-green-500">Strengths</div>
                  <div className="mt-2 grid gap-[7px]">
                    {(meta?.strengths || []).map((s) => (
                      <div key={s} className="flex items-start gap-[9px] text-[12.5px] leading-[1.5] text-[#3f3f46] dark:text-gray-300">
                        <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#15803d]" aria-hidden="true" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div data-testid="archetype-blindspots">
                  <div className="acp-lbl text-[#b45309] dark:text-amber-500">Blind spots</div>
                  <div className="mt-2 grid gap-[7px]">
                    {(meta?.blindSpots || []).map((b) => (
                      <div key={b} className="flex items-start gap-[9px] text-[12.5px] leading-[1.5] text-[#3f3f46] dark:text-gray-300">
                        <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#b45309]" aria-hidden="true" />
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="md:col-span-5 grid gap-3 content-start">
              <div className="acp-wellbox" data-testid="archetype-confidence">
                <div className="acp-lbl text-[#a1a1aa]">Confidence</div>
                <div className="mt-1.5 flex items-baseline gap-2.5">
                  <span className="acp-mono text-[28px] font-bold tracking-[-0.02em] text-[#7c3aed] dark:text-violet-300">{pct != null ? `${pct}%` : 'N/A'}</span>
                  <span className="text-[12.5px] text-[#a1a1aa]">{pct != null ? 'from your conversation with Eadwyn' : 'no reading recorded yet'}</span>
                </div>
                {pct != null && (
                  <div className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-[#ececf1] dark:bg-gray-700">
                    <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {/* D325's Level / XP bar, which the board does not draw: it
                    stays, under Confidence (S1's recommendation 3). */}
                <div className="mt-4">
                  <XpBar xp={xp} onRetry={readXp} />
                </div>
              </div>
              <div className="acp-wellbox" data-testid="archetype-complements">
                <div className="acp-lbl text-[#a1a1aa]">Complements</div>
                <div className="mt-[9px] flex flex-wrap gap-1.5">
                  {(meta?.complements || []).map((c) => (
                    <span key={c} className="acp-comp" style={{ borderColor: complementAccent(c) }}>
                      <span className="acp-dot" style={{ background: complementAccent(c) }} aria-hidden="true" />
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mt-[9px] text-[11.5px] leading-[1.5] text-[#a1a1aa]">Archetypes whose strengths sit where this one’s blind spots are.</div>
              </div>
              <div className="acp-wellbox">
                <div className="acp-lbl text-[#a1a1aa]">How we read this</div>
                <div className="mt-1.5 text-[12.5px] leading-[1.5] text-[#3f3f46] dark:text-gray-300">From your conversation with Eadwyn, not a quiz.</div>
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="acp-lbl text-[#a1a1aa]">Illustration</span>
                <span className="acp-mono text-[11px] text-[#a1a1aa]" data-testid="archetype-illustration">{sex === 'both' ? 'm · f (both)' : sex}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#ececf1] dark:border-gray-700 px-[22px] md:px-[40px] pt-[14px] pb-[22px]">
            <Link
              to="/studio"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#7c3aed] dark:text-violet-300 hover:text-[#6d28d9]"
              data-testid="archetype-back"
            >
              ‹ Back to studio
            </Link>
            <span className="acp-mono text-[10.5px] text-[#a1a1aa]" data-testid="archetype-slug">{latest.slug}</span>
          </div>
        </article>
      )}

      {sectionBlocks}
    </div>
  );
}
