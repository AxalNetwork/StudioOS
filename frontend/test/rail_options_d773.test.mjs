// D773 (#2099), PR 1 — the advisor's and the operating partner's options
// inventories, held equal to the code both ways.
//
// Every listed option names a board from the canvas, a key, one of the canvas's
// fourteen kinds and a handler, and its `source` string is in its file, which is
// one of its board's files. And every control on those boards that runs a model
// — a `ZoneDraft` band, a file input, or a call to a model endpoint — is listed
// for its board. Every board draws a rail.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADVISOR_RAIL_OPTIONS } from '../src/lib/railOptions/advisor.js';
import { PARTNER_RAIL_OPTIONS } from '../src/lib/railOptions/partner.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const canvas = JSON.parse(readFileSync(new URL('../../design/incoming/airail-every-page-data/canvas.json', import.meta.url), 'utf8'));
const KINDS = new Set(Object.values(canvas.task_kind));
const HANDLERS = new Set(['form', 'upload', 'draft', 'transcribe', 'none']);
const pagesOf = (profile) => Object.entries(canvas.profiles[profile]).flatMap(([section, subs]) => [section, ...subs]);

const HOME_INTERVIEW = ['components/advisor/StudioInterview.jsx', 'components/advisor/PersonalAdvisor.jsx'];
const RESEARCH = {
  Ask: ['pages/research/AskZone.jsx'],
  'Client prep': ['pages/research/ClientPrepZone.jsx'],
  Library: ['pages/research/LibraryZone.jsx'],
};
const ROOT = (file) => [file, 'workspaces/BucketBoard.jsx'];

/** Each canvas board, and the files that draw it (followed through to the component that holds its controls). */
const BOARDS = {
  Advisor: {
    Home: ['pages/advisor/AdvisorStudioHome.jsx', ...HOME_INTERVIEW],
    Practice: ROOT('workspaces/boards/advisorPractice.js'),
    Opportunities: ['pages/advisor/practice/OpportunitiesZone.jsx'],
    Engagements: ['pages/advisor/practice/EngagementsZone.jsx'],
    Delivery: ['pages/advisor/practice/DeliveryZone.jsx'],
    Sessions: ['pages/advisor/practice/SessionsZone.jsx'],
    Earnings: ['pages/advisor/practice/EarningsZone.jsx'],
    Cohorts: ['workspaces/BucketOverview.jsx'],
    Founders: ['pages/advisor/cohorts/FoundersZone.jsx'],
    Guidance: ['pages/advisor/cohorts/GuidanceZone.jsx'],
    'This week': ['pages/advisor/cohorts/ThisWeekZone.jsx'],
    Calendar: ['pages/advisor/cohorts/CalendarZone.jsx'],
    Outcomes: ['pages/advisor/cohorts/OutcomesZone.jsx'],
    Expertise: ROOT('workspaces/boards/advisorExpertise.js'),
    Profile: ['pages/advisor/expertise/ProfileZone.jsx'],
    Services: ['pages/advisor/expertise/ServicesZone.jsx'],
    Proof: ['pages/advisor/expertise/ProofZone.jsx'],
    Thinking: ['pages/advisor/expertise/ThinkingZone.jsx'],
    Visibility: ['workspaces/NoStoreYet.jsx'],
    Network: ROOT('workspaces/boards/network.js'),
    Relationships: ['pages/advisor/network/RelationshipsZone.jsx', 'components/RelationshipRequests.jsx'],
    Introductions: ['pages/advisor/network/IntroductionsZone.jsx'],
    Organizations: ['pages/advisor/network/OrganizationsZone.jsx'],
    Research: [...ROOT('workspaces/boards/research.js'), 'pages/research/ResearchOverviewPanel.jsx'],
    ...RESEARCH,
    Markets: ['pages/research/MarketDirectoryZone.jsx'],
    Companies: ['pages/research/CompanyDirectoryZone.jsx', 'components/CompetitorAnalysis.jsx'],
  },
  'Operating Partner': {
    Home: ['pages/partner/PartnerStudioHome.jsx', 'pages/partner/PartnerHomeP2.jsx', ...HOME_INTERVIEW],
    Pipeline: ROOT('workspaces/boards/partnerPipeline.js'),
    Leads: ['pages/partner/pipeline/LeadsZone.jsx'],
    Proposals: ['pages/partner/pipeline/ProposalsZone.jsx'],
    Negotiations: ['pages/partner/pipeline/NegotiationsZone.jsx'],
    Retainers: ['pages/partner/pipeline/RetainersZone.jsx'],
    Analytics: ['pages/partner/pipeline/AnalyticsZone.jsx'],
    Delivery: ROOT('workspaces/boards/partnerDelivery.js'),
    Engagements: ['pages/partner/delivery/BoardZone.jsx'],
    Deliverables: ['pages/partner/delivery/DeliverablesZone.jsx'],
    Capacity: ['pages/partner/delivery/CapacityZone.jsx'],
    Reporting: ['pages/partner/delivery/StatusReportsZone.jsx'],
    Health: ['pages/partner/delivery/HealthZone.jsx'],
    Offers: ROOT('workspaces/boards/partnerOffers.js'),
    Catalog: ['pages/ServiceCatalogPage.jsx'],
    'Perk deals': ['pages/PerksPage.jsx'],
    Visibility: ['pages/partner/offers/VisibilityZone.jsx'],
    Proof: ['pages/partner/offers/ProofZone.jsx'],
    'Audience fit': ['pages/partner/offers/AudienceFitZone.jsx'],
    Network: ROOT('workspaces/boards/network.js'),
    Relationships: ['pages/NetworkPage.jsx', 'pages/RelationshipsPage.jsx', 'components/RelationshipRequests.jsx'],
    Introductions: ['pages/NetworkPage.jsx', 'pages/IntroductionsPanel.jsx'],
    Organizations: ['pages/partner/OrganizationsZone.jsx'],
    Research: [...ROOT('workspaces/boards/research.js'), 'pages/research/ResearchOverviewPanel.jsx'],
    ...RESEARCH,
    Market: ['pages/research/MarketDirectoryZone.jsx'],
  },
};
const INVENTORY = { Advisor: ADVISOR_RAIL_OPTIONS, 'Operating Partner': PARTNER_RAIL_OPTIONS };

