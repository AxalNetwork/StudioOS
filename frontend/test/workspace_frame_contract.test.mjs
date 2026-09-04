/**
 * THE FRAME CONTRACT — one shell, four licences, and nothing drawn twice.
 *
 * All twenty-nine Claude Design canvases specify the identical frame:
 *
 *   .frame { width:1440px; display:flex }
 *   .side  { width:186-198px; flex:none }
 *   .main  { flex:1; min-width:0; padding:20-24px }
 *   .rail  { width:280-288px; flex:none; background:#fff;
 *            border-left:1px solid #ececf1; padding:17-18px }
 *
 * and each frame contains EXACTLY ONE crumb, one `<h1>`, one sub-line, one
 * zone-pill row and one rail. This file is that sentence as tests, because
 * every layout defect the four-profile audit found was a violation of it:
 *
 *   · partner `/network/*` drew three `<h1>`s, two nav rows and two rails;
 *   · founder `/network/*` drew two of every one of the four;
 *   · investor `/network/*` drew one frame and the wrong body inside it, on
 *     two of its three zone routes;
 *   · four partner zones drew one body between them, under a header naming
 *     the wrong bucket;
 *   · fifteen partner zones drew no rail at all;
 *   · and the `.main` padding came from the page container per ROLE, so the
 *     four licences disagreed about it four different ways.
 *
 * Source-read, not rendered: there is no DOM in this suite (see
 * frontend/test/README.md), and `_codeOnly` strips comments first because a
 * prose apostrophe inside one has shredded this kind of parse twice already.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { allZoneRoutes, bucketsFor, ROLES_WITH_SHELL } from '../src/workspaces/shellConfig.js';
import {
  FOUNDER_FULL_BLEED, INVESTOR_FULL_BLEED, ADVISOR_FULL_BLEED, PARTNER_FULL_BLEED,
} from '../src/sidebarConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = (p) => codeOnly(read(p));

/** Every file that renders the shared shell. The rail is a slot on it, so this
 *  is also the complete list of callers that could leave the slot empty. */
const SHELL_CALLERS = [
  'frontend/src/workspaces/founder/FounderValidateWorkspace.jsx',
  'frontend/src/workspaces/investor/InvestorDealsRoutes.jsx',
  'frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx',
  'frontend/src/workspaces/partner/PartnerBucketRoutes.jsx',
  'frontend/src/workspaces/NetworkWorkspace.jsx',
  'frontend/src/workspaces/ResearchWorkspace.jsx',
];

test('the list of shell callers is complete', () => {
  // A seventh caller must be added above rather than escaping every test here.
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.jsx') && read(p).includes('<WorkspaceShell')) found.push(p);
    }
  };
  walk('frontend/src/workspaces');
  assert.deepEqual(found.sort(), [...SHELL_CALLERS].sort(),
    'a workspace renders WorkspaceShell and is not covered by this file');
});

