import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { escapeRe } from './_escapeRe.mjs';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('frontend/src/App.jsx');
const page = read('frontend/src/pages/founder/FounderValidatePage.jsx');
const styles = read('frontend/src/pages/founder/founderValidate.css');

test('founder active role owns the A2 Validate landing page', () => {
  // D422. `/build/discovery` was a second address for this desk: a founder
  // there got FounderValidatePage, the same element `/validate` mounts. It
  // redirects to `/validate` now, query and all, and the desk is `/validate`'s
  // alone. Every other licence keeps DiscoveryPage at the old path.
  const route = app.slice(app.indexOf('<Route path="/build/discovery"'), app.indexOf('/>)} />', app.indexOf('<Route path="/build/discovery"')) + 7);
  assert.match(route, /effectiveRole !== 'founder'\s*\? <DiscoveryPage \/>/, 'another licence lost DiscoveryPage');
  assert.match(route, /: <Navigate to=\{`\/validate\$\{location\.search\}`\} replace \/>/,
    'a founder on the bare path is not redirected to /validate with the query kept');
  assert.ok(!route.includes('<FounderValidatePage />'), '/build/discovery is a second address for the desk again');
  assert.match(app, /<Route path="\/validate" element=\{founderValidateLanding\s*\? guard\([^)]*\), <FounderValidatePage \/>\)/);
});

test('A2 renders every requested evidence surface', () => {
  for (const copy of [
    'Prove someone wants this',
    'Interview library',
    'Pain map',
    'Hypotheses',
    'Validation summary',
  ]) assert.match(page, new RegExp(copy));
  // The rail's own words moved into ui/WorkerRail.jsx when the
  // thirty-nine hand-built copies were replaced by one component. What A2 owns
  // is the MOUNT and the workspace it names; the "Worker AI · " prefix, the
  // four blocks and the guardrail are the shared component's, asserted once in
  // founder_shell.test.mjs for all six desks at the same time.
  assert.match(page, /<WorkerRail\b[\s\S]*?workspace="Validate"/,
    'A2 must mount the shared Worker AI rail');
});

test('A2 uses live discovery sources and retains the detailed editor', () => {
  for (const source of ['listProjects', 'listInterviews', 'getProgressSignals', 'painGroups']) {
    assert.match(page, new RegExp(source));
  }
  // THE EDITOR LEFT THE DESK (D422) and is mounted at the route: a founder's
  // `?mode=workspace` or Discovery `?tab=` still opens DiscoveryPage on its
  // interviews tab, in workspace mode — nothing a founder could reach is lost.
  assert.ok(!/DiscoveryPage/.test(page.replace(/\/\/.*$/gm, '')), 'the desk embeds the Discovery editor again');
  assert.match(app, /founderDiscoveryEditor\s*\? founderWorkspace\('validate', <DiscoveryPage initialTab="interviews" workspaceMode \/>\)/,
    'the founder Discovery editor is no longer reachable');
  assert.match(app, /\['leads', 'interviews', 'insights'\]\.includes\(new URLSearchParams\(location\.search\)\.get\('tab'\)\)/,
    'a Discovery ?tab= deep link no longer opens the editor');
  // WAS `to={detailLink} state={workspaceNavigationState}`, AND `detailLink`
  // WAS THE PROBLEM. It was one constant — `/build/discovery?mode=workspace` —
  // behind EVERY link on this page: the hero button, the rail action, the
  // interview handoff and all three empty states. So the desk that summarises
  // the four evidence stages sent a reader to the same place from all of them,
  // that place was in another bucket, and `?mode=workspace` meant `App.jsx`
  // rendered the shared workspace rather than a page. None of
  // `/validate/interviews`, `/validate/pain-map`, `/validate/hypotheses` or
  // `/validate/verdict` was reachable from the summary of them.
  //
  // The seeded handoff this line existed to protect is intact — the state is
  // still passed — and the destinations are now the four stages, taken from
  // the same `SECTIONS` list the chip row uses.
  assert.match(page, /const stage = Object\.fromEntries\(SECTIONS\.map\(/,
    'the stage links are no longer derived from the section list the chips use');
  for (const [testid, path] of [
    ['link-open-discovery-workspace', 'stageLinks.interviews'],
    ['link-manage-interviews', 'stageLinks.interviews'],
    ['link-open-pain-map', 'stageLinks.pains'],
    ['link-open-hypotheses', 'stageLinks.hypotheses'],
    ['link-open-verdict', 'stageLinks.verdict'],
    ['link-rail-open-workspace', 'stageLinks.interviews'],
  ]) {
    const link = page.match(new RegExp(`testid="${escapeRe(testid)}"[^>]*?to=\\{([^}]*)\\}`));
    assert.ok(link, `the ${testid} link is gone from the Validate desk`);
    assert.equal(link[1].trim(), path, `${testid} points at ${link[1]}, not ${path}`);
  }
  assert.doesNotMatch(page, /mode=workspace[^'"`]*"/,
    'a Validate card is routing through the shared workspace instead of to a stage page');
  assert.ok(!page.includes('detailLink'), 'the one-destination constant is back');
  assert.match(page, /state=\{workspaceNavigationState\}/,
    'the seeded handoff must survive the retarget');
  assert.match(page, /founderValidateSeed/);
  assert.match(page, /setReloadKey\(\(value\) => value \+ 1\)/);
});

test('A2 does not ship canvas sample evidence, companies, models, or costs', () => {
  for (const sample of [
    'Priya',
    'Dev Raman',
    'Sara Lindqvist',
    'Tobias',
    'Verwood',
    'HandOff opacity',
    'Tool sprawl',
    'Status theatre',
    'Procurement drag',
    'Whisper',
    'Llama',
    'BGE-M3',
  ]) assert.doesNotMatch(page, new RegExp(sample, 'i'));
});

test('A2 preserves its composition across responsive and dark layouts', () => {
  assert.match(styles, /\.dark \.validate-desk/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /@media\(max-width:680px\)/);
});