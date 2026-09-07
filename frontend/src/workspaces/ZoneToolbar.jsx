import React from 'react';
import ZoneActions from './ZoneActions';
import { accentChipClass } from './shellConfig';

/**
 * The zone header's toolbar — the canvas's one rule-bordered row, filters on
 * the left and actions on the right.
 *
 * WHY IT IS ONE COMPONENT AND NOT TWO SIBLINGS. Every `Pages · …` artboard
 * draws them inside a single flex row that owns the hairline beneath it:
 *
 *     <div style="display:flex;align-items:center;gap:14px;margin-top:14px;
 *                 padding-bottom:13px;border-bottom:1px solid #ececf1;flex-wrap:wrap">
 *       <div …>            filters      </div>
 *       <div …margin-left:auto>  ops    </div>
 *     </div>
 *
 * Eighteen pages hand-writing that wrapper is eighteen chances for the rule to
 * drift. `ZoneActions` keeps its own signature untouched — forty pages across
 * the other three licences mount it directly and none of them should have to
 * change for this.
 *
 * THE CHIP TREATMENT IS THE CANVAS'S `.fil`, NOT A GUESS:
 *
 *     .fil{font-size:11px;font-weight:600;color:#3f3a49;background:#fff;
 *          border:1px solid #e2e1e8;border-radius:7px;padding:5px 10px}
 *     .fil.on{background:#faf7ff;border-color:#d8c9ff;color:#6d28d9;font-weight:700}
 *
 * `.fil.on` is violet in the Founder canvases because violet is the founder
 * accent; the selected chip therefore comes from `accentChipClass(role)` and
 * the unselected one is grey in all four, so it lives here.
 *
 * NO UNDECLARED TOKENS. `axal-ink-2`, `axal-ink-3`, `axal-surface-2` and
 * `axal-border-soft` are used ~400 times across `pages/` and `workspaces/` and
 * are declared in no `@theme` block, so they emit no CSS at all. This file uses
 * Tailwind's own greys, as `ZoneActions.jsx` does for the same reason.
 *
 * A FILTER THAT CANNOT RUN IS NOT DRAWN AT ALL. `zoneFilterBuilder.js` argues
 * why this matters more for a filter than for a button: a dead filter does not
 * fail loudly, it returns an empty set, and an empty set reads as an answer. So
 * an `unbuilt` filter never reaches this component — the builder drops it, and
 * the reason stays in the filter table where it can be acted on.
 *
 * IT USED TO RENDER THOSE REASONS HERE, GROUPED INTO SENTENCES, and that was
 * the bug: `/build/cadence`'s four-chip row shipped as a paragraph about the
 * cadence store, and the design's tidy filter strip became an essay on every
 * zone that had a gap. Not drawing the dead chip was right. Explaining its
 * absence to the customer, in the row where the working chips live, was not.
 */

const CHIP =
  'inline-flex items-center whitespace-nowrap rounded-[7px] border px-2.5 py-[5px] ' +
  'text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2';
const CHIP_OFF =
  'border-gray-200 bg-white text-gray-700 hover:border-gray-300 ' +
  'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600';

/**
 * @param {Array<{label:string,testid?:string,active?:boolean,onSelect?:()=>void}>} filters
 * @param {Array} actions  passed straight to `ZoneActions`
 * @param {string} role    which licence's accent the selected chip wears
 */
export default function ZoneToolbar({ filters = [], actions = [], role = 'founder', className = '' }) {
  const live = filters.filter(Boolean);
  if (!live.length && !actions.filter(Boolean).length) return null;
  const on = accentChipClass(role);
  return (
    <div
      data-testid="zone-toolbar"
      className={`mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-gray-200 pb-3 dark:border-gray-800 ${className}`}
    >
      {live.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {live.map((item) => (
            <button
              key={item.label}
              type="button"
              data-testid={item.testid}
              aria-pressed={Boolean(item.active)}
              onClick={item.onSelect}
              className={`${CHIP} ${item.active ? `${on} font-bold` : CHIP_OFF}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <ZoneActions items={actions} className="ml-auto" />
    </div>
  );
}
