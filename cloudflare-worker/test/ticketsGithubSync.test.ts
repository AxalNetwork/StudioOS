// Task #9 — ticket ↔ GitHub Issues sync: pure mapping + validation logic.
//
// Pins the bidirectional label mapping (type/priority/category), the
// status-mapping matrix (both directions), the loop-prevention source
// marker, and the inline payload validators. Pure node:test — runs under
// `npm run test:drift` via the --experimental-strip-types list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelsForTicket,
  parseLabelsFromGithub,
  mapGithubStatusToLocal,
  mapLocalStatusToGithub,
  syncMarker,
  hasSyncMarker,
  validateTicketCreate,
  validateTicketUpdate,
  validateComment,
  assigneeLoginFor,
} from '../src/services/githubSync.ts';

/* ---------------- label mapping: platform → GitHub ---------------- */

test('labelsForTicket: full mapping with categories', () => {
  assert.deepEqual(
    labelsForTicket({ type: 'bug', priority: 'urgent', categories: ['audit', 'tracking'] }),
    ['support-ticket', 'bug', 'priority:urgent', 'audit', 'tracking'],
  );
});

test('labelsForTicket: defaults + unknown values dropped', () => {
  assert.deepEqual(labelsForTicket({}), ['support-ticket', 'task', 'priority:medium']);
  assert.deepEqual(
    labelsForTicket({ type: 'chore', priority: 'asap', categories: ['random'] }),
    ['support-ticket'],
  );
});

/* ---------------- label mapping: GitHub → platform ---------------- */

test('parseLabelsFromGithub: objects, priority + type + categories', () => {
  const parsed = parseLabelsFromGithub([
    { name: 'priority:high' }, { name: 'feature' }, { name: 'beta-readiness' }, { name: 'unrelated' },
  ]);
  assert.equal(parsed.priority, 'high');
  assert.equal(parsed.type, 'feature');
  assert.deepEqual(parsed.categories, ['beta-readiness']);
  assert.deepEqual(parsed.names, ['priority:high', 'feature', 'beta-readiness', 'unrelated']);
});

test('parseLabelsFromGithub: legacy "priority: x" spelling + strings + empty', () => {
  assert.equal(parseLabelsFromGithub([{ name: 'priority: low' }]).priority, 'low');
  assert.equal(parseLabelsFromGithub(['BUG']).type, 'bug');
  assert.deepEqual(parseLabelsFromGithub(null), { priority: null, type: null, categories: [], names: [] });
});

/* ---------------- status mapping matrix ---------------- */

test('mapGithubStatusToLocal: closed/completed → resolved; not_planned → closed; open → open', () => {
  assert.equal(mapGithubStatusToLocal('closed', 'completed'), 'resolved');
  assert.equal(mapGithubStatusToLocal('closed', null), 'resolved');
  assert.equal(mapGithubStatusToLocal('closed', 'not_planned'), 'closed');
  assert.equal(mapGithubStatusToLocal('open'), 'open');
});

test('mapLocalStatusToGithub: full matrix', () => {
  assert.deepEqual(mapLocalStatusToGithub('resolved'), { state: 'closed', state_reason: 'completed' });
  assert.deepEqual(mapLocalStatusToGithub('closed'), { state: 'closed', state_reason: 'not_planned' });
  assert.deepEqual(mapLocalStatusToGithub('open'), { state: 'open', state_reason: null });
  assert.deepEqual(mapLocalStatusToGithub('in_progress'), { state: 'open', state_reason: null });
});

test('status round-trip is stable for resolved/closed', () => {
  for (const local of ['resolved', 'closed']) {
    const gh = mapLocalStatusToGithub(local);
    assert.equal(mapGithubStatusToLocal(gh.state, gh.state_reason), local);
  }
});

/* ---------------- loop-prevention source marker ---------------- */

test('syncMarker/hasSyncMarker: marker embedded anywhere in a body is detected', () => {
  const body = `hello\n\n${syncMarker(42)}`;
  assert.ok(hasSyncMarker(body));
  assert.ok(body.includes('<!-- axal-sync:ticket-42 -->'));
  assert.equal(hasSyncMarker('a human comment'), false);
  assert.equal(hasSyncMarker(null), false);
  assert.equal(hasSyncMarker(undefined), false);
});

/* ---------------- inline validators ---------------- */

test('validateTicketCreate: happy path normalizes + defaults', () => {
  const r = validateTicketCreate({ title: '  Broken page  ', priority: 'HIGH', type: 'Bug' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.title, 'Broken page');
    assert.equal(r.value.priority, 'high');
    assert.equal(r.value.type, 'bug');
    assert.equal(r.value.description, null);
  }
});

test('validateTicketCreate: rejects bad title/priority/type', () => {
  assert.equal(validateTicketCreate(null).ok, false);
  assert.equal(validateTicketCreate({ title: '' }).ok, false);
  assert.equal(validateTicketCreate({ title: 'x'.repeat(201) }).ok, false);
  assert.equal(validateTicketCreate({ title: 'ok', priority: 'asap' }).ok, false);
  assert.equal(validateTicketCreate({ title: 'ok', type: 'chore' }).ok, false);
});

test('validateTicketUpdate: field-wise validation, rejects empty patch', () => {
  assert.equal(validateTicketUpdate({}).ok, false);
  assert.equal(validateTicketUpdate({ status: 'nope' }).ok, false);
  assert.equal(validateTicketUpdate({ priority: 'sometime' }).ok, false);
  const r = validateTicketUpdate({ status: 'resolved', type: 'feature' });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { status: 'resolved', type: 'feature' });
});

test('validateComment: trims and bounds', () => {
  assert.equal(validateComment({ body: '   ' }).ok, false);
  assert.equal(validateComment({ body: 'x'.repeat(20001) }).ok, false);
  const r = validateComment({ body: ' hi ' });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.body, 'hi');
});

/* ---------------- assignee mapping ---------------- */

test('assigneeLoginFor: case-insensitive env JSON map, safe on garbage', () => {
  const env: any = { ADMIN_GITHUB_LOGINS: '{"Kim@Axal.vc":"kim-axal","Alex Doe":"alexdoe"}' };
  assert.equal(assigneeLoginFor(env, 'kim@axal.vc'), 'kim-axal');
  assert.equal(assigneeLoginFor(env, 'ALEX DOE '), 'alexdoe');
  assert.equal(assigneeLoginFor(env, 'unknown@x.com'), null);
  assert.equal(assigneeLoginFor({ ADMIN_GITHUB_LOGINS: 'not-json' } as any, 'kim@axal.vc'), null);
  assert.equal(assigneeLoginFor({} as any, 'kim@axal.vc'), null);
});
