/**
 * D6264 (#6264) — Research › Ask must render while its history read is pending
 * or has failed. The metered banner draws as soon as `GET /api/ai/pricing`
 * answers; it used to read `totals.cost_usd` with `totals` still null and the
 * whole page threw. Pending shows the rate and no spend figure; failed says
 * the spend is Unreadable, never $0.00, beside the strip's Unreadable tiles.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_ask_null_totals_6264.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import AskZone from '../src/pages/research/AskZone.jsx';
import { api } from '../src/lib/api.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const PRICING = { routes: { research_ask: { model: 'm-1' } }, prices: { 'm-1': { in: 0.59, out: 0.79 } } };

async function mountAsk(role, askSessions) {
  const original = { research: api.research, aiPricing: api.aiPricing };
  api.aiPricing = async () => PRICING;
  api.research = {
    ...original.research,
    documents: async () => ({ indexed: 1, items: [{ uid: 'd-1', title: 'BSI C5', index_state: 'indexed', in_ask: true }] }),
    askSessions,
  };
  let m;
  try {
    m = await mountContracts(h(RailPageProvider, { role }, h(AskZone)), '/research/ask');
    for (let i = 0; i < 4; i += 1) await m.flush();
  } catch (e) {
    api.research = original.research; api.aiPricing = original.aiPricing;
    throw e;
  }
  return { ...m, text: m.text(), async close() { await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; } };
}

const ROLES = ['founder', 'investor', 'advisor', 'partner'];

for (const role of ROLES) {
  test(`${role}: with the history read pending, the banner shows the rate and no spend figure`, async () => {
    // Mutation checked: restore `formatCost(totals.cost_usd)` → the mount throws.
    const m = await mountAsk(role, () => new Promise(() => {}));
    try {
      assert.match(m.text, /Metered/);
      assert.match(m.text, /\/ M in/, 'the rate is drawn');
      assert.doesNotMatch(m.text, /this session:/, 'no spend figure before the history answers');
    } finally { await m.close(); }
  });

  test(`${role}: with the history read failed, the spend is Unreadable, never $0.00, and the strip still renders`, async () => {
    // Mutation checked: render `formatCost(0)` for a failed read → `$0.00` appears.
    const m = await mountAsk(role, async () => { throw new Error('Your session could not be read.'); });
    try {
      assert.match(m.text, /this session: Unreadable/);
      assert.doesNotMatch(m.text, /this session: \$/);
      assert.match(m.text, /that is not a count of zero/, 'the strip reads Unreadable, not a skeleton');
      assert.match(m.text, /Your session could not be read\./);
    } finally { await m.close(); }
  });
}
