/**
 * The Spin-Out Lab application, the client half (D384). No React: the Apply
 * wizard, the status screen and the admin list call these, and the tests call
 * them directly.
 *
 * THE ANSWERS mirror `cloudflare-worker/src/services/applicationLifecycle.ts`
 * (D383): the same keys, the same closed sets, the same fields a submission
 * must carry. The worker is the rule; this copy exists so a founder is told
 * what is missing before they press Submit, not after. A test reads both files
 * and fails if the sets drift.
 *
 * THE TIMELINE is built only from what `/state`'s `applicant` block records.
 * The canvas draws dates for Screening and a "by" date for the decision; no
 * store holds either, so those stages carry no date rather than an invented
 * one.
 */
import { parseSqliteUtc } from './spinoutLab';

export const ORIGIN_OPTIONS = [
  { key: 'university', name: 'University spin-out', note: 'The IP comes from a research institution and needs an assignment or licence.' },
  { key: 'corporate', name: 'Corporate spin-out', note: 'Carved out of an employer. Expect an existing agreement to unwind.' },
  { key: 'independent', name: 'Independent', note: 'Built outside an institution. You already own what you have made.' },
];

export const TTO_OPTIONS = [
  { key: 'not_disclosed', name: 'Not yet disclosed', note: 'The institution does not know about the venture yet.' },
  { key: 'disclosed', name: 'Disclosed, no discussion', note: 'You filed a disclosure; nothing has been negotiated.' },
  { key: 'negotiating', name: 'Licence under negotiation', note: 'Terms are in discussion with the transfer office.' },
  { key: 'signed', name: 'Licence or assignment signed', note: 'The company can hold the IP today.' },
  { key: 'not_applicable', name: 'No transfer office involved', note: 'The employer or institution has no office that handles this.' },
];

export const IP_OPTIONS = [
  { key: 'patent_filed', label: 'Patent filed' },
  { key: 'patent_granted', label: 'Patent granted' },
  { key: 'inventors_identified', label: 'Inventors identified' },
  { key: 'background_separated', label: 'Background IP separated' },
  { key: 'publication_pending', label: 'Publication pending' },
];

export const APPLY_STEPS = [
  { n: 1, name: 'Venture basics' },
  { n: 2, name: 'Spin-out origin & IP' },
  { n: 3, name: 'Team' },
  { n: 4, name: 'Traction', note: 'Optional throughout' },
  { n: 5, name: 'Why Axal VC' },
];

export const CONFIDENTIAL_NOTE =
  'Everything here stays with the review team and is never shared with investors, other applicants, or your institution. '
  + 'Withdraw at any point and we delete your answers.';

/**
 * The canvas's "What your answer changes" panel says a TTO answer re-sequences
 * the founder's Week 1. The Lab has ONE milestone list for every founder
 * (`MILESTONES`, lib/spinoutLab.js); nothing reads this answer to change it.
 * Until that is built — a product call, named in D384 — the panel says what
 * the answer is used for today: the reviewer and the interviewing partner read
 * it. It never promises a schedule that no code produces.
 */
export function consequenceFor(answers) {
  const a = answers || {};
  if (a.origin === 'independent') {
    return {
      text: 'An independent build has no transfer office to wait on. The reviewer reads this to know which questions about ownership they do not need to ask.',
      foot: 'Nothing on this step is scored.',
    };
  }
  if (!a.origin) {
    return {
      text: 'Choose where the venture comes from. A university spin-out and an independent build need different first steps, and the reviewer reads this first.',
      foot: 'Nothing on this step is scored.',
    };
  }
  const tto = TTO_OPTIONS.find((t) => t.key === a.tto_status);
  return {
    text: tto
      ? `The reviewer and the partner who interviews you read “${tto.name}” before they read anything else, and ask about the licence timeline with that in mind.`
      : 'Tell us where the licence stands. The partner who interviews you asks about the timeline with your answer in mind.',
    foot: 'Nothing on this step is scored. Your Lab weeks are the same for every founder today; this answer does not change them.',
  };
}

