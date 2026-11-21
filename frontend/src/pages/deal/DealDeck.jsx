/**
 * D6165 (#6165) — the deck the venture granted this investor on this deal
 * (D1587's `GET /api/deals/:id/deck`), as a card on the investor's deal page
 * and a plain read-only viewer. The owner chose a plain render now
 * (2026-11-16); a designed investor deck view may replace the viewer later.
 *
 * `DealDeckCard` reads once and draws canvas DL1 `deckK`: the deck's title,
 * its version and "frozen as of", and Open the deck. A deck not granted shows
 * the Worker's sentence and opens nothing; a failed read says so with Try
 * again and leaves the rest of the page standing. Only an investor's page
 * mounts it: the read is the investor's own (a founder or staff member is
 * refused by the Worker and never asks).
 *
 * `DealDeck` (default) is the viewer, in the shared Lightbox: the share
 * link's card view (`DeckCardView`, D1564), fed the slides exactly as the
 * Worker returned them. The Worker already cut what the founder did not tick
 * and every provenance key (pd24), so nothing here adds or restores either.
 * No write of any kind.
 */
import React, { useEffect, useRef, useState } from 'react';
import { DataState, Lightbox } from '../../ui';
import { deckGrantsApi } from '../../lib/api/deckGrants.js';
import { reportError } from '../../lib/log';
import DeckCardView from '../raise/pitch/DeckCardView';
import { CARD, EYE, SUB, H3, BTN_S } from './DealFrame';
import { DECK_CARD, deckCardOf } from './dealDeckModel';

export default function DealDeck({ card, onClose, returnFocusTo }) {
  return (
    <Lightbox label={`Deck: ${card.title}`} eyebrow={DECK_CARD.eye} title={card.title} sub={card.line}
      width={760} size="tall" onClose={onClose} returnFocusTo={returnFocusTo} testId="deal-deck-viewer">
      <DeckCardView deck={card.deck} testId="deal-deck-cards" />
    </Lightbox>
  );
}

export function DealDeckCard({ dealId, testId = 'deal-deck' }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const alive = useRef(true);
  const load = () => {
    setRead({ status: 'loading' });
    deckGrantsApi.deck(dealId)
      .then((data) => { if (alive.current) setRead({ status: 'ready', data }); })
      .catch((e) => { reportError('DealDeck:read', e); if (alive.current) setRead({ status: 'unreadable' }); });
  };
  useEffect(() => {
    alive.current = true;
    setOpen(false);
    load();
    return () => { alive.current = false; };
  }, [dealId]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = deckCardOf(read);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2 px-4 py-4`} data-testid={testId} data-state={c.state}>
      <span className={EYE}>{DECK_CARD.eye}</span>
      <h3 className={H3}>{DECK_CARD.title}</h3>
      {c.state === 'loading' && <p className={`m-0 ${SUB}`}>{DECK_CARD.reading}</p>}
      {c.state === 'unreadable' && (
        <DataState state="unavailable" as="p" what={DECK_CARD.what} claim={DECK_CARD.claim} onRetry={load} retryLabel="Try again" announce="always" data-testid={`${testId}-unreadable`} />
      )}
      {c.state === 'not_granted' && <p className={`m-0 ${SUB}`} data-testid={`${testId}-not-granted`}>{c.line}</p>}
      {c.state === 'ready' && (
        <>
          <p className={`m-0 break-words text-[14px] font-bold ${c.titleMissing ? 'text-axal-muted dark:text-gray-400' : 'text-axal-ink dark:text-gray-100'}`} data-testid={`${testId}-title`}>{c.title}</p>
          <p className={`m-0 break-words ${SUB}`} data-testid={`${testId}-line`}>{c.line}</p>
          <button ref={opener} type="button" className={`${BTN_S} w-fit`} onClick={() => setOpen(true)} data-testid={`${testId}-open`}>{DECK_CARD.open}</button>
        </>
      )}
      {open && c.state === 'ready' && <DealDeck card={c} onClose={() => setOpen(false)} returnFocusTo={opener} />}
    </section>
  );
}
