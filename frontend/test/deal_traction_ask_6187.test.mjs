/** D6187 (#6187) — "Ask the founder for an update" is a diligence request pre-filled from the gaps. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { askDraft } from '../src/pages/deal/dealInsightsModel.js';

const view = (series) => ({ state: 'recorded', series: { mrr: [], burn: [], customers: [], ...series } });
const pt = (month, value) => ({ month, value });

test('askDraft names each figure with its unreported months, and is null when nothing is missing', () => {
  const d = askDraft(view({
    mrr: [pt('2026-08', 100), pt('2026-09', null), pt('2026-10', 120)],
    customers: [pt('2026-08', null), pt('2026-09', null), pt('2026-10', 4)],
    burn: [pt('2026-08', 10), pt('2026-09', 11), pt('2026-10', 12)],
  }));
  assert.equal(d.title, 'An update on MRR and Paying accounts');
  assert.match(d.details, /MRR: Sep 2026\./);
  assert.match(d.details, /Paying accounts: Aug 2026, Sep 2026\./);
  assert.doesNotMatch(d.details, /Net burn/, 'a fully reported figure is not asked for');
  assert.equal(askDraft(view({ mrr: [pt('2026-10', 1)], burn: [pt('2026-10', 1)], customers: [pt('2026-10', 1)] })), null);
  assert.equal(askDraft({ state: 'unreadable' }), null, 'an unreadable history asks nothing');
  assert.equal(askDraft(null), null);
});

test('the Traction tab sends through the existing diligence route, only for the case owner, with no new route', () => {
  const src = readFileSync(new URL('../src/pages/deal/DealInsightTabs.jsx', import.meta.url), 'utf8');
  assert.match(src, /dd\.createRequest\(found\.row\.uid/, 'the request goes on the deal\'s case');
  assert.match(src, /owner_user_id, found\.row\.lead_user_id/, 'only the case owner or lead is offered Send');
  assert.match(src, /open a diligence case/, 'with no case the investor is pointed at Diligence');
  const page = readFileSync(new URL('../src/pages/DealRoomPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /<DealTraction deal=\{deal\} userId=\{user\?\.id\} \/>/);
});
