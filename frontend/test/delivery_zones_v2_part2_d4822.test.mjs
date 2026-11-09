/**
 * D4822 (#4822, part 2) — the four zones the engagement Sheet links to keep its engagement selected
 * (`?engagement=<uid>`), and carry the canvas's states and copy. Rendered and driven, not read as source text,
 * except for the two lines whose property IS the source (no schema word in product copy).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { stubApi, restoreApi, mountZone } from './_delivery_zone_harness.mjs';

import { matchesFocus, focusLabel, focusEngagementId, EngagementFocusBar } from '../src/pages/partner/delivery/engagementFocus.jsx';
import { ComposerAnchor, periodWords } from '../src/pages/partner/delivery/StatusReportsZone.jsx';
import DeliverablesZone from '../src/pages/partner/delivery/DeliverablesZone.jsx';
import HealthZone from '../src/pages/partner/delivery/HealthZone.jsx';

const render = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const src = (f) => readFileSync(resolve(process.cwd(), 'frontend/src/pages/partner/delivery', f), 'utf8');

const ENG = [
  { engagement_id: 1, engagement_uid: 'eng_acme', founder_name: 'Acme' },
  { engagement_id: 2, engagement_uid: 'eng_birch', founder_name: 'Birch' },
];
const deliverable = (id, engagement_id, founder_name, engagement_uid) => ({
  id, engagement_id, engagement_uid, founder_name, title: `Deck ${id}`, version: '', link_url: '', sent_at: '2026-10-01',
  opened_at: null, signed_off_at: null, days_since_sent: 30, is_unopened: true,
});

test('focus matches the uid or the id, and an unknown value matches nothing — never another engagement', () => {
  assert.equal(matchesFocus(ENG[0], ''), true, 'no focus hid a row');
  assert.equal(matchesFocus(ENG[0], 'eng_acme'), true);
  assert.equal(matchesFocus(ENG[0], '1'), true, 'the id form was refused');
  assert.equal(matchesFocus(ENG[1], 'eng_acme'), false);
  assert.equal(matchesFocus({}, 'eng_acme'), false);
  assert.equal(ENG.filter((r) => matchesFocus(r, 'eng_nobody')).length, 0);
  assert.equal(focusLabel(ENG, 'eng_birch'), 'Birch');
  assert.equal(focusLabel(ENG, 'eng_nobody'), null);
  assert.equal(focusEngagementId([[], ENG], 'eng_birch'), '2', 'the second list was not consulted');
  assert.equal(focusEngagementId([ENG], 'eng_nobody'), '');
  assert.equal(focusEngagementId([ENG], ''), '');
});

test('the focus bar says whose rows these are, of how many, and offers the way back and Show all', () => {
  assert.equal(render(EngagementFocusBar, { focusKey: '' }), '', 'an unfocused zone drew the bar');
  const out = render(EngagementFocusBar, { focusKey: 'eng_birch', label: 'Birch', shown: 2, total: 5, noun: 'deliverables', onClear: () => {} });
  assert.match(out, /role="status"/);
  assert.match(renderedText(out), /Showing Birch · 2 of 5 deliverables/);
  assert.match(out, /href="\/delivery\/board\?engagement=eng_birch"[^>]*>Back to engagement/);
  assert.match(out, />Show all</);
  const unknown = renderedText(render(EngagementFocusBar, { focusKey: 'eng_nobody', label: null, shown: 0, total: 5, onClear: () => {} }));
  assert.match(unknown, /an engagement this zone has no records for · 0 of 5 records/);
});

test('Deliverables opened from the Sheet shows only that engagement, preselects it, and Show all brings the rest back', async () => {
  stubApi({
    listPartnerDeliverables: async () => ({ items: [deliverable(1, 1, 'Acme', 'eng_acme'), deliverable(2, 2, 'Birch', 'eng_birch'), deliverable(3, 2, 'Birch', 'eng_birch')] }),
    getPartnerDeliveryHealth: async () => ({ items: ENG }),
  });
  const view = await mountZone(DeliverablesZone, '/delivery/deliverables?engagement=eng_birch');
  try {
    await view.settle();
    const t = view.text();
    assert.match(t, /Showing Birch · 2 of 3/);
    assert.match(t, /Deck 2/);
    assert.doesNotMatch(t, /Deck 1/, 'another engagement’s deliverable stayed on a focused zone');
    await view.press('Log deliverable');
    assert.equal(String(view.valueOf('Engagement')), '2', 'the create form did not start on the focused engagement');
    await view.press('Show all');
    await view.settle();
    assert.match(view.text(), /Deck 1/);
    assert.doesNotMatch(view.text(), /Showing Birch/);
  } finally { await view.unmount(); restoreApi(); }
});

test('Health narrowed to an engagement no row carries says so and shows nothing, not the firm', async () => {
  stubApi({
    getPartnerDeliveryHealth: async () => ({ items: ENG.map((r) => ({ ...r, health: null })), rated_count: 0, unrated_count: 2 }),
    listPartnerPeople: async () => ({ items: [] }),
    listPartnerMilestones: async () => ({ items: [] }),
    listPartnerBlockers: async () => ({ items: [] }),
  });
  const view = await mountZone(HealthZone, '/delivery/health?engagement=eng_nobody');
  try {
    await view.settle();
    const t = view.text();
    assert.match(t, /an engagement this zone has no records for · 0 of 2/);
    assert.doesNotMatch(t, /Acme|Birch/, 'an unknown engagement narrowed to the whole firm');
  } finally { await view.unmount(); restoreApi(); }
});

test('the composer names what it is writing: the client, the period in words, and new, draft or sent', () => {
  assert.equal(periodWords('2026-11'), 'November 2026');
  assert.equal(periodWords('not-a-period'), 'not-a-period');
  const words = (state) => renderedText(render(ComposerAnchor, { client: 'Birch', period: '2026-11', state }));
  assert.match(words(null), /Birch\s*· November 2026\s*New report/);
  assert.match(words('draft'), /Draft/);
  assert.match(words('sent'), /Sent · read only/);
  assert.match(renderedText(render(ComposerAnchor, { client: null, period: '2026-11', state: null })), /Client not recorded/);
});

test('no schema word reaches product copy: Deliverables says read status is unavailable, never opened_at', () => {
  const visible = src('DeliverablesZone.jsx').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(visible, /<code>opened_at<\/code>/);
  assert.match(visible, /Read status unavailable/);
  const cap = src('CapacityZone.jsx');
  assert.match(cap, /data-testid="capacity-limits-unset"/);
  assert.match(cap, /Set available hours to identify over-allocation\./);
  assert.match(cap, /href="#capacity-limits"/);
  assert.match(cap, /id="capacity-limits"/, 'Set capacity links to nothing');
});

test('while client opens are not tracked, the Never opened chip and Chase unopened are hidden and the log opens on All', async () => {
  // Deck 3 is logged but not sent, so only the All view draws it: it proves the log opened on All, not Never opened.
  const items = [deliverable(1, 1, 'Acme', 'eng_acme'), deliverable(2, 2, 'Birch', 'eng_birch'), { ...deliverable(3, 1, 'Acme', 'eng_acme'), sent_at: null, days_since_sent: null }]
    .map((r) => ({ ...r, is_unopened: null }));
  for (const [available, shown] of [[false, false], [true, true]]) {
    stubApi({
      listPartnerDeliverables: async () => ({ items, read_tracking: { available } }),
      getPartnerDeliveryHealth: async () => ({ items: ENG }),
    });
    const view = await mountZone(DeliverablesZone, '/delivery/deliverables');
    try {
      await view.settle();
      const ids = view.nodes().map((n) => view.props(n)?.['data-testid']).filter(Boolean);
      assert.equal(ids.includes('filter-deliverables-never-opened'), shown, `Never opened chip with tracking ${available}`);
      assert.equal(/Chase unopened/.test(view.text()), shown, `Chase unopened with tracking ${available}`);
      if (!available) {
        assert.match(view.text(), /Deck 1/);
        assert.match(view.text(), /Deck 2/);
        assert.match(view.text(), /Deck 3/, 'the log still opened on Never opened');
      } else {
        assert.doesNotMatch(view.text(), /Deck 3/, 'Never opened stopped being the default where opens are tracked');
      }
    } finally { await view.unmount(); restoreApi(); }
  }
});
