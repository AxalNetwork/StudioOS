// D4637 (#4637): an anonymous Help user sees a reviewed subset, never all member guides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPublicPath } from '../src/lib/api.js';
import { SECTIONS, PUBLIC_HELP_ANCHORS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { buildDocsRecords } from '../src/lib/docs/search.js';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('public Help, status and changelog survive background 401s; tickets and admin do not', () => {
  for (const path of ['/help', '/help/', '/help/account/auth-recovery', '/help/troubleshooting/contact-support/', '/status', '/changelog']) {
    assert.equal(isPublicPath(path), true, path);
  }
  for (const path of ['/help/tickets', '/help/tickets/123', '/help/admin/access', '/help/admin/guide', '/account', '/help/123']) {
    assert.equal(isPublicPath(path), false, path);
  }
});

test('anonymous catalogue, direct links and search share one explicitly approved subset', () => {
  const sections = filterSectionsForRole(SECTIONS, 'public');
  const anchors = sections.flatMap((s) => s.subsections.map((g) => `${s.id}/${g.id}`));
  assert.deepEqual(new Set(anchors), PUBLIC_HELP_ANCHORS);
  assert.ok(anchors.includes('account/auth-recovery'));
  assert.ok(anchors.includes('troubleshooting/contact-support'));
  assert.ok(!anchors.some((a) => a.startsWith('admin/')));
  assert.deepEqual(new Set(buildDocsRecords('public').map((r) => r.anchor)), PUBLIC_HELP_ANCHORS);
  assert.ok(filterSectionsForRole(SECTIONS, 'admin').some((s) => s.id === 'admin'), 'admin guides stay available to admins');
});

test('public Help does not mount authenticated tickets, feedback, chat or popularity reads', () => {
  const app = read('../src/App.jsx');
  const layout = read('../src/pages/docs/DocsLayout.jsx');
  const signals = read('../src/pages/docs/HelpSignals.jsx');
  assert.match(app, /<Route path="\/help" element=\{<HelpCenterPage \/>\} \/>/);
  assert.match(app, /<Route path="\/help\/:area\/:guide" element=\{<HelpCenterPage \/>\} \/>/);
  assert.match(app, /<Route path="\/help\/tickets" element=\{guard\(/);
  assert.match(app, /<Route path="\/help\/admin\/\*" element=\{<AdminDocsPathGuard \/>\}/);
  assert.match(layout, /const helpRole = user \? role : 'public'/);
  assert.match(layout, /user && <GuideFeedback/);
  assert.match(layout, /user && <YourTicketsCard/);
  assert.match(layout, /usePopularGuides\(visibleSections, !!user\)/);
  assert.match(signals, /if \(!enabled\) \{/);
  assert.match(layout, /user && <CustomerChatWidget/);
});

test('ticket form and support article disclose the separate private security channel', () => {
  const tickets = read('../src/pages/TicketsPage.jsx');
  const help = read('../src/pages/docs/DocsLayout.jsx');
  const support = read('../src/pages/docs/sections/troubleshooting.js');
  assert.match(tickets, /Ordinary tickets and replies may be mirrored to a public GitHub tracker/);
  assert.match(tickets, /does not support file attachments/);
  assert.match(tickets, /security\/advisories\/new/);
  assert.match(help, /area === 'troubleshooting' && guide === 'contact-support'/);
  assert.match(support, /Type: Task, Bug or Feature/);
  assert.match(support, /The ticket form has no file-upload control/);
});
