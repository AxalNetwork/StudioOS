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

test('D717/D758 /templates/outside lists exactly the bundled keys still sent as the file: none since D758 PR 2', async () => {
  const db = fixture();
  const r = await get(db, '/templates/outside');
  assert.equal(r.status, 200);
  // D758 PR 2: partner onboarding sends the Partner Services row, so no sender
  // sends a bundled file and the Templates tab draws no "Not in the catalog".
  assert.deepEqual(r.body, { items: [] });
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

test('D717/D758 every outside key is 404 since D758 PR 2: the five bundled keys, a catalog key and an unknown key, and none draws', async () => {
  const db = fixture();
  const browser = fakeBrowser();
  const r2 = fakeR2();
  for (const key of ['partner_msa_v1', 'investor_nda_v1', 'mentor_nda_v1', 'mentor_disclaimer_v1', 'nda_3way_founder_investor_axal_v1', 'tos_v1', 'nope']) {
    assert.equal((await call(db, `/templates/outside/${key}/thumbnail.png`, { browser, r2 })).status, 404, key);
  }
  assert.equal(browser.calls.length, 0, 'a 404 never draws');
  assert.equal(r2.objects.size, 0, 'and writes nothing to FILES');
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

// ─────────────────────────────────────────── D758 (#1864): the generated documents

import { escapeHtml, paperHtml, paperModel } from '../src/services/legalPaper.ts';
import { PAY_WARNING } from '../src/services/payInstructions.ts';
import { RECEIVING_BRACKET } from '../src/services/fundStructure.ts';

const GENERATED_KEYS = [
  'capital_call_notice', 'distribution_notice', 'default_notice', 'management_fee_statement', 'management_fee_invoice',
  'platform_licence_fee_invoice', 'payment_instructions_letter', 'territory_licence_fee_invoice', 'subscription_booklet', 'structure_of_the_fund', 'certificate_of_completion',
];
/** 468's Fund I catalog and 478's securities_legend stub, over the D717 fixture. */
function generatedFixture() {
  const db = fixture();
  db.exec(readFileSync(`${MIGRATIONS}/468_legal_catalog_fund_i.sql`, 'utf8'));
  db.exec(`INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    SELECT 'securities_legend', 'Securities Legend — Fund I Offering Documents', 'fund', '', '[]', 1, 1, 1
     WHERE NOT EXISTS (SELECT 1 FROM legal_templates t WHERE t.slug = 'securities_legend')`);
  return db;
}
/** The fixture's D1, recording every SQL string it prepares. */
function recordingCall(db: DatabaseSync, seen: string[]) {
  return async (path: string, o: { browser?: ReturnType<typeof fakeBrowser>; r2?: ReturnType<typeof fakeR2> } = {}) => {
    const d1: any = d1Over(db);
    const prepare = d1.prepare.bind(d1);
    d1.prepare = (sql: string) => { seen.push(sql); return prepare(sql); };
    const res = await app.request(`/contracts${path}`, { headers: await auth(1) },
      { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1, BROWSER: o.browser?.binding, FILES: o.r2?.bucket });
    return res;
  };
}

test('D758 /templates/generated lists the ten, with their kinds, party lines, library rows, refusals and versions', async () => {
  const db = generatedFixture();
  const r = await get(db, '/templates/generated');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const items = r.body.items;
  assert.deepEqual(items.map((i: any) => i.key), GENERATED_KEYS);
  assert.deepEqual(items.map((i: any) => [i.title, i.kind, i.party_line]), [
    ['Capital Call Notice', 'notice', 'Axal VC GP LLC (for the Fund)'],
    ['Distribution Notice', 'notice', 'Axal VC GP LLC (for the Fund)'],
    ['Notice of Default', 'notice', 'Axal VC GP LLC (for the Fund)'],
    ['Management Fee Statement', 'notice', 'Axal VC GP LLC (for the Fund), to each limited partner'],
    ['Management Fee Invoice', 'notice', 'Axal VC GP LLC, to the Fund'],
    ['Platform Licence Fee Invoice', 'notice', 'Axal VC Holdings LLC, to its licensee'],
    ['Payment Instructions', 'notice', 'Issued per entity'],
    ['Territory Licence Fee Invoice', 'notice', 'Axal VC Holdings LLC, to a territory licensee'],
    ['Subscription Booklet', 'booklet', 'Axal VC GP LLC (for the Fund)'],
    ['Structure of the Fund', 'page', 'carried by the PPM, the Subscription Booklet and the Compliance Manual'],
    ['Certificate of completion', 'page', 'appended to every signed copy'],
  ]);
  const by = Object.fromEntries(items.map((i: any) => [i.key, i]));
  const call0 = by.capital_call_notice;
  assert.deepEqual(call0.prose.map((p: any) => [p.slug, p.has_body, p.counsel_draft, p.missing]), [['capital_call_notice', false, true, false]]);
  assert.deepEqual(call0.refusal, { code: 'notice_body_missing', message: 'Counsel has not written this notice yet, so it cannot issue.' });
  for (const k of ['management_fee_statement', 'management_fee_invoice', 'platform_licence_fee_invoice', 'payment_instructions_letter',
    'territory_licence_fee_invoice', 'structure_of_the_fund', 'certificate_of_completion']) {
    assert.deepEqual([by[k].prose, by[k].refusal], [[], null], k);
  }
  const booklet = by.subscription_booklet;
  assert.deepEqual(booklet.prose.map((p: any) => [p.part, p.slug]), [
    [1, 'securities_legend'], [3, 'subscription'], [4, 'lp_investor_questionnaire'], [5, 'lp_aml_kyc_certification'],
    [6, 'lp_tax_status_certification'], [7, 'lp_electronic_delivery_consent'], [9, 'gp_closing_certificate'],
  ]);
  const missingParts = booklet.prose.filter((p: any) => !p.has_body).map((p: any) => p.part);
  assert.equal(booklet.refusal.code, 'booklet_part_missing');
  assert.deepEqual(booklet.refusal.parts, missingParts);
  assert.equal(booklet.refusal.message, `The booklet cannot be submitted yet: Part ${missingParts.join(', Part ')} has no text from counsel.`);
  for (const i of items) assert.match(i.thumbnail_version, /^[0-9a-f]{16}$/, i.key);
  // Counsel writes the three notices: they read a body and no refusal.
  db.exec("UPDATE legal_templates SET is_stub = 0, body_md = 'The notice text for {{lp.name}}.' WHERE slug IN ('capital_call_notice','distribution_notice','default_notice')");
  const after = Object.fromEntries((await get(db, '/templates/generated')).body.items.map((i: any) => [i.key, i]));
  for (const k of ['capital_call_notice', 'distribution_notice', 'default_notice']) {
    assert.deepEqual([after[k].prose[0].has_body, after[k].refusal], [true, null], k);
  }
  assert.notEqual(after.capital_call_notice.thumbnail_version, call0.thumbnail_version, 'a new body is a new version');
  assert.equal((await get(db, '/templates/generated', null)).status, 401);
  assert.equal((await get(db, '/templates/generated', 3)).status, 403);
});

test('D758 the list answers 503 generated_unreadable when the library cannot be read', async () => {
  const db = generatedFixture();
  // requireAdmin reads the user first, so the D1 fails only on the library.
  const failing: any = d1Over(db);
  const prep = failing.prepare.bind(failing);
  failing.prepare = (sql: string) => { if (/legal_templates/.test(sql)) throw new Error('no such table: legal_templates'); return prep(sql); };
  const r = await app.request('/contracts/templates/generated', { headers: await auth(1) }, { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: failing });
  assert.equal(r.status, 503);
  const body = await r.json() as any;
  assert.deepEqual([body.error, body.message], ['generated_unreadable', 'Generated documents are unreadable. Try again.']);
});

test('D758 a notice\'s thumbnail is its specimen: brackets, the warning, no figure, no Draft; drawn once; a new body redraws it', async () => {
  const db = generatedFixture();
  const browser = fakeBrowser();
  const r2 = fakeR2();
  const first = await call(db, '/templates/generated/capital_call_notice/thumbnail.png', { browser, r2 });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Content-Type'), 'image/png');
  assert.equal(browser.calls.length, 1);
  assert.equal(browser.calls[0].action, 'screenshot');
  assert.deepEqual(browser.calls[0].options.viewport, { width: 816, height: 1056, deviceScaleFactor: 0.5 });
  const html = browser.calls[0].options.html as string;
  for (const s of ['Capital Call Notice', 'SPECIMEN', 'Stub — counsel to draft', escapeHtml(PAY_WARNING), escapeHtml(RECEIVING_BRACKET)]) {
    assert.ok(html.includes(s), s);
  }
  for (const label of ['Notice date', 'Call number', 'Amount due', 'Due date']) assert.ok(html.includes(`[${label}]`), label);
  assert.doesNotMatch(html, /\$\d/);
  assert.doesNotMatch(html, /<div class="state-banner|DRAFT — for counsel review|class="diagonal draft"/);
  const keys = [...r2.objects.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^legal\/thumbnails\/generated\/[0-9a-f]{64}\/[0-9a-f]{16}-[0-9a-f]{16}\.png$/);
  assert.equal(first.headers.get('ETag'), `"${keys[0]}"`);
  const list = (await get(db, '/templates/generated')).body.items.find((i: any) => i.key === 'capital_call_notice');
  assert.ok(keys[0].includes(`/${list.thumbnail_version}-`), 'the list names the image');
  assert.equal((await call(db, '/templates/generated/capital_call_notice/thumbnail.png', { browser, r2 })).status, 200);
  assert.equal(browser.calls.length, 1, 'a hit draws nothing');
  assert.equal((await call(db, '/templates/generated/capital_call_notice/thumbnail.png', { browser, r2, headers: { 'If-None-Match': `"${keys[0]}"` } })).status, 304);
  db.exec("UPDATE legal_templates SET is_stub = 0, body_md = 'Pay {{call.amount}} by {{call.due_date}}.' WHERE slug = 'capital_call_notice'");
  const redrawn = await call(db, '/templates/generated/capital_call_notice/thumbnail.png', { browser, r2 });
  assert.equal(redrawn.status, 200);
  assert.equal(browser.calls.length, 2, 'a new body draws once more');
  assert.equal(r2.objects.size, 2);
  const next = browser.calls[1].options.html as string;
  assert.ok(next.includes('Pay [') && !next.includes('Stub — counsel to draft'), 'the body, with bracket labels');
  assert.equal(browser.fetches(), 0);
});

test('D758 no specimen reads a record or an account: the list and all ten thumbnails touch the library only', async () => {
  const db = generatedFixture();
  const seen: string[] = [];
  const req = recordingCall(db, seen);
  const browser = fakeBrowser();
  assert.equal((await req('/templates/generated')).status, 200);
  for (const k of GENERATED_KEYS) assert.equal((await req(`/templates/generated/${k}/thumbnail.png`, { browser, r2: fakeR2() })).status, 200, k);
  assert.ok(seen.some((q) => /legal_templates/.test(q)), 'the library was read');
  for (const q of seen) {
    assert.doesNotMatch(q, /entity_bank_accounts|limited_partners|capital_calls|legal_notices|lp_applications|\bfund_|mercury_/, q);
  }
  assert.equal(browser.fetches(), 0);
});

test('D758 the booklet draws its cover, the structure page and the certificate draw alone', async () => {
  const db = generatedFixture();
  const browser = fakeBrowser();
  for (const k of ['subscription_booklet', 'structure_of_the_fund', 'certificate_of_completion']) {
    assert.equal((await call(db, `/templates/generated/${k}/thumbnail.png`, { browser, r2: fakeR2() })).status, 200, k);
  }
  const [booklet, structure, cert] = browser.calls.map((c) => c.options.html as string);
  assert.match(booklet, /class="cover/);
  for (const [k, h] of [['booklet', booklet], ['structure', structure], ['certificate', cert]]) {
    assert.ok(h.includes('class="diagonal specimen"') && !h.includes('DRAFT — for counsel review'), `${k}: a specimen, never a Draft`);
  }
  assert.ok(booklet.includes('Subscription Booklet'));
  assert.match(structure, /structure-page/);
  assert.ok(structure.includes(escapeHtml(RECEIVING_BRACKET)));
  assert.doesNotMatch(structure, /class="cover|class="preamble"/);
  assert.ok(cert.includes('Certificate of completion') && cert.includes('[envelope id]'));
  assert.doesNotMatch(cert, /class="execution/);
  assert.throws(() => paperHtml(paperModel({ title: 'T', body: 'B', bodySha256: 'f'.repeat(64), state: { kind: 'specimen' } }),
    { pageSize: 'letter', cover: 'dark', medium: 'screen', fonts: 'omit', only: 'certificate' }), TypeError);
  assert.throws(() => paperHtml(paperModel({ title: 'T', body: 'B', bodySha256: 'f'.repeat(64), state: { kind: 'specimen' } }),
    { pageSize: 'letter', cover: 'dark', medium: 'screen', fonts: 'omit', only: 'structure' }), TypeError);
});

test('D758 a generated thumbnail that cannot be drawn answers 503 and writes nothing; an unknown key is 404', async () => {
  const db = generatedFixture();
  const answers: Array<[string, ReturnType<typeof fakeBrowser> | undefined]> = [
    ['throw', fakeBrowser(() => { throw new Error('down'); })],
    ['not png', fakeBrowser(() => new Response('%PDF-1.7 not an image', { status: 200 }))],
    ['too large', fakeBrowser(() => { const b = new Uint8Array(2 * 1024 * 1024); b.set(PNG); return new Response(b, { status: 200 }); })],
    ['status', fakeBrowser(() => new Response('no', { status: 500 }))],
    ['unbound', undefined],
  ];
  for (const [label, browser] of answers) {
    const r2 = fakeR2();
    const res = await call(db, '/templates/generated/default_notice/thumbnail.png', { browser, r2 });
    assert.equal(res.status, 503, label);
    const body = await res.json() as any;
    assert.deepEqual([body.error, body.message], ['thumbnail_unavailable', 'Thumbnail not drawn: the page renderer did not answer.'], label);
    assert.equal(r2.objects.size, 0, label);
    if (browser) assert.equal(browser.fetches(), 0, label);
  }
  // A specimen that cannot be built: the library cannot be read.
  const failing: any = d1Over(db);
  const prep = failing.prepare.bind(failing);
  failing.prepare = (sql: string) => { if (/legal_templates/.test(sql)) throw new Error('no such table: legal_templates'); return prep(sql); };
  const browser = fakeBrowser();
  const r2 = fakeR2();
  const res = await app.request('/contracts/templates/generated/default_notice/thumbnail.png', { headers: await auth(1) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: failing, BROWSER: browser.binding, FILES: r2.bucket });
  assert.equal(res.status, 503);
  assert.equal((await res.json() as any).error, 'thumbnail_unavailable');
  assert.equal(browser.calls.length, 0);
  assert.equal(r2.objects.size, 0);
  const b2 = fakeBrowser();
  assert.equal((await call(db, '/templates/generated/nope/thumbnail.png', { browser: b2 })).status, 404);
  assert.equal((await call(db, '/templates/generated/default_notice/thumbnail.png', { browser: b2, who: 3 })).status, 403);
  assert.equal((await call(db, '/templates/generated/default_notice/thumbnail.png', { browser: b2, who: null })).status, 401);
  assert.equal(b2.calls.length, 0);
});
