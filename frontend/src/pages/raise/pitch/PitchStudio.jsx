import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { cyclesApi } from '../../../lib/api/cycles';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, RailFrame, WorkerRail, usePhoneWidth } from '../../../ui';
import DeckReviewerPage from '../../DeckReviewerPage';
import ExportDialog from './ExportDialog';
import PitchNotes from './PitchNotes';
import { CoverageMeter, useDeckSources } from './SourcesBoards';
import {
  EDIT_PATH, EMPTY_DECK, ENGAGEMENT_VIEW_ROWS, LINE, NOT_RECORDED, NO_VENTURE, NO_VIEWS, READ_ONLY, TABS, TITLE,
  asList, coverOf, currentVersion, dayLabel, funnelRows, isReadOnly, linkPage, linkRows, mmss, newLinkHref,
  readerStats, slideCaption, slideSeconds, ventureQuery, versionLabel, versionRows, viewsState, weeklyViews,
} from './pitchStudioModel';
import { presentHref } from './presentExportModel';
import { useRailOption } from '../../../ui/railCrumbs';
import { newDeckApi } from '../../../lib/api/newDeck';
import { railPressHeaders } from '../../../lib/railPage';
import { FAST_TITLE, NEW_PATH, buildSentence, fastPathLine, refusalOf } from './newDeckModel';

/**
 * D894 (#2434) — the Pitch deck studio's shell and the two tabs whose reads are
 * on `main`, built to the "Pitch Deck Studio" canvas (PD2, PD19, PD23–PD26).
 *
 *   /raise/pitch            Decks (PD2): the current deck, its versions, and
 *                           views by week, most read slide and NDA signed.
 *   /raise/pitch/review     Review (PD14): today's reviewer, until #2434 part 6
 *                           reviews a version of the deck itself.
 *   /raise/pitch/analytics  Share & analytics (PD19): one version's readers,
 *                           seconds per slide, and every investor link, a page
 *                           at a time, with Withdraw on every link not
 *                           known to be dead.
 *   /raise/pitch/notes      Notes (PD21, D905): the thread from the venture's
 *                           admins to its founders, and the composer.
 *   /raise/pitch/new        New deck (PD3–PD6, D897): `NewDeck.jsx`. The Decks
 *                           tab's New deck and its fast path (PD2) open it.
 *   /raise/pitch/edit       the deck builder (PitchWorkspacePage), until #2434
 *                           part 4 builds the editor (PD1).
 *
 * WHO. The venture's founder works here, as does anyone else the route admits
 * who is not an admin. An admin reads it and leaves notes: no New deck, no New
 * link, no Withdraw, and a "Read only." banner (PD21). Review is the reviewer's
 * own tool, with its own writes, so it draws no banner. The Worker still lets an
 * admin write the deck; #2434 part 1 closes that. An Advisor, an Operating
 * Partner or an Explorer gets PitchBoundary (PD22) from the route instead.
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

/** A re-read of the same thing keeps what is on screen until it answers; anything else starts from loading. */
const again = (key) => (s) => (s.status === 'ok' && s.for === key ? { ...s, reading: true } : { ...loading, for: key });

/** One read into its state, unless the run that started it is no longer current (`alive()` false). */
const settle = (alive, set, key) => (p) => p.then(
  (data) => { if (alive()) set({ status: 'ok', data, for: key }); return data; },
  (e) => { if (alive()) set({ status: 'error', data: null, error: e, for: key }); reportError('pitch-studio:read', e); return undefined; },
);

/**
 * The studio's reads. The venture comes from `?project_id=` (else the first
 * one, written back); each read answers alone, and `reload()` reads them again.
 * A re-read of the same venture (Try again, a page of links, the re-read after
 * a Withdraw) keeps the tab on screen until it answers. A run that has been
 * superseded writes nothing, so a late answer never overwrites a newer one.
 */
