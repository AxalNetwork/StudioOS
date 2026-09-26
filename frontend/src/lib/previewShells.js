/**
 * The Preview shell picker — H38's words, in one pure place (D288).
 *
 * "VIEW AS" WAS TWO THINGS WEARING ONE NAME. The top-bar picker swapped the
 * sidebar and chrome to another shell in this browser — data and permissions
 * unchanged, every write still the viewer's own — and a user's row in Team
 * opened an impersonation session as that person: a typed reason, the
 * authenticator, thirty minutes, recorded in Security. H38 renames the first
 * "Preview shell" and leaves the second its name, so the two can no longer be
 * confused (task 404 closes on that). This file is the picker's vocabulary;
 * `App.jsx`'s `PortalSwitcher` draws it.
 *
 * THE LIST IS H38'S, IN ITS ORDER, PLUS EXPLORING. H38 draws six options —
 * HQ, HQ's own accounts, Founder, Investor, Partner, Advisor — and omits the
 * exploring shell, which the picker has offered since task #14 so an admin
 * can preview the holding-state experience end to end. Nothing retires:
 * Exploring stays, last, with a sentence in H38's shape. `holderOnly` marks
 * the one option that exists for the elevation alone.
 */
export const PREVIEW_SHELLS = [
  { key: 'hq', label: 'HQ', what: 'The eleven-row shell.', holderOnly: true, viewMode: 'admin', hq: true },
  { key: 'admin', label: 'HQ’s own accounts', what: 'The eight-row Admin shell over accounts HQ holds directly (Subsidiary S20).', holderOnly: false, viewMode: 'admin', hq: false },
  { key: 'founder', label: 'Founder', what: 'The founder shell.', holderOnly: false, viewMode: 'founder', hq: null },
  { key: 'investor', label: 'Investor', what: 'The investor shell.', holderOnly: false, viewMode: 'investor', hq: null },
  { key: 'partner', label: 'Partner', what: 'The operating partner shell.', holderOnly: false, viewMode: 'partner', hq: null },
  { key: 'advisor', label: 'Advisor', what: 'The advisor shell.', holderOnly: false, viewMode: 'advisor', hq: null },
  { key: 'exploring', label: 'Exploring', what: 'The exploring shell.', holderOnly: false, viewMode: 'exploring', hq: null },
];

export const PREVIEW_TRIGGER = 'Preview shell';
export const PREVIEW_HEADER = 'Preview shell · this browser only';
export const PREVIEW_FOOTER = 'Not impersonation. To act as a person, use View As on their row in Team: '
  + 'a typed reason, the authenticator, 30 minutes, recorded in Security.';

/** The options this viewer is offered: HQ for the holder alone. */
export function previewOptionsFor(superAdmin) {
  return PREVIEW_SHELLS.filter((o) => !o.holderOnly || superAdmin === true);
}

/** Which option is selected, from the shell state the switcher already holds. */
export function selectedPreviewKey(viewMode, hq) {
  if (viewMode === 'admin') return hq ? 'hq' : 'admin';
  return viewMode;
}

/** The viewer's own shell — the one that is not a preview. */
export function homePreviewKey(superAdmin) {
  return superAdmin === true ? 'hq' : 'admin';
}

/** H38's chip, built as the artboard builds it. */
export function previewChip(label) {
  return 'Previewing · ' + label + ' shell';
}

/**
 * Whose name the writes carry: "the Super Admin" to the holder, "you" to
 * anyone else — a plain admin previewing the founder shell is not the Super
 * Admin, and a chip that said so would be the chrome claiming an elevation
 * the session does not have.
 */
export function writesAs(superAdmin) {
  return superAdmin === true ? 'the Super Admin' : 'you';
}

export function previewNote(superAdmin) {
  return `This changes this browser’s chrome only. Every write still goes out as ${writesAs(superAdmin)}.`;
}