/** The model-running controls a board's files hold, each as the marker its option must cite. */
const MODEL_CALL = /\bapi\.(?:research\.(?:ask|reindex)|aiWorkspaceExplain|competitors\.(?:analyze|rerun|refresh)|advisor\.(?:transcribe|toolAuto))\(/g;
function controlsIn(file) {
  const s = src(file);
  const found = new Set();
  for (const m of s.matchAll(/<ZoneDraft\b[^>]*?\ssurface="([^"]+)"/g)) found.add(`surface="${m[1]}"`);
  if (/<ZoneDraft\b/.test(s)) {
    const bands = [...s.matchAll(/<ZoneDraft\b/g)].length;
    assert.equal([...s.matchAll(/<ZoneDraft\b[^>]*?\ssurface="[^"]+"/g)].length, bands, `${file}: every ZoneDraft names its surface as a literal`);
  }
  if (/type="file"/.test(s)) found.add('type="file"');
  for (const m of s.matchAll(MODEL_CALL)) found.add(m[0]);
  if (/onExplain=\{\(\) => openTutor\(/.test(s)) found.add('onExplain={() => openTutor(');
  return found;
}

for (const profile of ['Advisor', 'Operating Partner']) {
  const options = INVENTORY[profile];
  const boards = BOARDS[profile];

  test(`D773 ${profile}: the board map is the canvas's pages, and every board file exists`, () => {
    assert.deepEqual(Object.keys(boards).sort(), pagesOf(profile).sort());
    for (const files of Object.values(boards)) for (const f of files) assert.ok(src(f).length > 0, f);
  });

  test(`D773 ${profile}: every listed option is well formed and exists in its board's code`, () => {
    const seen = new Set();
    for (const o of options) {
      const id = `${o.page} ${o.key}`;
      assert.ok(boards[o.page], `${id}: a canvas page`);
      assert.match(o.key, /^[a-z]+:[a-z-]+$/, `${id}: <verb>:<object>`);
      assert.ok(!seen.has(id), `${id}: unique per page`);
      seen.add(id);
      assert.ok(typeof o.label === 'string' && o.label.length > 0, `${id}: a label`);
      assert.ok(KINDS.has(o.kind), `${id}: kind ${o.kind} is one of the canvas's fourteen`);
      assert.ok(HANDLERS.has(o.handler), `${id}: handler`);
      assert.ok(boards[o.page].includes(o.source.file), `${id}: its file draws its board`);
      assert.ok(src(o.source.file).includes(o.source.marker), `${id}: ${o.source.marker} is in ${o.source.file}`);
    }
  });

  test(`D773 ${profile}: every model-running control on a board is listed for that board`, () => {
    for (const [page, files] of Object.entries(boards)) {
      const listed = new Set(options.filter((o) => o.page === page).map((o) => o.source.marker));
      for (const f of files) {
        for (const marker of controlsIn(f)) assert.ok(listed.has(marker), `${profile} · ${page}: ${marker} in ${f} is not in the inventory`);
      }
    }
  });
}

test('D773: a draft band is a draft, a file input an upload, a voice answer a transcription', () => {
  for (const o of [...ADVISOR_RAIL_OPTIONS, ...PARTNER_RAIL_OPTIONS]) {
    if (o.source.marker.startsWith('surface=')) assert.equal(o.handler, 'draft', `${o.page} ${o.key}`);
    if (o.source.marker === 'type="file"') assert.equal(o.handler, 'upload', `${o.page} ${o.key}`);
    if (o.source.marker === 'api.advisor.transcribe(') assert.equal(o.handler, 'transcribe', `${o.page} ${o.key}`);
  }
});

test('D773: every board draws a rail', () => {
  // The bucket routes give each zone and root WorkspaceShell's rail slot.
  for (const f of ['workspaces/advisor/AdvisorBucketRoutes.jsx', 'workspaces/partner/PartnerBucketRoutes.jsx', 'workspaces/NetworkWorkspace.jsx', 'workspaces/ResearchWorkspace.jsx']) {
    assert.match(src(f), /<WorkspaceShell[\s\S]*?\brail=\{[\s\S]*?<WorkerRail\b/, f);
  }
  assert.match(src('workspaces/WorkspaceShell.jsx'), /<RailFrame\b/);
  // Home draws its own.
  for (const f of ['pages/advisor/AdvisorStudioHome.jsx', 'pages/partner/PartnerHomeP2.jsx']) {
    const s = src(f);
    assert.match(s, /<RailFrame\s+rail=\{\(\s*<WorkerRail\b/, f);
  }
});
