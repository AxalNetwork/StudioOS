import React from 'react';
import { BlockView } from './BlockGrid';
import { CONFIDENTIAL, chromeOf } from './complianceModel';
import { NO_CARDS, cardViewCards } from './cardViewModel';

/**
 * D1564 (#3811; owner decision A = B) — the read-only responsive card view of
 * a shared deck: the version's cards one under another, each block in reading
 * order, drawn through D1112's `BlockView` live with sources off, so no
 * source or grade badge is drawn and video, audio and link blocks are real
 * links. What is cut and why is `cardViewModel.js`: no "Not recorded", and a
 * card left with nothing stays out.
 *
 * Built for a 390 px phone first: one column, a 16 px gutter, nothing wider
 * than the screen (pictures and charts scale in a 16:9 box, a table scrolls
 * inside its card). The share reader offers it beside the 16:9 slides, and
 * `/embed/:token` draws only it.
 *
 * Each card keeps its compliance chrome (owner decision T: the footnote stays
 * on): its footnotes under it and Confidential in its corner, and the link's
 * recipient watermark when it has one.
 */

const COLOURS = { bg: '#ffffff', ink: '#0f2a3d', accent: '#6d28d9', muted: '#64748b' };
const BOXED = new Set(['image', 'video', 'chart']);

function CardBlock({ block }) {
  const face = <BlockView block={block} colours={COLOURS} live sources={false} size="card" />;
  if (BOXED.has(block.kind)) {
    return <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-[10px]" data-testid={`card-view-block-${block.id}`}>{face}</div>;
  }
  if (block.kind === 'table') {
    return <div className="w-full max-w-full overflow-x-auto" data-testid={`card-view-block-${block.id}`}>{face}</div>;
  }
  return <div className="w-full min-w-0 max-w-full break-words" data-testid={`card-view-block-${block.id}`}>{face}</div>;
}

export default function DeckCardView({ deck, watermark = null, testId = 'deck-card-view' }) {
  const cards = cardViewCards(deck);
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-4" data-testid={testId}>
      {!cards.length ? <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400" data-testid={`${testId}-empty`}>{NO_CARDS}</p> : null}
      {cards.map((card, n) => {
        const chrome = chromeOf(deck, card.index);
        return (
          <article key={card.index} aria-label={`Card ${n + 1} of ${cards.length}`}
            className="flex w-full min-w-0 flex-col gap-3 rounded-[14px] border border-gray-200 bg-white p-4 text-[#0f2a3d] shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            data-testid={`${testId}-card-${card.index}`}>
            {chrome.confidential ? (
              <span className="self-end font-mono text-[10px] font-bold uppercase tracking-[.08em] text-gray-500 dark:text-slate-400" data-testid={`${testId}-confidential-${card.index}`}>{CONFIDENTIAL}</span>
            ) : null}
            {card.blocks.map((b) => <CardBlock key={b.id} block={b} />)}
            {chrome.lines.length ? (
              <div className="flex flex-col gap-0.5 border-t border-gray-100 pt-2 dark:border-slate-800" aria-label="Compliance">
                {chrome.lines.map((l) => <span key={l} className="text-[11px] italic text-gray-500 dark:text-slate-400" data-testid={`${testId}-footnote-${card.index}`}>{l}</span>)}
              </div>
            ) : null}
            {watermark ? <span className="text-[10.5px] text-gray-400 dark:text-slate-500" data-testid={`${testId}-watermark-${card.index}`}>{watermark}</span> : null}
          </article>
        );
      })}
    </div>
  );
}
