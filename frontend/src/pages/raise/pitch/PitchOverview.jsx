import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { deckRehearsalsApi } from '../../../lib/api/deckRehearsals';
import { deckCommentsApi } from '../../../lib/api/deckComments';
import { reportError } from '../../../lib/log';
import { usePhoneWidth } from '../../../ui';
import { DeckCard } from './StudioHome';
import { useDeckChecks } from './DeckVersions';
import { useDeckSources } from './SourcesBoards';
import { NEW_PATH } from './newDeckModel';
import { TEMPLATES_PATH } from './templatesModel';
import { NOT_RECORDED, NOTES_PATH, REVIEW_PATH, asList, currentVersion, dayLabel, readerStats } from './pitchStudioModel';
import {
  NO_DECK_ITEMS, NO_DECK_TITLE, SCRIPT_PATH, SHARE_PATH, WHAT_PITCH_DOES,
  latestHqNote, lastRehearsal, openComments, scriptCoverage,
} from './pitchOverviewModel';

/**
 * D4254 P1 (#4274) — Raise › Pitch's Overview (ps1), and its no-deck state
 * (ps2). The deck is the hero; under it one status card per part of the
 * pitch, each opening its tile; then the latest note from Axal HQ.
 *
 * Every figure is a read: the deck's notes (the script), the rehearsals, the
 * comments, the notes and the engagement the page already reads. A read that
 * fails says so on its own card; a value it cannot read is "Not recorded".
 * Nothing here writes.
 *
 * Not drawn yet, and why: the estimated length against a target and the
 * likely questions answered wait for P2a and P2c (#4268, #4270); Recent
 * investor activity and Upcoming pitch meetings wait for P4 (#4272) and a
 * recorded meetings source (D-h). A block with no source is left out, never
 * filled.
 */
const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const EYEBROW = 'font-mono text-[11px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';

/** One read for the current version: idle until there is a deck, then loading → ok | error. */
function useVersionRead(deckId, fetcher, label) {
  const [state, setState] = useState({ status: 'idle', data: null });
  useEffect(() => {
    if (deckId == null) { setState({ status: 'idle', data: null }); return undefined; }
    let live = true;
    setState({ status: 'loading', data: null });
    fetcher(deckId).then(
      (data) => { if (live) setState({ status: 'ok', data }); },
      (err) => { if (live) { reportError(`pitch overview: ${label}`, err); setState({ status: 'error', data: null }); } },
    );
    return () => { live = false; };
  }, [deckId, fetcher, label]);
  return state;
}

const listRehearsals = (id) => deckRehearsalsApi.list(id);
const listComments = (id) => deckCommentsApi.list(id);
const listNotes = (id) => api.deckNotes(id);