export function emptyBasics() {
  return { company: '', idea: '', incorporated: 'no', stage: '', jurisKey: 'de' };
}

export function emptyAnswers() {
  return {
    origin: null, institution: '', research_group: '', tto_status: null, ip: [],
    team_size: '', team_roles: '', commercial_lead: null, traction: '', why_axal: '',
  };
}

const filled = (v) => typeof v === 'string' && v.trim() !== '';

/** The worker's `missingForSubmit`, key for key. */
export function missingAnswers(a) {
  const missing = [];
  if (!a?.origin) missing.push('origin');
  if (a?.origin && a.origin !== 'independent' && !a.tto_status) missing.push('tto_status');
  if (a?.origin === 'university' && !filled(a.institution)) missing.push('institution');
  const size = Number(a?.team_size);
  if (!(Number.isInteger(size) && size >= 1 && size <= 50)) missing.push('team_size');
  if (!filled(a?.why_axal)) missing.push('why_axal');
  return missing;
}

export function missingBasics(b) {
  const missing = [];
  if (!filled(b?.company)) missing.push('company');
  if (!filled(b?.idea)) missing.push('idea');
  return missing;
}

const STEP_OF = {
  company: 1, idea: 1, origin: 2, tto_status: 2, institution: 2, team_size: 3, why_axal: 5,
};
export const FIELD_LABEL = {
  company: 'Company or working name',
  idea: 'What you are building',
  origin: 'Where the venture comes from',
  tto_status: 'Tech-transfer status',
  institution: 'Institution',
  team_size: 'Team size (1 to 50)',
  why_axal: 'Why Axal VC',
};

/** What stops step `n` from being complete. Step 4 (traction) never blocks. */
export function missingOnStep(n, basics, answers) {
  return [...missingBasics(basics), ...missingAnswers(answers)].filter((k) => STEP_OF[k] === n);
}

/** The body `POST /spinout-lab/apply` takes for `answers`. */
export function answersPayload(a) {
  const size = Number(a.team_size);
  return {
    origin: a.origin,
    institution: a.institution,
    research_group: a.research_group,
    tto_status: a.origin === 'independent' ? null : a.tto_status,
    ip: a.ip,
    team_size: Number.isInteger(size) ? size : null,
    team_roles: a.team_roles,
    commercial_lead: a.commercial_lead,
    traction: a.traction,
    why_axal: a.why_axal,
  };
}

/** A draft is saved as typed, basics and answers together, and read back the same way. */
export function draftBody(basics, answers, step) {
  return { basics, answers, step };
}

export function fromDraft(draft) {
  const raw = draft?.answers;
  if (!raw || typeof raw !== 'object') return null;
  const basics = { ...emptyBasics(), ...(raw.basics && typeof raw.basics === 'object' ? raw.basics : {}) };
  const answers = { ...emptyAnswers(), ...(raw.answers && typeof raw.answers === 'object' ? raw.answers : {}) };
  if (!Array.isArray(answers.ip)) answers.ip = [];
  const step = Number.isInteger(raw.step) && raw.step >= 1 && raw.step <= 5 ? raw.step : 1;
  return { basics, answers, step, updatedAt: draft.updated_at || null };
}

const fmtDay = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
// An interview is read in the viewer's own zone, and says which zone.
const fmtWhen = (d) => d.toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});
export const dayOf = (s) => { const d = parseSqliteUtc(s); return d ? fmtDay(d) : null; };
export const whenOf = (s) => { const d = parseSqliteUtc(s); return d ? fmtWhen(d) : null; };

