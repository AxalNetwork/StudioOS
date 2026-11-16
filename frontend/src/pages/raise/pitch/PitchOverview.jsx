import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { usePhoneWidth } from '../../../ui';
import { DeckCard, DeckHomeSheets } from './StudioHome';
import DataReady from './DataReady';
import { useDeckChecks } from './DeckVersions';
import { useDeckSources } from './SourcesBoards';
import { DraftDialog } from '../caprel/CapRelOutreach';
import DocumentImport from './DocumentImport';
import { availability, cardStatus, comments, draft as readDraft, figures, investorLinks, rehearse } from './deckV2Adapter';
import { adapterRead, draftState, linkedCardCoverage, nextPitchStep, pitchReadFailure, pitchVersionHref, versionReadiness } from './pitchHomeModel';
import { LATER } from './deckV2Model';
import { NEW_PATH } from './newDeckModel';
import { TEMPLATES_PATH } from './templatesModel';
import { NOT_RECORDED, NOTES_PATH, REVIEW_PATH, asList, currentVersion, dayLabel, readerStats } from './pitchStudioModel';
import {
  NO_DECK_ITEMS, NO_DECK_TITLE, SCRIPT_PATH, SHARE_PATH,
  investorActivity, latestHqNote, lastRehearsal, openComments, scriptCoverage,
} from './pitchOverviewModel';

/** PS-02 (#6055): Studio home, with parallel reads scoped to the exact saved version. */
const BTN = 'inline-flex min-h-11 sm:min-h-9 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYEBROW = 'font-mono text-[11px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';

function useVersionRead(deckId, fetcher, label) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (deckId == null) return undefined;
    let live = true;
    fetcher(deckId).then(
      (read) => { if (live) setState({ ...read, deckId, attempt }); },
      (err) => {
        if (live) setState({ status: pitchReadFailure(err?.status), data: null, deckId, attempt });
        reportError(`pitch overview: ${label}`, err);
      },
    );
    return () => { live = false; };
  }, [deckId, fetcher, label, attempt]);
  const active = state?.deckId === deckId && state?.attempt === attempt ? state : { status: 'loading', data: null };
  return { ...active, retry: () => setAttempt((n) => n + 1) };
}

const listDraft = (id) => readDraft(id).then(adapterRead);
const listFigures = (id) => figures(id).then(adapterRead);
const listStatuses = (id) => cardStatus(id).then(adapterRead);
const listRehearsals = (id) => rehearse(id).then(adapterRead);
const listComments = (id) => comments(id).then(adapterRead);
const listNotes = (id) => api.deckNotes(id).then((data) => ({ status: 'ok', data }));
const listLinks = (id) => investorLinks(id).then(adapterRead);
export const CAPREL_PATH = '/raise/capital-relationships/pipeline';

