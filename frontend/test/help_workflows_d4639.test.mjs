// D4639: the new workflow guides must be reachable, role-scoped, discoverable and source-grounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, filterSectionsForRole, buildSearchIndex } from '../src/pages/docs/sections/index.js';
import { GUIDE_PLACEMENT } from '../src/pages/docs/guidePlacement.js';
import { buildDocsRecords } from '../src/lib/docs/search.js';
const app=readFileSync(new URL('../src/App.jsx', import.meta.url),'utf8');
const workflow=SECTIONS.find(s=>s.id==='workflows');
const map=Object.fromEntries((workflow?.subsections||[]).map(g=>[g.id,g]));

test('eight documented workflows are registered, placed, and indexed',()=>{
  assert.ok(workflow);
  const ids=['research','email','record-discovery','introductions','build-week','grow','connector-recovery','connected-assistants'];
  assert.deepEqual(Object.keys(map),ids);
  for(const id of ids) {
    assert.ok(GUIDE_PLACEMENT[`workflows/${id}`],id);
    assert.ok(buildDocsRecords('founder').some(r=>r.anchor===`workflows/${id}`),id);
    const g=map[id];
    assert.ok(g.howto.length>=4,id+' needs a task and recovery procedure');
    assert.ok(g.howto.some(s=>s.includes('Outcome:')),id+' needs a recorded task outcome');
    assert.ok(g.pitfalls.length>0,id+' needs a recovery/limitation');
  }
});

test('role-specific research, email, Validate and Grow guides do not broaden permissions',()=>{
  const visible=role=>new Set(filterSectionsForRole(SECTIONS,role).flatMap(s=>s.subsections.map(g=>`${s.id}/${g.id}`)));
  assert.ok(visible('founder').has('workflows/research'));
  assert.ok(visible('investor').has('workflows/email'));
  assert.ok(!visible('investor').has('workflows/record-discovery'));
  assert.ok(!visible('exploring').has('workflows/research'));
  assert.ok(visible('exploring').has('workflows/email'));
  assert.ok(!visible('partner').has('workflows/build-week'));
});

test('task entry routes match mounted current code',()=>{
  for(const p of ['/research/ask','/research/markets','/research/geographies','/research/companies','/research/funds','/research/library','/email','/validate/record','/validate/inbox','/network/introductions','/build/this-week','/build/board','/build/roadmap','/build/cadence','/build/kpi','/grow/focus','/grow/talent','/grow/customers','/grow/partnerships','/grow/launch']){
    assert.ok(app.includes(`path="${p}"`),p+' missing route');
  }
});

test('guide steps distinguish the source of a saved answer and an uncertain send', () => {
  const research = map.research.howto.join(' ');
  const email = map.email.howto.join(' ');
  assert.match(research, /Keep.*Saved answers in Ask/);
  assert.match(research, /underlying documents.*research\/library/);
  assert.match(map.research.pitfalls.join(' '), /unreadable/);
  assert.ok(email.includes('Not confirmed, check the sending provider’s Sent folder first.'));
  assert.ok(email.includes('Only when you know the outcome, choose It arrived or It did not arrive.'));
  assert.ok(email.includes('If still uncertain, leave it unresolved and contact support before attempting a new send.'));
  assert.match(map['record-discovery'].howto.join(' '), /consent/);
  assert.match(map.introductions.howto.join(' '), /NDA/);
  assert.match(map['connected-assistants'].howto.join(' '), /Revoke/);
});

test('each role can open its workflow starting point and its related guides', () => {
  const starts = {
    research: '/research/ask',
    email: '/email',
    'record-discovery': '/validate/record',
    introductions: '/network/introductions',
    'build-week': '/build/this-week',
    grow: '/grow/focus',
    'connector-recovery': '/account/connectors',
    'connected-assistants': '/account/builder',
  };
  for (const [id, surface] of Object.entries(starts)) {
    const guide = map[id];
    assert.equal(GUIDE_PLACEMENT[`workflows/${id}`].surface, surface);
    assert.ok(guide.related.some(link => link.href === '#troubleshooting/contact-support'), id);
    for (const role of guide.roles) {
      const visible = filterSectionsForRole(SECTIONS, role);
      for (const link of guide.related) {
        const [section, destination] = link.href.slice(1).split('/');
        assert.ok(visible.find(item => item.id === section)?.subsections.some(sub => sub.id === destination),
          `${id}: ${role} cannot follow ${link.href}`);
      }
    }
  }
});