export default function PitchOverview({ reads, readOnly, q }) {
  const phone = usePhoneWidth();
  const versions = asList(reads.versions.data, 'versions', 'decks');
  const current = currentVersion(versions);
  const projectId = reads.project?.id ?? null;
  const deckId = current?.id ?? null;
  const checks = useDeckChecks(reads.versions.status === 'ok' ? projectId : null, versions.length);
  const sources = useDeckSources(projectId);
  const rehearsals = useVersionRead(deckId, listRehearsals, 'rehearsals');
  const comments = useVersionRead(deckId, listComments, 'comments');
  const notes = useVersionRead(deckId, listNotes, 'notes');

  const busy = reads.projects.status === 'loading' || reads.versions.status === 'loading' || reads.versions.status === 'idle';
  if (busy) return <div className={MUTED} aria-busy="true" data-testid="pitch-overview-loading">Reading…</div>;
  if (reads.versions.status === 'error') {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} data-testid="pitch-overview-versions-error">
        <span className={`text-[13.5px] font-bold ${INK}`}>Your deck’s versions could not be read.</span>
        <button type="button" className={GHOST} onClick={reads.reload}>Try again</button>
      </div>
    );
  }
  if (!current) return <NoDeck q={q} readOnly={readOnly} />;

  return (
    <div className="flex flex-col gap-3.5" data-testid="pitch-overview">
      <DeckCard project={reads.project} current={current} deck={reads.deck} engagement={reads.engagement} sources={sources}
        q={q} phone={phone} readOnly={readOnly} checks={checks} onMenu={() => {}} wide />
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4" data-testid="pitch-overview-status">
        <ScriptCard deck={reads.deck} q={q} />
        <RehearsalCard read={rehearsals} q={q} />
        <ReviewCard read={comments} q={q} />
        <SharingCard engagement={reads.engagement} q={q} />
      </div>
      <HqNote read={notes} q={q} />
    </div>
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

const Unread = ({ testId }) => <span className={MUTED} data-testid={testId}>Couldn’t read · Try again from the tile</span>;

function ScriptCard({ deck, q }) {
  const cov = deck.status === 'ok' ? scriptCoverage(deck.data) : null;
  return (
    <Status title="What to say" testId="pitch-overview-script" to={`${SCRIPT_PATH}${q}`} action="Write the script">
      {deck.status === 'error' ? <Unread testId="pitch-overview-script-error" />
        : deck.status !== 'ok' ? <span className={MUTED}>Reading…</span>
          : <Figure value={cov ? `${cov.scripted} of ${cov.cards}` : null} unit="cards scripted" testId="pitch-overview-script-cards" />}
    </Status>
  );
}

function RehearsalCard({ read, q }) {
  const last = read.status === 'ok' ? lastRehearsal(read.data) : null;
  return (
    <Status title="Rehearsal" testId="pitch-overview-rehearsal" to={`${SCRIPT_PATH}${q}`} action={last && !last.none ? 'Rehearse again' : 'Rehearse'}>
      {read.status === 'error' ? <Unread testId="pitch-overview-rehearsal-error" />
        : read.status !== 'ok' ? <span className={MUTED}>Reading…</span>
          : !last ? <Figure value={null} testId="pitch-overview-rehearsal-none" />
            : last.none ? <span className={MUTED} data-testid="pitch-overview-rehearsal-none">No rehearsal yet.</span>
              : (
                <>
                  <Figure value={last.duration} unit={last.target ? `against ${last.target}` : null} testId="pitch-overview-rehearsal-duration" />
                  <span className={MUTED}>{last.at ? `Last run ${dayLabel(last.at)}` : NOT_RECORDED}</span>
                </>
              )}
    </Status>
  );
}

function ReviewCard({ read, q }) {
  const open = read.status === 'ok' ? openComments(read.data) : null;
  return (
    <Status title="Review" testId="pitch-overview-review" to={`${REVIEW_PATH}${q}`} action="Open Review">
      {read.status === 'error' ? <Unread testId="pitch-overview-review-error" />
        : read.status !== 'ok' ? <span className={MUTED}>Reading…</span>
          : <Figure value={open} unit={open === 1 ? 'open comment' : 'open comments'} testId="pitch-overview-review-open" />}
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

function HqNote({ read, q }) {
  if (read.status !== 'ok') return null;
  const note = latestHqNote(read.data);
  if (!note) return null;
  return (
    <section className={`${CARD} flex flex-col gap-1.5 p-4`} data-testid="pitch-overview-hq-note">
      <span className={EYEBROW}>{`${note.name} · Axal HQ${note.at ? ` · ${dayLabel(note.at)}` : ''}`}</span>
      <p className={`m-0 text-[13.5px] leading-[1.5] ${INK}`}>{note.body}</p>
      <Link to={`${NOTES_PATH}${q}`} className="text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300">Open Notes ›</Link>
    </section>
  );
}

/** ps2: no deck yet. The ways in that exist, and what Pitch does; no numbers. */
function NoDeck({ q, readOnly }) {
  const to = { records: `${NEW_PATH}${q}`, template: `${TEMPLATES_PATH}${q}` };
  return (
    <div className="flex flex-col gap-3.5" data-testid="pitch-overview-no-deck">
      <section className={`${CARD} flex flex-col gap-4 p-6`}>
        <h2 className={`m-0 text-[18px] font-extrabold ${INK}`}>{NO_DECK_TITLE}</h2>
        {readOnly ? <span className={MUTED}>The founders haven’t built a deck yet.</span> : (
          <div className="grid gap-3 md:grid-cols-2">
            {NO_DECK_ITEMS.map((it, i) => (
              <Link key={it.id} to={to[it.id]} className={`${CARD} flex flex-col gap-1.5 p-4 hover:border-axal-violet`} data-testid={`pitch-overview-start-${it.id}`}>
                <span className={`text-[14px] font-extrabold ${INK}`}>{it.title}</span>
                <span className={MUTED}>{it.line}</span>
                {i === 0 ? <span className={`${PRIMARY} mt-1 self-start`}>Start</span> : null}
              </Link>
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4" data-testid="pitch-overview-what">
        {WHAT_PITCH_DOES.map(([t, line]) => (
          <section key={t} className={`${CARD} flex flex-col gap-1 p-4`}>
            <span className={`text-[13.5px] font-extrabold ${INK}`}>{t}</span>
            <span className={MUTED}>{line}</span>
          </section>
        ))}
      </div>
    </div>
  );
}
