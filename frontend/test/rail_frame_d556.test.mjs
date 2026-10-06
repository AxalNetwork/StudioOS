/**
 * D556 — one frame for the Worker AI rail, on every page that mounts it.
 *
 * The owner: "The AIRail doesn't appear properly, on the right. Check the
 * other pages too. For reference check the Founder pages." On the founder
 * desks the rail is a panel docked to the right edge, full height, with a
 * seam, a ground and its own padding. About thirty other hosts put it in a
 * bare grid column inside the padded page, where it read as loose text.
 *
 * What this pins:
 *   · every file that mounts `<WorkerRail` is framed, in one of four named
 *     ways, and a new mount that is none of them fails here;
 *   · the shared frame is defined once, in `ui/RailFrame.jsx` and the
 *     `.fwr-frame*` rules of `ui/workerRail.css`, and nowhere else;
 *   · the frame is the founder panel: docked, stretched, seam, ground, inset,
 *     a track that collapses through `--fwr-track`, a dark pair;
 *   · the phone form (D405) still works, because the frame hides its column
 *     below 1024px instead of unmounting the rail;
 *   · a docked frame reaches the window's edge and the footer, not the
 *     centred 1280px column's edge and the end of its content, and the HQ
 *     section strip moves into it so the panel runs from the header;
 *   · Admin Studio has a rail, and its coverage is the studio glance.
 *
 * Run alone:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_frame_d556.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import RailFrame, { RailStripSlot } from '../src/ui/RailFrame.jsx';
import StudioRail, { studioRailCoverage } from '../src/pages/admin/StudioRail.jsx';
import { glancesFromStudioGlance, UNAVAILABLE } from '../src/pages/admin/adminStudioOverview.js';

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'frontend/src');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const CSS = read('frontend/src/ui/workerRail.css');
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const el = React.createElement;

function walk(dir, ext, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

const SOURCES = walk(SRC, /\.(jsx?|tsx?)$/).map((f) => ({ rel: relative(ROOT, f), code: codeOnly(readFileSync(f, 'utf8')) }));
const STYLESHEETS = walk(SRC, /\.css$/).map((f) => ({ rel: relative(ROOT, f), code: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));

/** Every source file that mounts the rail, read without its comments. */
const MOUNTS = SOURCES.filter((s) => /<WorkerRail\b/.test(s.code));

/**
 * A class drawn as a frame by its own stylesheet: one plain rule for exactly
 * that class (not `.dark`, not a descendant) that sets both a border and a
 * background. That is what the founder desks do, and it is the only reason a
 * host may skip the shared frame.
 */
function drawsFrame(cls) {
  for (const { code } of STYLESHEETS) {
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].split(',').map((x) => x.trim());
      if (!sels.includes(`.${cls}`)) continue;
      if (/border(-left)?\s*:/.test(m[2]) && /background(-color)?\s*:/.test(m[2])) return true;
    }
  }
  return false;
}

