import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '../src/types';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors';
import dealFlow from '../src/routes/deal_flow';
import deals from '../src/routes/deals';
import dealWorkroom from '../src/routes/deal_workroom';
import ic from '../src/routes/ic';
import closings from '../src/routes/closings';
import trust from '../src/routes/trust';
import esign from '../src/routes/esign';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = new TextEncoder().encode('synthetic-d5915-test-key-only');
const PREVIEW_HEADER = 'X-Axal-Preview-Shell';
const REFUSED = 'investor_preview_read_only';
const SUPER = 1, INVESTOR = 2, ADMIN = 3;
const sql = (file: string) => readFileSync(new URL('../sql/' + file, import.meta.url), 'utf8');
const baseline = sql('schema_baseline.sql');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of ['users', 'super_admins', 'user_sessions', 'mi_pro_subscriptions', 'founders', 'projects', 'deals', 'deal_invitations', 'commitments', 'user_company_links', 'company_profiles']) {
    db.exec(tableFromBaseline(baseline, table));
  }
  db.exec(sql('migrations/618_deal_flow.sql'));
  db.exec(sql('migrations/202611041822_account_licences.sql'));
  db.exec(`
    INSERT INTO users(id, name, email, role, is_active) VALUES
      (1, 'Synthetic HQ', 'a@example.test', 'admin', 1),
      (2, 'Synthetic Investor', 'b@example.test', 'investor', 1),
      (3, 'Synthetic Admin', 'c@example.test', 'admin', 1);
    INSERT INTO super_admins(user_id) VALUES (1);
    INSERT INTO account_licences(user_id, licence, source) VALUES (1, 'investor', 'test');
    INSERT INTO projects(id, uid, name, sector) VALUES (10, 'synthetic-venture', 'Synthetic venture', 'Synthetic sector');
    INSERT INTO deals(id, project_id, status) VALUES (100, 10, 'active');
    INSERT INTO deal_flow_entries(uid, scope_key, investor_user_id, deal_id, stage, owner_user_id, entered_via)
      VALUES ('hq-flow', 'u:1', 1, 100, 'sourcing', 1, 'added'), ('investor-flow', 'u:2', 2, 100, 'sourcing', 2, 'added');
  `);
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/deals/flow', dealFlow);
  app.route('/api/deals', dealWorkroom);
  app.route('/api/deals', deals);
  app.route('/api/ic', ic);
  app.route('/api/closings', closings);
  app.route('/api/trust', trust);
  app.route('/api/legal/esign', esign);
  app.onError((err, c) => {
    if (err instanceof Response) return err;
    const status = AUTH_ERROR_STATUSES[err.message];
    if (!status) throw err;
    return c.json({ error: err.message }, status as 401 | 403);
  });
  const env = { DB: d1Over(db), JWT_SECRET: new TextDecoder().decode(SECRET), ENVIRONMENT: 'development' } as Env;
  async function call(actor: number | null, method: string, path: string, shell: string | null, input?: unknown) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (shell) headers.set(PREVIEW_HEADER, shell);
    if (actor) {
      const token = await new SignJWT({ user_id: actor })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(SECRET);
      headers.set('Authorization', 'Bearer ' + token);
    }
    const res = await app.request('/api' + path, { method, headers, body: JSON.stringify(input) }, env);
    return { status: res.status, body: await res.json() as any };
  }
  return { call, db };
}

test('the mounted deal, vote, signing and closing routes refuse before any change', async () => {
  const { call, db } = fixture();
  const writes = [
    ['POST', '/deals/flow/100/pass', { reason: 'valuation' }],
    ['PATCH', '/deals/flow/100', { stage: 'commit', note: 'Do not save as part of a move' }],
    ['POST', '/deals/100/pass', { reason: 'valuation' }],
    ['POST', '/deals/100/invitations/respond', { response: 'passed' }],
    ['POST', '/deals/100/commitments', { amount: 1000 }],
    ['POST', '/deals/100/commitments/commitment/withdrawal', { reason: 'Synthetic reason' }],
    ['PUT', '/ic/decision', { decision: 'invest' }],
    ['POST', '/ic/decision/vote', { vote: 'yes' }],
    ['POST', '/trust/intro/request', { founder_user_id: 5 }],
    ['POST', '/legal/esign/send', { deal_id: 100 }],
    ['POST', '/legal/esign/staged', {}],
    ['POST', '/legal/esign/staged/envelope/countersign', {}],
    ['POST', '/deals/100/transfers', { amount_cents: 1000 }],
    ['POST', '/closings/closing/lines/line/evidence', {}],
    ['POST', '/deals/100/closing-checklist/apply', { template_slug: 'safe' }],
    ['PATCH', '/deals/100/closing-checklist/items/item', { state: 'done' }],
    ['POST', '/closings/closing/complete', {}],
  ] as const;
  for (const [method, path, input] of writes) {
    const result = await call(SUPER, method, path, 'investor', input);
    assert.equal(result.status, 403, path);
    assert.equal(result.body.code, REFUSED, path);
    assert.equal(result.body.message, 'Return to HQ to make this change.', path);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM deal_flow_events').get()?.n, 0);
  assert.equal(db.prepare("SELECT stage FROM deal_flow_entries WHERE uid = 'hq-flow'").get()?.stage, 'sourcing');
  assert.equal(db.prepare('SELECT status FROM deals WHERE id = 100').get()?.status, 'active');
});

test('reads and note-only saves still work, and exiting preview allows the same HQ action', async () => {
  const { call, db } = fixture();
  assert.equal((await call(SUPER, 'GET', '/deals/flow', 'investor')).status, 200);
  const note = await call(SUPER, 'PATCH', '/deals/flow/100', 'investor', { note: 'Read the synthetic business plan.' });
  assert.equal(note.status, 200);
  assert.equal(note.body.note, 'Read the synthetic business plan.');
  assert.equal((await call(SUPER, 'POST', '/deals/flow/100/pass', null, { reason: 'valuation' })).status, 200);
  assert.equal(db.prepare("SELECT stage FROM deal_flow_entries WHERE uid = 'hq-flow'").get()?.stage, 'passed');
});

test('the marker does not grant permission or restrict other actors', async () => {
  const { call } = fixture();
  assert.equal((await call(INVESTOR, 'POST', '/deals/flow/100/pass', 'investor', { reason: 'valuation' })).status, 200);
  const admin = await call(ADMIN, 'POST', '/deals/flow/100/pass', 'investor', { reason: 'valuation' });
  assert.equal(admin.status, 403);
  assert.equal(admin.body.code, 'investor_required');
  assert.equal((await call(null, 'POST', '/deals/100/commitments', 'investor', {})).status, 401);
});
