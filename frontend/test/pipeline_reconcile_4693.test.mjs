/**
 * D4693 (#4693) — the Pipeline board and zones print the Worker's figures and
 * its words, not a second count of their own. The Worker's half is
 * cloudflare-worker/test/partner_pipeline_reconcile_4693.test.ts. Each case
 * names the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_reconcile_4693.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import partnerPipelineBoard from '../src/workspaces/boards/partnerPipeline.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const board = partnerPipelineBoard('partner', {});
const section = (slug) => board.sections.find((s) => s.slug === slug);

test('the board\'s Monthly column is the monthly figure of an ACTIVE retainer, and its count is the active count', () => {
  // Mutations checked: the raw amount printed again; ended retainers listed; the count back to retainer_count.
  const data = {
    mrr_cents: 200000, retainer_count: 4, active_count: 3, ended_count: 1,
    items: [
      { founder_name: 'Acme', retainer: { active: true, amount_cents: 100000, monthly_cents: 100000, cadence: 'monthly', renews_at: '2099-01-01' }, utilisation_pct: 80 },
      { founder_name: 'Quarterly Co', retainer: { active: true, amount_cents: 300000, monthly_cents: 100000, cadence: 'quarterly', renews_at: '2099-01-01' }, utilisation_pct: null },
      { founder_name: 'Gone Ltd', retainer: { active: false, amount_cents: 500000, monthly_cents: 500000, cadence: 'monthly', ended_at: '2020-01-01' }, utilisation_pct: null },
      { founder_name: 'No retainer', retainer: null },
    ],
  };
  const rows = section('retainers').rows(data);
  assert.deepEqual(rows.map((r) => r[0]), ['Acme', 'Quarterly Co'], 'the ended retainer and the engagement without one are not listed');
  assert.deepEqual(rows.map((r) => r[1]), ['$1,000', '$1,000'], 'a quarterly amount shows its monthly share, never the raw $3,000');
  assert.match(section('retainers').summary(data), /3 active retainers/);
  assert.doesNotMatch(section('retainers').summary(data), /4 /);
});

test('the board counts an open negotiation the way the Worker does and prints the Worker\'s label', () => {
  // Mutations checked: every tracked row counted as open; the label back to a field the row does not have.
  const data = {
    open_count: 1,
    items: [
      { need_title: 'Payments', price: 42000, negotiation: { open: true, label: 'Terms', stage: 'terms' } },
      { need_title: 'Brand', price: 15000, negotiation: { open: false, label: 'Closed', stage: 'closed' } },
      { need_title: 'Won thread', price: 9000, negotiation: { open: false, label: 'Won', stage: 'legal' } },
      { need_title: 'Untracked', price: 5000, negotiation: null },
    ],
  };
  const s = section('negotiations');
  assert.match(s.summary(data), /^1 open/);
  assert.deepEqual(s.rows(data), [['Payments', '$42,000', 'Terms']]);
  // Without the Worker's count the board counts the same rule itself, never "tracked".
  assert.match(s.summary({ items: data.items }), /^1 open/);
});

test('"Send counter" is gone: the draft is saved, and the page says nothing is sent', () => {
  // Mutations checked: the old label restored; the foot sentence dropped.
  const zone = read('../src/pages/partner/pipeline/NegotiationsZone.jsx');
  assert.doesNotMatch(zone, /Send counter/);
  // D5938: PP05b names the accept "Accept counter draft"; it still sends nothing.
  assert.match(zone, /accept="Accept counter draft"/);
  assert.match(zone, /nothing is sent to the client/);
  const draft = read('../src/workspaces/ZoneDraft.jsx');
  assert.match(draft, /nothing is sent/, 'the component\'s own contract is that accepting sends nothing');
  const worker = read('../../cloudflare-worker/src/routes/partner_pipeline.ts');
  assert.doesNotMatch(worker, /Send counter/);
});

test('the zones follow the Worker\'s rules for open and active, and the studio board hides the formula key', () => {
  // Mutations checked: the zones back on stage/ended_at; the underscore filter removed from either chip list.
  const neg = read('../src/pages/partner/pipeline/NegotiationsZone.jsx');
  assert.match(neg, /r\.negotiation\.open \?\? r\.negotiation\.stage !== 'closed'/);
  assert.equal([...neg.matchAll(/negotiation\.open \?\?/g)].length, 3, 'the open list, the stalled count and the ball-with-us count');
  const ret = read('../src/pages/partner/pipeline/RetainersZone.jsx');
  assert.match(ret, /r\.retainer\.active \?\? !r\.retainer\.ended_at/);
  assert.match(ret, /r\.retainer\?\.active === false \? null : r\.retainer\?\.monthly_amount_cents/);
  const page = read('../src/pages/PipelinePage.jsx');
  assert.equal([...page.matchAll(/filter\(\(\[k\]\) => !k\.startsWith\('_'\)\)/g)].length, 2, 'both metric chip lists skip the formula key');
});
