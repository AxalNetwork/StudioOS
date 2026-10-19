// D717 (#1782) decisions 5 and 6 — page-1 thumbnails and the documents not in
// the catalog.
//
// PR 1a shipped `/templates/outside` (rows only); PR 1b adds the two thumbnail
// routes, `POST /templates/render.pdf` and the render route's draft format and
// `fields`. Browser Run is a fake `quickAction` binding and FILES a Map, and
// every test checks that `BROWSER.fetch` is never called.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-d717-thumbs-0123456789abcd';
const MIGRATIONS = 'cloudflare-worker/sql/migrations';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  for (const t of ['users', 'legal_templates', 'legal_template_versions']) db.exec(tableFromBaseline(baseline, t));
  for (const f of ['085_seed_legal_templates', '105_fill_legal_template_bodies', '113_refresh_legal_template_bodies']) {
    db.exec(readFileSync(`${MIGRATIONS}/${f}.sql`, 'utf8'));
  }
  db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)').run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)').run(3, 'founder', 'Founder', 'founder@example.test', 1);
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function auth(who: number | null) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === 1 ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  return headers;
}
async function get(db: DatabaseSync, path: string, who: number | null = 1) {
  const res = await app.request(`/contracts${path}`, { headers: await auth(who) }, { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

// --- PR 1b fakes -------------------------------------------------------------
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
type Shot = { action: string; options: any };
function fakeBrowser(answer: (o: any) => Response | Promise<Response> = () => new Response(PNG, { status: 200 })) {
  const calls: Shot[] = [];
  let fetches = 0;
  return {
    calls, fetches: () => fetches,
    binding: {
      fetch: async () => { fetches += 1; throw new Error('BROWSER.fetch must not be called'); },
      quickAction: async (action: string, options: any) => { calls.push({ action, options }); return answer(options); },
    },
  };
}
function fakeR2() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    bucket: {
      get: async (k: string) => objects.has(k) ? { arrayBuffer: async () => objects.get(k)!.buffer.slice(0) } : null,
      put: async (k: string, v: Uint8Array) => { objects.set(k, new Uint8Array(v)); return {}; },
    },
  };
}
async function call(db: DatabaseSync, path: string, o: { who?: number | null; method?: string; json?: unknown; headers?: Record<string, string>;
  browser?: ReturnType<typeof fakeBrowser>; r2?: ReturnType<typeof fakeR2> } = {}) {
  const headers = { ...(await auth(o.who === undefined ? 1 : o.who)), ...(o.headers || {}) };
  if (o.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app.request(`/contracts${path}`, { method: o.method || (o.json !== undefined ? 'POST' : 'GET'), headers,
    body: o.json !== undefined ? JSON.stringify(o.json) : undefined },
  { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), BROWSER: o.browser?.binding, FILES: o.r2?.bucket });
  return res;
}

test('D717/D758 /templates/outside lists exactly the bundled keys still sent as the file, each with the row it counts under', async () => {
  const db = fixture();
  const r = await get(db, '/templates/outside');
  assert.equal(r.status, 200);
  // D758 PR 1: only partner onboarding still sends its bundled file.
  assert.deepEqual(r.body.items.map((i: any) => [i.key, i.title, i.doc_type, i.counted_under.slug]), [
    ['partner_msa_v1', 'Partner Master Services Agreement', 'partner_services', 'partner_services'],
  ]);
  for (const i of r.body.items) {
    const row = db.prepare('SELECT title FROM legal_templates WHERE slug = ? AND is_active = 1').get(i.counted_under.slug) as any;
    assert.equal(i.counted_under.title, row?.title ?? null, i.key);
    assert.notEqual(i.title, i.counted_under.title, 'the card never repeats the title of the row it counts under');
  }
  assert.ok(r.body.items.every((i: any) => i.counted_under.title), 'the row is in the seed catalog');
  assert.equal((await get(db, '/templates/outside', null)).status, 401);
  assert.equal((await get(db, '/templates/outside', 3)).status, 403);
});

test('D717 a template thumbnail is drawn once per version by quickAction("screenshot") and then served from FILES', async () => {
  const db = fixture();
  const browser = fakeBrowser();
  const r2 = fakeR2();
  const first = await call(db, '/templates/store/investor_nda_axal/thumbnail.png', { browser, r2 });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Content-Type'), 'image/png');
  assert.equal(first.headers.get('Cache-Control'), 'private, max-age=86400');
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), PNG);
  assert.equal(browser.calls.length, 1);
  const [shot] = browser.calls;
  assert.equal(shot.action, 'screenshot');
  assert.deepEqual(shot.options.viewport, { width: 816, height: 1056, deviceScaleFactor: 0.5 });
  assert.match(shot.options.html, /^<!doctype html>/i);
  const title = (db.prepare("SELECT title FROM legal_templates WHERE slug = 'investor_nda_axal' AND is_active = 1").get() as any).title;
  assert.ok(shot.options.html.includes(title.replace(/&/g, '&amp;')), 'the paper carries the title');
  assert.doesNotMatch(shot.options.html, /<script/i);
  const version = (db.prepare("SELECT version FROM legal_templates WHERE slug = 'investor_nda_axal' AND is_active = 1").get() as any).version;
  const keys = [...r2.objects.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], new RegExp(`^legal/thumbnails/[0-9a-f]{64}/v${version}-[0-9a-f]{16}\\.png$`));
  assert.equal(first.headers.get('ETag'), `"${keys[0]}"`);

  const again = await call(db, '/templates/store/investor_nda_axal/thumbnail.png', { browser, r2 });
  assert.equal(again.status, 200);
  assert.deepEqual(new Uint8Array(await again.arrayBuffer()), PNG);
  assert.equal(browser.calls.length, 1, 'a hit draws nothing');
  const unchanged = await call(db, '/templates/store/investor_nda_axal/thumbnail.png', { browser, r2, headers: { 'If-None-Match': `"${keys[0]}"` } });
  assert.equal(unchanged.status, 304);

  db.prepare("UPDATE legal_templates SET version = version + 1 WHERE slug = 'investor_nda_axal' AND is_active = 1").run();
  const bumped = await call(db, '/templates/store/investor_nda_axal/thumbnail.png', { browser, r2 });
  assert.equal(bumped.status, 200);
  assert.equal(browser.calls.length, 2, 'a new version draws a new image');
  assert.equal(r2.objects.size, 2);
  assert.ok([...r2.objects.keys()].some(k => k.includes(`/v${version + 1}-`)));
  assert.equal(browser.fetches(), 0);

  assert.equal((await call(db, '/templates/store/no_such_slug/thumbnail.png', { browser, r2 })).status, 404);
  assert.equal((await call(db, '/templates/store/investor_nda_axal/thumbnail.png', { browser, r2, who: 3 })).status, 403);
  assert.equal((await call(db, '/templates/store/investor_nda_axal/thumbnail.png', { browser, r2, who: null })).status, 401);
});

