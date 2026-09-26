/**
 * Lab Customer Discovery binds the evidence stores that already exist — D351.
 *
 * The page's header said severity was not stored and folded the company into
 * the role; both stores had existed since migration 211. It read `s.status`
 * off a DTO that names the field `crm_status`, so the third follow-up never
 * marked its milestone. And every read ended `.catch(() => [])`, so a failed
 * read drew "no interviews" — and a failed PROJECT read drew "Create your
 * startup record", inviting a founder with a company to make a second one.
 *
 * Properties pinned here:
 *   * Severity is need / nice / not judged — never a third stored band.
 *   * Company is its own column; legacy "Role · Company" rows still split.
 *   * A follow-up is counted from `followed_up_at`.
 *   * No read on the page resolves a failure to an empty value.
 *   * The severity control renders only where its value is written.
 *   * "Send to Problem slide" writes the deck override, never the canonical
 *     problem statement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  evidenceRead,
  interviewsOf,
  signupsOf,
  severitySplit,
  roleAndCompany,
  followUpsAfter,
  SEVERITY_OPTIONS,
} from '../src/lib/discoveryEvidence.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/SpinoutLabDiscoveryPage.jsx'));
const MODAL = codeOnly(raw('frontend/src/components/discovery/LogInterviewModal.jsx'));
const VALIDATE = codeOnly(raw('frontend/src/workspaces/founder/FounderValidateWorkspace.jsx'));
const PAIN_GROUPS = raw('cloudflare-worker/src/services/painGroups.ts');
const PROGRESS = raw('cloudflare-worker/src/routes/progress.ts');
const CANVAS = raw('design/canvases/out-of-scope/Customer Discovery.dc.html');

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------
test('severity splits a theme into need / nice / not judged, clamped to its mentions', () => {
  assert.deepEqual(severitySplit({ count: 5, need_count: 2, nice_count: 1 }, true),
    { mentions: 5, need: 2, nice: 1, unjudged: 2 });
  assert.deepEqual(severitySplit({ count: 2, need_count: 3, nice_count: 4 }, true),
    { mentions: 2, need: 2, nice: 0, unjudged: 0 }, 'need + nice can never exceed the interviews that mention it');
});

test('a project with no severity on file gets no split, not an all-unjudged one', () => {
  assert.equal(severitySplit({ count: 5, need_count: 0, nice_count: 0 }, false), null);
});

test('the store accepts need and nice only, and the form offers exactly those', () => {
  assert.match(PAIN_GROUPS, /export const PAIN_SEVERITIES = \['need', 'nice'\] as const;/);
  assert.deepEqual(SEVERITY_OPTIONS.map((o) => o.value), ['need', 'nice']);
  assert.doesNotMatch(MODAL, /value: 'good'/, 'a "good" severity would be refused by the Worker');
});

test('the canvas draws Good-to-have; the page names it Not recorded instead of drawing it', () => {
  const pains = CANVAS.slice(CANVAS.indexOf('Pain point validation'), CANVAS.indexOf('Pain point validation') + 2000);
  assert.match(pains, /● Good/);
  assert.match(PAGE, /Good-to-have: <Unrecorded reason=/);
  assert.match(PAGE, /severitySplit\(p, painData\?\.severity_recorded === true\)/);
});

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------
test('the company column wins; a legacy "Role · Company" row still splits', () => {
  assert.deepEqual(roleAndCompany({ interviewee_role: 'VP Ops', interviewee_company: 'Acme' }),
    { role: 'VP Ops', company: 'Acme', legacy: false });
  assert.deepEqual(roleAndCompany({ interviewee_role: 'VP Ops · Acme · EU', interviewee_company: null }),
    { role: 'VP Ops', company: 'Acme · EU', legacy: true });
  assert.deepEqual(roleAndCompany({ interviewee_role: 'Founder' }), { role: 'Founder', company: '', legacy: false });
});

test('the modal saves company to its own column and never folds it into the role', () => {
  assert.match(MODAL, /interviewee_company: company\.trim\(\) \|\| null,/);
  assert.match(MODAL, /interviewee_role: role\.trim\(\) \|\| null,/);
  assert.doesNotMatch(MODAL, /\.join\(' · '\)/);
  assert.match(PROGRESS, /const intervieweeCompany = asStringOrNull\(body\.interviewee_company\);/,
    'POST /progress/discovery no longer accepts interviewee_company');
});

// ---------------------------------------------------------------------------
// Follow-ups (crm_status)
// ---------------------------------------------------------------------------
test('follow-ups are counted from followed_up_at, including a lead later converted', () => {
  const signups = [
    { id: 1, crm_status: 'followed_up', followed_up_at: '2026-09-01' },
    { id: 2, crm_status: 'promoted', followed_up_at: '2026-09-02' },
    { id: 3, crm_status: 'invited', followed_up_at: null },
    { id: 4, crm_status: 'followed_up', followed_up_at: '2026-09-03' },
  ];
  assert.equal(followUpsAfter(signups, 4), 3, 'two earlier follow-ups plus the one just sent');
});

test('the page counts through followUpsAfter and never reads s.status', () => {
  assert.match(PAGE, /const followed = followUpsAfter\(signups, signup\.id\);/);
  assert.doesNotMatch(PAGE, /\bs\.status\b/);
  assert.match(PROGRESS, /followed_up_at: r\.followed_up_at,/, 'the waitlist DTO no longer carries followed_up_at');
});

// ---------------------------------------------------------------------------
// Reads — failure is never an empty value
// ---------------------------------------------------------------------------
test('evidenceRead classifies and never throws', async () => {
  assert.deepEqual(await evidenceRead(Promise.resolve([1])), { ok: true, data: [1] });
  const f = await evidenceRead(Promise.reject(Object.assign(new Error('x'), { status: 500 })));
  assert.equal(f.failed, true);
  assert.equal(interviewsOf(f), null);
  assert.equal(signupsOf(f), null);
  assert.deepEqual(interviewsOf({ ok: true, data: { interviews: [{ id: 1 }] } }), [{ id: 1 }]);
});

test('no read on the page turns a failure into an empty list', () => {
  assert.doesNotMatch(PAGE, /\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(PAGE, /\.catch\(\(\) => \(\{ signups: \[\] \}\)\)/);
  for (const call of ['api.listInterviews(pid)', 'api.listWaitlistCustomers(pid)', 'api.painGroups(pid)', 'api.listProjects()']) {
    assert.ok(PAGE.includes(`evidenceRead(${call})`), `${call} is not classified`);
  }
});

test('a failed project read is Unreadable — it is checked before "no project"', () => {
  const i = PAGE.indexOf('{projectsFailed ? (');
  const j = PAGE.indexOf('Create your startup record first');
  assert.ok(i > 0 && j > i, 'the project-read failure must be decided before the create-a-record prompt');
  assert.match(PAGE.slice(i, j), /<Unreadable/);
});

test('each interview-derived card checks the failed read first', () => {
  const n = (PAGE.match(/failed\.interviews \?/g) || []).length;
  assert.ok(n >= 6, `only ${n} cards guard the interview read (KPIs, log, ICP summary, hypotheses, definition, …)`);
  assert.match(PAGE, /failed\.waitlist \? \(\s*<Unreadable what="Your inbound leads"/);
  assert.match(PAGE, /failed\.pains \? \(\s*<Unreadable what="Your pain groups"/);
});

// ---------------------------------------------------------------------------
// Severity control renders only where it is written
// ---------------------------------------------------------------------------
test('severity controls are behind a prop the Lab page passes and Validate does not', () => {
  assert.match(MODAL, /\{severityControls && pains\.length > 0 && \(/);
  assert.match(MODAL, /\}, severityControls \? judged : undefined\);/);
  assert.match(PAGE, /onSave=\{saveInterview\}\s+severityControls\s*\/>/);
  assert.doesNotMatch(VALIDATE, /severityControls/,
    'Validate\'s saveInterview ignores a second argument — the control would discard the judgement');
  assert.match(PAGE, /await api\.setInterviewPainSeverity\(interviewId, phrase, sev\);/);
});

// ---------------------------------------------------------------------------
// Problem slide, exports, recordings
// ---------------------------------------------------------------------------
test('Send to Problem slide writes the deck override, never the canonical field', () => {
  assert.ok(CANVAS.includes('Send to Problem slide'));
  assert.match(PAGE, /api\.saveSpinoutDeckOverrides\(project\.id, \{ 'problem\.title': title \}\)/);
  assert.doesNotMatch(PAGE, /problem_statement|updateProject\(/);
});

test('the export actions are the Worker CSV routes', () => {
  assert.ok(CANVAS.includes('Export discovery summary'));
  assert.match(PAGE, /api\.exportValidateSummary\(project\.id\)/);
  assert.match(PAGE, /api\.exportValidateInterviews\(project\.id\)/);
});

test('recordings attach here; transcription is linked to Validate, never run', () => {
  assert.match(PAGE, /api\.uploadInterviewRecording\(interview\.id, file, null\)/);
  assert.doesNotMatch(PAGE, /transcribeInterview/);
});

// ---------------------------------------------------------------------------
// Absences and fixtures
// ---------------------------------------------------------------------------
test('every canvas field with no store is named with a reason', () => {
  const block = PAGE.slice(PAGE.indexOf('const NOT_RECORDED_FIELDS = ['), PAGE.indexOf('];', PAGE.indexOf('const NOT_RECORDED_FIELDS = [')));
  for (const key of ['format', 'source', 'wtp', 'must-have', 'follow-up', 'icp-prescore', 'lead-triage']) {
    assert.match(block, new RegExp(`key: '${key}', label: '[^']+', reason: '[^']{12,}'`), `${key} has no reason`);
  }
});

test('none of the canvas’s interview fixtures is rendered', () => {
  for (const fixture of ['Async workflow gaps', 'Budget ceiling', 'Slack integration required']) {
    assert.ok(CANVAS.includes(fixture), `fixture ${fixture} left the canvas — re-aim this test`);
    assert.ok(!PAGE.includes(fixture), `the page renders the canvas fixture "${fixture}"`);
  }
});
