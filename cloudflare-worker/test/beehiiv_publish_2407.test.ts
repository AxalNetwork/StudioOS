/**
 * D2407 (#2407 part 3) — the Beehiiv PUBLISH adapter, draft only, driven
 * through the real publish routes (`routes/publish.ts`, D1319) against the
 * fake Beehiiv MCP server (`_beehiiv_mcp_fake.mjs`). Nothing reaches the
 * network.
 *
 * WHAT IT HOLDS:
 *  1. The places: the publications the sign-in sees, each "Draft only: not
 *     sent to subscribers", arriving switched off; a bad id is dropped.
 *  2. The preview is the send: title and email-safe HTML built with no
 *     request; problems keep Send off (no body, media, a long title).
 *  3. Confirm creates ONE draft: the draft tool once, with a publication, a
 *     title and the HTML, and NO `status`; a repeated key sends nothing.
 *  4. Refused before the draft request: `plan_required` (the server offers no
 *     draft tool) and a tampered envelope (`content_changed`).
 *  5. After the request: Beehiiv's refusal (a tool error, a 429) is `failed`;
 *     a 5xx or an answer with no post id is `unknown`, never retried.
 *  6. Retract kind `none`: never deleted from Axal VC; no Check.
 *  7. No other path reaches the draft tool: a sync, a module read and a
 *     support session never call it; the target row and the record agree.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/beehiiv_publish_2407.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import publishRoutes from '../src/routes/publish.ts';
import '../src/integrations/providers/beehiiv.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { getProviderImpl, CONNECTOR_METADATA, PUBLISHERS } from '../src/integrations/registry.ts';
import { PUBLISH_TARGETS, publishTarget } from '../src/integrations/publishTargets.ts';
import { PUBLISH_MODULES } from '../src/integrations/publishSources.ts';
import { MCP_PROVIDERS } from '../src/integrations/mcpProviders.ts';
import { BEEHIIV_AUDIENCE, BEEHIIV_PROBLEMS, BEEHIIV_TEXT_LIMIT, BEEHIIV_TITLE_LIMIT, createBeehiivDraft, previewDraft, renderDraft } from '../src/services/beehiiv/drafts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  BEEHIIV_ISSUER, BEEHIIV_MCP_URL, DRAFT_POST, DRAFT_TOOL, PUB_A, PUB_A_NAME, PUB_B, beehiivFake, defaultBeehiivTools,
} from './_beehiiv_mcp_fake.mjs';

test.after(() => removeMigratedDatabases());

const SECRET = 's'.repeat(40); // in-memory test signing seed only
const FOUNDER = 1, COFOUNDER = 2;
const P = 701;
const BEE = 40;

const app = new Hono<any>();
app.route('/api/publish', publishRoutes);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

/**
 * The fake, with the draft tool's answer replaceable: `mode` answers the
 * draft call as Beehiiv would refuse or fail it. Every other request is the
 * fake's own.
 */
function beehiiv(opts: { tools?: any[] } = {}) {
  const fake = beehiivFake();
  if (opts.tools) fake.state.tools = opts.tools;
  const draft = { mode: 'accept' as 'accept' | 'tool_error' | 'rate_limited' | 'server_error' | 'no_id', calls: [] as any[] };
  const fetch = async (url: string, init: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (body?.method === 'tools/call' && body.params?.name === DRAFT_TOOL) {
      draft.calls.push(body.params.arguments);
      const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (draft.mode === 'tool_error') return ok({ isError: true, content: [{ type: 'text', text: 'Drafts need a paid plan.' }], resultType: 'complete' });
      if (draft.mode === 'rate_limited') return new Response('{}', { status: 429 });
      if (draft.mode === 'server_error') return new Response('{}', { status: 502 });
      if (draft.mode === 'no_id') return ok({ structuredContent: { data: { status: 'draft' } }, content: [], resultType: 'complete' });
    }
    return fake.fetch(url, init);
  };
  return { fake, draft, fetch };
}

