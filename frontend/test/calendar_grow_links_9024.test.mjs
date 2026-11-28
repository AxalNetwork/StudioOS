// #9024 (owner Q18=b on #3723) — a venture's Grow items stay on an advisor's
// Calendar, with no link to the /grow/distribution pages that refuse them.
// The Worker decides the link with `opensGrowDistribution`
// (lib/growDistributionAccess.js): the route file's own guard list and
// RoleGuard's own rule (`guardAdmits`). These tests read the route file and
// App.jsx so neither can move away from it, and check the drawer draws no link
// for an item that has none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, sourceModule } from './_form_d695.mjs';
import { GROW_DISTRIBUTION_ROLES, opensGrowDistribution } from '../src/lib/growDistributionAccess.js';
import { guardAdmits } from '../src/lib/activeRole.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

test('#9024: the rule\'s list is every /grow/distribution guard, as the route file writes it', () => {
  const src = read('frontend/src/routes/growDistribution.jsx');
  const guards = [...src.matchAll(/path="(\/grow\/distribution\/[^"]*)" element=\{guard\(\[([^\]]*)\]/g)]
    .map((m) => [m[1], m[2].split(',').map((r) => r.trim().replace(/['"]/g, '')).filter(Boolean)]);
  assert.equal(guards.length, (src.match(/<Route /g) || []).length, 'every Distribution route has a plain guard list');
  assert.ok(guards.length >= 10);
  for (const [path, roles] of guards) assert.deepEqual(roles, [...GROW_DISTRIBUTION_ROLES], path);
});

test('#9024: RoleGuard admits by guardAdmits, the rule the Worker reads', () => {
  const app = read('frontend/src/App.jsx');
  const guard = app.slice(app.indexOf('function RoleGuard('), app.indexOf('function RoleGuard(') + 1200);
  assert.match(guard, /const held = resolveHeldLicences\(\{ user, realUser, viewMode, isImpersonating \}\);\n\s+if \(!guardAdmits\(allowedRoles, effectiveRole, held\)\) \{/);
  assert.equal(guardAdmits(['founder'], 'advisor', ['advisor']), false);
  assert.equal(guardAdmits(['founder'], 'founder', []), true, 'the role browsed as');
  assert.equal(guardAdmits(['founder'], 'advisor', ['advisor', 'founder']), true, 'or a licence held');
});

test('#9024: who opens Distribution — admin and founder, a held founder licence; never an advisor, partner or investor alone', () => {
  assert.equal(opensGrowDistribution('advisor', ['advisor']), false);
  assert.equal(opensGrowDistribution('partner', ['partner']), false);
  assert.equal(opensGrowDistribution('investor', ['investor']), false);
  assert.equal(opensGrowDistribution('exploring', []), false);
  assert.equal(opensGrowDistribution('founder', ['founder']), true);
  assert.equal(opensGrowDistribution('admin', []), true);
  assert.equal(opensGrowDistribution('Founder', []), true, 'users.role is compared in lower case');
  assert.equal(opensGrowDistribution('advisor', ['advisor', 'founder']), true, 'a founder licence held beside advisor');
  assert.equal(opensGrowDistribution(null, null), false);
});

/** The drawer for a Grow item, through the real client with a stubbed fetch: the Venture section's text and link. */
async function ventureOf(item) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => (/\/api\/calendar\/item\//.test(String(url)) ? response({ item }) : response({ detail: 'Not found' }, 404));
  const { default: Drawer } = await sourceModule(read('frontend/src/pages/CalendarItemDrawer.jsx'), 'pages/CalendarItemDrawer.jsx');
  const ui = await mountForm(h(Drawer, { kind: item.kind, id: String(item.source_id), onClose() {} }), { modal: true });
  try {
    for (let i = 0; i < 5; i += 1) await act(async () => { await ui.flush(); });
    const by = (id) => ui.nodes().find((n) => ui.props(n)['data-testid'] === id);
    const say = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(say).join(' ') : n.textContent || '');
    const open = by('cal-item-open');
    return { venture: say(by('cal-item-venture')).replace(/\s+/g, ' ').trim(), to: open ? (ui.props(open).to ?? ui.props(open).href) : null, people: by('cal-item-people') };
  } finally { await ui.unmount(); globalThis.fetch = previous; }
}

const CAMPAIGN = {
  id: 'grow_campaign:camp-both', kind: 'grow_campaign', source_id: 1, source_uid: 'camp-both', title: 'Campaign · Launch push',
  start_at: '2026-12-03', end_at: '2026-12-21', all_day: true, status: 'active', location_kind: null, location_uri: null, notes: null,
  family: 'grow', my_role: { code: 'team', words: 'Your venture’s team' }, can: { rsvp: false, reschedule: false, cancel: false, copy: false },
  cancel_reason: null, deal_name: null, project_name: 'Fixture venture', time_zone: null, pushed_to: [], my_rsvp: null, people: [],
};

test('#9024: the drawer shows an advisor\'s Grow item and its venture with no link; a founder\'s keeps it', async () => {
  const advisor = await ventureOf({ ...CAMPAIGN, href: null });
  assert.equal(advisor.venture, 'Venture Fixture venture', 'the item and its venture are still shown');
  assert.equal(advisor.to, null, 'no link to a page that refuses this reader');

  const founder = await ventureOf({ ...CAMPAIGN, href: '/grow/distribution/campaigns/camp-both' });
  assert.equal(founder.to, '/grow/distribution/campaigns/camp-both');
});

test('#9024: the Calendar list offers "Event page" only for an item that carries a url', () => {
  const page = read('frontend/src/pages/CalendarPage.jsx');
  assert.match(page, /\{ev\.url && <a href=\{ev\.url\}>Event page<\/a>\}/, 'the list links only what the Worker linked');
});