test('D717 a throw, a non-PNG body, a 2 MB body and no binding each answer 503 thumbnail_unavailable and write nothing', async () => {
  const db = fixture();
  const answers: Array<[string, ReturnType<typeof fakeBrowser> | undefined]> = [
    ['throw', fakeBrowser(() => { throw new Error('down'); })],
    ['not png', fakeBrowser(() => new Response('%PDF-1.7 not an image', { status: 200 }))],
    ['too large', fakeBrowser(() => { const b = new Uint8Array(2 * 1024 * 1024); b.set(PNG); return new Response(b, { status: 200 }); })],
    ['status', fakeBrowser(() => new Response('no', { status: 500 }))],
    ['unbound', undefined],
  ];
  for (const [label, browser] of answers) {
    const r2 = fakeR2();
    const res = await call(db, '/templates/store/investor_nda_axal/thumbnail.png', { browser, r2 });
    assert.equal(res.status, 503, label);
    const body = await res.json() as any;
    assert.equal(body.error, 'thumbnail_unavailable', label);
    assert.equal(body.message, 'Thumbnail not drawn: the page renderer did not answer.', label);
    assert.equal(r2.objects.size, 0, label);
    if (browser) assert.equal(browser.fetches(), 0, label);
  }
});

test('D717 a stub\'s thumbnail reads "No body in the store yet.", and a counsel-draft stub also "Stub — counsel to draft."', async () => {
  const db = fixture();
  const ins = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub, created_by, updated_by)
    VALUES (?, ?, 'fund', '', '[]', 1, 1, 1, 1, 1)`);
  ins.run('lpa_initial', 'Initial Limited Partnership Agreement');
  ins.run('demo_house_stub', 'Demo house stub');
  const browser = fakeBrowser();
  for (const slug of ['lpa_initial', 'demo_house_stub']) {
    const res = await call(db, `/templates/store/${slug}/thumbnail.png`, { browser, r2: fakeR2() });
    assert.equal(res.status, 200, slug);
  }
  const [counsel, house] = browser.calls.map(c => c.options.html as string);
  assert.ok(counsel.includes('No body in the store yet.'));
  assert.ok(counsel.includes('Stub — counsel to draft.'));
  assert.ok(house.includes('No body in the store yet.'));
  assert.ok(!house.includes('counsel to draft'));
});

test('D717/D758 an outside key draws its bundled body; a key now sent from its row, a catalog key and an unknown key are 404', async () => {
  const db = fixture();
  const browser = fakeBrowser();
  const r2 = fakeR2();
  const res = await call(db, '/templates/outside/partner_msa_v1/thumbnail.png', { browser, r2 });
  assert.equal(res.status, 200);
  assert.equal(browser.calls.length, 1);
  assert.ok(browser.calls[0].options.html.includes('Partner Master Services Agreement'));
  assert.match([...r2.objects.keys()][0], /^legal\/thumbnails\/outside\/[0-9a-f]{64}\/[0-9a-f]{16}-[0-9a-f]{16}\.png$/);
  for (const key of ['investor_nda_v1', 'mentor_nda_v1', 'mentor_disclaimer_v1', 'nda_3way_founder_investor_axal_v1', 'tos_v1', 'nope']) {
    assert.equal((await call(db, `/templates/outside/${key}/thumbnail.png`, { browser, r2 })).status, 404, key);
  }
  assert.equal(browser.calls.length, 1, 'a 404 never draws');
  assert.equal((await call(db, '/templates/outside/partner_msa_v1/thumbnail.png', { browser, r2, who: 3 })).status, 403);
  assert.equal(browser.fetches(), 0);
});

test('D717 render.pdf answers the draft as a PDF, never cached, with its renderer; 413 over 256 KB', async () => {
  const db = fixture();
  const browser = fakeBrowser(() => new Response('down', { status: 500 }));
  const res = await call(db, '/templates/render.pdf', { browser, json: { title: 'Draft NDA', slug: 'investor_nda_axal', body: '## 1. Terms\n\nThe parties agree.' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Axal-Renderer'), 'pdf_lib', 'Browser Run answered 500, so the fallback drew it');
  assert.equal(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()).subarray(0, 5)), '%PDF-');
  assert.equal(browser.calls[0].action, 'pdf');
  assert.equal(browser.fetches(), 0);
  const big = await call(db, '/templates/render.pdf', { browser, json: { title: 'Big', body: 'x'.repeat(256 * 1024 + 1) } });
  assert.equal(big.status, 413);
  assert.equal(((await big.json()) as any).error, 'body_too_large');
  assert.equal((await call(db, '/templates/render.pdf', { browser, json: { title: 'x', body: 'y' }, who: 3 })).status, 403);
});

test('D717 the render route takes the unsaved kind and party, checks them as a save does, and lists who fills each field', async () => {
  const db = fixture();
  const body = 'Between {{company.legal_name}} and {{recipient_name}}, effective {{effective_date}}. {{governing_law}} applies.';
  const render = async (extra: Record<string, unknown>) => {
    const res = await call(db, '/templates/render', { json: { title: 'Advisor NDA', slug: 'mentor_nda_axal', body, fonts: 'omit', ...extra } });
    return { status: res.status, body: await res.json() as any };
  };
  const plain = await render({});
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body.fields, [
    { key: 'company.legal_name', filled_by: 'sender' },
    { key: 'effective_date', filled_by: 'send' },
    { key: 'governing_law', filled_by: 'sender' },
    { key: 'recipient_name', filled_by: 'send' },
  ]);
  assert.ok(plain.body.html.includes('Axal VC Management LLC'), 'the slug gives Management');
  assert.ok(!plain.body.html.includes('Axal VC Holdings LLC'));

  const gp = await render({ axal_party: 'gp' });
  assert.equal(gp.status, 200);
  assert.ok(gp.body.html.includes('Axal VC GP LLC'), 'the unsaved party prints');
  assert.ok(!gp.body.html.includes('Axal VC Management LLC'));

  db.prepare("UPDATE legal_templates SET axal_party = 'holdings' WHERE slug = 'mentor_nda_axal' AND is_active = 1").run();
  assert.ok((await render({})).body.html.includes('Axal VC Holdings LLC'), 'an absent key keeps the stored party');
  const reset = await render({ axal_party: null });
  assert.ok(reset.body.html.includes('Axal VC Management LLC'), 'null returns to the slug');
  assert.ok(!reset.body.html.includes('Axal VC Holdings LLC'));

  assert.equal((await render({ doc_kind: 'memo' })).body.error, 'kind_invalid');
  assert.equal((await render({ axal_party: 'treasurer' })).body.error, 'party_invalid');
  const mismatch = await render({ doc_kind: 'policy', axal_party: 'gp' });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error, 'kind_party_mismatch');
});
