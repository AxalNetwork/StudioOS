import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { cyclesApi } from '../../../lib/api/cycles';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, RailFrame, WorkerRail, usePhoneWidth } from '../../../ui';
import DeckReviewerPage from '../../DeckReviewerPage';
import {
  EDIT_PATH, EMPTY_DECK, LINE, NOT_RECORDED, NO_VENTURE, NO_VIEWS, READ_ONLY, TABS, TITLE,
  asList, coverOf, currentVersion, dayLabel, isReadOnly, linkRows, mmss, newLinkHref, noViewsYet,
  readerStats, slideCaption, slideSeconds, ventureQuery, versionLabel, versionRows, weeklyViews,
} from './pitchStudioModel';

/**
 * D894 (#2434) — the Pitch deck studio's shell and the two tabs whose reads are
 * on `main`, built to the "Pitch Deck Studio" canvas (PD2, PD19, PD23–PD26).
 *
 *   /raise/pitch            Decks (PD2): the current deck, its versions, and
 *                           views by week, most read slide and NDA signed.
 *   /raise/pitch/review     Review (PD14): today's reviewer, until #2434 part 6
 *                           reviews a version of the deck itself.
 *   /raise/pitch/analytics  Share & analytics (PD19): one version's readers,
 *                           seconds per slide, and every investor link with
 *                           Withdraw.
 *   /raise/pitch/edit       the deck builder (PitchWorkspacePage), until #2434
 *                           part 4 builds the editor (PD1).
 *
 * WHO. The venture's founder works here. An admin (and anyone else the route
 * admits) reads it: no New deck, no New link, no Withdraw (PD21). The Worker
 * still lets an admin write; #2434 part 1 closes that.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const DANGER_TEXT = 'inline-flex min-h-[32px] items-center px-2 text-[12px] font-bold text-axal-destructive hover:underline dark:text-red-400';
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const PILL_MU = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
const PILL_OK = `${PILL} border-emerald-200 bg-emerald-50 text-axal-positive dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`;
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';

const idle = { status: 'idle', data: null };
const loading = { status: 'loading', data: null };

/**
 * The studio's reads. The venture comes from `?project_id=` (else the first
 * one, written back); each read answers alone, and `reload()` reads them again.
 */
function useStudioReads() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('project_id');
  const [projects, setProjects] = useState(loading);
  const [versions, setVersions] = useState(idle);
  const [module, setModule] = useState(idle);
  const [deck, setDeck] = useState(idle);
  const [engagement, setEngagement] = useState(idle);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    const settle = (set) => (p) => p.then(
      (data) => { if (live) set({ status: 'ok', data }); return data; },
      (e) => { if (live) set({ status: 'error', data: null, error: e }); reportError('pitch-studio:read', e); return undefined; },
    );
    (async () => {
      setProjects(loading);
      const listed = await settle(setProjects)(api.listProjects());
      const list = asList(listed, 'items', 'projects');
      const chosen = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
      if (!chosen) { setVersions(idle); setModule(idle); setDeck(idle); setEngagement(idle); return; }
      if (String(chosen.id) !== String(requested)) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(chosen.id)); return next; }, { replace: true });
      }
      setVersions(loading); setModule(loading);
      const [v] = await Promise.all([
        settle(setVersions)(api.deckListVersions(chosen.id)),
        settle(setModule)(cyclesApi.module('raise', chosen.id, 'pitch-deck')),
      ]);
      const current = currentVersion(asList(v, 'versions', 'decks'));
      if (!current?.id) { setDeck(idle); setEngagement(idle); return; }
      setDeck(loading); setEngagement(loading);
      await Promise.all([
        settle(setDeck)(api.deckGet(current.id).then((r) => r?.deck || r)),
        settle(setEngagement)(api.deckEngagement(current.id)),
      ]);
    })();
    return () => { live = false; };
  }, [requested, tick]);

  const list = asList(projects.data, 'items', 'projects');
  const project = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
  return { projects, project, versions, module, deck, engagement, reload: () => setTick((t) => t + 1) };
}

