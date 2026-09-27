/**
 * D463 — the founder's investor update on /build/metrics, and the
 * partner/admin deal-flow page with a deal source.
 *
 * THE FOUNDER HALF. `POST /portfolio-updates` has always taken the owning
 * founder, but the only composer sat on `/portfolio/updates`, guarded
 * `['admin','investor']` — and the Portfolio workspace's Updates tab listed
 * the founder, leading straight into that refusal. Now: the guard admits the
 * founder, the tab's roles match it, the composer's project is PICKED rather
 * than typed as a raw id, and the canvas's home for the act — the Metrics
 * page the founder already keeps — carries the Investor update card over the
 * same store.
 *
 * THE DEAL-FLOW HALF. `GET /deals/stage-analytics` was served and unread; the
 * Deal Flow page renders it. `deals.source` (migration 336) is written at
 * draft and editable after, and `PUT /deals/:id` takes the terms it used to
 * freeze. The source taxonomy is the owner's call and is named as missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const METRICS = codeOnly(read('frontend/src/pages/MetricsPage.jsx'));
const UPDATES = codeOnly(read('frontend/src/pages/PortfolioUpdatesPage.jsx'));
const WORKSPACE = read('frontend/src/pages/PortfolioWorkspace.jsx');
const APP = read('frontend/src/App.jsx');
const DEALS = codeOnly(read('frontend/src/pages/DealsPage.jsx'));
const PIPELINE = codeOnly(read('frontend/src/pages/investor/deals/PipelineZone.jsx'));

test('the Metrics page composes the update over the existing store', () => {
  assert.match(METRICS, /api\.portfolioUpdateCreate\(\{/,
    'the Investor update card must post to the existing store');
  assert.match(METRICS, /project_id: projectId/, 'the update must attach to the project on the page');
  assert.match(METRICS, /status: send \? 'submitted' : 'draft'/,
    'submit and save-draft are the store’s two states');
  // The KPIs start from the latest snapshot on the page, so the update and
  // the metrics cannot disagree at birth.
  assert.match(METRICS, /mrr: latest\?\.mrr \?\? ''/, 'the composer no longer pre-fills from the snapshot');
  // And it reads back what the founder sent — the investor inbox’s own rows.
  assert.match(METRICS, /api\.portfolioUpdatesList\(\{ project_id: projectId \}\)/,
    'the card must list the project’s updates');
  // Named, not silently absent: the test copy and the send log need outbound
  // mail (Session 4's area).
  assert.match(METRICS, /test copy to yourself and a send log need outbound mail/,
    'the missing outbound mail is no longer named on screen');
});

test('a failed updates read is unreadable, never an empty sent list', () => {
  assert.match(METRICS, /That is not a claim that none exists\./,
    'a failed read must not render as "no updates"');
});

test('the /portfolio/updates guard and the tab agree, and the founder’s composer is on /build/metrics', () => {
  // The route is a zone of the portfolio shell, and the founder's shell has
  // no such zone — so the guard stays narrow and the tab matches it. The
  // founder's composer is the Investor update card on /build/metrics instead.
  const at = APP.indexOf('path="/portfolio/updates"');
  assert.ok(at > 0, 'the /portfolio/updates route is gone');
  const block = APP.slice(at, at + 300);
  assert.match(block, /guard\(\['admin', 'investor'\]/,
    'the guard must match the shells that have the zone');
  const tab = WORKSPACE.slice(WORKSPACE.indexOf("to: '/portfolio/updates'"));
  assert.match(tab, /roles: \['admin', 'investor'\]/,
    'the Updates tab’s roles drifted from the route’s guard');
  assert.ok(!tab.includes("'founder'"), 'the founder was re-offered a route their shell has no zone for');
});

test('the composer names the project rather than picking or typing it', () => {
  assert.match(UPDATES, /api\.listProjects\(\)/, 'the composer never loads the founder’s startups');
  assert.match(UPDATES, /data-testid="update-project-name"/, 'the composer must name the startup it posts for');
  assert.ok(!/placeholder="Startup ID"/.test(UPDATES), 'the raw-id field is back');
  // The in-body picker is the shape check-inline-project-pickers removed: one
  // company, one startup, so there is nothing to pick between.
  assert.ok(!/<select[^>]*form\.project_id/.test(UPDATES), 'an in-body startup picker is back');
});

test('the Deal Flow page reads the stage funnel and records the source', () => {
  assert.match(DEALS, /api\.dealStageAnalytics\(\)/, 'the stage-analytics read is gone');
  assert.match(DEALS, /data-testid="stage-analytics"/, 'the stage funnel panel is gone');
  // The source is recorded at draft and editable after. Sliced to the draft
  // modal specifically: the terms editor carries the same line, and a
  // file-wide match cannot tell which one stopped sending it (found by
  // mutation).
  const draft = DEALS.slice(DEALS.indexOf('function DraftDealModal'));
  assert.match(draft, /source: form\.source\.trim\(\) \|\| null/, 'the draft stopped sending the source');
  const editor = DEALS.slice(DEALS.indexOf('function DealTermsEditor'));
  assert.match(editor, /source: form\.source\.trim\(\) \|\| null/, 'the editor stopped sending the source');
  assert.match(DEALS, /api\.updateDeal\(deal\.id, \{/, 'the terms editor must write through the extended PUT');
  assert.match(DEALS, /data-testid="input-deal-source"/, 'the draft’s source field is gone');
  assert.match(DEALS, /data-testid="input-edit-source"/, 'the editor’s source field is gone');
  // And the source-quality sentence renders from the route, not a table
  // ranked by a definition nobody set.
  assert.match(DEALS, /stageAnalytics\.source_quality_unavailable/,
    'the source-quality note stopped rendering the route’s own sentence');
});

test('the Pipeline tile counts recorded sources and names the pending taxonomy', () => {
  assert.match(PIPELINE, /label="Source recorded"/, 'the fourth tile must count what the record carries');
  assert.match(PIPELINE, /live\.filter\(\(d\) => String\(d\.source \|\| ''\)\.trim\(\)\)/,
    'the tile stopped counting recorded sources');
  assert.ok(!/label="From the Lab"/.test(PIPELINE),
    'a tile named for the Lab counts a vocabulary nobody has decided');
});
