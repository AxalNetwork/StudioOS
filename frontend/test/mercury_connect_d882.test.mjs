/**
 * D882 (#2555) — Grow's and Raise's "From Mercury" parts say "Connect
 * Mercury" when the founder's Mercury cannot fill them, never an empty
 * figure, and the link opens only a Connectors page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as grow from '../src/pages/cycles/growFromMercury.js';
import * as raise from '../src/pages/cycles/mercuryRaise.js';

const connection = (state, href = '/account/connectors/mercury') => ({ state, connect_href: href, connect_label: 'Connect Mercury', sentence: `${state} sentence` });

for (const [name, m, view] of [['Grow', grow, (p) => grow.mercuryView(p)], ['Raise', raise, (p) => raise.mercuryView('fundraising-readiness', p)]]) {
  test(`${name}: each state the founder's Mercury cannot fill reads as connect, with the link and no figure`, () => {
    // Mutations checked: a state left out of CONNECT_STATES; the reason dropped; a connect view drawn as empty.
    assert.deepEqual(m.CONNECT_STATES, ['not_connected', 'sign_in_required', 'reconnect']);
    for (const state of m.CONNECT_STATES) {
      const v = view({ state, reason: 'Words from the Worker', connection: connection(state) });
      assert.equal(v.state, 'connect', state);
      assert.equal(v.empty, false);
      assert.equal(v.reason, 'Words from the Worker');
      assert.deepEqual(v.connection.link, { href: '/account/connectors/mercury', label: 'Connect Mercury' });
      for (const k of ['facts', 'figures', 'months', 'cash', 'runway']) assert.equal(v[k], undefined, `${state}: no ${k}`);
    }
  });

  test(`${name}: the link opens only a Connectors page; a teammate gets the sentence alone; connected has none`, () => {
    // Mutations checked: any href accepted; the link kept when the Worker sent none; connected read as a connect state.
    assert.equal(m.connectionOf(connection('not_connected', 'https://elsewhere.example/connect')).link, null);
    assert.equal(m.connectionOf(connection('not_connected', '/admin/mercury')).link, null);
    assert.equal(m.connectionOf({ state: 'sign_in_required', connect_href: null, sentence: 'The founder has not signed in' }).link, null);
    assert.equal(m.connectionOf({ state: 'sign_in_required', connect_href: null, sentence: 'The founder has not signed in' }).sentence, 'The founder has not signed in');
    assert.equal(m.connectionOf({ state: 'connected', connect_href: null }), null);
    assert.equal(m.connectionOf(null), null);
    // Figures already landed stay, with the connection beside them.
    const ok = view({ state: 'ok', runway: { fact_id: 1, label: 'Runway: 6 months', source: 'From Mercury, as of 2026-10-01' }, connection: connection('sign_in_required') });
    assert.equal(ok.state, 'ok');
    assert.equal(ok.connection.state, 'sign_in_required');
  });
}

test('both parts draw ConnectMercury, and Raise offers no Sync without a usable sign-in', () => {
  // Mutations checked: the connect view not drawn; Raise's Sync left on a token connection.
  const g = readFileSync('frontend/src/pages/cycles/GrowFromMercury.jsx', 'utf8');
  const r = readFileSync('frontend/src/pages/cycles/MercuryRaiseFeed.jsx', 'utf8');
  for (const s of [g, r]) {
    assert.match(s, /view\.state === 'connect' && <ConnectMercury reason=\{view\.reason\} connection=\{view\.connection\} \/>/);
  }
  assert.match(r, /view\.state !== 'connect' && !view\.connection && <button[^>]*onClick=\{\(\) => run\('sync'/);
  const c = readFileSync('frontend/src/pages/cycles/ConnectMercury.jsx', 'utf8');
  assert.match(c, /connection\?\.link && \(\s*<Link to=\{connection\.link\.href\}/);
});
