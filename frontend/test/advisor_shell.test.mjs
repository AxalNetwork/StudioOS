/**
 * The Advisor shell, and the one consolidation in it that is actually safe.
 *
 * Advisor is where the canvas's flat shell pays off honestly for the first
 * time: `AdvisorAdvisoryWorkspace` renders a `WorkspaceTabs` bar across all
 * five /advisor/advisory/* pages, so ONE row can own five destinations and
 * every one stays a click away. Partner had no equivalent for Pipeline or
 * Offers, which is why it shipped fourteen rows instead of eight.
 *
 * The rest of the role keeps rows, and the audit is the reason. Searching
 * every `to=` and `navigate(` in frontend/src for the destinations a fuller
 * collapse would swallow: /office-hours 0 inbound, /messages 0, /signals 0,
 * /due-diligence 0. Four surfaces whose only door is this sidebar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const src = codeOnly(read('frontend/src/sidebarConfig.js'));
const advisor = src.slice(src.indexOf('\n  advisor: ['), src.indexOf('\n  exploring: ['));

const rows = [...advisor.matchAll(/\{ to: '([^']*)'[^}]*label: '([^']+)'/g)]
  .map((m) => ({ to: m[1], label: m[2] }));
const targets = rows.map((r) => r.to);
const labels = rows.map((r) => r.label);

test('the canvas rows are present, in the canvas order', () => {
  // Expertise is deliberately absent — see the next test.
  const CANON = ['Home', 'Practice', 'Network', 'Research', 'Practice Settings'];
  let i = 0;
  for (const l of labels) if (l === CANON[i]) i += 1;
  assert.equal(i, CANON.length, `canonical rows out of order or missing: ${JSON.stringify(labels)}`);
});

test('Practice owns the whole advisory subtree, and the workspace tabs to all of it', () => {
  const practice = rows.find((r) => r.label === 'Practice');
  assert.ok(practice, 'no Practice row');
  assert.match(advisor, /match: \['\/advisor\/advisory'\]/, 'Practice must match the subtree');

  // The row may only own them because the workspace links every one. Read it.
  const ws = read('frontend/src/pages/advisor/advisory/AdvisorAdvisoryWorkspace.jsx');
  for (const page of ['opportunities', 'clients', 'engagements', 'delivery', 'contracts']) {
    assert.ok(ws.includes(`to: '/advisor/advisory/${page}'`),
      `AdvisorAdvisoryWorkspace no longer tabs to ${page} — Practice can no longer own it`);
  }
});

test('every destination the old nav reached still has a door', () => {
  const BEFORE = [
    '/office-hours', '/messages', '/network', '/market-intel', '/my/jobs',
    '/advisors', '/signals', '/due-diligence',
    '/advisor/advisory/opportunities', '/advisor/advisory/clients',
    '/advisor/advisory/engagements', '/advisor/advisory/delivery',
    '/advisor/advisory/contracts',
  ];
  const ws = read('frontend/src/pages/advisor/advisory/AdvisorAdvisoryWorkspace.jsx');
  const doorless = BEFORE.filter((p) => !targets.includes(p) && !ws.includes(`to: '${p}'`));
  assert.deepEqual(doorless, [], 'no nav row and no workspace tab — reachable only by typed URL');
});

test('/office-hours is untouched and keeps its highlight', () => {
  // Standing instruction, and task #124. The canvas's Practice sections
  // (Sessions, Earnings) describe it, but the workspace does not tab to it, so
  // folding it in would cost the door.
  assert.match(advisor, /\{ to: '\/office-hours', icon: Calendar, label: 'Office Hours', highlight: true \}/);
});

test('Expertise waits for a destination rather than borrowing one', () => {
  // The canvas gives Expertise five sections — Profile, Services, Proof,
  // Thinking, Visibility — and no existing route is clearly that page.
  // /advisors is the public directory, at most the Visibility slice. Pointing
  // the row there to complete the shell is how a nav entry ends up lying.
  assert.ok(!labels.includes('Expertise'),
    'Expertise has a row — it needs an audited destination first, like Founder Grow');
});

test('Home is /studio, Settings is the company, no role root invented', () => {
  assert.equal(rows[0].to, '/studio');
  assert.ok(targets.includes('/company-settings'), 'Practice Settings is company settings');
  assert.ok(!targets.includes('/home'));
  assert.ok(!targets.includes('/advisor'), 'no bare /advisor root');
});

test('Trust stays out of the sidebar', () => {
  assert.ok(!targets.includes('/trust'), 'Trust Center belongs to the user dropdown');
});