test('connector recovery maps each failure to a distinct action and both indexes include it', () => {
  const rows = map['connector-recovery'].recoveryRows;
  const actions = Object.fromEntries(rows.map(row => [row.status, row.action]));
  assert.match(actions['Sign-in expired'], /Reconnect/);
  assert.match(actions['Daily limit reached'], /reset/);
  assert.match(actions['Last sync failed'], /Sync now/);
  assert.match(actions.Paused, /settings/);
  assert.match(actions['Company required or wrong company'], /authorized companies/);
  assert.match(actions['Permission refused'], /administrator/);
  for (const index of [buildSearchIndex(), buildDocsRecords('founder')]) {
    const guide = index.find(row => row.anchor === 'workflows/connector-recovery');
    for (const { status, action } of rows) {
      assert.ok(guide.text.includes(status), status);
      assert.ok(guide.text.includes(action), status);
    }
  }
});

// D4639 part 2, reconciled with #7549: prerequisites stay in Before you start, main's newer
// Build and Grow steps survive, and every label a step quotes is one the cited source draws.
test('priority guides keep Before you start and main’s newer steps', () => {
  for (const id of ['research', 'email', 'record-discovery', 'introductions', 'build-week']) {
    assert.ok(Array.isArray(map[id].beforeYouStart) && map[id].beforeYouStart.length > 0, id);
    assert.doesNotMatch(map[id].howto[0], /^(Sign in|Choose the correct venture)/, `${id}: a prerequisite belongs in Before you start`);
  }
  const build = map['build-week'].howto.join(' ');
  assert.match(build, /\/build\/solution-design and choose Remove feature/);
  assert.match(build, /\/build\/prototype-mvp and choose No longer a must-have/);
  const grow = map.grow.howto.join(' ');
  assert.match(grow, /Needs your attention/);
  assert.match(grow, /Print or save as PDF/);
});

