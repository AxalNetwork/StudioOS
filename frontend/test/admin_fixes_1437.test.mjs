/**
 * #1437 — the three admin fixes that are not about drawing a message:
 *   - Payments: picking another dispute starts its evidence empty, so one
 *     dispute's evidence is never submitted for another;
 *   - Advisors and partners: a save creates the profile once, resolves, and
 *     says so (it threw before, so the editor stayed open and a second Save
 *     made a duplicate);
 *   - LP applications: the note field says the applicant reads it, because the
 *     Worker returns `review_note` to them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickDispute, EMPTY_EVIDENCE } from '../src/pages/AdminPage.jsx';
import { saveProfileForm, listState } from '../src/pages/admin/AdminNetworkProfiles.jsx';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('picking another dispute starts its evidence empty; reselecting the same one keeps the draft', () => {
  const a = { id: 'dp_a' };
  const b = { id: 'dp_b' };
  const drafted = { ...EMPTY_EVIDENCE, uncategorized_text: 'Shipped on 3 March', receipt: 'rcpt_1' };

  const other = pickDispute(a, drafted, b);
  assert.equal(other.selDispute, b);
  assert.deepEqual(other.evidence, EMPTY_EVIDENCE);
  assert.notEqual(other.evidence, EMPTY_EVIDENCE, 'a fresh object, not the frozen template');

  const same = pickDispute(a, drafted, { id: 'dp_a' });
  assert.equal(same.selDispute, a);
  assert.equal(same.evidence, drafted);

  const first = pickDispute(null, drafted, a);
  assert.equal(first.selDispute, a);
  assert.deepEqual(first.evidence, EMPTY_EVIDENCE);
});

test('the dispute list sets the selection and the evidence together, through pickDispute', () => {
  const code = codeOnly(read('../src/pages/AdminPage.jsx'));
  assert.match(code, /const n = pickDispute\(selDispute, evidence, d\); setSelDispute\(n\.selDispute\); setEvidence\(n\.evidence\);/);
  assert.doesNotMatch(code, /onClick=\{\(\) => setSelDispute\(d\)\}/);
});

test('saving a new profile creates it once, resolves, and reports it', async () => {
  const calls = [];
  const said = [];
  const client = {
    create: async (p) => { calls.push(['create', p]); return { id: 7 }; },
    update: async (id, p) => { calls.push(['update', id, p]); return {}; },
  };
  const form = { name: 'Ada', kind: 'advisor', role: '', company: 'Lovelace Ltd', bio: '', linkedin_url: '', skills: ['ml'], is_active: 1 };
  await saveProfileForm({ client, editing: {}, form, notify: { success: (m) => said.push(m) } });
  assert.deepEqual(calls, [['create', {
    name: 'Ada', kind: 'advisor', role: null, company: 'Lovelace Ltd', bio: null, linkedin_url: null, skills: ['ml'], is_active: true,
  }]]);
  assert.deepEqual(said, ['Profile created']);

  calls.length = 0; said.length = 0;
  await saveProfileForm({ client, editing: { id: 7 }, form: { ...form, is_active: 0 }, notify: { success: (m) => said.push(m) } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'update');
  assert.equal(calls[0][1], 7);
  assert.equal(calls[0][2].is_active, false);
  assert.deepEqual(said, ['Profile updated']);
});

test('a failed save rejects and reports nothing as saved', async () => {
  const said = [];
  const client = { create: async () => { throw new Error('name taken'); } };
  await assert.rejects(
    saveProfileForm({ client, editing: null, form: { name: 'x', kind: 'partner' }, notify: { success: (m) => said.push(m) } }),
    /name taken/,
  );
  assert.deepEqual(said, []);
});

test('a profile list that could not be read says so, never "No profiles yet"', () => {
  assert.equal(listState({ loading: true, loadError: '', profiles: [] }), 'loading');
  assert.equal(listState({ loading: false, loadError: 'HTTP 500', profiles: [] }), 'unreadable');
  assert.equal(listState({ loading: false, loadError: '', profiles: [] }), 'empty');
  assert.equal(listState({ loading: false, loadError: '', profiles: [{ id: 1 }] }), 'list');
  const code = codeOnly(read('../src/pages/admin/AdminNetworkProfiles.jsx'));
  assert.match(code, /data-testid="profiles-unreadable"/);
});

test('the LP review note says the applicant reads it, because the Worker returns it to them', () => {
  const worker = read('../../cloudflare-worker/src/services/lpApplications.ts');
  assert.match(worker, /export function presentLpApplication[\s\S]*?review_note: row\.review_note \|\| ''/);
  const code = codeOnly(read('../src/pages/admin/AdminLpApplications.jsx'));
  assert.doesNotMatch(code, /Internal review note/);
  assert.match(code, /<span className=\{LBL\}>Note to the applicant<\/span>/);
  assert.match(code, /aria-describedby="lpapps-note-visible"/);
  assert.match(code, /<p id="lpapps-note-visible"[^>]*>\s*The applicant sees this note on their application\.\s*<\/p>/);
});
