/**
 * The Wellness presentation (D7121, #7121): the map entry and every word of
 * the public `/programs/wellness` page, from the landed canvas
 * `design/incoming/Program Wellness Presentation Page.dc.html` (PGW01 to PGW03).
 * No React, no API: the page reads nothing live and names no expert, member,
 * session or journal entry, and `frontend/test/wellness_presentation_d7121.test.mjs`
 * fails the build if it starts to.
 *
 * Owner-pending items (D7121 § Pending the owner) are held at their most
 * conservative value here, and each is one field to change once answered:
 *   - `availability` is `proposed`, the registry's wording (migration
 *     `202611171541_7116_wellness_program.sql`: status proposed, member access
 *     not_open), i.e. board PGW02B; `elig` draws PGW02A.
 *   - `edition` is null and `pdfPublished` false: the five-slide deck waits on
 *     the approved wording and edition date, so the page links no PDF yet. A
 *     link to a file that is not in `frontend/public/` would be answered by the
 *     SPA fallback with HTML, not a PDF.
 */

/** Where the public way in lives today. The kit's `/programs` index is #6966's. */
export const PROGRAMS_INDEX = { to: '/events', label: 'Programs & Events' };

/** The key → page → PDF map entry (the kit's map, #6966, takes it over when it lands). */
export const WELLNESS_PRESENTATION = Object.freeze({
  key: 'wellness',
  name: 'Wellness',
  group: 'Access',
  url: '/programs/wellness',
  host: 'axal.vc',
  pdf: '/program-briefs/axal-vc-wellness-v1.pdf',
  pdfFile: 'frontend/public/program-briefs/axal-vc-wellness-v1.pdf',
  pdfPublished: false,
  edition: null,
  slides: 5,
  availability: 'proposed',
  /** The private workspace, reached only through sign-in; never the shared link. */
  workspace: '/wellbeing',
  openHref: '/login?next=/wellbeing',
});

/** The kit's availability words (PGS00), with the one Wellness adds (PGW02A). */
export const AVAILABILITY = Object.freeze({
  elig: { label: 'Eligible members · signed in', glyph: '◐' },
  proposed: { label: 'Proposed · not open', glyph: '◌' },
});

export const EYEBROW = 'Private · inside your Axal VC account';
export const PURPOSE = 'A private place in your Axal VC account to check in with yourself each week, find qualified support and book a 1:1 session on your own terms.';
export const AUDIENCE = 'Founders and Administrators with access to Wellbeing, and the studio operators who introduce it to them.';

/** The availability panel's words for each state (PGW02A, PGW02B). */
export function panelCopy(availability) {
  if (availability === 'elig') {
    return {
      lead: 'Open to founders and Administrators with access to Wellbeing.',
      lines: [
        'Sign in, then select the heart in the header, or open Wellbeing directly.',
        'Other roles do not have it today. Wider access would be its own decision.',
        'This page reads nothing live and names no expert.',
      ],
    };
  }
  return {
    lead: 'Proposed · not open through Programs yet.',
    lines: [
      'The Wellbeing workspace itself is unchanged for the people who already have it.',
      'No studio, licence or plan gains access from this page.',
    ],
  };
}
export const PANEL_FINE = 'Signing in shares nothing. Your check-ins stay private.';

/** The Download PDF control: a link only to a committed file. */
export function downloadState(entry = WELLNESS_PRESENTATION) {
  if (!entry.pdfPublished || !entry.edition) {
    return { published: false, label: 'Download PDF', note: 'Not published yet' };
  }
  return {
    published: true,
    label: 'Download PDF',
    href: entry.pdf,
    filename: entry.pdf.split('/').pop(),
    note: `${entry.slides} slides · 16:9 · ${entry.edition}`,
  };
}

export const SECTIONS = [
  { id: 'who', title: 'Who it helps' },
  { id: 'what', title: 'What they do' },
  { id: 'how', title: 'How participation works' },
  { id: 'access', title: 'Access required' },
  { id: 'next', title: 'Next step' },
];

export const WHO = [
  ['Founders', 'Founders with access to Wellbeing. A few quiet minutes a week to notice how you are, and a way to find support when you want it.'],
  ['Administrators', 'Administrators have the same personal workspace for themselves. Acting for a studio never opens anyone else’s check-ins.'],
  ['Studio operators', 'People who introduce Wellness to their founders. You can explain it and share this page; you never see what anyone writes or books.'],
];
export const WHO_ALT = 'Three audiences: founders with access to Wellbeing, Administrators for their own workspace, and studio operators who introduce it but never see entries.';

