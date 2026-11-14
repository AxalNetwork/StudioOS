/**
 * #6152 — the Deals bucket says what renders, and the invitation answers it renders still work.
 *
 *   · every Deals zone the shell config lists has its own file in `ZONES`, so InvestorDealsRoutes has no
 *     fall-through to the old workspace;
 *   · accepting an invitation is the deal room's "I'm interested", which sends `interested` after its dialog;
 *   · answering one `passed` is the old invitation queue's Pass, reached only on `/pipeline` by a session
 *     browsing as an investor that holds neither the Investor nor the Operating Partner licence.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_cleanup_6152.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm } from './_form_d695.mjs';
import { bucketForPath } from '../src/workspaces/shellConfig.js';
import { RespondDialog } from '../src/pages/deal/DealFrame.jsx';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ROUTES = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));

// Mutation checked: a zone added to the shell config without a file (fails); the fall-through restored (fails).
test('#6152 every Deals zone has its own file, and the routes never fall through to the old workspace', () => {
  const bucket = bucketForPath('investor', '/deals');
  const slugs = bucket.zones.map((z) => z.slug);
  const zones = ROUTES.slice(ROUTES.indexOf('const ZONES = {'), ROUTES.indexOf('};', ROUTES.indexOf('const ZONES = {')));
  for (const slug of slugs) assert.match(zones, new RegExp(`\\b${slug}: lazy\\(`), `${slug} has no file`);
  assert.doesNotMatch(ROUTES, /InvestorDealsWorkspace/);
  assert.match(ROUTES, /: Zone && !isRoot\s*\? <Zone \/>\s*: <DealsRoot search=\{location\.search\} \/>\}/);
});

test('#6152 the text that described the old workspace now matches what renders', () => {
  const readme = read('frontend/src/pages/investor/deals/README.md');
  assert.doesNotMatch(readme, /draws only the\s+deal-invitation queue/);
  assert.doesNotMatch(readme, /all four sections stack/);
  assert.match(readme, /The bucket root `\/deals` is My Deal Flow/);
  const app = read('frontend/src/App.jsx');
  assert.doesNotMatch(app, /workspace still renders all four sections and the route scrolls/);
});

// Mutation checked: the confirm sending another answer (fails); the dialog sending before its confirm (fails).
test('#6152 accept: the deal room asks first, then sends `interested`', async () => {
  const sent = [];
  const s = await mountForm(h(RespondDialog, { answer: 'interested', onConfirm: async (a) => { sent.push(a); }, onClose() {} }), { modal: true });
  try {
    assert.match(s.text(), /Tell the founder you’re interested\?/);
    assert.deepEqual(sent, [], 'nothing is sent before the confirm');
    await s.click('I’m interested');
    assert.deepEqual(sent, ['interested']);
  } finally { await s.unmount(); }
  const room = codeOnly(read('frontend/src/pages/DealRoomPage.jsx'));
  assert.match(room, /const respond = async \(response\) => \{\s*await api\.respondDealInvitation\(dealId, response\);/);
  assert.match(room, /<RespondDialog answer=\{respondTo\} onConfirm=\{respond\}/);
  assert.match(room, /<StageTrack track=\{track\} onRetry=\{loadStage\} onRespond=\{setRespondTo\} \/>/);
  const frame = codeOnly(read('frontend/src/pages/deal/DealFrame.jsx'));
  assert.match(frame, /next\.kind === 'respond_interest'[\s\S]{0,200}onRespond\?\.\('interested'\)/);
});

// Mutation checked: the /pipeline arm dropped from the page's deals routes (fails); Pass sending `declined`, which the
// Worker refuses (fails).
test('#6152 decline: the old queue answers `passed`, on the one route that still reaches it', () => {
  const queue = codeOnly(read('frontend/src/pages/investor/InvestorDealsWorkspace.jsx'));
  assert.match(queue, /await api\.respondDealInvitation\(invitation\.deal_id, response\);/);
  assert.match(queue, /onClick=\{\(\) => respond\(invitation, 'passed'\)\}/);
  assert.match(queue, /onClick=\{\(\) => respond\(invitation, 'interested'\)\}/);
  const worker = read('cloudflare-worker/src/routes/deals.ts');
  assert.match(worker, /if \(resp !== 'interested' && resp !== 'passed'\)/, 'the two answers are the Worker’s');
  const page = codeOnly(read('frontend/src/pages/investor/InvestorWorkspacePage.jsx'));
  assert.match(page, /pathname === '\/pipeline'\s*\n/);
  assert.match(page, /if \(ownsDealsRoute\) return \([\s\S]{0,200}<InvestorDealsWorkspace \/>/);
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/pipeline" element=\{guard\(\['admin', 'founder', 'partner', 'investor'\], holds\('partner'\) \? <PartnerBucketRoutes \/> : holds\('investor'\) \? <DealsPipelineRedirect countAs="\/pipeline" \/> : investorWorkspace\('deals', <PipelineWorkspace \/>\)\)\} \/>/);
});
