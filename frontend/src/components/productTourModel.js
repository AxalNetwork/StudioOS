/**
 * D4623 (#4623) — the product tour's pure rules: which steps a licence is
 * offered, which of them have an anchor drawn now, where the coachmark sits,
 * and what a key does. No React and no document here (the anchor lookup is
 * passed in), so each rule is tested without a browser.
 *
 * A step names a `data-tour` anchor. One whose anchor is missing, hidden, or
 * off the screen sideways (the sidebar drawer on a phone) is skipped, unless
 * it is a page-level step (`page: true`), which then explains its concept from
 * the middle of the screen instead. The onboarding checklist panel is gone
 * (Dashboard.jsx), so no step names it. Licences live in the Account menu:
 * there is no licence switcher and no active-licence toggle to point at.
 */
import { PURPOSE } from '../pages/studio/studioLayoutModel.js';

/** The Studio homes that draw `StudioModules` (all four member licences). */
export const STUDIO_ROLES = ['founder', 'investor', 'advisor', 'partner'];

const STUDIO_PURPOSE = {
  founder: 'Your venture’s modules, arranged the way you work.',
  ...PURPOSE,
};

/**
 * The steps, in order. `where` is `any`, `desktop` or `phone`; `roles` limits a
 * step to those licences. `body` may be a function of the role; a page-level
 * step's `pageBody` is what it says when its anchor is not drawn.
 */
export const STEPS = [
  {
    id: 'studio',
    anchor: 'studio-modules',
    roles: STUDIO_ROLES,
    title: 'Your Studio',
    body: (role) => `${STUDIO_PURPOSE[role] || STUDIO_PURPOSE.founder} Each module shows what is recorded, and says Not recorded where nothing is.`,
  },
  {
    id: 'module',
    anchor: 'studio-tile',
    roles: STUDIO_ROLES,
    title: 'A module',
    body: () => 'Each module summarises one part of your work. The link at its foot opens the full page.',
  },
  {
    id: 'customise',
    anchor: 'studio-customise',
    roles: STUDIO_ROLES,
    title: 'Arrange your Studio',
    body: () => 'Customise adds, removes, resizes and reorders modules. Nothing is saved until you press Done.',
  },
  {
    id: 'navigate',
    anchor: 'sidebar-nav',
    where: 'desktop',
    title: 'Your pages',
    body: () => 'The sidebar holds the pages of the licence in view. Press Cmd+K (Ctrl+K on Windows) to jump to any page.',
  },
  {
    id: 'settings',
    anchor: 'settings',
    where: 'desktop',
    title: 'Settings',
    body: () => 'Settings, at the foot of the sidebar, opens the settings of the company or project in view.',
  },
  {
    id: 'account',
    anchor: 'account-menu',
    page: true,
    title: 'Your account',
    body: (role) => (role === 'admin'
      ? 'Your initials open the Account menu, with your account settings.'
      : 'Your initials open the Account menu: your licences, billing and account settings. You can run this tour again from Onboarding in your account settings.'),
    pageBody: (role) => (role === 'admin'
      ? 'Your account settings live in the Account menu, under your name at the top right.'
      : 'Your licences, billing and account settings live in the Account menu, under your name at the top right. You can run this tour again from Onboarding in your account settings.'),
  },
];

/** The steps a licence is offered on this viewport, before any anchor is looked up. */
export function tourSteps(role, { phone = false } = {}) {
  return STEPS.filter((s) => (!s.roles || s.roles.includes(role))
    && (!s.where || s.where === 'any' || s.where === (phone ? 'phone' : 'desktop')));
}

/**
 * Whether an anchor is drawn where a person can see it: it has a box, and the
 * box is not off the screen sideways. One below the fold counts, because the
 * tour scrolls it into view.
 */
export function anchorShown(el, viewportWidth) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  const r = el.getBoundingClientRect();
  if (!r || !(r.width > 0 || r.height > 0)) return false;
  return r.left + r.width > 0 && r.left < viewportWidth;
}

/**
 * The steps to show now, each with its element (`el`, or null for a page-level
 * step whose anchor is not drawn). `find(anchor)` returns the element or null.
 */
export function resolveSteps(role, { phone = false, find, viewportWidth }) {
  const out = [];
  for (const step of tourSteps(role, { phone })) {
    const el = step.anchor && typeof find === 'function' ? find(step.anchor) : null;
    const shown = anchorShown(el, viewportWidth);
    if (!shown && !step.page) continue;
    const text = shown || !step.pageBody ? step.body : step.pageBody;
    out.push({ id: step.id, title: step.title, body: text(role), el: shown ? el : null });
  }
  return out;
}

/**
 * The step after (`dir` 1) or before (`dir` -1) `currentId` in `list`. When
 * the current step's anchor has gone, the nearest one in the tour's order is
 * taken. Null when there is none.
 */
export function stepFrom(list, currentId, dir) {
  const at = list.findIndex((s) => s.id === currentId);
  if (at >= 0) return list[at + dir] || null;
  const order = STEPS.map((s) => s.id);
  const pos = order.indexOf(currentId);
  if (dir > 0) return list.find((s) => order.indexOf(s.id) > pos) || null;
  return [...list].reverse().find((s) => order.indexOf(s.id) < pos) || null;
}

export const GUTTER = 16;
const GAP = 12;
const WIDTH = 320;

/**
 * Where the coachmark sits: right of the anchor, else below, else above, else
 * over its lower edge; centred with no anchor. Always inside the viewport with
 * a 16px gutter, and never wider than the screen less both gutters, so a phone
 * keeps it whole. `maxHeight` lets a short screen scroll the card itself.
 */
export function placeTip(rect, viewport, tipHeight = 200) {
  const vw = viewport.width;
  const vh = viewport.height;
  const width = Math.max(0, Math.min(WIDTH, vw - 2 * GUTTER));
  const maxHeight = Math.max(0, vh - 2 * GUTTER);
  const h = Math.min(tipHeight, maxHeight);
  const clampX = (x) => Math.max(GUTTER, Math.min(vw - GUTTER - width, x));
  const clampY = (y) => Math.max(GUTTER, Math.min(vh - GUTTER - h, y));
  const base = { width, maxHeight };
  if (!rect) return { ...base, placement: 'centre', top: clampY((vh - h) / 2), left: clampX((vw - width) / 2) };
  const right = rect.left + rect.width + GAP;
  if (right + width <= vw - GUTTER) return { ...base, placement: 'right', top: clampY(rect.top + rect.height / 2 - h / 2), left: right };
  const below = rect.top + rect.height + GAP;
  if (below + h <= vh - GUTTER) return { ...base, placement: 'below', top: below, left: clampX(rect.left) };
  const above = rect.top - GAP - h;
  if (above >= GUTTER) return { ...base, placement: 'above', top: above, left: clampX(rect.left) };
  return { ...base, placement: 'over', top: clampY(vh - GUTTER - h), left: clampX(rect.left) };
}

/** What a key does inside the coachmark: the arrows move between steps. Escape is the shared stack's (useEscapeClose). */
export function tourKey(key) {
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'back';
  return null;
}
