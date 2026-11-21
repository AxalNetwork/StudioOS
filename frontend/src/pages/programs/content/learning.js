/**
 * D6973 (#6973) — Learning's presentation content: the five sections of the page (PGL01) and
 * the slides of the PDF (PGL04), from the landed canvas's wording, which the owner approves in
 * review (2026-11-19). One story, two formats: slide 2 is section 1, slide 3 is section 3
 * (Learning as the parent), slide 4 is section 2 (the course outline), slide 5 is sections 4
 * and 5. The deck shows the structure before the example, as the canvas orders it (PGL06).
 *
 * The facts are main's: the registry row of migration 560 (purpose, join method, HQ writes and
 * publishes, assigned admins follow learners read only, by name); migrations 389 to 391 (a
 * program is open or by invitation; an exercise is accepted or needs work; an exam has a pass
 * mark, 70 by default, and may limit time and attempts); `learningCompletion.ts` (what completes
 * each item, and a course); `learning_programs.ts` (members join only a published open program);
 * `programEnforcement.ts` (the entitlement check runs where it is enforced); and "Certificates
 * are not issued for courses yet." (`MyLearning.jsx`, `LearningWired.jsx`).
 *
 * The course, module, lesson and program names and the 70% pass mark are bracketed samples:
 * the outline is labelled an illustration, never a published course.
 *
 * What is NOT here, on the owner's answers of 2026-11-19: the cohort organisers' contact door
 * (no contact topic exists; held in D6973), a general "Ask a question" action (#6987 is not
 * shipped), and any course, date, fee, place, certificate or result. The page reads nothing
 * live, so it has no Join: what a member can join shows in Learning after sign-in.
 */

export const LEARNING_HREF = '/learning';
export const SIGN_IN_HREF = `/login?next=${encodeURIComponent(LEARNING_HREF)}`;
export const LICENCE_HREF = '/contact?topic=licence';

export const ILLUSTRATION = 'Illustration · not a published course';

const AUDIENCES = [
  ['Learners', 'Members, whatever their profile. You take the courses in the programs you are in, at your own pace, and your progress is kept.'],
  ['Cohort organisers', 'People who bring HQ a region or a group. HQ publishes a program for it and assigns admins who follow its learners.'],
  ['Studio Administrators', 'You act for a studio on its licence. Learning is one of the programs HQ can grant to a studio.'],
];

/** The signature: one illustrative course outline, a lesson, then an exercise, then an exam. */
export const COURSE = [
  {
    k: '1 · Lesson · video or reading',
    t: '[Why interviews beat surveys]',
    items: ['Watch or read it. In a video, Learning keeps your place so you can resume.', 'Done: complete when you mark it complete.'],
  },
  {
    k: '2 · Exercise · written answer',
    t: '[Write five interview questions]',
    items: ['Submit your answer. HQ reviews it: accepted, or needs work with feedback. Each resubmission is kept.', 'Done: complete when your answer is accepted.'],
  },
  {
    k: '3 · Assessment · exam',
    t: '[Check your understanding]',
    items: ['Answer the questions. The exam is graded on the server against its pass mark, [70%] in this example.', 'Done: complete when an attempt passes.'],
  },
];

const COURSE_SLIDE = [
  { k: '1 · Lesson', t: 'Video or reading', items: ['Complete when you mark it complete.'] },
  { k: '2 · Exercise', t: 'Written answer', items: ['Complete when your answer is accepted.'] },
  { k: '3 · Assessment', t: 'Exam', items: ['Complete when an attempt passes.'] },
];

/** The outline's text alternative: the accessible name of the list on the page and slide 4's alt text. */
export const COURSE_ALT = 'An illustrative course outline, not a published course. Learning contains a program, the program contains a course, and the course a module of three steps: 1 a lesson, video or reading, complete when you mark it complete; 2 an exercise, complete when HQ accepts your answer; 3 an exam, complete when an attempt passes its pass mark. The course is complete when every required lesson is. No certificate is issued.';

const FORMATS = [
  ['Lessons', 'A video or a reading. A video remembers where you stopped.'],
  ['Exercises', 'A written answer or a checklist, reviewed by HQ: accepted, or needs work with feedback.'],
  ['Exams', 'Graded on the server against the exam’s pass mark. An exam may limit attempts or time.'],
  ['Webinars', 'Live sessions, held in a program or as a lesson in a course.'],
];

/** Learning's programs, as samples: each sets its own access. Glyph and word, never colour alone. */
const PROGRAMS = [
  ['● Open · [A program for a region]', 'Published. Members join it themselves from Learning.'],
  ['◇ By invitation · [A program for a group]', 'Published. HQ enrols each learner; there is no join button.'],
  ['◌ Draft · not visible · [A program in preparation]', 'Only HQ sees it until it is published.'],
];
const HOLDS = 'Each holds courses, lessons, exercises, exams and webinars.';

const TAKING_PART = [
  'HQ publishes a learning program for a region or a group and assigns the admins who follow it.',
  'An open program: you join it yourself from Learning. A program by invitation: HQ enrols you.',
  'You work through its courses at your own pace. Your progress on each item is recorded.',
  'Assigned admins follow learners’ progress, read only, by name. They cannot change your answers.',
];

const NOT_PROMISED = 'This page names no course, date, fee, place, certificate or result. Which courses you can take depends on what HQ has published and on the programs you are in.';