/** Where the application stands, as one word the page can switch on. */
export function phaseOf(applicant) {
  if (!applicant) return 'none';
  const status = String(applicant.status || '').toLowerCase();
  const pool = String(applicant.pool?.status || '').toLowerCase();
  if (status === 'withdrawn' || pool === 'withdrawn') return 'withdrawn';
  if (status === 'refused' || pool === 'rejected') return 'declined';
  if (status === 'accepted' || pool === 'approved' || pool === 'activated') return 'accepted';
  if (applicant.interview) return 'interview';
  return 'screening';
}

/**
 * The four stages the canvas draws, each with a state (done / now / next) and
 * only the dates a row holds. One record drives the marks and the lede, so the
 * ring can never sit on a stage the sentence does not name.
 */
export function timelineFor(applicant) {
  const phase = phaseOf(applicant);
  const decided = phase === 'declined' || phase === 'accepted';
  const iv = applicant?.interview || null;
  const start = dayOf(applicant?.pool?.cycle?.start_at);
  const stages = [
    { key: 'submitted', name: 'Submitted', state: 'done', date: dayOf(applicant?.submitted_at) },
    {
      key: 'screening', name: 'Screening',
      state: phase === 'screening' ? 'now' : 'done',
      date: null,
      note: phase === 'screening'
        ? (applicant?.pool?.status === 'waitlisted'
          ? 'You are on the waitlist for this cohort. The review is not finished.'
          : 'The review team reads every application against the cohort brief.')
        : null,
    },
    {
      key: 'interview', name: 'Partner interview',
      state: phase === 'interview' ? 'now' : decided ? 'done' : 'next',
      date: iv ? whenOf(iv.scheduled_at) : null,
      note: iv
        ? `${iv.duration_min} minutes${iv.location ? `, ${iv.location}` : ''}.`
        : decided ? 'No interview is on record for this application.' : 'Scheduled by the team once screening is done.',
    },
    {
      key: 'decision', name: 'Cohort decision',
      state: decided ? 'done' : 'next',
      date: decided ? dayOf(applicant?.decided_at || applicant?.pool?.decided_at) : null,
      note: start ? `${applicant.pool.cycle.label ? `The ${applicant.pool.cycle.label} cohort` : 'The cohort'} starts ${start}.` : null,
    },
  ];
  return stages;
}

export function statusLede(applicant) {
  switch (phaseOf(applicant)) {
    case 'screening': return 'Your application is at screening. We contact every applicant with a decision, including a no.';
    case 'interview': return 'Your application is at the partner interview. We contact every applicant with a decision, including a no.';
    case 'declined': return 'The team has decided on your application.';
    case 'accepted': return 'You are in.';
    case 'withdrawn': return 'You withdrew this application.';
    default: return '';
  }
}

/** The legacy `/state.application` row, shaped like `applicant`, for a database without migration 315. */
export function applicantFromLegacy(application) {
  if (!application) return null;
  return {
    application_id: application.id ?? null,
    status: application.status,
    submitted_at: application.created_at ?? null,
    decided_at: application.decided_at ?? null,
    withdrawn_at: null,
    answers: null,
    answers_recorded: false,
    pool: null,
    note: null,
    interview: null,
    reapply: null,
  };
}

const icsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);

/** An .ics for the interview, or null when its time cannot be read. */
export function interviewIcs(interview, { company } = {}) {
  const start = parseSqliteUtc(interview?.scheduled_at);
  if (!start) return null;
  const end = new Date(start.getTime() + (Number(interview.duration_min) || 30) * 60000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Axal VC//Spin-Out Lab//EN', 'BEGIN:VEVENT',
    `UID:spinout-interview-${interview.id}@axal.vc`,
    `DTSTAMP:${icsStamp(start)}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(`Axal VC partner interview${company ? ` · ${company}` : ''}`)}`,
    ...(interview.location ? [`LOCATION:${icsText(interview.location)}`] : []),
    ...(interview.note ? [`DESCRIPTION:${icsText(interview.note)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function icsHref(ics) {
  return ics ? `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}` : null;
}
