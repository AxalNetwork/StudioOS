import React from 'react';
import Sheet from '../../../ui/Sheet.jsx';
import { NO_TRANSITION, TRANSITIONS, TRANSITION_LINE, TRANSITION_TITLE, TRANSITION_WORDS, transitionOf } from './motionModel';

/**
 * D1576 (#3823, pd13) — ⋯ › This card › Transition: None, Fade, Push or Wipe,
 * how the card comes up in Present and in the PowerPoint. The choice is the
 * editor's, held until a version is saved, like the card's other edits.
 */
const SEG = 'min-h-[36px] px-3 text-[12.5px] font-bold';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';

export default function TransitionSheet({ card, index, readOnly, onTransition, onClose }) {
  const now = transitionOf(card?.transition);
  return (
    <Sheet label={TRANSITION_TITLE} title={TRANSITION_TITLE} eyebrow={`Card ${index + 1}`} width={480} onClose={onClose} testId="pitch-sheet-transition">
      <div className="flex flex-col gap-3">
        <span className="flex w-fit overflow-hidden rounded-[9px] border border-axal-hairline dark:border-gray-700" role="radiogroup" aria-label={TRANSITION_TITLE}>
          {[null, ...TRANSITIONS].map((t) => {
            const on = now === t;
            return (
              <button key={t || 'none'} type="button" role="radio" aria-checked={on} disabled={readOnly}
                className={`${SEG} ${on ? 'bg-axal-lavender text-axal-violet dark:bg-violet-950/40 dark:text-violet-300' : 'bg-white text-axal-ink dark:bg-gray-900 dark:text-gray-100'}`}
                onClick={() => onTransition(t)} data-testid={`pitch-transition-${t || 'none'}`}>
                {t ? TRANSITION_WORDS[t] : NO_TRANSITION}
              </button>
            );
          })}
        </span>
        <span className={MUTED}>{TRANSITION_LINE}</span>
      </div>
    </Sheet>
  );
}
