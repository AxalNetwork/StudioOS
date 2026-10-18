/**
 * D716 (#1781, PR 2) — the Subscription Booklet's store over real SQLite:
 * field ids, who may open, ticks, submit, the audited admin read, and
 * withdraw. Then the paper, which draws #1776's (PR 1): a page per part, the
 * footer, the contents, the X squares, and the admin PDF. `main` already tests
 * the part order, the stub and the triggers (`legal_notice_kinds_d716.test.ts`).
 *
 * The store is the baseline's tables plus migration 478, read from its file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import booklets from '../src/routes/fund_booklets.ts';
import { bookletFields } from '../src/services/subscriptionBooklet.ts';
import { PDFDocument, PDFName } from 'pdf-lib';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'lp_applications', 'legal_templates', 'legal_template_versions'];
const SCHEMA = TABLES.map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + readFileSync(new URL('../sql/migrations/478_fund_notices_booklets.sql', import.meta.url), 'utf8');
const SECRET = ['d716', 'booklet', 'fixture', 'secret'].join('-');

const ADMIN = 1, APPLICANT = 2, PENDING = 3, STRANGER = 4, FOUNDER = 5;

const BODIES: Record<string, string> = {
  subscription: '## Article 1 Subscription\nThe applicant subscribes.\n- [ ] I have read the Private Placement Memorandum.\n- [ ] I subscribe for the amount below.',
  lp_investor_questionnaire: '- [ ] I am an accredited investor.\n- [ ] I am a qualified purchaser.',
  lp_aml_kyc_certification: '- [ ] The funds are not the proceeds of crime.',
  lp_tax_status_certification: '- [ ] I am a U.S. person.',
  lp_electronic_delivery_consent: '- [ ] I consent to electronic delivery.',
  // A task item here is the GP's, not the applicant's: Part 9 carries no field.
  gp_closing_certificate: 'The General Partner accepts the subscription.\n- [ ] The General Partner has reviewed the booklet.',
};

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const [id, role, name] of [[ADMIN, 'admin', 'Ada Admin'], [APPLICANT, 'investor', 'Ivy Applicant'], [PENDING, 'investor', 'Pat Pending'],
    [STRANGER, 'investor', 'Sam Stranger'], [FOUNDER, 'founder', 'Fay Founder']] as const) u.run(id, role, name, `user${id}@example.test`);
  db.exec(`INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status) VALUES
    (21, ${APPLICANT}, 'spinout-fund-i', 'individual', 'approved'),
    (22, ${PENDING}, 'spinout-fund-i', 'individual', 'pending')`);
  const t = db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES (?, ?, 'fund', ?, '[]', 1, 1, 0)`);
  for (const [slug, body] of Object.entries(BODIES)) t.run(slug, slug, body);
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/fund-booklets', booklets);
  async function call(who: number, method: string, path: string, body?: unknown, opts: { envExtra?: Record<string, unknown>; impersonatedBy?: number } = {}) {
    const claims: Record<string, unknown> = { user_id: who, ...(opts.impersonatedBy ? { impersonated_by: opts.impersonatedBy } : {}) };
    const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(`/api/fund-booklets${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { ...env, ...(opts.envExtra || {}) }));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  return { db, call, one };
}

const fillLegend = (f: ReturnType<typeof fixture>) =>
  f.db.prepare("UPDATE legal_templates SET body_md = 'THESE INTERESTS HAVE NOT BEEN REGISTERED.', is_stub = 0 WHERE slug = 'securities_legend'").run();

test('D716 a field id is <slug>:<n>:<hash>, stable for the same text and new when the text changes', async () => {
  const a = await bookletFields('lp_investor_questionnaire', '- [ ] I am accredited.\n- [x] I am a qualified purchaser.\nPlain line.');
  assert.equal(a.length, 2);
  assert.match(a[0].id, /^lp_investor_questionnaire:1:[0-9a-f]{12}$/);
  assert.match(a[1].id, /^lp_investor_questionnaire:2:[0-9a-f]{12}$/);
  const again = await bookletFields('lp_investor_questionnaire', '- [ ] I am accredited.\n- [ ] I am a qualified purchaser.');
  assert.deepEqual(again.map((x) => x.id), a.map((x) => x.id), 'the same words keep their ids');
  const reworded = await bookletFields('lp_investor_questionnaire', '- [ ] I am an accredited investor.\n- [ ] I am a qualified purchaser.');
  assert.notEqual(reworded[0].id, a[0].id, 'a reworded item gets a new id');
  assert.equal(reworded[1].id, a[1].id);
});

test('D716 only an approved applicant opens a booklet; anyone else gets 404', async () => {
  const f = fixture();
  for (const who of [PENDING, STRANGER, FOUNDER]) {
    assert.equal((await f.call(who, 'POST', '/mine')).status, 404, `user ${who} opens`);
    assert.equal((await f.call(who, 'GET', '/mine')).status, 404, `user ${who} reads`);
  }
  assert.equal((await f.call(APPLICANT, 'GET', '/mine')).status, 404, 'no booklet before it is opened');
  const opened = await f.call(APPLICANT, 'POST', '/mine');
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  assert.deepEqual(opened.body.parts.map((p: any) => p.part), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const fields = opened.body.parts.flatMap((p: any) => p.fields);
  assert.equal(fields.length, 7, 'the task items of Parts 3 to 7, none from Part 9');
  assert.ok(fields.every((x: any) => x.checked === false));
  assert.deepEqual(opened.body.missing_parts, [1], 'the cover legend is still a stub');
  const reopened = await f.call(APPLICANT, 'POST', '/mine');
  assert.deepEqual([reopened.status, reopened.body.uid], [200, opened.body.uid], 'a second open returns the live booklet');
  assert.equal(f.one('SELECT COUNT(*) AS n FROM fund_subscription_booklets').n, 1);
});

test('D716 the applicant ticks known fields; an unknown field is 400, and a support session cannot answer', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const ids = opened.parts.flatMap((p: any) => p.fields.map((x: any) => x.id));
  const r = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[0], checked: true }, { field_id: ids[2], checked: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ticked = r.body.parts.flatMap((p: any) => p.fields).filter((x: any) => x.checked).map((x: any) => x.id);
  assert.deepEqual(ticked.sort(), [ids[0], ids[2]].sort());
  assert.notEqual(r.body.digest, opened.digest, 'the digest covers the ticks');
  const untick = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[2], checked: false }] });
  assert.equal(untick.body.parts.flatMap((p: any) => p.fields).filter((x: any) => x.checked).length, 1);
  const bad = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: 'subscription:9:000000000000', checked: true }] });
  assert.deepEqual([bad.status, bad.body.error], [400, 'field_unknown']);
  assert.ok(!JSON.stringify(bad.body).includes('subscription:9'), 'the refusal echoes no input');
  assert.equal((await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: 'all' })).body.error, 'answers_invalid');
  const support = await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[1], checked: true }] }, { impersonatedBy: ADMIN });
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
});

test('D716 submit refuses a stub part by name and a stale digest, then freezes; the ticks are then sealed', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const ids = opened.parts.flatMap((p: any) => p.fields.map((x: any) => x.id));
  const answered = (await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: ids.map((id: string) => ({ field_id: id, checked: true })) })).body;
  const stub = await f.call(APPLICANT, 'POST', '/mine/submit', { digest: answered.digest });
  assert.deepEqual([stub.status, stub.body.error, stub.body.parts], [409, 'booklet_part_missing', [1]]);
  assert.ok(stub.body.message.includes('Part 1'));

  fillLegend(f);
  const stale = await f.call(APPLICANT, 'POST', '/mine/submit', { digest: answered.digest });
  assert.deepEqual([stale.status, stale.body.error], [409, 'content_changed'], 'the legend changed the parts, so the old digest is stale');
  const fresh = (await f.call(APPLICANT, 'GET', '/mine')).body;
  // A body edited after reading changes the digest too.
  f.db.prepare("UPDATE legal_templates SET body_md = body_md || '\nMore.' WHERE slug = 'gp_closing_certificate'").run();
  assert.equal((await f.call(APPLICANT, 'POST', '/mine/submit', { digest: fresh.digest })).body.error, 'content_changed');
  const current = (await f.call(APPLICANT, 'GET', '/mine')).body;
  const done = await f.call(APPLICANT, 'POST', '/mine/submit', { digest: current.digest });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.digest, current.digest);

  const row = f.one('SELECT status, digest, frozen_json, submitted_at FROM fund_subscription_booklets');
  assert.equal(row.status, 'submitted');
  const frozen = JSON.parse(row.frozen_json);
  assert.equal(frozen.parts.length, 9);
  assert.equal(frozen.ticks.length, 7);
  assert.ok(frozen.ticks.every((t: [string, boolean]) => t[1] === true));
  assert.equal((await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[0], checked: false }] })).body.error, 'booklet_not_open');
  assert.equal((await f.call(APPLICANT, 'POST', '/mine/submit', { digest: current.digest })).body.error, 'booklet_not_open');
  assert.throws(() => f.db.exec("UPDATE fund_booklet_answers SET checked = 0"), /not open/);
  assert.throws(() => f.db.exec("UPDATE fund_subscription_booklets SET digest = '" + 'e'.repeat(64) + "'"), /frozen/);
  // After submit the reader keeps the frozen digest even if a body changes.
  f.db.prepare("UPDATE legal_templates SET body_md = body_md || '\nLater.' WHERE slug = 'gp_closing_certificate'").run();
  assert.equal((await f.call(APPLICANT, 'GET', '/mine')).body.digest, current.digest);
});

test('D716 the admin reads: the list carries no ticks, one booklet\'s read is audited, and only an Admin on HQ reads', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const ids = opened.parts.flatMap((p: any) => p.fields.map((x: any) => x.id));
  await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: ids[0], checked: true }] });
  const list = await f.call(ADMIN, 'GET', '');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.booklets.map((b: any) => [b.uid, b.status, b.user_id]), [[opened.uid, 'open', APPLICANT]]);
  assert.ok(!JSON.stringify(list.body).includes(ids[0]) && !JSON.stringify(list.body).includes('checked'), 'no ticks in the list');
  assert.equal(f.one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.read'").n, 0);
  const read = await f.call(ADMIN, 'GET', `/${opened.uid}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.parts.flatMap((p: any) => p.fields).find((x: any) => x.id === ids[0]).checked, true);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.read'").n, 1, 'the read of ticks is audited');
  for (const who of [APPLICANT, FOUNDER]) assert.equal((await f.call(who, 'GET', '')).status, 403, `user ${who}`);
  const branch = await f.call(ADMIN, 'GET', '', undefined, { envExtra: { BRANCH_CODE: 'sg' } });
  assert.deepEqual([branch.status, branch.body.error], [403, 'hq_only']);
  const support = await f.call(ADMIN, 'GET', `/${opened.uid}`, undefined, { impersonatedBy: ADMIN });
  assert.deepEqual([support.status, support.body.code], [403, 'support_session_refused']);
  assert.equal((await f.call(ADMIN, 'GET', '/no-such-uid')).status, 404);
});

test('D716 withdraw needs a reason of 10 to 200 characters, then lets the applicant open a new booklet', async () => {
  const f = fixture();
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  for (const reason of [undefined, 'short', 'x'.repeat(201)]) {
    const r = await f.call(ADMIN, 'POST', `/${opened.uid}/withdraw`, { reason });
    assert.deepEqual([r.status, r.body.error], [400, 'reason_invalid'], String(reason));
  }
  assert.equal((await f.call(APPLICANT, 'POST', `/${opened.uid}/withdraw`, { reason: 'The applicant asked to restart.' })).status, 403);
  const done = await f.call(ADMIN, 'POST', `/${opened.uid}/withdraw`, { reason: 'The applicant asked to restart.' });
  assert.deepEqual([done.status, done.body.status], [200, 'withdrawn']);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.withdraw'").n, 1);
  assert.equal((await f.call(ADMIN, 'POST', `/${opened.uid}/withdraw`, { reason: 'The applicant asked to restart.' })).body.error, 'booklet_withdrawn');
  assert.equal((await f.call(APPLICANT, 'GET', '/mine')).status, 404, 'the withdrawn booklet is no longer theirs to read');
  const again = await f.call(APPLICANT, 'POST', '/mine');
  assert.equal(again.status, 201);
  assert.notEqual(again.body.uid, opened.uid);
  assert.throws(() => f.db.exec('DELETE FROM fund_subscription_booklets'), /never deleted/);
});

// ── The paper (PR 1) ────────────────────────────────────────────────────────

/** Each part's section, by part number, from the paper's HTML. */
function sections(html: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of html.matchAll(/<section class="booklet-part part-(\d+)">([\s\S]*?)(?=<section class="booklet-part|<\/main>)/g)) out.set(Number(m[1]), m[2]);
  return out;
}

test('D716 the paper: Parts 2 to 9 in order after the cover, each with its own block', async () => {
  const f = fixture();
  fillLegend(f);
  await f.call(APPLICANT, 'POST', '/mine');
  const r = await f.call(APPLICANT, 'GET', '/mine/paper');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const html: string = r.body.html;
  assert.deepEqual([...html.matchAll(/<section class="booklet-part part-(\d+)">/g)].map((m) => Number(m[1])), [2, 3, 4, 5, 6, 7, 8, 9]);
  const parts = sections(html);
  const headings = (s: string) => [...s.matchAll(/<div class="heading">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(headings(parts.get(3)!), ['Axal VC Spin-Out Lab Fund I LP', 'Ivy Applicant'], 'Part 3: the Fund and the applicant');
  assert.deepEqual(headings(parts.get(8)!), ['Ivy Applicant'], 'Part 8: only the applicant');
  assert.deepEqual(headings(parts.get(9)!), ['Axal VC Spin-Out Lab Fund I LP'], 'Part 9: the Fund');
  assert.ok(parts.get(9)!.includes('By: Axal VC GP LLC, its general partner'), 'with its through line');
  assert.ok(html.lastIndexOf('<div class="heading">') === html.indexOf('Axal VC Spin-Out Lab Fund I LP', html.lastIndexOf('<section class="booklet-part part-9">')) - '<div class="heading">'.length, 'the Fund block is last');
  assert.equal(parts.get(2)!.includes('Complete Part 3, Subscription Agreement.'), true);
  assert.ok(parts.get(2)!.includes('Send no money until you receive a Capital Call Notice.'));
  assert.ok(!html.includes('DRAFT'), 'every part has text, so no Draft');
  assert.ok(html.includes('THESE INTERESTS HAVE NOT BEEN REGISTERED.') && html.includes('<section class="cover'), 'the legend is on the cover');
  assert.equal(r.body.digest, (await f.call(APPLICANT, 'GET', '/mine')).body.digest);
});

test('D716 the paper prints a ticked field as an X square and an unticked one as empty, by field id', async () => {
  const f = fixture();
  fillLegend(f);
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const q = opened.parts.find((p: any) => p.part === 4).fields;
  await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: q[1].id, checked: true }] });
  const part4 = sections((await f.call(APPLICANT, 'GET', '/mine/paper')).body.html).get(4)!;
  const boxes = [...part4.matchAll(/<div class="check"><span class="box( x)?"><\/span><span>([^<]*)<\/span>/g)].map((m) => [m[2], !!m[1]]);
  assert.deepEqual(boxes, [['I am an accredited investor.', false], ['I am a qualified purchaser.', true]]);
  // Part 9's task item is the GP's: no applicant tick reaches it.
  assert.ok(sections((await f.call(APPLICANT, 'GET', '/mine/paper')).body.html).get(9)!.includes('<span class="box"></span>'));
});

