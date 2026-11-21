/** D5582 part 3: real preview router, migrated D1, domain sources and the real lease object's transition. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import routes from '../src/routes/admin_workgraph_drafting.ts';
import { registerDraftedAsset, adoptCurrent } from '../src/services/workGraphDrafting.ts';
import { deckUnits, legalTemplateUnits, quoteUnits } from '../src/services/workGraphUnits.ts';
import { WorkGraphLease } from '../src/durable-objects/work-graph-lease.ts';
import type { Scope } from '../src/services/workGraphContracts.ts';

const SECRET = 'workgraph-drafting-route-fixture-secret-5582';
const SUPER = 900001, OTHER = 900002, COMPANY = 900010, PROJECT = 900020;
const scope: Scope = { tenantId: 900100, companyId: COMPANY, projectId: PROJECT };
const card = (uid: string, text: string) => ({ uid, title: uid, blocks: [{ id: 'body', kind: 'text', text }] });
const slides = [card('one', 'Old opening'), card('two', 'Old solution')];
const actor = { kind: 'person' as const, userId: SUPER };

function namespace() {
  const objects = new Map<string, WorkGraphLease>();
  return {
    idFromName: (name: string) => ({ name }),
    get: ({ name }: { name: string }) => ({ fetch: async (url: string, init: RequestInit) => {
      if (!objects.has(name)) {
        const saved = new Map();
        const storage = { get: async (key: string) => saved.get(key), put: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)); }, setAlarm: async () => {}, deleteAlarm: async () => {} };
        objects.set(name, new WorkGraphLease({ storage } as any, { WORK_GRAPH_LEASES: 'on' } as any));
      }
      return objects.get(name)!.fetch(new Request(url, init));
    } }),
  };
}

async function world(t: any, kind = 'pitch_deck') {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  t.after(() => db.close());
  loadSchema(db);
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(SUPER, 'admin', 'Preview operator', 'operator@example.test');
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(OTHER, 'admin', 'Other operator', 'other@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO company_profiles (id, uid, company_name) VALUES (?, ?, ?)').run(COMPANY, 'drafting-company', 'Drafting fixture');
  db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)').run('drafting-link', COMPANY, SUPER);
  db.prepare('INSERT INTO projects (id, name, company_id) VALUES (?, ?, ?)').run(PROJECT, 'Drafting fixture project', COMPANY);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'preview', WORK_GRAPH_DRAFTING: 'preview', WORK_GRAPH_LEASES: 'off', WORK_GRAPH_LEASE: namespace() };
  let doc;
  let assetScope = scope;
  if (kind === 'pitch_deck') {
    db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(900030, PROJECT, JSON.stringify(slides), 'Fixture deck');
    doc = deckUnits({ id: 900030, version: 1, slides });
  } else if (kind === 'legal_template') {
    assetScope = { ...scope, projectId: null };
    const body = '# 1. Opening\nOld opening\n# 2. Process\nOld process';
    db.prepare('INSERT INTO legal_templates (id, slug, title, body_md, version, category) VALUES (?, ?, ?, ?, 1, ?)').run(900040, 'workgraph-fixture', 'Fixture', body, 'compliance');
    db.prepare('INSERT INTO legal_template_versions (template_id, slug, version, title, category, body_md) VALUES (?, ?, 1, ?, ?, ?)').run(900040, 'workgraph-fixture', 'Fixture', 'compliance', body);
    doc = legalTemplateUnits({ template_id: 900040, version: 1, body_md: body });
  } else {
    assetScope = { ...scope, projectId: null };
    db.prepare('INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, company_id) VALUES (?, ?, 1, 1, 1, ?, ?)').run(900050, 'fixture-quote', 'Fixture', COMPANY);
    db.prepare('INSERT INTO quote_versions (id, quote_id, version, change_summary, note, price_cents) VALUES (?, ?, 1, ?, NULL, 100)').run(900051, 900050, 'Initial');
    doc = quoteUnits({ id: 900051, quote_id: 900050, version: 1, change_summary: 'Initial', note: null, price_cents: 100 });
  }
  const ctx = { scope: assetScope };
  const registered: any = await registerDraftedAsset(env, ctx, { scope: assetScope, kind: kind as any, accessClass: 'confidential', actor, idempotencyKey: 'route-asset' });
  assert.equal(registered.ok, true);
  const adopted: any = await adoptCurrent(env, ctx, { assetUid: registered.assetUid, expectedRevisionUid: null, current: doc, by: actor, idempotencyKey: 'route-head' });
  assert.equal(adopted.ok, true);
  const jti = grantWriteBar(db, SUPER);
  const token = (user = SUPER, session = jti) => new SignJWT({ user_id: user, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setJti(session).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const app = new Hono<any>();
  app.route('/api/admin/workgraph/drafting', routes);
  app.onError((err, c) => c.json({ detail: err.message }, 403));
  const call = async (suffix = '', body?: unknown, options: { who?: number; company?: number; token?: string; uid?: string } = {}) => {
    const response = await app.request(`/api/admin/workgraph/drafting/${options.uid ?? registered.assetUid}${suffix}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${options.token ?? await token(options.who)}`, 'Content-Type': 'application/json', 'X-Company-Id': String(options.company ?? COMPANY) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    return { status: response.status, body: await response.json() as any };
  };
  return { db, env, call, token, uid: registered.assetUid, head: adopted.revisionUid, doc };
}
const proposal = (head: string) => ({ headRevisionUid: head,
  ours: [card('one', 'Clear opening'), slides[1]], theirs: [slides[0], card('two', 'Clear solution')],
  contributors: { ours: 'research-run', theirs: 'writer-run' }, idempotencyKey: 'route-candidate' });

test('preview, flag, Super Admin, verified company and write bar are required before any draft write', async t => {
  const w = await world(t);
  assert.equal((await w.call()).status, 200);
  assert.equal((await w.call('', undefined, { who: OTHER })).status, 403);
  assert.equal((await w.call('', undefined, { company: COMPANY + 1 })).status, 404);
  assert.equal((await w.call('', undefined, { uid: 'not-found' })).status, 404);
  assert.equal((await w.call('/candidates', proposal(w.head), { token: await w.token(SUPER, 'no-factor') })).status, 403);
  for (const [environment, flag, branch] of [['production', 'preview', ''], ['preview', 'off', ''], ['preview', 'preview', 'fixture']] ) {
    Object.assign(w.env, { ENVIRONMENT: environment, WORK_GRAPH_DRAFTING: flag, BRANCH_CODE: branch });
    assert.equal((await w.call('/candidates', proposal(w.head))).status, 404);
  }
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get()?.n, 0);
});

test('separate slide changes reach one draft, shared edits conflict, and fabricated source or scope fields are refused', async t => {
  const w = await world(t);
  const b = proposal(w.head);
  const conflict = await w.call('/candidates', { ...b, theirs: [card('one', 'Different opening'), slides[1]] });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'merge_conflict');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get()?.n, 0);
  for (const field of ['base', 'actor', 'scope', 'target']) assert.equal((await w.call('/candidates', { ...b, [field]: {} })).status, 400);
  const created = await w.call('/candidates', b);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.ok(created.body.stored);
  const saved = w.db.prepare('SELECT slides FROM pitch_deck_proposals').get() as { slides: string };
  const cards = JSON.parse(saved.slides);
  assert.equal(cards[0].blocks[0].text, 'Clear opening');
  assert.equal(cards[1].blocks[0].text, 'Clear solution');
  assert.equal((await w.call('/candidates', b)).status, 200);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get()?.n, 1);
  assert.equal((await w.call('/candidates', { ...b, headRevisionUid: 'old-head' })).status, 409);
  w.db.prepare('UPDATE projects SET company_id = ? WHERE id = ?').run(COMPANY + 1, PROJECT);
  assert.equal((await w.call('/candidates', { ...b, idempotencyKey: 'foreign-domain' })).status, 409);
});

test('confirmation reads the current published row and requires the exact digest and original domain object', async t => {
  const w = await world(t);
  const created = await w.call('/candidates', proposal(w.head));
  assert.equal(created.status, 200);
  const saved = w.db.prepare('SELECT slides FROM pitch_deck_proposals').get() as { slides: string };
  // Simulate the native Keep result; confirmation never writes pitch_decks itself.
  w.db.exec('UPDATE pitch_decks SET is_current = 0 WHERE id = 900030');
  w.db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 2, ?, ?, 1)').run(900031, PROJECT, saved.slides, 'Kept fixture');
  const body = { headRevisionUid: w.head, approvedDigest: created.body.digest, publishedId: '900031', idempotencyKey: 'published' };
  assert.equal((await w.call('/confirm-publication', { ...body, approvedDigest: '0'.repeat(64) })).status, 409);
  assert.equal((await w.call('/confirm-publication', { ...body, publishedId: '900030' })).status, 409);
  const confirmed = await w.call('/confirm-publication', body);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const replay = await w.call('/confirm-publication', body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const head = w.db.prepare('SELECT head_revision_uid FROM work_graph_assets WHERE asset_uid = ?').get(w.uid)?.head_revision_uid;
  assert.notEqual(head, w.head);
  const source = w.db.prepare('SELECT source_id, source_locator FROM work_graph_revisions WHERE revision_uid = ?').get(head);
  assert.deepEqual({ ...source }, { source_id: '900031', source_locator: 'pitch_decks' });
  assert.ok(Number(w.db.prepare('SELECT COUNT(*) AS n FROM work_graph_events').get()?.n) > 0);
});

test('a domain save outside WorkGraph invalidates the base; quote plans create no quote version', async t => {
  const w = await world(t, 'offer');
  const content = { price_cents: 200, change_summary: 'Updated terms', note: 'For review' };
  const b = { headRevisionUid: w.head, ours: content, theirs: { price_cents: 100, change_summary: 'Initial', note: null }, contributors: { ours: 'terms', theirs: 'base' }, idempotencyKey: 'quote-plan' };
  const plan = await w.call('/candidates', b);
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.equal(plan.body.stored, null);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM quote_versions').get()?.n, 1);
  w.db.prepare('UPDATE quotes SET company_id = ? WHERE id = ?').run(COMPANY + 1, 900050);
  assert.equal((await w.call('/candidates', b)).status, 409);
});

test('counsel clause leases reserve independently and fence writes; a role or stale fence cannot grant publication', async t => {
  const w = await world(t, 'legal_template');
  const b = { headRevisionUid: w.head, ours: '# 1. Opening\nClear opening\n# 2. Process\nOld process', theirs: '# 1. Opening\nOld opening\n# 2. Process\nClear process', contributors: { ours: 'clause-a', theirs: 'clause-b' }, jurisdiction: 'Delaware', idempotencyKey: 'legal-candidate' };
  assert.equal((await w.call('/clauses/1/lease', { op: 'acquire', ttlMs: 60_000 })).status, 403);
  w.db.prepare('INSERT INTO counsel_members (user_id, granted_by) VALUES (?, ?)').run(SUPER, SUPER);
  w.env.WORK_GRAPH_LEASES = 'on';
  assert.equal((await w.call('/candidates', b)).body.error, 'clause_lease_required');
  const first = await w.call('/clauses/1/lease', { op: 'acquire', ttlMs: 60_000 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await w.call('/clauses/2/lease', { op: 'acquire', ttlMs: 60_000 });
  assert.equal(second.status, 200);
  assert.equal((await w.call('/clauses/1/lease', { op: 'acquire', ttlMs: 60_000 })).status, 409);
  assert.equal((await w.call('/clauses/new-clause/lease', { op: 'acquire', ttlMs: 60_000 })).status, 200);
  assert.equal((await w.call('/clauses/1/lease', { op: 'renew', fence: first.body.fence, ttlMs: 60_000 })).status, 200);
  const fences = { '1': first.body.fence, '2': second.body.fence };
  assert.equal((await w.call('/candidates', { ...b, fences })).status, 200);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM legal_template_research_drafts WHERE template_id = 900040').get()?.n, 1);
  assert.equal((await w.call('/clauses/1/lease', { op: 'release', fence: first.body.fence })).status, 200);
  const refused = await w.call('/candidates', { ...b, fences, idempotencyKey: 'expired-clause' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'clause_lease_required');
  assert.ok(Number(w.db.prepare('SELECT COUNT(*) AS n FROM work_graph_lease_events WHERE asset_id = ?').get(w.uid)?.n) > 0);
  assert.equal(w.db.prepare('SELECT version FROM legal_templates WHERE id = 900040').get()?.version, 1);
});


test('a saved legal version requires the actual template publication and an exact approval', async t => {
  const w = await world(t, 'legal_template');
  w.db.prepare('INSERT INTO counsel_members (user_id, granted_by) VALUES (?, ?)').run(SUPER, SUPER);
  const body = '# 1. Opening\nReviewed opening\n# 2. Process\nReviewed process';
  const { unitsDigest } = await import('../src/services/workGraphUnits.ts');
  const approvedDigest = await unitsDigest(legalTemplateUnits({ template_id: 900040, version: 2, body_md: body }).units);
  w.db.prepare('UPDATE legal_templates SET body_md = ?, version = 2 WHERE id = 900040').run(body);
  w.db.prepare('INSERT INTO legal_template_versions (template_id, slug, version, title, category, body_md) VALUES (?, ?, 2, ?, ?, ?)').run(900040, 'workgraph-fixture', 'Fixture', 'compliance', body);
  const input = { headRevisionUid: w.head, approvedDigest, publishedId: '2', idempotencyKey: 'published-legal' };
  assert.equal((await w.call('/confirm-publication', input)).status, 409, 'a saved draft is insufficient');
  w.db.prepare('INSERT INTO legal_template_publications (template_id, slug, version, title, category, body_md, published_at, published_by) VALUES (?, ?, 2, ?, ?, ?, ?, ?)')
    .run(900040, 'workgraph-fixture', 'Fixture', 'compliance', 'Different published body', new Date().toISOString(), SUPER);
  assert.equal((await w.call('/confirm-publication', input)).status, 409, 'publication bytes differ');
  w.db.prepare('UPDATE legal_template_publications SET body_md = ? WHERE template_id = 900040').run(body);
  assert.equal((await w.call('/confirm-publication', { ...input, approvedDigest: 'f'.repeat(64) })).status, 409);
  assert.equal((await w.call('/confirm-publication', input)).status, 200);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get()?.n, 0);
});

test('concurrent different candidates leave one deck proposal and make the other writer review it', async t => {
  const w = await world(t);
  const a = proposal(w.head);
  const b = { ...proposal(w.head), ours: [card('one', 'Alternative opening'), slides[1]], idempotencyKey: 'second-candidate' };
  const outcomes = await Promise.all([w.call('/candidates', a), w.call('/candidates', b)]);
  assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
  assert.equal(outcomes.find(result => result.status === 409)?.body.code, 'proposal_waiting');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_proposals').get()?.n, 1);
});
