/**
 * D4681 (#4681, Expertise P2) — services edited in place, deliberate proof
 * deletion, and real article states on the Thinking shelf.
 *
 * The zones are the real files, mounted with only `lib/api` replaced: every
 * other import (kit, toolbar, fill bar, router) is the one the page ships.
 * All fixtures are synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, sourceModule, textOf } from './_form_d695.mjs';
import {
  ARTICLE_STAGE_KEYS, PROOF_DELETE_FAILED, SERVICE_NOT_PUBLIC, articleStage, proofDeleteLines,
  revisionLine, serviceDraftOf, serviceEditBody,
} from '../src/pages/advisor/expertise/expertiseModel.js';

const src = (name) => readFileSync(new URL(`../src/pages/advisor/expertise/${name}`, import.meta.url), 'utf8');

/** The page with its `lib/api` import replaced by `globalThis.__api4681`. */
async function zone(name, apiImport, stubLine) {
  const page = src(name);
  assert.ok(page.includes(apiImport), `${name} imports ${apiImport}`);
  return sourceModule(page.replace(apiImport, stubLine), `pages/advisor/expertise/${name}`);
}

// ─────────────────────────────────────────────────────────── the model

test('every article state names who can read it and a next step on a real route', () => {
  // Mutation checked: approved+publish_at read as approved → no "Scheduled";
  // a published piece linked to the editor → the reader link check fails.
  const rows = [
    { id: 1, status: 'draft' }, { id: 2, status: 'submitted' }, { id: 3, status: 'in_review' },
    { id: 4, status: 'changes_requested' }, { id: 5, status: 'rejected' }, { id: 6, status: 'approved' },
    { id: 7, status: 'approved', publish_at: '2026-12-01T09:00:00Z' }, { id: 8, status: 'published', slug: 'a-synthetic-piece' },
  ];
  const stages = rows.map(articleStage);
  assert.deepEqual(stages.map((s) => s.key), ARTICLE_STAGE_KEYS);
  assert.deepEqual(stages.map((s) => s.label), ['Draft', 'Submitted', 'In review', 'Changes requested', 'Not accepted', 'Approved', 'Scheduled', 'Published']);
  for (const s of stages) {
    assert.ok(s.audience && s.audience.length > 10, `${s.key} says who can read it`);
    assert.ok(s.next.label, `${s.key} has a next step`);
  }
  for (const s of stages.slice(0, 7)) assert.match(s.next.to, /^\/articles\/edit\/\d+$/, `${s.key} opens the editor`);
  assert.equal(stages[7].next.to, '/articles/a-synthetic-piece');
  assert.match(stages[6].audience, /2026-12-01/);
  assert.match(stages[0].audience, /Only you/);
  assert.doesNotMatch(stages.slice(0, 7).map((s) => s.audience).join(' '), /Public/, 'nothing unpublished reads as public');
  assert.match(stages[7].audience, /^Public/);
  assert.equal(articleStage({ id: 9, status: 'published' }).next.to, '/articles/edit/9', 'no slug: the editor, never a dead reader link');
  assert.equal(articleStage({ id: 10, status: 'archived' }).key, 'unknown');
});

test('a service edit sends only what changed, and refuses a blank title or a malformed currency', () => {
  const row = { id: 3, title: 'Sprint', kind: 'fixed', price_cents: 500000, currency: 'USD', duration_note: null, scope: null, is_active: true };
  const draft = serviceDraftOf(row);
  assert.deepEqual(draft, { title: 'Sprint', kind: 'fixed', price: '5000', currency: 'USD', duration_note: '', scope: '', is_active: true });
  assert.deepEqual(serviceEditBody(row, draft, 500000), { body: {} }, 'nothing changed, nothing sent');
  assert.deepEqual(serviceEditBody(row, { ...draft, title: 'Design sprint', currency: 'eur', is_active: false }, 650000).body,
    { title: 'Design sprint', price_cents: 650000, currency: 'EUR', is_active: false });
  assert.deepEqual(serviceEditBody(row, { ...draft, title: '  ' }, 1), { error: 'A service needs a title.' });
  assert.ok(serviceEditBody(row, { ...draft, currency: 'dollars' }, 1).error);
  assert.deepEqual(serviceEditBody(row, draft, null).body, { price_cents: null }, 'a cleared price is sent as null, not 0');
});

