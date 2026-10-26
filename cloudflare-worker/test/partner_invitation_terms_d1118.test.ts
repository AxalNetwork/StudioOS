// D1118 (#2998): per-invitation terms (migration 634), on real migrated SQLite. Synthetic accounts only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { envFor, token } from './_esign_harness.ts';
import onboard from '../src/routes/partner_onboarding.ts';
import adminPartners from '../src/routes/admin_partners.ts';
import { buildProposals } from '../src/services/partnerDeals.ts';
import { parseTermsInput, readStoredTerms, revsharePct, TERMS_LIMITS } from '../src/services/partnerInvitationTerms.ts';
import { readInvitation } from '../src/services/partnerInvitationReads.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const read = (p: string) => readFileSync(p, 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'partner-d1118-'));
const seed = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seed, { enableForeignKeyConstraints: false });
schema.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
for (const name of readdirSync('cloudflare-worker/sql/migrations').filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)) {
  schema.exec(read('cloudflare-worker/sql/migrations/' + name));
}
schema.close();
after(() => rmSync(scratch, { recursive: true, force: true }));

const SUPER = 7, ADMIN = 8;
let serial = 0;
function fixture() {
  const file = join(scratch, `${++serial}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  db.exec(`INSERT INTO users(id,role,name,email,is_active) VALUES
    (${SUPER},'admin','Synthetic super','super@example.invalid',1),(${ADMIN},'admin','Synthetic admin','admin@example.invalid',1);
    INSERT INTO super_admins(user_id) VALUES (${SUPER});`);
  const env: any = envFor(db);
  const app = new Hono<any>().route('/admin', adminPartners).route('/onboard', onboard);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, who: number | null = SUPER) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + await token(who, 'admin');
  const r = await f.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  return { status: r.status, body: await r.json() as any };
}
const OWN = { revshare_pct: 12.5, attribution_window_days: 180, term_months: 18, note: 'Applies to introductions made in writing.' };
const invitations = (f: F) => f.db.prepare('SELECT * FROM partner_invitations ORDER BY id').all() as any[];
const audits = (f: F) => f.db.prepare("SELECT action, details FROM activity_logs WHERE action LIKE 'partner_invitation_%' ORDER BY id").all() as any[];
const create = (f: F, extra: Record<string, unknown> = {}, who = SUPER) =>
  call(f, 'POST', '/admin/invitations', { recipient_email: 'partner@example.invalid', allowed_deal_types: ['deal_sourcing_revshare', 'custom'], ...extra }, who);

test('D1118: a Super Admin sets an invitation’s own terms; they are stored in basis points with who and when, and audited without a figure', async () => {
  const f = fixture();
  try {
    const r = await create(f, { terms: OWN });
    assert.equal(r.status, 201);
    assert.equal(r.body.terms, 'own');
    const [inv] = invitations(f);
    assert.deepEqual(JSON.parse(inv.terms_json), { revshare_bps: 1250, attribution_window_days: 180, term_months: 18, note: OWN.note });
    assert.equal(inv.terms_set_by, SUPER);
    assert.match(inv.terms_set_at, /T.*Z$/);
    const log = audits(f);
    assert.deepEqual(log.map((a) => a.action), ['partner_invitation_created', 'partner_invitation_terms_set']);
    assert.deepEqual(JSON.parse(log[1].details).deal_types, ['deal_sourcing_revshare', 'custom']);
    assert.equal(JSON.parse(log[0].details).terms, 'own');
    const text = JSON.stringify(f.db.prepare('SELECT details FROM activity_logs').all()) + JSON.stringify(f.db.prepare('SELECT filters_json FROM admin_audit_log').all());
    for (const figure of ['1250', '12.5', '180', '"18"', 'in writing']) assert.ok(!text.includes(figure), `the audit holds no ${figure}`);
  } finally { f.db.close(); }
});

test('D1118: without terms the invitation goes with the standard terms; nothing is set and no approval is audited', async () => {
  const f = fixture();
  try {
    for (const terms of [undefined, null]) {
      const r = await create(f, terms === undefined ? {} : { terms });
      assert.equal(r.status, 201); assert.equal(r.body.terms, 'standard');
    }
    for (const inv of invitations(f)) assert.deepEqual([inv.terms_json, inv.terms_set_by, inv.terms_set_at], [null, null, null]);
    assert.ok(!audits(f).some((a) => a.action === 'partner_invitation_terms_set'));
  } finally { f.db.close(); }
});

test('D1118: an Admin who is not the Super Admin cannot set terms, and nothing is written or sent', async () => {
  const f = fixture();
  try {
    const r = await create(f, { terms: OWN }, ADMIN);
    assert.equal(r.status, 403); assert.equal(r.body.error, 'super_admin_required');
    assert.equal(invitations(f).length, 0); assert.equal(audits(f).length, 0);
    // The same Admin's invitation with the standard terms goes.
    assert.equal((await create(f, {}, ADMIN)).status, 201);
  } finally { f.db.close(); }
});

test('D1118: terms apply only to Deal-sourcing revenue share and Custom', async () => {
  const f = fixture();
  try {
    const r = await create(f, { allowed_deal_types: ['equity_partnership', 'capital_partnership'], terms: OWN });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'terms_not_applicable');
    assert.equal(invitations(f).length, 0);
    for (const types of [['custom'], ['deal_sourcing_revshare'], ['equity_partnership', 'custom']]) {
      assert.equal((await create(f, { allowed_deal_types: types, recipient_email: `${types.join('-')}@example.invalid`, terms: OWN })).status, 201, types.join());
    }
  } finally { f.db.close(); }
});

test('D1118: each figure is bounded; a refusal names the field, never the value, and writes nothing', async () => {
  const f = fixture();
  try {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ revshare_pct: 0 }, 'terms_revshare_invalid'], [{ revshare_pct: 50.01 }, 'terms_revshare_invalid'],
      [{ revshare_pct: 12.345 }, 'terms_revshare_invalid'], [{ revshare_pct: '12' }, 'terms_revshare_invalid'],
      [{ attribution_window_days: 29 }, 'terms_window_invalid'], [{ attribution_window_days: 1096 }, 'terms_window_invalid'],
      [{ attribution_window_days: 90.5 }, 'terms_window_invalid'], [{ term_months: 0 }, 'terms_term_invalid'],
      [{ term_months: 61 }, 'terms_term_invalid'], [{ note: 'x'.repeat(501) }, 'terms_note_invalid'], [{ note: 5 }, 'terms_note_invalid'],
    ];
    const sentences = new Map<string, string>();
    for (const [change, code] of cases) {
      const r = await create(f, { terms: { ...OWN, ...change } });
      assert.equal(r.status, 400, code); assert.equal(r.body.error, code, JSON.stringify(change));
      assert.deepEqual(Object.keys(r.body).sort(), ['error', 'message']);
      // One fixed sentence per field, whatever value was sent: nothing sent is echoed.
      const key = `${code}:${typeof Object.values(change)[0]}`;
      if (sentences.has(key)) assert.equal(r.body.message, sentences.get(key), key);
      sentences.set(key, r.body.message);
    }
    assert.equal((await create(f, { terms: [] })).body.error, 'terms_invalid');
    assert.equal(invitations(f).length, 0);
    // The bounds themselves are accepted.
    for (const edge of [{ revshare_pct: 0.01, attribution_window_days: 30, term_months: 1 }, { revshare_pct: 50, attribution_window_days: 1095, term_months: 60, note: 'x'.repeat(500) }]) {
      assert.equal((await create(f, { recipient_email: `edge${serial}${edge.term_months}@example.invalid`, terms: { ...OWN, ...edge } })).status, 201);
    }
    assert.deepEqual(TERMS_LIMITS.revshare_bps, [1, 5000]);
  } finally { f.db.close(); }
});

test('D1118: the offers carry the terms for the two types; every other type and the LP line stay standard', () => {
  const terms = parseTermsInput(OWN);
  assert.ok(terms.ok);
  const own = buildProposals(['deal_sourcing_revshare', 'custom', 'equity_partnership'], { motivation: 'Synthetic motivation' }, terms.ok ? terms.terms : null);
  const standard = buildProposals(['deal_sourcing_revshare', 'custom', 'equity_partnership'], { motivation: 'Synthetic motivation' });
  const [ds, custom, equity] = own;
  assert.equal(ds.terms.founder_revshare_pct, '12.5% of Axal fees on deals closed within 180 days of intro');
  assert.equal(ds.terms.lp_revshare_pct, standard[0].terms.lp_revshare_pct);
  assert.equal(ds.terms.attribution_window_days, 180);
  assert.equal(ds.terms.terms_note, OWN.note);
  assert.equal(ds.term_months, 18);
  assert.match(ds.contract_excerpt, /earn 12\.5% of Axal management fees on founder-sourced deals closed within 180 days/);
  assert.match(ds.contract_excerpt, /Term: 18 months/);
  assert.match(ds.contract_excerpt, /Terms note: Applies to introductions made in writing\./);
  assert.equal(custom.terms.revshare_pct, '12.5% of Axal fees on deals the partner introduces, closed within 180 days of introduction');
  assert.equal(custom.terms.description, OWN.note);
  assert.equal(custom.term_months, 18);
  assert.match(custom.contract_excerpt, /12\.5% of Axal fees on deals Partner introduces that close within 180 days of introduction, for a term of 18 months/);
  assert.deepEqual(equity, standard[2]);
  // The standard offers are unchanged.
  assert.match(String(standard[0].terms.founder_revshare_pct), /^5% .* 12 months/);
  assert.equal(standard[0].term_months, 12); assert.equal(standard[1].term_months, 12);
  assert.ok(!('revshare_pct' in standard[1].terms));
});

test('D1118: the invitee’s offers and the chosen deal’s proposal_json carry the Super Admin’s terms', async () => {
  const f = fixture();
  try {
    const r = await create(f, { terms: OWN });
    const inv = invitations(f)[0];
    f.db.prepare("INSERT INTO partner_profiles(email, invitation_id, full_name, motivation) VALUES (?, ?, 'Synthetic partner', 'Synthetic motivation')").run(inv.recipient_email, r.body.id);
    f.db.prepare("UPDATE partner_invitations SET status = 'profiled' WHERE id = ?").run(r.body.id);
    const proposed = await call(f, 'POST', `/onboard/${inv.token}/propose`, {}, null);
    assert.equal(proposed.status, 200);
    assert.deepEqual(proposed.body.proposals.map((p: any) => p.term_months), [18, 18]);
    const chosen = await call(f, 'POST', `/onboard/${inv.token}/select`, { deal_type: 'deal_sourcing_revshare' }, null);
    assert.ok(chosen.status < 300, JSON.stringify(chosen.body));
    const deal: any = f.db.prepare('SELECT term_months, proposal_json FROM partner_deals WHERE invitation_id = ?').get(r.body.id);
    assert.equal(deal.term_months, 18);
    assert.equal(JSON.parse(deal.proposal_json).terms.founder_revshare_pct, '12.5% of Axal fees on deals closed within 180 days of intro');
    // The admin read names the terms and who set them, and its offers use them.
    const view: any = await readInvitation(f.env, r.body.id);
    assert.deepEqual(view.invitation.terms, { state: 'own', revshare_pct: '12.5', attribution_window_days: 180, term_months: 18,
      note: OWN.note, set_by_name: 'Synthetic super', set_at: inv.terms_set_at });
    assert.ok(!('terms_json' in view.invitation));
    assert.deepEqual(view.offers_seen.offers.map((o: any) => o.term_months), [18, 18]);
  } finally { f.db.close(); }
});

test('D1118: terms that cannot be read stop the offers; they never fall back to the standard terms', async () => {
  const f = fixture();
  try {
    const r = await create(f, { terms: OWN });
    const inv = invitations(f)[0];
    f.db.prepare("INSERT INTO partner_profiles(email, invitation_id, full_name) VALUES (?, ?, 'Synthetic partner')").run(inv.recipient_email, r.body.id);
    f.db.prepare("UPDATE partner_invitations SET status = 'profiled' WHERE id = ?").run(r.body.id);
    assert.equal((await call(f, 'POST', `/onboard/${inv.token}/propose`, {}, null)).status, 200);
    f.db.prepare(`UPDATE partner_invitations SET terms_json = '{"revshare_bps":0,"attribution_window_days":180,"term_months":18,"note":null}' WHERE id = ?`).run(r.body.id);
    for (const step of ['propose', 'select']) {
      const res = await call(f, 'POST', `/onboard/${inv.token}/${step}`, { deal_type: 'custom' }, null);
      assert.equal(res.status, 503, step); assert.equal(res.body.error, 'terms_unreadable', step);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partner_deals').get()!.n, 0);
    const view: any = await readInvitation(f.env, r.body.id);
    assert.deepEqual(view.invitation.terms, { state: 'unreadable' });
    assert.equal(view.offers_seen.available, false);
    // The database refuses a terms value that is not a JSON object.
    assert.throws(() => f.db.prepare("UPDATE partner_invitations SET terms_json = '[1]' WHERE id = ?").run(r.body.id));
  } finally { f.db.close(); }
});

test('D1118: stored terms are read strictly, and a percentage is written from basis points', () => {
  assert.deepEqual(readStoredTerms(null), { state: 'standard' });
  for (const bad of ['not json', '[]', '{"revshare_bps":5001,"attribution_window_days":90,"term_months":12,"note":null}',
    '{"revshare_bps":100,"attribution_window_days":90,"term_months":12,"note":7}', '{"revshare_bps":100,"attribution_window_days":90,"note":null}']) {
    assert.deepEqual(readStoredTerms(bad), { state: 'unreadable' }, bad);
  }
  const ok = readStoredTerms('{"revshare_bps":1000,"attribution_window_days":365,"term_months":12,"note":null}');
  assert.equal(ok.state, 'set');
  assert.deepEqual([revsharePct(1000), revsharePct(1250), revsharePct(1), revsharePct(5000)], ['10', '12.5', '0.01', '50']);
});