async function fixture(opts: { tools?: any[] } = {}) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'F','f@example.test'),(202,'C','c@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (1,'Founder','founder@example.test','founder',101,1),(2,'Cofounder','co@example.test','founder',202,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-1','Northwind Data');
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (${P},'p-1','Northwind',101,1);
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,1,1),('l2',1,2,0);
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4) };
  const b = beehiiv(opts);
  const uid = 'int-bee';
  const enc = await encryptCredentials(env, uid, { access_token: b.fake.signedIn(), expires_at: null, scopes: [], issuer: BEEHIIV_ISSUER, client_key: 'fake-client', v: 2, resource: BEEHIIV_MCP_URL } as any);
  db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc) VALUES (?, ?, ?, 'beehiiv', 'active', 'oauth_mcp', ?)").run(BEE, uid, FOUNDER, enc);
  db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, 1, 1)').run(BEE);

  async function call(who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
    const token = await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const real = globalThis.fetch;
    globalThis.fetch = b.fetch as any;
    try {
      const res = await app.request(`https://unit.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
      return { status: res.status, body: await res.json().catch(() => null) as any };
    } finally { globalThis.fetch = real; }
  }
  return { db, env, call, ...b, uid };
}
type F = Awaited<ReturnType<typeof fixture>>;

/** Refresh the places, switch The Northwind Letter on, write a draft and preview it. */
async function ready(f: F, text = '[October update]\nShipped: bulk CSV import.\nWe are looking for: a design partner in logistics.') {
  assert.equal((await f.call(FOUNDER, 'POST', `/api/publish/destinations/refresh/${f.uid}`, { project: P })).status, 200);
  const dests = (await f.call(FOUNDER, 'GET', `/api/publish/destinations?project=${P}`)).body.connections.find((x: any) => x.uid === f.uid).destinations;
  const dest = dests.find((d: any) => d.account === PUB_A_NAME);
  assert.equal((await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: true })).status, 200);
  const draft = (await f.call(FOUNDER, 'POST', '/api/publish/drafts', { project_id: P, module: 'updates', text })).body.draft;
  const preview = (await f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/preview`, { destination_uids: [dest.uid] })).body.previews[0];
  return { dest, dests, draft, preview };
}
const confirm = (f: F, draft: any, dest: any, hash: string, key: string) =>
  f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/confirm`, { destination_uid: dest.uid, envelope_hash: hash, idempotency_key: key });

test('1. the places are the publications the sign-in sees, each draft only, arriving off; a bad id is dropped', async () => {
  const f = await fixture();
  const { dests } = await ready(f);
  assert.deepEqual(dests.map((d: any) => d.account).sort(), ['Northwind Changelog', PUB_A_NAME].sort(), 'the publication whose id is not Beehiiv\'s is dropped');
  assert.ok(dests.every((d: any) => d.audience === BEEHIIV_AUDIENCE && d.enabled === false && d.retract === 'none'));
  const row = f.db.prepare('SELECT external_account_id, audience_label, enabled FROM publish_destinations WHERE display_name = ?').get('Northwind Changelog') as any;
  assert.deepEqual([row.external_account_id, row.audience_label, row.enabled], [PUB_B, BEEHIIV_AUDIENCE, 0], 'a new place arrives off');
  assert.deepEqual(f.fake.toolCalls().filter((t: string) => t === DRAFT_TOOL), [], 'listing places creates nothing');
});

test('2. the preview is what is sent: a title and escaped HTML, built with no request; problems keep Send off', async () => {
  const f = await fixture();
  const { preview } = await ready(f, '[October update]\nShipped <b>bulk</b> CSV & "faster" search.');
  assert.equal(preview.sendable, true, JSON.stringify(preview.problems));
  assert.equal(preview.audience, BEEHIIV_AUDIENCE);
  assert.equal(preview.retract, 'none');
  const field = (n: string) => preview.preview.fields.find((x: any) => x.name === n).value;
  assert.equal(field('title'), '[October update]');
  assert.equal(field('body_html'), '<p>Shipped &lt;b&gt;bulk&lt;/b&gt; CSV &amp; &quot;faster&quot; search.</p>', 'every line escaped, nothing else');
  const dest = { external_account_id: PUB_A, display_name: PUB_A_NAME, audience_label: BEEHIIV_AUDIENCE };
  const callsBefore = f.fake.calls.length;
  const p = previewDraft({ text: 'Only a title', media_r2_keys: [], alt_texts: [], destination: dest });
  assert.equal(f.fake.calls.length, callsBefore, 'previewDraft makes no request');
  assert.deepEqual(p.problems, [BEEHIIV_PROBLEMS.no_body]);
  assert.deepEqual(previewDraft({ text: '  \n ', media_r2_keys: [], alt_texts: [], destination: dest }).problems, [BEEHIIV_PROBLEMS.empty]);
  assert.ok(previewDraft({ text: 'T\nbody', media_r2_keys: ['r2/a.png'], alt_texts: ['a'], destination: dest }).problems.includes(BEEHIIV_PROBLEMS.media));
  assert.ok(previewDraft({ text: `${'x'.repeat(BEEHIIV_TITLE_LIMIT + 1)}\nbody`, media_r2_keys: [], alt_texts: [], destination: dest }).problems.some((x) => x.startsWith('The title, your first line, is 251')));
  assert.ok(previewDraft({ text: `T\n${'y'.repeat(BEEHIIV_TEXT_LIMIT)}`, media_r2_keys: [], alt_texts: [], destination: dest }).problems.some((x) => x.includes(`of ${BEEHIIV_TEXT_LIMIT} characters`)));
  assert.ok(previewDraft({ text: 'T\nbody', media_r2_keys: [], alt_texts: [], destination: { ...dest, external_account_id: 'not a beehiiv id!' } }).problems.includes(BEEHIIV_PROBLEMS.no_publication));
});

test('3. confirm creates one draft: the draft tool once, publication, title and HTML, and no status; a repeated key sends nothing', async () => {
  const f = await fixture();
  const { dest, draft, preview } = await ready(f);
  const first = await confirm(f, draft, dest, preview.envelope_hash, 'key-bee-0001');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.deepEqual([first.body.send.status, first.body.send.external_post_id, first.body.send.retract], ['sent', DRAFT_POST, 'none']);
  assert.equal(first.body.send.external_url, `https://app.beehiiv.com/posts/${DRAFT_POST}/edit`);
  assert.equal(f.draft.calls.length, 1, 'one draft request');
  const args = f.draft.calls[0];
  assert.deepEqual(Object.keys(args).sort(), ['body_content', 'publication_id', 'title'], 'publication, title and body only');
  assert.ok(!('status' in args), 'NO status: a draft, never a post');
  assert.deepEqual([args.publication_id, args.title], [PUB_A, '[October update]']);
  assert.equal(args.body_content, '<p>Shipped: bulk CSV import.</p>\n<p>We are looking for: a design partner in logistics.</p>');
  const again = await confirm(f, draft, dest, preview.envelope_hash, 'key-bee-0001');
  assert.equal(again.body.repeated, true);
  assert.equal(f.draft.calls.length, 1, 'the same key never drafts twice');
  // Codes only in the outbound log: no title, no body.
  const log = f.db.prepare("SELECT response_summary, external_id, payload_json FROM integration_logs WHERE provider_key = 'beehiiv' AND event_type = 'publish'").all() as any[];
  assert.deepEqual(log.map((l) => [l.response_summary, l.external_id, l.payload_json]), [['sent', DRAFT_POST, null]]);
});

