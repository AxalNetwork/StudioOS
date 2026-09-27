/**
 * D364 — stores that already existed, wired into Capital, Cap Table and Deck.
 *
 * The pure rules (lib/capitalRoundTerms.js, lib/capTableShare.js,
 * lib/deckShareViews.js) run for real. Where a rule copies the Worker (the
 * audience scope lines, the link bounds, the deck caps) the Worker's source is
 * read and compared, so the two cannot drift apart silently. Render paths load
 * in effects, so they are pinned as source text, bounded to their blocks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { instrumentTiles, proRataTile, proRataRuleCopy } from '../src/lib/capitalRoundTerms.js';
import {
  CAP_TABLE_AUDIENCES, CONSENT_COPY, SHARE_DAYS_DEFAULT, SHARE_DAYS_MAX, SHARE_VIEWS_DEFAULT,
  SHARE_VIEWS_MAX, capShareState, needsHolderConsent, shareRequest,
} from '../src/lib/capTableShare.js';
import {
  DECK_SHARE_MAX_HOURS, ENGAGEMENT_VIEW_ROWS, shareLinkState, summarizeDeckShares, viewLimitCopy,
} from '../src/lib/deckShareViews.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CAPITAL = read('frontend/src/pages/SpinoutLabCapitalPage.jsx');
const CAPTABLE = read('frontend/src/pages/SpinoutLabCapTablePage.jsx');
const SHARE_MODAL = read('frontend/src/components/spinout/CapTableShareModal.jsx');
const EQUITY = read('frontend/src/components/spinout/EquityPlanCard.jsx');
const DECK = read('frontend/src/pages/SpinoutLabPitchDeckPage.jsx');
const DECK_MODALS = read('frontend/src/components/PitchDeckModals.jsx');
const W_SHARE = read('cloudflare-worker/src/services/captableShare.ts');
const W_CAPTABLE = read('cloudflare-worker/src/routes/captable.ts');
const W_DECKS = read('cloudflare-worker/src/routes/decks.ts');

function between(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `end anchor not found after ${start}: ${end}`);
  return src.slice(a, b);
}

// ---- Capital ---------------------------------------------------------------

test('instrument tiles come from the outstanding SAFEs, and say so', () => {
  const tiles = instrumentTiles({
    status: 'ready',
    scenario: { inputs: { safes: [
      { name: 'Angel', amount: 100000, cap: 5000000, discount: 0.2 },
      { name: 'Seed note', amount: 250000, cap: 8000000, instrument: 'note' },
      { name: 'No amount', amount: 0, cap: 1 }, // not an instrument the engine accepts
    ] } },
  });
  const [inst, cap, disc] = tiles;
  assert.equal(inst.value, 'SAFE + Note · 2 outstanding');
  assert.equal(cap.value, '$5M–$8M · all 2');
  assert.equal(disc.value, '20% · 1 of 2');
  for (const t of tiles) { assert.equal(t.prov, 'synced'); assert.equal(t.tool, 'Cap Table'); }
  // No SAFEs is "Not set"; a failed scenario read is "Couldn't read", never "Not set".
  assert.deepEqual(instrumentTiles({ status: 'ready', scenario: null }).map((t) => t.prov), ['unset', 'unset', 'unset']);
  assert.deepEqual(instrumentTiles({ status: 'failed' }).map((t) => t.prov), ['unreadable', 'unreadable', 'unreadable']);
  // The page feeds the tiles from the scenario read it already makes, with its status.
  assert.match(CAPITAL, /setCapRead\(capRes\.status === 'fulfilled' \? \{ status: 'ready', scenario: capRes\.value\?\.scenario \|\| null \} : \{ status: 'failed' \}\);/);
  assert.match(CAPITAL, /\.\.\.instrumentTiles\(capRead\),\n\s*proRataTile\(proRata\),/);
  assert.match(CAPITAL, /unreadable: \(\) => \(\{ cls: [^}]*text: "Couldn't read" \}\)/);
  const note = between(CAPITAL, 'data-testid="overview-terms-note"', '</p>');
  assert.match(note, /not the terms of this round/);
});

test('pro-rata: a tile from the round\'s list, and a card that never claims "no rights" on a failed read', () => {
  assert.equal(proRataTile({ status: 'failed' }).prov, 'unreadable');
  assert.equal(proRataTile({ status: 'ready', data: { round: null, holders: [] } }).prov, 'unset');
  const t = proRataTile({ status: 'ready', data: { round: { id: 1 }, holders: [{ state: 'taking' }, { state: 'offered' }, { state: 'waived' }] } });
  assert.equal(t.value, '3 holders · 1 taking · 1 waived');
  assert.match(proRataRuleCopy({ rule: 'scaled' }), /scaled back in proportion/);
  assert.equal(proRataRuleCopy(null), null);

  const load = between(CAPITAL, 'const loadProRata = async (projectId) => {', 'const buildDataroom');
  assert.match(load, /if \(e\?\.status === 404\) \{ setProRata\(\{ status: 'unavailable' \}\); return; \}/);
  assert.match(load, /setProRata\(\{ status: 'failed' \}\);/);
  const card = between(CAPITAL, 'data-testid="card-pro-rata"', 'Offers and decisions are recorded');
  assert.match(card, /proRata\.status === 'failed' \? \(\n\s*<div data-testid="pro-rata-unreadable">\n\s*<Unreadable/);
  // The Worker computes entitlements against `target_amount || 0`: with no
  // target every entitlement is 0, which the card must not print as a figure.
  assert.match(card, /!\(Number\(proRata\.data\.round\.target_amount\) > 0\) \|\| h\.entitlement == null \? '—'/);
  assert.match(card, /data-testid="pro-rata-no-target"/);
});

// ---- Cap Table: share links -------------------------------------------------

test('the audience lines are the Worker\'s AUDIENCE_SCOPE, word for word', () => {
  const scope = between(W_SHARE, 'export const AUDIENCE_SCOPE', '\n};');
  assert.deepEqual(CAP_TABLE_AUDIENCES.map((a) => a.k), ['summary', 'investor', 'full']);
  for (let i = 0; i < CAP_TABLE_AUDIENCES.length; i += 1) {
    const a = CAP_TABLE_AUDIENCES[i];
    const next = CAP_TABLE_AUDIENCES[i + 1];
    const block = next ? between(scope, `  ${a.k}: {`, `  ${next.k}: {`) : scope.slice(scope.indexOf(`  ${a.k}: {`));
    assert.ok(block.includes(`label: '${a.label}'`), `${a.k} label`);
    // Each scope line sits alone on its line, or alone inside `sees: [...]` / `hidden: [...]`.
    const quoted = [...block.matchAll(/(?:^\s*|(?:sees|hidden): \[)'([^'\n]+)'/gm)].map((m) => m[1]);
    assert.deepEqual(quoted, [...a.sees, ...a.hidden], `${a.k} lines`);
  }
});

test('the link bounds are the Worker\'s', () => {
  assert.match(W_CAPTABLE, /const SHARE_TTL_HOURS_DEFAULT = 168;/);
  assert.equal(SHARE_DAYS_DEFAULT * 24, 168);
  assert.match(W_CAPTABLE, /const SHARE_TTL_HOURS_MAX = 24 \* 90;/);
  assert.equal(SHARE_DAYS_MAX, 90);
  assert.match(W_CAPTABLE, /const SHARE_VIEW_LIMIT_MAX = 500;/);
  assert.equal(SHARE_VIEWS_MAX, 500);
  assert.match(W_CAPTABLE, /Math\.max\(1, Number\(body\.view_limit\) \|\| 25\)/);
  assert.equal(SHARE_VIEWS_DEFAULT, 25);
});

test('an investor or full link needs the named holders\' consent; a summary link names nobody', () => {
  assert.equal(needsHolderConsent('summary'), false);
  assert.equal(needsHolderConsent('investor'), true);
  assert.equal(needsHolderConsent('full'), true);
  const base = { days: '7', views: '25', label: ' Seed memo ' };
  assert.deepEqual(shareRequest({ ...base, audience: 'summary' }), { ok: true, body: { audience: 'summary', expires_in_hours: 168, view_limit: 25, label: 'Seed memo' } });
  assert.equal(shareRequest({ ...base, audience: 'investor' }).ok, false);
  assert.equal(shareRequest({ ...base, audience: 'full', consent: 'yes' }).ok, false, 'only a real true is consent');
  assert.equal(shareRequest({ ...base, audience: 'full', consent: true }).ok, true);
  assert.equal(shareRequest({ ...base, audience: 'summary', days: '91' }).ok, false);
  assert.equal(shareRequest({ ...base, audience: 'summary', views: '1.5' }).ok, false);
  assert.equal(shareRequest({ ...base, audience: 'everyone' }).ok, false);
  assert.match(CONSENT_COPY, /agreed to their positions being shared/);

  const create = between(SHARE_MODAL, 'const create = async () => {', 'const revoke');
  assert.ok(create.indexOf('shareRequest(form)') < create.indexOf('api.capTableShareCreate'), 'validated before anything is minted');
  assert.match(create, /if \(!req\.ok\) \{ setError\(req\.message\); return; \}/);
  assert.match(create, /api\.capTableShareCreate\(scenarioUid, req\.body\)/);
  assert.match(SHARE_MODAL, /disabled=\{busy \|\| \(consentNeeded && !form\.consent\)\}/);
  assert.match(SHARE_MODAL, /the link is shown once and cannot be shown again/);
});

test('listed links: the Worker\'s counts, Unreadable on failure, revoke only while live', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  assert.equal(capShareState({ revoked_at: '2026-09-01', view_count: 0, view_limit: 5 }, now), 'withdrawn');
  assert.equal(capShareState({ view_count: 5, view_limit: 5, expires_at: '2026-10-01T00:00:00Z' }, now), 'used_up');
  assert.equal(capShareState({ view_count: 1, view_limit: 5, expires_at: '2026-09-20T00:00:00.000Z' }, now), 'expired');
  assert.equal(capShareState({ view_count: 1, view_limit: 5, expires_at: '2026-10-01T00:00:00.000Z' }, now), 'live');
  const list = between(SHARE_MODAL, "{links.status === 'loading' ? (", 'data-testid="share-links-empty"');
  assert.match(list, /links\.status === 'failed' \? \(\n\s*<div data-testid="share-links-unreadable">\n\s*<Unreadable/);
  assert.match(SHARE_MODAL, /\{st === 'live' && \(\n\s*<button type="button" onClick=\{\(\) => revoke\(l\.id\)\}/);
});

test('the Cap Table page offers Share only where the Worker allows it', () => {
  // The Worker requires scenario WRITE access to mint (ensureScenarioWriteOr404).
  assert.match(W_CAPTABLE, /captable\.post\('\/scenarios\/:uid\/share'[\s\S]{0,400}ensureScenarioWriteOr404/);
  assert.match(CAPTABLE, /\{scenario && canEdit && \(\n\s*<button\n\s*type="button"\n\s*onClick=\{\(\) => setShareOpen\(true\)\}/);
  assert.match(CAPTABLE, /<CapTableShareModal scenarioUid=\{scenario\.uid\}/);
});

// ---- Cap Table: equity plan ------------------------------------------------

test('equity plan: shown as Carta reported it, per account, Unreadable on failure', async () => {
  const { vestedFraction } = await import('../src/components/spinout/EquityPlanCard.jsx');
  assert.equal(vestedFraction({ total_shares: 400, vested_shares: 100 }), 0.25);
  assert.equal(vestedFraction({ total_shares: 0, vested_shares: 0 }), null);
  assert.equal(vestedFraction({ total_shares: 400, vested_shares: null }), null);
  assert.match(EQUITY, /From your account's Carta sync, not from this startup's scenario/);
  assert.match(EQUITY, /<Unrecorded reason="Only a Carta sync records option pools and vesting grants\.">/);
  const apply = between(CAPTABLE, 'function applyEquityPlan(res) {', 'const reloadEquityPlan');
  assert.match(apply, /if \(res\.reason\?\.status === 404\) \{ setEquityPlan\(\{ plan: null, failed: false \}\); return; \}/);
  assert.match(apply, /setEquityPlan\(\{ plan: null, failed: true \}\);\n\s*\}\s*$/);
  assert.match(CAPTABLE, /<EquityPlanCard plan=\{equityPlan\.plan\} failed=\{equityPlan\.failed\} onRetry=\{reloadEquityPlan\} \/>/);
});

// ---- Deck -------------------------------------------------------------------

test('deck links: the view limit and the 30-day cap are the Worker\'s, and the sheet says both', () => {
  assert.match(W_DECKS, /const viewLimit = Math\.min\(100, Math\.max\(1, Number\(body\?\.view_limit\) \|\| 1\)\);/);
  assert.match(W_DECKS, /Math\.min\(\n\s*24 \* 30,/);
  assert.equal(DECK_SHARE_MAX_HOURS, 24 * 30);
  assert.match(viewLimitCopy(1), /^Opens once: the first view uses it up/);
  assert.equal(viewLimitCopy(10), 'Opens up to 10 times, then stops working.');
  assert.equal(viewLimitCopy(null), null);
  assert.match(DECK_MODALS, /\{viewLimitCopy\(viewLimit\) \|\| 'The server did not say how many times this link opens\.'\}/);
  assert.match(DECK_MODALS, /No link lasts longer than 30 days\./);
  // The page passes the Worker's answer, not an assumption.
  assert.match(DECK, /setShareViewLimit\(Number\.isInteger\(r\?\.view_limit\) \? r\.view_limit : null\);/);
  assert.match(DECK, /viewLimit=\{shareViewLimit\}/);
});

test('deck views: the Worker\'s counts, read without creating a deck, Unreadable on failure', () => {
  const engagement = between(W_DECKS, "decks.get('/:id/engagement'", 'const tokRows');
  assert.match(engagement, new RegExp(`LIMIT ${ENGAGEMENT_VIEW_ROWS}\``));
  const now = Date.parse('2026-09-27T12:00:00Z');
  const s = summarizeDeckShares({
    total_views: 200,
    last_viewed_at: '2026-09-26 10:00:00',
    shares: [
      { id: 1, view_count: 1, view_limit: 1, exhausted: true, expires_at: '2026-09-30 00:00:00' },
      { id: 2, view_count: 0, view_limit: 1, exhausted: false, expires_at: '2026-09-26 00:00:00' },
      { id: 3, view_count: 0, view_limit: 1, exhausted: false, expires_at: '2026-09-28 00:00:00', revoked_at: '2026-09-27 01:00:00' },
      { id: 4, view_count: 0, view_limit: 1, exhausted: false, expires_at: '2026-09-28 00:00:00' },
    ],
  }, now);
  assert.deepEqual(s.links.map((l) => l.state), ['used_up', 'expired', 'withdrawn', 'live']);
  assert.equal(s.live, 1);
  assert.equal(s.viewsAtLeast, true, 'a total at the Worker\'s row cap is "at least"');
  assert.equal(summarizeDeckShares({ total_views: 3 }), null, 'no share list is not zero links');
  assert.equal(shareLinkState({ expires_at: 'garbage' }, now), 'live');

  const load = between(DECK, 'const loadViews = async () => {', 'useEffect(() => { loadViews();');
  assert.doesNotMatch(load, /ensureDeck|deckApplyMethod|deckGenerate/, 'reading views never creates a deck');
  assert.match(load, /api\.deckEngagement\(current\.id\)/);
  assert.match(load, /setViews\(\{ status: 'failed', summary: null \}\);/);
  const card = between(DECK, 'data-testid="card-deck-views"', 'Counts are the server\'s');
  assert.match(card, /views\.status === 'failed' \? \(\n\s*<div data-testid="deck-views-unreadable">\n\s*<Unreadable/);
  assert.match(card, /views\.summary\.viewsAtLeast \? '\+' : ''/);
});
