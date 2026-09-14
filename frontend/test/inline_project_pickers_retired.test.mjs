/**
 * Twenty-five in-body startup pickers are gone, and nothing they reached became
 * unreachable.
 *
 * WHAT #181 REMOVED. Every founder zone page, and four legacy pages besides,
 * carried its own `<select>` over the founder's startups, behind
 * `projects.length > 1`. The sidebar's `CompanySwitcher` already owns scope, so
 * the same screen had two controls that changed what it showed and only one of
 * them told the rest of the app. The decision — one company, one startup — was
 * measured against production D1 (5 projects, 5 founders, one project each), so
 * `projects.length > 1` was false for every live account and not one of these
 * rendered for anybody.
 *
 * `scripts/check-inline-project-pickers.mjs` is what stops a twenty-sixth from
 * appearing; it counts, and a text sweep is the right tool for counting. This
 * file asserts the two things a count cannot see:
 *
 *   1. DELETING A PICKER MUST NOT STRAND A PROJECT. Each page still has a way to
 *      be pointed at a startup. Twenty-two read `?project_id=`; the two that
 *      never did resolve the first project from their own fetch. The table below
 *      says which, per file, so a page that silently loses its URL read fails
 *      here rather than quietly showing project #1 forever.
 *   2. REMOVING THE "NEW STARTUP" BUTTON MUST NOT REMOVE CREATING A STARTUP.
 *      `CreateStartupForm` is rendered, both ways, and the closed case must be
 *      EMPTY — no button, no toggle, nothing. Thirteen places across the SPA
 *      address `/build?new=1`, and the desk now follows that param when it
 *      CHANGES, not only when it mounts: the Command Palette can be opened from
 *      /build itself, where the old mount-time initializer never re-ran and the
 *      "Create startup" entry therefore did nothing at all.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/inline_project_pickers_retired.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CreateStartupForm from '../src/components/CreateStartupForm.jsx';
import { codeOnlyJsx } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
// `codeOnlyJsx`, not `codeOnly`: every deletion below left a `{/* … */}` in the
// markup naming what went, and those comments contain the exact strings these
// assertions ban. Three of them failed against correct code before this.
const code = (p) => codeOnlyJsx(raw(p));

/** Where each former picker site gets its project from now. */
const FROM_URL = [
  'pages/founder/FounderBuildBoard.jsx',
  'pages/founder/FounderBuildCadence.jsx',
  'pages/founder/FounderBuildKpi.jsx',
  'pages/founder/FounderBuildRoadmap.jsx',
  'pages/founder/FounderBuildThisWeek.jsx',
  'pages/founder/FounderGrowBrand.jsx',
  'pages/founder/FounderGrowCapitalMatch.jsx',
  'pages/founder/FounderGrowCustomers.jsx',
  'pages/founder/FounderGrowDesk.jsx',
  'pages/founder/FounderGrowFocus.jsx',
  'pages/founder/FounderGrowLaunch.jsx',
  'pages/founder/FounderGrowPartnerships.jsx',
  'pages/founder/FounderGrowTalent.jsx',
  'pages/founder/FounderNetworkOrganizations.jsx',
  'pages/founder/FounderNetworkRelationships.jsx',
  'pages/founder/FounderRaiseCapital.jsx',
  'pages/founder/FounderRaiseDataRoom.jsx',
  'pages/founder/FounderRaiseDesk.jsx',
  'pages/founder/FounderRaiseLegal.jsx',
  'pages/founder/FounderRaiseLiquidity.jsx',
  'pages/founder/FounderRaisePitch.jsx',
  'pages/founder/FounderRaiseStatus.jsx',
  'pages/raise/DataRoomPage.jsx',
];

/**
 * The two that never read the URL. They resolve the first project their own
 * fetch returns — which is exactly what they did on every account where the
 * picker was hidden, so removing it changed nothing for them.
 */
const FROM_FIRST_FETCHED = [
  ['pages/MarketIntelPage.jsx', /if \(list\[0\]\) setProjectId\(list\[0\]\.id\)/],
  ['pages/RaisePipelinePage.jsx', /if \(safe\.length > 0\) setProjectId\(safe\[0\]\.id\)/],
];

test('every page that lost a picker can still be pointed at a startup', () => {
  for (const rel of FROM_URL) {
    const src = code(`frontend/src/${rel}`);
    assert.match(src, /\bget\(['"]project_id['"]\)/,
      `${rel} lost its startup picker in #181, so \`?project_id=\` is now the ONLY way to `
      + 'aim it at a startup — it must still read the param');
  }
  for (const [rel, shape] of FROM_FIRST_FETCHED) {
    const src = code(`frontend/src/${rel}`);
    assert.match(src, shape,
      `${rel} never read ?project_id=, so the first project of its own fetch is all it has left`);
    assert.doesNotMatch(src, /\bprojects\s*\.\s*length\s*>\s*1/,
      `${rel} must not re-grow a picker`);
  }
});

