import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { cyclesApi } from '../../../lib/api/cycles';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, WorkerRail } from '../../../ui';
import PitchPage from './PitchPage';
import PitchNotes from './PitchNotes';
import PitchReview from './PitchReview';
import {
  EMPTY_DECK, ENGAGEMENT_VIEW_ROWS, LINE, NOT_RECORDED, NO_VENTURE, NO_VIEWS, READ_ONLY, TABS, TITLE,
  asList, currentVersion, dayLabel, isReadOnly, linkPage, linkRows, mmss,
  readerStats, ventureQuery, versionLabel, viewsState,
} from './pitchStudioModel';
import ShareDialog from './ShareDialog';
import StudioHome from './StudioHome';
import { NEW_PATH } from './newDeckModel';
import { deckRail } from './deckRailGroups';
import { PitchMovedNotice } from './PitchWorkspaceMoved';
import { NEW_LINK, analyticsOf, cardSeries, ndaCell, settingsLine, shareFunnel } from './shareModel';

/**
 * D894 (#2434) — the Pitch deck studio's shell and the two tabs whose reads are
 * on `main`, built to the "Pitch Deck Studio" canvas (PD2, PD19, PD23–PD26).
 *
 *   /raise/pitch            Decks: D1604 (#3716, pd1) made it the studio's
 *                           home, `StudioHome.jsx` (the deck card with
 *                           Versions… in its ⋯, Start from, Data ready and
 *                           Investor links). Before that, PD2: the current
 *                           deck, its versions, and
 *                           views by week, most read slide and NDA signed.
 *   /raise/pitch/review     Review (PD14): the current version's review, each
 *                           point pointing to a card, and the reviews per
 *                           version (D900, `PitchReview.jsx`); the reviewer for
 *                           an upload or pasted text below it.
 *   /raise/pitch/analytics  Share & analytics (PD19): one version's readers,
 *                           seconds per slide, and every investor link, a page
 *                           at a time, with Withdraw on every link not
 *                           known to be dead.
 *   /raise/pitch/notes      Notes (PD21, D905): the thread from the venture's
 *                           admins to its founders, and the composer.
 *   /raise/pitch/new        New deck (PD3–PD6, D897): `NewDeck.jsx`. The Decks
 *                           tab's New deck and its fast path (PD2) open it.
 *   /raise/pitch/edit       the card editor (D898, PD1).
 *   /raise/pitch/builder    redirects here: the template builder retired once
 *                           its four actions were the studio's (D898 group E).
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

  // D1604 (§5): the rail is the element groups' models and the deck's usage.
  const currentId = currentVersion(asList(reads.versions.data, 'versions', 'decks'))?.id ?? null;
  const railGroups = useMemo(() => deckRail(currentId), [currentId]);
  const rail = (
    <WorkerRail
      workspace="Raise"
      // The founder's tool, whoever reads it: a reader is told by the banner.
      role="founder"
      groups={railGroups}
      note="The studio reads your deck's versions and the views on your investor links. Every figure on a card comes from your records and shows its source."
      data-testid="pitch-studio-rail"
    />
  );

  return (
    <PitchPage rail={rail} crumb={{ query: q }} ask={{ projectId, readOnly, versions: reads.versions, onChanged: reads.reload }} testId="pitch-studio">
      <div className="flex flex-col gap-5 pb-24 lg:pb-10" data-testid={`pitch-studio-${tab}`}>
        <StudioHeader tab={tab} q={q} readOnly={readOnly} showNew={tab === 'decks' && !readOnly && Boolean(projectId)} />
        {tab === 'review' ? (
          // D900: the review of the current version (PD14), and below it the
          // reviewer for an upload or pasted text, which works with no venture
          // as it did before D894: the ventures read never stands in its way.
          <PitchReview reads={reads} readOnly={readOnly} />
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
          <StudioHome reads={reads} readOnly={readOnly} q={q} />
        )}
      </div>
    </PitchPage>
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
      {/* D898 group E: the retired builder's address lands here and says so once. */}
      <PitchMovedNotice />
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