export default function PitchOverview({ reads, readOnly, q }) {
  const phone = usePhoneWidth();
  const versions = asList(reads.versions.data, 'versions', 'decks');
  const current = reads.selectedDeck === undefined ? currentVersion(versions) : reads.selectedDeck;
  const projectId = reads.project?.id ?? null;
  const deckId = current?.id ?? null;
  const [sheet, setSheet] = useState(null);
  const [importing, setImporting] = useState(false);
  const checks = useDeckChecks(current ? projectId : null, versions.length, deckId, reads.revision);
  const sources = useDeckSources(!readOnly && !current && reads.versions.status === 'ok' ? projectId : null);
  const draft = useVersionRead(readOnly ? null : deckId, listDraft, 'working draft');
  const figuresRead = useVersionRead(deckId, listFigures, 'figure sources');
  const statuses = useVersionRead(deckId, listStatuses, 'card status');
  const rehearsals = useVersionRead(deckId, listRehearsals, 'rehearsals');
  const comments = useVersionRead(deckId, listComments, 'comments');
  const notes = useVersionRead(deckId, listNotes, 'notes');
  const links = useVersionRead(deckId, listLinks, 'investor links');
  const previous = versions.find((v) => Number(v.version) < Number(current?.version));
  const previousLinks = useVersionRead(previous?.id ?? null, listLinks, 'previous investor links');

  if (reads.versions.status === 'error') {
    const kind = pitchReadFailure(reads.versions.error?.status);
    return (
      <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} data-testid="pitch-overview-versions-error">
        <ReadState kind={kind} retry={reads.reload} />
      </div>
    );
  }
  if (reads.versions.status !== 'ok') return <OverviewLoading />;
  if (!current) return <NoDeck q={q} readOnly={readOnly} projectId={projectId} sources={sources} />;

  const readiness = versionReadiness(checks, current);
  const working = draftState(draft);
  const next = nextPitchStep({ current, readiness, draft: working, links, readOnly });
  const cover = linkedCardCoverage(reads.deck.data, figuresRead.data);
  const coverageStatus = figuresRead.status !== 'ok' ? figuresRead.status
    : reads.deck.status === 'error' ? pitchReadFailure(reads.deck.error?.status) : reads.deck.status;
  const retryCoverage = figuresRead.status === 'ok' ? reads.reload : figuresRead.retry;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="pitch-overview">
      <div className={`grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] ${next ? "xl:grid-rows-[auto_auto_minmax(0,1fr)]" : "xl:grid-rows-[auto_minmax(0,1fr)]"}`}>
        {next && (
          <section aria-label="Next step" className="flex flex-wrap items-center gap-3 rounded-xl xl:col-start-2 xl:row-start-1 border border-axal-violet bg-axal-lavender p-4 dark:border-violet-700 dark:bg-violet-950/40" data-testid="pitch-overview-next">
            <div className="min-w-0 flex-1 basis-[12rem]">
              <span className={EYEBROW}>Next step</span>
              <h2 className={`m-0 text-[16px] font-extrabold ${INK}`}>{next.title}</h2>
              <p className={`m-0 ${MUTED}`}>{next.line}</p>
            </div>
            <Link className={PRIMARY} to={next.kind === 'draft' ? `${next.path}${q}` : pitchVersionHref(next.path, q, current.id)}>{next.label}</Link>
          </section>
        )}
        <div className={`min-w-0 xl:col-start-1 xl:row-start-1 ${next ? 'xl:row-span-3' : 'xl:row-span-2'}`}>
          <DeckCard project={reads.project} current={current} deck={reads.deck} engagement={reads.engagement}
            q={q} phone={phone} readOnly={readOnly} onMenu={setSheet} overview>
            <VersionPair current={current} working={working} retry={draft.retry} readOnly={readOnly} />
          </DeckCard>
        </div>
        <div className={`grid gap-3 sm:grid-cols-3 xl:col-start-2 ${next ? 'xl:row-start-2' : 'xl:row-start-1'}`}>
          <Metric title={`Readiness · ${versionName(current)}`}>
            {readiness.line ? <><strong>{readiness.line}</strong><span className={MUTED}>Figure check</span></> : <ReadState kind={readiness.kind} retry={reads.reload} />}
          </Metric>
          <Metric title="Evidence coverage">
            {cover ? <><strong>{cover.linked} of {cover.total}</strong><span className={MUTED}>Cards with at least one figure, all linked</span></>
              : <ReadState kind={coverageStatus} retry={retryCoverage} />}
          </Metric>
          <Metric title="Cards not Done">
            {statuses.status === 'ok'
              ? statuses.data?.tracked && Number.isInteger(statuses.data?.not_done?.count)
                ? <><strong>{statuses.data.not_done.count}{Number.isInteger(statuses.data.total) ? ` of ${statuses.data.total}` : ''}</strong>
                  {statuses.data.not_done.cards?.length ? <span className={MUTED}>{statuses.data.not_done.cards.map((card) => card.title).filter(Boolean).join(', ')}</span> : null}</>
                : <span className={MUTED}>Not recorded</span>
              : <ReadState kind={statuses.status} retry={statuses.retry} />}
          </Metric>
        </div>
        <div className={`min-w-0 xl:col-start-2 ${next ? 'xl:row-start-3' : 'xl:row-start-2'}`}>
          <InvestorActivity read={links} previousRead={previous ? previousLinks : null} q={q} projectId={projectId} readOnly={readOnly} />
        </div>
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4" data-testid="pitch-overview-status">
        <Status title="Script & rehearsal" testId="pitch-overview-script" to={`${SCRIPT_PATH}${q}`} action="Open Script & rehearsal">
          <ScriptCard deck={reads.deck} />
          <RehearsalCard read={rehearsals} />
        </Status>
        <ReviewCard read={comments} q={q} />
        <HqNote read={notes} q={q} />
        {!readOnly ? (
          <Metric title="Start something else">
            <Link to={`${NEW_PATH}${q}`} className={LINK}>New deck</Link>
            <Link to={`${TEMPLATES_PATH}${q}`} className={LINK}>Templates</Link>
            {projectId != null && !availability('importDocument') && <button type="button" className={`${LINK} self-start`} onClick={() => setImporting(true)}>Import a deck or document</button>}
          </Metric>
        ) : <SharingCard engagement={reads.engagement} q={q} />}
      </div>
      {importing && <DocumentImport projectId={projectId} q={q} onClose={() => setImporting(false)} />}
      <DeckHomeSheets sheet={sheet} projectId={projectId} versions={versions} current={current} readOnly={readOnly} phone={phone}
        onClose={() => setSheet(null)} onRestored={reads.reload} />
    </div>
  );
}

