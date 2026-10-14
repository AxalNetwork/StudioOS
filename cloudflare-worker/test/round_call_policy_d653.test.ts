import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as policy from '../src/services/roundCallPolicy.ts';

const terms = { name: 'Seed', amount_cents: 150000000, instrument: 'safe', terms: 'Recorded terms',
  minimum_cheque_cents: 2500000, target_close: '2030-01-15', deck_id: 1, deck_version: 3, deck_content_hash: 'original',
  data_room_project_uid: 'venture', sector: 'Climate', stage: 'Seed' };
const thesis = { sectors_json: '["Climate"]', stages_json: '["Seed"]', thesis_keywords_json: '["energy"]',
  ticket_min_usd: 25000, ticket_max_usd: 250000, anti_thesis_sectors_json: '[]', anti_thesis_stages_json: '[]' };
const verified = { role: 'investor', is_active: 1, kyc_status: 'approved' };
const recipient = { investor_user_id: 4, name: 'Private investor', email: 'private@example.test', origin: 'match',
  responded_at: null, committed_at: '2030-01-02', last_response_at: '2030-01-03', opened_at: '2030-01-01', data_room_requested_at: null, commitment_cents: null,
  delivery_state: 'pending', match_reasons_json: '["Stage fits Seed"]' };
const checks: Record<string, (p: any) => Promise<void> | void> = {
  flag(p) { assert.equal(p.roundCallsEnabled({ ENVIRONMENT: 'production' }), false);
    assert.equal(p.roundCallsEnabled({ ROUND_CALLS_ENABLED: 'false' }), false);
    assert.equal(p.roundCallsEnabled({ ROUND_CALLS_ENABLED: 'true' }), true); },
  verification(p) { assert.equal(p.verifiedInvestor(verified), true);
    for (const change of [{ role: 'founder' }, { is_active: 0 }, { kyc_status: 'pending' }])
      assert.equal(p.verifiedInvestor({ ...verified, ...change }), false); },
  money(p) { assert.equal(p.positiveCents(1), true);
    for (const n of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, '100']) assert.equal(p.positiveCents(n), false); },
  date(p) { assert.equal(p.validClose('2028-02-29'), true);
    for (const d of ['2027-02-29', '2026-02-31', 'tomorrow', '2026-01-01T00:00:00Z']) assert.equal(p.validClose(d), false); },
  writable(p) { assert.equal(p.writableCall({ state: 'sent', target_close: '2030-01-15' }, '2030-01-01'), true);
    assert.equal(p.writableCall({ state: 'closed', target_close: '2030-01-15' }, '2030-01-01'), false);
    assert.equal(p.writableCall({ state: 'draft', target_close: '2030-01-15' }, '2030-01-01'), false);
    assert.equal(p.writableCall({ state: 'sent', target_close: '2029-01-01' }, '2030-01-01'), false); },
  counsel(p) { const c = { terms_hash: 'v1', counsel_approved_hash: 'v1', counsel_approved_by: 1,
      counsel_approved_at: '2030-01-01', counsel_approval_reference: 'Counsel signed record' };
    assert.equal(p.counselApproved(c), true);
    for (const change of [{ terms_hash: 'v2' }, { counsel_approved_by: null }, { counsel_approved_at: null }, { counsel_approval_reference: null }])
      assert.equal(p.counselApproved({ ...c, ...change }), false); },
  readiness(p) { const r = p.readiness(terms, {}); assert.equal(r.length, 7);
    assert.deepEqual(r.filter((item: any) => !item.ready).map((item: any) => item.key), ['use_of_funds', 'traction']);
    assert.equal(p.readiness({ ...terms, deck_id: null, data_room_project_uid: null }, { revenue: 0 }).find((item: any) => item.key === 'traction').ready, true);
    assert.equal(p.readiness({ ...terms, deck_id: null, data_room_project_uid: null }, {}).find((item: any) => item.key === 'deck').ready, false);
    assert.equal(p.readiness({ ...terms, data_room_project_uid: null }, {}).find((item: any) => item.key === 'data_room').ready, false); },
  match(p) { assert.equal(p.matchReasons(terms, thesis, 'Energy storage').length, 4);
    for (const change of [{ sectors_json: '["Finance"]' }, { stages_json: '["Series A"]' },
      { thesis_keywords_json: '["unrelated"]' }, { ticket_min_usd: 2000000 }, { ticket_max_usd: 20000 },
      { ticket_min_usd: null }, { anti_thesis_sectors_json: '["Climate"]' }, { anti_thesis_stages_json: '["Seed"]' }])
      assert.deepEqual(p.matchReasons(terms, { ...thesis, ...change }, 'Energy storage'), []);
    assert.deepEqual(p.matchReasons({ ...terms, sector: null }, thesis, 'Energy'), []); },
  privacy(p) { const hidden = p.founderRecipient(recipient);
    for (const key of ['name', 'email', 'investor_user_id']) assert.equal(Object.hasOwn(hidden, key), false);
    assert.equal(hidden.opened_at, '2030-01-01');
    assert.deepEqual([hidden.committed_at,hidden.last_response_at],['2030-01-02','2030-01-03']);
    assert.equal(p.founderRecipient({ ...recipient, responded_at: '2030-01-02' }).name, 'Private investor');
    assert.equal(p.founderRecipient({ ...recipient, origin: 'chosen' }).email, 'private@example.test'); },
  async hash(p) { const original = await p.termsHash(terms);
    assert.equal(original.length, 64); assert.equal(await p.termsHash({ ...terms }), original);
    for (const [key, value] of Object.entries({ name: 'Series A', amount_cents: 2, instrument: 'equity',
      terms: 'Changed', minimum_cheque_cents: 1, target_close: '2031-01-01', deck_id: 2, deck_version: 4, deck_content_hash: 'changed',
      data_room_project_uid: null, stage: 'Series A', sector: 'Finance', valuation_cap_cents: 800000000, discount_bps: 2000, pre_money_cents: 1200000000 }))
      assert.notEqual(await p.termsHash({ ...terms, [key]: value }), original); },
};
for (const [name, verify] of Object.entries(checks)) test('D653 policy: ' + name, async () => verify(policy));

