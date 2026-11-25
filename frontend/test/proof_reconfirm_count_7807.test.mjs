// D7807 (#7807) — the Proof zone's Needs reconfirmation tile reads the
// Worker's whole-list count on any page size, never a count of the page it
// holds, and a count that did not come back reads Unavailable, never 0.
//
// The zone is the real file; the API is a stub and every fixture is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { api } from '../src/lib/api.js';
import ProofZone from '../src/pages/advisor/expertise/ProofZone.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api };
const never = () => new Promise(() => {});
function stub(answers) {
  for (const k of Object.keys(originals)) if (typeof originals[k] === 'function') api[k] = (...a) => (answers[k] || never)(...a);
}
const restore = () => Object.assign(api, originals);
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));

const claim = (id, consents = []) => ({
  id, uid: `p${id}`, kind: 'engagement', title: `Claim ${id}`, organization: null, period_note: null, detail: null,
  attested: false, status: 'self_stated', consents,
});
const stale = { id: 9, uid: 'c9', attester_name: 'Old', state: 'needs_reconfirmation', consent_given: false, withdrawn_at: null, invite_token: null };
// One page of a longer list: one stale claim on the page, 37 over the whole list.
const PAGED = {
  items: [claim(1, [stale]), claim(2)],
  page: { offset: 0, limit: 2, total: 260, next_offset: 2 },
  counts: { total: 260, attested: 0, self_stated: 260, awaiting: 0, needs_reconfirmation: 37 },
};

async function tile(res) {
  stub({ listMyAdvisorProof: async () => res });
  const view = await mountContracts(React.createElement(ProofZone), '/expertise/proof');
  try {
    await view.flush();
    const node = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'advisor-proof-reconfirm-count');
    assert.ok(node, 'the Needs reconfirmation tile is drawn');
    return walk(node).trim();
  } finally { await view.unmount(); restore(); }
}

test('a page of a longer list shows the whole list’s reconfirmation count, not the page’s', async () => {
  // Mutation checked: the tile reads `state.items.filter(... needs_reconfirmation).length` again → "1", not "37".
  assert.equal(await tile(PAGED), '37');
});

test('the whole list on one page still shows the Worker’s count', async () => {
  // Mutation checked: the tile counts the page whenever the page holds the whole list → "1", not "0".
  assert.equal(await tile({ ...PAGED, page: { offset: 0, limit: 200, total: 2, next_offset: null }, counts: { ...PAGED.counts, total: 2, self_stated: 2, needs_reconfirmation: 0 } }), '0');
});

test('a count that did not come back is Unavailable, never 0 and never the page’s count', async () => {
  // Mutation checked: `Number.isInteger(...) ? ... : null` replaced by `?? 0` → "0" instead of Unavailable.
  // Mutation checked: `unread` dropped from the tile, so a null value draws `<Unrecorded />` → "Not recorded" instead of Unavailable.
  const shown = await tile({ ...PAGED, counts: { ...PAGED.counts, needs_reconfirmation: null } });
  assert.match(shown, /Unavailable/);
  assert.doesNotMatch(shown, /\d/);
});
