/**
 * D6968 (#6968) — Mentor cohort access's presentation content: the five sections of the page
 * (PGM01) and the five slides of the PDF (PGM04), from the landed canvas's wording, which the
 * owner approves in review (2026-11-19). Slide 2 is section 1, slide 3 is section 2's journey,
 * slide 4 is section 2's comparison, the closing slide is sections 4 and 5.
 *
 * Every fact is main's: only an admin assigns, one advisor to one cohort, an account that holds
 * the Advisor licence, nothing written to the Lab (`routes/advisors_cohorts.ts`); what a mentor
 * sees, what founders can do and what staff do each week (`programsModel.js` HOW_IT_RUNS);
 * `/cohorts` behind the admin and advisor guard (`App.jsx`); the Advising and licence contact
 * topics (`ContactPage.jsx`); "Advisors are reviewed before they are admitted" (owner answer R1,
 * #6976). The advisor audience page is linked, not restated (#6978, S1 on #6965).
 *
 * What is NOT here: a cohort name, a count or a date (no public read exists), a "Not assigning
 * now" state (PGM02B, held for the owner), any equity line (G1) and any general "Ask a question"
 * (#6987).
 */

/** Sign in, then Cohorts: `/login` honours a same-origin `?next=`. */
export const SIGN_IN_HREF = `/login?next=${encodeURIComponent('/cohorts')}`;
export const ADVISE_HREF = '/contact?topic=advise';
export const LICENCE_HREF = '/contact?topic=licence';
export const FOR_ADVISORS_HREF = '/for-advisors';

/** The signature visual's text alternative: the journey's accessible name and slide 3's alt text. */
export const JOURNEY_ALT = 'Three stages. 1 Staff: an admin assigns one advisor to one named cohort. Then, inside a boundary labelled “One assigned cohort”: 2 every founder in that cohort is told a mentor can read them, and can hide from that mentor; 3 the mentor follows each founder’s weeks as the Lab records them and posts guidance to the cohort. Outside the boundary: other cohorts, admission and graduation, week results and deadlines, and assigning yourself.';

/** The three stages: who acts, what happens, and what it means. */
export const STAGES = [
  { k: '1 · Staff', t: 'An admin assigns', items: ['One advisor to one named cohort. Only an account that holds the Advisor licence can be picked.'] },
  { k: '2 · Founders', t: 'Founders are told', items: ['Every founder in the cohort is told a mentor can read them, and can hide from that mentor.'] },
  { k: '3 · Mentor', t: 'The mentor supports', items: ['Follows each founder’s weeks as the Lab records them, and posts guidance to the cohort.'] },
];

export const OUTSIDE = ['Other cohorts', 'Admission and graduation', 'Week results and deadlines', 'Assigning yourself'];

const BOUNDARY = {
  label: 'Boundary · one assigned cohort',
  note: 'Stages 2 and 3 happen inside one named cohort and its founders. A founder who hides is not listed to that mentor.',
};
const OUTSIDE_LINE = `Outside the boundary: ${OUTSIDE.map((x, i) => (i ? x.toLowerCase() : x)).join(', ')}.`;

const WHO = [
  ['Advisors', 'Members who hold the Advisor licence. An advisor needs no public profile to be assigned.'],
  ['Founders in the cohort', 'When a mentor is assigned, they are told, and can hide from that mentor. The mentor follows their four weeks.'],
  ['Staff who assign', 'Admins assign a mentor before a cohort starts and end access when it ends.'],
];

/** Supporting founders versus operating the Lab. */
const CAN = [
  ['Read the cohort’s founders', 'Names and email addresses, once a founder’s first week is recorded.'],
  ['Follow their weeks', 'Week-by-week status as the Lab records it, read only.'],
  ['Guide the cohort', 'Post guidance to the cohort and see who acted on it.'],
  ['Plan around the Lab', 'The Lab’s dates beside your own session slots.'],
];
const KEEPS = [
  ['Admission and graduation', 'Who joins a cohort and who completes it.'],
  ['Week results and deadlines', 'A mentor cannot edit a week, a result or a date.'],
  ['Other cohorts', 'Each assignment opens one cohort; two are never merged into one list.'],
  ['Who mentors', 'Only an admin assigns, extends or ends access, never the mentor.'],
];

const FOR_A_MENTOR = [
  'An admin assigns you to one named cohort.',
  'Every founder in that cohort is told a mentor can read them.',
  'You open Cohorts in StudioOS and follow the founders week by week.',
  'A founder may hide from you; a hidden founder is not listed.',
  'When the cohort ends, an admin ends your access or assigns you to the next one. Founders are told.',
];
const HOW_RUN = [
  ['Join', 'Assigned by an admin: one advisor to one cohort.'],
  ['Cycle', 'The Lab’s monthly cohorts of four weeks.'],
  ['Before a cohort starts', 'Assign at least one mentor.'],
  ['Each week', 'Check for mentors whose licence changed.'],
  ['When a cohort ends', 'End access, or assign the mentor to the next cohort.'],
];

const NOT_PROMISED = 'An assignment opens one cohort and nothing else in the Lab. No advisor is promised a cohort, and no founder is promised a mentor. Access stops as soon as an account no longer holds the Advisor licence, and a record of who had access stays after it ends.';

