// #4733 — the New skill sheet's four writes reach the Worker's mounted routes.
// `createSkill`, `updateSkill`, `publishSkill` and `importSkill` were `off()` stubs,
// so Save, Publish and Paste always said "AI agents aren't switched on yet.".
// Stubbed at fetch; the sheet's own flow is pinned through the adapter it calls.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/team_skill_writes_4733.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import * as adapter from '../src/pages/team/agentsAdapter.js';

function stub(handler) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const path = new URL(String(u), 'http://x').pathname;
    const method = (init.method || 'GET').toUpperCase();
    const sent = init.body ? JSON.parse(init.body) : null;
    seen.push({ method, path, sent });
    const { status = 200, body = {} } = handler({ method, path, sent }) || {};
    return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { seen, done: () => { globalThis.fetch = previous; restore(); } };
}

const sheetBody = {
  name: 'Quarterly pass', description: 'Reads the quarter.', steps: ['Read it'], tools: [], output_kind: 'brief', output_label: null,
  taxonomy: [{ skill_slug: 'fp_and_a', level: 'working' }],
};

test('createSkill posts the company skill to /teams/skills in the Worker\'s own shape', async () => {
  const s = stub(() => ({ status: 201, body: { skill: { uid: 'sk1', status: 'draft' } } }));
  try {
    const out = await adapter.createSkill('company', 'nw1', sheetBody);
    assert.deepEqual(out, { available: true, value: { skill: { uid: 'sk1', status: 'draft' } } });
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].method, 'POST');
    assert.equal(s.seen[0].path, '/api/teams/skills');
    assert.deepEqual(s.seen[0].sent, {
      scope: 'company', company: 'nw1', name: 'Quarterly pass', purpose: 'Reads the quarter.', steps: ['Read it'], tools: [],
      output_kind: 'brief', tags: [{ slug: 'fp_and_a', level: 'working' }],
    });
  } finally { s.done(); }
});

test('updateSkill patches and publishSkill publishes the mounted paths', async () => {
  const s = stub(() => ({ body: { skill: { uid: 'sk1' } } }));
  try {
    assert.equal((await adapter.updateSkill('sk1', { name: 'New name', taxonomy: [{ skill_slug: 'fp_and_a', level: 'expert' }] })).available, true);
    assert.equal((await adapter.publishSkill('sk1', {})).available, true);
    assert.deepEqual(s.seen.map((x) => `${x.method} ${x.path}`), ['PATCH /api/teams/skills/sk1', 'POST /api/teams/skills/sk1/publish']);
    assert.deepEqual(s.seen[0].sent, { name: 'New name', tags: [{ slug: 'fp_and_a', level: 'expert' }] });
  } finally { s.done(); }
});

test('importSkill is POST /teams/skills with skill_md, never an invented import route', async () => {
  const s = stub(() => ({ status: 201, body: { skill: { uid: 'sk2' } } }));
  try {
    const out = await adapter.importSkill('company', 'nw1', '---\nname: "X"\n---\n1. Do');
    assert.equal(out.available, true);
    assert.equal(s.seen[0].path, '/api/teams/skills');
    assert.deepEqual(s.seen[0].sent, { scope: 'company', company: 'nw1', skill_md: '---\nname: "X"\n---\n1. Do' });
  } finally { s.done(); }
});

test('a refusal is in the sheet\'s own words and never the Worker\'s message', async () => {
  const s = stub(() => ({ status: 409, body: { error: 'slug_taken', message: 'Worker text: SECRET-DETAIL' } }));
  try {
    const out = await adapter.createSkill('company', 'nw1', sheetBody);
    assert.equal(out.available, false);
    assert.equal(out.refused, true);
    assert.equal(out.code, 'slug_taken');
    assert.doesNotMatch(out.reason, /SECRET-DETAIL|Worker text/);
    assert.match(out.reason, /already exists/);
  } finally { s.done(); }
  const t = stub(() => ({ status: 403, body: { error: 'not_editor', message: 'LEAK' } }));
  try {
    const out = await adapter.publishSkill('sk1');
    assert.equal(out.refused, true);
    assert.doesNotMatch(out.reason, /LEAK/);
  } finally { t.done(); }
});

test('a project scope is refused honestly and sends nothing', async () => {
  const s = stub(() => ({ body: {} }));
  try {
    const out = await adapter.createSkill('project', '7', sheetBody);
    assert.equal(out.available, false);
    assert.equal(out.code, 'scope_invalid');
    assert.equal((await adapter.importSkill('project', '7', 'x')).available, false);
    assert.equal(s.seen.length, 0);
  } finally { s.done(); }
});
