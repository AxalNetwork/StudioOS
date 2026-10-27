/**
 * D1333 (#3481, part 2 of #2400) — Grow's draft sources, on the migrated
 * schema with the routes on a bare Hono and `_publish_fake.mjs` as the place.
 * Nothing reaches the network.
 *
 * What #3481 says must be tested, each below by name: never-list fields are
 * dropped; team-only figures are dropped unless ticked; nothing missing
 * becomes 0; the gate is false for every refused role.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/publish_sources_d1333.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { publishFake } from './_publish_fake.mjs';
import publishRoutes from '../src/routes/publish.ts';
import growRoutes from '../src/routes/cycle_grow.ts';
import updateRoutes from '../src/routes/portfolio_updates.ts';
import { registerProvider } from '../src/integrations/registry.ts';
import { registerPublishTarget } from '../src/integrations/publishTargets.ts';
import { PUBLISH_MODULES, PUBLISH_SOURCES } from '../src/integrations/publishSources.ts';
import { DRAFT_BUILDERS, figureText, prefillDraft, publishPart, sourceChip } from '../src/services/publishSources.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 's'.repeat(40); // in-memory test signing seed only
const FOUNDER = 1, COFOUNDER = 2, ADMIN = 3, PARTNER = 4, ADVISOR = 5;
const P = 701;
const fake = publishFake({ key: 'fakepub20' });
registerProvider(fake.impl as any); registerPublishTarget(fake.target as any);

const app = new Hono<any>();
app.route('/api/publish', publishRoutes);
app.route('/api/cycles/grow', growRoutes);
app.route('/api/portfolio-updates', updateRoutes);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

/** Every value a draft must never carry: each is seeded into a never-list field below. */
const NEVER = /PRIVATE|987654|48,000|Applicant/i;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'F','f@example.test'),(202,'C','c@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (1,'Founder','founder@example.test','founder',101,1),(2,'Cofounder','co@example.test','founder',202,1),
      (3,'Admin','admin@example.test','admin',101,1),(4,'Partner','partner@example.test','partner',NULL,1),
      (5,'Advisor','advisor@example.test','advisor',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-1','Northwind Data');
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (${P},'p-1','Northwind',101,1);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (${P},2,'cofounder','accepted'),(${P},4,'advisor','accepted');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,1,1),('l2',1,2,0),('l3',1,3,0);
    INSERT INTO integrations(id,uid,user_id,provider_key,status,auth_type) VALUES (10,'int-own',1,'fakepub20','active','oauth2');
    INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (10,1,1);
  `);
  const seed = (table: string, values: Record<string, unknown>) => {
    if (!/^[a-z_0-9]+$/.test(table)) throw new Error('bad fixture table');
    const row = { ...values };
    for (const c of db.prepare('PRAGMA table_info(' + table + ')').all() as any[]) if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : c.name === 'uid' ? `${table}-${Math.random().toString(36).slice(2)}` : 'synthetic';
    const keys = Object.keys(row); for (const k of keys) if (!/^[a-z_0-9]+$/.test(k)) throw new Error('bad fixture column');
    db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k] as any));
  };
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  async function call(who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
    const token = await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`https://unit.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  return { db, env, seed, call };
}
type F = ReturnType<typeof fixture>;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** One record in every Grow store, each with a PRIVATE value in a never-list field. */
function records(f: F) {
  f.seed('product_feedback', { uid: 'fb-1', project_id: P, body: 'PRIVATE customer words', source: 'customer', from_name: 'PRIVATE Name', from_email: 'private@example.test', from_company: 'PRIVATE Co', theme: 'Bulk CSV import', roadmap_item_label: 'Bulk CSV import', status: 'shipped', shipped_on: daysAgo(10) });
  f.seed('product_feedback', { uid: 'fb-2', project_id: P, body: 'PRIVATE', source: 'customer', theme: 'Bulk CSV import', roadmap_item_label: 'Bulk CSV import', status: 'shipped', shipped_on: daysAgo(12) });
  f.seed('product_feedback', { uid: 'fb-3', project_id: P, body: 'PRIVATE', source: 'customer', theme: 'Faster search', status: 'shipped', shipped_on: daysAgo(200) });
  f.seed('product_feedback', { uid: 'fb-4', project_id: P, body: 'PRIVATE', source: 'customer', theme: 'SSO', status: 'planned', shipped_on: daysAgo(1) });
  f.seed('growth_channels', { id: 1, uid: 'ch-1', project_id: P, name: 'LinkedIn', utm_source: 'private-utm', state: 'active', kind: 'content', cac_bar_cents: 987654 });
  f.seed('growth_channels', { id: 2, uid: 'ch-2', project_id: P, name: 'Paused channel', utm_source: 'x', state: 'paused', kind: 'content' });
  f.seed('channel_experiments', { uid: 'ex-1', channel_id: 1, title: 'Founder video series', run_on: daysAgo(5), cac_cents: 987654 });
  f.seed('project_metrics', { project_id: P, snapshot_date: daysAgo(2), source: 'stripe', mrr: 18400, paying_accounts: 42, new_users: 0 });
  f.seed('project_metrics', { project_id: P, snapshot_date: daysAgo(1), source: 'mercury', net_burn: 48000, cash_balance: 987654, notes: 'PRIVATE note' });
  // A bank figure typed by hand is still the bank's: team-only.
  f.seed('project_metrics', { project_id: P, snapshot_date: daysAgo(1), source: 'manual', cash_in_cents: 98765400 });
  f.seed('job_postings', { slug: 'founding-engineer', host_user_id: 1, project_id: P, title: 'Founding engineer', location_text: 'Lisbon', remote: 0, summary: 'Build the core.', description: 'PRIVATE description', status: 'published', admin_published: 1, comp_min_cents: 987654, review_notes: 'PRIVATE review', published_at: daysAgo(3) });
  f.seed('job_postings', { slug: 'draft-role', host_user_id: 1, project_id: P, title: 'Unpublished role', status: 'draft', admin_published: 0 });
  f.seed('job_postings', { slug: 'pending-role', host_user_id: 1, project_id: P, title: 'Not yet admin-published', status: 'published', admin_published: 0 });
  f.seed('growth_partners', { uid: 'pa-1', project_id: P, name: 'PRIVATE Partner Ltd', type: 'integration', stage: 'signed', terms: 'PRIVATE terms', contact_name: 'PRIVATE Contact', contact_email: 'private@example.test' });
  f.seed('growth_partners', { uid: 'pa-2', project_id: P, name: 'PRIVATE Talking', type: 'agency', stage: 'talking' });
  f.seed('markets', { id: 1, uid: 'mk-1', project_id: P, name: 'Portugal', state: 'served', demand_score: 4, demand_source: 'PRIVATE source', updated_at: daysAgo(4) });
  f.seed('markets', { id: 2, uid: 'mk-2', project_id: P, name: 'Spain', state: 'considering', decision: 'enter', decided_on: daysAgo(6) });
  f.seed('markets', { id: 3, uid: 'mk-3', project_id: P, name: 'Not now', state: 'not_now' });
  f.seed('market_entry_steps', { uid: 'st-1', market_id: 2, text: 'Local entity registered', owner_name: 'PRIVATE Owner', done_at: daysAgo(6) });
  f.seed('market_entry_steps', { uid: 'st-2', market_id: 2, text: 'Not done yet', owner_name: 'PRIVATE Owner' });
  f.seed('durability_checklist', { project_id: P, item_key: 'ein_received', done_at: daysAgo(30) });
  f.seed('durability_checklist', { project_id: P, item_key: 'runway_12_months', done_at: daysAgo(20) });
  f.seed('durability_checklist', { project_id: P, item_key: 'key_person_cover', done_at: null });
  // Applicants exist but are never read.
  f.seed('job_applications', { posting_id: 1, user_id: 5, name: 'Applicant Person', email: 'private@example.test' });
}
/** A sent update with highlights (never in a draft), two asks and metrics, one from the bank. */
function update(f: F, { sent = true, withMetrics = true } = {}) {
  f.seed('portfolio_updates', { id: 1, uid: 'up-1', project_id: P, author_user_id: 1, period: '2026-10', title: 'October at Northwind', body: 'PRIVATE body', status: 'submitted',
    highlights_json: JSON.stringify([{ text: 'PRIVATE highlight', source: 'x' }]), lowlights_json: JSON.stringify([{ text: 'PRIVATE lowlight', source: 'x' }]),
    audience_json: JSON.stringify({ investors: true, network: true }), network_includes_metrics: withMetrics ? 1 : 0, sent_at: sent ? daysAgo(1) : null, kind: 'update',
    metrics_json: JSON.stringify([{ key: 'mrr', label: 'MRR', value: 18400, unit: 'usd', source: 'stripe', as_of: daysAgo(2) },
      { key: 'burn', label: 'Net burn', value: 48000, unit: 'usd', source: 'mercury', as_of: daysAgo(1) },
      { key: 'customers', label: 'Customers', value: 42, unit: 'count', source: 'mercury', as_of: daysAgo(1) },
      { key: 'growth', label: 'MRR growth', value: null, unit: 'pct', source: null, as_of: null, reason: 'Not recorded' }]) });
  f.seed('update_asks', { uid: 'ask-1', update_id: 1, kind: 'hire', text: 'A founding designer' });
  f.seed('update_asks', { uid: 'ask-2', update_id: 1, kind: 'customer', text: 'Finance teams closing books monthly' });
}
/** The founder's place, switched on. */
async function placeOn(f: F) {
  assert.equal((await f.call(FOUNDER, 'POST', '/api/publish/destinations/refresh/int-own', { project: P })).status, 200);
  const dest = (await f.call(FOUNDER, 'GET', `/api/publish/destinations?project=${P}`)).body.connections[0].destinations[0];
  assert.equal((await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: true })).status, 200);
  return dest;
}

