import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root='cloudflare-worker/src';
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
// D840 (#2346): Sign in with Mercury writes and reads the member's own row (`routes/mercury_oauth.ts`, `services/mercury/oauth.ts`).
const allowed=new Set(['integrations/providers/mercury.ts','services/mercuryPersonal.ts','routes/mercury_personal.ts','routes/revenue.ts','routes/needs.ts','routes/network.ts','routes/partner_settlements.ts','services/onboardingChecklist.ts','services/raiseCycle.ts','routes/mercury_oauth.ts','services/mercury/oauth.ts',
  // D840 part 4 (#2349): the investor's sections open the caller's own row (its id and how it connected).
  'routes/mercury_investor.ts']);
const callers=new Set(['routes/revenue.ts','routes/mercury_personal.ts','routes/needs.ts','routes/network.ts','services/capitalAttestations.ts']);
test('personal match tables and provider queries stay within the personal allowlist',()=>{
  for(const f of walk(root).filter(f=>/\.[cm]?[jt]s$/.test(f))) {
    const s=readFileSync(f,'utf8');
    if(/mercury_personal_matches|provider_key\s*=\s*['"]mercury['"]/i.test(s)) assert.ok(allowed.has(relative(root,f)),f);
  }
});
test('only member-facing routes can import personal Mercury logic',()=>{
  for(const f of walk(root).filter(f=>/\.[cm]?[jt]s$/.test(f))) {
    const s=readFileSync(f,'utf8');
    if(/(?:from\s*|import\s*\(|require\s*\()['"][^'"]*mercuryPersonal(?:\.ts)?['"]/.test(s)) assert.ok(callers.has(relative(root,f)),f);
  }
});

// ─────────────────────────────────────────────── PR B: what personal code may read and register
const PERSONAL = ['integrations/providers/mercury.ts', 'services/mercuryPersonal.ts', 'routes/mercury_personal.ts',
  'services/capitalAttestations.ts', 'services/capitalAttestationTerms.ts', 'routes/mercury_attestations.ts',
  // D840: the sign-in and the reader it gives a member's row are personal code too.
  'routes/mercury_oauth.ts', 'services/mercury/oauth.ts', 'services/mercury/connection.ts', 'services/mercury/reads.ts',
  // D840 part 4 (#2349): the investor's sections.
  'routes/mercury_investor.ts', 'services/mercury/investorFeeds.ts'];
const src = (f) => readFileSync(join(root, f), 'utf8');
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no Eadwyn connector reader reads Mercury', () => {
  const line = src('services/eadwynReaders.ts').match(/export const CONNECTOR_READERS[^\n]*/)[0];
  assert.ok(line.includes('stripe'), 'the readers line was found');
  assert.doesNotMatch(line, /mercury/i);
});

// D840 (#2346): `disconnect` revokes a sign-in's tokens before the generic route deletes the row; it reads and writes nothing else.
test('the personal provider registers connect and disconnect only: no sync, push, webhook, preview or action', () => {
  const s = code('integrations/providers/mercury.ts');
  const reg = [...s.matchAll(/registerProvider\(\{([^}]*)\}\)/g)];
  assert.equal(reg.length, 1);
  assert.deepEqual(reg[0][1].split(',').map((k) => k.split(':')[0].trim()).filter(Boolean).sort(), ['connect', 'disconnect', 'key']);
  for (const hook of ['sync', 'push', 'handleWebhook', 'webhook', 'preview', 'actions', 'revokeGranted']) {
    assert.doesNotMatch(s, new RegExp(`\\b${hook}\\s*[:(]`), hook);
  }
});

test('personal code names only mercury_accounts of 474\'s tables, and only entity_key, account_last4 and status of entity_bank_accounts', () => {
  const others474 = ['mercury_entity_connections', 'mercury_balance_snapshots', 'mercury_transactions', 'mercury_matches', 'mercury_sync_runs'];
  let registryReads = 0;
  for (const f of PERSONAL) {
    const s = code(f);
    for (const t of [...others474, 'entity_bank_account_reveals']) assert.doesNotMatch(s, new RegExp(`\\b${t}\\b`), `${f}: ${t}`);
    assert.doesNotMatch(s, /account_number|routing_number|decryptBank|revealAccount/i, f);
    for (const m of s.matchAll(/SELECT\s+((?:(?!\bFROM\b)[^`])*?)\s+FROM\s+entity_bank_accounts\b([^`]*)/g)) {
      registryReads += 1;
      assert.deepEqual(m[1].split(',').map((x) => x.trim()).sort(), ['account_last4', 'entity_key', 'status'], f);
      const where = m[2].match(/WHERE([\s\S]*)/)?.[1] ?? '';
      for (const col of where.match(/\b[a-z_]+(?=\s*(?:=|IN\b))/g) ?? []) assert.ok(['status', 'account_last4'].includes(col), `${f}: ${col}`);
    }
    if (/\bentity_bank_accounts\b/.test(s)) assert.equal(f, 'integrations/providers/mercury.ts', 'only decision 3 reads the registry');
  }
  assert.equal(registryReads, 1, 'decision 3 reads the registry once');
  assert.match(code('integrations/providers/mercury.ts'), /FROM mercury_accounts WHERE mercury_account_id IN/);
});