function useStudioReads() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('project_id');
  const [projects, setProjects] = useState(loading);
  const [versions, setVersions] = useState(idle);
  const [module, setModule] = useState(idle);
  const [deck, setDeck] = useState(idle);
  const [engagement, setEngagement] = useState(idle);
  const [linksPage, setLinksPage] = useState({ for: null, page: 1 });
  const [tick, setTick] = useState(0);

  const list = asList(projects.data, 'items', 'projects');
  const project = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
  const projectId = project?.id ?? null;
  const page = linksPage.for === projectId ? linksPage.page : 1;

  useEffect(() => {
    let live = true;
    setProjects(again('ventures'));
    settle(() => live, setProjects, 'ventures')(api.listProjects());
    return () => { live = false; };
  }, [tick]);

  useEffect(() => {
    if (projectId == null || String(projectId) === String(requested)) return;
    setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(projectId)); return next; }, { replace: true });
  }, [projectId, requested, setParams]);

  useEffect(() => {
    if (projectId == null) { setVersions(idle); setDeck(idle); setEngagement(idle); return undefined; }
    let live = true;
    const alive = () => live;
    (async () => {
      setVersions(again(projectId));
      const v = await settle(alive, setVersions, projectId)(api.deckListVersions(projectId));
      if (!live) return;
      const current = currentVersion(asList(v, 'versions', 'decks'));
      if (!current?.id) { setDeck(idle); setEngagement(idle); return; }
      setDeck(again(current.id)); setEngagement(again(current.id));
      await Promise.all([
        settle(alive, setDeck, current.id)(api.deckGet(current.id).then((r) => r?.deck || r)),
        settle(alive, setEngagement, current.id)(api.deckEngagement(current.id)),
      ]);
    })();
    return () => { live = false; };
  }, [projectId, tick]);

  useEffect(() => {
    if (projectId == null) { setModule(idle); return undefined; }
    let live = true;
    setModule(again(projectId));
    settle(() => live, setModule, projectId)(cyclesApi.module('raise', projectId, 'pitch-deck', { page }));
    return () => { live = false; };
  }, [projectId, page, tick]);

  // Stable, and a no-op for the page already asked for, so the pager's own
  // effect cannot loop while the page it asked for is still being read.
  const setPage = useCallback(
    (n) => setLinksPage((old) => (old.for === projectId && old.page === n ? old : { for: projectId, page: n })),
    [projectId],
  );

  return {
    projects, project, requested, versions, module, deck, engagement, setPage,
    reload: () => setTick((t) => t + 1),
  };
}