// Decks (pd1): `StudioHome.jsx`. Kept under its old name for the callers that import it.
export const StudioDecks = StudioHome;
export { Versions, useDeckChecks } from './DeckVersions';

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
  const stats = reads.engagement.status === 'ok' ? readerStats(reads.engagement.data) : null;
  // D902 — PD19 for this version: the Worker's per-viewer median, seconds per
  // card against the version before, the ask, and each link's settings.
  const analytics = reads.engagement.status === 'ok' ? analyticsOf(reads.engagement.data) : null;
  const series = useMemo(() => cardSeries(analytics), [analytics]);
  const shares = useMemo(() => new Map(asList(reads.engagement.data, 'shares').map((x) => [String(x.id), x])), [reads.engagement.data]);
  const [sharing, setSharing] = useState(false);
  // Engagement is read once the versions read names a current version, so a
  // failed versions read is a failed engagement read here, never a skeleton
  // waiting on a read that was never made.
  const engState = reads.versions.status === 'error' ? 'error' : reads.versions.status === 'ok' && !current ? 'ok' : reads.engagement.status;
  // D902 — New link opens the share dialog (PD18), the one link writer.
  const canShare = !readOnly && Boolean(current?.id) && Boolean(reads.project?.id);

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
              <Tile
                label="Median time"
                value={analytics ? mmss(analytics.median_seconds_per_viewer) : stats ? mmss(stats.medianSeconds) : null}
                note={analytics ? 'per viewer, every view of this version' : stats?.capped ? `per view, over the latest ${ENGAGEMENT_VIEW_ROWS}` : 'per view'}
                state={engState}
              />
              <Tile label="NDA signed" value={stats && stats.ndaSigned != null ? String(stats.ndaSigned) : null} note="signatures on this version's links" state={engState} />
            </div>
            <div className="grid gap-3.5 lg:grid-cols-[1.6fr_1fr]">
              <SecondsPerCard series={series} unreadable={engState === 'ok' && !analytics} />
              <Funnel stats={stats} analytics={analytics} state={engState} />
            </div>
          </>
        )}
        <section className={`${CARD} overflow-hidden`} data-testid="pitch-studio-links">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h2 ref={heading} tabIndex={-1} className={`m-0 text-[14px] font-extrabold ${INK}`}>By investor</h2>
            {canShare ? <button type="button" className={GHOST} onClick={() => setSharing(true)} data-testid="pitch-studio-new-link">{NEW_LINK}</button> : null}
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
                    <th className="px-4 py-2 font-semibold">NDA</th>
                    <th className="px-4 py-2 font-semibold">Settings</th>
                    <th className="px-4 py-2 font-semibold">Last opened</th>
                    <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.id} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`pitch-studio-link-${l.id}`}>
                      <td className={`px-4 py-2.5 font-semibold ${INK}`}>{l.investor}</td>
                      <td className="px-4 py-2.5"><span className={l.live ? PILL_OK : PILL_MU}>{l.expires}</span></td>
                      <td className={`px-4 py-2.5 font-mono ${INK}`}>{l.views ?? NOT_RECORDED}</td>
                      <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{l.views ? (l.time ?? NOT_RECORDED) : l.views === 0 ? 'Not opened' : NOT_RECORDED}</td>
                      <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{l.mostRead ?? (l.views === 0 ? 'Not opened' : NOT_RECORDED)}</td>
                      <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400" data-testid={`pitch-studio-link-nda-${l.id}`}>{ndaCell(shares.get(String(l.id)))}</td>
                      <td className="px-4 py-2.5 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid={`pitch-studio-link-settings-${l.id}`}>{settingsLine(shares.get(String(l.id)))}</td>
                      <td className="px-4 py-2.5 font-mono text-axal-muted dark:text-gray-400">{shares.get(String(l.id))?.last_viewed_at ? dayLabel(shares.get(String(l.id)).last_viewed_at) : l.views === 0 ? 'Not opened' : NOT_RECORDED}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-3">
                          {!readOnly && l.live ? <button type="button" className={DANGER_TEXT} onClick={() => { setFailed(false); setWithdraw(l); }} data-testid={`pitch-studio-withdraw-${l.id}`}>Withdraw</button> : null}
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
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>{withdraw.investor}&apos;s link stops opening at once. Its views stay listed.</p>
          {failed ? <p role="alert" className="m-0 mt-2 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400">The link could not be withdrawn. Try again.</p> : null}
        </Lightbox>
      ) : null}
      {sharing && canShare ? (
        <ShareDialog projectId={reads.project.id} deck={current} onClose={() => setSharing(false)} onCreated={() => reads.reload()} />
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

function SecondsPerCard({ series, unreadable }) {
  // D902 — this version only, with the version before it dotted. The Raise
  // module's card summed every version together.
  if (unreadable || !series) {
    return (
      <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid="pitch-studio-seconds">
        <span className={`text-[14px] font-extrabold ${INK}`}>Seconds per card</span>
        <span className={MUTED}>{unreadable ? 'Seconds per card on this version could not be read.' : 'Reading…'}</span>
      </section>
    );
  }
  const { rows, max, version, previousVersion } = series;
  return (
    // min-w-0: a grid item, so a long deck's bars scroll inside the card rather
    // than widening the column, and the page, at phone width.
    <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid="pitch-studio-seconds">
      <span className={`text-[14px] font-extrabold ${INK}`}>Seconds per card</span>
      <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="pitch-studio-seconds-legend">
        {previousVersion == null ? `v${version}. No version before it to compare.` : `v${version}, with v${previousVersion} dotted.`}
      </span>
      {rows.length ? (
        <div className="flex h-40 items-end gap-2 overflow-x-auto pt-4" role="img"
          aria-label={rows.map((r) => `Card ${r.label}: ${r.seconds} seconds${r.previous == null ? '' : `, ${r.previous} on v${previousVersion}`}`).join(', ')}>
          {rows.map((r) => (
            <div key={r.index} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">{Math.round(r.seconds)}</span>
              <div className="flex w-full max-w-[34px] items-end gap-0.5">
                <span className="flex-1 rounded-t-[3px] bg-axal-violet dark:bg-violet-400" style={{ height: `${Math.max(4, Math.round((r.seconds / max) * 110))}px` }} />
                {r.previous == null ? null : (
                  <span className="flex-1 rounded-t-[3px] border border-dashed border-axal-violet dark:border-violet-400" style={{ height: `${Math.max(4, Math.round((r.previous / max) * 110))}px` }} data-testid={`pitch-studio-previous-${r.index}`} />
                )}
              </div>
              <span className="font-mono text-[10px] text-axal-muted dark:text-gray-400">{r.label}</span>
            </div>
          ))}
        </div>
      ) : <span className={MUTED}>No card on this version has been read yet.</span>}
    </section>
  );
}

function Funnel({ stats, analytics, state }) {
  const rows = shareFunnel(stats, analytics);
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="pitch-studio-funnel">
      <span className={`text-[14px] font-extrabold ${INK}`}>Funnel</span>
      {state === 'error' ? <span className={MUTED}>Could not be read.</span> : rows.map(({ label, n, width, reason }, i) => (
        <div key={label} className="flex flex-col gap-1">
          <div className="flex justify-between text-[12.5px]"><span className={INK}>{label}</span><span className="font-mono text-axal-muted dark:text-gray-400">{n == null ? (state === 'ok' ? NOT_RECORDED : 'Reading…') : String(n)}</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800">
            <div className="h-2.5 rounded-full bg-axal-violet dark:bg-violet-400" style={{ width: `${width}%` }} data-testid={`pitch-studio-funnel-bar-${i}`} />
          </div>
          {reason ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-studio-funnel-no-ask">{reason}</span> : null}
        </div>
      ))}
      <span className="text-[11.5px] text-axal-muted dark:text-gray-400">
        {!analytics && stats?.capped
          ? `On the current version, as a share of the unique viewers in its latest ${ENGAGEMENT_VIEW_ROWS} views; the NDA count is every signature.`
          : 'On the current version, as a share of its unique viewers; the NDA count is every signature.'}
      </span>
    </section>
  );
}
