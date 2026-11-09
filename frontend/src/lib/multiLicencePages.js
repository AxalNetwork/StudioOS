/**
 * D4474 (#4474, part 3 of #3704) — WHICH BLOCKS A SHARED PAGE DRAWS.
 *
 * Studio and Spin-Out Lab are the two sections every licence shares, so the
 * sidebar (D4473) lists each once. A member who holds more than one licence
 * reads each held licence's part of that page as its own block, in licence
 * order Founder, Investor, Advisor, Operating Partner. There is no licence
 * switcher and no "active" licence (the owner's rules 1 and 6 on #3704).
 *
 * Pure: no React, no storage. `App.jsx` asks `multiLicenceSet` whether the
 * route serves the block page at all; the two pages ask `studioBlocks` and
 * `spinoutBlocks` what to draw.
 */
import { orderedLicences } from './licenceSidebar.js';

/** The block title for each licence, as the Account menu names it. */
export const LICENCE_TITLE = Object.freeze({
  founder: 'Founder',
  investor: 'Investor',
  advisor: 'Advisor',
  partner: 'Operating Partner',
});

/** The licences whose Spin-Out Lab is the founder Lab page (`SpinoutLabPage`). */
export const LAB_LICENCES = Object.freeze(['founder', 'advisor', 'partner']);

/**
 * The held licences, in licence order, when the session is a member reading
 * their OWN account with two or more licences; otherwise `null`, and the
 * route keeps today's single-role page.
 *
 * Admin (with or without a "View as" preview), impersonation and an
 * exploring account are never the block page: each of them is one role by
 * construction, and their pages are pinned elsewhere.
 */
export function multiLicenceSet({ user, realUser, isImpersonating, effectiveRole, heldLicences } = {}) {
  if (!user || isImpersonating) return null;
  if ((realUser || user)?.role === 'admin') return null;
  if (effectiveRole === 'exploring' || effectiveRole === 'admin') return null;
  const held = orderedLicences(heldLicences, effectiveRole);
  return held.length > 1 ? held : null;
}

/** Studio: one block per held licence, in licence order. */
export function studioBlocks(licences) {
  return orderedLicences(licences).map((licence) => ({ key: licence, licences: [licence], title: LICENCE_TITLE[licence] }));
}

/**
 * Spin-Out Lab: at most two blocks. The Lab block (`SpinoutLabPage`) is drawn
 * once for every held Founder, Advisor or Operating Partner licence, titled
 * with the licences it serves, at the place of the first of them; the
 * Investor block (`SpinoutLabInvestorPage`) is drawn where Investor sits.
 */
export function spinoutBlocks(licences) {
  const held = orderedLicences(licences);
  const lab = held.filter((l) => LAB_LICENCES.includes(l));
  const blocks = [];
  for (const licence of held) {
    if (licence === 'investor') blocks.push({ key: 'investor', licences: ['investor'], title: LICENCE_TITLE.investor });
    else if (licence === lab[0]) blocks.push({ key: 'lab', licences: lab, title: lab.map((l) => LICENCE_TITLE[l]).join(' · ') });
  }
  return blocks;
}