const LINK = 'min-h-11 content-center text-[12.5px] font-bold text-axal-violet hover:underline sm:min-h-7 dark:text-violet-300';

const versionName = (current) => current.version == null ? NOT_RECORDED : `v${current.version}`;

function ReadState({ kind, retry }) {
  if (kind === 'loading' || kind === 'idle') {
    return <span role="status" className="inline-flex h-4 w-24 animate-pulse rounded bg-axal-hairline dark:bg-gray-700"><span className="sr-only">Reading…</span></span>;
  }
  return (
    <span className={`flex flex-wrap items-center gap-2 ${MUTED}`}>
      {kind === 'refused' ? 'Refused' : kind === 'unavailable' ? 'Unavailable' : NOT_RECORDED}
      {kind === 'unavailable' && retry && <button type="button" onClick={retry} className={LINK}>Try again</button>}
    </span>
  );
}

function OverviewLoading() {
  return (
    <div role="status" aria-busy="true" className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]" data-testid="pitch-overview-loading">
      <span className="sr-only">Reading the deck…</span>
      <div className="h-72 animate-pulse rounded-xl bg-axal-hairline dark:bg-gray-800" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-20 animate-pulse rounded-xl bg-axal-hairline dark:bg-gray-800 sm:col-span-3" />
        {[0, 1, 2].map((cell) => <div key={cell} className="h-24 animate-pulse rounded-xl bg-axal-hairline dark:bg-gray-800" />)}
      </div>
    </div>
  );
}

function VersionPair({ current, working, retry, readOnly }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="pitch-overview-version-pair">
      <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30" data-testid="pitch-overview-saved-version">
        <span className={EYEBROW}>Version saved</span>
        <strong className={INK}>{versionName(current)}</strong>
        <span className={MUTED}>{dayLabel(current.created_at)}</span>
      </div>
      {!readOnly && (
        <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-dashed border-axal-violet bg-axal-lavender p-3 dark:border-violet-700 dark:bg-violet-950/40" data-testid="pitch-overview-working-draft">
          <span className={EYEBROW}>Working draft</span>
          {working.kind === 'saved' ? <><strong className={INK}>Draft saved</strong>{working.at && <span className={MUTED}>{dayLabel(working.at)}</span>}</>
            : working.kind === 'empty' ? <span className={MUTED}>No draft changes</span> : <ReadState kind={working.kind} retry={retry} />}
        </div>
      )}
    </div>
  );
}

function Metric({ title, children }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-1.5 p-4 ${INK}`}>
      <h2 className={`m-0 ${EYEBROW}`}>{title}</h2>
      {children}
    </section>
  );
}

function Status({ title, testId, children, to, action }) {
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-4`} data-testid={testId}>
      <span className={EYEBROW}>{title}</span>
      <div className="flex flex-1 flex-col gap-1.5">{children}</div>
      <Link to={to} className={`${GHOST} self-start`} data-testid={`${testId}-open`}>{action}</Link>
    </section>
  );
}

const Figure = ({ value, unit, testId }) => (
  <span className={`text-[15px] font-extrabold ${INK}`} data-testid={testId}>
    {value == null ? NOT_RECORDED : value}{value != null && unit ? <span className={`ml-1 text-[12.5px] font-semibold ${MUTED}`}>{unit}</span> : null}
  </span>
);

const Unread = ({ testId }) => <span className={MUTED} data-testid={testId}>Unavailable</span>;

function ScriptCard({ deck }) {
  const cov = deck.status === 'ok' ? scriptCoverage(deck.data) : null;
  return deck.status === 'ok'
    ? <Figure value={cov ? `${cov.scripted} of ${cov.cards}` : null} unit="cards scripted" testId="pitch-overview-script-cards" />
    : <ReadState kind={deck.status === 'error' ? pitchReadFailure(deck.error?.status) : deck.status} />;
}

