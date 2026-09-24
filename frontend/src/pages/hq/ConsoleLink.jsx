/**
 * The link an HQ read-only panel ends in, and the tile the Operator consoles
 * zone draws. One definition with two readers: Platform (D213) and Content
 * (D214) both summarise a console's store and send the operator to the
 * console to change anything, and two copies of this tile would drift the way
 * two copies of every other shared piece in this programme have.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: take the path. Each caller writes its
 * own `<Link to="…" className={CONSOLE_LINK}>` with a literal `to`, because
 * the reachability walk (`admin_route_reachability.test.mjs`) counts literal
 * `to="…"` attributes and a path passed through a prop would be invisible to
 * it. So this module holds the look and the two lines of text, and the page
 * holds the link.
 *
 * It is a link and never a button: neither page holds a handler.
 */
import React from 'react';

export function ConsoleLinkBody({ title, note }) {
  return (
    <>
      <div className="text-[12.5px] font-bold text-axal-ink dark:text-white">{title} →</div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-axal-faint">{note}</div>
    </>
  );
}

export const CONSOLE_TILE = 'block rounded-xl border border-axal-hairline bg-axal-ground px-3 py-2 hover:border-axal-violet dark:hover:border-violet-700';
export const CONSOLE_LINK = `mt-3 ${CONSOLE_TILE}`;