test('a proof delete says what goes with it before it happens', () => {
  const item = { title: 'Led a synthetic rebuild', consents: [
    { attester_name: 'Sam Example', consent_given: true }, { attester_name: 'Kim Example', consent_given: false },
  ] };
  const lines = proofDeleteLines(item);
  assert.match(lines[0], /all 2 consent records/);
  assert.match(lines[0], /Sam Example, Kim Example/);
  assert.match(lines.join(' '), /link you sent stops working/);
  assert.match(lines.at(-1), /cannot be undone/);
  assert.match(proofDeleteLines({ title: 'x', consents: [] })[0], /nothing else goes with it/);
  assert.match(revisionLine({ rev: 4, created_at: '2026-11-02 10:00:00', saved_by_name: 'Synthetic Editor', status_at_save: 'in_review' }).line,
    /2026-11-02 · saved by Synthetic Editor · while in review/);
});

// ─────────────────────────────────────────────────────────── Services, mounted

const SERVICE = { id: 3, uid: 'svc-3', title: 'Sprint', kind: 'fixed', duration_note: null, price_cents: 500000, currency: 'USD', scope: null, is_active: true, units_sold: null };

test('Services edits a saved service in place: one PATCH, no delete and recreate', async () => {
  // Mutation checked: Save sending the whole draft → the PATCH carries kind and scope too;
  // Save routed through delete + create → the delete/create assertion fails.
  const calls = [];
  globalThis.__api4681 = { api: {
    async listMyAdvisorServices() { calls.push(['list']); return { items: [SERVICE] }; },
    async updateMyAdvisorService(id, body) { calls.push(['update', id, body]); return { ...SERVICE, ...body }; },
    async createMyAdvisorService(b) { calls.push(['create', b]); return {}; },
    async deleteMyAdvisorService(id) { calls.push(['delete', id]); return {}; },
  } };
  const mod = await zone('ServicesZone.jsx', "import { api } from '../../../lib/api';", 'const { api } = globalThis.__api4681;');
  const f = await mountForm(h(mod.default));
  try {
    await f.flush();
    assert.ok(f.text().includes(SERVICE_NOT_PUBLIC), 'says a service is not public and not bookable');
    assert.ok(!f.text().includes('Hidden'), 'no "Hidden" state that implies a public listing');
    await act(f.by('advisor-service-edit-3'));
    const form = f.by('advisor-service-form-3');
    assert.ok(form, 'the edit form opens on the row');
    await change(f, 'advisor-service-edit-title', 'Design sprint');
    await change(f, 'advisor-service-edit-price', '6500');
    await change(f, 'advisor-service-edit-currency', 'eur');
    await submitForm(f, 'advisor-service-form-3');
    await f.flush();
    const updates = calls.filter((c) => c[0] === 'update');
    assert.deepEqual(updates, [['update', 3, { title: 'Design sprint', price_cents: 650000, currency: 'EUR' }]]);
    assert.equal(calls.filter((c) => c[0] === 'delete' || c[0] === 'create').length, 0);
    assert.ok(f.text().includes('Service saved.'));
  } finally { await f.unmount(); delete globalThis.__api4681; }
});

// ─────────────────────────────────────────────────────────── Proof, mounted

const PROOF = { id: 8, uid: 'p-8', kind: 'engagement', title: 'Led a synthetic rebuild', detail: null, organization: 'Example Co', period_note: null,
  is_public: false, attested: true, status: 'attested', consents: [{ id: 1, attester_name: 'Sam Example', consent_given: true, state: 'confirmed', withdrawn_at: null, statement: 'Confirmed.' }] };

async function proofZone(deleteImpl) {
  const calls = [];
  globalThis.__api4681 = { api: {
    async listMyAdvisorProof() { calls.push(['list']); return { items: calls.some((c) => c[0] === 'deleted') ? [] : [PROOF] }; },
    async getMyAdvisor() { return { uid: 'adv-synthetic' }; },
    async deleteMyAdvisorProof(id) { calls.push(['delete', id]); const r = await deleteImpl(id); calls.push(['deleted']); return r; },
  } };
  const mod = await zone('ProofZone.jsx', "import { api } from '../../../lib/api';", 'const { api } = globalThis.__api4681;');
  const f = await mountForm(h(mod.default));
  await f.flush();
  return { f, calls };
}