/** Hosts whose rail is a component of their own, mounted in the frame by name. */
const RAIL_COMPONENTS = {
  'frontend/src/pages/admin/StudioRail.jsx': ['frontend/src/pages/admin/AdminStudioHome.jsx', /<RailFrame rail=\{<StudioRail\b/],
};

/**
 * The trees allowed to draw the founder frame in their own stylesheet. These
 * are the reference (founder) and the desks built from the same canvases
 * (investor, /perks). Anywhere else must use the shared frame.
 */
const SELF_FRAMED_TREES = ['frontend/src/pages/founder/', 'frontend/src/pages/investor/', 'frontend/src/pages/PerksPage.jsx'];

function howFramed(m) {
  if (/<RailFrame\b[\s\S]*?\brail=/.test(m.code)) return 'frame';
  if (/<WorkspaceShell\b[\s\S]*?\brail=/.test(m.code)) return 'shell';
  if (RAIL_COMPONENTS[m.rel]) {
    const [host, use] = RAIL_COMPONENTS[m.rel];
    return use.test(codeOnly(read(host))) ? 'component' : null;
  }
  if (SELF_FRAMED_TREES.some((t) => m.rel.startsWith(t))) {
    const classes = [...m.code.matchAll(/<WorkerRail\b[^>]*?\bclassName="([^"]+)"/g)].map((x) => x[1].split(/\s+/)[0]);
    if (classes.length && classes.every(drawsFrame)) return 'self';
  }
  return null;
}

test('every file that mounts <WorkerRail> puts it in a frame', () => {
  assert.ok(MOUNTS.length >= 70, `expected the known mounts, found ${MOUNTS.length}`);
  const unframed = MOUNTS.filter((m) => !howFramed(m)).map((m) => m.rel);
  assert.deepEqual(unframed, [],
    'these mount the rail in no frame: pass it to RailFrame, or to WorkspaceShell as `rail`');
  // The census, so a reader can see the split and a drift in it shows up.
  const by = MOUNTS.reduce((acc, m) => { const k = howFramed(m); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  assert.ok(by.frame >= 18 && by.shell >= 13 && by.self >= 40 && by.component === 1, JSON.stringify(by));
});

test('WorkspaceShell draws no frame of its own; it uses the shared one', () => {
  const shell = codeOnly(read('frontend/src/workspaces/WorkspaceShell.jsx'));
  assert.match(shell, /<RailFrame rail=\{rail\}>/);
  assert.doesNotMatch(shell, /border-l\b|fwr-shell-slot|xl:block/, 'the shell drew its own rail slot again');
});

test('the frame is defined in one place', () => {
  // Only RailFrame.jsx names the frame's classes, and only workerRail.css
  // styles them. A page that writes `fwr-frame-rail` itself is a second frame.
  const named = SOURCES.filter((s) => /fwr-frame/.test(s.code) && s.rel !== 'frontend/src/ui/RailFrame.jsx').map((s) => s.rel);
  assert.deepEqual(named, [], 'only RailFrame.jsx may draw the frame');
  const styled = STYLESHEETS.filter((s) => /\.fwr-frame/.test(s.code) && s.rel !== 'frontend/src/ui/workerRail.css').map((s) => s.rel);
  assert.deepEqual(styled, [], 'only workerRail.css may style the frame');
  // And the hosts converted to it no longer carry the old bare column.
  for (const s of SOURCES.filter((x) => /<RailFrame\b/.test(x.code))) {
    assert.doesNotMatch(s.code, /grid-cols-\[minmax\(0,1fr\)_(?:280|300)px\]/, `${s.rel} kept its old rail column beside the frame`);
  }
});

test('the frame is the founder panel: docked, stretched, seamed, grounded, collapsible', () => {
  const desk = CSS_CODE.slice(CSS_CODE.indexOf('@media (min-width: 1024px) {\n  .fwr-frame {'));
  assert.ok(desk.length > 0, 'the desktop frame rules are gone');
  // The body of the rule whose line starts with exactly `sel {`. A string
  // search, not a RegExp built from `sel` (Semgrep's non-literal-regexp).
  const rule = (sel) => {
    const at = desk.indexOf(`\n  ${sel} {`);
    if (at < 0) return '';
    const open = desk.indexOf('{', at);
    return desk.slice(open + 1, desk.indexOf('}', open));
  };
  const row = rule('.fwr-frame');
  assert.match(row, /display:\s*flex/);
  assert.match(row, /align-items:\s*stretch/);
  const col = rule('.fwr-frame-rail');
  assert.match(col, /width:\s*var\(--fwr-track,\s*280px\)/, 'the column must collapse to the spine');
  assert.match(col, /border-left:\s*1px solid/, 'the seam against the body');
  assert.match(col, /background:\s*#fff/, 'the panel ground');
  assert.match(col, /padding:\s*18px 18px 28px/, 'the panel inset');
  const dock = rule('.fwr-frame-dock');
  assert.match(dock, /position:\s*sticky/);
  assert.match(dock, /overflow-y:\s*auto/, 'a rail taller than the window must scroll inside its panel');
  assert.match(dock, /max-height:/);
  assert.match(CSS_CODE, /\.dark \.fwr-frame-rail\s*\{[^}]*border-left-color:[^}]*background:/, 'the panel needs its dark pair');
});

test('the frame docks to the edge only where it can', () => {
  // A direct child of the padded page container takes the padding back on
  // the right and bottom, and on the top only when it is the first child —
  // never the left, which is the body's side, and never on a flush surface.
  const bleed = [...CSS_CODE.matchAll(/\[data-app-main\]:not\(\.edge-to-edge-surface\) > \.fwr-frame\[data-rail="true"\](:first-child)? \{([^}]*)\}/g)];
  assert.equal(bleed.length, 2, 'the frame lost its edge rules');
  const always = bleed.find((m) => !m[1])[2];
  const first = bleed.find((m) => m[1])[2];
  assert.match(always, /margin-right:\s*-24px/);
  assert.match(always, /margin-bottom:\s*-24px/);
  assert.doesNotMatch(always, /margin(-left)?:\s*-|margin-top/, 'only the right and bottom bleed on every frame');
  assert.match(first, /margin-top:\s*-24px/);
  // Each margin taken is handed back to the body, so the body does not move.
  assert.match(CSS_CODE, /> \.fwr-frame\[data-rail="true"\] > \.fwr-frame-main \{ padding-right: 24px; padding-bottom: 24px; \}/);
  assert.match(CSS_CODE, /> \.fwr-frame\[data-rail="true"\]:first-child > \.fwr-frame-main \{ padding-top: 24px; \}/);
  // App.jsx's padded container is the 24px it cancels.
  assert.match(read('frontend/src/App.jsx'), /flushSurface \? 'p-0 edge-to-edge-surface' : 'p-4 md:p-6'/);
});

test('a docked frame takes the window\'s edge and the column\'s height, not the centred column\'s', () => {
  // On a licence that is not full-bleed the page container is also
  // `max-w-7xl mx-auto`: the edge D556 docked to was that column's, 232px
  // short of a 2000px window, and a short page's panel ended above the footer.
  assert.match(read('frontend/src/App.jsx'), /\$\{fullWidthSurface \? '' : 'max-w-7xl mx-auto w-full'\}/, 'the cap this lifts moved; re-read it');
  const desk = CSS_CODE.slice(CSS_CODE.indexOf('@media (min-width: 1024px) {\n  .fwr-frame {'));
  const at = desk.indexOf('[data-app-main]:not(.edge-to-edge-surface):has(> .fwr-frame[data-rail="true"]) {');
  assert.ok(at >= 0, 'a container holding a docked frame no longer drops its cap');
  const holder = desk.slice(desk.indexOf('{', at) + 1, desk.indexOf('}', at));
  assert.match(holder, /max-width:\s*none/, 'the 1280px cap must go');
  assert.match(holder, /margin-left:\s*0;\s*margin-right:\s*0/, 'the centring must go');
  assert.match(holder, /flex:\s*1 0 auto/, 'the container must grow to the footer');
  assert.match(holder, /display:\s*flex;\s*flex-direction:\s*column/, 'the frame must be able to grow inside it');
  // ...and the frame grows with it, on the rule every docked frame has.
  const always = /\[data-app-main\]:not\(\.edge-to-edge-surface\) > \.fwr-frame\[data-rail="true"\] \{([^}]*)\}/.exec(CSS_CODE)[1];
  assert.match(always, /flex:\s*1 0 auto/, 'the frame must grow to the container\'s height');
  // The footer is what the container grows against: the last flex item of the scroll column, pushed down.
  assert.match(read('frontend/src/App.jsx'), /<footer className="mt-auto shrink-0/);
});

test('the shell\'s section strip moves into a docked frame, so the panel runs from the header', () => {
  const STRIP = el('nav', null, 'STRIP');
  const slot = (inFrame) => ({ strip: STRIP, inFrame, dock: () => {} });
  const framed = (value, rail = el('aside', null, 'RAIL')) => renderToStaticMarkup(
    el(RailStripSlot.Provider, { value }, el(RailFrame, { rail }, el('p', null, 'BODY'))),
  );
  // Held: the strip is the top of the body, and the shell has left its own out.
  assert.match(framed(slot(true)), /<div class="fwr-frame-main"><div class="fwr-frame-strip"><nav>STRIP<\/nav><\/div><p>BODY<\/p><\/div><div class="fwr-frame-rail"/);
  // Not held yet: the shell's copy is the one drawn, so the frame draws none.
  assert.doesNotMatch(framed(slot(false)), /STRIP/);
  // A frame with no rail docks nothing, so it takes no strip.
  assert.doesNotMatch(framed(slot(true), null), /STRIP/);
  // No strip in the shell: the frame is unchanged.
  assert.doesNotMatch(framed(null), /fwr-frame-strip/);

  // The frame says it holds the strip, and lets go when it unmounts.
  const frame = codeOnly(read('frontend/src/ui/RailFrame.jsx'));
  assert.match(frame, /const dock = rail && slot\?\.strip \? slot\.dock : null;/);
  assert.match(frame, /useLayoutEffect\(\(\) => \{\s*if \(!dock\) return undefined;\s*dock\(true\);\s*return \(\) => dock\(false\);\s*\}, \[dock\]\);/);
  // The shell draws its copy only while no frame holds it, and offers it to
  // every page below it.
  const app = codeOnly(read('frontend/src/App.jsx'));
  assert.match(app, /const railStrip = hqStrip \? \{ strip: hqStripNav, inFrame: stripInFrame, dock: setStripInFrame \} : null;/);
  const outer = app.indexOf('{stripInFrame ? null : hqStripNav}');
  const open = app.indexOf('<RailStripSlot.Provider value={railStrip}>');
  assert.ok(outer >= 0 && open > outer, 'the shell must draw its own copy above the page, only while no frame holds it');
  assert.match(app.slice(open), /^<RailStripSlot\.Provider value=\{railStrip\}>\s*<div key=\{[^}]*\} data-app-main[\s\S]*?\{children\}\s*<\/div>\s*<\/RailStripSlot\.Provider>/, 'the slot must wrap the page container');
  // In the frame it keeps its place: 12px under the header, the page's gap
  // below it, and none of its own padding or ground.
  assert.match(CSS_CODE, /\.fwr-frame-strip \{ margin: -4px 0 16px; \}/);
  assert.match(CSS_CODE, /\.fwr-frame-strip > nav \{ padding: 0; background: none; \}/);
  assert.match(CSS_CODE, /@media \(min-width: 768px\) \{\s*\.fwr-frame-strip \{ margin: -12px 0 24px; \}/);
  assert.match(read('frontend/src/components/HqSubNavStrip.jsx'), /className="px-4 md:px-6 pt-3 bg-gray-50 dark:bg-gray-950"/, 'the outer strip\'s padding moved; re-read the offsets');
});

test('the frame renders the body, then the rail column; with no rail, the body alone', () => {
  const withRail = renderToStaticMarkup(el(RailFrame, { rail: el('aside', null, 'RAIL'), 'data-testid': 'x' }, el('p', null, 'BODY')));
  assert.match(withRail, /^<div class="fwr-frame" data-rail="true" data-testid="x"><div class="fwr-frame-main"><p>BODY<\/p><\/div><div class="fwr-frame-rail" data-testid="worker-rail-frame"><div class="fwr-frame-dock"><aside>RAIL<\/aside><\/div><\/div><\/div>$/);
  const bare = renderToStaticMarkup(el(RailFrame, null, el('p', null, 'BODY')));
  assert.match(bare, /data-rail="false"/);
  assert.doesNotMatch(bare, /fwr-frame-rail/, 'no rail, no empty column');
});

test('the phone form still works: the column is hidden, never unmounted', () => {
  // The rail's floating button and sheet (D405) are portalled from inside the
  // component, so the component has to stay mounted below 1024px. The frame
  // hides its column in CSS and decides nothing in JavaScript.
  const frame = codeOnly(read('frontend/src/ui/RailFrame.jsx'));
  assert.doesNotMatch(frame, /matchMedia|innerWidth|window\./, 'the frame must not decide the breakpoint in JS');
  const base = CSS_CODE.slice(0, CSS_CODE.indexOf('@media (min-width: 1024px) {\n  .fwr-frame {'));
  assert.match(base, /\.fwr-frame-rail \{ display: none; \}/, 'below 1024px the column must be hidden');
  assert.match(read('frontend/src/ui/WorkerRail.jsx'), /createPortal\(/, 'the phone button is still portalled');
});

// --- Admin Studio ----------------------------------------------------------

const HQ_GLANCE = {
  tier: 'hq',
  branch: null,
  seats: { recorded: false, reason: 'Seat use is a subsidiary figure (U1).' },
  approvals: { recorded: false, reason: 'The lanes are a subsidiary\'s (U1).' },
  agreements: { recorded: false, reason: 'Agreements are the subsidiary\'s (U1).' },
  revenue: { recorded: false, reason: 'The share rate is a subsidiary term (U1).' },
  licence: { recorded: false, reason: 'No row names the licence (U1).' },
  programme: { recorded: false, reason: 'No cohort week is open.' },
  templates: { recorded: true, available: false, reason: 'The library could not be read.' },
  insights: { recorded: true, benchmarks_available: true, benchmarks: [] },
};
const BRANCH_GLANCE = {
  tier: 'branch',
  seats: {
    recorded: true,
    seats_used_by_type: { founder: 1, investor: 0, advisor: 0, partner: 0 },
    seats: { founder: 10, investor: 1, advisor: 1, partner: 1 },
  },
  approvals: { recorded: true, lanes: [{ key: 'kyc', label: 'KYC', count: 0, oldest_age_hours: null, sla: 'ok' }] },
  programme: { recorded: false, reason: 'No cohort week is open.' },
  agreements: { recorded: true, expiring: 0, window_days: 60 },
  revenue: { available: false, reason: 'The share rate could not be read.' },
  licence: { recorded: true, revenue_share_bps: 3500, status: 'active' },
  templates: { recorded: true, available: true, items: [{ slug: 'msa' }], pushed_at: '2026-09-01T00:00:00Z' },
  insights: { recorded: true, benchmarks_available: true, benchmarks: [] },
};
const hqUser = { role: 'admin', branch: null };
const branchUser = { role: 'admin', branch: { code: 'fr', name: 'France', status: 'active', territories: ['FR'] } };

test('the Studio rail says how each block of the glance answered, in the page\'s own words', () => {
  const branch = studioRailCoverage(glancesFromStudioGlance(BRANCH_GLANCE, branchUser));
  assert.ok(branch.includes('Seats: read'), branch.join(' | '));
  assert.ok(branch.includes('Approvals: read'), 'a measured empty queue is a read, not an absence');
  assert.ok(branch.includes('Programme clock: not recorded here'));
  assert.ok(branch.includes('Template library: read'));
  assert.ok(branch.includes('Share rate: could not be read'), 'an unreadable store must say so, not read as absent');
  // A tier's glance draws the lines it carries, and no line for one it does not.
  const hq = studioRailCoverage(glancesFromStudioGlance(HQ_GLANCE, hqUser));
  assert.ok(!hq.some((l) => l.startsWith('Seats')), `an HQ admin has no seat line: ${hq.join(' | ')}`);
  assert.ok(hq.includes('Template library: could not be read'), hq.join(' | '));
  assert.ok(hq.some((l) => l.startsWith('Accounts: ')) && hq.some((l) => l.startsWith('Insights: ')), hq.join(' | '));
  assert.deepEqual(studioRailCoverage(null), []);
});

test('the Studio rail renders as the "Studio" workspace, with a reason while it has no lines', () => {
  const ready = renderToStaticMarkup(el(StudioRail, { user: branchUser, glance: BRANCH_GLANCE }));
  assert.match(ready, /Worker AI · Studio/);
  assert.match(ready, /data-testid="admin-studio-rail"/);
  assert.match(ready, /Seats: read/, 'the glance did not reach the rail');
  const failed = renderToStaticMarkup(el(StudioRail, { user: hqUser, glance: UNAVAILABLE }));
  assert.match(failed, /The studio glance could not be read\./);
  assert.doesNotMatch(failed, /(Seats|Accounts|Approvals|Programme clock|Template library|Insights): /,
    'a glance that failed whole draws its one reason, not a line per block it never read');
  // In production the page passes no glance; the rail then shares the one
  // in-flight request the strip and the cards make, rather than a read of its own.
  const src = codeOnly(read('frontend/src/pages/admin/StudioRail.jsx'));
  assert.match(src, /loadStudioGlance\(\)/);
  assert.doesNotMatch(src, /\bapi\./, 'the rail must not make a read of its own');
});
