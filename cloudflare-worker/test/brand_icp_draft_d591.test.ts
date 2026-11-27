/**
 * D591 (#1218) — a confirmed ICP's draft landing page, through the real brand
 * router on real SQLite (the baseline's landing_pages with migration 399).
 *
 * The draft body comes from the frontend's one mapping
 * (`frontend/src/lib/brand/icpPrefill.js`), so this file pins what the Worker
 * does with it:
 *   - the page is created unpublished (draft-only), owned by the founder's
 *     project, and another founder's project is refused with nothing written;
 *   - each mapped field lands in its column, and the template content passes
 *     `sanitizeLandingContent` key for key;
 *   - an over-long answer is capped at the sanitizer's 2,000 characters.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/brand_icp_draft_d591.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import brand from '../src/routes/brand.ts';
import { sanitizeLandingContent, LANDING_CONTENT_SCHEMA } from '../src/services/landingTemplates.ts';
import { icpLandingDraft, LANDING_MAX_STR, ICP_PREFILL_MAP } from '../../frontend/src/lib/brand/icpPrefill.js';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OWNER = 10, OTHER = 20;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIG399 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/399_landing_brand_voice_dark_logo_archive.sql'), 'utf8');

const ICP = {
  type: 'B2B', industry: 'Logistics', size: '20–50 employees', persona: 'Ops lead', geo: 'UK',
  pain1: 'Dispatch is done by phone and spreadsheet.', alternative: 'A shared sheet', whyFail: 'Nobody trusts the sheet.',
  outcome: 'Every truck dispatched before 7am, without a call.', trigger: 'A missed delivery', metric: 'On-time rate',
  urgency: 'Active — looking now', budget: 'Mid — $200/mo per team ceiling', objection: 'We tried software before.',
  valueProp: 'Dispatch for small fleets, done from one screen.', differentiator: 'It reads the drivers’ own WhatsApp groups.', tone: 'Confident',
};
const confirmed = (fields: Record<string, string>) => JSON.stringify({ status: 'confirmed', step: 5, version: 1, fields });
const projectRow = (fields = ICP) => ({ id: 1, name: 'Acme', sector: 'logistics', icp_definition_meta: confirmed(fields) });

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'landing_pages']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(MIG399);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(OWNER, 'founder', 'Fay Owner', 'fay@example.test', 1001);
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test', 1002);
  db.exec("INSERT INTO projects (id, name, founder_id, sector) VALUES (1, 'Acme', 1001, 'logistics'), (2, 'Beta', 1002, 'fintech')");
  return db;
}

const app = new Hono<any>();
app.route('/brand', brand);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function post(db: any, who: number, pid: number, body: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/brand/landing/by-project/${pid}/pages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const rows = (db: any) => db.prepare('SELECT * FROM landing_pages ORDER BY id').all() as any[];

test('D591: a confirmed ICP\'s draft is created unpublished, with each mapped field in its column', async () => {
  const db = fixture();
  const body = icpLandingDraft(projectRow());
  assert.ok(body);
  assert.equal(body.template_kit, 'customer-acquisition', 'an actively-looking B2B ICP gets the demo-request page');
  const r = await post(db, OWNER, 1, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [row] = rows(db);
  assert.equal(row.published, 0, 'nothing publishes without the founder');
  assert.equal(row.project_id, 1);
  assert.equal(row.headline, ICP.valueProp);
  assert.equal(row.subheadline, ICP.outcome);
  assert.equal(row.cta_text, 'Book a demo');
  assert.equal(row.audience_customer_headline, ICP.valueProp);
  assert.equal(row.audience_customer_body, ICP.outcome);
  assert.equal(row.audience_customer_cta, 'Book a demo');
  assert.equal(row.audience, 'customer');
  assert.equal(row.template, 'customer-acquisition');
  assert.equal(row.name, 'Acme · Customer Acquisition Page');
  assert.deepEqual(JSON.parse(row.content_json), {
    'customer-acquisition': { problem_lead: ICP.pain1, product_lead: ICP.differentiator },
  });
});

test('D591: the audience template\'s segment and leads pass the sanitizer key for key', async () => {
  const db = fixture();
  const body = icpLandingDraft(projectRow({ ...ICP, type: 'Both' }));
  assert.equal(body.template_kit, 'customer-audience');
  assert.deepEqual(sanitizeLandingContent(body.content_json), body.content_json, 'every mapped key is one the schema keeps');
  const r = await post(db, OWNER, 1, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(JSON.parse(rows(db)[0].content_json), {
    'customer-audience': {
      segments: [{ label: ICP.persona, headline: ICP.valueProp, subhead: ICP.outcome }],
      problem_lead: ICP.pain1,
      how_lead: ICP.differentiator,
    },
  });
});

test('D591: every content key the mapping names exists in that template\'s schema', () => {
  for (const m of ICP_PREFILL_MAP) {
    const hit = /^content\.([a-z-]+)\.([a-z_]+)(?:\[0\]\.([a-z_0-9]+))?$/.exec(m.to);
    if (!hit) continue;
    const [, tkey, key, itemKey] = hit;
    const field = (LANDING_CONTENT_SCHEMA as any)[tkey]?.find((f: any) => f.key === key);
    assert.ok(field, `${m.to}: ${tkey} has no ${key}`);
    if (itemKey) assert.ok(field.itemFields.some((f: any) => f.key === itemKey), `${m.to}: no item field ${itemKey}`);
  }
});

test('D591: an over-long answer is capped at the sanitizer\'s 2,000 characters', async () => {
  const db = fixture();
  const long = 'x'.repeat(5000);
  const body = icpLandingDraft(projectRow({ ...ICP, pain1: long, valueProp: long }));
  assert.equal(LANDING_MAX_STR, 2000);
  assert.equal(body.headline.length, 2000);
  assert.equal(body.content_json['customer-acquisition'].problem_lead.length, 2000);
  const r = await post(db, OWNER, 1, body);
  assert.equal(r.status, 201);
  const [row] = rows(db);
  assert.equal(row.headline.length, 2000);
  assert.equal(JSON.parse(row.content_json)['customer-acquisition'].problem_lead.length, 2000);
});

test('D591: another founder\'s project is refused, and nothing is written', async () => {
  const db = fixture();
  const r = await post(db, OTHER, 1, icpLandingDraft(projectRow()));
  assert.equal(r.status, 403);
  assert.equal(rows(db).length, 0);
});