export default function PitchStudio({ tab = 'decks' }) {
  const { user } = useAuth() || {};
  const readOnly = isReadOnly(user);
  const reads = useStudioReads();
  const projectId = reads.project?.id || null;
  const q = ventureQuery(projectId);

  const rail = (
    <WorkerRail
      workspace="Raise"
      // The founder's tool, whoever reads it: a reader is told by the banner.
      role="founder"
      note="The studio reads your deck's versions and the views on your investor links. The figures on a card come from the deck builder until the source chips land."
      data-testid="pitch-studio-rail"
    />
  );

  return (
    <RailFrame rail={rail} data-testid="pitch-studio">
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid={`pitch-studio-${tab}`}>
        <StudioHeader tab={tab} q={q} readOnly={readOnly} showNew={tab === 'decks' && !readOnly && Boolean(projectId)} />
        {reads.projects.status === 'error' ? (
          <ReadFailed text="Your ventures could not be read." onRetry={reads.reload} testId="pitch-studio-projects-error" />
        ) : reads.projects.status === 'ok' && !reads.project ? (
          <div className={`${CARD} flex flex-col items-start gap-3 p-7`} data-testid="pitch-studio-no-venture">
            <span className={`text-[15px] font-extrabold ${INK}`}>{NO_VENTURE}</span>
            <Link to="/studio" className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300">Open Studio</Link>
          </div>
        ) : tab === 'review' ? (
          <DeckReviewerPage embedded />
        ) : tab === 'analytics' ? (
          <StudioAnalytics reads={reads} readOnly={readOnly} />
        ) : (
          <StudioDecks reads={reads} readOnly={readOnly} q={q} />
        )}
      </div>
    </RailFrame>
  );
}

