/**
 * D384 — the Spin-Out Lab Apply wizard and status screen, against the Apply &
 * Status canvas (design/canvases/out-of-scope/Apply and Status.dc.html) and
 * the `/state` `applicant` block D383 added.
 *
 * The screens are RENDERED (react-dom/server) from applicant records shaped as
 * the worker returns them, so these assert on what a founder reads: a stage
 * the timeline marks is the stage the sentence names, no date the store does
 * not hold, the admin's note and never an internal reason, and a withdraw that
 * says it deletes.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_apply_status_d384.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  ORIGIN_OPTIONS, TTO_OPTIONS, IP_OPTIONS, missingAnswers, missingOnStep, emptyAnswers, emptyBasics,
  timelineFor, statusLede, phaseOf, consequenceFor, interviewIcs, draftBody, fromDraft, answersPayload,
} from '../src/lib/applicationLifecycle.js';
import { ApplicationStatusScreen } from '../src/components/spinout/ApplicationStatus.jsx';
import { ApplyStep } from '../src/pages/SpinoutLabApplyPage.jsx';
import ApplicantDetail, { answerRows } from '../src/pages/admin/AdminApplicantDetail.jsx';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const WORKER = read('../../cloudflare-worker/src/services/applicationLifecycle.ts');
const PAGE = read('../src/pages/SpinoutLabApplyPage.jsx');
const ADMIN = read('../src/pages/admin/AdminCohortApplications.jsx');
const CANVAS = read('../../design/canvases/out-of-scope/Apply and Status.dc.html');

const BASE = {
  application_id: 42, status: 'pending', submitted_at: '2026-08-12 07:41:00', decided_at: null, withdrawn_at: null,
  answers: null, answers_recorded: true,
  pool: { status: 'pending', decided_at: null, cycle: { label: 'October 2026', app_status: 'open', start_at: '2026-10-01 00:00:00', close_at: '2026-09-24 03:59:59' } },
  note: null, interview: null, reapply: null,
};
const INTERVIEW = {
  id: 7, scheduled_at: '2026-09-02 12:00:00', duration_min: 45, location: 'Video, link by email', note: 'Bring the licence timeline.',
  status: 'scheduled', reschedule_requested_at: null,
};
const noop = () => {};
const screen = (applicant, extra = {}) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(ApplicationStatusScreen, { applicant, company: 'Meridian Robotics', onWithdraw: noop, onReschedule: noop, onApplyAgain: noop, ...extra })));
const text = (a, extra) => renderedText(screen(a, extra));

// ---------------------------------------------------------------------------
// The answers: one set of rules, two copies.
// ---------------------------------------------------------------------------

test('the canvas still draws what this page answers', () => {
  for (const el of ['Spin-out origin & IP', 'Tech-transfer status', 'IP assignment state', 'What your answer changes',
    'Your interview', 'Add to calendar', 'Reschedule', 'What we would want to see', 'Reapply window']) {
    assert.ok(CANVAS.includes(el), `the canvas no longer draws ${el}`);
  }
});

test('the client offers exactly the worker’s closed sets', () => {
  // Literal patterns, one per set: the worker file is read, never a pattern built from a name.
  const setOf = (re) => {
    const m = WORKER.match(re);
    assert.ok(m, `the worker no longer declares ${re}`);
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };
  const ORIGINS = setOf(/export const ORIGINS = \[([\s\S]*?)\] as const/);
  const TTO_STATUSES = setOf(/export const TTO_STATUSES = \[([\s\S]*?)\] as const/);
  const IP_FLAGS = setOf(/export const IP_FLAGS = \[([\s\S]*?)\] as const/);
  assert.deepEqual(ORIGIN_OPTIONS.map((o) => o.key), ORIGINS);
  assert.deepEqual(TTO_OPTIONS.map((o) => o.key), TTO_STATUSES);
  assert.deepEqual(IP_OPTIONS.map((o) => o.key), IP_FLAGS);
});

test('what a submission must carry matches the worker, case by case', () => {
  const a = { ...emptyAnswers(), origin: 'independent', team_size: '3', why_axal: 'Because' };
  assert.deepEqual(missingAnswers(a), [], 'an independent build was asked for a transfer office');
  assert.deepEqual(missingAnswers({ ...a, origin: 'university' }), ['tto_status', 'institution']);
  assert.deepEqual(missingAnswers({ ...a, origin: 'corporate', tto_status: 'not_applicable' }), []);
  assert.deepEqual(missingAnswers({ ...a, team_size: '0' }), ['team_size']);
  assert.deepEqual(missingAnswers({ ...a, team_size: '51' }), ['team_size']);
  assert.deepEqual(missingAnswers({ ...a, why_axal: '   ' }), ['why_axal']);
  // Traction never blocks, on its step or at submit.
  assert.deepEqual(missingOnStep(4, emptyBasics(), emptyAnswers()), []);
  assert.deepEqual(missingOnStep(1, emptyBasics(), emptyAnswers()), ['company', 'idea']);
});

test('an independent build never sends a transfer-office answer it was not shown', () => {
  const p = answersPayload({ ...emptyAnswers(), origin: 'independent', tto_status: 'signed', team_size: '4' });
  assert.equal(p.tto_status, null);
  assert.equal(p.team_size, 4);
});

test('a draft comes back as it was saved, basics, answers and step', () => {
  const basics = { ...emptyBasics(), company: 'Meridian' };
  const answers = { ...emptyAnswers(), origin: 'university', ip: ['patent_filed'] };
  const d = fromDraft({ answers: draftBody(basics, answers, 3), updated_at: '2026-08-12 07:00:00' });
  assert.equal(d.basics.company, 'Meridian');
  assert.deepEqual(d.answers.ip, ['patent_filed']);
  assert.equal(d.step, 3);
  assert.equal(fromDraft({ answers: { step: 9 } }).step, 1, 'a step outside the wizard was restored');
  assert.equal(fromDraft(null), null);
});

// ---------------------------------------------------------------------------
// The wizard.
// ---------------------------------------------------------------------------

const step = (n, answers) => renderToStaticMarkup(React.createElement(ApplyStep, {
  step: n, basics: emptyBasics(), answers: { ...emptyAnswers(), ...answers }, setBasics: noop, setAnswers: noop,
}));

test('step 2 asks for a transfer office only when there could be one', () => {
  assert.doesNotMatch(step(2, { origin: 'independent' }), /data-testid="tto-/);
  assert.match(step(2, { origin: 'university' }), /data-testid="tto-negotiating"/);
  assert.doesNotMatch(step(2, { origin: 'university' }), /tto-not_applicable/, 'a university was offered "no transfer office"');
  assert.match(step(2, { origin: 'corporate' }), /tto-not_applicable/);
});

test('the answer panel never promises a Week 1 the Lab does not build', () => {
  // THE PRODUCT CALL (D384): the canvas says a TTO answer re-sequences Week 1.
  // The Lab has one milestone list for every founder; nothing reads this.
  for (const origin of [null, 'university', 'corporate', 'independent']) {
    for (const tto of [null, ...TTO_OPTIONS.map((t) => t.key)]) {
      const c = consequenceFor({ origin, tto_status: tto });
      assert.doesNotMatch(`${c.text} ${c.foot}`, /your Week 1 gets|TTO checklist|filing waits|Roughly half/i);
    }
  }
  assert.match(consequenceFor({ origin: 'university' }).foot, /does not change them/);
  assert.match(PAGE, /What your answer is used for/);
});

test('the page submits the answers and no longer draws the retired confirmation', () => {
  const code = codeOnly(PAGE);
  assert.match(code, /answers: answersPayload\(answers\)/);
  assert.match(code, /<ApplicationStatusScreen/);
  const rendered = code;
  for (const gone of ['Application received', 'within 5 business days', 'A 30-minute call']) {
    assert.ok(!rendered.includes(gone), `the retired page promised "${gone}"`);
  }
  // The admin journey preview still drives both modes.
  assert.match(code, /previewMode === "submitted"/);
  assert.match(code, /onPreviewSubmitted\(\)/);
});

// ---------------------------------------------------------------------------
// The timeline: one record drives the marks and the sentence.
// ---------------------------------------------------------------------------

test('the stage the timeline rings is the stage the lede names', () => {
  for (const [a, name] of [[BASE, 'screening'], [{ ...BASE, interview: INTERVIEW }, 'partner interview']]) {
    const now = timelineFor(a).filter((s) => s.state === 'now');
    assert.equal(now.length, 1);
    assert.equal(now[0].name.toLowerCase(), name);
    const lede = statusLede(a);
    assert.ok(lede.includes(`at ${name}.`) || lede.includes(`at the ${name}.`), `the lede does not name ${name}`);
  }
});

test('no stage carries a date the store does not hold', () => {
  const t = timelineFor(BASE);
  assert.equal(t.find((s) => s.key === 'screening').date, null, 'screening was given an invented date');
  assert.equal(t.find((s) => s.key === 'decision').date, null, 'an undecided application was given a decision date');
  assert.equal(t.find((s) => s.key === 'submitted').date, '12 Aug 2026');
});

test('a declined or accepted application marks the decision done, and says if there was no interview', () => {
  const declined = { ...BASE, status: 'refused', decided_at: '2026-09-10 09:00:00' };
  assert.equal(phaseOf(declined), 'declined');
  const t = timelineFor(declined);
  assert.equal(t.find((s) => s.key === 'decision').state, 'done');
  assert.match(t.find((s) => s.key === 'decision').date, /^10 Sept? 2026$/);
  assert.match(t.find((s) => s.key === 'interview').note, /No interview is on record/);
  assert.equal(phaseOf({ ...BASE, pool: { ...BASE.pool, status: 'rejected' } }), 'declined');
  assert.equal(phaseOf({ ...BASE, pool: { ...BASE.pool, status: 'withdrawn' } }), 'withdrawn');
});

// ---------------------------------------------------------------------------
// The status screen.
// ---------------------------------------------------------------------------

test('the interview card names only what the row holds, and adds itself to a calendar', () => {
  const html = screen({ ...BASE, interview: INTERVIEW });
  const out = renderedText(html);
  assert.match(out, /45 minutes · Video, link by email/);
  assert.match(out, /Bring the licence timeline\./);
  assert.ok(!/Joris|Partner ·/.test(out), 'the card names an interviewer no row records');
  assert.match(html, /href="data:text\/calendar;charset=utf-8,BEGIN%3AVCALENDAR/);
  assert.match(html, /data-testid="interview-reschedule"/);
});

test('an asked-for move is stated, and the interview is not shown as moved', () => {
  const out = text({ ...BASE, interview: { ...INTERVIEW, reschedule_requested_at: '2026-08-30 10:00:00' } });
  assert.match(out, /You asked to move this on 30 Aug 2026\. It stays at this time until the team sends a new one\./);
});

test('the .ics is the interview’s own time and length, escaped', () => {
  const ics = interviewIcs({ ...INTERVIEW, location: 'Room 3, Delft; floor 2' }, { company: 'Meridian' });
  assert.match(ics, /DTSTART:20260902T120000Z/);
  assert.match(ics, /DTEND:20260902T124500Z/);
  assert.match(ics, /LOCATION:Room 3\\, Delft\\; floor 2/);
  assert.equal(interviewIcs({ ...INTERVIEW, scheduled_at: 'soon' }), null);
});

test('a declined applicant reads the note written for them, the asks, and when to reapply', () => {
  const declined = {
    ...BASE, status: 'refused', decided_at: '2026-09-10 09:00:00',
    note: { text: 'The commercial side is not there yet.', asks: ['Ten customer conversations.', 'A commercial co-founder.'], at: null },
    reapply: { label: 'November 2026', opens_at: '2026-09-25 04:00:00', closes_at: '2026-10-25 03:59:59' },
  };
  const html = screen(declined);
  const out = renderedText(html);
  assert.match(out, /The commercial side is not there yet\./);
  assert.match(out, /What we would want to see\s*Ten customer conversations\.\s*A commercial co-founder\./);
  assert.match(out, /November 2026 cohort · applications close 25 Oct 2026/);
  assert.match(html, /data-testid="apply-again"/);
  assert.doesNotMatch(html, /withdraw-start/, 'a decided application offered a withdraw');
});

test('a decline with no note says so rather than inventing a reason', () => {
  const out = text({ ...BASE, status: 'refused' });
  assert.match(out, /The team did not write a note for you with this decision/);
  assert.doesNotMatch(out, /turned down for space alone/);
});

test('an application in review can be withdrawn, and the page says what that deletes', () => {
  const html = screen(BASE);
  assert.match(html, /data-testid="withdraw-start"/);
  assert.match(PAGE, /spinoutLab\.withdrawApplication\(\)/);
  const out = text({ ...BASE, status: 'withdrawn', withdrawn_at: '2026-08-20 10:00:00' });
  assert.match(out, /Withdrawn 20 Aug 2026\. Your answers and your description of the venture were deleted\./);
});

test('an application from before the new form says its answers were never asked', () => {
  assert.match(text({ ...BASE, answers_recorded: false }), /made before the form asked about origin, team and traction/);
  assert.doesNotMatch(text(BASE), /made before the form asked/);
});

// ---------------------------------------------------------------------------
// The admin side.
// ---------------------------------------------------------------------------

const detail = (a) => renderToStaticMarkup(React.createElement(ApplicantDetail, {
  applicant: { id: 5, status: 'pending', ...a }, canDecide: true, busy: false,
  onSchedule: noop, onCancelInterview: noop, onDeclineWithNote: noop,
}));

test('the admin reads the answers in the applicant’s own words, and why any are absent', () => {
  assert.match(answerRows({ withdrawn_at: '2026-08-20 10:00:00' }).note, /deleted/);
  assert.match(answerRows({ answers_recorded: false }).note, /before the form asked/);
  const { rows } = answerRows({ answers_recorded: true, answers: { ...emptyAnswers(), origin: 'university', tto_status: 'negotiating', ip: ['patent_filed'], team_size: 3, commercial_lead: false } });
  const map = Object.fromEntries(rows);
  assert.equal(map.Origin, 'University spin-out');
  assert.equal(map['Tech-transfer status'], 'Licence under negotiation');
  assert.equal(map['Commercial lead'], 'Not yet');
  assert.equal(map.Traction, 'Not answered');
});

test('the decline form keeps the internal reason and the applicant’s note apart, by label', () => {
  const out = renderedText(detail({ answers_recorded: true, answers: emptyAnswers() }));
  assert.match(out, /Internal reason — required, audited, never shown to the applicant/);
  assert.match(out, /Note to the applicant — they read this on their status screen/);
  const withdrawn = detail({ withdrawn_at: '2026-08-20 10:00:00' });
  assert.doesNotMatch(withdrawn, /decline-form|interview-form/, 'a withdrawn applicant can be declined or interviewed');
});

test('a decision saved without its note is said to the admin', () => {
  const code = codeOnly(ADMIN);
  assert.match(code, /r\?\.applicant_note_saved === false/);
  assert.match(code, /api\.adminCohortScheduleInterview\(applicant\.id, payload\)/);
});