test('4. refused before the draft request: no draft tool offered (plan_required), and a tampered envelope', async () => {
  const f = await fixture({ tools: defaultBeehiivTools().filter((t: any) => t.name !== DRAFT_TOOL) });
  const { dest, draft, preview } = await ready(f);
  const r = await confirm(f, draft, dest, preview.envelope_hash, 'key-bee-0002');
  assert.deepEqual([r.body.send.status, r.body.send.error_code], ['failed', 'plan_required']);
  assert.equal(f.draft.calls.length, 0, 'the draft tool is never called');

  const g = await fixture();
  const row = g.db.prepare('SELECT * FROM integrations WHERE id = ?').get(BEE) as any;
  const input = { text: 'Title\nBody', media_r2_keys: [], alt_texts: [], destination: { external_account_id: PUB_A, display_name: PUB_A_NAME, audience_label: BEEHIIV_AUDIENCE } };
  const preview2 = previewDraft(input);
  const before = g.fake.calls.length;
  for (const envelope of [
    { input: { ...input, text: 'Title\nA different body' }, preview: preview2 },
    { input, preview: { ...preview2, fields: [{ name: 'title', value: 'Title' }, { name: 'body_html', value: '<p>Body</p><img src="x">' }] } },
    { input: { ...input, destination: { ...input.destination, external_account_id: '../evil' } }, preview: preview2 },
  ]) {
    await assert.rejects(createBeehiivDraft(g.env, row, envelope as any, { fetcher: g.fetch as any }), (e: any) => e.kind === 'not_created' && ['content_changed', 'no_publication'].includes(e.code));
  }
  assert.equal(g.fake.calls.length, before, 'refused before any request');

  // Tokens that cannot be read, or an expired token whose refresh Beehiiv refuses, send nothing:
  // not_created, never an unknown outcome.
  g.db.prepare("UPDATE integrations SET credentials_enc = 'v1.not-a-blob' WHERE id = ?").run(BEE);
  const broken = g.db.prepare('SELECT * FROM integrations WHERE id = ?').get(BEE) as any;
  await assert.rejects(createBeehiivDraft(g.env, broken, { input, preview: preview2 } as any, { fetcher: g.fetch as any }), (e: any) => e.kind === 'not_created' && e.code === 'not_connected');
  const expired = await encryptCredentials(g.env, g.uid, { access_token: 'expired-token', refresh_token: 'refused-refresh', expires_at: 1, scopes: [], issuer: BEEHIIV_ISSUER, client_key: 'fake-client', v: 2, resource: BEEHIIV_MCP_URL } as any);
  g.db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?').run(expired, BEE);
  const stale = g.db.prepare('SELECT * FROM integrations WHERE id = ?').get(BEE) as any;
  await assert.rejects(createBeehiivDraft(g.env, stale, { input, preview: preview2 } as any, { fetcher: g.fetch as any }), (e: any) => e.kind === 'not_created' && e.code === 'unauthorized');
  g.db.prepare("UPDATE integrations SET credentials_enc = NULL WHERE id = ?").run(BEE);
  const none = g.db.prepare('SELECT * FROM integrations WHERE id = ?').get(BEE) as any;
  await assert.rejects(createBeehiivDraft(g.env, none, { input, preview: preview2 } as any, { fetcher: g.fetch as any }), (e: any) => e.kind === 'not_created' && ['not_connected', 'unauthorized'].includes(e.code));
  assert.equal(g.draft.calls.length, 0);
});

