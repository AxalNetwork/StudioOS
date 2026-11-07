// #4734 (S1 audit 2026-11-06) — the Pitch studio's words, rail registry, addresses
// and docs must say only what the app draws.
//
//   1. a rail option's anchor must be a component something mounts (the dead
//      `AskDraftFromProject` kept an anchor-only check passing for a whole
//      release; it is the one entry on the ledger, see below), and the moved-from-builder notice names only mounted actions;
//   2. the retired /raise/pitch/analytics address stays retired, and nothing claims a redirect;
//   3. every /raise/pitch/* address the folder README names is a mounted route;
//   4. every /raise/pitch* route, and every area route that is not on the ledger
//      below, is named by a route-map canvas row.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_integration_4734.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';
import { BUILDER_MOVED_NOTICE, MOVED_NOTICES, SHARE_PATH } from '../src/pages/raise/pitch/pitchStudioModel.js';
import { MORE_MENU } from '../src/pages/raise/pitch/deckV2Model.js';

const ROOT = join(process.cwd(), process.cwd().endsWith('frontend') ? '..' : '.');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(jsx?|mjs)$/.test(n)) out.push(p);
  }
  return out;
};
const SRC = walk(join(ROOT, 'frontend/src')).map((p) => [p, codeOnly(readFileSync(p, 'utf8'))]);
const APP = read('frontend/src/App.jsx');
const APP_ROUTES = [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

// ── 1. dead anchors, and the moved notice ──────────────────────────────────

/** The capitalised component whose body holds `call` in `file`, or null when the anchor is data (a table, a config). */
function componentAround(file, call) {
  const src = codeOnly(readFileSync(join(ROOT, file), 'utf8'));
  const at = src.indexOf(call);
  if (at < 0) return null;
  const re = /(?:^|\n)(?:export\s+(?:default\s+)?)?function\s+([A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*)\b|(?:^|\n)(?:export\s+)?const\s+([A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*)\s*=\s*(?:React\.)?(?:memo\(|forwardRef\(|\(|async\s*\(|function)/g;
  const m = [...src.slice(0, at).matchAll(re)].pop();
  return m ? { name: m[1] || m[2], src } : null;
}

// Ratchet: options whose component nothing mounts. `form:deck` is the Worker's live `POST /api/decks/:id/autofill` job
// (railMatrix, textJobs, DECK_FORM_RAIL and their tests); its studio action has been unmounted since D1604. Removing
// the option means removing that Worker job in its own change; an entry may leave this set, never join it.
const UNMOUNTED_LEDGER = new Set(['form:deck']);

test('a rail option\'s anchor is a component that something mounts, not dead code with the anchor text still in it', () => {
  const dead = [];
  let checked = 0;
  for (const o of FOUNDER_OPTIONS) {
    for (const [file, call] of o.at) {
      if (!file.endsWith('.jsx')) continue;
      const c = componentAround(file, call);
      if (!c) continue; // a data-driven anchor: no component to be dead
      checked += 1;
      const abs = join(ROOT, file);
      const elsewhere = SRC.some(([p, s]) => p !== abs && new RegExp(`\\b${c.name}\\b`).test(s));
      const inside = new RegExp(`<${c.name}\\b|\\b${c.name}\\(`).test(c.src.replace(new RegExp(`function\\s+${c.name}\\b`), ''));
      if (!elsewhere && !inside && !UNMOUNTED_LEDGER.has(o.key)) dead.push(`${o.key}: ${c.name} in ${file}`);
    }
  }
  assert.ok(checked > 40, `${checked} component anchors checked`);
  assert.ok(UNMOUNTED_LEDGER.size <= 1, 'the ledger only shrinks');
  assert.deepEqual(dead, []);
});

test('the moved-from-builder notice names only what is drawn', () => {
  assert.equal(MOVED_NOTICES['pitch-builder'], BUILDER_MOVED_NOTICE);
  // The two things the notice used to claim that were not there.
  assert.doesNotMatch(BUILDER_MOVED_NOTICE, /draft from project/i);
  assert.doesNotMatch(BUILDER_MOVED_NOTICE, /on Decks/);
  // Drafting goes through the deck's Ask, which the editor mounts.
  assert.match(BUILDER_MOVED_NOTICE, /deck's Ask in the editor/);
  assert.match(codeOnly(read('frontend/src/pages/raise/pitch/PitchEditor.jsx')), /<DeckAsk\b/);
  // Branding is the editor's ⋯ menu's Brand kit sheet.
  assert.match(BUILDER_MOVED_NOTICE, /Brand kit/);
  assert.ok(MORE_MENU.some((s) => s.items.some((i) => i.id === 'brand' && i.label === 'Brand kit')), 'the ⋯ menu has Brand kit');
  assert.match(read('frontend/src/pages/raise/pitch/DeckSheets.jsx'), /title="Brand kit"/);
  assert.match(codeOnly(read('frontend/src/pages/raise/pitch/StudioActions.jsx')), /export function BrandingCard/);
  // Templates are New deck's.
  assert.match(BUILDER_MOVED_NOTICE, /templates are in New deck/);
  assert.ok(APP_ROUTES.includes('/raise/pitch/new'));
});

// ── 2. the retired analytics address ───────────────────────────────────────

test('/raise/pitch/analytics stays retired (D2319), and no source or doc claims it redirects', () => {
  // D2319 retired it, with the other never-opened forwards, and #4453 removed the route; D4254's table, three
  // comments, a constant and a test comment went on saying it redirected to Share & analytics (#4734).
  // Mutation checked: the route restored → pitch_overview_d4254's own assertion fails, and so does this.
  assert.ok(!APP_ROUTES.includes('/raise/pitch/analytics'), 'no route mounts it');
  assert.ok(APP_ROUTES.includes(SHARE_PATH), 'Share & analytics is at /raise/pitch/share');
  assert.ok(!SRC.some(([, s]) => /\bANALYTICS_PATH\b/.test(s)), 'ANALYTICS_PATH is gone');
  // Mutation checked: a comment claiming "/analytics redirects there" → named here.
  const claims = [];
  for (const [p, src] of walk(join(ROOT, 'frontend/src')).map((x) => [x, readFileSync(x, 'utf8')])) {
    if (/\/analytics redirects|\/raise\/pitch\/analytics[^\n]{0,60}redirect/i.test(src)) claims.push(p.replace(`${ROOT}/`, ''));
  }
  assert.deepEqual(claims, []);
  const d4254 = read('documentation/architecture/decisions/D4254.md');
  assert.match(d4254, /\| `\/raise\/pitch\/analytics` \| Retired by D2319/);
  assert.doesNotMatch(d4254, /analytics` \| Redirects/);
});

// ── 3. the folder README's addresses ───────────────────────────────────────

test('every /raise/pitch/* address the folder README names is a mounted route', () => {
  const readme = read('frontend/src/pages/raise/pitch/README.md');
  const named = [...new Set([...readme.matchAll(/`(\/raise\/pitch(?:\/[a-z0-9-]+)*)(?:\?[^`]*)?`/g)].map((m) => m[1]))];
  assert.ok(named.length >= 8, `${named.length} addresses named`);
  // Mutation checked: the README naming an address no <Route> mounts (/raise/pitch/builder-v2) → it is listed here.
  const missing = named.filter((p) => !APP_ROUTES.includes(p));
  assert.deepEqual(missing, []);
  for (const p of ['/raise/pitch', '/raise/pitch/decks', '/raise/pitch/script', '/raise/pitch/review', '/raise/pitch/share', '/raise/pitch/notes']) {
    assert.ok(named.includes(p), `${p} is named`);
  }
  assert.match(readme, /`PitchOverview\.jsx`, `pitchOverviewModel\.js`/);
});

// ── 4. the route map ───────────────────────────────────────────────────────

const canvasText = () => {
  const dir = join(ROOT, 'documentation/architecture/route-map/canvases');
  let text = '';
  for (const part of readdirSync(dir).filter((p) => /^part-/.test(p))) {
    for (const f of readdirSync(join(dir, part))) text += `${readFileSync(join(dir, part, f), 'utf8')}\n`;
  }
  return text;
};

/**
 * Area routes (`frontend/src/routes/*.jsx`) that no canvas row names yet: other features' gaps, found when this
 * check was added. A ratchet: nothing is added, and a route that gets its row comes off.
 */
const AREA_ROUTES_WITHOUT_A_ROW = new Set([
  'adminGovernance.jsx /admin/contracts/governance',
  'adminInfluencers.jsx /admin/programs/influencer', 'adminInfluencers.jsx /admin/programs/influencer/how-it-runs',
  'adminInfluencers.jsx /admin/programs/influencer/applications', 'adminInfluencers.jsx /admin/programs/influencer/influencers',
  'adminInfluencers.jsx /admin/programs/influencer/offers', 'adminInfluencers.jsx /admin/programs/influencer/payouts',
  'adminInfluencers.jsx /admin/programs/influencer/activity', 'adminInfluencers.jsx /admin/programs/influencer/settings',
  'growDistribution.jsx /grow/distribution/channels', 'growDistribution.jsx /grow/distribution/campaigns',
  'growDistribution.jsx /grow/distribution/campaigns/new', 'growDistribution.jsx /grow/distribution/campaigns/:uid',
  'growDistribution.jsx /grow/distribution/calendar', 'growDistribution.jsx /grow/distribution/ads',
  'growDistribution.jsx /grow/distribution/newsletter', 'growDistribution.jsx /grow/distribution/prospects',
  'growDistribution.jsx /grow/distribution/inbox', 'growDistribution.jsx /grow/distribution/results',
  'hqDecks.jsx /admin/platform/decks', 'hqDecks.jsx /admin/platform/decks/flags', 'hqDecks.jsx /admin/platform/decks/beta',
  'hqDecks.jsx /admin/platform/decks/templates', 'hqDecks.jsx /admin/platform/decks/norms', 'hqDecks.jsx /admin/platform/decks/models',
  'hqDecks.jsx /admin/platform/decks/grid', 'hqDecks.jsx /admin/platform/decks/funnel',
  'influencer.jsx /influencer', 'influencer.jsx /influencer/links', 'influencer.jsx /influencer/offers',
  'influencer.jsx /influencer/earnings', 'influencer.jsx /influencer/audience', 'influencer.jsx /influencer/resources',
  'influencerHandle.jsx /:at', 'influencerHandle.jsx /:at/:channel', 'influencerProgram.jsx /influencers',
  'learning.jsx /learning/courses/:slug', 'learning.jsx /learning/courses/:slug/:lesson', 'learning.jsx /learning/videos/:uid',
  'learning.jsx /learning/items/:uid', 'learning.jsx /learning/webinars/:slug', 'learning.jsx /learning/exercises/:slug',
  'learning.jsx /learning/exams/:slug', 'learning.jsx /learning/me', 'learning.jsx /learning/plan',
  'learning.jsx /learning/my-programs/:program', 'learning.jsx /learning/programs', 'learning.jsx /learning/programs/:program',
  'learning.jsx /learning/studio', 'learning.jsx /learning/studio/programs', 'learning.jsx /learning/studio/programs/:program',
  'team.jsx /projects/:id/work', 'team.jsx /account/companies/:uid/settings/compliance',
]);

test('every /raise/pitch* route is named by a route-map canvas row', () => {
  const text = canvasText();
  const pitch = APP_ROUTES.filter((p) => p === '/raise/pitch' || p.startsWith('/raise/pitch/') || p === '/raise/pitch-deck');
  assert.ok(pitch.length >= 12, `${pitch.length} pitch routes`);
  // Mutation checked: `/raise/pitch/present` taken out of the Pitch Deck Studio row → this names it.
  assert.deepEqual(pitch.filter((p) => !text.includes(p)), []);
});

test('every area route (frontend/src/routes/*.jsx) is named by a canvas row, except the ratcheted gaps', () => {
  const text = canvasText();
  const missing = [];
  for (const f of readdirSync(join(ROOT, 'frontend/src/routes')).filter((n) => n.endsWith('.jsx'))) {
    for (const m of read(`frontend/src/routes/${f}`).matchAll(/<Route\s+path="([^"]+)"/g)) {
      if (!text.includes(m[1])) missing.push(`${f} ${m[1]}`);
    }
  }
  // Mutation checked: `/remote` taken out of the Pitch Deck Studio row → it is a new gap and this fails.
  assert.deepEqual(missing.filter((k) => !AREA_ROUTES_WITHOUT_A_ROW.has(k)), [], 'a new area route needs a canvas row');
  assert.deepEqual([...AREA_ROUTES_WITHOUT_A_ROW].filter((k) => !missing.includes(k)), [], 'it has its row now: take it off the ledger');
  // /remote, shipped by #4384, has its row (the phone's side of Present's remote).
  assert.ok(text.includes('`/remote`'));
  assert.match(read('documentation/architecture/route-map/sections/0846-the-phone-remote-for-present-d1581-3828.md'), /RemotePair\.jsx[\s\S]*RemotePage\.jsx[\s\S]*routes\/remote\.jsx/);
});
