/** D5582 part 4: the preview drafting registry (bootstrap, re-adoption, frozen-export pinning) on migrated D1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { grantWriteBar } from './_write_bar_session.mjs';
import registry from '../src/routes/admin_workgraph_drafting_assets.ts';
import drafting from '../src/routes/admin_workgraph_drafting.ts';
import { WORK_GRAPH_DEPS } from '../src/services/workGraphRevisions.ts';
import { registerReleaseLine, releaseStatus } from '../src/services/workGraphReleases.ts';
import { registerDraftedAsset } from '../src/services/workGraphDrafting.ts';

const SECRET = 'workgraph-drafting-registry-fixture-secret-5582';
const SUPER = 910001, OTHER = 910002, PLAIN = 910003, COMPANY = 910010, FOREIGN = 910011, PROJECT = 910020, FOREIGN_PROJECT = 910021;
const TENANT = 910100;
const card = (uid: string, text: string) => ({ uid, title: uid, blocks: [{ id: 'body', kind: 'text', text }] });
const slides = [card('one', 'Opening'), card('two', 'Solution')];

let tick = Date.parse('2026-11-25T12:00:00.000Z');
WORK_GRAPH_DEPS.now = () => new Date(tick += 1000);

async function world(t: any) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  t.after(() => db.close());
  loadSchema(db);
  for (const [uid, name] of [[SUPER, 'Preview operator'], [OTHER, 'Second operator'], [PLAIN, 'Plain admin']] as const) {
    db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(uid, 'admin', name, `${uid}@example.test`);
  }
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(OTHER);
  for (const [cid, uid] of [[COMPANY, 'registry-company'], [FOREIGN, 'registry-foreign']] as const) {
    db.prepare('INSERT INTO company_profiles (id, uid, company_name) VALUES (?, ?, ?)').run(cid, uid, uid);
  }
  for (const user of [SUPER, OTHER, PLAIN]) db.prepare('INSERT INTO user_company_links (uid, company_id, user_id) VALUES (?, ?, ?)').run(`link-${user}`, COMPANY, user);
  db.prepare('INSERT INTO projects (id, name, company_id) VALUES (?, ?, ?)').run(PROJECT, 'Registry project', COMPANY);
  db.prepare('INSERT INTO projects (id, name, company_id) VALUES (?, ?, ?)').run(FOREIGN_PROJECT, 'Foreign project', FOREIGN);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(910030, PROJECT, JSON.stringify(slides), 'Registry deck');
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 1, ?, ?, 1)').run(910031, FOREIGN_PROJECT, JSON.stringify(slides), 'Foreign deck');
  const body = '# 1. Opening\nOpening clause\n# 2. Process\nProcess clause';
  db.prepare('INSERT INTO legal_templates (id, slug, title, body_md, version, category) VALUES (?, ?, ?, ?, 1, ?)').run(910040, 'registry-fixture', 'Fixture', body, 'compliance');
  db.prepare('INSERT INTO legal_template_versions (template_id, slug, version, title, category, body_md) VALUES (?, ?, 1, ?, ?, ?)').run(910040, 'registry-fixture', 'Fixture', 'compliance', body);
  db.prepare('INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, company_id) VALUES (?, ?, 1, 1, 1, ?, ?)').run(910050, 'registry-quote', 'Fixture', COMPANY);
  db.prepare('INSERT INTO quote_versions (id, quote_id, version, change_summary, note, price_cents) VALUES (?, ?, 1, ?, NULL, 100)').run(910051, 910050, 'Initial');
  db.prepare('INSERT INTO quote_versions (id, quote_id, version, change_summary, note, price_cents) VALUES (?, ?, 2, ?, NULL, 150)').run(910052, 910050, 'Second');
  db.prepare('INSERT INTO quotes (id, uid, need_id, partner_id, price, deliverables, company_id) VALUES (?, ?, 2, 2, 1, ?, ?)').run(910060, 'foreign-quote', 'Fixture', FOREIGN);
  db.prepare('INSERT INTO quote_versions (id, quote_id, version, change_summary, note, price_cents) VALUES (?, ?, 1, ?, NULL, 100)').run(910061, 910060, 'Foreign');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'preview', WORK_GRAPH_DRAFTING: 'preview', WORK_GRAPH_LEASES: 'off' };
  const bars = new Map([[SUPER, grantWriteBar(db, SUPER)], [OTHER, grantWriteBar(db, OTHER)], [PLAIN, grantWriteBar(db, PLAIN)]]);
  const token = (user: number, session = bars.get(user)!) => new SignJWT({ user_id: user, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setJti(session).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  // Both routers on their real prefixes, in registry order, so the two mounts are shown not to take each other's paths.
  const app = new Hono<any>();
  app.route('/api/admin/workgraph/drafting', drafting);
  app.route('/api/admin/workgraph/drafting-assets', registry);
  app.onError((err, c) => c.json({ detail: err.message }, 403));
  const call = async (path: string, body?: unknown, o: { who?: number; company?: number; session?: string } = {}) => {
    const who = o.who ?? SUPER;
    const response = await app.request(`/api/admin/workgraph/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await token(who, o.session ?? bars.get(who)!)}`, 'Content-Type': 'application/json',
        'X-Company-Id': String(o.company ?? COMPANY) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    return { status: response.status, body: await response.json() as any };
  };
  const count = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...(args as any[])) as any)?.n);
  return { db, env, call, count };
}
const deck = { tenantId: TENANT, kind: 'pitch_deck', sourceId: 910030 };

test('the registry is off by default, outside preview and on a branch, and needs a Super Admin, the write bar and a verified company', async t => {
  const w = await world(t);
  assert.equal((await w.call('drafting-assets')).status, 200);
  assert.equal((await w.call('drafting-assets', undefined, { who: PLAIN })).status, 403);
  assert.equal((await w.call('drafting-assets', deck, { who: PLAIN })).status, 403);
  assert.equal((await w.call('drafting-assets', deck, { session: 'no-factor' })).status, 403);
  assert.equal((await w.call('drafting-assets', deck, { company: FOREIGN })).status, 404);
  for (const [environment, flag, branch] of [['production', 'preview', ''], ['preview', undefined, ''], ['preview', 'on', ''], ['preview', 'preview', 'fixture']]) {
    Object.assign(w.env, { ENVIRONMENT: environment, WORK_GRAPH_DRAFTING: flag, BRANCH_CODE: branch });
    const off = await w.call('drafting-assets', deck);
    assert.equal(off.status, 404);
    assert.equal(off.body.error, 'drafting_unavailable');
  }
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_assets'), 0);
});

test('bootstrap registers one asset per deck under human publication and adopts the current row as its head', async t => {
  const w = await world(t);
  const first = await w.call('drafting-assets', deck);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.registered, true);
  assert.equal(first.body.adopted, true);
  assert.deepEqual(first.body.source, { locator: 'pitch_decks', id: '910030' });
  const row = w.db.prepare('SELECT approval_policy, project_id, tenant_id, company_id, head_revision_uid FROM work_graph_assets WHERE asset_uid = ?').get(first.body.assetUid) as any;
  assert.deepEqual({ ...row }, { approval_policy: 'human_publication', project_id: PROJECT, tenant_id: TENANT, company_id: COMPANY, head_revision_uid: first.body.headRevisionUid });
  assert.equal(w.count("SELECT COUNT(*) AS n FROM work_graph_events WHERE asset_uid = ? AND action = 'advance_head' AND actor_user_id = ?", first.body.assetUid, SUPER), 1);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'workgraph_drafting_bootstrap'"), 1);
  // A retry, and another Super Admin naming the same object, reach the same asset.
  const again = await w.call('drafting-assets', deck);
  assert.equal(again.status, 200);
  assert.deepEqual([again.body.assetUid, again.body.registered, again.body.adopted], [first.body.assetUid, false, false]);
  const other = await w.call('drafting-assets', { ...deck, accessClass: 'internal' }, { who: OTHER });
  assert.equal(other.status, 200);
  assert.equal(other.body.assetUid, first.body.assetUid);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_assets'), 1);
  // Part 3's drafting read takes it at once; the list names it; nothing in the domain changed.
  const read = await w.call(`drafting/${first.body.assetUid}`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.headRevisionUid, first.body.headRevisionUid);
  // Another company's drafting asset never appears in this company's list.
  const foreignScope = { tenantId: TENANT, companyId: FOREIGN, projectId: FOREIGN_PROJECT };
  assert.equal((await registerDraftedAsset(w.env, { scope: foreignScope }, { scope: foreignScope, kind: 'pitch_deck', accessClass: 'confidential',
    actor: { kind: 'person', userId: SUPER }, idempotencyKey: 'foreign-asset' }) as any).ok, true);
  const listed = await w.call('drafting-assets?kind=pitch_deck');
  assert.deepEqual(listed.body.assets.map((a: any) => a.asset_uid), [first.body.assetUid]);
  assert.equal((await w.call('drafting-assets?kind=legal_signed')).status, 400);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM pitch_decks'), 2);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM pitch_deck_proposals'), 0);
});

test('a foreign record, another tenant, a signed kind, a caller-named scope and a non-counsel template bootstrap are refused without a write', async t => {
  const w = await world(t);
  assert.equal((await w.call('drafting-assets', { ...deck, sourceId: 910031 })).status, 404);
  assert.equal((await w.call('drafting-assets', { tenantId: TENANT, kind: 'offer', sourceId: 910060 })).status, 404);
  assert.equal((await w.call('drafting-assets', { tenantId: TENANT, kind: 'legal_signed', sourceId: 1 })).status, 400);
  for (const field of ['companyId', 'projectId', 'actor', 'scope']) assert.equal((await w.call('drafting-assets', { ...deck, [field]: 1 })).status, 400);
  const template = await w.call('drafting-assets', { tenantId: TENANT, kind: 'legal_template', sourceId: 910040 });
  assert.equal(template.status, 403);
  assert.equal(template.body.error, 'counsel_required');
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_assets'), 0);
  assert.equal((await w.call('drafting-assets', deck)).status, 201);
  const elsewhere = await w.call('drafting-assets', { tenantId: TENANT + 1, kind: 'offer', sourceId: 910050 });
  assert.equal(elsewhere.status, 409);
  assert.equal(elsewhere.body.error, 'wrong_tenant');
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_assets'), 1);
});

test('an offer adopts its latest quote version and a counsel template its current version, writing neither', async t => {
  const w = await world(t);
  const offer = await w.call('drafting-assets', { tenantId: TENANT, kind: 'offer', sourceId: 910050 });
  assert.equal(offer.status, 201, JSON.stringify(offer.body));
  assert.deepEqual(offer.body.source, { locator: 'quote_versions', id: '910052' });
  w.db.prepare('INSERT INTO counsel_members (user_id, granted_by) VALUES (?, ?)').run(SUPER, SUPER);
  const template = await w.call('drafting-assets', { tenantId: TENANT, kind: 'legal_template', sourceId: 910040 });
  assert.equal(template.status, 201, JSON.stringify(template.body));
  assert.deepEqual(template.body.source, { locator: 'legal_template_versions', id: '910040:1' });
  const offers = await w.call('drafting-assets?kind=offer');
  assert.deepEqual(offers.body.assets.map((a: any) => a.asset_uid), [offer.body.assetUid]);
  assert.equal((await w.call('drafting-assets')).body.assets.length, 2);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM quote_versions'), 3);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM legal_template_versions'), 1);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM legal_template_research_drafts'), 0);
});

test('a domain save stales the head; a person re-adopts it once, and a stale head cannot adopt', async t => {
  const w = await world(t);
  const made = await w.call('drafting-assets', deck);
  const uid = made.body.assetUid, oldHead = made.body.headRevisionUid;
  const unchanged = await w.call(`drafting-assets/${uid}/adopt`, { headRevisionUid: oldHead, idempotencyKey: 'noop' });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.adopted, false);
  // The founder saves a new version through the deck's own writer.
  w.db.exec('UPDATE pitch_decks SET is_current = 0 WHERE id = 910030');
  w.db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 2, ?, ?, 1)').run(910032, PROJECT, JSON.stringify([card('one', 'Saved opening'), slides[1]]), 'Registry deck');
  assert.equal((await w.call(`drafting/${uid}`)).status, 409);
  assert.equal((await w.call(`drafting-assets/${uid}/adopt`, { headRevisionUid: 'not-the-head', idempotencyKey: 'stale' })).status, 409);
  assert.equal((await w.call(`drafting-assets/${uid}/adopt`, { headRevisionUid: oldHead, idempotencyKey: 'readopt' }, { company: FOREIGN })).status, 404);
  const adopted = await w.call(`drafting-assets/${uid}/adopt`, { headRevisionUid: oldHead, idempotencyKey: 'readopt' });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
  assert.equal(adopted.body.adopted, true);
  assert.equal(adopted.body.previousRevisionUid, oldHead);
  const source = w.db.prepare('SELECT r.source_id FROM work_graph_assets a JOIN work_graph_revisions r ON r.revision_uid = a.head_revision_uid WHERE a.asset_uid = ?').get(uid) as any;
  assert.equal(source.source_id, '910032');
  assert.equal((await w.call(`drafting/${uid}`)).status, 200);
  const late = await w.call(`drafting-assets/${uid}/adopt`, { headRevisionUid: oldHead, idempotencyKey: 'late' });
  assert.equal(late.status, 409);
  assert.equal(late.body.currentHead, adopted.body.headRevisionUid);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM work_graph_events WHERE asset_uid = ? AND action = 'advance_head' AND outcome = 'applied'", uid), 2);
});

test('freeze pins the exact approved head into a manifest; a later domain edit refuses it until re-adoption and stales the old export', async t => {
  const w = await world(t);
  const made = await w.call('drafting-assets', deck);
  const uid = made.body.assetUid, head = made.body.headRevisionUid, digest = made.body.digest;
  const line: any = await registerReleaseLine(w.env, { scope: { tenantId: TENANT, companyId: COMPANY, projectId: null } },
    { scope: { tenantId: TENANT, companyId: COMPANY, projectId: null }, audience: 'investors', actor: { kind: 'person', userId: SUPER }, idempotencyKey: 'line' });
  assert.equal(line.ok, true);
  const foreign: any = await registerReleaseLine(w.env, { scope: { tenantId: TENANT, companyId: FOREIGN, projectId: null } },
    { scope: { tenantId: TENANT, companyId: FOREIGN, projectId: null }, audience: 'investors', actor: { kind: 'person', userId: SUPER }, idempotencyKey: 'foreign-line' });
  const freeze = { headRevisionUid: head, approvedDigest: digest, lineAssetUid: line.lineAssetUid, role: 'deck', partial: false, idempotencyKey: 'freeze-1' };
  const wrongDigest = await w.call(`drafting-assets/${uid}/freeze`, { ...freeze, approvedDigest: 'a'.repeat(64) });
  assert.equal(wrongDigest.status, 409);
  assert.equal(wrongDigest.body.error, 'stale_approval');
  assert.equal((await w.call(`drafting-assets/${uid}/freeze`, { ...freeze, headRevisionUid: 'old' })).status, 409);
  const otherLine = await w.call(`drafting-assets/${uid}/freeze`, { ...freeze, lineAssetUid: foreign.lineAssetUid });
  assert.equal(otherLine.status, 404);
  assert.equal(otherLine.body.error, 'release_line_not_found');
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 0);

  const frozen = await w.call(`drafting-assets/${uid}/freeze`, freeze);
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));
  const body = JSON.parse((w.db.prepare('SELECT body_json FROM work_graph_release_manifests WHERE manifest_uid = ?').get(frozen.body.manifestUid) as any).body_json);
  assert.deepEqual(body.components.map((c: any) => [c.asset, c.revision, c.digest, c.source.id]), [[uid, head, digest, '910030']]);
  assert.equal((await w.call(`drafting-assets/${uid}/freeze`, freeze)).body.replayed, true);
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 1);

  w.db.exec('UPDATE pitch_decks SET is_current = 0 WHERE id = 910030');
  w.db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (?, ?, 2, ?, ?, 1)').run(910032, PROJECT, JSON.stringify([card('one', 'Edited opening'), slides[1]]), 'Registry deck');
  const edited = await w.call(`drafting-assets/${uid}/freeze`, { ...freeze, idempotencyKey: 'freeze-after-edit' });
  assert.equal(edited.status, 409);
  assert.equal(edited.body.error, 'stale_revision');
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 1);

  const adopted = await w.call(`drafting-assets/${uid}/adopt`, { headRevisionUid: head, idempotencyKey: 'readopt' });
  assert.equal(adopted.status, 200);
  const status: any = await releaseStatus(w.env, { scope: { tenantId: TENANT, companyId: COMPANY, projectId: null } }, frozen.body.manifestUid);
  assert.equal(status.ok, true);
  assert.equal(status.release.components[0].status, 'reapproval_required');
  assert.deepEqual(status.release.components[0].reasons, ['superseded']);
  const renewed = await w.call(`drafting-assets/${uid}/freeze`, { ...freeze, headRevisionUid: adopted.body.headRevisionUid, approvedDigest: adopted.body.digest, idempotencyKey: 'freeze-2' });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.pinned.source.id, '910032');
});

test('a template export needs counsel and pins the template version without touching legal records', async t => {
  const w = await world(t);
  w.db.prepare('INSERT INTO counsel_members (user_id, granted_by) VALUES (?, ?)').run(SUPER, SUPER);
  const made = await w.call('drafting-assets', { tenantId: TENANT, kind: 'legal_template', sourceId: 910040 });
  const scope = { tenantId: TENANT, companyId: COMPANY, projectId: null };
  const line: any = await registerReleaseLine(w.env, { scope }, { scope, audience: 'partners', actor: { kind: 'person', userId: SUPER }, idempotencyKey: 'legal-line' });
  const freeze = { headRevisionUid: made.body.headRevisionUid, approvedDigest: made.body.digest, lineAssetUid: line.lineAssetUid, role: 'terms', partial: true, idempotencyKey: 'legal-freeze' };
  const adoptRefused = await w.call(`drafting-assets/${made.body.assetUid}/adopt`, { headRevisionUid: made.body.headRevisionUid, idempotencyKey: 'not-counsel' }, { who: OTHER });
  assert.equal(adoptRefused.status, 403);
  assert.equal(adoptRefused.body.error, 'counsel_required');
  const refused = await w.call(`drafting-assets/${made.body.assetUid}/freeze`, freeze, { who: OTHER });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'counsel_required');
  // A confidential template may not enter a partners export (D5585's audience rule), and nothing is cut.
  const audience = await w.call(`drafting-assets/${made.body.assetUid}/freeze`, freeze);
  assert.equal(audience.status, 409);
  assert.equal(audience.body.error, 'audience_forbidden');
  assert.equal(w.count('SELECT COUNT(*) AS n FROM work_graph_release_manifests'), 0);
  const internal: any = await registerReleaseLine(w.env, { scope }, { scope, audience: 'internal', actor: { kind: 'person', userId: SUPER }, idempotencyKey: 'internal-line' });
  const frozen = await w.call(`drafting-assets/${made.body.assetUid}/freeze`, { ...freeze, lineAssetUid: internal.lineAssetUid });
  assert.equal(frozen.status, 200, JSON.stringify(frozen.body));
  assert.deepEqual(frozen.body.pinned.source, { locator: 'legal_template_versions', id: '910040:1' });
  assert.equal(w.count('SELECT COUNT(*) AS n FROM esign_envelopes'), 0);
  assert.equal(w.db.prepare('SELECT version FROM legal_templates WHERE id = 910040').get()?.version, 1);
});
