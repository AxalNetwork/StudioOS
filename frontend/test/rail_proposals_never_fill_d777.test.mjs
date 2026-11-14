/**
 * D777 part 3 (#2102) — the SPA's half: a rail placement is decided one at a
 * time, and an edit that names a field Eadwyn never fills is refused in the
 * client, before anything is sent, with the registry's sentence. The Worker
 * refuses it too (`cloudflare-worker/test/rail_fill_provenance_d777_part3.test.ts`),
 * and also refuses keeping a stored proposal whose field the client cannot see.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_proposals_never_fill_d777.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { railProposalsApi } from '../src/lib/api.js';
import { neverFillMessage } from '../src/lib/neverFill.js';

/** Count what reaches the network; answer every call as the Worker would a kept proposal. */
function stubFetch() {
  const sent = [];
  const prev = globalThis.fetch;
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify({ proposal: { uid: 'u1', status: 'edited' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { sent, restore: () => { globalThis.fetch = prev; } };
}

test('D777 an edit naming a never-fill field is refused before it is sent', async () => {
  // Mutations checked: the client check removed (the edit is sent); the check
  // reading `decision` instead of `payload.field`.
  const net = stubFetch();
  try {
    for (const field of ['profiles.ssn', 'fund_capital_calls.amount', 'documents.signature']) {
      await assert.rejects(railProposalsApi.decide('u1', 'edit', { field, value: 'x' }), (e) => {
        assert.equal(e.code, 'never_fill');
        assert.equal(e.status, 422);
        assert.equal(e.message, neverFillMessage(field));
        assert.equal(e.data.field, field);
        return true;
      });
    }
    assert.equal(net.sent.length, 0, 'a never-fill edit reached the Worker');
  } finally { net.restore(); }
});

test('D777 any other press is sent as it was: an allowed edit, an accept, a discard', async () => {
  // Mutations checked: the check refusing a discard; the check refusing every edit.
  const net = stubFetch();
  try {
    await railProposalsApi.decide('u1', 'edit', { field: 'hypotheses.claim', value: 'x' });
    await railProposalsApi.decide('u1', 'accept');
    await railProposalsApi.decide('u1', 'discard', { field: 'profiles.ssn' });
    assert.equal(net.sent.length, 3);
    assert.ok(net.sent.every((s) => s.url.includes('/ai/rail/proposals/u1/decide')));
    assert.deepEqual(JSON.parse(net.sent[2].body), { decision: 'discard', payload: { field: 'profiles.ssn' } });
  } finally { net.restore(); }
});

test('D777 the client reads the same registry the Worker mirrors, and decides one uid at a time', () => {
  const src = codeOnly(readFileSync('frontend/src/lib/api/railProposals.js', 'utf8'));
  assert.match(src, /import \{ neverFillMessage, neverFillReason \} from '\.\.\/neverFill\.js';/);
  assert.match(src, /decide: \(uid, decision, payload\) =>/);
  assert.doesNotMatch(src, /decideAll|decideMany|uids/, 'a bulk decision');
});
