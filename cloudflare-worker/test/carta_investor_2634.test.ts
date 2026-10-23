import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import investor from '../src/routes/carta_investor.ts';
import integrations from '../src/routes/integrations.ts';
import { getProviderImpl, REGISTRY, descriptorForRole } from '../src/integrations/registry.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { syncAllCartaIntegrations } from '../src/integrations/providers/carta.ts';
import { issueOauthState } from '../src/integrations/oauth.ts';
import { cartaScopesFor } from '../src/integrations/cartaScopes.ts';
import { hasScopeOverreach } from '../src/integrations/connectorRules.ts';
import { readCartaInvestor } from '../src/integrations/cartaInvestor.ts';

const expectedScopes = (audience: 'founder' | 'investor') => audience === 'investor'
  ? ['read_investor_firms', 'read_investor_funds', 'read_investor_investments', 'read_investor_securities', 'read_investor_capitalizationtables']
  : ['read_issuer_info', 'read_issuer_stakeholders', 'read_issuer_securities'];

const JWT_SECRET = 'test'.repeat(16);
async function fixture(role = 'investor', support = false) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'studio');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT, action TEXT, details TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_waitlist(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, notes TEXT, notified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider_key));
    INSERT INTO users(id, role, name, email) VALUES (1, 'investor', 'Synthetic', 'synthetic@example.test'), (2, 'investor', 'Other synthetic', 'other@example.test');`);
  db.prepare('UPDATE users SET role=? WHERE id=1').run(role);
  db.exec(readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/457_integrations_last_error_at.sql', 'utf8'));
  const env: any = { DB: d1Over(db), RATE_LIMITS: memKV(), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'test'.repeat(16), CARTA_CLIENT_ID: 'test-client', CARTA_CLIENT_SECRET: 'test-secret' };
  const jwt = await new SignJWT({ user_id: 1, role, ...(support ? { impersonated_by: 2 } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers = { Authorization: `Bearer ${jwt}` };
  const app = new Hono<any>(); app.route('/api/carta/investor', investor); app.route('/api/integrations', integrations);
  app.onError((e, c) => e instanceof Response ? e : c.json({ error: e.message }, 500));
  async function seed(owner = 1, audience = 'investor', isDemo = true) {
    const uid = `fixture-${owner}`;
    const enc = await encryptCredentials(env, uid, { access_token: `access-${owner}`, refresh_token: `refresh-${owner}` });
    db.prepare("INSERT INTO integrations(uid,user_id,provider_key,status,auth_type,credentials_enc,config_json,scopes_json) VALUES (?,?,'carta','active','oauth2',?,?,?)")
      .run(uid, owner, enc, JSON.stringify({ audience, is_demo: isDemo }), JSON.stringify(expectedScopes(audience as any)));
  }
  const call = (path: string, init: any = {}) => app.request(path, { ...init, headers: { ...headers, ...init.headers } }, env);
  return { db, env, app, headers, call, seed };
}

for (const audience of ['founder', 'investor'] as const) {
  test(`${audience} requests only its audience scopes and refuses the other audience`, async () => {
    const f = await fixture(audience);
    try {
      const r = await f.call('/api/integrations/oauth/carta/start'); assert.equal(r.status, 200);
      const body = await r.json() as any;
      assert.deepEqual(new URL(body.authorize_url).searchParams.get('scope')?.split(' '), expectedScopes(audience));
      const extra = JSON.parse((f.db.prepare('SELECT extra_json FROM oauth_state_tokens WHERE state=?').get(body.state) as any).extra_json);
      assert.equal(extra.carta_audience, audience);
      const desc = descriptorForRole(REGISTRY.find(x => x.key === 'carta')!, audience);
      assert.equal(hasScopeOverreach(desc, expectedScopes(audience)), false);
      assert.equal(hasScopeOverreach(desc, expectedScopes(audience).map(s => s.toUpperCase())), true);
      assert.equal(hasScopeOverreach(desc, expectedScopes(audience === 'founder' ? 'investor' : 'founder')), true);
    } finally { f.db.close(); }
  });
  for (const overreach of [false, true]) test(`${audience} callback ${overreach ? 'revokes overreach' : 'accepts its grant'} before storing`, async () => {
    const f = await fixture(audience); const before = globalThis.fetch; let revokes = 0; let issuerReads = 0;
    const scopes = [...expectedScopes(audience), ...(overreach ? [audience === 'investor' ? 'read_issuer_info' : 'read_investor_firms'] : [])];
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/o/access_token/')) return new Response(JSON.stringify({ access_token: 'access-fixture', refresh_token: 'refresh-fixture', scope: scopes.join(' ') }));
      if (url.endsWith('/o/revoke_token/')) { revokes++; return new Response('{}'); }
      issuerReads++;
      assert.equal(audience, 'founder'); assert.equal(overreach, false); assert.ok(url.endsWith('/issuers'));
      return new Response(JSON.stringify({ issuers: [] }));
    }) as any;
    try {
      const state = await issueOauthState(f.env, 1, 'carta', 'verifier-fixture', { carta_audience: audience, is_demo: true });
      const response = await f.call(`/api/integrations/oauth/carta/callback?code=fixture&state=${encodeURIComponent(state)}&carta_audience=${audience === 'investor' ? 'founder' : 'investor'}`);
      assert.equal(response.status, 302);
      assert.ok(response.headers.get('location')?.includes(overreach ? 'reason=scope_overreach' : 'oauth=ok'));
      assert.equal(revokes, overreach ? 1 : 0);
      assert.equal(issuerReads, audience === 'founder' && !overreach ? 1 : 0);
      const row = f.db.prepare("SELECT * FROM integrations WHERE user_id=1 AND provider_key='carta'").get() as any;
      assert.equal(!!row, !overreach);
      if (row) assert.equal(JSON.parse(row.config_json).audience, audience);
    } finally { globalThis.fetch = before; f.db.close(); }
  });
}

test('an audience change during sign-in cannot exchange the code', async () => {
  const f = await fixture(); const before = globalThis.fetch; let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls++; assert.fail('must refuse before exchange'); }) as any;
  try {
    const state = await issueOauthState(f.env, 1, 'carta', 'fixture', { carta_audience: 'founder', is_demo: true });
    const r = await f.call(`/api/integrations/oauth/carta/callback?code=fixture&state=${encodeURIComponent(state)}`);
    assert.equal(r.status, 302); assert.ok(r.headers.get('location')?.includes('oauth=error'));
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM integrations').get() as any).n, 0);
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = before; f.db.close(); }
});

const root = '/api/carta/investor';
const base = '/firms/firm-fixture/funds/fund-fixture/investments/company-fixture';
const cases = [
  { path: '/firms', field: 'firms', record: { id: 'firm-fixture', name: 'Synthetic firm', stakeholderName: 'must-not-pass', email: 'must-not-pass' }, expected: { id: 'firm-fixture', name: 'Synthetic firm' } },
  { path: '/firms/firm-fixture/funds', field: 'funds', record: { id: 'fund-fixture', firmId: 'firm-fixture', name: 'Synthetic fund' }, expected: { id: 'fund-fixture', firm_id: 'firm-fixture', name: 'Synthetic fund' } },
  { path: '/firms/firm-fixture/funds/fund-fixture/investments', field: 'investments', record: { companyId: 'company-fixture', legalName: 'Synthetic company' }, expected: { company_id: 'company-fixture', firm_id: null, fund_id: null, legal_name: 'Synthetic company', display_name: null, reference_cap_table_id: null } },
  { path: base+'/certificates', field: 'certificates', record: { id: 'cert-fixture', quantity: { value: '0' }, pricePerShare: { amount: { value: '1.25' }, currencyCode: { value: 'USD' } } }, expected: { quantity: '0', price_per_share: { amount: '1.25', currency: 'USD' }, type: 'certificate' } },
  { path: base+'/convertibleNotes', field: 'convertibleNotes', record: { id: 'note-fixture', cashPaid: { amount: { value: '100.50' }, currencyCode: { value: 'USD' } }, noteBlock: { noteType: 'SAFE' } }, expected: { cash_paid: { amount: '100.50', currency: 'USD' }, note_type: 'SAFE', type: 'convertible_note' } },
  { path: base+'/warrants', field: 'warrants', record: { id: 'warrant-fixture', quantity: { value: '9007199254740993' }, warrantBlock: { shareClassName: 'Synthetic class', exercisePrice: { amount: { value: '2' }, currencyCode: { value: 'USD' } } } }, expected: { quantity: '9007199254740993', price_per_share: null, type: 'warrant', share_class: 'Synthetic class', exercise_price: { amount: '2', currency: 'USD' } } },
  { path: base+'/capitalizationTables', field: 'capitalizationTables', record: { id: 'cap-fixture', name: 'Primary', type: 'PRIMARY', asOfDate: { value: '2026-10-23' } }, expected: { name: 'Primary', type: 'PRIMARY', as_of: '2026-10-23' } },
];
for (const isDemo of [true, false]) test(`own ${isDemo ? 'playground' : 'production'} Carta reads every collection and paginates without leaking unknown fields`, async () => {
  const f = await fixture(); const before = globalThis.fetch; await f.seed(1, 'investor', isDemo);
  const expectedHost = isDemo ? 'api.playground.carta.team' : 'api.carta.com';
  let selected = cases[0]; let second = false; let requests = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input)); requests++;
    assert.equal(url.hostname, expectedHost); assert.equal(url.pathname, '/v1alpha1/investors'+selected.path);
    assert.equal(url.searchParams.get('pageSize'), '25'); assert.equal(url.searchParams.get('pageToken'), second ? 'page+2/=' : null);
    assert.equal(init.redirect, 'error'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer access-1');
    return new Response(JSON.stringify({ [selected.field]: second ? [] : [{ ...selected.record, stakeholderName: 'must-not-pass', email: 'must-not-pass' }], ...(!second ? { nextPageToken: 'page+2/=' } : {}) }));
  }) as any;
  try {
    for (const item of cases) {
      selected = item; second = false;
      const r = await f.call(root+item.path); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
      const body = await r.json() as any;
      for (const [key,value] of Object.entries(item.expected)) assert.deepEqual(body.items[0][key], value);
      assert.equal(JSON.stringify(body).includes('must-not-pass'), false);
      assert.equal(body.next_page_token, 'page+2/=');
      if (item.field === 'investments') assert.match(body.coverage, /only investments with cap-table data/);
      second = true;
      const next = await f.call(root+item.path+'?page_token='+encodeURIComponent(body.next_page_token));
      assert.deepEqual((await next.json() as any).items, []);
    }
    assert.equal(requests, cases.length*2);
    const logs = JSON.stringify(f.db.prepare('SELECT response_summary,payload_json FROM integration_logs').all());
    assert.equal(logs.includes('Synthetic'), false); assert.equal(logs.includes('must-not-pass'), false); assert.equal(logs.includes('9007199254740993'), false);
  } finally { globalThis.fetch = before; f.db.close(); }
});

test('cap table summary and share classes preserve missing values and strip stakeholder data', async () => {
  const f = await fixture(); await f.seed(); const before = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ capitalizationTable: { id: 'cap-fixture', summary: { fullyDilutedShares: { value: '123.45' } }, shareClassDetails: [{ shareClass: { id: 'class-fixture', name: 'Synthetic common' }, summary: { outstandingShares: { value: '0' } }, stakeholderNames: ['must-not-pass'] }], stakeholders: ['must-not-pass'] } }))) as any;
  try {
    const r = await f.call(root+base+'/capitalizationTables/cap-fixture'); assert.equal(r.status,200);
    const body = await r.json() as any;
    assert.equal(body.capitalization_table.summary.fully_diluted_shares,'123.45');
    assert.equal(body.capitalization_table.summary.cash_raised,null);
    assert.equal(body.capitalization_table.share_classes[0].outstanding_shares,'0');
    assert.equal(JSON.stringify(body).includes('must-not-pass'),false);
  } finally { globalThis.fetch=before; f.db.close(); }
});

for (const role of ['founder', 'admin', 'partner']) test(`${role} cannot read an investor connection`, async () => {
  const f = await fixture(role); await f.seed();
  try { const r=await f.call(root+'/firms'); assert.equal(r.status,403); } finally { f.db.close(); }
});
for (const scenario of ['support','other-owner','issuer-grant','wrong-audience','overreach','missing-scopes','inactive','bad-id','wildcard','bad-page']) test(`investor read refuses ${scenario} before any Carta request`, async () => {
  const f=await fixture('investor',scenario==='support'); const before=globalThis.fetch;
  if(scenario==='other-owner') await f.seed(2); else await f.seed(1,['issuer-grant', 'wrong-audience'].includes(scenario)?'founder':'investor');
  if(scenario==='wrong-audience')f.db.prepare('UPDATE integrations SET scopes_json=?').run(JSON.stringify(expectedScopes('investor')));
  if(scenario==='overreach')f.db.prepare('UPDATE integrations SET scopes_json=?').run(JSON.stringify([...expectedScopes('investor'),'write_investor_funds']));
  if(scenario==='missing-scopes')f.db.prepare("UPDATE integrations SET scopes_json='[]'").run();
  if(scenario==='inactive')f.db.prepare("UPDATE integrations SET status='error'").run();
  globalThis.fetch=(async()=>{assert.fail('refused before network');}) as any;
  try {
    const path=scenario==='bad-id'?'/firms/bad%20id/funds':scenario==='wildcard'?'/firms/-/funds':scenario==='bad-page'?'/firms?page_token=https://attacker.test':'/firms';
    const r=await f.call(root+path); assert.ok([400,403,404,409].includes(r.status),`${scenario}: ${r.status}`);
  } finally {globalThis.fetch=before;f.db.close();}
});
for (const status of [403,429,500]) test(`Carta ${status} is Unreadable without exposing provider text or returning zero`, async()=>{
  const f=await fixture();await f.seed();const before=globalThis.fetch;
  globalThis.fetch=(async()=>new Response('must-not-pass',{status})) as any;
  try {const r=await f.call(root+'/firms');assert.equal(r.status,502);const body=await r.text();assert.match(body,/carta_unreadable/);assert.equal(body.includes('must-not-pass'),false);assert.equal(body.includes('items'),false);}
  finally{globalThis.fetch=before;f.db.close();}
});
for (const data of [{firms:'bad'},{firms:[],nextPageToken:'https://attacker.test'},{firms:[null]}]) test('malformed Carta pagination/data is unreadable',async()=>{
  await assert.rejects(readCartaInvestor(async()=>new Response(JSON.stringify(data)),'/investors/firms','firms'),/carta_unreadable/);
});
test('investor sync, settings and disconnect never touch founder cap-table stores',async()=>{
  const f=await fixture();await f.seed();const before=globalThis.fetch;const calls:string[]=[];
  globalThis.fetch=(async(input:any)=>{calls.push(String(input));return new Response('{}');}) as any;
  // These tables deliberately do not exist: any attempted access is captured too.
  const attempted: string[] = [];
  const original=f.env.DB.prepare.bind(f.env.DB);f.env.DB.prepare=(sql:string)=>{if (/cap_table_/.test(sql)) attempted.push(sql);return original(sql);};
  try{
    const impl=getProviderImpl('carta')!;const row=f.db.prepare('SELECT * FROM integrations').get() as any;
    assert.equal((await impl.sync!({env:f.env} as any,{id:1,role:'investor'} as any,row)).counts?.pulled,0);
    await impl.postConnect!({env:f.env} as any,{id:1,role:'investor'} as any,row);
    assert.deepEqual(await syncAllCartaIntegrations(f.env), { scanned: 0, ok: 0, failed: 0 });
    assert.equal((f.db.prepare('SELECT last_synced_at FROM integrations').get() as any).last_synced_at, null);
    await impl.disconnect!({env:f.env} as any,{id:1,role:'investor'} as any,row);
    assert.deepEqual(calls,['https://login.playground.carta.team/o/revoke_token/']);
    assert.deepEqual(attempted, []);
    const r=await f.call('/api/integrations/fixture-1/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({audience:'founder'})});
    assert.equal(r.status,400);
  }finally{globalThis.fetch=before;f.db.close();}
});

for (const audience of ['founder', 'investor'] as const) {
  for (const overreach of [false, true]) test(`${audience} JSON connect ${overreach ? 'rejects' : 'accepts'} the audience grant`, async () => {
    const f = await fixture(audience); const before = globalThis.fetch; let revoked = false;
    const scopes = [...expectedScopes(audience), ...(overreach ? ['write_issuer_securities'] : [])];
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/o/access_token/')) return new Response(JSON.stringify({ access_token: 'access-fixture', refresh_token: 'refresh-fixture', scope: scopes.join(' ') }));
      if (url.endsWith('/o/revoke_token/')) { revoked = true; return new Response('{}'); }
      assert.equal(audience, 'founder'); assert.equal(overreach, false);
      return new Response(JSON.stringify({ issuers: [] }));
    }) as any;
    try {
      const r = await f.call('/api/integrations/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_key: 'carta', oauth_code: 'fixture', config: { is_demo: true, audience: audience === 'investor' ? 'founder' : 'investor' } }) });
      assert.equal(r.status, overreach ? 403 : 200);
      assert.equal(revoked, overreach);
      const row = f.db.prepare('SELECT config_json FROM integrations WHERE user_id=1').get() as any;
      assert.equal(!!row, !overreach);
      if (row) assert.equal(JSON.parse(row.config_json).audience, audience);
    } finally { globalThis.fetch = before; f.db.close(); }
  });
}

test('an investor refresh refuses an expanded grant before an API retry', async () => {
  const f = await fixture(); await f.seed(); const before = globalThis.fetch;
  let reads = 0, revokes = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes('/v1alpha1/')) { reads++; return new Response('{}', { status: 401 }); }
    if (url.endsWith('/o/access_token/')) return new Response(JSON.stringify({ access_token: 'expanded-fixture', refresh_token: 'rotated-fixture', scope: [...expectedScopes('investor'), 'read_issuer_info'].join(' ') }));
    assert.ok(url.endsWith('/o/revoke_token/')); revokes++; return new Response('{}');
  }) as any;
  try {
    const original = (f.db.prepare('SELECT credentials_enc FROM integrations').get() as any).credentials_enc;
    const r = await f.call(root+'/firms'); assert.equal(r.status, 502);
    assert.equal(reads, 1); assert.equal(revokes, 1);
    assert.equal((f.db.prepare('SELECT credentials_enc FROM integrations').get() as any).credentials_enc, original);
  } finally { globalThis.fetch = before; f.db.close(); }
});

test('support sign-in refuses before creating OAuth state', async () => {
  const f = await fixture('investor', true);
  f.db.exec('CREATE TABLE oauth_state_tokens(state TEXT)');
  try {
    const r = await f.call('/api/integrations/oauth/carta/start'); assert.equal(r.status, 403);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM oauth_state_tokens').get() as any).n, 0);
  } finally { f.db.close(); }
});

test('response limits and malformed cap tables fail instead of silently truncating', async () => {
  for (const body of ['not-json', JSON.stringify({ capitalizationTable: {}, padding: 'x'.repeat(2_000_001) }), JSON.stringify({ capitalizationTable: [] }),
    JSON.stringify({ capitalizationTable: { shareClassDetails: Array(1001).fill({}) } })]) {
    await assert.rejects(readCartaInvestor(async () => new Response(body), '/investors/firms/firm/funds/fund/investments/company/capitalizationTables/cap', 'capitalizationTable'), /carta_unreadable/);
  }
});

test('connector pages and cards describe each audience without mixing grants', async () => {
  const { pageDescriptor, publicDescriptor, audienceFor } = await import('../src/integrations/registry.ts');
  const p = REGISTRY.find(x => x.key === 'carta')!;
  const founder = pageDescriptor(p, { role: 'founder', hq: true })!;
  const investor = pageDescriptor(p, { role: 'investor', hq: false })!;
  assert.match(founder.tagline, /Founding team/);
  assert.match(investor.tagline, /firms, funds, investments/);
  assert.equal(investor.tools.some(x => x.name === 'list_stakeholders'), false);
  assert.equal(investor.trust.read_only, true);
  assert.match(publicDescriptor(p, { role: 'investor', hq: true }).description, /your own Carta firms/);
  assert.deepEqual(publicDescriptor(p, { role: 'investor', hq: true }).feeds, ['deals_pipeline', 'investor_portfolio']);
  assert.equal(audienceFor(p, { role: 'admin', hq: true }), 'none');
});

test('the Carta scope contract uses exactly the documented audience lists', () => {
  assert.deepEqual(cartaScopesFor('founder'), expectedScopes('founder'));
  assert.deepEqual(cartaScopesFor('investor'), expectedScopes('investor'));
});
