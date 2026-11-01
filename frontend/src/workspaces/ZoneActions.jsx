import React, { createContext, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { primaryOf } from './zoneActionBuilder';

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
 * ONE FILLED PRIMARY PER ZONE, FROM A LIVE ACTION ONLY (D1424, #3700, owner
 * answer B). This file used to draw one ghost variant on purpose: the twelve
 * `Pages · …` canvases drew every header action as `.gho`, and the filled
 * accent appeared only on the button that accepts an AI proposal. The profiles
 * canvas (`design/incoming/Zone Headers Page.dc.html`, PH0) reverses that for
 * the Investor, Advisor and Operating Partner zones, the way the founder's
 * `CycleHeader` already leads with one filled action: a zone whose table marks
 * a row `primary: true` draws that row filled, in the licence's own accent
 * (owner answer A: indigo, emerald, amber-brown; violet stays the founder's).
 *
 * What makes it a primary is decided upstream and is narrow on purpose:
 * `zoneActionBuilder` keeps the flag only on a link or a page-supplied
 * handler, so an unbuilt op or an export can never be filled, and a zone with
 * no live first step (Screening, every Delivery zone) shows no primary at all.
 * Only the first live primary is filled; a second would be drawn as a ghost.
 * Everything else on the row stays the ghost below.
 *
 * WHERE IT IS DRAWN. Inside a `ZonePrimaryScope` (`WorkspaceShell`, and the
 * bespoke investor pages through `ZoneHeader`) the primary is portalled into
 * the header's slot beside Ask, so the body that owns the handler keeps
 * owning it. With no scope, or before the slot has mounted, it is drawn first
 * on this row.
 *
 * TAILWIND GREYS, AND THE REASON HAS CHANGED. `axal-ink-2`, `axal-ink-3`,
 * `axal-surface-2` and `axal-border-soft` were used ~400 times while declared in no `@theme` block, so they emitted no
 * CSS at all. All 575 such utilities have since been consolidated onto the
 * declared neutrals — `axal-muted`, `-faint`, `-ground`, `-hairline` — and those
 * spellings no longer appear in the tree. The greys here stay: the `index.css`
 * auto-skin now pairs both vocabularies, so neither is the safer one and
 * rewriting these would be churn. `scripts/check-dark-mode.mjs`
 * knows how to require a dark counterpart for the greys, which is why they were
 * the safe choice at the time.
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
 * `disabled` NOW CARRIES TWO CLAIMS, AND THEY ARE SAID DIFFERENTLY ON PURPOSE.
 *
 *   an EXPORT with no rows — built, wired and correct, waiting on data, and it
 *     comes alive while the reader watches. The state is in the LABEL
 *     (`Export · nothing yet`) because the eight reports that produced that
 *     suffix were about a grey button whose only explanation was a `title`
 *     nobody hovered.
 *   an UNBUILT op — nothing performs it and nothing will until a store exists.
 *     The label stays the artboard's and the reason is on HOVER.
 *
 * The paragraph above records why unbuilt ops once rendered nothing at all.
 * That fixed the essays and produced the opposite report: 170 canvas controls
 * invisible across four profiles, every one read as a missing feature. Drawing
 * them disabled with an opt-in tooltip is the third position, taken as the
 * user's decision of 2026-09-13 after the trade-off was put to them. Nothing is
 * printed beside the control; the row is the artboard's row.
 */

const GHOST =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border ' +
  'border-gray-200 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-700 ' +
  'transition-colors hover:border-gray-300 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600';

/**
 * The filled primary, per licence (D1424, owner A). Light: the accent's ink,
 * its deep weight on hover, white text. Dark: the accent's 400 weight with the
 * canvas's dark ink on it (`ONA` #0b1220) and the 300 weight on hover, as the
 * shell's `deepDark` pairs do. Tailwind's own weights are the exact hexes in
 * `shellConfig.js`'s `ACCENT` (indigo-600/700/400, emerald-700/800/400,
 * amber-700/800/400). An unknown licence falls back to the founder's violet.
 */
const PRIMARY_BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3.5 py-2 ' +
  'text-[12.5px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 max-sm:min-h-[44px]';
export const PRIMARY_ACCENT = Object.freeze({
  investor: 'border-indigo-600 bg-indigo-600 text-white hover:border-indigo-700 hover:bg-indigo-700 focus-visible:outline-indigo-600 dark:border-indigo-400 dark:bg-indigo-400 dark:text-[#0b1220] dark:hover:border-indigo-300 dark:hover:bg-indigo-300',
  advisor: 'border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800 focus-visible:outline-emerald-700 dark:border-emerald-400 dark:bg-emerald-400 dark:text-[#0b1220] dark:hover:border-emerald-300 dark:hover:bg-emerald-300',
  partner: 'border-amber-700 bg-amber-700 text-white hover:border-amber-800 hover:bg-amber-800 focus-visible:outline-amber-700 dark:border-amber-400 dark:bg-amber-400 dark:text-[#0b1220] dark:hover:border-amber-300 dark:hover:bg-amber-300',
  founder: 'border-axal-violet bg-axal-violet text-white hover:bg-axal-violet-deep focus-visible:outline-axal-violet',
});
export const primaryClass = (accent) => `${PRIMARY_BASE} ${PRIMARY_ACCENT[accent] || PRIMARY_ACCENT.founder}`;

const SlotContext = createContext(null);

/** The header and the body under it share one primary slot. */
export function ZonePrimaryScope({ children }) {
  const [slot, setSlot] = useState(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/** Where the header draws its primary. Nothing outside a scope. */
export function ZonePrimaryTarget() {
  const ctx = useContext(SlotContext);
  if (!ctx) return null;
  return <span ref={ctx.setSlot} className="inline-flex items-center empty:hidden" data-testid="zone-primary-slot" />;
}

/**
 * One filled primary: a link, or a button that is busy ("Label…",
 * `aria-busy`) or disabled with its reason on hover. It never draws an item
 * that cannot run: no `to` and no `onClick` is nothing.
 */
export function ZonePrimary({ item }) {
  const ctx = useContext(SlotContext);
  if (!item || (!item.to && typeof item.onClick !== 'function')) return null;
  const cls = primaryClass(item.accent);
  const testid = item.testid || 'zone-primary';
  const node = item.to ? (
    <Link to={item.to} data-testid={testid} data-primary="true" title={item.title} className={cls}>{item.label}</Link>
  ) : (
    <button type="button" data-testid={testid} data-primary="true" onClick={item.onClick}
      disabled={item.disabled || item.busy} aria-busy={item.busy ? 'true' : undefined} title={item.title} className={cls}>
      {item.busy ? `${item.label}…` : item.label}
    </button>
  );
  return ctx?.slot ? createPortal(node, ctx.slot) : node;
}

/**
 * @param {Array<{
 *   label: string,
 *   onClick?: () => void,
 *   to?: string,
 *   busy?: boolean,
 *   disabled?: boolean,   // an export before its rows have loaded, or an op
 *                         // with no store behind it; `title` says which
 *   title?: string,
 *   testid?: string,
 * }>} items
 */
export default function ZoneActions({ items = [], className = '' }) {
  const all = items.filter(Boolean);
  if (!all.length) return null;
  const primary = primaryOf(all);
  const live = all.filter((item) => item !== primary);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {primary ? <ZonePrimary item={primary} /> : null}
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
