/**
 * #4570 slice 9 (S1 of #4554): the 43 `/api/partner` ledger routes, through the mounted routers on the full schema:
 * `/api/partner/delivery` (partner_delivery.ts), `/api/partner/offers` (partner_offers.ts) and `/api/partner/testing`
 * (testing.ts). Every record here belongs to firm A (partner 1): an engagement with a milestone, blocker, deliverable,
 * seat, hours row and status report, an attribution surface, a proof item with a pending consent, a fit rule, and a
 * product-testing programme with an application.
 *
 * The firm is read from the caller's own account (`users.partner_id`), never from the request. Another firm's
 * partner gets 404 naming nothing; a founder, investor or advisor gets 403; a partner account with no firm is
 * refused; no credentials and a disabled account get 401. No refusal changes a row. The firm's own partner passes
 * every gate (the last tests), so each refusal is the gate and not the body.
 *
 * The three proof-consent token routes are the client's (D4672): no account, the link's token is the capability.
 * An unknown token answers 404 naming nothing and writes nothing; a wrong code counts an attempt and the fifth locks
 * the code; nothing about another firm's claim is ever read through a token.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/authz_partner_d4570.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import partnerDelivery from '../src/routes/partner_delivery.ts';
import partnerOffers from '../src/routes/partner_offers.ts';
import { partnerTesting } from '../src/routes/testing.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in the #4570 slice 9 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const SECRET = 'd4570-partner-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.

// The parties. Firm A is partner 1, firm B partner 2.
const A_PARTNER = 1, A_STAFF = 2, B_PARTNER = 3, FOUNDER = 4, INVESTOR = 5, ADVISOR = 6, NO_FIRM = 7, DISABLED_A = 8, B_STAFF = 9;
const ROLES: Record<number, string> = {
  [A_PARTNER]: 'partner', [A_STAFF]: 'partner', [B_PARTNER]: 'partner', [FOUNDER]: 'founder', [INVESTOR]: 'investor',
  [ADVISOR]: 'advisor', [NO_FIRM]: 'partner', [DISABLED_A]: 'partner', [B_STAFF]: 'partner',
};
const WHO: Record<string, string> = {
  [B_PARTNER]: "another firm's partner", [FOUNDER]: 'a founder', [INVESTOR]: 'an investor', [ADVISOR]: 'an advisor',
  [NO_FIRM]: 'a partner with no firm', [DISABLED_A]: 'a disabled account of the firm', null: 'no credentials',
};
/** Who each firm-owned route refuses, and with what: the firm is never named, and nothing is written. */
const REFUSED: [number | null, number][] = [
  [B_PARTNER, 404], [FOUNDER, 403], [INVESTOR, 403], [ADVISOR, 403], [NO_FIRM, 400], [DISABLED_A, 401], [null, 401],
];

// Markers a leak check can find; none is a real person or company.
const LEAKS = ['Wombat', 'wombat', 'WOMBAT'];
const TOKEN = 'wombat-consent-token-0001';

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