export default function PitchStudio({ tab = 'decks' }) {
  const { user } = useAuth() || {};
  const readOnly = isReadOnly(user);
  const reads = useStudioReads();
  const projectId = reads.project?.id || null;
  // Until the ventures read answers, or when it fails, the venture in the
  // address: a tab never drops it and lands on another one.
  const q = ventureQuery(projectId || reads.requested);

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
        {tab === 'review' ? (
          // The reviewer does its own reads, and works with no venture, as it
          // did before D894: the studio's ventures read never stands in its way.
          <DeckReviewerPage embedded />
        ) : reads.projects.status === 'error' ? (
          <ReadFailed text="Your ventures could not be read." onRetry={reads.reload} testId="pitch-studio-projects-error" />
        ) : reads.projects.status === 'ok' && !reads.project ? (
          <div className={`${CARD} flex flex-col items-start gap-3 p-7`} data-testid="pitch-studio-no-venture">
            <span className={`text-[15px] font-extrabold ${INK}`}>{NO_VENTURE}</span>
            <Link to="/studio" className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300">Open Studio</Link>
          </div>
        ) : tab === 'analytics' ? (
          <StudioAnalytics reads={reads} readOnly={readOnly} />
        ) : tab === 'notes' ? (
          <PitchNotes reads={reads} />
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
        {/* D897 (#2677): New deck is PD3–PD6 at /raise/pitch/new. */}
        {showNew ? <Link to={`${NEW_PATH}${q}`} className={PRIMARY} data-testid="pitch-studio-new">New deck</Link> : null}
      </div>
      {/* The reviewer is its own tool, and its writes are its own: Review draws no banner. */}
      {readOnly && tab !== 'review' ? (
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

export function StudioDecks({ reads, readOnly, q }) {
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
        {!readOnly ? <Link to={`${NEW_PATH}${q}`} className={PRIMARY} data-testid="pitch-studio-empty-new">New deck</Link> : null}
      </div>
    );
  } else {
    left = (
      <>
        <CurrentDeck project={reads.project} current={current} versions={versions} deck={reads.deck} q={q} phone={phone} readOnly={readOnly} />
        <Versions rows={rows} phone={phone} />
      </>
    );
  }

  return (
    // A proportional aside, not a fixed track: the rail already takes its own
    // column beside the frame, and a fixed 300px here would read as a second one.
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3.5">
        {!readOnly && !busy && reads.versions.status === 'ok' && reads.project?.id ? <FastPath projectId={reads.project.id} q={q} /> : null}
        {left}
      </div>
      <aside className="flex flex-col gap-3.5" aria-label="Readers">
        <ReadersAside reads={reads} hasDeck={Boolean(current)} />
      </aside>
    </div>
  );
}

/**
 * D897 (#2677), PD2: "Build a standard deck now" — twelve cards from everything
 * on record, for a seed fund, skipping source curation. Its estimate is the
 * quote (`POST /api/decks/new/quote`); the build is a proposal, reviewed card
 * by card at /raise/pitch/new.
 */
function FastPath({ projectId, q }) {
  const navigate = useNavigate();
  const [quote, setQuote] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  useRailOption(busy ? 'deck:build' : null, 'Build deck');
  useEffect(() => {
    let live = true;
    newDeckApi.quote({ project_id: projectId, step: 'build', audience: 'seed_fund', length: 'standard' })
      .then((qt) => { if (live) setQuote(qt); }, (e) => { if (live) setQuote(null); reportError('pitch-studio:fast-quote', e); });
    return () => { live = false; };
  }, [projectId]);
  const build = async () => {
    setBusy(true); setRefusal(null);
    try {
      const r = await newDeckApi.build({ project_id: projectId, audience: 'seed_fund', length: 'standard' }, railPressHeaders('deck:build'));
      navigate(`${NEW_PATH}${q}${q ? '&' : '?'}proposal=${encodeURIComponent(r.proposal.id)}`);
    } catch (e) { setRefusal(refusalOf(e)); setOpen(false); reportError('pitch-studio:fast-build', e); } finally { setBusy(false); }
  };
  return (
    <section className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3.5`} data-testid="pitch-studio-fast">
      <div className="flex min-w-0 flex-col gap-1">
        <span className={`text-[14px] font-extrabold ${INK}`}>{FAST_TITLE}</span>
        <span className={MUTED}>{fastPathLine(quote)}</span>
        {refusal ? (
          <span role="alert" className="text-[12px] font-semibold text-axal-violet dark:text-violet-300">
            {refusal.message} {refusal.topUp ? <a href={refusal.topUp.href} className="underline">{refusal.topUp.text}</a> : null}
          </span>
        ) : null}
      </div>
      <button type="button" className={PRIMARY} onClick={() => setOpen(true)} data-testid="pitch-studio-fast-build">Build</button>
      {open ? (
        <Lightbox label={FAST_TITLE} title={FAST_TITLE} width={520} onClose={() => !busy && setOpen(false)} testId="pitch-studio-fast-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={build} disabled={busy}>{busy ? 'Building…' : 'Build deck'}</button>
            </div>
          )}>
          <p className={`m-0 ${MUTED}`}>{buildSentence(quote, 12)}</p>
        </Lightbox>
      ) : null}
    </section>
  );
}

function CurrentDeck({ project, current, versions, deck, q, phone, readOnly }) {
  const [exporting, setExporting] = useState(false);
  const sources = useDeckSources(project?.id);
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
        {/* D896 (#2675): PD2's coverage meter, from the sources read; loading and error draw no counts. */}
        {sources.status !== 'idle' ? (
          <div data-testid="pitch-studio-coverage">
            <CoverageMeter coverage={sources.data?.coverage} status={sources.status} size="M" onRetry={sources.retry} />
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2">
          <Link to={`${EDIT_PATH}${q}`} className={GHOST} data-testid="pitch-studio-open">Open</Link>
          {/* D901 (#2680): present reads, so a read-only viewer presents too (PD21); export writes the ledger. */}
          <Link to={presentHref(project?.id, current.id)} className={GHOST} data-testid="pitch-studio-present">Present</Link>
          {!readOnly ? <button type="button" className={GHOST} onClick={() => setExporting(true)} data-testid="pitch-studio-export">Export</button> : null}
        </div>
      </div>
      {exporting ? <ExportDialog versions={versions} current={current} onClose={() => setExporting(false)} /> : null}
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
              <span className={INK}><b>{r.label}</b> · {r.title} <span className="text-axal-muted dark:text-gray-400">· {r.audience}</span></span>
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
              <th className="px-4 py-2 font-semibold">Audience</th>
              <th className="px-4 py-2 font-semibold">Round</th>
              <th className="px-4 py-2 font-semibold">Saved</th>
              <th className="px-4 py-2 font-semibold">By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`pitch-studio-version-${r.id}`}>
                <td className={`px-4 py-2.5 font-bold ${INK}`}>{r.label}{r.current ? <span className={`${PILL_VIO} ml-2`}>Current</span> : null}</td>
                <td className={`px-4 py-2.5 ${INK}`}>{r.title}</td>
                <td className={`px-4 py-2.5 ${INK}`}>{r.audience}</td>
                <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{r.round}</td>
                <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{r.saved}</td>
                <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{r.by}</td>
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
  const state = viewsState(card, reads.module.status);
  if (state === 'failed') return <ReadFailed text="Views on your links could not be read." onRetry={reads.reload} testId="pitch-studio-views-error" />;
  if (!hasDeck || state === 'no-deck') return null;
  if (state === 'unopened') {
    return <div className={`${CARD} p-5 text-center text-[13px] text-axal-muted dark:text-gray-400`} data-testid="pitch-studio-no-views">{NO_VIEWS}</div>;
  }
  // Views exist. Eight zero weeks is a real count, and the rest still shows.
  const weeks = weeklyViews(card);
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
        <span className={MUTED}><span className="font-mono">{weeks.total}</span> view{weeks.total === 1 ? '' : 's'} in the last {weeks.weeks} weeks, every version</span>
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
            {/* Signatures, counted as the Worker counts them: never a share of browsers. */}
            <span className={`font-mono text-[20px] font-semibold ${INK}`}>{stats.ndaSigned}</span>
            <span className={MUTED}>signatures on links to the current version</span>
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Share & analytics (PD19)
// ---------------------------------------------------------------------------

export function StudioAnalytics({ reads, readOnly }) {
  const [withdraw, setWithdraw] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState(null);
  const dismiss = useRef(null);
  const heading = useRef(null);
  const root = useRef(null);
  const versions = asList(reads.versions.data, 'versions', 'decks');
  const current = currentVersion(versions);
  const card = reads.module.data?.card;
  const records = reads.module.data?.records;
  const links = useMemo(() => linkRows(records, reads.engagement.data), [records, reads.engagement.data]);
  const pager = linkPage(records);
  const slides = useMemo(() => slideSeconds(card), [card]);
  const stats = reads.engagement.status === 'ok' ? readerStats(reads.engagement.data) : null;
  // Engagement is read once the versions read names a current version, so a
  // failed versions read is a failed engagement read here, never a skeleton
  // waiting on a read that was never made.
  const engState = reads.versions.status === 'error' ? 'error' : reads.versions.status === 'ok' && !current ? 'ok' : reads.engagement.status;
  const addHref = !readOnly ? newLinkHref(records) : null;

  // The dialog hands focus back to the Withdraw button as it closes, and the
  // re-read then takes that button away: the result's own Dismiss takes focus
  // instead. This effect runs after the dialog's cleanup.
  useEffect(() => { if (toast) dismiss.current?.focus?.(); }, [toast]);

  // A defensive guard: the records list every link whatever its state, so the
  // total shrinks only if links or versions are removed underneath an open
  // page. A page the read no longer has goes back to the read's last page, and
  // until that read answers it is drawn as reading, never "Links 0–0 of N" or
  // "No investor link yet.".
  const pastEnd = Boolean(pager && pager.total && pager.page > pager.pages);
  const { setPage } = reads;
  useEffect(() => {
    if (pager && pager.total && pager.page > pager.pages) setPage?.(pager.pages);
  }, [pager?.page, pager?.pages, pager?.total, setPage]);

  const confirmWithdraw = useCallback(async () => {
    if (!withdraw || !reads.project?.id) return;
    setBusy(true); setFailed(false);
    try {
      await cyclesApi.recordAction('raise', reads.project.id, 'pitch-deck', withdraw.id, 'revoke');
      setWithdraw(null);
      setToast({ text: `${withdraw.investor}: the link no longer opens.` });
      reads.reload();
    } catch (e) {
      reportError('pitch-studio:withdraw', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [withdraw, reads]);

  const views = viewsState(card, reads.module.status);
  let body;
  if (reads.projects.status === 'loading' || reads.module.status === 'loading' || reads.module.status === 'idle') {
    body = <><Skeleton h="h-24" testId="pitch-studio-loading" /><Skeleton h="h-56" /></>;
  } else if (reads.module.status === 'error') {
    body = <ReadFailed text="Your investor links and the views on them could not be read." onRetry={reads.reload} testId="pitch-studio-links-error" />;
  } else {
    body = (
      <>
        {views === 'failed' ? (
          <ReadFailed text="Views on your links could not be read." onRetry={reads.reload} testId="pitch-studio-views-error" />
        ) : views === 'unopened' || views === 'no-deck' ? (
          <div className={`${CARD} p-6 text-center text-[13px] text-axal-muted dark:text-gray-400`} data-testid={views === 'unopened' ? 'pitch-studio-no-views' : 'pitch-studio-empty'}>
            {views === 'unopened' ? NO_VIEWS : EMPTY_DECK}
          </div>
        ) : (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="pitch-studio-tiles">
              <Tile label="Views" value={stats ? `${stats.views}${stats.capped ? '+' : ''}` : null} note={current ? `on ${versionLabel(current)}` : ''} state={engState} />
              <Tile label="Unique viewers" value={stats ? String(stats.viewers) : null} note={stats?.capped ? `one per browser, in the latest ${ENGAGEMENT_VIEW_ROWS} views` : 'one per browser'} state={engState} />
              <Tile label="Median time" value={stats ? mmss(stats.medianSeconds) : null} note={stats?.capped ? `per view, over the latest ${ENGAGEMENT_VIEW_ROWS}` : 'per view'} state={engState} />
              <Tile label="NDA signed" value={stats && stats.ndaSigned != null ? String(stats.ndaSigned) : null} note="signatures on this version's links" state={engState} />
            </div>
            <div className="grid gap-3.5 lg:grid-cols-[1.6fr_1fr]">
              <SecondsPerSlide rows={slides} />
              <Funnel stats={stats} state={engState} />
            </div>
          </>
        )}
        <section className={`${CARD} overflow-hidden`} data-testid="pitch-studio-links">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h2 ref={heading} tabIndex={-1} className={`m-0 text-[14px] font-extrabold ${INK}`}>By investor</h2>
            {addHref ? <Link to={addHref} className={GHOST} data-testid="pitch-studio-new-link">New link</Link> : null}
          </div>
          {records?.state === 'unreadable' ? (
            <p className={`${MUTED} px-4 pb-4`}>Your investor links could not be read.</p>
          ) : pastEnd ? (
            <p className={`${MUTED} px-4 pb-4`} data-testid="pitch-studio-links-reading">Reading your investor links…</p>
          ) : !links.length && !pager?.total ? (
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
                      <td className={`px-4 py-2.5 font-mono ${INK}`}>{l.views ?? NOT_RECORDED}</td>
                      <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{l.views ? (l.time && !/^0\s*min$/.test(l.time) ? l.time : NOT_RECORDED) : l.views === 0 ? 'Not opened' : NOT_RECORDED}</td>
                      <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{l.mostRead ?? (l.views === 0 ? 'Not opened' : NOT_RECORDED)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {l.live === null ? (
                            // Opened, and not a link the engagement read answered for.
                            <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`pitch-studio-link-unknown-${l.id}`}>
                              {engState === 'error' ? 'Views left could not be read' : engState === 'ok' ? 'Views left not read' : 'Reading views left…'}
                            </span>
                          ) : null}
                          {!readOnly && l.live !== false ? <button type="button" className={DANGER_TEXT} onClick={() => { setFailed(false); setWithdraw(l); }} data-testid={`pitch-studio-withdraw-${l.id}`}>Withdraw</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pager && pager.total && !pastEnd ? (
            <nav aria-label="Investor links" className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-4 py-3 dark:border-gray-700" data-testid="pitch-studio-links-pager">
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">Links {pager.from}–{pager.to} of {pager.total}</span>
              {pager.pages > 1 ? (
                <div className="flex gap-2">
                  <button type="button" className={`${GHOST} disabled:opacity-50`} disabled={pager.page <= 1 || Boolean(reads.module.reading)} onClick={() => reads.setPage(pager.page - 1)} data-testid="pitch-studio-links-prev">Previous</button>
                  <button type="button" className={`${GHOST} disabled:opacity-50`} disabled={pager.page >= pager.pages || Boolean(reads.module.reading)} onClick={() => reads.setPage(pager.page + 1)} data-testid="pitch-studio-links-next">Next</button>
                </div>
              ) : null}
            </nav>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <div ref={root} tabIndex={-1} className="flex flex-col outline-none" data-testid="pitch-studio-analytics">
      <div className="flex flex-col gap-3.5">{body}</div>
      {/* Always mounted, so the line is announced when it is set, and kept through a re-read. */}
      <div role="status" className={toast ? 'mt-3.5' : undefined}>
        {toast ? (
          <div className={`${CARD} flex items-center justify-between gap-3 px-4 py-3 text-[12.5px] ${INK}`} data-testid="pitch-studio-toast">
            <span>{toast.text}</span>
            <button ref={dismiss} type="button" aria-label="Dismiss" className="h-8 w-8 text-[16px] leading-none" onClick={() => { setToast(null); (heading.current || root.current)?.focus?.(); }}>×</button>
          </div>
        ) : null}
      </div>
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
          {withdraw.live === null ? (
            // Its views left were not read: it may already be used up. Withdrawing
            // it then marks it Revoked, which the dialog says.
            <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>If {withdraw.investor}&apos;s link still opens, it stops at once. Its views stay listed, and the link then reads Revoked.</p>
          ) : (
            <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>{withdraw.investor}&apos;s link stops opening at once. Its views stay listed.</p>
          )}
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
        value == null ? <span className={MUTED}>{NOT_RECORDED}</span> : <span className={`font-mono text-[22px] font-semibold ${INK}`}>{value}</span>
      )}
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{note}</span>
    </div>
  );
}

function SecondsPerSlide({ rows }) {
  const peak = Math.max(...rows.map((r) => r.seconds), 1);
  const caption = slideCaption(rows);
  return (
    // min-w-0: a grid item, so a long deck's bars scroll inside the card rather
    // than widening the column, and the page, at phone width.
    <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid="pitch-studio-seconds">
      <span className={`text-[14px] font-extrabold ${INK}`}>Seconds per slide</span>
      <span className="text-[12px] text-axal-muted dark:text-gray-400">{caption || 'Seconds per slide are not recorded yet.'} Every version together.</span>
      {rows.length ? (
        <div className="flex h-40 items-end gap-2 overflow-x-auto pt-4" role="img" aria-label={rows.map((r) => `Slide ${r.index}: ${r.seconds} seconds`).join(', ')}>
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
  const rows = funnelRows(stats);
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="pitch-studio-funnel">
      <span className={`text-[14px] font-extrabold ${INK}`}>Funnel</span>
      {state === 'error' ? <span className={MUTED}>Could not be read.</span> : rows.map(({ label, n, width }, i) => (
        <div key={label} className="flex flex-col gap-1">
          <div className="flex justify-between text-[12.5px]"><span className={INK}>{label}</span><span className="font-mono text-axal-muted dark:text-gray-400">{n == null ? (state === 'ok' ? NOT_RECORDED : 'Reading…') : `${n}${i === 0 && stats?.capped ? '+' : ''}`}</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
            <div className="h-2.5 rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${width}%` }} data-testid={`pitch-studio-funnel-bar-${i}`} />
          </div>
        </div>
      ))}
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">
        {stats?.capped
          ? `On the current version, as a share of its latest ${ENGAGEMENT_VIEW_ROWS} views; the NDA count is every signature.`
          : 'On the current version, as a share of its views.'}
      </span>
    </section>
  );
}
