import React from 'react';
import { Link } from 'react-router-dom';

/**
 * The zone header's action row — what a reader can DO on this page.
 *
 * WHY IT EXISTS. `WorkspaceShell` has had an `actions` slot since it was
 * written (`WorkspaceShell.jsx:50`, rendered at `:160`), and until now every
 * caller passing it was a Spin-Out Lab page. Not one workspace zone page used
 * it, so `/validate/interviews` — a page whose whole job is logging interviews
 * — offered no way to log one. The affordance existed in the design and in the
 * shell; only the wiring was missing.
 *
 * THE TREATMENT COMES FROM THE CANVASES AND IS NOT WHAT YOU WOULD GUESS. All
 * twelve `Pages · …` canvases render every zone-header action with the same
 * class:
 *
 *     .gho{font-size:11px;font-weight:700;padding:6px 11px;border-radius:7px;
 *          border:1px solid #e2e1e8;background:#fff;color:#3f3a49}
 *
 * `Add document` looks exactly like `Export`. The filled accent (`.acc`)
 * appears once per artboard and always on the button that commits an AI
 * proposal — `Accept brief`, `Open the rewrite`. So the hierarchy the design
 * encodes is *accept / amend / refuse the machine's draft*, not create versus
 * export, and promoting "New hypothesis" to a filled button would invent a
 * distinction the canvases deliberately do not draw. Hence one variant here.
 *
 * NO UNDECLARED TOKENS. `axal-ink-2`, `axal-ink-3`, `axal-surface-2` and
 * `axal-border-soft` are used ~400 times across `pages/` and `workspaces/` and
 * are declared nowhere — they emit no CSS. The declared set is in
 * `src/index.css`'s `@theme` block. This component uses Tailwind's own greys
 * instead, which `scripts/check-dark-mode.mjs` also knows how to require a
 * dark counterpart for.
 *
 * AN ACTION THAT CANNOT RUN IS NOT DRAWN AT ALL. This repo has shipped the
 * other thing — Trust Center's KYB form posted to a route the worker never
 * declared, and the only reason CI stayed green was
 * `scripts/api-drift-baseline.json`. A button is a promise that something will
 * happen, so an op nothing performs never reaches this component:
 * `zoneActionBuilder` returns null for it and the caller drops it.
 *
 * IT USED TO RENDER THE REASON INSTEAD, AND THAT WAS THE BUG. A `note` field
 * drew the item as `{label} — {note}`, so the design's `Comparables` shipped as
 * a two-line sentence about how comparables are filed, and a five-op zone
 * header became five paragraphs of design-review commentary aimed at a reader
 * who cannot act on any of it. The refusal was right; printing it inside the
 * control's own label was not. The reason now lives in the action table, which
 * is where the person who can build the op reads it.
 *
 * `disabled` IS THE ONE THING THAT STILL RENDERS WITHOUT RUNNING, and it is a
 * different claim: `Export` over rows that have not loaded YET is a real
 * control in a transient state, not an unbuilt one. It keeps the canvas's label
 * and comes alive when the page has rows.
 */

const GHOST =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border ' +
  'border-gray-200 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-700 ' +
  'transition-colors hover:border-gray-300 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600';

/**
 * @param {Array<{
 *   label: string,
 *   onClick?: () => void,
 *   to?: string,
 *   busy?: boolean,
 *   disabled?: boolean,   // a real control the page cannot run yet, e.g. an
 *                         // export before its rows have loaded
 *   title?: string,
 *   testid?: string,
 * }>} items
 */
export default function ZoneActions({ items = [], className = '' }) {
  const live = items.filter(Boolean);
  if (!live.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {live.map((item) => {
        const key = item.label;
        if (item.to) {
          return (
            <Link key={key} to={item.to} data-testid={item.testid} title={item.title} className={GHOST}>
              {item.label}
            </Link>
          );
        }
        return (
          <button
            key={key}
            type="button"
            data-testid={item.testid}
            onClick={item.onClick}
            disabled={item.disabled || item.busy}
            title={item.title}
            className={GHOST}
          >
            {item.busy ? `${item.label}…` : item.label}
          </button>
        );
      })}
    </div>
  );
}
