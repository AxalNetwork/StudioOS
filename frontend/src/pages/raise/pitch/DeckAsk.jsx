import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { newDeckApi } from '../../../lib/api/newDeck';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { reportError } from '../../../lib/log';
import useAssistMode from '../../../hooks/useAssistMode';
import Sheet from '../../../ui/Sheet.jsx';
import { AskButtonView } from '../../../ui/AskButton.jsx';
import { EDIT_PATH, asList, currentVersion, ventureQuery } from './pitchStudioModel';
import { NEW_PATH, refusalOf } from './newDeckModel';
import {
  ACCEPT, ACCEPT_ALL, ASK_OFF, ASK_UNREADABLE, CHARGED_LINE, DECK_ASK_OPTIONS, DISCARD, STILL_WORKS, WAITING_NONE, WAITING_TITLE,
  cardEdit, cardEditLine, waitingCount,
} from './deckV2Model';

/**
 * D1604 (#3716, pd40) — the Pitch deck studio's header Ask and its sheet,
 * "Waiting for you". Mounted by `PitchPage.jsx` on the studio, New deck and
 * the editor.
 *
 *   The button   `ui/AskButton.jsx`: "Ask", accessible name "Ask Eadwyn",
 *                with ", N waiting" when proposals wait. A read that failed
 *                draws no count (never "0 waiting") and the sub-line "Eadwyn
 *                could not be reached. Try again." With AI paused the name
 *                stays "Ask Eadwyn" and the mark greys (owner question H).
 *   The sheet    what Eadwyn proposed for this deck and nobody decided yet:
 *                1. the whole-deck proposal (`GET /api/decks/by-project/:pid`
 *                   → `proposal`): Review (New deck's proposal review), Accept
 *                   all (`POST /api/decks/proposals/:id/keep-slides`, every
 *                   card, saved as a version) and Discard
 *                   (`DELETE /api/decks/proposals/:id`);
 *                2. card edits a card run left (`GET /api/ai/rail/proposals`
 *                   per deck option, `record=deck:<id>`): in the editor,
 *                   Accept places the edit in its card (held until Save, like
 *                   every edit) and records the decision; elsewhere, "Open in
 *                   the editor ›". Discard records the decision.
 *
 * IT HAS NO INPUT. No thread, no composer, no Run chips: typed instructions
 * live only in the editor, scoped to the selection (the owner's rule). Nothing
 * is saved without Accept, and Ask runs no model: accepting what waits costs
 * nothing more, which is why it still works with AI paused.
 *
 * Generated images that were not kept are not listed: on main the only image
 * read is the kept ones (`GET /api/decks/:id/images`), so there is nothing to
 * read them from.
 *
 * `versions` is the page's own `GET /api/decks/by-project/:pid` read
 * (`{ status, data }`) when it has one, so the header never reads it twice;
 * a decision on the deck's proposal then asks the page to read again
 * (`onChanged`). Without it, Ask reads it itself.
 *
 * `onPlace(edit)` is the editor's: it answers `{ error }` or `{ commit }`, and
 * `commit()` places the edit after the decision is recorded. #3706's platform
 * Ask panel will hold this sheet as the deck's section (owner question F).
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const CARD = 'rounded-[12px] border border-axal-hairline bg-white p-3.5 dark:border-gray-700 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[44px] dark:hover:bg-violet-500';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 max-sm:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const LINK = 'text-[12.5px] font-bold text-axal-violet hover:underline dark:text-violet-300';
const BAD = 'm-0 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';
const EYE = 'font-mono text-[10.5px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400';

/** The live reads and writes; a test hands its own. One object, so a render never makes a new read. */
const SOURCE = Object.freeze({
  versions: (projectId) => api.deckListVersions(projectId),
  keepAll: (proposalId) => newDeckApi.keepSlides(proposalId, { all: true, save: true }),
  discardDeck: (proposalId) => api.deckDiscardProposal(proposalId),
  proposals: railProposalsApi,
});

/** Every card edit waiting on this deck version, one read per deck option. Throws when any read fails. */
async function readEdits(source, deckId) {
  const replies = await Promise.all(DECK_ASK_OPTIONS.map((option) => source.proposals.list({ option, record: `deck:${deckId}`, status: 'proposed' })));
  const seen = new Set();
  const items = [];
  for (const reply of replies) {
    for (const row of asList(reply, 'proposals', 'items')) {
      const edit = cardEdit(row, deckId);
      if (edit && !seen.has(edit.uid)) { seen.add(edit.uid); items.push(edit); }
    }
  }
  return items.sort((a, b) => a.card - b.card || String(a.at || '').localeCompare(String(b.at || '')));
}

