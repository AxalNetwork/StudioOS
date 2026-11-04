// D2319 (#4415): retired aliases must not escape through Worker navigation or old search metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOG } from '../src/services/onboardingChecklist.ts';
import { hrefOf } from '../src/services/calendar/items.ts';
import { explorerPromoLink } from '../src/services/explorerPromo.ts';
import { executeTool } from '../src/services/advisor/tools.ts';
import { personRecord } from '../src/services/mail/contextPack.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { searchSemantic } from '../src/services/vectorize.ts';

function env(url = '/partners?user=7#profile') {
  return {
    AI: { run: async () => ({ data: [Array(768).fill(0.01)] }) },
    VECTORIZE: { query: async () => ({ matches: [{ id: 'partner:7', score: 0.9, metadata: { type: 'partner', entity_id: 7, title: 'Example partner', url } }] }) },
  } as any;
}
const context = (persona: string, environment = {} as any) => ({ env: environment, user: { id: 1 } as any, persona, tiers: new Set<string>(), conversationId: null });

test('D2319: each checklist entry opens its canonical tool', () => {
  for (const [role, key, route] of [
    ['newFounder', 'nf.project', '/build'], ['newFounder', 'nf.discovery', '/validate/customer-research'],
    ['newFounder', 'nf.deck', '/raise/pitch'], ['newFounder', 'nf.scoring', '/build'],
    ['existingFounder', 'ef.scoring', '/build'], ['operatingPartner', 'op.conflicts', '/account/portfolio/settings'],
  ] as const) assert.equal(CATALOG[role].find((item) => item.key === key)?.route, route, key);
});

test('D2319: contact calendar tasks open the Contacts tab', () => {
  assert.equal(hrefOf({ kind: 'contact_task' } as any), '/network?tab=contacts');
});

test('D2319: both promo notices use canonical redemption and safely retain the code', () => {
  const code = 'EX+AMPLE&other=bad#tail';
  const notice = { route: explorerPromoLink(code) };
  assert.ok(notice.route.startsWith('/pricing/products?code='));
  const target = new URL(notice.route, 'https://axal.vc');
  assert.equal(target.searchParams.get('code'), code);
  assert.deepEqual([...target.searchParams.keys()], ['code']);
  assert.equal(target.hash, '');
  const source = readFileSync(new URL('../src/routes/advisor.ts', import.meta.url), 'utf8');
  assert.match(source, /route: explorerPromoLink\(issued\.code\)/);
  assert.match(source, /route: explorerPromoLink\(promo\.code\)/);
});

test('D2319: partner CTAs preserve persona routing and selected partner', async () => {
  for (const [persona, browse, selected] of [
    ['founder', '/build/marketplace?tab=services', '/build/marketplace?tab=services&provider=7'],
    ['investor', '/directory', '/directory?user=7'],
  ]) {
    const result = await executeTool(context(persona, env()), 'findPartner', { query: 'Example' });
    assert.equal(result.cta.primary.route, selected);
    assert.equal(result.cta.secondary?.route, browse);
    const empty = await executeTool(context(persona), 'findPartner', { query: 'Example' });
    assert.equal(empty.cta.primary.route, browse);
  }
});

test('D2319: investor upgrade keeps its pricing tab and feature parameters', async () => {
  const result = await executeTool(context('investor'), 'surfacePaywall', { feature: 'deal&view', required_tier: 'pro' });
  const target = new URL(result.cta.primary.route, 'https://axal.vc');
  assert.equal(target.pathname, '/pricing');
  assert.equal(target.searchParams.get('for'), 'investor');
  assert.equal(target.searchParams.get('feature'), 'deal&view');
});

test('D2319: deal fallback and page tool offer live destinations', async () => {
  assert.equal((await executeTool(context('founder'), 'findDeal', {})).cta.primary.route, '/build');
  assert.equal((await executeTool(context('founder'), 'openPage', { route: '/raise/pitch' })).cta.primary.route, '/raise/pitch');
});

test('D2319: already indexed directory URLs normalize on reads without losing query or hash', async () => {
  assert.equal((await searchSemantic(env(), 'Example', { type: 'partner' }))[0]?.url, '/directory?user=7#profile');
  assert.equal((await searchSemantic(env('/partners/onboard'), 'Example', { type: 'partner' }))[0]?.url, '/partners/onboard');
  assert.equal((await searchSemantic(env('/directory?user=7'), 'Example', { type: 'partner' }))[0]?.url, '/directory?user=7');
});


test('D2319: owned engagement mail links retain founder versus changed-role routing', async () => {
  const schema = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  const { DB, db } = makeD1(['partners', 'engagements', 'partner_bookings', 'partner_office_hour_slots'].map((t) => tableFromBaseline(schema, t)).join('\n'));
  try {
    db.exec("INSERT INTO partners(id,name,email) VALUES(7,'Example partner','partner@example.test'); INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price) VALUES(1,'engagement',1,1,7,10,20,100)");
    const user = { id: 1, role: 'founder', founder_id: 10 } as any;
    const record = await personRecord({ DB } as any, user, 'partner:1');
    assert.equal(record.item.link, '/build/marketplace?tab=needs');
    for (const role of ['partner', 'investor', 'advisor', 'exploring']) {
      const changed = await personRecord({ DB } as any, { ...user, role }, 'partner:1');
      assert.equal(changed.item.link, '/pipeline/leads', role);
    }
    await assert.rejects(() => personRecord({ DB } as any, { ...user, founder_id: 99 }, 'partner:1'), /Record not found/);
    await assert.rejects(() => personRecord({ DB } as any, { ...user, founder_id: null }, 'partner:1'), /Record not found/);
  } finally { db.close(); }
});
