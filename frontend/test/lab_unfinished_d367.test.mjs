/**
 * D367 — the four unfinished Lab-tools pieces D360–D365 filed, on the screen.
 *
 *   1. Formation packet: after payment nothing builds a packet (the build
 *      itself is the owner's open decision on #998), so no screen spins
 *      "Processing packet", promises an email, or marks documents prepared.
 *   2. Deck share sheet: changing the expiry withdraws the link it replaces,
 *      and Copy says "Copied" only when the clipboard took it.
 *   3. normalizeInputs: a missing figure stays null ("Not recorded") instead
 *      of 0 or a 10% pool, and Preview/Save refuse until it is entered.
 *   4. Metrics: the Build desk sends the date the founder sees, because the
 *      Worker no longer stamps a missing one with today.
 *
 * Pure rules run for real (replaceDeckShare, normalizeInputs,
 * notRecordedInputs). Render paths are pinned as source text, bounded to
 * their blocks. The Worker halves are driven in
 * cloudflare-worker/test/lab_unfinished_d367.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PREVIOUS_LINK_LIVE, PREVIOUS_LINK_WITHDRAWN, replaceDeckShare } from '../src/lib/deckShareViews.js';
import { PACKET_NOT_BUILT, PACKET_NOT_BUILT_STATUSES } from '../src/lib/incorporationPricing.js';
import { normalizeInputs, notRecordedInputs } from '../src/pages/SpinoutLabCapTablePage.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

function between(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `end anchor not found after ${start}: ${end}`);
  return src.slice(a, b);
}

// ---- 1. formation packet ---------------------------------------------------

test('formation packet: a paid order is "packet not built", never a spinner that claims work', () => {
  assert.deepEqual(PACKET_NOT_BUILT_STATUSES, ['paid', 'packet_processing']);
  assert.match(PACKET_NOT_BUILT, /has not been built yet, and nothing has been filed with the state/);
  const badge = read('frontend/src/components/IncorporationStatusBadge.jsx');
  for (const status of ['paid', 'packet_processing']) {
    const cfg = between(badge, `  ${status}: {`, '},');
    assert.match(cfg, /label: 'Paid · packet not built'/, status);
    assert.match(cfg, /spin: false/, status);
    assert.doesNotMatch(cfg, /Loader2/, status);
  }
  assert.doesNotMatch(badge, /'Processing packet'|'Preparing documents'/);
});

test('formation packet: no screen promises a packet, an email or a filing that nothing does', () => {
  const success = read('frontend/src/pages/IncorporateSuccessPage.jsx');
  assert.doesNotMatch(success, /preparing your signing packet|will email you a link once/);
  assert.match(success, /: PACKET_NOT_BUILT\}/);
  const inc = read('frontend/src/pages/IncorporatePage.jsx');
  assert.doesNotMatch(inc, /filing started|preparing your founder document set now/);
  assert.match(inc, /formation ordered/);
  assert.match(inc, /\$\{PACKET_NOT_BUILT\} Your receipt is in Billing\./);
});

test('formation packet: the Lab tracker marks no step done for packet_processing', () => {
  const lab = read('frontend/src/pages/SpinoutLabIncorporatePage.jsx');
  const line = between(lab, 'const filingDone =', ';\n');
  assert.doesNotMatch(line, /packet_processing/, 'packet_processing builds nothing, so it completes no step');
  assert.doesNotMatch(line, /\? 2\b/, 'a ready packet is not a state submission');
  assert.match(line, /orderStatus === 'packet_ready' \|\| docsAllDone \? 1 : 0/);
  const card = between(lab, 'data-testid="filing-card"', '{filingSteps.map(');
  assert.match(card, /\{packetNotBuilt && \(\s*<p[^>]*data-testid="filing-packet-not-built">\{PACKET_NOT_BUILT\}<\/p>/);
  assert.match(lab, /const packetNotBuilt = paid && PACKET_NOT_BUILT_STATUSES\.includes\(orderStatus\);/);
  assert.match(lab, /'Paid · not filed'/);
  assert.doesNotMatch(lab, /\? 'Filed' : 'Filing'\)/);
});

// ---- 2. deck share sheet ---------------------------------------------------

function fakeApi({ mintFails = false, revokeFails = false } = {}) {
  const calls = [];
  return {
    calls,
    mint: async () => { calls.push('mint'); if (mintFails) throw new Error('mint failed'); return { id: 42, token: 't2' }; },
    revoke: async (deckId, id) => { calls.push(`revoke:${deckId}:${id}`); if (revokeFails) throw new Error('nope'); },
  };
}

test('deck share: replacing a link mints the new one first, then withdraws the one shown', async () => {
  const f = fakeApi();
  const out = await replaceDeckShare({ mint: f.mint, revoke: f.revoke, previous: { deckId: 5, id: 41 } });
  assert.deepEqual(f.calls, ['mint', 'revoke:5:41']);
  assert.equal(out.next.id, 42);
  assert.equal(out.withdrawn, true);
  assert.equal(out.notice, PREVIOUS_LINK_WITHDRAWN);
});

test('deck share: a failed withdrawal, or no id to withdraw, is said — never assumed', async () => {
  const blocked = fakeApi({ revokeFails: true });
  const a = await replaceDeckShare({ mint: blocked.mint, revoke: blocked.revoke, previous: { deckId: 5, id: 41 } });
  assert.equal(a.withdrawn, false);
  assert.equal(a.notice, PREVIOUS_LINK_LIVE);
  const noId = fakeApi();
  const b = await replaceDeckShare({ mint: noId.mint, revoke: noId.revoke, previous: { deckId: 5, id: null } });
  assert.deepEqual(noId.calls, ['mint'], 'nothing to withdraw by');
  assert.equal(b.notice, PREVIOUS_LINK_LIVE);
  assert.match(PREVIOUS_LINK_LIVE, /still works/);
});

test('deck share: a failed mint withdraws nothing; a first link withdraws nothing', async () => {
  const f = fakeApi({ mintFails: true });
  await assert.rejects(replaceDeckShare({ mint: f.mint, revoke: f.revoke, previous: { deckId: 5, id: 41 } }));
  assert.deepEqual(f.calls, ['mint'], 'the shown link is left alone when no replacement exists');
  const g = fakeApi();
  const out = await replaceDeckShare({ mint: g.mint, revoke: g.revoke, previous: null });
  assert.deepEqual(g.calls, ['mint']);
  assert.equal(out.notice, null);
});

test('deck share: only an expiry change replaces; opening the sheet withdraws nothing', () => {
  const page = read('frontend/src/pages/SpinoutLabPitchDeckPage.jsx');
  assert.match(page, /const changeExpiry = \(hours\) => \{ setExpiryHours\(hours\); onShare\(hours, \{ replace: true \}\); \};/);
  const share = between(page, 'const onShare = async', 'const changeExpiry');
  assert.match(share, /const previous = replace \? shownLink\.current : null;/);
  assert.match(share, /revoke: \(deckId, shareId\) => api\.deckRevokeShare\(deckId, shareId\)/);
  assert.match(share, /shownLink\.current = \{ deckId: deck\.id, id: Number\.isInteger\(r\?\.id\) \? r\.id : null \};/);
  assert.match(page, /notice=\{shareNotice\}/);
});

test('deck share: Copy says "Copied" only when the clipboard took it', () => {
  const modal = read('frontend/src/components/PitchDeckModals.jsx');
  const copy = between(modal, 'const copy = async () => {', '\n  };');
  const tryAt = copy.indexOf('await navigator.clipboard.writeText(url);');
  const catchAt = copy.indexOf('} catch {');
  const copiedAt = copy.indexOf('setCopied(true);');
  assert.ok(tryAt > 0 && catchAt > tryAt, 'the write is tried');
  assert.ok(copiedAt > catchAt, '"Copied" is set only after the write succeeded');
  assert.match(between(copy, '} catch {', '}\n'), /setCopyBlocked\(true\);\s*return;/);
  assert.match(modal, /data-testid="share-copy-blocked">\s*Copy was blocked — select the link and copy it by hand\./);
  assert.match(modal, /Each choice issues a new link and withdraws the one shown above\./);
  assert.match(modal, /\{notice && \(\s*<p[^>]*data-testid="share-replace-notice">\{notice\}<\/p>/);
});

// ---- 3. normalizeInputs ----------------------------------------------------

test('normalizeInputs keeps a missing figure null — never 0, never a 10% pool', () => {
  const n = normalizeInputs({
    founders: [{ name: 'Ada', shares: null }, { name: 'Bo' }, { name: 'Cy', shares: 4000000 }],
    safes: [{ name: 'Angel', cap: 5000000 }, { name: 'Seed', amount: '' }],
    rounds: [{ name: 'A', pre_money: null }],
  });
  assert.deepEqual(n.founders.map((f) => f.shares), [null, null, 4000000]);
  assert.equal(n.option_pool_pct, null);
  assert.deepEqual(n.safes.map((s) => s.amount), [null, null]);
  assert.equal(n.rounds[0].pre_money, null);
  assert.equal(n.rounds[0].investment, null);
  // A recorded zero pool is a recorded figure.
  assert.equal(normalizeInputs({ option_pool_pct: 0 }).option_pool_pct, 0);
  assert.equal(normalizeInputs(null).option_pool_pct, null);
});

test('notRecordedInputs names every missing figure; Preview and Save refuse on it', () => {
  const missing = notRecordedInputs(normalizeInputs({
    founders: [{ name: 'Ada' }], safes: [{ name: 'Angel' }], rounds: [{ name: 'A', investment: 10 }],
  }));
  assert.deepEqual(missing, ['the option pool %', "Ada's shares", 'the amount of SAFE Angel', "A's pre-money"]);
  assert.deepEqual(notRecordedInputs({ option_pool_pct: 10, founders: [{ name: 'Ada', shares: 1 }], safes: [], rounds: [] }), []);
  const page = read('frontend/src/pages/SpinoutLabCapTablePage.jsx');
  const preview = between(page, 'const runPreview = async () => {', 'setBusy(\'preview\')');
  assert.match(preview, /const missing = notRecordedInputs\(inputs\);\s*if \(missing\.length\) \{ setError\(notRecordedSentence\(missing\)\); return; \}/);
  const save = between(page, 'const save = async () => {', 'setBusy(\'save\')');
  assert.match(save, /const missing = notRecordedInputs\(snapshot\);\s*if \(missing\.length\) \{ setError\(notRecordedSentence\(missing\)\); return; \}/);
  assert.match(page, /value=\{inputs\.option_pool_pct \?\? ''\}\s*placeholder="Not recorded"/);
  assert.match(page, /option_pool_pct: known\(e\.target\.value\) \}\)/);
  assert.match(page, /known\(f\.shares\) === null \? 'Shares not recorded'/);
  assert.match(page, /known\(s\.amount\) === null \? 'Not recorded'/);
});

// ---- 4. metrics date -------------------------------------------------------

test('Build desk: the snapshot carries the date the founder sees', () => {
  const desk = read('frontend/src/pages/founder/FounderBuildDesk.jsx');
  const entry = between(desk, 'function KpiEntry(', '<p className="build-source">');
  assert.match(entry, /const \[asOf, setAsOf\] = useState\(\(\) => localToday\(\)\);/);
  assert.match(entry, /api\.createMetricsSnapshot\(projectId, \{ snapshot_date: clean\(asOf\), /);
  assert.match(entry, /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(clean\(asOf\)\)\) \{ setNote\('Choose the date these figures describe before saving\.'\); return; \}/);
  assert.match(entry, /<input type="date" data-testid="input-kpi-as-of" value=\{asOf\}/);
});