test('every shell caller fills the rail slot', () => {
  // `WorkspaceShell` has taken a `rail` slot since the founder pass, and
  // `PartnerBucketRoutes` never filled it — so all fifteen Partner zones and
  // all three of its bucket roots rendered with an empty right-hand column.
  // That single omission was most of the product's rail gap, and it is the
  // third licence to have had it: the report each time was the same words,
  // "some pages doesn't have it, it does show anything, it looks blank".
  for (const file of SHELL_CALLERS) {
    assert.match(src(file), /rail=\{/, `${file} leaves the shell's rail slot empty`);
  }
});

test('the rail names a model only for a surface that really runs one', () => {
  // THE RULE DID NOT LOOSEN; THE FACTS CHANGED. This test used to assert that
  // the rail names no model and no price at all, and that was right at the
  // time: `ASSIST_SURFACES` binds a surface to a real aiRouter task class,
  // that class decides the model and the price, and no WORKSPACE surface was
  // registered on any licence — so a card here would have named a model for a
  // page that never called one. Its comment said the card "cannot honestly
  // ship until the registration exists, and inventing the registration to get
  // the card is the failure WorkspaceShell's docblock records".
  //
  // The registration was not invented. `POST /api/ai/workspace/explain` came
  // first, running `workspace_explain` over the Coverage lines the rail is
  // already showing; the surface entry followed the route. What this test
  // pins now is that ORDER, which is the thing worth protecting: a surface
  // key, a ROUTE entry and a worker call site must all exist together, and
  // the figures must come from the router rather than from a canvas.
  const rail = src('frontend/src/ui/WorkerRail.jsx');
  const cfg = src('frontend/src/ui/eadwynConfig.js');
  const task = /workspace:\s*\{[^}]*task:\s*'([a-z_]+)'/.exec(cfg)?.[1];
  assert.ok(task, 'the workspace surface must be registered in ASSIST_SURFACES');
  assert.ok(new RegExp(`^\\s*${task}:\\s*\\{`, 'm')
    .test(read('cloudflare-worker/src/services/aiRouter.ts')),
  `${task} must be a real entry in the router's ROUTE table, not a name`);
  assert.match(read('cloudflare-worker/src/routes/ai.ts'), new RegExp(`task: '${task}'`),
    `a worker route must run ${task}, or the card describes a call nothing makes`);
  assert.match(rail, /priceForTask\(pricing, surface\.task\)/,
    'the model and its rate are the router\'s, derived — never typed here');

  // The canvases quote `$0.293 / M in · $2.253 / M out` for this model and the
  // router's table says 0.50 / 0.50. Whichever is right, the rail shows what
  // will actually be charged.
  assert.doesNotMatch(rail, /\$0\.293|\$2\.253|Llama 3\.3 70B Fast/,
    'the canvas figures are not the router figures');
  for (const file of SHELL_CALLERS) {
    assert.doesNotMatch(src(file), /\bINHERITED\b|\bRECOMMENDED\b|per million|\/M tokens/i,
      `${file} hand-writes a model card instead of letting the rail derive one`);
  }
});

test('the shell owns its padding, and every workspace route is flush', () => {
  // ONE PADDING RULE. Padding used to come from App.jsx's page container,
  // which gives it per ROLE: founder and investor workspace routes were
  // `p-0` with a shell that set none, so `/validate/interviews` rendered plain
  // cards flush against the viewport; advisor was padded and full width;
  // partner was padded AND centred at max-w-7xl, the only licence held to
  // 1280px. The canvases put the padding on `.main`, which is this component.
  const shell = src('frontend/src/workspaces/WorkspaceShell.jsx');
  const mainClass = /className="(min-w-0 flex-1[^"]*)"/.exec(shell)?.[1];
  assert.ok(mainClass, 'the shell’s main column no longer has a static class list');
  assert.match(mainClass, /\bp-\d/, 'the shell must carry the canvases’ own .main padding');
  assert.doesNotMatch(mainClass, /\bpr-\d/,
    'the body/rail gutter is the main column’s own right padding now, not a second value beside it');

  // And the page container must hand every workspace route p-0 on all four
  // licences, through one derived table rather than named roles.
  const app = src('frontend/src/App.jsx');
  assert.match(app, /const fullBleedSurface = \(FULL_BLEED_BY_ROLE\[activeRole\] \|\| \[\]\)\.includes\(location\.pathname\)/);
  assert.match(app, /const flushSurface = fullBleedSurface;/);
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    assert.match(app, new RegExp(`${role}: ${role.toUpperCase()}_FULL_BLEED`),
      `${role} has no entry in the full-bleed table, so its routes fall to the padded default`);
  }
});

test('the full-bleed set covers every workspace route, for every licence', () => {
  // Derived from `shellConfig`, so a zone cannot be added to a shell and left
  // out of the layout — the `/grow/focus` omission, which was the whole of
  // "Grow doesn't fit full width and height", and the four `/funds/*` pages
  // that repeated it. Advisor and Partner had no list at all until now.
  const LISTS = {
    founder: FOUNDER_FULL_BLEED,
    investor: INVESTOR_FULL_BLEED,
    advisor: ADVISOR_FULL_BLEED,
    partner: PARTNER_FULL_BLEED,
  };
  assert.deepEqual(Object.keys(LISTS).sort(), [...ROLES_WITH_SHELL].filter((r) => LISTS[r]).sort(),
    'a role has a shell and no full-bleed list');
  for (const [role, list] of Object.entries(LISTS)) {
    const covered = new Set(list);
    const required = [...bucketsFor(role).map((b) => b.prefix), ...allZoneRoutes(role)];
    assert.ok(required.length > 15, `${role} resolved suspiciously few workspace routes`);
    assert.deepEqual(required.filter((p) => !covered.has(p)), [],
      `these ${role} workspace routes sit in the centred, padded column`);
    assert.deepEqual(list.filter((p, i, a) => a.indexOf(p) !== i), [],
      `${role.toUpperCase()}_FULL_BLEED has duplicates`);
  }
});

