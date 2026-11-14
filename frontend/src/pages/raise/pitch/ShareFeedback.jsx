import React, { useCallback, useEffect, useState } from 'react';
import { deckShareFeedbackApi } from '../../../lib/api/deckShareFeedback';
import { reportError } from '../../../lib/log';
import {
  DISCOVERY_NOTE, FEEDBACK_EMPTY, FEEDBACK_REFUSED, FEEDBACK_UNREADABLE, REACTION_ORDER,
  answersOf, byLink, capLine, cardTally, failedStatus, feedbackState, reactionLabel, viewerLabel,
} from './shareFeedbackModel';

/**
 * D6064 (#6064) — Share & analytics, viewer feedback: what readers sent back
 * from their links. Reactions per card across every link, then each link's
 * feedback: the reactions, the written note and the structured answers, each
 * from a "Signed-in viewer" or "Anonymous" and never a name. The board's
 * version filter applies. States: loading, Unreadable with Try again, refused
 * (not the owner or a co-founder), empty, and the cap line when there is more.
 */

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PILL = 'rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] font-semibold text-axal-ink dark:border-gray-700 dark:text-gray-100';
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';

export default function ShareFeedback({ deckId, version = '' }) {
  const [read, setRead] = useState({ status: 'idle', data: null });

  const load = useCallback(() => {
    if (deckId == null) return () => {};
    let alive = true;
    setRead({ status: 'loading', data: null });
    deckShareFeedbackApi.read(deckId, { version }).then(
      (data) => { if (alive) setRead({ status: 'ok', data }); },
      (e) => { if (alive) setRead({ status: failedStatus(e), data: null }); if (failedStatus(e) === 'error') reportError('share-board:feedback', e); },
    );
    return () => { alive = false; };
  }, [deckId, version]);
  useEffect(() => load(), [load]);

  const state = feedbackState(read);
  const items = read.data?.items || [];
  const cap = capLine(read.data);

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`} data-testid="share-feedback">
      <div className="flex flex-col gap-1">
        <span className={`text-[14px] font-extrabold ${INK}`}>Viewer feedback</span>
        <p className={`m-0 ${MUTED}`} data-testid="share-feedback-discovery">{DISCOVERY_NOTE}</p>
      </div>
      {state === 'loading' ? (
        <div className={`${SKEL} h-24`} data-testid="share-feedback-loading" />
      ) : state === 'unreadable' ? (
        <div className="flex flex-wrap items-center justify-between gap-3" data-testid="share-feedback-unreadable">
          <span className={MUTED}>{FEEDBACK_UNREADABLE}</span>
          <button type="button" className={BTN} onClick={load}>Try again</button>
        </div>
      ) : state === 'refused' ? (
        <p className={`m-0 ${MUTED}`} data-testid="share-feedback-refused">{FEEDBACK_REFUSED}</p>
      ) : state === 'empty' ? (
        <p className={`m-0 ${MUTED}`} data-testid="share-feedback-empty">{FEEDBACK_EMPTY}</p>
      ) : (
        <>
          <CardReactions items={items} />
          {byLink(items).map((g) => (
            <div key={g.key} className="flex flex-col gap-2 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid={`share-feedback-${g.key.replace(':', '-')}`}>
              <span className={`text-[13px] font-bold ${INK}`}>{g.label}{g.fund ? ` · ${g.fund}` : ''}</span>
              {g.items.map((it) => (
                <div key={it.id} className="flex flex-col gap-1.5" data-testid={`share-feedback-item-${it.id}`}>
                  <span className={MUTED}>
                    {viewerLabel(it.viewer)}{it.version != null ? ` · v${it.version}` : ''}{it.created_at ? ` · ${String(it.created_at).slice(0, 10)}` : ''}
                  </span>
                  {it.reactions?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {it.reactions.map((r) => (
                        <span key={`${r.card_uid ?? r.place}`} className={PILL}>{`${r.title || (r.place != null ? `Card ${r.place + 1}` : 'A card')}: ${reactionLabel(r.reaction)}`}</span>
                      ))}
                    </div>
                  ) : null}
                  {it.note ? <p className={`m-0 whitespace-pre-wrap text-[13px] leading-[1.5] ${INK}`}>{it.note}</p> : null}
                  {answersOf(it).map(([k, v]) => <span key={k} className={MUTED}>{`${k}: ${v}`}</span>)}
                </div>
              ))}
            </div>
          ))}
          {cap ? <p className={`m-0 ${MUTED}`} data-testid="share-feedback-cap">{cap}</p> : null}
        </>
      )}
    </section>
  );
}

export function CardReactions({ items }) {
  const cards = cardTally(items);
  if (!cards.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="share-feedback-cards">
      <span className={`text-[13px] font-bold ${INK}`}>Reactions per card</span>
      {cards.map((c) => (
        <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[12.5px]" data-testid={`share-feedback-card-${c.key}`}>
          <span className={`truncate ${INK}`}>{c.title}</span>
          <span className="font-mono text-axal-muted dark:text-gray-400">
            {[...REACTION_ORDER, ...Object.keys(c.counts).filter((k) => !REACTION_ORDER.includes(k))]
              .filter((k) => c.counts[k]).map((k) => `${reactionLabel(k)} ${c.counts[k]}`).join(' · ')}
          </span>
        </div>
      ))}
    </div>
  );
}