export const FLOW = [
  { n: 1, g: '♡', k: 'The heart in the header', t: 'Take a moment to check in', d: 'Signed in, select the heart beside your name. It shows today’s check-in and opens Wellbeing.', who: 'You' },
  { n: 2, g: '✎', k: 'Private reflection', t: 'This week’s check-in', d: 'A few five-point questions, an optional note and topics if you want them. Stored encrypted.', who: 'Only you' },
  { n: 3, g: '⌕', k: 'Discovery', t: 'Experts and resources', d: 'Browse approved experts by kind of support, language, timezone and price, and a library of resources.', who: 'You' },
  { n: 4, g: '◷', k: 'Your own booking', t: 'A 1:1 session you choose', d: 'Pick an expert, a service and a time, then confirm. It appears in My bookings.', who: 'You and the expert you book' },
];
export const PLAN = [
  { at: 2, t: 'Today and This month', d: 'Daily and monthly reflections beside the weekly one' },
  { at: 3, t: 'Recommendations', d: 'Suggestions only from interests you choose, with “Why this?”' },
  { at: 4, t: 'Group sessions', d: 'Small groups with a set number of seats' },
];
export const FLOW_ALT = 'How Wellness works, in four steps. 1 The heart in the header: signed in, select the heart; it shows today’s check-in and opens Wellbeing. 2 Private reflection: this week’s check-in, a few five-point questions, an optional note and topics, stored encrypted, seen only by you. 3 Discovery: browse approved experts and resources. 4 Your own booking: pick an expert, a service and a time and confirm; seen by you and the expert you book. Steps 1 and 2 stay private: nothing you write goes to an expert, to HQ or to a model. Planned, not available yet: daily and monthly reflections, recommendations from interests you choose, and group sessions.';
export const BOUNDARY = 'Steps 1 and 2 stay with you. Nothing you write in a check-in goes to an expert, to Axal VC HQ or to a model. Eadwyn never reads your check-ins.';

export const STAGES = [
  'Sign in. Founders and Administrators see a heart in the header; on a phone it is in the account menu.',
  'Check in once a week, or not. There are no streaks and nothing counts against you.',
  'Look back over your own past weeks. Only you can read them.',
  'When you want support, browse the directory and the resources. Choose the kind of support yourself.',
  'Book a 1:1 session. The expert gets the booking, never your check-ins or a note. Cancel from My bookings where the expert’s rules allow.',
];

export const NOW = [
  ['Weekly check-in', 'Five-point questions, an optional note and topics, once a week, editable that week.'],
  ['Past weeks', 'Your own lines over time. A week without a check-in is a gap, never a zero.'],
  ['Expert directory', 'Approved experts with their kinds of support, languages, timezones and prices.'],
  ['Resources', 'A library of articles, groups and services you can open at any time.'],
  ['1:1 booking', 'Expert, service, time, confirm. Upcoming and past sessions in My bookings.'],
];
export const LATER = [
  ['Today and This month', 'Daily and monthly reflections, each with its own date.'],
  ['Recommendations', 'Suggestions only from interests you choose, with “Why this?” and Dismiss.'],
  ['Group sessions', 'Bookable small groups with seats; no one sees who else booked.'],
];
export const LATER_FOOT = 'Planned parts appear here when they ship and are checked. Until then, nothing on this page depends on them.';

export const CHOICE = {
  title: 'Your choices, whatever you believe',
  body: 'The check-in works as a quiet, secular journal. Mindfulness, grounding and spiritual or philosophical guidance are kinds of support you can choose to look for in the directory; nothing is assumed about your beliefs.',
};

export const TERMS = [
  ['Your account', 'A signed-in Axal VC account as a founder or an Administrator with access to Wellbeing.'],
  ['Privacy', 'Each check-in is visible only to the person who wrote it. Axal VC HQ sees totals only, for groups of seven or more.'],
  ['Experts', 'Each expert is approved by Axal VC HQ and sets their own services, times and price. You see them before you confirm.'],
  ['Cost', 'Check-ins and resources cost nothing extra. A session’s price, or that it is free, is shown before you book. Some plans limit how many expert profiles you open each month.'],
  ['Studios', 'Wellness grants nothing to a studio and is not part of a licence. An Administrator’s access is for their own workspace.'],
];
export const LIMITS = {
  title: 'What this program does not promise',
  body: 'Wellness is not emergency care and does not diagnose, treat or prescribe. This page names no expert and promises no outcome, no endorsement, and no provider in every language, region or timezone. Who is listed changes; the directory shows who is available today.',
};

export const HEADINGS = {
  who: ['People building companies, and the people who look after them.', 'Founders carry a lot. Wellness gives them a private place to notice it, and a way to reach support when they choose.'],
  what: ['From the heart in the header to a session you book yourself.', 'Four steps. The first two are yours alone; the last two are choices you make.'],
  how: ['At your pace, with nothing expected of you.', null],
  access: ['What you need to take part.', null],
  next: ['Choose your next step.', null],
};

export const NEXT = {
  title: 'Two doors, and the story to take with you.',
  acts: [
    { who: 'Founders and Administrators', label: 'Open Wellbeing →', kind: 'open', note: 'Signed in, your own workspace: this week’s check-in, your bookings and the directory.' },
    { who: 'Studio operators and presenters', label: `See ${PROGRAMS_INDEX.label}`, kind: 'index', note: 'Share this page. It shows no one’s check-ins or bookings.' },
  ],
  take: (slides) => `Take it with you: the same story as a ${slides}-slide PDF, for a meeting or to send on.`,
};