/** Every table a refused partner route could have changed. */
const TABLES = ['engagements', 'engagement_milestones', 'engagement_blockers', 'engagement_deliverables', 'engagement_seats',
  'engagement_status_reports', 'engagement_status_report_amendments', 'engagement_hours', 'engagement_sources', 'engagement_reviews',
  'partner_surfaces', 'partner_proof_items', 'partner_proof_consents', 'partner_proof_consent_codes', 'partner_proof_consent_events',
  'partner_fit_rules', 'testing_programmes', 'testing_applications', 'testing_events', 'activity_logs'];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO partners(id,uid,name,company,email,status) VALUES
      (1,'pa','Wombat Advisory','Wombat Advisory LLC','a@example.test','active'),(2,'pb','Elsewhere Firm','Elsewhere','b@example.test','active');
    INSERT INTO users(id,email,name,role,partner_id,is_active) VALUES
      (${A_PARTNER},'ap@example.test','Firm A Partner','partner',1,1),(${A_STAFF},'as@example.test','Firm A Staff','partner',1,1),
      (${B_PARTNER},'bp@example.test','Firm B Partner','partner',2,1),(${FOUNDER},'f@example.test','Some Founder','founder',NULL,1),
      (${INVESTOR},'i@example.test','Some Investor','investor',NULL,1),(${ADVISOR},'ad@example.test','Some Advisor','advisor',NULL,1),
      (${NO_FIRM},'nf@example.test','No Firm Partner','partner',NULL,1),(${DISABLED_A},'da@example.test','Disabled A','partner',1,0),
      (${B_STAFF},'bs@example.test','Firm B Staff','partner',2,1);
    UPDATE users SET founder_id = 40 WHERE id = ${FOUNDER};
    INSERT INTO founders(id,uid,name,email) VALUES (40,'fo','Wombat Client','client@example.test');
    INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price,status) VALUES
      (901,'ea',1,1,1,40,10,5000,'active'),(902,'eb',2,2,2,40,11,4000,'active');
    INSERT INTO engagement_milestones(id,uid,engagement_id,title,revision) VALUES (11,'ma',901,'Wombat milestone',1);
    INSERT INTO engagement_blockers(id,uid,engagement_id,side,summary,revision) VALUES (12,'ba',901,'ours','Wombat blocker',1);
    INSERT INTO engagement_deliverables(id,uid,engagement_id,title,revision) VALUES (13,'da',901,'Wombat deliverable',1);
    INSERT INTO engagement_seats(id,uid,engagement_id,holder_user_id,scope,granted_at,revision) VALUES (14,'sa',901,${A_STAFF},'Wombat admin console','2026-11-01',1);
    INSERT INTO engagement_status_reports(id,uid,engagement_id,period,state,shipped,next_up,revision) VALUES (15,'ra',901,'2026-11','draft','Wombat shipped','Wombat next',1);
    INSERT INTO engagement_hours(id,engagement_id,person_user_id,period,hours,revision) VALUES (16,901,${A_STAFF},'2026-11',12,1);
    INSERT INTO partner_surfaces(id,uid,partner_id,name,kind,is_active) VALUES (17,'sfa',1,'Wombat newsletter','content',1);
    INSERT INTO engagement_sources(engagement_id,surface_id,attributed_at) VALUES (901,17,'2026-11-02');
    INSERT INTO partner_proof_items(id,uid,partner_id,engagement_id,kind,title,detail,revision) VALUES (18,'pia',1,901,'case_study','Wombat case study','Wombat detail',1);
    INSERT INTO partner_proof_consents(id,uid,proof_item_id,consenter_name,consenter_email,requested_at,requested_by,request_token,consent_given,revision,expires_at)
      VALUES (19,'pca',18,'Wombat Client','client@example.test','2026-11-20',${A_PARTNER},'${TOKEN}',0,1,'2099-01-01T00:00:00Z');
    INSERT INTO partner_fit_rules(id,uid,partner_id,kind,statement,is_active) VALUES (20,'fra',1,'sector_declined','Wombat fit rule',1);
    INSERT INTO testing_programmes(id,uid,owner_kind,owner_partner_id,created_by,product_name,summary,places,status)
      VALUES (21,'tpa','partner',1,${A_PARTNER},'Wombat app','Wombat summary',5,'draft'),(22,'tpo','partner',1,${A_PARTNER},'Wombat open app','Wombat',5,'open');
    INSERT INTO testing_applications(id,uid,programme_id,user_id,status) VALUES (23,'taa',22,${FOUNDER},'applied');`);
  const objects = new Map<string, Uint8Array>();
  const FILES = {
    async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); return {}; },
    async get(key: string) { return objects.has(key) ? { body: objects.get(key), httpMetadata: {} } : null; },
    async delete(key: string) { objects.delete(key); },
  };
  const env: any = { DB: d1Over(db), FILES, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono()
    .route('/api/partner/delivery', partnerDelivery)
    .route('/api/partner/offers', partnerOffers)
    .route('/api/partner/testing', partnerTesting);
  app.onError((e, c) => (e instanceof Response ? e : mapError(c as any, e)));
  const call = async (who: number | null, method: string, path: string, body?: unknown) => {
    const form = body instanceof FormData;
    const headers: Record<string, string> = form ? {} : { 'Content-Type': 'application/json' };
    if (who != null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: ROLES[who] }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const res = await app.request(path, { method, headers, body: method === 'GET' ? undefined : form ? body : JSON.stringify(body ?? {}) }, env)
      .catch((e) => { if (e instanceof Response) return e; throw e; });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, json };
  };
  const snapshot = () => JSON.stringify(TABLES.map((t) => {
    try { return db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(); } catch { return `no ${t}`; }
  }));
  return { db, env, call, snapshot, objects };
}

const named = (r: { text: string }) => LEAKS.filter((l) => r.text.includes(l));

const D = '/api/partner/delivery', O = '/api/partner/offers', T = '/api/partner/testing';
/** The 40 firm-owned ledger routes, each on a record of firm A, with a body its owner could send. */
export const OWNED: [string, string, unknown?][] = [
  ['DELETE', `${D}/blockers/12`],
  ['DELETE', `${D}/deliverables/13`],
  ['DELETE', `${D}/engagements/901/hours/${A_STAFF}/2026-11`],
  ['DELETE', `${D}/milestones/11`],
  ['DELETE', `${D}/status-reports/15`],
  ['DELETE', `${O}/engagements/901/source`],
  ['DELETE', `${O}/fit-rules/20`],
  ['DELETE', `${O}/proof/18`],
  ['DELETE', `${O}/surfaces/17`],
  ['DELETE', `${T}/programmes/tpa/logo`],
  ['GET', `${D}/engagements/901/blockers`],
  ['GET', `${D}/engagements/901/milestones`],
  ['GET', `${D}/engagements/901/report-draft/2026-11`],
  ['GET', `${D}/engagements/901/reviews`],
  ['GET', `${T}/programmes/tpo/applicants`],
  ['PATCH', `${D}/blockers/12`, { summary: 'Changed', revision: 1 }],
  ['PATCH', `${D}/deliverables/13`, { title: 'Changed', revision: 1 }],
  ['PATCH', `${D}/milestones/11`, { title: 'Changed', revision: 1 }],
  ['PATCH', `${D}/seats/14`, { scope: 'Changed', revision: 1 }],
  ['PATCH', `${O}/fit-rules/20`, { statement: 'Changed' }],
  ['PATCH', `${O}/proof/18`, { title: 'Changed', revision: 1 }],
  ['PATCH', `${O}/surfaces/17`, { name: 'Changed' }],
  ['PATCH', `${T}/programmes/tpa`, { summary: 'Changed' }],
  ['POST', `${D}/engagements/901/blockers`, { side: 'ours', summary: 'New' }],
  ['POST', `${D}/engagements/901/deliverables`, { title: 'New' }],
  ['POST', `${D}/engagements/901/milestones`, { title: 'New' }],
  ['POST', `${D}/engagements/901/seats`, { holder_user_id: A_STAFF, scope: 'New' }],
  ['POST', `${D}/seats/14/revoke`, { revision: 1 }],
  ['POST', `${D}/status-reports/15/amendments`, { field: 'shipped', text: 'Correction' }],
  ['POST', `${D}/status-reports/15/send`, { revision: 1 }],
  ['POST', `${O}/proof/18/consent-request`, { consenter_name: 'Client', consenter_email: 'c2@example.test' }],
  ['POST', `${O}/proof/18/consents/19/withdraw`],
  ['POST', `${T}/applications/taa/decline`],
  ['POST', `${T}/applications/taa/pick`],
  ['POST', `${T}/programmes/tpa/submit`],
  ['PUT', `${D}/engagements/901/health`, { satisfaction: 4 }],
  ['PUT', `${D}/engagements/901/hours/${A_STAFF}/2026-11`, { hours: 3, revision: 1 }],
  ['PUT', `${D}/engagements/901/status-reports/2026-11`, { shipped: 'x', next_up: 'y', revision: 1 }],
  ['PUT', `${O}/engagements/901/source`, { surface_id: 17 }],
  ['PUT', `${T}/programmes/tpa/logo`, 'png'],
];
/** The three client routes a consent link opens (D4672): the token is the capability, no account is needed. */
const TOKEN_ROUTES: [string, string][] = [
  ['GET', `${O}/proof-consents/:token/claim`], ['POST', `${O}/proof-consents/:token/code`], ['POST', `${O}/proof-consents/:token/respond`],
];

/** A minimal valid PNG header, so a logo upload reaches the ownership check rather than failing on the file. */
function logoForm(): FormData {
  const b = new Uint8Array(97);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, 64); new DataView(b.buffer).setUint32(20, 64); b.set([8, 6, 0, 0, 0], 24);
  const form = new FormData(); form.set('file', new Blob([b], { type: 'image/png' }), 'logo');
  return form;
}
const bodyOf = (b: unknown) => (b === 'png' ? logoForm() : b);
const ledgerKey = (m: string, p: string) => `${m} ${p
  .replace('/status-reports/2026-11', '/status-reports/:period')
  .replace(/\/(blockers|deliverables|milestones|status-reports|fit-rules|proof|surfaces|seats)\/\d+/g, '/$1/:id')
  .replace('/engagements/901', '/engagements/:engagementId').replace(`/hours/${A_STAFF}/2026-11`, '/hours/:personId/:period')
  .replace('/report-draft/2026-11', '/report-draft/:period')
  .replace('/consents/19', '/consents/:consentId').replace(/\/(programmes|applications)\/[a-z]+/, '/$1/:uid')}`;

test('#4570 slice 9: the suite covers every /api/partner route in the ledger, and each is verified by it', async () => {
  const { readFileSync } = await import('node:fs');
  const ledger = JSON.parse(readFileSync(new URL('../../scripts/baselines/auth-inventory/%252Fapi%252Fpartner.json', import.meta.url), 'utf8'));
  const covered = [...OWNED.map(([m, p]) => ledgerKey(m, p)), ...TOKEN_ROUTES.map(([m, p]) => `${m} ${p}`)].sort();
  assert.deepEqual(covered, Object.keys(ledger).sort());
  for (const [key, entry] of Object.entries<any>(ledger)) {
    assert.equal(entry.state, 'verified', key);
    assert.equal(entry.test, 'cloudflare-worker/test/authz_partner_d4570.test.ts', key);
  }
});

test('#4570 slice 9: every firm-owned route refuses another firm with 404, other roles with 403, and writes nothing', async () => {
  for (const [method, path, body] of OWNED) {
    const f = fixture();
    const before = f.snapshot();
    for (const [who, status] of REFUSED) {
      const r = await f.call(who, method, path, bodyOf(body));
      assert.equal(r.status, status, `${method} ${path}: ${WHO[String(who)]} got ${r.status}`);
      assert.deepEqual(named(r), [], `${method} ${path}: ${WHO[String(who)]}'s refusal names the firm's record`);
      assert.equal(f.snapshot(), before, `${method} ${path}: ${WHO[String(who)]}'s refusal changed a row`);
    }
    assert.equal(f.objects.size, 0, `${method} ${path}: a refusal stored a file`);
  }
});