test('the create-a-startup form has no button of its own, and still opens', () => {
  // THE CLOSED CASE IS THE ASSERTION. The component used to render a "New
  // Startup" button whether or not the form was open — a body-level control
  // toggling a body-level form, on a page the URL already addresses. Closed now
  // means nothing on screen at all.
  const closed = renderToStaticMarkup(
    React.createElement(CreateStartupForm, { open: false, onOpenChange() {}, onCreated() {} }),
  );
  assert.equal(closed, '', 'a closed CreateStartupForm must render nothing — not even a toggle');

  const open = renderToStaticMarkup(
    React.createElement(CreateStartupForm, { open: true, onOpenChange() {}, onCreated() {} }),
  );
  assert.match(open, /Add New Startup/, 'the form itself is unchanged — creating a startup still works');
  assert.match(open, /Startup Name/);
  assert.match(open, /Create/);
  // The form's own heading is "Add New Startup", so the button is pinned by its
  // testid rather than by its words.
  assert.doesNotMatch(open, /data-testid="button-new-startup"/,
    'the removed button must not come back alongside the form');
});

test('/build?new=1 opens the form even when the desk is already mounted', () => {
  // THE REGRESSION THIS PREVENTS, stated plainly: `creating` was seeded by a
  // `useState` INITIALIZER reading `?new=1`, which runs once. Twelve of the
  // thirteen links to /build?new=1 arrive from another route and so remount the
  // desk — fine. The Command Palette is the thirteenth and can be opened from
  // /build itself, where `nav('/build?new=1')` changes the search string without
  // remounting: the initializer never re-ran and the entry did nothing. The
  // form's own button hid that. The button is gone, so the param has to work.
  const src = code('frontend/src/pages/founder/FounderBuildDesk.jsx');
  assert.match(src, /useState\(\(\) => searchParams\.get\('new'\) === '1'\)/,
    'the mount case must still be seeded from the param');
  assert.match(src, /useEffect\(\(\) => \{\s*if \(searchParams\.get\('new'\) === '1'\) setCreating\(true\);\s*\},\s*\[searchParams\]\)/,
    'and the param must be followed when it CHANGES, or the Command Palette entry is inert on /build');
  assert.doesNotMatch(src, /data-testid="button-new-startup"/,
    'the desk must not reintroduce its own create button');
});

test('neither zone body deflects to a workspace with a control of its own', () => {
  // #179: "Open workspace has nothing to do there", about Grow · Brand. #177
  // flagged the identical link on Raise · Liquidity. Both destinations are still
  // reachable — Brand's from the zone header's `New page` action, Liquidity's
  // from the sidebar and the Raise tab row — so what went is the duplicate
  // handle, not the surface.
  const brand = code('frontend/src/pages/founder/FounderGrowBrand.jsx');
  assert.doesNotMatch(brand, /link-open-grow-brand-workspace/);
  assert.doesNotMatch(brand, /Open workspace/,
    'Grow · Brand must not carry a body-level "Open workspace" control');

  const liquidity = code('frontend/src/pages/founder/FounderRaiseLiquidity.jsx');
  assert.doesNotMatch(liquidity, /link-open-liquidity-workspace/);
  assert.doesNotMatch(liquidity, /Open workspace/,
    'Raise · Liquidity must not carry one either');
  // AND THE COPY HAD TO MOVE WITH THE LINK. The page said "Use the workspace for
  // supported actions" — a sentence that pointed at a control this page no
  // longer has. A dangling instruction is worse than the duplicate link was.
  assert.doesNotMatch(liquidity, /Use the workspace for supported actions/,
    'the copy must not send a reader to a control that is no longer on the page');
  assert.match(liquidity, /Model an exit/,
    'it should name where modelling an exit actually is — the zone header action');
});