function RehearsalCard({ read }) {
  if (read.status !== 'ok') return <ReadState kind={read.status} retry={read.retry} />;
  const last = lastRehearsal(read.data);
  if (last?.none) return <span className={MUTED} data-testid="pitch-overview-rehearsal-none">No rehearsal yet.</span>;
  if (!last) return <span className={MUTED}>{NOT_RECORDED}</span>;
  return (
    <span className={MUTED} data-testid="pitch-overview-rehearsal-duration">
      Last rehearsal {last.duration ?? NOT_RECORDED}{last.target ? ` against ${last.target}` : ''}
    </span>
  );
}

function ReviewCard({ read, q }) {
  const open = read.status === 'ok' ? openComments(read.data) : null;
  return (
    <Status title="Comments" testId="pitch-overview-review" to={`${REVIEW_PATH}${q}`} action="Open Review">
      {read.status === 'ok' ? <Figure value={open} unit={open === 1 ? 'open comment' : 'open comments'} testId="pitch-overview-review-open" />
        : <ReadState kind={read.status} retry={read.retry} />}
    </Status>
  );
}

function SharingCard({ engagement, q }) {
  const stats = engagement.status === 'ok' ? readerStats(engagement.data) : null;
  return (
    <Status title="Sharing" testId="pitch-overview-sharing" to={`${SHARE_PATH}${q}`} action="Open Share & analytics">
      {engagement.status === 'error' ? <Unread testId="pitch-overview-sharing-error" />
        : engagement.status !== 'ok' ? <span className={MUTED}>Reading…</span>
          : (
            <>
              <Figure value={stats ? `${stats.views}${stats.capped ? '+' : ''}` : null} unit="views on this version" testId="pitch-overview-sharing-views" />
              <span className={MUTED} data-testid="pitch-overview-sharing-nda">{stats?.ndaSigned == null ? `NDAs accepted: ${NOT_RECORDED}` : `${stats.ndaSigned} NDA${stats.ndaSigned === 1 ? '' : 's'} accepted`}</span>
            </>
          )}
    </Status>
  );
}

