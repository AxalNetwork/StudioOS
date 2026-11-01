/**
 * D394 — Partner Home P2: the tiles, the operating brief and the feed.
 *
 * Drives the page's own tile and feed helpers with real-shaped payloads and
 * renders them in each state. D564 mounted P2 as Partner Studio's body; D1419
 * (#3698) made its three parts the partner Studio's modules (`firm_tiles`,
 * `operating_brief`, `firm_feed`), drawn by `StudioModules` in the member's
 * layout, with no WorkerRail and no question heading.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_home_p2_d394.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { homeTiles, homeFeed, partnerTiles, UNLINKED_REASON } from '../src/pages/partner/PartnerHomeP2.jsx';
import StudioModules from '../src/pages/studio/StudioModules.jsx';
import { studioFromReads } from '../src/pages/studio/useStudioLayout.js';

const PARTNER = { profile: 'partner', groups: [{ key: 'partner', label: 'Operating partner' }], modules: [
  { key: 'firm_tiles', title: 'Firm tiles', group: 'partner', purpose: 'p', href: null, default_size: 'full', in_default: true, locked_by_plan: false, plan: null },
  { key: 'operating_brief', title: 'Operating brief', group: 'partner', purpose: 'p', href: null, default_size: 'full', in_default: true, locked_by_plan: false, plan: null },
  { key: 'firm_feed', title: 'Firm feed', group: 'partner', purpose: 'p', href: null, default_size: 'full', in_default: true, locked_by_plan: false, plan: null },
] };
const DEFAULT = { profile: 'partner', source: 'default', layout: PARTNER.modules.map((m) => ({ key: m.key, size: 'full' })), revision: null, updated_at: null, dropped: [] };
const STUDIO = studioFromReads({ profile: 'partner', viewer: { role: 'partner' }, modules: PARTNER, layout: DEFAULT });

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const BOARD = {
  due_next_7_days: 3,
  needs_attention: 1,
  unrated_count: 2,
  items: [
    { engagement_id: 1, client: 'Verwood', scope: 'Payments', status: 'accepted', mode: 'embedded', grant: 'Board, KPIs', grant_holder: 'Rin', health: 'at_risk', health_reasons: ['2 milestones overdue'], milestones_due_7d: 2 },
    { engagement_id: 2, client: 'Thornfield', scope: 'Brand', status: 'in_progress', mode: 'project', health: null, health_reasons: [], milestones_due_7d: 1 },
    { engagement_id: 3, client: 'Oldco', status: 'delivered', mode: 'project', health: 'blocked', health_reasons: ['x'], milestones_due_7d: 0 },
    { engagement_id: 4, client: 'Revoked', status: 'accepted', mode: 'embedded', seat_revoked_at: '2026-01-01', grant: 'All', milestones_due_7d: 0 },
  ],
};
const RETAINERS = {
  mrr_cents: 1250000,
  items: [
    { engagement_id: 1, founder_name: 'Verwood', retainer: { renews_at: day(20) } },
    { engagement_id: 2, founder_name: 'Thornfield', retainer: { renews_at: day(90) } },
    { engagement_id: 5, founder_name: 'Nobody', retainer: null },
  ],
};
const CAP_NONE = { over_committed_count: null, cap_note: 'No capacity cap is recorded anywhere in this product.', people: [] };
const CAP_SET = {
  over_committed_count: 1,
  people: [{ user_id: 9, name: 'Rin', total_hours: 46, cap_hours: 40, cap_source: 'person', over_committed: true },
           { user_id: 10, name: 'Sam', total_hours: 10, cap_hours: 40, cap_source: 'firm', over_committed: false }],
};

const tile = (tiles, key) => tiles.find((t) => t.key === key);

test('D394: the five tiles read the three stores, and live means neither closed nor revoked', () => {
  const t = homeTiles({ board: BOARD, retainers: RETAINERS, capacity: CAP_SET });
  assert.deepEqual(t.map((x) => x.label), ['Active engagements', 'Due this week', 'At risk', 'Recurring', 'Over capacity']);
  assert.equal(tile(t, 'active').value, 2, 'delivered and revoked-seat engagements are not active');
  assert.equal(tile(t, 'active').note, '1 embedded, 1 project');
  assert.equal(tile(t, 'due').value, 3);
  assert.equal(tile(t, 'risk').value, 1);
  assert.match(tile(t, 'risk').note, /2 unrated, not counted as fine/);
  assert.equal(tile(t, 'recurring').value, '$12,500', 'cents, not dollars');
  assert.equal(tile(t, 'recurring').note, '1 renewing in 60 days');
  assert.equal(tile(t, 'capacity').value, 1);
});

test('D394: no stated cap is Not recorded with the worker\'s reason, never 0 over', () => {
  const t = homeTiles({ board: BOARD, retainers: { mrr_cents: null, mrr_note: 'No retainer states an amount.', items: [] }, capacity: CAP_NONE });
  assert.equal(tile(t, 'capacity').value, null);
  assert.match(tile(t, 'capacity').reason, /No capacity cap is recorded/);
  assert.equal(tile(t, 'recurring').value, null);
  assert.match(tile(t, 'recurring').reason, /No retainer states an amount/);
});

test('D394: a failed read is unreadable, not empty', () => {
  const t = homeTiles({ board: null, retainers: null, capacity: null });
  assert.ok(t.every((x) => x.unreadable && x.value === null));
});

test('D394: the feed names each line\'s receipt, and a seat reads as recorded by the firm', () => {
  const f = homeFeed({ board: BOARD, retainers: RETAINERS, capacity: CAP_SET });
  const keys = f.map((x) => x.key);
  assert.deepEqual(keys, ['risk-1', 'due-1', 'due-2', 'cap-9', 'renew-1', 'seat-1']);
  assert.ok(f.every((x) => x.receipt && x.to), 'every line has a receipt and a place to act');
  assert.equal(f[0].body, '2 milestones overdue');
  assert.equal(f.find((x) => x.key === 'cap-9').body, '46 h against a cap of 40 h');
  const seat = f.find((x) => x.key === 'seat-1');
  assert.equal(seat.grant, 'Scope recorded by the firm: Board, KPIs');
  assert.ok(!f.some((x) => /granted by/i.test(`${x.grant || ''}${x.title}`)), 'no chip speaks in the founder\'s voice');
  assert.ok(!keys.includes('risk-3') && !keys.includes('seat-4'), 'closed and revoked rows stay off the feed');
  assert.ok(homeFeed({ board: { items: Array.from({ length: 10 }, (_, i) => ({ engagement_id: i, health: 'blocked', status: 'accepted' })) } }).length <= 6);
});

const render = (state, studio = STUDIO) => renderedText(renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(StudioModules, { studio, tiles: partnerTiles(state, () => {}) })),
));

test('D394, D1419: the tiles, the operating brief and the feed are the partner Studio\'s three modules', () => {
  const t = render({ status: 'ready', reads: { board: BOARD, retainers: RETAINERS, capacity: CAP_SET } });
  for (const title of ['Firm tiles', 'Operating brief', 'Firm feed']) assert.match(t, new RegExp(title));
  assert.ok(t.indexOf('Firm tiles') < t.indexOf('Operating brief') && t.indexOf('Operating brief') < t.indexOf('Firm feed'), 'the default order');
  assert.match(t, /3 due this week · 1 at risk/);
  assert.match(t, /Proposal · operating brief/);
  assert.match(t, /Scope recorded by the firm: Board, KPIs/);
  assert.match(t, /Not on this page: messages from a client/);
  assert.doesNotMatch(t, /recommend/i);
  // Owner answers G and J (#3698): no question heading, no rail, and the rail is never where asking lives.
  assert.doesNotMatch(t, /Where does the firm stand today/);
  assert.doesNotMatch(t, /lives in the rail|ask box/);
});

test('D394: unlinked, preview and failed reads each say what they are', () => {
  const u = render({ status: 'unlinked' });
  assert.match(u, /Not recorded/);
  assert.ok(u.includes(UNLINKED_REASON));
  assert.match(UNLINKED_REASON, /No partner profile is attached to this sign-in/);
  const p = render({ status: 'preview' });
  assert.match(p, /Withheld in administrator preview/);
  assert.doesNotMatch(p, /could not be read/);
  const bad = render({ status: 'ready', reads: { board: null, retainers: null, capacity: null } });
  assert.match(bad, /Firm tiles could not be read · Try again/);
  assert.match(bad, /Firm feed could not be read · Try again/);
  assert.doesNotMatch(bad, /\b0 at risk\b/);
  // One source down draws its own tile unreadable, and the module stays drawn.
  const part = render({ status: 'ready', reads: { board: null, retainers: RETAINERS, capacity: CAP_SET } });
  assert.match(part, /Active engagements could not be read/);
});

test('D394: the brief is the home/brief surface, run on a click and never on mount', () => {
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/partner/PartnerHomeP2.jsx'), 'utf8'));
  assert.match(src, /<ZoneDraft\s+surface="home\/brief"/);
  assert.doesNotMatch(src, /zoneDraftRun/, 'the page itself never runs a draft');
  const worker = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/research.ts'), 'utf8');
  assert.match(worker, /\n  'home\/brief': \{/);
});

test('D564: P2 is mounted as Partner Studio, inside the /studio frame that keeps Eadwyn', () => {
  // The owner signed P2 off on #981 (A). Its one importer is the partner frame,
  // which Dashboard.jsx renders for /studio's partner branch.
  const importers = [];
  // Directory entries carry their own type, so nothing is stat-ed and then
  // read (CodeQL's file-system race, raised on the first draft's statSync).
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(entry.name) && !p.endsWith('PartnerHomeP2.jsx')
        && /from ['"][^'"]*PartnerHomeP2['"]/.test(readFileSync(p, 'utf8'))) importers.push(p);
    }
  };
  walk(resolve(process.cwd(), 'frontend/src'));
  assert.deepEqual(importers.map((p) => p.slice(p.indexOf('frontend/'))), ['frontend/src/pages/partner/PartnerStudioHome.jsx']);
  const frame = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/partner/PartnerStudioHome.jsx'), 'utf8'));
  // D1419: P2's three parts are the partner Studio's modules, drawn in the member's layout.
  assert.match(frame, /const home = usePartnerHome\(previewing\);/);
  assert.match(frame, /const tiles = partnerTiles\(home\.state, home\.load\);/);
  assert.match(frame, /<StudioModules studio=\{studio\} tiles=\{tiles\} withheld=\{previewing\} \/>/);
  assert.match(frame, /<StudioInterview persona="partner"/, 'Eadwyn left Partner Studio');
  // SM4's header: "Studio", as every profile's.
  assert.match(frame, /data-testid="text-partner-studio-title">Studio</);
  assert.match(readFileSync(resolve(process.cwd(), 'frontend/src/pages/Dashboard.jsx'), 'utf8'), /<PartnerStudioHome/,
    '/studio no longer renders the partner frame');
  const p2 = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/partner/PartnerHomeP2.jsx'), 'utf8'));
  assert.doesNotMatch(p2 + frame, /\bHome\b(?!P2)/, 'Partner Studio still says Home');
});

test('D564, D1419: a partner on /studio sees their modules, and nothing on it says Home', () => {
  // The frame (Eadwyn, the profile band) mounts Worker-reaching imports, so the
  // modules it mounts are rendered here, as the partner's /studio draws them.
  const html = render({ status: 'ready', reads: { board: { mode: 'project', engagements: [], due_next_7_days: 0, needs_attention: [] }, retainers: { mrr_cents: 0, retainers: [] }, capacity: { over_committed_count: null, cap_note: 'No cap stated.' } } });
  assert.match(html, /Your modules3 of 12 placed/);
  assert.doesNotMatch(html, /\bHome\b/);
  // A preview withholds every module, and reads nothing (SM11).
  assert.equal((render({ status: 'preview' }).match(/Withheld in administrator preview/g) || []).length, 3);
});