function StudioHeader({ tab, q, readOnly, showNew }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={`m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] ${INK}`}>{TITLE}</h1>
          <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">{LINE}</p>
        </div>
        {/* PD3 (/raise/pitch/new) is #2434 part 3; until then a new deck starts in the builder. */}
        {showNew ? <Link to={`${EDIT_PATH}${q}`} className={PRIMARY} data-testid="pitch-studio-new">New deck</Link> : null}
      </div>
      {readOnly ? (
        <div role="note" className="rounded-[10px] bg-amber-100 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="pitch-studio-readonly">
          {READ_ONLY}
        </div>
      ) : null}
      <nav aria-label="Pitch deck studio" className="-mx-1 flex gap-1.5 overflow-x-auto border-b border-axal-hairline px-1 dark:border-gray-700">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to={`${t.path}${q}`}
            aria-current={t.id === tab ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] font-bold ${t.id === tab ? 'border-axal-violet text-axal-violet dark:border-violet-400 dark:text-violet-300' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`pitch-studio-tab-${t.id}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function ReadFailed({ text, onRetry, testId }) {
  return (
    <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} data-testid={testId}>
      <span className={`text-[13.5px] font-bold ${INK}`}>{text}</span>
      {onRetry ? <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
    </div>
  );
}

function Skeleton({ h = 'h-24', testId }) {
  return <div className={`${SKEL} ${h} w-full`} aria-hidden="true" data-testid={testId} />;
}

// ---------------------------------------------------------------------------
// Decks (PD2)
// ---------------------------------------------------------------------------

function StudioDecks({ reads, readOnly, q }) {
  const phone = usePhoneWidth();
  const versions = asList(reads.versions.data, 'versions', 'decks');
  const current = currentVersion(versions);
  const rows = useMemo(() => versionRows(versions), [versions]);
  const busy = reads.projects.status === 'loading' || reads.versions.status === 'loading' || reads.versions.status === 'idle';

  let left;
  if (busy) left = <><Skeleton h="h-44" testId="pitch-studio-loading" /><Skeleton h="h-40" /></>;
  else if (reads.versions.status === 'error') left = <ReadFailed text="Your deck's versions could not be read." onRetry={reads.reload} testId="pitch-studio-versions-error" />;
  else if (!current) {
    left = (
      <div className={`${CARD} flex flex-col items-center gap-3 px-5 py-7 text-center`} data-testid="pitch-studio-empty">
        <span className={`text-[15px] font-extrabold ${INK}`}>{EMPTY_DECK}</span>
        {!readOnly ? <Link to={`${EDIT_PATH}${q}`} className={PRIMARY}>New deck</Link> : null}
      </div>
    );
  } else {
    left = (
      <>
        <CurrentDeck project={reads.project} current={current} deck={reads.deck} q={q} phone={phone} />
        <Versions rows={rows} phone={phone} />
      </>
    );
  }

  return (
    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-3.5">{left}</div>
      <aside className="flex flex-col gap-3.5" aria-label="Readers">
        <ReadersAside reads={reads} hasDeck={Boolean(current)} />
      </aside>
    </div>
  );
}

function CurrentDeck({ project, current, deck, q, phone }) {
  const cover = deck.status === 'ok' ? coverOf(deck.data) : null;
  const title = `${String(project?.name || '').trim() || 'Your venture'} · ${versionLabel(current)}`;
  return (
    <section className={`${CARD} grid gap-4 p-4 ${phone ? '' : 'sm:grid-cols-[260px_1fr]'}`} data-testid="pitch-studio-current">
      <div className="flex aspect-video flex-col justify-end gap-1 rounded-[8px] border border-axal-hairline bg-axal-ground p-3.5 dark:border-gray-700 dark:bg-gray-800" data-testid="pitch-studio-cover">
        {deck.status === 'loading' ? <Skeleton h="h-full" /> : deck.status === 'error' ? (
          <span className={MUTED}>The cover could not be read.</span>
        ) : cover ? (
          <>
            <span className="text-[9px] font-bold uppercase tracking-[.14em] text-axal-violet dark:text-violet-300">{String(project?.name || '').trim()}</span>
            <span className={`text-[15px] font-bold leading-snug ${INK}`}>{cover.headline}</span>
            {cover.sub ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{cover.sub}</span> : null}
          </>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[15px] font-extrabold ${INK}`}>{title}</span>
          {current.is_current ? <span className={PILL_VIO}>Current</span> : null}
        </div>
        <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">
          {versionLabel(current)} · saved {dayLabel(current.created_at)}{cover?.slides ? ` · ${cover.slides} slide${cover.slides === 1 ? '' : 's'}` : ''}
        </span>
        <div className="mt-auto flex flex-wrap gap-2">
          <Link to={`${EDIT_PATH}${q}`} className={GHOST} data-testid="pitch-studio-open">Open</Link>
        </div>
      </div>
    </section>
  );
}

