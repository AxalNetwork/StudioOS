// D758 (#1863) PR 2 — partner onboarding sends the Partner Services row, and
// never with a blank field.
//
// `/api/partner-onboard/:token/finalize` on node:sqlite: migration 028's three
// partner tables and the e-sign harness's D1. No provider is configured, so the
// envelope is the platform's own and no mail leaves (`RESEND_API_KEY` unset).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { ADMIN, freshDb, envFor } from './_esign_harness.ts';
import { ensureLegalTemplatesSchema } from '../src/services/legalTemplateStore.ts';
import onboard from '../src/routes/partner_onboarding.ts';

const read = (p: string) => readFileSync(p, 'utf8');
const app = new Hono<any>();
app.route('/', onboard);

const REPO_BODY = read('cloudflare-worker/src/templates/legal/partner_services_v1.md');
const FILLED_BODY = 'Partner Services for {{partner_name}} ({{partner_email}}): {{deal_type}}, {{term_months}} months from {{effective_date}}.';
const NOT_READY = 'This agreement is not ready to send yet: Axal VC still has to complete it. Nothing was sent, and the proposal you chose is kept.';

async function setup(body: string) {
  const db = freshDb();
  const e: any = envFor(db);
  db.exec(read('cloudflare-worker/sql/migrations/028_partner_deals.sql'));
  await ensureLegalTemplatesSchema(e);
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, is_stub) VALUES ('partner_services', 'Partner Services / MSA v1', 'partner', ?, 0)").run(body);
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  db.prepare(`INSERT INTO partner_invitations (id, token, recipient_email, recipient_name, invited_by_user_id, allowed_deal_types, status, expires_at)
    VALUES (1, 'tok-partner', 'partner@example.test', 'Pat Partner', ?, '["equity_partnership"]', 'selected', ?)`).run(ADMIN, expires);
  db.prepare("INSERT INTO partner_profiles (invitation_id, full_name) VALUES (1, 'Pat Partner')").run();
  db.prepare("INSERT INTO partner_deals (id, invitation_id, deal_type, proposal_json, term_months, status) VALUES (7, 1, 'equity_partnership', '{}', 24, 'proposed')").run();
  return { db, e };
}
const finalize = async (e: any) => {
  const res = await app.request('/tok-partner/finalize', { method: 'POST' }, e);
  return { status: res.status, body: await res.json() as any };
};
const envelopes = (db: any) => {
  try { return db.prepare('SELECT document_type, document_title AS title, document_body FROM esign_envelopes').all() as any[]; } catch { return []; }
};

test('D758 the repo\'s Partner Services text is refused with 409: nothing sent, the deal and invitation kept, the field names audited', async () => {
  const { db, e } = await setup(REPO_BODY);
  const r = await finalize(e);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'template_fields_unfilled');
  assert.equal(r.body.message, NOT_READY);
  assert.deepEqual(envelopes(db), [], 'no envelope is written');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM esign_recipients").get() as any)?.n ?? 0, 0);
  const deal = db.prepare('SELECT envelope_id, status FROM partner_deals WHERE id = 7').get() as any;
  assert.deepEqual({ ...deal }, { envelope_id: null, status: 'proposed' });
  const inv = db.prepare('SELECT status, envelope_id FROM partner_invitations WHERE id = 1').get() as any;
  assert.deepEqual({ ...inv }, { status: 'selected', envelope_id: null });
  const logs = db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'partner_envelope_%'").all() as any[];
  assert.deepEqual(logs.map((l) => l.action), ['partner_envelope_refused']);
  const details = JSON.parse(logs[0].details);
  assert.equal(details.code, 'template_fields_unfilled');
  assert.deepEqual([...details.fields].sort(), ['cap_table.vesting_schedule', 'governing_law', 'partner.equity_pct']);
  assert.doesNotMatch(logs[0].details, /partner@example|Pat Partner/, 'the audit names fields, never a value');
});

test('D758 a completed Partner Services row is sent: recorded as partner_services, the row merged, titled "Partner Services / MSA"', async () => {
  const { db, e } = await setup(FILLED_BODY);
  const r = await finalize(e);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.envelope_id);
  const [env] = envelopes(db);
  assert.equal(env.document_type, 'partner_services');
  assert.equal(env.title, 'Partner Services / MSA');
  assert.match(env.document_body, /^Partner Services for Pat Partner \(partner@example\.test\): equity partnership, 24 months from \d{4}-\d{2}-\d{2}\.$/);
  assert.doesNotMatch(env.document_body, /\{\{/);
  const deal = db.prepare('SELECT envelope_id, status FROM partner_deals WHERE id = 7').get() as any;
  assert.deepEqual({ ...deal }, { envelope_id: r.body.envelope_id, status: 'awaiting_signature' });
  assert.equal((db.prepare('SELECT status FROM partner_invitations WHERE id = 1').get() as any).status, 'finalized');
});

test('D758 with the row emptied, partner onboarding falls back to the bundled partner_msa_v2.md, as the row\'s fallback', async () => {
  const { db, e } = await setup('');
  db.exec("UPDATE legal_templates SET is_stub = 1 WHERE slug = 'partner_services'");
  const bundled = read('cloudflare-worker/src/templates/legal/partner_msa_v2.md');
  assert.doesNotMatch(bundled, /\{\{/, 'the bundled file holds no merge field');
  const r = await finalize(e);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [env] = envelopes(db);
  assert.equal(env.document_type, 'partner_services', 'still recorded under its row');
  assert.equal(env.document_body, bundled);
});

test('D758 source: /finalize sends partner_services with refuseUnfilled and answers UnfilledFieldsError before any write', () => {
  const src = read('cloudflare-worker/src/routes/partner_onboarding.ts');
  const fin = src.slice(src.indexOf("onboard.post('/:token/finalize'"), src.indexOf("onboard.get('/:token/status'"));
  assert.match(fin, /documentType: 'partner_services'/);
  assert.match(fin, /refuseUnfilled: true/);
  assert.doesNotMatch(src, /documentType: 'partner_msa_v1'/);
  assert.ok(fin.indexOf('instanceof UnfilledFieldsError') < fin.indexOf('UPDATE partner_deals'), 'the refusal returns before the deal is updated');
});
