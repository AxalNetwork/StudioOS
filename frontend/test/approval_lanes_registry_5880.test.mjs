/**
 * D5880 (#5880, part 6 of #4716) — the frontend's approval lanes held to the
 * Worker's registry, and every lane's door held to the route table.
 *
 * The Worker writes each lane's facts once, in
 * `cloudflare-worker/src/services/approvalLaneRegistry.ts` (D5879). The page
 * keeps its own lists, `LANES` and `HQ_LANES` in `approvalsModel.js`, and
 * `inboxModel.js` builds `LANE_BY_KEY` from them: that map is what names a
 * lane and its group everywhere on /admin/approvals. Nothing held the two
 * sides together, so a lane renamed, regrouped or moved to HQ on one side
 * drifted silently. This file reads both and fails on any difference in key,
 * label, group or scope.
 *
 * A KNOWN DIFFERENCE IS PINNED, NOT IGNORED. Four lanes carry the canvas's
 * words on the page and the Worker's older board label in its API
 * (`LABEL_PAIRS`). Each entry names both values, so a change on either side
 * still fails here and must be made on purpose.
 *
 * Every lane's door — the literal link `LaneDoor` or `HqDoor` in
 * `AdminApprovals.jsx` draws — and every `decisionPath` the registry states
 * must be a route `App.jsx` or a module under `frontend/src/routes/` declares
 * that renders a page: the exact path, or a `:param` route listed in
 * `PARAM_DESTINATIONS`. A catch-all (`/admin/*`) or a `<Navigate>` redirect is
 * not a destination.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/approval_lanes_registry_5880.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APPROVAL_LANES, INBOX_GROUPS } from '../../cloudflare-worker/src/services/approvalLaneRegistry.ts';
import { LANES, HQ_LANES, GROUPS, isHqLane } from '../src/pages/admin/approvals/approvalsModel.js';
import { LANE_BY_KEY, HQ_GROUP, laneLabelOf } from '../src/pages/admin/approvals/inboxModel.js';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { approvalsPageSource } from './_approvalsPage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The page's label differs from the Worker's for these lanes, by design: the
 * page names them in the Approvals canvas's words (D1038 §1), and `laneLabelOf`
 * shows that word in place of the API's `lane_label` everywhere on the page.
 * The Worker's label is what its inbox and decision-log responses carry, so
 * changing it is an API change, not this task's. Both values are pinned.
 */
const LABEL_PAIRS = {
  exploring: { page: 'Explorers ready for a profile', worker: 'Exploring' },
  cohort: { page: 'Spin-Out Lab applications', worker: 'Cohort applications' },
  moderation: { page: 'Spin-Out moderation', worker: 'Spinout moderation' },
  referrals: { page: 'Refer & Earn reviews', worker: 'Referrals' },
};

/** Lanes with no page to open, each drawn as plain words by its door. */
const NO_DOOR = {
  // Empty since D5885 gave Best-Fit its board (/admin/approvals/best-fit).
};

/** The page's view of every lane: key, label, group and scope. */
function pageLanes() {
  return Object.entries(LANE_BY_KEY).map(([key, l]) => ({
    key,
    label: laneLabelOf(key),
    group: l.group,
    scope: isHqLane(key) ? 'hq' : 'studio',
  }));
}

test('the page and the Worker registry name the same lanes', () => {
  const page = Object.keys(LANE_BY_KEY).sort();
  const worker = Object.keys(APPROVAL_LANES).sort();
  assert.deepEqual(page, worker, 'a lane exists on one side only');
  assert.equal(LANES.length + HQ_LANES.length, page.length, 'a lane key is listed twice on the page');
});

test('each lane has the same label, group and scope on both sides', () => {
  const diffs = [];
  for (const p of pageLanes()) {
    const w = APPROVAL_LANES[p.key];
    if (!w) continue;
    const pair = LABEL_PAIRS[p.key];
    if (pair) {
      if (p.label !== pair.page || w.label !== pair.worker) {
        diffs.push(`${p.key}.label: page ${JSON.stringify(p.label)}, Worker ${JSON.stringify(w.label)}; LABEL_PAIRS pins ${JSON.stringify(pair)}`);
      }
    } else if (p.label !== w.label) {
      diffs.push(`${p.key}.label: page ${JSON.stringify(p.label)}, Worker ${JSON.stringify(w.label)}`);
    }
    if (p.group !== w.group) diffs.push(`${p.key}.group: page ${p.group}, Worker ${w.group}`);
    if (p.scope !== w.scope) diffs.push(`${p.key}.scope: page ${p.scope}, Worker ${w.scope}`);
  }
  assert.deepEqual(diffs, []);
});

test('the pinned label differences are still differences', () => {
  // A pair whose two sides agree again belongs in the plain check, not here.
  for (const [key, pair] of Object.entries(LABEL_PAIRS)) {
    assert.notEqual(pair.page, pair.worker, `${key}: the labels agree, so drop it from LABEL_PAIRS`);
    assert.ok(APPROVAL_LANES[key], `${key}: not a lane in the registry`);
  }
});

test('the page draws every group the registry uses', () => {
  const page = [...GROUPS.map((g) => g.key), HQ_GROUP.key];
  assert.deepEqual(page, [...INBOX_GROUPS]);
});

/* ------------------------------------------------------------------ *
 * Destinations
 * ------------------------------------------------------------------ */