function Versions({ rows, phone }) {
  return (
    <section className={`${CARD} overflow-hidden`} data-testid="pitch-studio-versions">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className={`text-[14px] font-extrabold ${INK}`}>Versions</span>
        <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">Newest first</span>
      </div>
      {phone ? (
        <ul className="m-0 list-none border-t border-axal-hairline p-0 dark:border-gray-700">
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-[44px] items-center justify-between gap-3 border-b border-axal-hairline px-4 text-[12.5px] last:border-b-0 dark:border-gray-700">
              <span className={INK}><b>{r.label}</b> · {r.title}</span>
              <span className="font-mono text-axal-muted dark:text-gray-400">{r.saved}</span>
            </li>
          ))}
        </ul>
      ) : (
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="bg-axal-ground font-mono text-[9.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:bg-gray-800 dark:text-gray-400">
              <th className="px-4 py-2 font-semibold">Version</th>
              <th className="px-4 py-2 font-semibold">Title</th>
              <th className="px-4 py-2 font-semibold">Saved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`pitch-studio-version-${r.id}`}>
                <td className={`px-4 py-2.5 font-bold ${INK}`}>{r.label}{r.current ? <span className={`${PILL_VIO} ml-2`}>Current</span> : null}</td>
                <td className={`px-4 py-2.5 ${INK}`}>{r.title}</td>
                <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{r.saved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReadersAside({ reads, hasDeck }) {
  const card = reads.module.data?.card;
  if (reads.module.status === 'loading' || reads.module.status === 'idle') return <><Skeleton h="h-28" /><Skeleton h="h-20" /></>;
  if (reads.module.status === 'error' || card?.state === 'unreadable') return <ReadFailed text="Views on your links could not be read." onRetry={reads.reload} testId="pitch-studio-views-error" />;
  if (!hasDeck) return null;
  const weeks = weeklyViews(card);
  if (!weeks || noViewsYet(card) || weeks.total === 0) {
    return <div className={`${CARD} p-5 text-center text-[13px] text-axal-muted dark:text-gray-400`} data-testid="pitch-studio-no-views">{NO_VIEWS}</div>;
  }
  const peak = Math.max(...weeks.values, 1);
  const slides = slideSeconds(card);
  const top = slides.length ? [...slides].sort((a, b) => b.seconds - a.seconds || a.index - b.index)[0] : null;
  const stats = reads.engagement.status === 'ok' ? readerStats(reads.engagement.data) : null;
  return (
    <>
      <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid="pitch-studio-weekly">
        <span className={EYE}>Views by week</span>
        <div className="flex h-16 items-end gap-1.5" role="img" aria-label={`Views per week, oldest first: ${weeks.values.join(', ')}`}>
          {weeks.values.map((n, i) => (
            <span key={i} title={String(n)} className="flex-1 rounded-t-[3px] bg-axal-violet dark:bg-violet-400" style={{ height: `${Math.max(n ? 6 : 1, Math.round((n / peak) * 64))}px`, opacity: n ? 1 : 0.25 }} />
          ))}
        </div>
        <span className={MUTED}><span className="font-mono">{weeks.total}</span> view{weeks.total === 1 ? '' : 's'} in {weeks.weeks} weeks, every version</span>
      </section>
      <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="pitch-studio-most-read">
        <span className={EYE}>Most read slide</span>
        {top ? (
          <>
            <span className={`text-[14px] font-bold ${INK}`}>Slide {top.index}</span>
            <span className={MUTED}><span className="font-mono">{mmss(top.seconds)}</span> in all, across every link</span>
          </>
        ) : <span className={MUTED}>Seconds per slide {NOT_RECORDED.toLowerCase()} yet.</span>}
      </section>
      <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="pitch-studio-nda">
        <span className={EYE}>NDA signed</span>
        {reads.engagement.status === 'error' ? <span className={MUTED}>Could not be read.</span> : !stats ? <Skeleton h="h-8" /> : stats.ndaSigned == null ? (
          <span className={MUTED}>{NOT_RECORDED}</span>
        ) : (
          <>
            <span className={`font-mono text-[20px] font-semibold ${INK}`}>{stats.ndaSigned} of {stats.viewers}</span>
            <span className={MUTED}>readers who opened a link to the current version</span>
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Share & analytics (PD19)
// ---------------------------------------------------------------------------

function StudioAnalytics({ reads, readOnly }) {
  const [withdraw, setWithdraw] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState(null);
  const versions = asList(reads.versions.data, 'versions', 'decks');
  const current = currentVersion(versions);
  const card = reads.module.data?.card;
  const records = reads.module.data?.records;
  const links = useMemo(() => linkRows(records), [records]);
  const slides = useMemo(() => slideSeconds(card), [card]);
  const stats = reads.engagement.status === 'ok' ? readerStats(reads.engagement.data) : null;
  const addHref = !readOnly ? newLinkHref(records) : null;

  const confirmWithdraw = useCallback(async () => {
    if (!withdraw || !reads.project?.id) return;
    setBusy(true); setFailed(false);
    try {
      await cyclesApi.recordAction('raise', reads.project.id, 'pitch-deck', withdraw.id, 'revoke');
      setWithdraw(null);
      setToast(`${withdraw.investor}: the link no longer opens.`);
      reads.reload();
    } catch (e) {
      reportError('pitch-studio:withdraw', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [withdraw, reads]);

  if (reads.projects.status === 'loading' || reads.module.status === 'loading' || reads.module.status === 'idle') {
    return <div className="flex flex-col gap-3.5"><Skeleton h="h-24" testId="pitch-studio-loading" /><Skeleton h="h-56" /></div>;
  }
  if (reads.module.status === 'error') return <ReadFailed text="Your investor links could not be read." onRetry={reads.reload} testId="pitch-studio-links-error" />;

  const unopened = noViewsYet(card) || (weeklyViews(card)?.total ?? 0) === 0;
  return (
    <div className="flex flex-col gap-3.5" data-testid="pitch-studio-analytics">
      {unopened ? (
        <div className={`${CARD} p-6 text-center text-[13px] text-axal-muted dark:text-gray-400`} data-testid="pitch-studio-no-views">{NO_VIEWS}</div>
      ) : (
        <>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="pitch-studio-tiles">
            <Tile label="Views" value={stats ? String(stats.views) : null} note={current ? `on ${versionLabel(current)}` : ''} state={reads.engagement.status} />
            <Tile label="Unique viewers" value={stats ? String(stats.viewers) : null} note="one per browser" state={reads.engagement.status} />
            <Tile label="Median time" value={stats ? mmss(stats.medianSeconds) : null} note="per view" state={reads.engagement.status} />
            <Tile label="NDA signed" value={stats && stats.ndaSigned != null ? `${stats.ndaSigned} of ${stats.viewers}` : null} note="readers who opened a link" state={reads.engagement.status} />
          </div>
          <div className="grid gap-3.5 lg:grid-cols-[1.6fr_1fr]">
            <SecondsPerSlide rows={slides} />
            <Funnel stats={stats} state={reads.engagement.status} />
          </div>
        </>
      )}
      <section className={`${CARD} overflow-hidden`} data-testid="pitch-studio-links">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className={`text-[14px] font-extrabold ${INK}`}>By investor</span>
          {addHref ? <Link to={addHref} className={GHOST} data-testid="pitch-studio-new-link">New link</Link> : null}
        </div>
        {records?.state === 'unreadable' ? (
          <p className={`${MUTED} px-4 pb-4`}>Your investor links could not be read.</p>
        ) : !links.length ? (
          <p className={`${MUTED} px-4 pb-4`}>No investor link yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="bg-axal-ground font-mono text-[9.5px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:bg-gray-800 dark:text-gray-400">
                  <th className="px-4 py-2 font-semibold">Investor</th>
                  <th className="px-4 py-2 font-semibold">Expiry</th>
                  <th className="px-4 py-2 font-semibold">Views</th>
                  <th className="px-4 py-2 font-semibold">Time on deck</th>
                  <th className="px-4 py-2 font-semibold">Most read</th>
                  <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`pitch-studio-link-${l.id}`}>
                    <td className={`px-4 py-2.5 font-semibold ${INK}`}>{l.investor}</td>
                    <td className="px-4 py-2.5"><span className={l.live ? PILL_OK : PILL_MU}>{l.expires}</span></td>
                    <td className={`px-4 py-2.5 font-mono ${INK}`}>{l.views ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{l.views ? l.time ?? NOT_RECORDED : '— not opened'}</td>
                    <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{l.mostRead ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {!readOnly && l.live ? <button type="button" className={DANGER_TEXT} onClick={() => { setFailed(false); setWithdraw(l); }} data-testid={`pitch-studio-withdraw-${l.id}`}>Withdraw</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {toast ? (
        <div role="status" className={`${CARD} flex items-center justify-between gap-3 px-4 py-3 text-[12.5px] ${INK}`} data-testid="pitch-studio-toast">
          <span>{toast}</span>
          <button type="button" aria-label="Dismiss" className="h-8 w-8 text-[16px] leading-none" onClick={() => setToast(null)}>×</button>
        </div>
      ) : null}
      {withdraw ? (
        <Lightbox
          label="Withdraw this link"
          title="Withdraw this link?"
          width={480}
          onClose={() => !busy && setWithdraw(null)}
          testId="pitch-studio-withdraw-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setWithdraw(null)} disabled={busy}>Cancel</button>
              <button type="button" className={`${BTN} bg-axal-destructive text-white hover:opacity-90`} onClick={confirmWithdraw} disabled={busy} data-testid="pitch-studio-withdraw-confirm">{busy ? 'Withdrawing…' : 'Withdraw'}</button>
            </div>
          )}
        >
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>{withdraw.investor}&apos;s link stops opening at once. Its views stay listed.</p>
          {failed ? <p role="alert" className="m-0 mt-2 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400">The link could not be withdrawn. Try again.</p> : null}
        </Lightbox>
      ) : null}
    </div>
  );
}

function Tile({ label, value, note, state }) {
  return (
    <div className={`${CARD} flex flex-col gap-1 p-4`}>
      <span className={EYE}>{label}</span>
      {state === 'loading' || state === 'idle' ? <Skeleton h="h-7" /> : state === 'error' ? (
        <span className={MUTED}>Could not be read</span>
      ) : (
        <span className={`font-mono text-[22px] font-semibold ${INK}`}>{value ?? '—'}</span>
      )}
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{value == null && state === 'ok' ? NOT_RECORDED : note}</span>
    </div>
  );
}

function SecondsPerSlide({ rows }) {
  const peak = Math.max(...rows.map((r) => r.seconds), 1);
  const caption = slideCaption(rows);
  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="pitch-studio-seconds">
      <span className={`text-[14px] font-extrabold ${INK}`}>Seconds per slide</span>
      <span className="text-[12px] text-axal-muted dark:text-gray-400">{caption || 'Seconds per slide are not recorded yet.'} Every version together.</span>
      {rows.length ? (
        <div className="flex h-40 items-end gap-2 pt-4" role="img" aria-label={rows.map((r) => `Slide ${r.index}: ${r.seconds} seconds`).join(', ')}>
          {rows.map((r) => (
            <div key={r.index} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">{Math.round(r.seconds)}</span>
              <span className="w-full max-w-[30px] rounded-t-[3px] bg-axal-violet dark:bg-violet-400" style={{ height: `${Math.max(4, Math.round((r.seconds / peak) * 110))}px` }} />
              <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">{String(r.index).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Funnel({ stats, state }) {
  const opened = stats?.viewers ?? null;
  const rows = [['Opened', opened], ['Accepted the NDA', stats?.ndaSigned ?? null]];
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="pitch-studio-funnel">
      <span className={`text-[14px] font-extrabold ${INK}`}>Funnel</span>
      {state === 'error' ? <span className={MUTED}>Could not be read.</span> : rows.map(([label, n]) => (
        <div key={label} className="flex flex-col gap-1">
          <div className="flex justify-between text-[12.5px]"><span className={INK}>{label}</span><span className="font-mono text-axal-muted dark:text-gray-400">{n ?? '—'}</span></div>
          <div className="h-2.5 rounded-full bg-axal-ground dark:bg-gray-800">
            <div className="h-2.5 rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${opened ? Math.round(((n ?? 0) / opened) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">On the current version.</span>
    </section>
  );
}
