import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (path) => codeOnly(readFileSync(resolve(process.cwd(), path), 'utf8'));
const page = read('frontend/src/pages/founder/FounderGrowDesk.jsx');
const app = read('frontend/src/App.jsx');

test('A5 Grow is founder-owned and workspace mode preserves Talent', () => {
  assert.match(app, /const founderGrowLanding = effectiveRole === 'founder'[\s\S]*?get\('mode'\) !== 'workspace'/);
  const route = app.split('\n').find((line) => line.includes('path="/build/team"'));
  assert.match(route, /founderGrowLanding \? <FounderGrowDesk \/>/);
  assert.match(route, /FounderWorkspaceTabs set="grow"/);
});

test('A5 reads only documented sources and does not post investor matches', () => {
  for (const call of ['listMetricsSnapshots', 'metricsSummary', 'listWaitlistCustomers', 'brandGetLanding', 'brandListPages', 'brandListWaitlist', 'raiseProspects', 'listMyCoMarketingPitches']) assert.ok(page.includes(`api.${call}`));
  assert.ok(!page.includes('matchInvestors'));
  assert.match(page, /import \{ api, jobs as jobsApi \} from '\.\.\/\.\.\/lib\/api'/);
  assert.match(page, /jobsApi\.mine\(\)/);
  assert.doesNotMatch(page, /api\.jobs\./);
  assert.match(page, /list\(records\.customers, 'signups'\)/);
  assert.match(page, /list\(records\.jobs, 'jobs'\)/);
  assert.match(page, /list\(records\.brandWaitlist, 'signups'\)/);
  assert.match(page, /project_id.*projectId.*project_uid.*projectUid/s);
});

test('every card hands off to the Grow page it summarises, and none to another bucket', () => {
  // REVERSED, AND THE OLD LIST IS THE FINDING. This required exactly six
  // cross-bucket destinations — `/build/metrics`, `/build/discovery`,
  // `/build/team?mode=workspace`, `/spinout-lab/brand`,
  // `/raise/capital/pipeline` and `/comarketing` — on the reading that a
  // summary card should hand off to wherever that record is edited. Two
  // problems with it that the reading did not survive: the seven `/grow/*`
  // pages this desk summarises had been built, so the handoffs were pointing
  // past them; and `?mode=workspace` is read by `App.jsx` and renders the
  // shared `FounderWorkspaceTabs`, so that one was not even a page. A reader
  // could open the summary of their own Grow pages and reach none of them.
  //
  // The rule is now the one an overview needs: each card links to its own page,
  // and the targets come from `SECTIONS` so a slug cannot drift between the
  // chip row and the card beneath it.
  assert.match(page, /const GROW_PAGES = Object\.fromEntries\(SECTIONS\.map\(\(\[label, slug\]\) => \[slug, `\/grow\/\$\{slug\}`\]\)\);/,
    'the card targets are no longer derived from the section list the chips use');
  for (const slug of ['focus', 'customers', 'talent', 'brand', 'capital-match', 'partnerships', 'launch']) {
    assert.ok(new RegExp(`GROW_PAGES(\\.${slug.replace('-', '\\-')}|\\['${slug}'\\])`).test(page),
      `the ${slug} card does not link to /grow/${slug}`);
  }
  for (const gone of ['/build/metrics', '/build/discovery', '/build/team?mode=workspace',
    '/spinout-lab/brand', '/raise/capital/pipeline', '/comarketing']) {
    assert.ok(!codeOnly(page).includes(`to={\`${gone}`),
      `a Grow card still hands off to ${gone}, which is not a Grow page`);
  }
  assert.doesNotMatch(page, /mode=workspace/,
    'a card is routing through the shared workspace instead of to a page');
  // "Read-only source coverage" is A5's own stance line and stays here. The
  // boundary statement ("no automated actions") is the shared rail's default
  // footer now, so it is asserted against the component rather than pasted
  // into every desk — see founder_shell.test.mjs.
  assert.match(page, /<WorkerRail\b[\s\S]*?workspace="Grow"/,
    'A5 must mount the shared Worker AI rail');
  assert.match(page, /stance="Read-only source coverage"/);
});

test('A5 never turns canvas fixtures into product data or claims', () => {
  assert.doesNotMatch(page, /14 of 25|38 in play|61 leads|37%|Nadia Okonkwo|Latitude Seed|Thornbury Capital|Verwood Ventures|Mistral|FLUX|GPT-OSS|BGE-M3|DeepSeek|Llama|QwQ|Granite|\$14\.20|Accept sequence|Move to screen|Generate 4 more/i);
});