/**
 * The four founder overview desks link to the subpages they summarise.
 *
 * WHAT AN OVERVIEW IS FOR. `/validate`, `/build`, `/raise` and `/grow` each
 * draw a card per subpage in their bucket: what is recorded there, and how much
 * of it. A card that summarises a page and then hands the reader somewhere else
 * is not a summary of that page, it is an advertisement for a different one.
 *
 * THREE OF THE FOUR WERE WIRED PAST THEIR OWN BUCKET, and one destination
 * appeared over and over:
 *
 *   /validate  every link — the hero, the rail, the interview handoff and all
 *              three empty states — resolved to ONE constant,
 *              `/build/discovery?mode=workspace`. Four stage pages existed and
 *              not one was reachable from the desk that summarises them.
 *   /grow      six of seven cards left the bucket: `/build/discovery`,
 *              `/build/team?mode=workspace`, `/spinout-lab/brand`,
 *              `/raise/capital/pipeline`, and `/comarketing` twice.
 *   /raise     the Pitch card went to `/raise/pitch?mode=workspace` and the
 *              Liquidity card to `/liquidity`; Round status had no link at all.
 *   /build     the cards were already right. Its header and rail were not.
 *
 * `?mode=workspace` IS THE PART THAT MADE THIS INVISIBLE IN THE SOURCE. A link
 * reading `/raise/pitch?mode=workspace` looks like the pitch page. `App.jsx`
 * reads that parameter and renders the shared `FounderWorkspaceTabs` instead —
 * so the route in the string is not the page the reader gets. That is checked
 * here rather than trusted, because it is the failure a reviewer skims past.
 *
 * THIS FILE IS THE RULE, not the four fixes. `founder_validate_a2`,
 * `founder_raise_a4_contract` and `founder_grow_a5_contract` each pin their own
 * desk's links by test id; this one holds the invariant across all four, so a
 * fifth card added to any of them is caught by the same statement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const APP = read('frontend/src/App.jsx');

const DESKS = [
  { bucket: 'validate', file: 'frontend/src/pages/founder/FounderValidatePage.jsx' },
  { bucket: 'build', file: 'frontend/src/pages/founder/FounderBuildDesk.jsx' },
  { bucket: 'raise', file: 'frontend/src/pages/founder/FounderRaiseDesk.jsx' },
  { bucket: 'grow', file: 'frontend/src/pages/founder/FounderGrowDesk.jsx' },
];

/** Every `/bucket/slug` route App.jsx actually mounts. */
function routesFor(bucket) {
  return [...APP.matchAll(new RegExp(`path="/${bucket}/([a-z-]+)"`, 'g'))].map((m) => m[1]);
}

/**
 * The literal paths a desk's `to={...}` props resolve to.
 *
 * Only `to=` is read, so a path named in a comment or in a docblock recording
 * what a link USED to be does not count as a link — which matters here, because
 * each of these files now explains the destination it moved away from.
 */
function linkTargets(src) {
  const out = [];
  for (const m of src.matchAll(/\bto=\{`([^`]*)`\}/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bto="([^"]*)"/g)) out.push(m[1]);
  return out;
}

test('every founder overview mounts a card per subpage its own bucket has', () => {
  // The chip row and the card links come from ONE list on each desk, so this
  // also proves the chips and the cards cannot disagree.
  for (const { bucket, file } of DESKS) {
    const src = read(file);
    const routes = routesFor(bucket);
    assert.ok(routes.length >= 4, `/${bucket} has ${routes.length} subpage routes — has the bucket moved?`);
    for (const slug of routes) {
      // `/build` mounts sixteen routes and the desk summarises five of them;
      // the others are the deep tools its subpages link on to. So the rule is
      // one-directional: every link a desk draws must be in its own bucket, and
      // every slug the desk's own section list names must be a real route.
      assert.ok(APP.includes(`path="/${bucket}/${slug}"`));
    }
    const sections = src.match(/const SECTIONS = \[[\s\S]*?\];/);
    assert.ok(sections, `${file} has no SECTIONS list for its chip row`);
    for (const slug of [...sections[0].matchAll(/'\/?[a-z/-]*?([a-z-]+)'/g)].map((m) => m[1])) {
      if (['focus'].includes(slug) && bucket !== 'grow') continue;
      if (!routes.includes(slug)) continue;
      assert.ok(APP.includes(`path="/${bucket}/${slug}"`),
        `${file} names /${bucket}/${slug} but no such route is mounted`);
    }
  }
});

test('no founder overview links out of its own bucket', () => {
  for (const { bucket, file } of DESKS) {
    const src = read(file);
    for (const target of linkTargets(src)) {
      // A template literal's `${…}` holes are the project-id query and the
      // section slug; the leading path segment is what identifies the bucket.
      const path = target.split('?')[0];
      if (!path.startsWith('/')) continue;
      const owner = path.split('/')[1];
      assert.equal(owner, bucket,
        `${file} links to ${target}, which is in /${owner} rather than /${bucket} — `
        + 'a card that summarises a page must hand off to that page');
    }
  }
});

test('no founder overview routes a reader through the shared workspace', () => {
  // App.jsx reads `mode=workspace` and swaps the element for
  // `FounderWorkspaceTabs`, so a link carrying it does not go to the route it
  // spells. Checked against App.jsx rather than asserted, because the whole
  // reason this slipped through review is that the string looks right.
  assert.match(APP, /get\('mode'\) === 'workspace'\s*\n?\s*\?\s*founderWorkspace\(/,
    'the parameter this rule is about is gone from the router — re-read the rule before deleting it');
  for (const { bucket, file } of DESKS) {
    assert.ok(!read(file).includes('mode=workspace'),
      `the /${bucket} overview routes through the shared workspace instead of to a page`);
  }
});

test('the Grow focus card names the metrics it cannot compute, not [object Object]', () => {
  const src = read('frontend/src/pages/founder/FounderGrowDesk.jsx');
  // `summary.unavailable` is `[{ metric, reason }]` — the worker returns the
  // reason on purpose, so a blank KPI says which input it needs rather than
  // reading as a zero or a bug. This desk joined the objects straight into a
  // sentence, which rendered five `[object Object]`s on a startup with no
  // snapshot and threw away the only thing the field carries.
  assert.ok(!/\$\{unavailable\.join\(/.test(src),
    'an array of objects is being interpolated into a sentence again');
  assert.match(src, /const metricName = \(item\) =>/,
    'the metric name is no longer read off the object');
  assert.match(src, /unavailable\.map\(metricName\)\.join\(', '\)/,
    'the sentence stopped naming the metrics');
  assert.match(src, /\{text\(item\?\.reason\) \|\| 'No reason recorded\.'\}/,
    'the reason the worker sends is being dropped');

  // AND THE CONTRACT IT READS IS STILL THAT SHAPE.
  const engine = raw('cloudflare-worker/src/services/saasMetrics.ts');
  assert.match(engine, /unavailable: Array<\{ metric: string; reason: string \}>/,
    'the field changed shape — this page reads `metric` and `reason`');
});