// Load the actual production policy with one behavioral change per probe.
// The same assertions fail against the changed module and pass against the
// restored source. No production file is edited while other tests run.
const source = readFileSync('cloudflare-worker/src/services/roundCallPolicy.ts', 'utf8');
const mutations = [
  ['flag', "env.ROUND_CALLS_ENABLED === 'true'", 'true'],
  ['verification', "user.role === 'investor' &&", ''],
  ['verification', 'Number(user.is_active) === 1 &&', ''],
  ['verification', "user.kyc_status === 'approved'", 'true'],
  ['money', 'Number.isSafeInteger(value)', 'Number.isFinite(value)'],
  ['money', 'value > 0', 'value >= 0'],
  ['date', "date.toISOString().slice(0, 10) === value", 'true'],
  ['writable', "call.state === 'sent'", "call.state !== 'draft'"],
  ['writable', 'call.target_close >= today', 'true'],
  ['counsel', 'call.counsel_approved_hash === call.terms_hash', 'true'],
  ['counsel', '!!call.counsel_approved_by', 'true'],
  ['counsel', '!!call.counsel_approved_at', 'true'],
  ['counsel', '!!call.counsel_approval_reference', 'true'],
  ['readiness', 'value != null', '!!value'],
  ['readiness', 'call.deck_id != null && call.deck_version != null', 'true'],
  ['readiness', 'call.data_room_project_uid != null', 'true'],
  ['match', '!list(profile.sectors_json).includes(sector)', 'false'],
  ['match', '!list(profile.stages_json).includes(stage)', 'false'],
  ['match', 'call.amount_cents / 100 < profile.ticket_min_usd', 'false'],
  ['match', 'minimum > profile.ticket_max_usd', 'false'],
  ['match', 'list(profile.anti_thesis_sectors_json).includes(sector)', 'false'],
  ['match', 'list(profile.anti_thesis_stages_json).includes(stage)', 'false'],
  ['match', '!list(profile.thesis_keywords_json).some(word => words.has(word))', 'false'],
  ['privacy', "row.origin === 'chosen' || row.responded_at != null", 'true'],
  ['privacy', 'committed_at: row.committed_at ?? null', 'committed_at: null'],
  ['privacy', 'last_response_at: row.last_response_at ?? null', 'last_response_at: null'],
  ...['name','amount_cents','instrument','terms','minimum_cheque_cents','target_close','deck_id','deck_version','deck_content_hash','data_room_project_uid','stage','sector','valuation_cap_cents','discount_bps','pre_money_cents']
    .map(key => ['hash', 't.' + key, "'removed'"]),
];
for (const [index, [check, old, replacement]] of mutations.entries()) {
  test('D653 mutation/restoration ' + index + ': ' + check, async () => {
    assert.ok(source.includes(old), 'mutation targets current production source');
    const changed = source.replace(old, replacement);
    const js = stripTypeScriptTypes(changed, { mode: 'strip' });
    const mutant = await import('data:text/javascript;base64,' + Buffer.from(js + '\n// mutant ' + index).toString('base64'));
    await assert.rejects(async () => checks[check](mutant), assert.AssertionError);
    await checks[check](policy);
  });
}