/** ps1: Recent investor activity. Each row opens Capital relationships; a founder can draft a follow-up. */
function InvestorActivity({ read, previousRead, q, projectId, readOnly }) {
  const [drafting, setDrafting] = useState(null);
  const currentRows = read.status === 'ok' ? investorActivity(read.data, undefined, { showUnopened: true }) : null;
  const previousRows = previousRead?.status === 'ok' ? investorActivity(previousRead.data, undefined, { showUnopened: true }) : null;
  const rows = [...(currentRows ?? []), ...(previousRows ?? [])].sort((a, b) => b.t - a.t).slice(0, 5);
  const partial = previousRead && (currentRows == null) !== (previousRows == null);
  const missing = currentRows == null ? read : previousRead;
  const status = currentRows != null && (!previousRead || previousRows != null)
    ? 'ok' : missing.status === 'ok' ? 'unavailable' : missing.status;
  return (
    <section className={`${CARD} flex flex-col gap-1 p-4`} data-testid="pitch-overview-activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={`m-0 text-[14px] font-extrabold ${INK}`}>Recent investor activity</h2>
        <Link to={`${SHARE_PATH}${q}`} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300" data-testid="pitch-overview-activity-all">Share & analytics ›</Link>
      </div>
      {partial && <span className={MUTED}>Partial · {currentRows == null ? 'Current' : 'Previous'} version activity</span>}
      {status !== 'ok' && <ReadState kind={status} retry={missing.retry} />}
      {!rows.length && status === 'ok' && <span className={MUTED} data-testid="pitch-overview-activity-none">No investor activity yet.</span>}
      {rows.map((r, i) => (
        <div key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 ${i ? 'border-t border-axal-hairline dark:border-gray-700' : ''}`} data-testid={`pitch-overview-activity-${r.id}`}>
          <span aria-hidden="true" className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-axal-lavender text-[11px] font-bold text-violet-800 dark:bg-violet-950/50 dark:text-violet-200">{r.initials}</span>
          <div className="flex min-w-0 flex-1 basis-44 flex-col gap-0.5">
            <span className={`text-[13px] font-bold ${INK}`}>{r.fund || r.name || 'An investor'}{r.fund && r.name ? <span className="font-medium text-axal-muted dark:text-gray-400"> · {r.name}</span> : null}</span>
            <span className="text-[12.5px] text-axal-ink/80 dark:text-gray-300">{r.version != null ? `v${r.version} · ` : ''}{r.line}{r.nda ? ` · ${r.nda}` : ''}{r.views ? ` · ${r.views} ${r.views === 1 ? 'view' : 'views'}` : ''}{r.at ? ` · ${dayLabel(r.at)}` : ''}</span>
          </div>
          {!readOnly && r.prospectId != null && projectId != null ? (
            <button type="button" className={GHOST} onClick={() => setDrafting(r)} data-testid={`pitch-overview-activity-draft-${r.id}`}>Draft follow-up</button>
          ) : null}
          <Link to={`${CAPREL_PATH}${q}`} className={GHOST} data-testid={`pitch-overview-activity-open-${r.id}`}>Open in Capital relationships</Link>
        </div>
      ))}
      {drafting ? (
        <DraftDialog projectId={projectId} prospect={{ id: drafting.prospectId, name: drafting.name || drafting.fund }} purpose="follow_up" onClose={() => setDrafting(null)} />
      ) : null}
    </section>
  );
}

function HqNote({ read, q }) {
  const note = read.status === 'ok' ? latestHqNote(read.data) : null;
  return (
    <section className={`${CARD} flex flex-col gap-1.5 p-4`} data-testid="pitch-overview-hq-note">
      <span className={EYEBROW}>Notes from Axal HQ</span>
      {note ? <>
        <p className={`m-0 break-words text-[13.5px] leading-[1.5] ${INK}`}>{note.body}</p>
        <span className={MUTED}>{note.name}{note.at ? ` · ${dayLabel(note.at)}` : ''}</span>
      </> : read.status === 'ok' ? <span className={MUTED}>No notes from Axal HQ yet.</span> : <ReadState kind={read.status} retry={read.retry} />}
      <Link to={`${NOTES_PATH}${q}`} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300">Open Notes ›</Link>
    </section>
  );
}

/**
 * ps2: no deck yet. The ways in that exist, and what Pitch does; no numbers.
 * D4599: the import is the third way in. It opens the Decks tile's sheet in place, so a founder
 * on a phone or a desktop imports from the first screen. Off on this Worker, it says so and opens nothing.
 */
function NoDeck({ q, readOnly, projectId, sources }) {
  const [importing, setImporting] = useState(false);
  const to = { records: `${NEW_PATH}${q}`, manual: `${NEW_PATH}${q}${q ? '&' : '?'}start=manual` };
  const head = (it) => (
    <>
      <span className={`text-[14px] font-extrabold ${INK}`}>{it.title}</span>
      <span className={MUTED}>{it.line}</span>
    </>
  );
  return (
    <div className="flex flex-col gap-3.5" data-testid="pitch-overview-no-deck">
      <section className={`${CARD} flex flex-col gap-4 bg-axal-lavender p-6 dark:bg-violet-950/40`}>
        <h2 className={`m-0 max-w-3xl text-[23px] font-extrabold leading-tight tracking-tight sm:text-[27px] ${INK}`}>{NO_DECK_TITLE}</h2>
        {readOnly ? <span className={MUTED}>The founders haven’t built a deck yet.</span> : (
          <div className="grid gap-3 md:grid-cols-3">
            {NO_DECK_ITEMS.map((it, i) => {
              if (!it.adapter) {
                return (
                  <Link key={it.id} to={to[it.id]} className={`${CARD} flex min-h-11 flex-col gap-1.5 p-4 hover:border-axal-violet ${i === 0 ? 'border-axal-violet dark:border-violet-400' : ''}`} data-testid={`pitch-overview-start-${it.id}`}>
                    {head(it)}
                  </Link>
                );
              }
              const off = availability(it.adapter);
              if ((off && off.available !== true) || projectId == null) {
                return (
                  <div key={it.id} className={`${CARD} flex flex-col gap-1.5 p-4`} aria-disabled="true" title={off?.reason || undefined} data-testid={`pitch-overview-start-${it.id}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-extrabold text-axal-muted dark:text-gray-500">{it.title}</span>
                      <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500" data-testid={`pitch-overview-start-${it.id}-off`}>{off ? LATER : 'Unavailable'}</span>
                    </span>
                    <span className={MUTED}>{it.line}</span>
                  </div>
                );
              }
              return (
                <button key={it.id} type="button" onClick={() => setImporting(true)}
                  className={`${CARD} flex min-h-[44px] flex-col gap-1.5 p-4 text-left hover:border-axal-violet`} data-testid={`pitch-overview-start-${it.id}`}>
                  {head(it)}
                </button>
              );
            })}
          </div>
        )}
      </section>
      {importing ? <DocumentImport projectId={projectId} q={q} onClose={() => setImporting(false)} /> : null}
      {!readOnly && <>
        <DataReady sources={sources} overview />
        <Link to={`${TEMPLATES_PATH}${q}`} className={`${LINK} self-start`}>Browse templates</Link>
      </>}
    </div>
  );
}