test('5. after the request: a refusal or a 429 is failed; a 5xx or no post id is unknown and never retried', async () => {
  for (const [mode, status, code] of [['tool_error', 'failed', 'rejected'], ['rate_limited', 'failed', 'rate_limited'], ['server_error', 'unknown', 'outcome_unknown'], ['no_id', 'unknown', 'outcome_unknown']] as const) {
    const f = await fixture();
    f.draft.mode = mode;
    const { dest, draft, preview } = await ready(f);
    const r = await confirm(f, draft, dest, preview.envelope_hash, `key-bee-${mode}`);
    assert.deepEqual([r.body.send.status, r.body.send.error_code], [status, code], mode);
    if (status === 'unknown') {
      const retry = await f.call(FOUNDER, 'POST', `/api/publish/sends/${r.body.send.uid}/retry`);
      assert.equal(retry.body.error, 'outcome_unknown', 'an unknown outcome is never sent again');
      const check = await f.call(FOUNDER, 'POST', `/api/publish/sends/${r.body.send.uid}/check`);
      assert.equal(check.body.error, 'check_not_supported', 'no Check: look for it in Beehiiv');
    }
    assert.equal(f.draft.calls.length, 1, `${mode}: one draft request`);
  }
});

test('6. retract kind none: a draft is never deleted from Axal VC, and can be marked removed', async () => {
  const f = await fixture();
  const { dest, draft, preview } = await ready(f);
  const sent = (await confirm(f, draft, dest, preview.envelope_hash, 'key-bee-0006')).body.send;
  const gone = await f.call(FOUNDER, 'POST', `/api/publish/sends/${sent.uid}/retract`, { reason: 'too early' });
  assert.equal(gone.body.error, 'not_retractable');
  assert.equal((await f.call(FOUNDER, 'POST', `/api/publish/sends/${sent.uid}/mark-removed`)).body.send.status, 'removed_outside');
  const impl = getProviderImpl('beehiiv')!;
  assert.equal(impl.retract, undefined);
  assert.equal(impl.findPublished, undefined);
});

