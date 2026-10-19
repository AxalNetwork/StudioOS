// D759 (#1858) — the words for signing a Subscription Booklet, pure.
//
// `bookletSignCopy` is laid over `signingCopy(envelope)` (`esignSteps.js`) when
// `GET /sign/:token` answers `booklet: { stage, edition }`, so #1857's four
// steps say the booklet's words without a layout change. `signingLine` is the
// LP's submitted view's line for each `signing.state` the Worker answers
// (`services/subscriptionBooklet.ts`, `bookletView`). The canvas's copy is
// verbatim where it draws the screen (L12 `p-read`, `p-adopt`, `p-done`);
// S1's copy (#1858 decision 10) fills the rest.

import { utcClock } from './esignSteps.js';

export const ACCOUNT_DOCUMENTS = { label: 'Open my documents', href: '/account' };

/** The submitted view's Sign button (canvas `big(t, ind)`: indigo, 50 px). */
export const SIGN_BOOKLET = 'Sign the booklet';

/** Shown in place of the booklet's JSON body when its paper did not load. */
export const BOOKLET_PAPER_FALLBACK = 'The booklet did not load. Reload this page to read it before you sign.';

const SIGNING_LINES = Object.freeze({
  sent: 'Out for your signature. Open the signing link we emailed you.',
  awaiting_gp: 'You signed Parts 3 to 8. The General Partner signs Part 9 to accept.',
  void: 'This signature request was voided. Ask Axal VC to withdraw the booklet so you can open a new one.',
});

/**
 * The submitted view's line for a booklet's signing state, or null where the
 * view shows the Sign button (`not_sent`) or the state is unknown.
 * `accepted` names the day the General Partner signed, in UTC.
 */
export function signingLine(signing) {
  const state = signing?.state;
  if (state === 'accepted') {
    const day = typeof signing.accepted_at === 'string' ? toUtcDay(signing.accepted_at) : '';
    return `Accepted by the General Partner on ${day || '[date not recorded]'}. A copy is in your documents.`;
  }
  return Object.hasOwn(SIGNING_LINES, state) ? SIGNING_LINES[state] : null;
}

/** Whether the submitted view offers Sign the booklet. */
export function canSignBooklet(view) {
  return view?.status === 'submitted' && view?.signing?.state === 'not_sent';
}

function toUtcDay(v) {
  const d = new Date(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * The booklet's words for #1857's steps, by stage (`applicant` signs Parts 3
 * to 8, `gp` signs Part 9). `edition` is the booklet's v[N]; `signedAt` is
 * `POST /sign/:token`'s `signed_at`, read in UTC. Null for any other stage.
 */
export function bookletSignCopy({ stage, edition, signedAt } = {}) {
  if (stage !== 'applicant' && stage !== 'gp') return null;
  const applicant = stage === 'applicant';
  const parts = applicant ? 'Parts 3 to 8' : 'Part 9';
  const clock = signedAt ? utcClock(signedAt) : '';
  return {
    readTitle: 'Sign the Subscription Booklet',
    readCounter: parts,
    readContinue: 'Continue',
    adoptTitle: 'Adopt a signature',
    typeHint: 'Type your full legal name. It is drawn on each signature line of this booklet.',
    adoptNote: 'By adopting, you agree it has the same effect as your handwritten signature.',
    adoptAction: 'Adopt and sign',
    confirmTitle: `Apply this signature to ${parts}?`,
    doneTop: 'Signed',
    doneTitle: applicant ? 'You signed Part 8' : 'You signed Part 9',
    doneLine: `Subscription Booklet · v${Number.isInteger(edition) && edition > 0 ? edition : 1} · ${clock} UTC.`,
    doneNext: applicant
      ? 'The General Partner signs Part 9 to accept. A copy is in your documents.'
      : "The booklet is accepted. A copy is in the applicant's documents.",
    doneAction: ACCOUNT_DOCUMENTS,
    paperFallback: BOOKLET_PAPER_FALLBACK,
  };
}