export default function DeckAsk({ projectId, versions, readOnly = false, onPlace = null, onChanged, source = SOURCE }) {
  const [aiOn] = useAssistMode('raise');
  const [own, setOwn] = useState({ status: 'loading', data: null });
  const [edits, setEdits] = useState({ status: 'loading', items: [] });
  const [tick, setTick] = useState(0);
  const [editsTick, setEditsTick] = useState(0);
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  // The page's own versions read when it has one (`{ status, data }`), so the
  // header never asks for the same thing twice; otherwise Ask reads it.
  const shared = versions !== undefined;

  useEffect(() => {
    if (shared || projectId == null) return undefined;
    let live = true;
    setOwn({ status: 'loading', data: null });
    source.versions(projectId).then(
      (data) => { if (live) setOwn({ status: 'ok', data }); },
      (e) => { reportError('pitch-ask:versions', e); if (live) setOwn({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [shared, projectId, source, tick]);

  const read = shared ? (versions || { status: 'loading', data: null }) : own;
  const deck = useMemo(() => {
    if (read.status === 'error') return { status: 'unreadable', proposal: null, deckId: null };
    if (read.status !== 'ok') return { status: 'loading', proposal: null, deckId: null };
    const current = currentVersion(asList(read.data, 'versions', 'decks'));
    const proposal = read.data?.proposal && read.data.proposal.id != null ? read.data.proposal : null;
    return { status: 'ready', proposal, deckId: current?.id ?? null };
  }, [read.status, read.data]);

  useEffect(() => {
    if (deck.status !== 'ready') { setEdits({ status: deck.status === 'unreadable' ? 'unreadable' : 'loading', items: [] }); return undefined; }
    if (deck.deckId == null) { setEdits({ status: 'ready', items: [] }); return undefined; }
    let live = true;
    readEdits(source, deck.deckId).then(
      (items) => { if (live) setEdits({ status: 'ready', items }); },
      (e) => { reportError('pitch-ask:proposals', e); if (live) setEdits({ status: 'unreadable', items: [] }); },
    );
    return () => { live = false; };
  }, [deck.status, deck.deckId, source, editsTick]);

  /** After a decision: the card edits again; the versions again only when the deck's proposal changed. */
  const reload = useCallback(({ deck: deckChanged = false } = {}) => {
    setEditsTick((t) => t + 1);
    if (deckChanged) { if (shared) onChanged?.(); else setTick((t) => t + 1); }
  }, [shared, onChanged]);

  if (readOnly || projectId == null) return null;
  const waiting = waitingCount({ deck, edits });
  const unreadable = deck.status === 'unreadable' || edits.status === 'unreadable';
  const state = unreadable ? 'unreadable' : !aiOn ? 'off' : 'rest';
  const sub = unreadable ? ASK_UNREADABLE : null;
  return (
    <>
      <AskButtonView buttonRef={opener} waiting={waiting} state={state} sub={sub} expanded={open} onClick={() => setOpen(true)} testId="pitch-ask" />
      {open ? (
        <WaitingSheet projectId={projectId} deck={deck} edits={edits} aiOn={aiOn} onPlace={onPlace} source={source}
          reload={reload} onClose={() => setOpen(false)} returnFocusTo={opener} />
      ) : null}
    </>
  );
}

/** "Waiting for you": the deck's open proposals, each with Accept and Discard. No input of any kind. */
export function WaitingSheet({ projectId, deck, edits, aiOn = true, onPlace = null, source = SOURCE, reload, onClose, returnFocusTo }) {
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState({});
  const q = ventureQuery(projectId);
  const proposal = deck.status === 'ready' ? deck.proposal : null;
  const items = edits.status === 'ready' ? edits.items : [];
  const nothing = deck.status === 'ready' && edits.status === 'ready' && !proposal && !items.length;

  const act = async (key, fn) => {
    if (busy) return;
    setBusy(key); setProblem((p) => ({ ...p, [key]: null }));
    try { await fn(); } catch (e) {
      reportError(`pitch-ask:${key}`, e);
      setProblem((p) => ({ ...p, [key]: refusalOf(e)?.message || 'That did not work. Nothing was changed.' }));
    } finally { setBusy(null); reload?.({ deck: key === 'deck' }); }
  };

  /** Place one card edit: check it still fits, record Accept, then place it (held until Save). */
  const acceptEdit = (edit) => act(edit.uid, async () => {
    const plan = onPlace?.(edit);
    if (!plan || plan.error) { setProblem((p) => ({ ...p, [edit.uid]: plan?.error || 'Open the editor to accept this.' })); return; }
    await source.proposals.decide(edit.uid, 'accept');
    plan.commit();
  });
  const acceptAll = () => act('all', async () => {
    for (const edit of items) {
      const plan = onPlace?.(edit);
      if (!plan || plan.error) { setProblem((p) => ({ ...p, [edit.uid]: plan?.error || 'Open the editor to accept this.' })); continue; }
      // One decision per proposal (D777 part 3): there is no bulk decision.
      await source.proposals.decide(edit.uid, 'accept');
      plan.commit();
    }
  });

  return (
    <Sheet title={WAITING_TITLE} eyebrow="Pitch deck · Ask" width={520} onClose={onClose} returnFocusTo={returnFocusTo} testId="pitch-ask-sheet">
      <div className="flex flex-col gap-4">
        {!aiOn ? (
          <div className={`${CARD} flex flex-col gap-1.5`} data-testid="pitch-ask-off">
            <span className={`text-[13px] font-bold ${INK}`}>{ASK_OFF}</span>
            <span className={EYE}>Still works</span>
            <ul className={`m-0 list-disc pl-5 ${MUTED}`}>{STILL_WORKS.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        ) : null}

        {nothing ? <p className={`m-0 ${MUTED}`} data-testid="pitch-ask-none">{WAITING_NONE}</p> : null}

        {deck.status === 'unreadable' ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="pitch-ask-unreadable">
            <p className={`m-0 ${MUTED}`}>What waits for this deck could not be read.</p>
            <button type="button" className={GHOST} onClick={() => reload?.({ deck: true })}>Try again</button>
          </div>
        ) : null}

        {proposal ? (
          <section className="flex flex-col gap-2" aria-label="Your deck" data-testid="pitch-ask-deck">
            <span className={EYE}>Your deck</span>
            <div className={`${CARD} flex flex-col gap-2`}>
              <span className={`text-[13.5px] font-bold ${INK}`}>A proposed deck · {Array.isArray(proposal.slides) && proposal.slides.length ? `${proposal.slides.length} cards` : 'not built yet'}</span>
              <span className={MUTED}>Nothing is a version until you accept it. Review shows every card, what it was filled from and what was left out.</span>
              <div className="flex flex-wrap gap-2">
                <Link className={BTN} to={`${NEW_PATH}${q}${q ? '&' : '?'}proposal=${encodeURIComponent(proposal.id)}`} data-testid="pitch-ask-review">Review</Link>
                {Array.isArray(proposal.slides) && proposal.slides.length ? (
                  <button type="button" className={GHOST} disabled={Boolean(busy)} onClick={() => act('deck', () => source.keepAll(proposal.id))} data-testid="pitch-ask-deck-accept">{ACCEPT_ALL}</button>
                ) : null}
                <button type="button" className={GHOST} disabled={Boolean(busy)} onClick={() => act('deck', () => source.discardDeck(proposal.id))} data-testid="pitch-ask-deck-discard">{DISCARD}</button>
              </div>
              {problem.deck ? <p className={BAD} role="alert">{problem.deck}</p> : null}
            </div>
          </section>
        ) : null}

        {edits.status === 'unreadable' && deck.status !== 'unreadable' ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="pitch-ask-edits-unreadable">
            <p className={`m-0 ${MUTED}`}>Card edits waiting could not be read.</p>
            <button type="button" className={GHOST} onClick={() => reload?.()}>Try again</button>
          </div>
        ) : null}

        {items.length ? (
          <section className="flex flex-col gap-2" aria-label="Card edits" data-testid="pitch-ask-edits">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={EYE}>Card edits</span>
              {onPlace && items.length > 1 ? (
                <button type="button" className={GHOST} disabled={Boolean(busy)} onClick={acceptAll} data-testid="pitch-ask-accept-all">{ACCEPT_ALL} ({items.length})</button>
              ) : null}
            </div>
            {onPlace ? <p className={`m-0 ${MUTED}`}>{CHARGED_LINE} An accepted edit is kept when you save the version.</p> : null}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {items.map((edit) => (
                <li key={edit.uid} className={`${CARD} flex flex-col gap-2`} data-testid="pitch-ask-edit">
                  <span className={`text-[13px] font-bold ${INK}`}>{cardEditLine(edit)}</span>
                  {edit.kind === 'text' ? (
                    <span className="flex flex-col gap-1 text-[12.5px]">
                      {edit.before ? <s className="text-axal-muted dark:text-gray-400">{edit.before}</s> : null}
                      <span className="rounded-[8px] bg-axal-lavender px-2 py-1 text-axal-ink dark:bg-violet-950/40 dark:text-gray-100">{edit.after}</span>
                    </span>
                  ) : <span className={MUTED}>{edit.title || 'A block from your records'}</span>}
                  <div className="flex flex-wrap items-center gap-2">
                    {onPlace
                      ? <button type="button" className={BTN} disabled={Boolean(busy)} onClick={() => acceptEdit(edit)} data-testid="pitch-ask-edit-accept">{ACCEPT}</button>
                      : <Link className={LINK} to={`${EDIT_PATH}${q}`} data-testid="pitch-ask-edit-open">Open in the editor ›</Link>}
                    <button type="button" className={GHOST} disabled={Boolean(busy)} onClick={() => act(edit.uid, () => source.proposals.decide(edit.uid, 'discard'))} data-testid="pitch-ask-edit-discard">{DISCARD}</button>
                  </div>
                  {problem[edit.uid] ? <p className={BAD} role="alert">{problem[edit.uid]}</p> : null}
                </li>
              ))}
            </ul>
            {problem.all ? <p className={BAD} role="alert">{problem.all}</p> : null}
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