test('D716 a part with no text from counsel prints the stub sentence and makes the paper a Draft; only the applicant reads it', async () => {
  const f = fixture();
  fillLegend(f);
  f.db.prepare("UPDATE legal_templates SET is_stub = 1 WHERE slug = 'lp_tax_status_certification'").run();
  await f.call(APPLICANT, 'POST', '/mine');
  const html = (await f.call(APPLICANT, 'GET', '/mine/paper')).body.html;
  assert.ok(sections(html).get(6)!.includes('Stub — counsel to draft.'));
  assert.ok(!sections(html).get(5)!.includes('Stub — counsel to draft.'));
  assert.ok(html.includes('DRAFT'));
  for (const who of [PENDING, STRANGER, FOUNDER, ADMIN]) assert.equal((await f.call(who, 'GET', '/mine/paper')).status, 404, `user ${who}`);
  assert.equal((await f.call(APPLICANT, 'GET', '/mine/paper?page=folio')).body.error, 'page_size_invalid');
});

async function pdfWithLinks(n: number, linkPages: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([612, 792]);
  for (const p of linkPages) {
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], Border: [0, 0, 0] });
    doc.getPage(p - 1).node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  }
  return doc.save();
}

test('D716 the admin PDF prints in two passes, its contents from each part\'s page; a failed call is 503 and never pdf-lib', async () => {
  const f = fixture();
  fillLegend(f);
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const calls: string[] = [];
  let fetched = 0;
  const BROWSER = {
    fetch: async () => { fetched++; throw new Error('BROWSER.fetch must not be called'); },
    quickAction: async (_a: string, o: any) => { calls.push(o.html); return new Response(calls.length === 1 ? await pdfWithLinks(14, [1, 2, 4, 5, 7, 9, 11, 12]) : await pdfWithLinks(2, [])); },
  };
  const r = await f.call(ADMIN, 'GET', `/${opened.uid}/pdf`, undefined, { envExtra: { BROWSER } });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(calls.length, 2, 'two passes');
  assert.ok(calls[0].includes('<a href="#part-3">Subscription Agreement</a>') && !calls[0].includes('<section class="cover'), 'pass 1 links each part heading');
  assert.equal([...calls[0].matchAll(/<a href="#/g)].length, 8, 'and nothing else, so the k-th link is the k-th part');
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
    assert.ok(calls[0].includes(`section.booklet-part.part-${n} { page: part-${n}; }`), `part ${n} has its named page`);
    assert.match(calls[0], new RegExp(`@page part-${n} \\{ @bottom-left \\{ content: "Subscription Booklet · Part ${n}"`), `part ${n} names itself in the footer`);
  }
  assert.ok(calls[0].includes('section.booklet-part { break-before: page; }'), 'each part starts a new page');
  assert.deepEqual([...calls[1].matchAll(/<span class="pg">(\d+)<\/span>/g)].map((m) => m[1]), ['1', '2', '4', '5', '7', '9', '11', '12']);
  const toc = [...calls[1].matchAll(/<li><span>([^<]*)<\/span>(?:<span class="leader"><\/span><span class="pg">(\d+)<\/span>)?<\/li>/g)].map((m) => [m[1], m[2] ?? null]);
  assert.deepEqual(toc[0], ['Part 2 · Instructions and Checklist', '1'], 'the contents starts at Part 2: the cover is not a part it lists');
  assert.deepEqual(toc[toc.length - 1], ['Part 9 · Acceptance by the General Partner', '12']);
  assert.equal(toc.length, 8);
  assert.equal(fetched, 0);
  assert.equal(f.one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'fund_admin.fund_booklet.read'").n, 1, 'the PDF read is audited');

  const down = await f.call(ADMIN, 'GET', `/${opened.uid}/pdf`, undefined, { envExtra: { BROWSER: { quickAction: async () => new Response('busy', { status: 503 }) } } });
  assert.deepEqual([down.status, down.body.error], [503, 'booklet_render_unavailable']);
  const unbound = await f.call(ADMIN, 'GET', `/${opened.uid}/pdf`);
  assert.deepEqual([unbound.status, unbound.body.error], [503, 'booklet_render_unavailable'], 'no binding is never the pdf-lib fallback');
  assert.equal((await f.call(APPLICANT, 'GET', `/${opened.uid}/pdf`, undefined, { envExtra: { BROWSER } })).status, 403);
});

// ── The booklet on screen (#1866) ───────────────────────────────────────────

test('D716 #1866 a field carries the nearest heading above it as its group; the ids ignore the headings', async () => {
  const body = '## Accredited investor\n- [ ] A\n- [ ] B\n### ERISA\n- [ ] C\nPlain line.\n- [ ] D';
  const grouped = await bookletFields('lp_investor_questionnaire', body);
  assert.deepEqual(grouped.map((x) => x.group), ['Accredited investor', 'Accredited investor', 'ERISA', 'ERISA']);
  const bare = await bookletFields('lp_investor_questionnaire', '- [ ] A\n- [ ] B\n- [ ] C\nPlain line.\n- [ ] D');
  assert.deepEqual(grouped.map((x) => x.id), bare.map((x) => x.id), 'a heading never changes an id');
  assert.deepEqual(bare.map((x) => x.group), [null, null, null, null]);
});

test('D716 #1866 the view carries each field\'s group, and the frozen record carries none', async () => {
  const f = fixture();
  fillLegend(f);
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const part = (n: number) => opened.parts.find((p: any) => p.part === n).fields;
  assert.deepEqual(part(3).map((x: any) => x.group), ['Article 1 Subscription', 'Article 1 Subscription']);
  assert.deepEqual(part(4).map((x: any) => x.group), [null, null]);
  const done = await f.call(APPLICANT, 'POST', '/mine/submit', { digest: opened.digest });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const frozen = f.one('SELECT frozen_json FROM fund_subscription_booklets').frozen_json as string;
  assert.ok(!frozen.includes('"group"') && !frozen.includes('Article 1 Subscription'), 'no group in the frozen record');
  assert.ok(!frozen.includes('I subscribe for the amount below.'), 'and no field text');
  assert.equal(done.body.digest, (await f.call(APPLICANT, 'GET', '/mine')).body.digest);
});

test('D716 #1866 ?part=N prints that one part alone, with the same digest; any other value is 400', async () => {
  const f = fixture();
  fillLegend(f);
  const opened = (await f.call(APPLICANT, 'POST', '/mine')).body;
  const q = opened.parts.find((p: any) => p.part === 4).fields;
  await f.call(APPLICANT, 'PUT', '/mine/answers', { answers: [{ field_id: q[0].id, checked: true }] });
  const r = await f.call(APPLICANT, 'GET', '/mine/paper?part=4');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const html: string = r.body.html;
  assert.deepEqual([...html.matchAll(/<section class="booklet-part part-(\d+)">/g)].map((m) => m[1]), ['4']);
  assert.ok(!html.includes('class="cover') && !html.includes('class="contents'), 'no cover and no contents');
  const boxes = [...sections(html).get(4)!.matchAll(/<div class="check"><span class="box( x)?"><\/span><span>([^<]*)<\/span>/g)].map((m) => [m[2], !!m[1]]);
  assert.deepEqual(boxes, [['I am an accredited investor.', true], ['I am a qualified purchaser.', false]]);
  assert.equal(r.body.digest, (await f.call(APPLICANT, 'GET', '/mine')).body.digest);
  for (const bad of ['1', '10', 'x', '']) {
    const b = await f.call(APPLICANT, 'GET', `/mine/paper?part=${bad}`);
    assert.deepEqual([b.status, b.body.error], [400, 'part_invalid'], `part=${bad}`);
  }
  for (const who of [PENDING, STRANGER, ADMIN]) assert.equal((await f.call(who, 'GET', '/mine/paper?part=4')).status, 404, `user ${who}`);
});