test('the sources: nine places, each with stores whose fields never meet their never-list, and every SELECT reads listed fields only', () => {
  assert.deepEqual([...new Set(PUBLISH_SOURCES.map((s) => s.module))].sort(), [...PUBLISH_MODULES].sort(), 'every place has a source');
  assert.deepEqual(Object.keys(DRAFT_BUILDERS).sort(), [...PUBLISH_MODULES].sort(), 'every place has a builder');
  for (const s of PUBLISH_SOURCES) for (const n of s.never) assert.ok(!s.fields.includes(n), `${s.store}.${n} is both quoted and never`);
  const never = (store: string) => PUBLISH_SOURCES.filter((s) => s.store === store).flatMap((s) => s.never);
  for (const [store, col] of [['product_feedback', 'from_name'], ['product_feedback', 'from_email'], ['product_feedback', 'body'], ['growth_partners', 'name'], ['growth_partners', 'contact_email'],
    ['job_postings', 'comp_min_cents'], ['markets', 'demand_score'], ['market_entry_steps', 'owner_name'], ['growth_channels', 'utm_source'], ['portfolio_updates', 'highlights_json']]) {
    assert.ok(never(store).includes(col), `${store}.${col} is on the never-list`);
  }
  const svc = readFileSync(new URL('../src/services/publishSources.ts', import.meta.url), 'utf8');
  const selects = [...svc.matchAll(/SELECT\s+([\s\S]+?)\s+FROM\s+([a-z_]+)(?:\s+([a-z])\b)?/g)];
  assert.ok(selects.length >= 12);
  for (const [, cols, table, alias] of selects) {
    const src = PUBLISH_SOURCES.filter((s) => s.store === table);
    if (!src.length) continue; // the gate's reads (projects, publish_destinations, publish_sends)
    const allowed = new Set(src.flatMap((s) => s.fields));
    for (const raw of cols.split(',').map((x) => x.trim())) {
      const col = alias && raw.startsWith(`${alias}.`) ? raw.slice(alias.length + 1) : raw;
      if (table === 'portfolio_updates' && col === 'id') continue; // the join key to update_asks, never quoted
      assert.ok(allowed.has(col), `${table}.${col} is read but not listed`);
    }
  }
  assert.ok(!/prepare\(`[^`]*\$\{/.test(svc), 'no interpolated SQL');
});

test('never-list fields are dropped: each place’s draft carries its facts, with source and date, and nothing private', async () => {
  const f = fixture(); records(f); update(f);
  const texts: Record<string, string> = {};
  for (const m of PUBLISH_MODULES) {
    const d = await prefillDraft(f.env, P, m);
    texts[m] = d.text;
    assert.ok(!NEVER.test(JSON.stringify(d)), `${m} carries nothing private`);
    for (const r of d.source_refs) assert.ok(r.source && 'as_of' in r && r.ref, `${m}: every line keeps its source and date`);
  }
  assert.equal(texts['product-improvement'], 'Shipped: Bulk CSV import', 'shipped in 90 days, once per item; planned and old ones are not');
  assert.match(texts.distribution, /^Now on LinkedIn\nTried: Founder video series$/);
  assert.equal(texts['team-expansion'], 'Hiring: Founding engineer · Lisbon — Build the core. /jobs/founding-engineer', 'published and admin-published only');
  assert.equal(texts['partner-network'], 'Signed an integration partnership', 'the type, never the name');
  assert.equal(texts['market-expansion'], 'Now serving Portugal\nEntering Spain\nDone: Local entity registered');
  assert.equal(texts['durable-company-building'], 'Tax ID (EIN) received: complete', 'runway is the founder’s Mercury: team-only');
  assert.equal(texts.updates, 'October at Northwind\nWe are looking for: A founding designer\nWe are looking for: Finance teams closing books monthly\nMRR: $18,400');
  const partner = await prefillDraft(f.env, P, 'partner-network');
  assert.equal(partner.dropped.unnamed, 1);
  const chip = await prefillDraft(f.env, P, 'product-improvement');
  assert.match(chip.chip, /^From Product improvement · 1 shipped item · [A-Z][a-z]{2} \d{4}$/);
  assert.equal(sourceChip({ module: 'team-expansion', lines: [], dropped: { team_only: 0, not_recorded: 0, unnamed: 0 } }), 'From Team expansion · 0 open roles');
});

test('team-only figures are dropped unless ticked; a ticked one is marked so the check blocks it again when the tick is taken back', async () => {
  const f = fixture(); records(f);
  const plain = await prefillDraft(f.env, P, 'revenue-and-traction');
  assert.equal(plain.text, 'MRR: $18,400\nPaying customers: 42\nNew users: 0', 'a recorded 0 is a 0');
  assert.equal(plain.dropped.team_only, 3, 'net burn and cash from Mercury, and cash in typed by hand: all the bank’s');
  assert.equal(plain.dropped.not_recorded, 2, 'ARR and NRR are not recorded: left out, never 0');
  const ticked = await prefillDraft(f.env, P, 'revenue-and-traction', { teamOnly: true });
  assert.match(ticked.text, /Net burn: \$48,000\nCash: \$987,654/);
  assert.deepEqual(ticked.source_refs.filter((r) => r.team_only).map((r) => r.text), ['$48,000', '$987,654', '$987,654']);
  assert.ok(!/Net burn|Cash:/.test((await prefillDraft(f.env, P, 'durable-company-building', { teamOnly: false })).text + plain.text));
  assert.match((await prefillDraft(f.env, P, 'durable-company-building', { teamOnly: true })).text, /Twelve months of runway: complete/);
  // Through the route: ticked in, then taken back — the check blocks the figure.
  const dest = await placeOn(f);
  const made = await f.call(FOUNDER, 'POST', '/api/publish/drafts', { project_id: P, module: 'revenue-and-traction', team_only_included: true });
  assert.equal(made.status, 201);
  assert.equal(made.body.draft.team_only_included, true);
  assert.match(made.body.draft.body.text, /Net burn: \$48,000/);
  assert.match(made.body.prefill.chip, /^From Revenue and traction · 6 figures/);
  const before = (await f.call(FOUNDER, 'POST', `/api/publish/drafts/${made.body.draft.uid}/preview`, { destination_uids: [dest.uid] })).body.previews[0];
  assert.ok(!before.lint.kinds.includes('team_only'), 'ticked in: the figure passes');
  await f.call(FOUNDER, 'PUT', `/api/publish/drafts/${made.body.draft.uid}`, { team_only_included: false });
  const after = (await f.call(FOUNDER, 'POST', `/api/publish/drafts/${made.body.draft.uid}/preview`, { destination_uids: [dest.uid] })).body.previews[0];
  assert.ok(after.lint.kinds.includes('team_only'), 'tick taken back: the check blocks it');
  const unticked = await f.call(FOUNDER, 'POST', '/api/publish/drafts', { project_id: P, module: 'revenue-and-traction' });
  assert.ok(!/48,000|987,654/.test(unticked.body.draft.body.text));
  assert.equal(unticked.body.draft.team_only_included, false);
});

test('an Overview figure from the founder’s Mercury is team-only too', async () => {
  const f = fixture();
  f.seed('project_metrics', { project_id: P, snapshot_date: daysAgo(1), source: 'mercury', mrr: 12500, paying_accounts: 30 });
  const plain = await prefillDraft(f.env, P, 'overview');
  assert.ok(!/MRR|Customers/.test(plain.text), 'Mercury’s MRR and customers wait for the tick');
  assert.ok(plain.dropped.team_only >= 2);
  const ticked = await prefillDraft(f.env, P, 'overview', { teamOnly: true });
  assert.match(ticked.text, /MRR: \$12,500/);
  assert.ok(ticked.source_refs.some((r) => r.team_only && r.text === '$12,500'));
});

test('nothing missing becomes 0: an empty venture drafts nothing, and an unrecorded figure is left out', async () => {
  const f = fixture();
  for (const m of PUBLISH_MODULES) {
    const d = await prefillDraft(f.env, P, m);
    assert.ok(!/\b0\b|\$0/.test(d.text), `${m}: no zero for nothing`);
  }
  assert.equal((await prefillDraft(f.env, P, 'revenue-and-traction')).dropped.not_recorded, 8);
  assert.equal(figureText(null, 'usd'), null); assert.equal(figureText('', 'count'), null); assert.equal(figureText(0, 'count'), '0');
  assert.equal(figureText(123400, 'cents'), '$1,234'); assert.equal(figureText(12.5, 'pct'), '12.5%');
});

test('the founder’s own text is kept; chosen records narrow the draft', async () => {
  const f = fixture(); records(f);
  const own = await f.call(FOUNDER, 'POST', '/api/publish/drafts', { project_id: P, module: 'product-improvement', text: 'My words.' });
  assert.equal(own.body.draft.body.text, 'My words.'); assert.equal(own.body.prefill, null);
  const chosen = await f.call(FOUNDER, 'POST', '/api/publish/drafts', { project_id: P, module: 'market-expansion', source_refs: ['markets:mk-2'] });
  assert.equal(chosen.body.draft.body.text, 'Entering Spain');
  assert.deepEqual(chosen.body.draft.source_refs.map((r: any) => r.ref), ['markets:mk-2']);
  assert.equal((await f.call(FOUNDER, 'POST', '/api/publish/drafts', { project_id: P, module: 'nowhere' })).status, 400);
});

test('the gate is false for every refused role; the founder needs a place on; "Published from here" is the last three, for the team', async () => {
  const f = fixture(); records(f);
  const part = async (who: number, extra = {}) => (await f.call(who, 'GET', `/api/cycles/grow/modules/product-improvement?project=${P}`, undefined, extra)).body.parts?.publish;
  const none = await part(FOUNDER);
  assert.deepEqual([none.can_publish, none.destinations_on, none.empty.kind, none.empty.sentence], [false, 0, 'connect', 'Connect a place to publish']);
  const dest = await placeOn(f);
  const on = await part(FOUNDER);
  assert.deepEqual([on.state, on.can_publish, on.destinations_on, on.empty], ['ok', true, 1, null]);
  for (const who of [COFOUNDER, ADMIN, PARTNER]) {
    const p = await part(who);
    assert.equal(p?.can_publish, false, `user ${who}`);
    assert.equal(p.empty.sentence, 'Only the founder publishes for Northwind Data.', `user ${who}`);
    assert.equal(p.destinations_on, null);
  }
  const support = await part(FOUNDER, { impersonated_by: ADMIN });
  assert.equal(support?.can_publish ?? false, false);
  if (support) assert.equal(support.empty.kind, 'support');
  // Four sends from here; the last three show, newest first, for the team only.
  for (const [i, status] of ['sent', 'failed', 'sent', 'unknown'].entries()) {
    f.db.prepare(`INSERT INTO publish_sends (uid, draft_id, destination_id, project_id, module, provider_key, destination_label, audience_label, idempotency_key, envelope_json, envelope_hash, status, confirmed_by, confirmed_at, sent_at)
      VALUES (?, 1, NULL, ?, 'product-improvement', 'fakepub20', '@northwind_demo', 'Public', ?, '{}', 'h', ?, 1, ?, ?)`).run(`s-${i}`, P, `key-0000${i}`, status, `2026-10-2${i} 10:00:00`, status === 'sent' ? `2026-10-2${i} 10:00:01` : null);
  }
  f.db.prepare(`INSERT INTO publish_sends (uid, draft_id, project_id, module, provider_key, destination_label, idempotency_key, envelope_json, envelope_hash, status, confirmed_by, confirmed_at) VALUES ('other', 1, ?, 'distribution', 'fakepub20', '@northwind_demo', 'key-other', '{}', 'h', 'sent', 1, '2026-10-29 10:00:00')`).run(P);
  const recent = (await part(FOUNDER)).recent;
  assert.deepEqual(recent.map((r: any) => r.uid), ['s-3', 's-2', 's-1'], 'this page’s last three, newest first');
  assert.ok(!('text' in recent[0]) && !('envelope' in recent[0]), 'no post body in the gate');
  assert.deepEqual((await part(COFOUNDER)).recent.map((r: any) => r.uid), ['s-3', 's-2', 's-1'], 'the team reads it');
  assert.equal((await part(ADVISOR))?.recent ?? null, null, 'not the team: no history');
  const outsider = f.db.prepare('SELECT * FROM users WHERE id = 5').get() as any;
  assert.equal((await publishPart(f.env, outsider, false, P, 'product-improvement')).recent, null, 'the gate itself keeps the history to the team');
  // The overview carries the same gate.
  const ov = (await f.call(FOUNDER, 'GET', `/api/cycles/grow/overview?project=${P}`)).body;
  assert.equal(ov.publish.module, 'overview'); assert.equal(ov.publish.can_publish, true);
  void dest;
});

test('a sent update starts a draft with its network version; only the founder, only once it is sent', async () => {
  const f = fixture(); records(f); update(f);
  const made = await f.call(FOUNDER, 'POST', '/api/portfolio-updates/up-1/publish-draft', {});
  assert.equal(made.status, 201);
  const d = (await f.call(FOUNDER, 'GET', `/api/publish/drafts/${made.body.draft_uid}`)).body.draft;
  assert.equal(d.module, 'updates');
  assert.equal(d.body.text, 'October at Northwind\nWe are looking for: A founding designer\nWe are looking for: Finance teams closing books monthly\nMRR: $18,400');
  assert.ok(!/PRIVATE|48,000|growth/.test(JSON.stringify(d)), 'no highlight, lowlight or body; the bank figure and the unrecorded one are left out');
  assert.equal((await f.call(FOUNDER, 'POST', '/api/portfolio-updates/up-1/publish-draft', { team_only_included: true })).status, 201);
  const refused = await f.call(COFOUNDER, 'POST', '/api/portfolio-updates/up-1/publish-draft', {});
  assert.deepEqual([refused.status, refused.body.error], [403, 'publish_not_allowed']);
  const gate = await f.call(COFOUNDER, 'GET', '/api/portfolio-updates/up-1/publish');
  assert.equal(gate.status, 200); assert.equal(gate.body.publish.can_publish, false);
  assert.equal((await f.call(ADVISOR, 'GET', '/api/portfolio-updates/up-1/publish')).status, 404);
  const g = fixture(); update(g, { sent: false });
  assert.equal((await prefillDraft(g.env, P, 'updates')).text, '', 'an update not sent drafts nothing');
  assert.equal((await g.call(FOUNDER, 'POST', '/api/portfolio-updates/up-1/publish-draft', {})).status, 409);
  const h = fixture(); update(h, { withMetrics: false });
  const noMetrics = await h.call(FOUNDER, 'POST', '/api/portfolio-updates/up-1/publish-draft', {});
  assert.ok(!/MRR/.test((await h.call(FOUNDER, 'GET', `/api/publish/drafts/${noMetrics.body.draft_uid}`)).body.draft.body.text), 'metrics only when the founder included them');
  assert.equal((await f.call(FOUNDER, 'POST', '/api/portfolio-updates/nope/publish-draft', {})).status, 404);
});
