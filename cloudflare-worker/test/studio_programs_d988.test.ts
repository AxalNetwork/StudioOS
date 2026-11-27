/**
 * D988 (#2779) — the studio's Programs tab repeats four facts the Worker owns,
 * because the tab draws them before it sends anything. This holds each copy
 * equal to its source, so a term, a kind or a limit added on one side fails
 * here rather than drifting on the page.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/studio_programs_d988.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROGRAMS, TERM_FIELDS, termsFor as workerTermsFor } from '../src/services/programGrants.ts';
import { PROGRAM_REQUEST_KINDS, REQUEST_NOTE_MAX, TERM_VALUE_MAX } from '../src/services/escalationRequests.ts';
import { SLA_HOURS } from '../src/rpc/hqOps.ts';
import {
  ASKED_MAX, NOTE_MAX, PROGRAM_KINDS, TERM_APPLIES, TERM_LABEL, askableTerms, termsFor, answerSentence,
} from '../../frontend/src/lib/studioProgramTerms.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('every term the Worker carries applies to the same programs on the tab', () => {
  assert.deepEqual(Object.keys(TERM_APPLIES), TERM_FIELDS.map((f) => f.key), 'the same terms, in the same order');
  for (const f of TERM_FIELDS) assert.deepEqual([...TERM_APPLIES[f.key]].sort(), [...f.applies].sort(), f.key);
  for (const p of PROGRAMS) assert.deepEqual(termsFor(p.key), workerTermsFor(p.key), p.key);
  for (const p of PROGRAMS) assert.ok(askableTerms(p.key).every((t) => workerTermsFor(p.key).includes(t)), `${p.key}: a change names a term the Worker accepts`);
});

test('each term is named as the program schedule names it', () => {
  const src = readFileSync(resolve(HERE, '../src/services/programSchedule.ts'), 'utf8');
  const block = src.slice(src.indexOf('const LABELS'), src.indexOf('};', src.indexOf('const LABELS')));
  for (const f of TERM_FIELDS) {
    const m = new RegExp(`\\b${f.key}: (['"])(.+?)\\1`).exec(block);
    assert.ok(m, `the schedule names ${f.key}`);
    // The tab sets the apostrophe; the schedule is plain text.
    assert.equal(TERM_LABEL[f.key].replace('’', "'"), m[2].replace(/\\'/g, "'").replace('this schedule', 'the schedule'), f.key);
  }
});

test('the program request kinds, the note and asked limits, and the response time are the Worker\'s', () => {
  assert.deepEqual(PROGRAM_KINDS, [...PROGRAM_REQUEST_KINDS]);
  assert.equal(NOTE_MAX, REQUEST_NOTE_MAX);
  assert.equal(ASKED_MAX, TERM_VALUE_MAX);
  for (const k of PROGRAM_KINDS) assert.equal(answerSentence(k, SLA_HOURS), 'HQ answers within 3 days. You will see the answer here and under Requests.', k);
});

test('the studio read answers every standing the tab draws', () => {
  const src = readFileSync(resolve(HERE, '../src/services/licencePrograms.ts'), 'utf8');
  const standings = /export type Standing = ([^;]+);/.exec(src)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  const tab = readFileSync(resolve(HERE, '../../frontend/src/lib/studioPrograms.js'), 'utf8');
  for (const s of ['in_force', 'granted', 'paused', 'ended', 'not_recorded']) {
    assert.ok(standings.includes(s), s);
    assert.ok(tab.includes(`'${s}'`), `the tab reads ${s}`);
  }
});
