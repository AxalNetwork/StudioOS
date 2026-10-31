import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { reportError } from '../../../lib/log';
import { deckEditorApi } from '../../../lib/api/deckEditor';
import { deckSourcesApi } from '../../../lib/api/deckSources';
import { newDeckApi } from '../../../lib/api/newDeck';
import { railPressHeaders } from '../../../lib/railPage';
import { Lightbox, Pill, usePhoneWidth } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import ExportDialog from './ExportDialog';
import DataReady from './DataReady';
import { BrandKitSheet, VersionsSheet } from './DeckSheets';
import { useDeckChecks } from './DeckVersions';
import { CoverageMeter, useDeckSources } from './SourcesBoards';
import { SpinoutReadiness } from './StudioActions';
import { availability } from './deckV2Adapter';
import { LATER } from './deckV2Model';
import useMenuFocus from './useMenuFocus';
import { NOT_CHECKED, checkPills } from './checkModel';
import { presentHref } from './presentExportModel';
import { FAST_TITLE, NEW_PATH, buildSentence, fastPathLine, refusalOf } from './newDeckModel';
import {
  ANALYTICS_PATH, EDIT_PATH, EMPTY_DECK, NOT_RECORDED, NO_VIEWS, NEW_DATA_FAILED, NOTHING_BOUND, NOTHING_NEW, REFRESH_THE_DECK,
  asList, coverOf, currentVersion, dayLabel, linkPage, mmss, newInData, readerStats, slideSeconds, versionLabel, versionRows, viewsState, weeklyViews,
} from './pitchStudioModel';

/**
 * D1604 (#3716, pd1, pd1-d, pd9a, pd9b, pd9c) — the studio's home, the Decks
 * tab at /raise/pitch, taking over D894's `StudioDecks`:
 *
 *   the notice      "New in your data since vN" (D1112), lavender, with
 *                   Refresh the deck, when the version holds figures whose
 *                   store has moved on
 *   the deck card   the cover, "[Venture] · vN", Audience, Round, Data
 *                   coverage (the sources read), Saved, Views, the check
 *                   pills, then Open, Present and ⋯: Versions… (PD15's table,
 *                   Compare and Restore, `DeckSheets.VersionsSheet`), Export…
 *                   and Brand kit. Who else is editing (#3824) and "cards not
 *                   Done" (#3826) are not drawn until their routes merge; one
 *                   deck per venture is what main holds.
 *   Start from      Standard outline (New deck), Build a standard deck now
 *                   (the one-click, from your records), Browse templates, and
 *                   Import a .pptx template, greyed "Coming later" (#3809)
 *   Data ready      `DataReady.jsx`: each area's share and "Add in … ›"
 *   Investor links  shared links, unique viewers, median time, views by
 *                   week, most read slide and NDA signed (D894), with
 *                   "Open Share & analytics ›"
 *
 * Plus Spin-Out readiness for a Spin-Out deck (D898 group E). Fill from
 * project is not mounted: the deck's Ask proposes, and nothing is filled
 * without Accept (owner rule). Branding is ⋯ › Brand kit.
 *
 * Every figure comes from a mounted read; a value nobody recorded reads "Not
 * recorded", a failed read says so with Try again, and neither is ever 0.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PILL = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const ITEM = 'flex min-h-[36px] w-full items-center justify-between gap-3 rounded-[8px] px-2.5 text-left text-[12.5px]';

export const START_FROM = 'Start from';
export const FAST_LINE = 'One click, from your records';
export const INVESTOR_LINKS = 'Investor links';
export const OPEN_ANALYTICS = 'Open Share & analytics ›';
/** pd1's Start from, in its order. `fast` is the one-click; `adapter` greys an entry until its route merges. */
export const START_ITEMS = Object.freeze([
  { id: 'outline', label: 'Standard outline', line: 'The outline investors expect at your stage' },
  { id: 'fast', label: FAST_TITLE, line: FAST_LINE },
  { id: 'templates', label: 'Browse templates ›', line: 'Start from a template, by stage and audience' },
  { id: 'pptx', label: 'Import a .pptx template ›', line: 'Map your own layouts to The Grid', adapter: 'pptxImport' },
]);
/** The deck card's ⋯, in its order; `write` items are a writer's. */
export const DECK_CARD_MENU = Object.freeze([
  { id: 'versions', label: 'Versions…' },
  { id: 'export', label: 'Export…', write: true },
  { id: 'brand', label: 'Brand kit' },
]);

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