test('every quoted label appears in the source that draws it', () => {
  const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const labels = {
    research: [['frontend/src/pages/research/AskZone.jsx', ['Sources cited', 'Retrieved, not cited', 'Open passage', 'Kept', 'Copy with citations']], ['frontend/src/pages/research/researchStates.js', ['Saved answers']]],
    email: [['frontend/src/pages/email/EmailPage.jsx', ['Email settings', 'Share your email address', 'Yes, share it', 'Stop sharing', 'What Eadwyn knows', 'Open draft']], ['frontend/src/pages/email/EmailSettings.jsx', ['Mailboxes', 'Check again', 'Sent log']], ['frontend/src/pages/email/ComposeSheet.jsx', ['Send now', 'What is it for']], ['frontend/src/pages/email/SendUncertain.jsx', ['Not confirmed', 'It arrived', 'It did not arrive']]],
    'record-discovery': [['frontend/src/pages/founder/InterviewSessionPage.jsx', ['Said yes, out loud', 'Start recording', 'Resume here']], ['frontend/src/pages/founder/InterviewReview.jsx', ['Heard in', 'Save and accept', 'Discard']], ['frontend/src/pages/founder/SessionLifecycle.jsx', ['Try again with a new session']], ['frontend/src/pages/cycles/ValidateSections.jsx', ['Assign to a theme', 'Link to a pain']], ['frontend/src/pages/cycles/verdictForm.js', ['Record a decision', 'Evidence it rests on']]],
    introductions: [['frontend/src/pages/relationships/WhoKnowsStrip.jsx', ['Send request']], ['frontend/src/pages/relationships/relationshipsModel.js', ['Who knows them', 'Asked of you', 'Not now', 'Write the intro', 'Update the record']], ['frontend/src/pages/relationships/IntroductionsDesk.jsx', ['Withdraw']], ['frontend/src/pages/deal/DealWorkTabs.jsx', ['Send it for signature', 'Review and sign']]],
    'build-week': [['frontend/src/pages/founder/FounderBuildThisWeek.jsx', ['Selected startup', 'Current commitment records', 'Commitment history']], ['frontend/src/pages/founder/BoardDialogs.jsx', ['Bulk move', 'Blocked']], ['frontend/src/pages/founder/FounderBuildRoadmap.jsx', ['Edit dependency links']], ['frontend/src/pages/founder/CadenceDialogs.jsx', ['File a review', 'File review']], ['frontend/src/pages/founder/FounderBuildCadence.jsx', ['Review archive']], ['frontend/src/pages/founder/KpiDialogs.jsx', ['Import CSV', 'Check the file']], ['frontend/src/pages/founder/FounderBuildKpi.jsx', ['Snapshot history', 'Enter a month']], ['cloudflare-worker/src/services/records/build.ts', ['Remove feature', 'No longer a must-have', 'Remove from must-haves']]],
    grow: [['frontend/src/pages/cycles/GrowOverview.jsx', ['Needs your attention', 'Share an update']], ['cloudflare-worker/src/services/growAttention.ts', ['Set focus metric', 'Record the first value', 'Review growth']], ['frontend/src/pages/founder/FounderGrowFocus.jsx', ['Set target', 'Focus metric', 'Set focus', 'Clear focus']], ['frontend/src/pages/founder/FounderGrowTalent.jsx', ['Manage applicants', 'Open roster and hiring plan']], ['frontend/src/pages/founder/FounderGrowCustomers.jsx', ['Open customer discovery']], ['frontend/src/pages/cycles/PartnershipsCoMarketing.jsx', ['Delivered so far']], ['frontend/src/pages/founder/FounderGrowLaunch.jsx', ['Open calendar', 'Open co-marketing workspace']], ['frontend/src/pages/cycles/reporting/printing/ReportPrintButton.jsx', ['Print or save as PDF']]],
    'connected-assistants': [['frontend/src/pages/account/builder/McpServicesPage.jsx', ['Nothing to approve yet', 'Who can call for you', 'Try again']]],
  };
  for (const [id, sources] of Object.entries(labels)) {
    const text = map[id].howto.join(' ');
    for (const [file, words] of sources) {
      const code = src(file);
      for (const w of words) {
        assert.ok(text.includes(w), `${id}: the guide no longer quotes ${w}`);
        assert.ok(code.includes(w), `${id}: ${file} no longer draws ${w}`);
      }
    }
  }
});

test('connector recovery lists and draws its status table, and Grow states who sees /grow', async () => {
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router-dom');
  const { guideOutline } = await import('../src/pages/docs/v2/helpV2.js');
  const { HelpArticle } = await import('../src/pages/docs/DocsLayout.jsx');
  const sub = map['connector-recovery'];
  assert.ok(sub.recoveryRows.length >= 6, 'the status-to-action table keeps its rows');
  assert.ok(guideOutline(sub).some((o) => o.id === 'recovery' && o.label === 'Connector recovery'));
  assert.ok(!guideOutline(map.email).some((o) => o.id === 'recovery'), 'a guide without rows lists no table');
  const sections = filterSectionsForRole(SECTIONS, 'founder');
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(HelpArticle, { sections, area: 'workflows', guide: 'connector-recovery', user: { role: 'founder' }, onOpenTicket: () => {} })));
  assert.match(out, /<table id="recovery"/);
  for (const { status } of sub.recoveryRows) assert.ok(out.includes(`>${status}</th>`), `the table draws ${status}`);
  // The Grow overview needs the founder role; anyone else is sent to /grow/focus (App.jsx).
  assert.match(app, /const founderGrowLanding = holds\('founder'\)/);
  assert.match(app, /<Navigate to="\/grow\/focus" replace \/>/);
  assert.match(map.grow.howto.join(' '), /needs the founder role; without it, \/grow opens \/grow\/focus/);
});