export default {
  sections: [
    {
      title: 'Learners, the people who organise them, and studios.',
      lead: 'Learning is for members who want to build a skill, and for the people who bring HQ a group to teach.',
      blocks: [
        { type: 'cards', numbered: true, items: AUDIENCES },
      ],
    },
    {
      title: 'A lesson, then an exercise, then an exam.',
      lead: 'One course outline, drawn as an illustration. Titles and the pass mark are samples in brackets.',
      band: true,
      blocks: [
        { type: 'aside', label: ILLUSTRATION, text: 'Learning › [A program for a region] › [Talking to your first customers] · [Module 1 · Finding the problem] · 3 required lessons.' },
        {
          type: 'timeline', label: COURSE_ALT, steps: COURSE,
          span: { label: 'At the end', note: 'The course is complete when every required lesson is. No certificate is issued: certificates are not issued for courses yet.' },
        },
        { type: 'card', title: 'The formats Learning supports today', block: { type: 'list', items: FORMATS } },
      ],
    },
    {
      title: 'Learning is the parent. Each program inside it sets its own access.',
      blocks: [
        { type: 'card', title: 'The program: Learning', text: 'Run by Axal VC HQ. HQ writes and publishes every learning program inside it.' },
        { type: 'cards', items: PROGRAMS.map(([t, x]) => [t, `${x} ${HOLDS}`]) },
        { type: 'aside', label: 'Decided per program', text: 'Whether you can join is set for each learning program, not for Learning as a whole. Program names here are samples.' },
        { type: 'card', title: 'How a learner takes part', block: { type: 'stages', items: TAKING_PART } },
      ],
    },
    {
      title: 'What you need to take part.',
      band: true,
      blocks: [
        { type: 'terms', items: [
          ['Your account', 'A signed-in Axal VC member account, whatever its profile.'],
          ['Joining', 'An open program: Join, in Learning. By invitation: HQ enrols you. If HQ removed you from a program, ask its administrator.'],
          ['Program access', 'Where HQ checks program access, Learning must be in force on your account. Learning tells you if it is not.'],
          ['Run by', 'Axal VC HQ writes, publishes and reviews every program, exercise and exam.'],
          ['Studios', 'Learning is a program HQ can grant to a studio on its licence. The studio’s Administrator asks HQ.'],
          ['Certificates', 'Not issued for courses yet.'],
        ] },
        { type: 'limits', title: 'What this program does not promise', text: NOT_PROMISED },
      ],
    },
  ],
  next: {
    title: 'Choose your next step.',
    band: 'Two doors, each for a different person.',
    actions: [
      { id: 'signin', who: 'Members', label: 'Sign in to Learning →', kind: 'link', to: SIGN_IN_HREF, note: 'Learning shows the programs open to you and the ones you are in, before any Join. Signing in does not enrol you in anything.' },
      { id: 'licence', who: 'Studio Administrators', label: 'Enquire about a studio licence', kind: 'quiet', to: LICENCE_HREF, note: 'For a studio that wants Learning on its licence. Not an application.' },
    ],
  },
  panel: {
    text: 'Each learning program is open, or by invitation. HQ decides for each one.',
    note: 'What you can join is shown after you sign in, in Learning, with the programs you are already in. This page reads nothing live and makes no promise about courses, dates or places.',
  },
  cover: { alt: 'No artwork.' },
  slides: [
    {
      eyebrow: 'Who it helps', title: 'Learners, organisers and studios.',
      blocks: [{ type: 'cards', items: [
        ['Learners', 'Members take the courses in their programs, at their own pace.'],
        ['Cohort organisers', 'Bring HQ a region or a group; HQ publishes a program for it.'],
        ['Studio Administrators', 'Learning is a program HQ can grant on a studio’s licence.'],
      ] }],
      alt: 'Three audiences: learners, cohort organisers and studio Administrators. One line on what each does.',
    },
    {
      eyebrow: 'How participation works', title: 'Each program sets its own access.',
      blocks: [
        { type: 'list', items: [['Learning', 'The parent program, run by Axal VC HQ. Availability is decided for each program inside it, not for Learning as a whole.']] },
        { type: 'cards', items: PROGRAMS },
      ],
      alt: 'Learning is the parent program, run by Axal VC HQ. Inside it are learning programs, each with its own availability: an open program members join themselves, a program by invitation that HQ enrols learners into, and a draft only HQ sees. Each program holds courses, lessons, exercises, exams and webinars.',
    },
    {
      eyebrow: 'What a learner does · one course', title: 'A lesson, an exercise, an exam.',
      blocks: [{
        type: 'timeline', label: COURSE_ALT, steps: COURSE_SLIDE,
        span: { label: `${ILLUSTRATION} · [Talking to your first customers] · [Module 1]. At the end`, note: 'the course shows as complete. No certificate is issued.' },
      }],
      alt: COURSE_ALT,
    },
  ],
  closing: {
    title: 'Access and next step.',
    rows: [
      ['Account', 'A signed-in Axal VC member account.'],
      ['Joining', 'Open programs: join in Learning. By invitation: HQ enrols you.'],
      ['Run by', 'Axal VC HQ writes, publishes and reviews every program.'],
      ['Studios', 'Learning can be granted on a studio’s licence.'],
      ['Not promised', 'Any course, date, fee, place, certificate or result.'],
    ],
    next: [
      ['Read the presentation', 'axal.vc/programs/learning', 'The same story, kept current.'],
      ['Members sign in at', 'axal.vc/learning', 'What is open to you, and your progress.'],
    ],
    alt: 'Conditions to take part: a member account, joining per program, run by HQ, studios by licence, nothing promised; two addresses; public page URL and edition date.',
  },
};