test('7. only the founder\'s confirm reaches the draft tool; the target row, the record and the metadata agree', async () => {
  const f = await fixture();
  const { dest, draft, preview } = await ready(f);
  // A support session and a co-founder are refused before any request.
  const support = await f.call(FOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/confirm`, { destination_uid: dest.uid, envelope_hash: preview.envelope_hash, idempotency_key: 'key-bee-supp' }, { impersonated_by: 3 });
  assert.equal(support.body.error, 'support_session');
  const co = await f.call(COFOUNDER, 'POST', `/api/publish/drafts/${draft.uid}/confirm`, { destination_uid: dest.uid, envelope_hash: preview.envelope_hash, idempotency_key: 'key-bee-co01' });
  assert.equal(co.body.error, 'publish_not_allowed');
  // A place switched off is refused before any request.
  assert.equal((await f.call(FOUNDER, 'PUT', `/api/publish/destinations/${dest.uid}?project=${P}`, { enabled: false })).status, 200);
  assert.equal((await confirm(f, draft, dest, preview.envelope_hash, 'key-bee-off1')).body.error, 'destination_off');
  assert.equal(f.draft.calls.length, 0, 'none of them drafted');

  const target = publishTarget('beehiiv')!;
  assert.deepEqual(PUBLISH_TARGETS.map((t) => t.key), ['beehiiv']);
  assert.deepEqual([...target.modules], [...PUBLISH_MODULES], 'all nine places');
  assert.deepEqual([target.retract, target.media_limit, target.text_limit, target.audience, target.verified_on], ['none', 0, BEEHIIV_TEXT_LIMIT, BEEHIIV_AUDIENCE, null]);
  assert.ok(PUBLISHERS.has('beehiiv'));
  assert.deepEqual(CONNECTOR_METADATA.beehiiv.publishes, [{ what: 'A draft post in your publication', target: 'beehiiv' }]);
  assert.deepEqual(CONNECTOR_METADATA.beehiiv.sends, [], 'a draft is never a sends row');
  assert.deepEqual([...MCP_PROVIDERS.beehiiv.write_tools], [DRAFT_TOOL]);
  assert.equal(MCP_PROVIDERS.beehiiv.publish_issue, 2407);
  assert.deepEqual(renderDraft('a\n\n  b  \n'), { title: 'a', lines: ['b'], body_html: '<p>b</p>' });
});