test('every partner zone route resolves to a body of its own', () => {
  // FOUR ROUTES, ONE BODY. `PartnerBucketRoutes` rendered its live component
  // with no props at all, and the component it rendered for four of the slugs
  // was `PartnerOperationsWorkspace` — which picks its tab by testing the
  // pathname for `/capabilities`, `/portfolio`, `/engagements` or
  // `/performance`. None of those occurs in `/pipeline/proposals`,
  // `/pipeline/retainers`, `/delivery/board` or `/delivery/health`, so all
  // four fell to its `overview` fallback and rendered the same page — under a
  // second header that read "Delivery · Ship the work" on a Pipeline route.
  const routes = src('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
  assert.doesNotMatch(routes, /PartnerOperationsWorkspace/,
    'the partner shell must not mount the legacy operations shell inside itself');

  const block = /const LIVE = \{([\s\S]*?)\n\};/.exec(routes)?.[1];
  assert.ok(block, 'the partner LIVE map could not be parsed');
  const bodies = [...block.matchAll(/<(\w+)([^>]*)\/>/g)].map((m) => `${m[1]}${/view="(\w+)"/.exec(m[2])?.[1] || ''}`);
  assert.ok(bodies.length >= 5, `only ${bodies.length} partner zone bodies found`);
  assert.deepEqual(bodies.filter((b, i, a) => a.indexOf(b) !== i), [],
    'two partner zones render the identical body — the four-routes-one-page bug');

  // `user` is a feature, not a style detail: NeedsBoardPage reads it for the
  // partner's "My quotes" tab and PerksPage for "My listings". Mounted with no
  // props both saw undefined and dropped the one tab the operator came for.
  assert.match(block, /<NeedsBoardPage user=\{user\}/, 'Leads must receive the signed-in user');
  assert.match(block, /<PerksPage user=\{user\}/, 'Perk deals must receive the signed-in user');
});

test('a page mounted inside the shell draws no second frame', () => {
  // The generalised form of the founder and partner Network bugs. A page is
  // free to draw its own crumb, h1, nav and rail — several do, correctly,
  // because they also mount directly from App.jsx where that IS the only
  // chrome. What it may not do is draw them unconditionally while a shell is
  // also drawing them: every one has to sit behind `embedded`.
  const MOUNTED_IN_A_SHELL = {
    'frontend/src/pages/founder/FounderNetworkRelationships.jsx': 'RelationshipRail',
    'frontend/src/pages/founder/FounderNetworkIntroductions.jsx': 'IntroductionRail',
    'frontend/src/pages/founder/FounderNetworkOrganizations.jsx': 'OrganizationRail',
    'frontend/src/pages/investor/InvestorNetworkWorkspace.jsx': 'WorkerRail',
    'frontend/src/pages/NetworkPage.jsx': 'PartnerWorkspaceShell',
  };
  for (const [file, chrome] of Object.entries(MOUNTED_IN_A_SHELL)) {
    const page = src(file);
    assert.match(page, /export default function \w+\(\{ embedded = false/,
      `${file} is mounted inside a shell and cannot be told the shell owns the chrome`);
    assert.match(page, new RegExp(`(!embedded && \\(?\\s*<${chrome}|if \\(embedded\\) return)`),
      `${file} draws its ${chrome} unconditionally inside a shell that draws one too`);
    assert.match(page, /\{!embedded && <header|\{!embedded && \(\s*<div|\{embedded \? <div \/> :|if \(embedded\) return/,
      `${file} draws its own heading block unconditionally inside a shell that draws one too`);
  }
});

test('the Spin-Out Lab keeps its own chrome, and the exclusion is scoped to the Worker rail', () => {
  // The owner's rule is "the AI rail applies to the pages, EXCEPT in the
  // Spin-Out Lab". Already true, and the scope matters: not one Lab route
  // renders `WorkerRail`, but three Lab pages render the OTHER component,
  // `AssistRail` through `AssistLayout` — and those three surfaces ARE
  // registered in `ASSIST_SURFACES`, so they legitimately name a model and a
  // price. A blunt "no rail in the Lab" would strip three correct rails.
  const lab = [];
  const walk = (dir) => {
    for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (/Spinout|SpinOut/i.test(entry.name) && entry.name.endsWith('.jsx')) lab.push(p);
    }
  };
  walk('frontend/src/pages');
  assert.ok(lab.length >= 5, `only ${lab.length} Spin-Out Lab pages found`);
  for (const file of lab) {
    assert.doesNotMatch(src(file), /<WorkerRail/, `${file} mounts the workspace rail inside the Lab`);
  }
  assert.ok(lab.some((f) => /AssistLayout|AssistRail/.test(src(f))),
    'the three legitimate AssistRail mounts in the Lab have been stripped');
});