export default function StudioHome({ reads, readOnly, q }) {
  const phone = usePhoneWidth();
  const versions = asList(reads.versions.data, 'versions', 'decks');
  const current = currentVersion(versions);
  const projectId = reads.project?.id ?? null;
  const busy = reads.projects.status === 'loading' || reads.versions.status === 'loading' || reads.versions.status === 'idle';
  // D900 (#2679): each version's last check, for the deck card's pills and the Versions sheet.
  const checks = useDeckChecks(reads.versions.status === 'ok' ? projectId : null, versions.length);
  // One sources read for the deck card's coverage and Data ready.
  const sources = useDeckSources(projectId);
  const [sheet, setSheet] = useState(null);
  const [compare, setCompare] = useState(null);

  if (busy) {
    return (
      <div className="flex flex-col gap-3.5" aria-busy="true" data-testid="pitch-studio-loading">
        <span className={MUTED}>Reading…</span>
        <div className="grid gap-3.5 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} h="h-56" />)}</div>
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><DataReady sources={{ status: 'loading' }} /><Skeleton h="h-40" /></div>
      </div>
    );
  }
  if (reads.versions.status === 'error') return <ReadFailed text="Your deck's versions could not be read." onRetry={reads.reload} testId="pitch-studio-versions-error" />;

  return (
    <div className="flex flex-col gap-3.5" data-testid="pitch-studio-home">
      {current?.id ? <NewInData current={current} q={q} /> : null}
      <div className="grid gap-3.5 lg:grid-cols-3">
        {current ? (
          <DeckCard project={reads.project} current={current} deck={reads.deck} engagement={reads.engagement} sources={sources}
            q={q} phone={phone} readOnly={readOnly} checks={checks} onMenu={setSheet} />
        ) : (
          <div className={`${CARD} flex flex-col items-center justify-center gap-3 px-5 py-7 text-center lg:col-span-2`} data-testid="pitch-studio-empty">
            <span className={`text-[15px] font-extrabold ${INK}`}>{EMPTY_DECK}</span>
            {!readOnly ? <Link to={`${NEW_PATH}${q}`} className={PRIMARY} data-testid="pitch-studio-empty-new">New deck</Link> : null}
          </div>
        )}
        <StartFrom projectId={projectId} q={q} readOnly={readOnly} />
      </div>
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DataReady sources={sources} />
        <InvestorLinks reads={reads} hasDeck={Boolean(current)} q={q} />
      </div>
      {/* D898 group E: the builder's Spin-Out readiness, now the studio's. */}
      {reads.deck.status === 'ok' ? <SpinoutReadiness projectId={projectId} deck={reads.deck.data} /> : null}

      {sheet === 'versions' && current ? (
        <VersionsSheet projectId={projectId} versions={versions} readOnly={readOnly} dirty={false} phone={phone}
          compare={compare} onCompare={setCompare} onRestored={() => { setCompare(null); setSheet(null); reads.reload(); }}
          onClose={() => { setCompare(null); setSheet(null); }} />
      ) : null}
      {sheet === 'export' && current && !readOnly ? <ExportDialog versions={versions} current={current} onClose={() => setSheet(null)} /> : null}
      {sheet === 'brand' && projectId != null ? <HomeBrandKit projectId={projectId} readOnly={readOnly} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

/** ⋯ › Brand kit from the home: the kit read when the sheet opens. */
function HomeBrandKit({ projectId, readOnly, onClose }) {
  const [kit, setKit] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setKit({ status: 'loading', data: null });
    deckEditorApi.brandKit(projectId).then((d) => { if (live) setKit({ status: 'ok', data: d }); },
      (e) => { if (live) setKit({ status: 'error', data: null }); reportError('pitch-studio:brand-kit', e); });
    return () => { live = false; };
  }, [projectId, tick]);
  return <BrandKitSheet projectId={projectId} kit={{ ...kit, retry: () => setTick((t) => t + 1) }} readOnly={readOnly} onClose={onClose} />;
}

/** The deck card's ⋯ ("More for this deck"): Versions…, Export… and Brand kit. */
function DeckCardMenu({ readOnly, onPick }) {
  const [open, setOpen] = useState(false);
  const menu = useMenuFocus(open, () => setOpen(false));
  const items = DECK_CARD_MENU.filter((it) => !(readOnly && it.write));
  let n = 0;
  return (
    <div className="relative" ref={menu.box} onKeyDown={menu.onKeyDown} onBlur={menu.onBlur} data-testid="pitch-studio-more">
      <button type="button" ref={menu.opener} aria-haspopup="menu" aria-expanded={open} aria-label="More for this deck"
        className="inline-flex h-9 min-w-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-2 text-axal-ink hover:bg-axal-ground max-sm:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        onClick={() => setOpen((o) => !o)} data-testid="pitch-studio-more-open">
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" aria-label="More for this deck"
          className="absolute bottom-[42px] right-0 z-30 flex w-[200px] flex-col gap-0.5 rounded-[12px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {items.map((it) => (
            <button key={it.id} ref={menu.item(n++)} type="button" role="menuitem"
              className={`${ITEM} text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800`}
              onClick={() => { setOpen(false); onPick(it.id); }}
              data-testid={it.id === 'export' ? 'pitch-studio-export' : `pitch-studio-more-${it.id}`}>{it.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ k, children, testId }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-1 text-[12px] first:border-t-0 dark:border-gray-700" data-testid={testId}>
      <dt className="text-axal-muted dark:text-gray-400">{k}</dt>
      <dd className={`m-0 text-right ${INK}`}>{children}</dd>
    </div>
  );
}

function DeckCard({ project, current, deck, engagement, sources, q, phone, readOnly, checks, onMenu }) {
  const cover = deck.status === 'ok' ? coverOf(deck.data) : null;
  const name = String(project?.name || '').trim() || 'Your venture';
  const row = versionRows([current])[0];
  const stats = engagement.status === 'ok' ? readerStats(engagement.data) : null;
  const views = engagement.status === 'error' ? 'Could not be read' : engagement.status !== 'ok' ? '…' : stats ? `${stats.views}${stats.capped ? '+' : ''}` : NOT_RECORDED;
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4 lg:col-span-2 ${phone ? '' : 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start'}`} data-testid="pitch-studio-current">
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
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[15px] font-extrabold ${INK}`}>{`${name} · ${versionLabel(current)}`}</span>
          {current.is_current ? <span className={PILL_VIO}>Current</span> : null}
        </div>
        <dl className="m-0 flex flex-col" data-testid="pitch-studio-deck-facts">
          <Fact k="Audience" testId="pitch-studio-deck-audience">{row.audience}</Fact>
          <Fact k="Round" testId="pitch-studio-deck-round">{row.round}</Fact>
          <Fact k="Saved">{`${dayLabel(current.created_at)}${cover?.slides ? ` · ${cover.slides} card${cover.slides === 1 ? '' : 's'}` : ''}`}</Fact>
          <Fact k="Views" testId="pitch-studio-deck-views">{views}</Fact>
        </dl>
        {/* D896 (#2675): the coverage meter, from the sources read; loading and error draw no counts. */}
        {sources.status !== 'idle' ? (
          <div data-testid="pitch-studio-coverage">
            <CoverageMeter coverage={sources.data?.coverage} status={sources.status} size="M" onRetry={sources.retry} />
          </div>
        ) : null}
        <CheckPills checks={checks} current={current} q={q} />
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Link to={`${EDIT_PATH}${q}`} className={GHOST} data-testid="pitch-studio-open">Open</Link>
          {/* D901 (#2680): present reads, so a read-only viewer presents too (PD21). */}
          <Link to={presentHref(project?.id, current.id)} className={GHOST} data-testid="pitch-studio-present">Present</Link>
          <DeckCardMenu readOnly={readOnly} onPick={onMenu} />
        </div>
      </div>
    </section>
  );
}

/** pd1's Start from: four ways to begin, the one-click among them. */
function StartFrom({ projectId, q, readOnly }) {
  return (
    <section className={`${CARD} flex flex-col gap-1 p-4`} aria-labelledby="pitch-studio-start-title" data-testid="pitch-studio-start">
      <h2 id="pitch-studio-start-title" className={`${EYE} m-0`}>{START_FROM}</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {START_ITEMS.map((it) => {
          if (it.id === 'fast') return !readOnly && projectId != null ? <FastPath key={it.id} projectId={projectId} q={q} /> : null;
          const off = it.adapter ? availability(it.adapter) : null;
          if (off && off.available !== true) {
            return (
              <li key={it.id} className="flex flex-col gap-0.5 border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-700" title={off.reason} data-testid={`pitch-studio-start-${it.id}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-bold text-axal-muted dark:text-gray-500" aria-disabled="true">{it.label}</span>
                  <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500">{LATER}</span>
                </span>
                <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{it.line}</span>
              </li>
            );
          }
          if (readOnly) return null;
          return (
            <li key={it.id} className="flex flex-col gap-0.5 border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-700" data-testid={`pitch-studio-start-${it.id}`}>
              <Link to={`${NEW_PATH}${q}`} className={`text-[13.5px] font-bold ${INK} hover:text-axal-violet dark:hover:text-violet-300`}>{it.label}</Link>
              <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{it.line}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** pd1's Investor links: the links' totals, then D894's readers, and the way to the full tab. */
function InvestorLinks({ reads, hasDeck, q }) {
  const pager = reads.module.status === 'ok' ? linkPage(reads.module.data?.records) : null;
  const stats = reads.engagement.status === 'ok' ? readerStats(reads.engagement.data) : null;
  const unread = reads.engagement.status === 'error';
  const val = (v) => (unread ? 'Could not be read' : reads.engagement.status !== 'ok' ? '…' : v == null ? NOT_RECORDED : v);
  return (
    <section className="flex min-w-0 flex-col gap-3.5" aria-label={INVESTOR_LINKS} data-testid="pitch-studio-investor-links">
      {hasDeck ? (
        <div className={`${CARD} flex flex-col gap-1 p-4`} data-testid="pitch-studio-links-summary">
          <span className={EYE}>{INVESTOR_LINKS}</span>
          <dl className="m-0 flex flex-col">
            <Fact k="Shared links">{reads.module.status === 'error' ? 'Could not be read' : pager?.total != null ? String(pager.total) : reads.module.status === 'ok' ? NOT_RECORDED : '…'}</Fact>
            <Fact k="Unique viewers">{val(stats ? String(stats.viewers) : null)}</Fact>
            <Fact k="Median time per view">{val(stats ? mmss(stats.medianSeconds) : null)}</Fact>
          </dl>
          <Link to={`${ANALYTICS_PATH}${q}`} className={LINK} data-testid="pitch-studio-open-analytics">{OPEN_ANALYTICS}</Link>
        </div>
      ) : null}
      <ReadersAside reads={reads} hasDeck={hasDeck} />
    </section>
  );
}

/** D900: the check pills for the current version: its counts, Not checked, or the read's failure. */
function CheckPills({ checks, current, q }) {
  if (checks == null) return null;
  if (checks === 'error') return <span className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="pitch-studio-checks-error">The check could not be read.</span>;
  const mine = checks.get(Number(current.id));
  const pills = mine?.checked ? checkPills(mine.counts) : [];
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="pitch-studio-checks">
      {!mine?.checked ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{NOT_CHECKED}</span> : null}
      {mine?.checked && !pills.length ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">Checked · no figures</span> : null}
      {pills.map((p) => <Pill key={p.key} tone={p.tone}>{p.label}</Pill>)}
      <Link to={`${EDIT_PATH}${q}`} className="text-[11.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="pitch-studio-checks-open">Open the check ›</Link>
    </div>
  );
}

/**
 * D897 (#2677), PD2 → pd1's Start from: "Build a standard deck now" — twelve cards from everything
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
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline py-3 first:border-t-0 dark:border-gray-700" data-testid="pitch-studio-fast">
      <div className="flex min-w-0 flex-col gap-1">
        <span className={`text-[13.5px] font-bold ${INK}`}>{FAST_TITLE}</span>
        <span className={MUTED}>{FAST_LINE}</span>
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{fastPathLine(quote)}</span>
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
    </li>
  );
}

/**
 * D1112 (#2992), PD2: "New in your data since vN" — the figures this version
 * holds whose store has moved on, from D896's refresh read (it writes
 * nothing). "Refresh the deck" opens the editor, which marks those cards.
 */
function NewInData({ current, q }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    deckSourcesApi.refresh(current.id).then(
      (d) => { if (live) setState({ status: 'ok', data: d }); },
      (e) => { if (live) setState({ status: 'error', data: null }); reportError('pitch-studio:new-in-data', e); },
    );
    return () => { live = false; };
  }, [current.id, tick]);
  const label = versionLabel(current);
  const view = state.status === 'ok' ? newInData(state.data) : null;
  return (
    <section className="flex flex-col gap-2 rounded-[12px] border border-axal-lavender-edge bg-axal-lavender p-4 dark:border-violet-800 dark:bg-violet-950/40" data-testid="pitch-studio-new-data">
      <span className={EYE}>New in your data since {label}</span>
      {state.status === 'loading' ? <Skeleton h="h-14" /> : null}
      {state.status === 'error' ? (
        <div role="alert" className="flex flex-col gap-2">
          <span className={MUTED}>{NEW_DATA_FAILED}</span>
          <button type="button" className={`${GHOST} self-start`} onClick={() => setTick((t) => t + 1)}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
        </div>
      ) : null}
      {view && !view.checked ? <span className={MUTED} data-testid="pitch-studio-new-data-unbound">{NOTHING_BOUND}</span> : null}
      {view && view.checked && !view.items.length ? <span className={MUTED} data-testid="pitch-studio-new-data-none">{NOTHING_NEW(label)}</span> : null}
      {view && view.items.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {view.items.map((it) => (
            <li key={it.key} className="flex items-center justify-between gap-3 border-t border-axal-hairline py-1.5 text-[12.5px] first:border-t-0 dark:border-gray-700" data-testid={`pitch-studio-new-data-${it.key}`}>
              <span className={INK}>{it.t}</span>
              <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{it.v}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {view && view.unknown ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{view.unknown} figure{view.unknown === 1 ? '' : 's'} could not be read for you, so {view.unknown === 1 ? 'it is' : 'they are'} not compared.</span> : null}
      {view && view.items.length ? <Link to={`${EDIT_PATH}${q}`} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="pitch-studio-refresh-deck">{REFRESH_THE_DECK}</Link> : null}
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