export default {
  sections: [
    {
      title: 'A mentor for one cohort, chosen by staff.',
      lead: 'A Spin-Out Lab cohort works for four weeks. Staff can add an advisor who follows those founders for the cohort.',
      blocks: [
        { type: 'cards', numbered: true, items: WHO },
        { type: 'aside', label: 'Not an advisor yet?', text: 'Advisors are reviewed before they are admitted, and being admitted does not assign a cohort. Read', link: { href: FOR_ADVISORS_HREF, label: 'For advisors' } },
      ],
    },
    {
      title: 'Assigned, told, then supporting — inside one cohort.',
      lead: 'The boundary is the assignment: one named cohort and its founders. A mentor supports founders; the Lab’s staff operate the Lab.',
      band: true,
      blocks: [
        { type: 'timeline', label: JOURNEY_ALT, steps: STAGES, span: BOUNDARY, along: OUTSIDE_LINE },
        { type: 'cols', items: [
          { title: '✓ A mentor can', block: { type: 'list', items: CAN } },
          { title: '× The Lab keeps', block: { type: 'list', items: KEEPS } },
        ] },
      ],
    },
    {
      title: 'From assignment to the end of the cohort.',
      blocks: [
        { type: 'cols', items: [
          { title: 'For a mentor', block: { type: 'stages', items: FOR_A_MENTOR } },
          { title: 'How staff run it', block: { type: 'terms', items: HOW_RUN } },
        ] },
      ],
    },
    {
      title: 'What you need to take part.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Admission', 'Assigned by an admin. No one applies, and an advisor cannot assign themselves.'],
          ['Your account', 'An Axal VC account that holds the Advisor licence. Advisors are reviewed before they are admitted.'],
          ['Scope', 'One named cohort per assignment: founders’ names and email addresses, week-by-week status, who acted on guidance, and the Lab’s dates. Nothing else in the Lab.'],
          ['Founders’ choice', 'Founders are told when a mentor can read them and when that ends, and can hide from one mentor.'],
          ['Studios', 'A studio’s Administrator acts for the studio, on its licence. Assigning a mentor there needs the studio’s grant for this program.'],
        ] },
        { type: 'limits', title: 'What mentor access does not do', text: NOT_PROMISED },
      ],
    },
  ],
  next: {
    title: 'Choose your next step.',
    band: 'Three ways forward, kept apart.',
    actions: [
      { id: 'signin', who: 'Assigned advisors', label: 'Sign in to your cohorts →', kind: 'primary', to: SIGN_IN_HREF, note: 'Opens Cohorts in StudioOS after sign-in. Without an assignment it says so; it never shows an empty cohort.' },
      { id: 'advise', who: 'Other advisors', label: 'Ask about advising', kind: 'quiet', to: ADVISE_HREF, note: 'Contact, Advising topic. Staff decide who mentors a cohort.' },
      { id: 'licence', who: 'Studio Administrators', label: 'Enquire about a studio licence', kind: 'link', to: LICENCE_HREF, note: 'For a studio that wants this program on its licence. Not an assignment.' },
    ],
  },
  // No public read exists for this program: a fixed statement, never a count.
  panel: {
    text: 'An admin assigns one advisor to one cohort. This program takes no applications.',
    note: 'Who can be assigned: members who hold the Advisor licence. Sign in is for advisors an admin has assigned.',
    action: { id: 'signin', label: 'Sign in to your cohorts →', to: SIGN_IN_HREF },
  },
  cover: { art: 'lane-advisors.webp', alt: 'Advisors illustration from the Axal VC site, decorative.' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'A mentor for one cohort, chosen by staff.',
      blocks: [{ type: 'cards', items: WHO }],
      alt: 'Three groups: advisors who hold the Advisor licence; founders in the cohort, who are told and can hide; staff who assign and end access.',
    },
    {
      eyebrow: 'What happens', title: 'Assigned, told, then supporting.',
      blocks: [{ type: 'timeline', label: JOURNEY_ALT, steps: STAGES, span: { label: BOUNDARY.label, note: `${BOUNDARY.note} ${OUTSIDE_LINE}` } }],
      alt: JOURNEY_ALT,
    },
    {
      eyebrow: 'The difference', title: 'Supporting founders is not operating the Lab.',
      blocks: [{ type: 'two', items: [
        { label: 'A mentor can', block: { type: 'list', items: CAN } },
        { label: 'The Lab keeps', block: { type: 'list', items: KEEPS } },
      ] }],
      alt: 'Two lists. A mentor can: read the cohort’s founders, follow their weeks, guide the cohort, plan around the Lab. The Lab keeps: admission and graduation, week results and deadlines, other cohorts, who mentors.',
    },
  ],
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Admission', 'Assigned by an admin. No applications.'],
      ['Account', 'Holds the Advisor licence; advisors are reviewed before admission.'],
      ['Scope', 'One named cohort per assignment; nothing else in the Lab.'],
      ['Founders', 'Told when a mentor can read them; can hide from one.'],
      ['Ends', 'When an admin ends it, or the Advisor licence lapses.'],
    ],
    next: [
      ['Read this program', 'axal.vc/programs/mentor-cohorts', 'The current conditions and the next step.'],
      ['Assigned advisors', 'axal.vc/cohorts', 'Sign in; your cohort opens in StudioOS.'],
      ['Other advisors, studios', 'axal.vc/contact', 'Advising topic; a studio licence is its own enquiry.'],
    ],
    alt: 'Five conditions, and three next steps with their addresses; public page URL and edition date.',
  },
};