/**
 * Every `<Route path="…">` in App.jsx and the route modules that renders a
 * page. A splat route (`/admin/*`, `*`) is a catch-all — Not found, a guard or
 * a forward — and a `<Navigate>` route is a redirect, so landing on either is
 * not a destination: both are left out, or every `/admin/…` door would pass.
 */
function routePaths() {
  const src = codeOnly(readRoutesSource(root));
  const out = [];
  for (const seg of src.split('<Route').slice(1)) {
    const path = /^\s+path="([^"]+)"/.exec(seg)?.[1];
    if (!path || path.includes('*')) continue;
    // The first PascalCase element is the page, as admin_route_reachability reads it.
    if (/<([A-Z]\w+)/.exec(seg)?.[1] === 'Navigate') continue;
    out.push(path);
  }
  return out;
}

/**
 * A destination that only a `:param` route answers, with the route it is
 * meant to land on. Matching a param loosely is not enough: `/:at/:channel`
 * (a handle's page) and `/admin/licences/:uid` answer almost any two- or
 * three-segment address, so a mistyped door would pass. Every other
 * destination must equal a declared path exactly.
 */
const PARAM_DESTINATIONS = {
  // KYB's own tab on KYC & KYB (D1132): KycPage reads `:tab`.
  '/admin/kyc/businesses': '/admin/kyc/:tab',
};

const bare = (p) => p.replace(/[?#].*$/, '').replace(/(.)\/+$/, '$1');

/** Does `pattern` match `path` segment for segment, `:param` taking any one segment? */
function patternMatches(pattern, path) {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || (s.startsWith(':') && b[i] !== ''));
}

/** Is `path` (query and hash stripped) a page route, exactly or by its listed `:param` route? */
function matchesRoute(path, routes) {
  const p = bare(path);
  if (routes.includes(p)) return true;
  const pattern = PARAM_DESTINATIONS[p];
  return Boolean(pattern && routes.includes(pattern) && patternMatches(pattern, p));
}

/** `LaneDoor` and `HqDoor`'s cases, as { key: { to, text } }. */
function doors() {
  const src = approvalsPageSource();
  const out = {};
  for (const fn of ['LaneDoor', 'HqDoor']) {
    const start = src.indexOf(`export function ${fn}(`);
    assert.ok(start >= 0, `${fn} not found in the Approvals page`);
    const end = src.indexOf('\n}\n', start);
    for (const line of src.slice(start, end).split('\n')) {
      const keys = [...line.matchAll(/case '(\w+)':/g)].map((m) => m[1]);
      if (!keys.length) continue;
      const to = /\bto="([^"]+)"/.exec(line)?.[1] || null;
      const text = />([^<]+)</.exec(line)?.[1] || null;
      for (const k of keys) out[k] = { to, text };
    }
  }
  return out;
}

test('the route matcher wants an exact path, or the listed param route', () => {
  const routes = ['/admin/kyc/:tab', '/a/b', '/:at/:channel'];
  assert.ok(matchesRoute('/admin/kyc/businesses', routes));
  assert.ok(matchesRoute('/a/b?x=1#y', routes));
  assert.ok(matchesRoute('/a/b/', routes));
  assert.ok(!matchesRoute('/admin/kyc/people', routes), 'a param match not listed in PARAM_DESTINATIONS');
  assert.ok(!matchesRoute('/admin/jobz', routes), '/:at/:channel must not answer an admin door');
  assert.ok(!matchesRoute('/admin/kyc/businesses', ['/admin/kyc']), 'the listed param route is gone');
  assert.ok(!matchesRoute('/a/b/c', routes));
});

test('every listed param destination is still a param route the table declares', () => {
  const routes = routePaths();
  for (const [path, pattern] of Object.entries(PARAM_DESTINATIONS)) {
    assert.ok(!routes.includes(path), `${path} is now a route of its own; drop it from PARAM_DESTINATIONS`);
    assert.ok(routes.includes(pattern), `${pattern} is not declared`);
  }
});

test('every lane in the registry has a door, and each door is a registered route', () => {
  const routes = routePaths();
  assert.ok(routes.length > 100, `only ${routes.length} routes read; the parser has lost the table`);
  const d = doors();
  const problems = [];
  for (const key of Object.keys(APPROVAL_LANES)) {
    const door = d[key];
    if (!door) { problems.push(`${key}: no case in LaneDoor or HqDoor`); continue; }
    if (NO_DOOR[key]) {
      if (door.to) problems.push(`${key}: now links to ${door.to}; drop it from NO_DOOR`);
      else if (door.text !== NO_DOOR[key]) problems.push(`${key}: says ${JSON.stringify(door.text)}, NO_DOOR says ${JSON.stringify(NO_DOOR[key])}`);
      continue;
    }
    if (!door.to) { problems.push(`${key}: its door is not a link`); continue; }
    if (!matchesRoute(door.to, routes)) problems.push(`${key}: door ${door.to} is not a registered route`);
  }
  assert.deepEqual(problems, []);
});

test('every decisionPath the registry states is a registered route', () => {
  const routes = routePaths();
  const paths = Object.entries(APPROVAL_LANES).filter(([, f]) => f.decisionPath);
  assert.ok(paths.length >= 1, 'the registry states no decisionPath; this check reads nothing');
  for (const [key, f] of paths) {
    assert.ok(matchesRoute(f.decisionPath, routes), `${key}: decisionPath ${f.decisionPath} is not a registered route`);
  }
});
