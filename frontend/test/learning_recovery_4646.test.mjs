/**
 * #4646 — Learning is recoverable: unsent work, a pending video position, the first lesson in Continue learning and the
 * way back after sign-in.
 *
 * Pure: the draft store, the position writer with a store, the exam restore filter, the login redirect and the lesson
 * start write run against in-memory stand-ins. Everything is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_recovery_4646.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  DRAFT_MAX_CHARS, DRAFT_TTL_MS, clearDraft, draftKey, isBlankDraft, loadDraft, loadPosition, pendingPositions, positionKey, saveDraft, savePosition,
} from '../src/pages/learning/learningDrafts.js';
import * as drafts from '../src/pages/learning/learningDrafts.js';
import { positionStoreFor, queuedPositionWriter } from '../src/pages/learning/lessonPositionWriter.js';
import { restoredAnswers } from '../src/pages/learning/ExamFlow.jsx';
import { loginRedirectFor } from '../src/lib/pendingNext.js';

/** A Storage stand-in. */
function memory({ full = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
const src = (f) => codeOnly(readFileSync(path.resolve(import.meta.dirname, `../src/${f}`), 'utf8'));

test('a draft is kept for the learner, the content and the attempt, and for nobody else', () => {
  const store = memory();
  const mine = draftKey({ userId: 9001, kind: 'exam', uid: 'ex1', attempt: 'at1' });
  assert.ok(saveDraft(store, mine, { q1: ['a'] }));
  assert.deepEqual(loadDraft(store, mine).value, { q1: ['a'] });
  // Another learner, another attempt and another exam read nothing.
  for (const other of [{ userId: 9002, kind: 'exam', uid: 'ex1', attempt: 'at1' }, { userId: 9001, kind: 'exam', uid: 'ex1', attempt: 'at2' }, { userId: 9001, kind: 'exam', uid: 'ex2', attempt: 'at1' }]) {
    assert.equal(loadDraft(store, draftKey(other)), null, JSON.stringify(other));
  }
  // No learner or no content: no key, so nothing is ever kept under a shared one.
  assert.equal(draftKey({ userId: null, kind: 'exercise', uid: 'x' }), null);
  assert.equal(draftKey({ userId: 9001, kind: 'exercise', uid: '' }), null);
  assert.equal(saveDraft(store, null, 'x'), false);
});

test('a draft expires, a corrupt one reads as none, and a full or missing store never throws', () => {
  const store = memory();
  const key = draftKey({ userId: 9001, kind: 'exercise', uid: 'e1' });
  saveDraft(store, key, { text: 'hello' }, 1_000);
  assert.equal(loadDraft(store, key, 1_000 + DRAFT_TTL_MS - 1).value.text, 'hello');
  assert.equal(loadDraft(store, key, 1_000 + DRAFT_TTL_MS + 1), null, 'past its time');
  assert.equal(store.getItem(key), null, 'and removed');
  store.setItem(key, '{not json');
  assert.equal(loadDraft(store, key), null);
  store.setItem(key, JSON.stringify({ v: 2, at: 1, value: 'x' }));
  assert.equal(loadDraft(store, key), null, 'an unknown version');
  assert.equal(saveDraft(memory({ full: true }), key, 'x'), false, 'a refusing store says it did not save');
  assert.equal(saveDraft(null, key, 'x'), false);
  assert.equal(loadDraft(null, key), null);
  clearDraft(null, key);
  assert.equal(saveDraft(store, key, 'x'.repeat(DRAFT_MAX_CHARS)), false, 'too large to keep is refused, not cut');
});

test('a blank answer is not worth keeping', () => {
  for (const v of [null, undefined, '', '   ', [], [false], [null, ''], {}, { text: ' ' }, { checked: [] }]) assert.equal(isBlankDraft(v), true, JSON.stringify(v));
  for (const v of ['a', [0], { text: 'a' }, { checked: [0] }, { checked: [1] }]) assert.equal(isBlankDraft(v), false, JSON.stringify(v));
});

test('exam choices come back only where they still fit the attempt', () => {
  const questions = [
    { uid: 'q1', kind: 'single', options: [{ key: 'a', text: 'A' }, { key: 'b', text: 'B' }] },
    { uid: 'q2', kind: 'multiple', options: [{ key: 'a', text: 'A' }, { key: 'b', text: 'B' }, { key: 'c', text: 'C' }] },
  ];
  const saved = { q1: ['b', 'a'], q2: ['a', 'zzz', 'c'], q3: ['a'] };
  assert.deepEqual(restoredAnswers(saved, questions), { q1: ['b'], q2: ['a', 'c'] }, 'single keeps one; a stale option and a removed question are dropped');
  assert.deepEqual(restoredAnswers(null, questions), {});
  assert.deepEqual(restoredAnswers([], questions), {});
  assert.deepEqual(restoredAnswers({ q1: 'a' }, questions), {});
});

test('a pending video position outlives its player, is written on reconnect and removed once the server has it', async () => {
  const store = memory();
  const key = positionKey(9001, 'item1');
  const writes = [];
  let online = false;
  const make = () => queuedPositionWriter(async (s, p) => { writes.push([s, p]); }, { online: () => online, store: positionStoreFor(drafts, store, key) });
  const first = make();
  first.tick(42, 600); first.flush(65, 600);
  assert.deepEqual(writes, [], 'offline: nothing is sent');
  assert.equal(loadPosition(store, key).seconds, 65, 'the newest position is on the device');
  first.dispose(); // the player is gone: navigation, or the tab closing
  assert.equal(loadPosition(store, key).seconds, 65, 'disposal does not throw it away');
  // A browser restart later, the same item opens: the player finds it.
  online = true;
  const second = make();
  assert.equal(second.leftover().seconds, 65);
  assert.equal(second.reconnect(), true);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(writes[0][0], 65, 'it is written');
  assert.equal(loadPosition(store, key), null, 'and removed once written');
  second.dispose();
});

test('a position that fails to write stays on the device', async () => {
  const store = memory();
  const key = positionKey(9001, 'item2');
  let fail = true;
  let online = false;
  const w = queuedPositionWriter(async () => { if (fail) throw new Error('down'); }, { online: () => online, store: positionStoreFor(drafts, store, key) });
  w.flush(30, 100);
  online = true;
  w.reconnect();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(loadPosition(store, key)?.seconds, 30, 'not removed on a failed write');
  fail = false;
  w.reconnect();
  await new Promise((r) => setTimeout(r, 5));
  w.dispose();
});

test('pending positions are listed per learner, never another\'s', () => {
  const store = memory();
  savePosition(store, positionKey(9001, 'a'), 10, 100);
  savePosition(store, positionKey(9001, 'b'), 20, 100);
  savePosition(store, positionKey(9002, 'a'), 99, 100);
  assert.deepEqual(pendingPositions(store, 9001).map((p) => [p.itemUid, p.seconds]).sort(), [['a', 10], ['b', 20]]);
  assert.deepEqual(pendingPositions(store, 9002).map((p) => p.itemUid), ['a']);
  assert.deepEqual(pendingPositions(store, 9003), []);
  assert.equal(positionKey(null, 'a'), null);
});

test('the writer without a store behaves as before (D4478)', () => {
  const writes = [];
  let online = true;
  const w = queuedPositionWriter((s, p) => writes.push([s, p]), { online: () => online });
  online = false;
  w.flush(5, 50);
  online = true;
  assert.equal(w.reconnect(), true);
  w.dispose();
  assert.equal(w.leftover(), null);
});

test('a signed-out Learning link goes to sign-in carrying the exact destination, query included', () => {
  const to = loginRedirectFor({ pathname: '/learning/courses/intro/lessons/l1', search: '?t=120&ref=email', hash: '#notes' });
  assert.equal(to, `/login?next=${encodeURIComponent('/learning/courses/intro/lessons/l1?t=120&ref=email#notes')}`);
  assert.equal(new URL(to, 'http://x').searchParams.get('next'), '/learning/courses/intro/lessons/l1?t=120&ref=email#notes');
  assert.equal(loginRedirectFor({ pathname: '/learning', search: '', hash: '' }), `/login?next=${encodeURIComponent('/learning')}`);
  assert.equal(loginRedirectFor({ pathname: '/learning/webinars/w1', search: '?join=1' }), `/login?next=${encodeURIComponent('/learning/webinars/w1?join=1')}`);
});

test('every other area, and anything unsafe, goes to a bare /login as before', () => {
  assert.equal(loginRedirectFor({ pathname: '/studio', search: '', hash: '' }), '/login');
  assert.equal(loginRedirectFor({ pathname: '/learning-not-really', search: '' }), '/login', 'a prefix is a path segment, not a string');
  assert.equal(loginRedirectFor({ pathname: '/learning/' + 'x'.repeat(250), search: '' }), '/login', 'too long is refused');
  assert.equal(loginRedirectFor(undefined), '/login');
  assert.equal(loginRedirectFor({ pathname: '//evil.example/learning', search: '' }), '/login');
});

test('the route guard uses the redirect, and the sign-in page reads the destination for every method', () => {
  const app = src('App.jsx');
  assert.match(app, /<Navigate to=\{loginRedirectFor\(location\)\} state=\{\{ from: location \}\} replace \/>/);
  const login = src('pages/LoginPage.jsx');
  // The authenticator, Google and passkey paths each read the validated destination; the email link stores it first.
  const uses = login.match(/safeNextPath\(\)/g) || [];
  assert.ok(uses.length >= 5, `safeNextPath is read by the sign-in paths (${uses.length})`);
  assert.match(login, /storePendingNext\(safeNextPath\(\)\)/);
});

test('the first lesson is recorded as started, with its course, so Continue learning and the in-progress count see it', () => {
  const reads = src('pages/learning/learningReads.js');
  assert.match(reads, /export async function recordLessonStarted\(\{ courseUid, lessonUid \}\)/);
  assert.match(reads, /subject_kind: 'lesson', subject_uid: lessonUid, status: 'started'/);
  assert.match(reads, /subject_kind: 'course', subject_uid: courseUid, status: 'started'/);
  const wired = src('pages/learning/LearningWired.jsx');
  assert.match(wired, /recordLessonStarted\(\{ courseUid: course\.uid, lessonUid \}\)/);
  assert.match(wired, /!found\.lesson\.progress\?\.status/, 'a lesson that already has a status is not restarted');
});

test('the exercise and exam panels say where the work is, in the words the page uses', () => {
  assert.match(drafts.DRAFT_WORDS.saved, /on this device/i);
  assert.match(drafts.DRAFT_WORDS.restored, /from this device/i);
  assert.match(drafts.DRAFT_WORDS.failed, /Not saved/);
  assert.doesNotMatch(drafts.DRAFT_WORDS.saved, /submitted|sent to/i, 'saved never claims the server has it');
  const ex = src('pages/learning/ExercisePanel.jsx');
  assert.match(ex, /data-testid="exercise-draft-state"/);
  assert.match(ex, /saved\.clear\(\)/);
  const exam = src('pages/learning/ExamFlow.jsx');
  assert.match(exam, /useLearningDraft\(\{ kind: 'exam', uid: exam\?\.uid, attempt: attempt\?\.uid \}\)/);
  assert.match(exam, /data-testid="exam-draft-state"/);
  assert.doesNotMatch(exam, /so a resumed attempt starts with none chosen/);
});