test("#4570 slice 9: the firm's own partner passes every gate, so each refusal above is the gate", async () => {
  
  for (const [method, path, body] of OWNED) {
    const f = fixture();
    const r = await f.call(A_PARTNER, method, path, bodyOf(body));
    assert.ok(![401, 403, 404].includes(r.status), `${method} ${path}: the owner got ${r.status} ${r.text.slice(0, 160)}`);
    if (method === 'GET' && !path.endsWith('/reviews')) assert.notDeepEqual(named(r), [], `${method} ${path}: the owner's read is empty`);
  }
});

test('#4570 slice 9: a seat or hours row can only name someone attached to the firm', async () => {
  const f = fixture();
  const before = f.snapshot();
  const seat = await f.call(A_PARTNER, 'POST', `${D}/engagements/901/seats`, { holder_user_id: B_STAFF, scope: 'Console' });
  assert.equal(seat.status, 400);
  const hours = await f.call(A_PARTNER, 'PUT', `${D}/engagements/901/hours/${B_STAFF}/2026-11`, { hours: 3 });
  assert.equal(hours.status, 400);
  assert.equal(f.snapshot(), before);
});

test('#4570 slice 9: a consent link is the only key to its own claim; an unknown token answers 404 and writes nothing', async () => {
  const f = fixture();
  const before = f.snapshot();
  for (const [method, path] of TOKEN_ROUTES) {
    for (const token of ['not-a-token', 'x'.repeat(101), TOKEN.toUpperCase()]) {
      for (const who of [null, B_PARTNER, A_PARTNER]) {
        const r = await f.call(who, method, path.replace(':token', encodeURIComponent(token)), { code: '123456', consent_given: true });
        assert.deepEqual([r.status, r.json?.error], [404, 'consent_not_found'], `${method} ${path} (${token.slice(0, 12)}) as ${WHO[String(who)] ?? who}`);
        assert.deepEqual(named(r), []);
      }
    }
  }
  assert.equal(f.snapshot(), before);
  const claim = await f.call(null, 'GET', `${O}/proof-consents/${TOKEN}/claim`);
  assert.equal(claim.status, 200, 'the link itself reads its own claim with no account');
  assert.doesNotMatch(claim.text, /client@example\.test/, 'never the client\'s address in full');
  assert.doesNotMatch(claim.text, /Wombat (milestone|blocker|deliverable|fit rule|newsletter)/, 'nothing else of the firm');
  const own = await f.call(A_PARTNER, 'POST', `${O}/proof-consents/${TOKEN}/respond`, { code: '123456', consent_given: true });
  assert.deepEqual([own.status, own.json?.error], [403, 'requester_cannot_confirm'], 'the firm cannot answer its own request');
});