test('Proof asks before deleting, and a confirmed delete reports what went with it', async () => {
  // Mutation checked: the trash button deleting at once → a delete call before the confirmation.
  const { f, calls } = await proofZone(async () => ({ ok: true, id: 8, consents_removed: 1 }));
  try {
    assert.ok(f.by('advisor-proof-not-public'), 'says nothing in Proof is public');
    await act(f.by('advisor-proof-delete-8'));
    assert.equal(calls.filter((c) => c[0] === 'delete').length, 0, 'the trash button only asks');
    const dialog = f.by('advisor-proof-confirm-8');
    assert.ok(dialog);
    assert.match(textOf(dialog), /the consent record behind it \(Sam Example\)/);
    assert.match(textOf(dialog), /cannot be undone/);
    await act(f.by('advisor-proof-keep-8'));
    assert.ok(!f.by('advisor-proof-confirm-8'), 'Keep it closes the question');
    await act(f.by('advisor-proof-delete-8'));
    await act(f.by('advisor-proof-delete-confirm-8'));
    await f.flush();
    assert.deepEqual(calls.filter((c) => c[0] === 'delete'), [['delete', 8]]);
    assert.ok(f.text().includes('Deleted, with its consent record.'));
  } finally { await f.unmount(); delete globalThis.__api4681; }
});

test('a failed proof delete says nothing was deleted, and the claim is still drawn', async () => {
  const { f } = await proofZone(async () => { throw new Error('storage_error'); });
  try {
    await act(f.by('advisor-proof-delete-8'));
    await act(f.by('advisor-proof-delete-confirm-8'));
    await f.flush();
    assert.ok(f.text().includes(PROOF_DELETE_FAILED));
    assert.ok(f.text().includes('Led a synthetic rebuild'), 'the claim is still on the page');
    assert.ok(f.text().includes('Confirmed by Sam Example'), 'and still attested');
  } finally { await f.unmount(); delete globalThis.__api4681; }
});

// ─────────────────────────────────────────────────────────── Thinking, mounted

test('the Thinking shelf draws each piece in its own state, with who reads it, its next step and its history', async () => {
  // Mutation checked: every unpublished piece drawn as "Draft" → the stage list fails;
  // History reading another piece's id → the revisions call fails.
  const revisionsAsked = [];
  globalThis.__api4681 = {
    api: { async listMyAdvisorThinking() {
      return { items: [
        { id: 21, title: 'Synthetic draft', status: 'draft' },
        { id: 22, title: 'Synthetic sent back', status: 'changes_requested' },
        { id: 23, title: 'Synthetic scheduled', status: 'approved', publish_at: '2026-12-01T09:00:00Z' },
        { id: 24, title: 'Synthetic live', status: 'published', slug: 'synthetic-live', views: 3 },
      ], counts: { published: 1, drafts: 3, best_reach: 3, talk_reach: null } };
    } },
    articles: { async revisions(id) { revisionsAsked.push(id); return { revisions: [{ rev: 2, created_at: '2026-11-01 08:00:00', saved_by_name: 'Synthetic Writer', status_at_save: 'draft' }] }; } },
  };
  const mod = await zone('ThinkingZone.jsx', "import { api, articles as articlesApi } from '../../../lib/api';",
    'const { api, articles: articlesApi } = globalThis.__api4681;');
  const f = await mountForm(h(mod.default));
  try {
    await f.flush();
    assert.deepEqual([21, 22, 23, 24].map((id) => f.props(f.by(`advisor-thinking-${id}`))['data-stage']), ['draft', 'changes_requested', 'scheduled', 'published']);
    assert.match(textOf(f.by('advisor-thinking-audience-23')), /goes public on 2026-12-01/);
    assert.match(textOf(f.by('advisor-thinking-audience-21')), /Only you/);
    assert.equal(textOf(f.by('advisor-thinking-next-22')), 'Make the changes');
    assert.equal(f.props(f.by('advisor-thinking-next-22')).href, '/articles/edit/22');
    assert.equal(f.props(f.by('advisor-thinking-next-24')).href, '/articles/synthetic-live');
    await act(f.by('advisor-thinking-history-toggle-22'));
    await f.flush();
    assert.deepEqual(revisionsAsked, [22]);
    assert.match(textOf(f.by('advisor-thinking-history-22')), /Revision 2 · 2026-11-01 · saved by Synthetic Writer/);
  } finally { await f.unmount(); delete globalThis.__api4681; }
});

// ─────────────────────────────────────────────────────────── helpers

async function act(node) {
  assert.ok(node, 'control exists');
  const { act: reactAct } = await import('react');
  const props = Object.entries(node).find(([k]) => k.startsWith('__reactProps$'))[1];
  await reactAct(async () => props.onClick?.({ preventDefault() {}, stopPropagation() {} }));
}
async function change(f, testId, value) {
  const node = f.by(testId);
  assert.ok(node, testId);
  const { act: reactAct } = await import('react');
  await reactAct(async () => f.props(node).onChange({ target: { value } }));
}
async function submitForm(f, testId) {
  const { act: reactAct } = await import('react');
  await reactAct(async () => f.props(f.by(testId)).onSubmit({ preventDefault() {} }));
}
