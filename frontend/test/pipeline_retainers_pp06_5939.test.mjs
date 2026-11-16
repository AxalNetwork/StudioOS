/**
 * #5939 (D4838 part 6) — Pipeline · Retainers redrawn to PP06 and PP06m: exceptions first.
 *
 * THE BOUNDARY THE REVIEWER FOUND. Before this part the zone called a retainer under-consuming below 60% while the
 * Pipeline root (`commandCentre.js`, `LOW_USE_PCT = 50`) called it low use below 50, so an active retainer at 55%
 * was an exception on one page and not the other. The fixture below is the reviewer's: active retainers at 0,
 * 49.99, 50, 55, 60 and no recorded utilization, plus an ended one at 49.99. Only 0 and 49.99 are low use, and the
 * band item, its filtered ledger, its phone cards and the root's Needs attention all name the same two rows.
 *
 * Mounted where a person would see it (`_contracts_dom.mjs`, `api` stubbed); pure where the rule is the point.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pipeline_retainers_pp06_5939.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountContracts } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import PartnerRetainersZone from '../src/pages/partner/pipeline/RetainersZone.jsx';
import * as cc from '../src/pages/partner/pipeline/commandCentre.js';
import {
  BAND, attentionSets, healthOf, monthlyEquivalent, retainerStrip, sheetTabs, utilisationRead,
} from '../src/pages/partner/pipeline/retainersModel.js';

const h = React.createElement;
const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = raw('frontend/src/pages/partner/pipeline/RetainersZone.jsx');
const MODEL = raw('frontend/src/pages/partner/pipeline/retainersModel.js');
const CANVAS = raw('design/incoming/Pipeline v2 Page.dc.html');
const PP06 = CANVAS.slice(CANVAS.indexOf('/* ---------- P4 retainers ---------- */'), CANVAS.indexOf('/* ---------- P5 analytics ---------- */'));

function stub(methods) {
  const saved = {};
  for (const [k, v] of Object.entries(methods)) { saved[k] = api[k]; api[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete api[k]; else api[k] = v; } };
}
const deferred = () => { let res; const promise = new Promise((a) => { res = a; }); return { promise, resolve: res }; };

function ui(m) {
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const buttons = (label) => m.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  return {
    textOf,
    buttons,
    async press(label, i = 0) {
      const n = buttons(label)[i];
      if (!n) throw new Error('Missing button: ' + label);
      await act(async () => { m.props(n).onClick({ stopPropagation() {} }); });
    },
    async click(n) { await act(async () => { m.props(n).onClick({ stopPropagation() {} }); }); },
    byAttr: (name) => m.nodes().filter((n) => m.props(n)?.[name] !== undefined),
    async type(node, value) { await act(async () => { m.props(node).onChange({ target: { value } }); }); },
    value: (node) => m.props(node).value,
  };
}

/** A row as `GET /retainers` sends it (`retainerProjection` spread over the engagement). */
function row(id, name, { pct = null, active = true, days = null, cadence = 'monthly', amount = 100000, monthly, hours = 40, used, usage = [], ended = null, shape = 'retainer' } = {}) {
  const m = monthly === undefined ? (amount == null ? null : (cadence === 'quarterly' ? Math.round(amount / 3) : amount)) : monthly;
  return {
    engagement_id: id, engagement_uid: `ENG-${id}`, engagement_status: 'active', founder_name: name, need_title: null,
    utilisation_pct: active ? pct : null,
    utilisation_note: pct === null || !active ? (active ? 'No hours have been logged for this period yet. That is not the same as none being used.' : 'This retainer has ended, so it has no current utilisation to measure.') : null,
    hours_used: used === undefined ? (pct === null ? null : Math.round((pct / 100) * hours * 100) / 100) : used,
    retained_hours: hours, current_period: '2026-11', usage,
    retainer: {
      shape, cadence, amount_cents: amount, retained_hours: hours, renews_at: days === null ? null : '2026-12-01',
      ended_at: active ? ended : (ended || '2026-10-01'), days_to_renewal: days, active,
      monthly_amount_cents: m, monthly_cents: m, current_monthly_cents: active ? m : null,
    },
  };
}

/** The reviewer's fixture: no other attention condition on any row. */
const REVIEWER = [
  row(1, 'Zero Co', { pct: 0 }),
  row(2, 'Fortynine Co', { pct: 49.99 }),
  row(3, 'Fifty Co', { pct: 50 }),
  row(4, 'Fiftyfive Co', { pct: 55 }),
  row(5, 'Sixty Co', { pct: 60 }),
  row(6, 'Unlogged Co', { pct: null }),
  row(7, 'Ended Co', { pct: 49.99, active: false }),
];
// `pct` for the ended row is nulled by the Worker's projection; the rule must exclude it on `active` alone, so the
// fixture also carries a raw 49.99 on it.
REVIEWER[6].utilisation_pct = 49.99;
const LOW_IDS = [1, 2];

const body = (items) => ({
  items, retainer_count: items.filter((r) => r.retainer).length,
  active_count: items.filter((r) => r.retainer?.active).length,
  ended_count: items.filter((r) => r.retainer && !r.retainer.active).length,
  mrr_cents: items.filter((r) => r.retainer?.active).reduce((a, r) => a + r.retainer.current_monthly_cents, 0) || null,
  shape_counts: { retainer: items.filter((r) => r.retainer?.active).length, embedded_seat: 0 },
  // The Worker still counts under 60; the zone must not draw it.
  under_consuming_count: 99,
});

async function mount(items, extra = {}) {
  const restore = stub({ listPartnerRetainers: async () => body(items), ...extra });
  const m = await mountContracts(h(PartnerRetainersZone));
  await m.flush();
  return { m, u: ui(m), restore };
}

test('the reviewer’s boundary: 0 and 49.99 are low use; 50, 55, 60, unrecorded and ended are not', () => {
  const sets = attentionSets(REVIEWER);
  assert.deepEqual(sets.under.map((r) => r.engagement_id), LOW_IDS);
  assert.deepEqual(sets.over, []);
  assert.deepEqual(sets.renewing, []);
  // The root's Needs attention names the same rows, from the same rule.
  const root = cc.attentionItems({ retainers: cc.ok({ items: REVIEWER }) })
    .filter((a) => a.key.startsWith('low-')).map((a) => Number(a.key.slice(4)));
  assert.deepEqual(root, LOW_IDS);
  // A real 0% is low use and reads as a figure, not as Not recorded.
  assert.deepEqual(utilisationRead(REVIEWER[0]), { pct: 0, key: 'low', word: 'low use', icon: '▼' });
  assert.equal(utilisationRead(REVIEWER[5]), null);
});

test('the band imports the command centre’s rules rather than copying them', () => {
  // Mutations checked: `isLowUse` redefined in the model with `< 60`; the zone's ledger filtered with its own literal.
  const src = codeOnly(MODEL);
  assert.match(src, /import \{[^}]*\bisLowUse\b[^}]*\bisOverServiced\b[^}]*\bisRenewingSoon\b[^}]*\bretainerActive\b[^}]*\} from '\.\/commandCentre\.js'/);
  assert.equal(BAND.find((b) => b.key === 'under').rule, cc.isLowUse);
  assert.equal(BAND.find((b) => b.key === 'over').rule, cc.isOverServiced);
  assert.equal(BAND.find((b) => b.key === 'renewing').rule, cc.isRenewingSoon);
  for (const [name, s] of [['retainersModel.js', src], ['RetainersZone.jsx', codeOnly(ZONE)]]) {
    assert.doesNotMatch(s, /utilisation_pct\s*[<>]=?\s*\d|pct\s*<\s*\d|<\s*60\b|<=\s*30\b/, `${name} restates a threshold`);
  }
  assert.doesNotMatch(codeOnly(ZONE), /under_consuming_count/, 'the zone draws the Worker’s 60% count');
  assert.equal(cc.LOW_USE_PCT, 50);
});

test('pressing a band item shows exactly its rows, in the ledger and on the phone cards', async () => {
  const { m, u, restore } = await mount(REVIEWER);
  try {
    const under = u.byAttr('data-band').find((n) => m.props(n)['data-band'] === 'under');
    assert.ok(under, 'the low-use item is drawn');
    assert.match(u.textOf(under), /▼\s*2 under 50% utilization/);
    // Only items with rows are drawn: nothing here is over-serviced or renewing.
    assert.deepEqual(u.byAttr('data-band').map((n) => m.props(n)['data-band']), ['under']);
    assert.equal(m.props(under)['aria-pressed'], false);
    await u.click(under);
    assert.equal(m.props(u.byAttr('data-band')[0])['aria-pressed'], true);
    const rowIds = u.byAttr('data-row').map((n) => m.props(n)['data-row']);
    const cardIds = u.byAttr('data-card').map((n) => m.props(n)['data-card']);
    assert.deepEqual(rowIds, LOW_IDS, 'the filtered ledger is not the band item’s rows');
    assert.deepEqual(cardIds, LOW_IDS, 'the phone cards are not the band item’s rows');
    // The Utilization risk tile counts the same rows, not the Worker's 60% figure.
    const kpi = u.byAttr('data-testid').filter((n) => m.props(n)['data-testid'] === 'retainer-kpi').map(u.textOf);
    assert.match(kpi[3], /^Utilization risk2/);
    assert.match(kpi[3], /0 over 100% · 2 under 50%/);
    // Pressing it again shows every retainer, ended included.
    await u.click(u.byAttr('data-band')[0]);
    assert.deepEqual(u.byAttr('data-row').map((n) => m.props(n)['data-row']), [1, 2, 3, 4, 5, 6, 7]);
    // The unrecorded row is named as unmeasured, not counted as fine or as low.
    assert.match(m.text(), /1 active retainer has no utilization recorded this period/);
    // The toolbar's chip and the band drive one view: its Under-consuming chip selects the same rows.
    const chip = m.nodes().find((n) => n.tagName === 'BUTTON' && u.textOf(n).trim() === 'Under-consuming');
    assert.ok(chip, 'the toolbar chip is drawn');
    await u.click(chip);
    assert.deepEqual(u.byAttr('data-row').map((n) => m.props(n)['data-row']), LOW_IDS);
    assert.equal(m.props(u.byAttr('data-band')[0])['aria-pressed'], true, 'the band does not show the toolbar’s view');
  } finally { await m.unmount(); restore(); }
});

test('over-serviced and renewing items filter to their own rows too', async () => {
  const items = [
    row(1, 'Halden', { pct: 118, days: 90 }),
    row(2, 'Kestrel', { pct: 82, days: 21 }),
    row(3, 'Orbit', { pct: 35, days: 31 }),
    row(4, 'Old', { pct: 140, days: 5, active: false }),
  ];
  items[3].utilisation_pct = 140;
  const { m, u, restore } = await mount(items);
  try {
    const band = (k) => u.byAttr('data-band').find((n) => m.props(n)['data-band'] === k);
    assert.deepEqual(u.byAttr('data-band').map((n) => m.props(n)['data-band']), ['over', 'renewing', 'under']);
    for (const [k, want] of [['over', [1]], ['renewing', [2]], ['under', [3]]]) {
      await u.click(band(k));
      assert.deepEqual(u.byAttr('data-row').map((n) => m.props(n)['data-row']), want, `${k} filtered to other rows`);
      await u.click(band(k));
    }
    assert.match(u.textOf(band('over')), /▲\s*1 over-serviced/);
    assert.match(u.textOf(band('renewing')), /◷\s*1 renews within 30 days/);
  } finally { await m.unmount(); restore(); }
});

test('a quarterly amount is its monthly equivalent, said so, and never headed Monthly', async () => {
  const q = row(1, 'Nebula', { pct: null, cadence: 'quarterly', amount: 780000, monthly: 260000, hours: 30 });
  assert.deepEqual(monthlyEquivalent(q), { cents: 260000, basis: '$7,800 a quarter ÷ 3', why: null });
  assert.equal(monthlyEquivalent(row(2, 'E', { active: false })).cents, null);
  const { m, u, restore } = await mount([q]);
  try {
    const heads = m.nodes().filter((n) => n.tagName === 'TH').map(u.textOf);
    assert.deepEqual(heads, ['Client', 'Monthly equivalent', 'Scope', 'Utilization · this period', 'Renewal', 'Health']);
    assert.ok(!heads.includes('Monthly'), 'a column of quarterly-derived figures is headed Monthly');
    const tr = m.nodes().find((n) => n.tagName === 'TR' && m.props(n)['data-row'] === 1);
    const cells = tr.childNodes.filter((n) => n.tagName === 'TD').map(u.textOf);
    assert.match(cells[1], /\$2,600\/mo/);
    assert.match(cells[1], /\$7,800 a quarter ÷ 3/);
    assert.doesNotMatch(cells[1], /\$7,800\/mo/);
    assert.equal(cells[2], '30 h / quarter');
    assert.match(cells[3], /Not recorded/);
    assert.match(cells[3], /No hours have been logged/);
  } finally { await m.unmount(); restore(); }
});

test('utilization and health are said in words with a shape, not by colour alone', async () => {
  const items = [row(1, 'Over', { pct: 118 }), row(2, 'Low', { pct: 35 }), row(3, 'Fine', { pct: 76 }), row(4, 'Blank', { pct: null })];
  const { m, u, restore } = await mount(items);
  try {
    const tr = (id) => m.nodes().find((n) => n.tagName === 'TR' && m.props(n)['data-row'] === id).childNodes.filter((n) => n.tagName === 'TD').map(u.textOf);
    assert.match(tr(1)[3], /▲ 118% · over scope/);
    assert.match(tr(2)[3], /▼ 35% · low use/);
    assert.match(tr(3)[3], /● 76% · healthy/);
    assert.match(tr(1)[5], /▲ Over scope/);
    assert.match(tr(2)[5], /▼ Low use/);
    assert.match(tr(3)[5], /● Healthy/);
    // No recorded utilization is not "Healthy".
    assert.match(tr(4)[5], /No exception/);
    assert.equal(healthOf(row(5, 'R', { pct: 80, days: 3 })).word, 'Renews in 3 d');
    assert.equal(healthOf(row(6, 'E', { active: false })).word, 'Ended');
  } finally { await m.unmount(); restore(); }
});

test('a phone card leads with utilization, renewal, the monthly equivalent and health', async () => {
  const { m, u, restore } = await mount([row(1, 'Kestrel', { pct: 82, days: 21, amount: 600000 })]);
  try {
    const card = u.byAttr('data-card')[0];
    const t = u.textOf(card);
    assert.match(t, /^Kestrel◷ Renews in 21 d/, 'the card opens on the client and its health');
    const at = (s) => { const i = t.indexOf(s); assert.ok(i >= 0, `the card lost ${s}`); return i; };
    assert.ok(at('82% · healthy') < at('$6,000 / mo equivalent'));
    assert.ok(at('$6,000 / mo equivalent') < at('renews Dec 1, 2026'));
    // The card's opener is a 44px target.
    const opener = card.childNodes[0].childNodes.find((n) => n.tagName === 'BUTTON');
    assert.match(m.props(opener).className, /min-h-\[44px\]/);
  } finally { await m.unmount(); restore(); }
});

test('the sheet’s tabs show only what is recorded', async () => {
  const bare = { engagement_id: 9, engagement_uid: 'ENG-9', founder_name: 'Bare', retainer: null, usage: [], utilisation_pct: null };
  assert.deepEqual(sheetTabs(bare), ['summary', 'terms']);
  assert.deepEqual(sheetTabs(row(1, 'A', { pct: null })), ['summary', 'usage', 'terms']);
  assert.deepEqual(sheetTabs(row(2, 'B', { pct: 50, usage: [{ period: '2026-11', hours_used: 20, note: null }] })), ['summary', 'usage', 'terms', 'history']);
  assert.deepEqual(sheetTabs(row(3, 'C', { active: false })), ['summary', 'usage', 'terms', 'history']);

  const { m, u, restore } = await mount([row(1, 'Acme', { pct: null }), bare]);
  try {
    await u.press('Acme');
    const tabs = () => m.nodes().filter((n) => m.props(n)?.role === 'tab').map(u.textOf);
    assert.deepEqual(tabs(), ['Summary', 'Usage', 'Terms']);
    // A panel out of view stays mounted, so a draft survives a look at another tab.
    // Mutation checked: the Usage panel rendered only while it is the current tab.
    await u.press('Usage');
    const hours = () => m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n).placeholder === 'e.g. 31.5');
    await u.type(hours(), '17');
    await u.press('Terms');
    await u.press('Usage');
    assert.equal(u.value(hours()), '17', 'switching tabs dropped the Usage draft');
    await u.press('✕');
    await u.press('Record as a retainer');
    assert.deepEqual(tabs(), ['Summary', 'Terms']);
    const selected = m.nodes().find((n) => m.props(n)?.role === 'tab' && m.props(n)['aria-selected']);
    assert.equal(u.textOf(selected), 'Terms', 'Record opens the sheet on Terms');
  } finally { await m.unmount(); restore(); }
});

test('a refresh that brings changed stored terms keeps the draft and the open sheet', async () => {
  // Mutation checked: the Terms form seeded from the stored values on every render.
  const reload = deferred();
  let reads = 0;
  const first = [row(1, 'Acme', { pct: 60, amount: 800000 })];
  const changed = [row(1, 'Acme', { pct: 60, amount: 700000 })];
  const restore = stub({
    listPartnerRetainers: () => { reads += 1; return reads === 1 ? Promise.resolve(body(first)) : reload.promise; },
    savePartnerRetainerUsage: async () => ({}),
  });
  const m = await mountContracts(h(PartnerRetainersZone));
  const u = ui(m);
  const amount = () => m.nodes().filter((n) => n.tagName === 'INPUT' && m.props(n).placeholder === 'e.g. 8000');
  try {
    await m.flush();
    await u.press('Acme');
    await u.press('Terms');
    assert.equal(u.value(amount()[0]), '8000');
    await u.type(amount()[0], '9100');
    await u.press('Usage');
    await u.type(m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n).placeholder === 'e.g. 31.5'), '24');
    await u.press('Log hours');
    await act(async () => { reload.resolve(body(changed)); });
    await m.flush();
    assert.equal(reads, 2);
    assert.ok(m.nodes().some((n) => m.props(n)?.['data-testid'] === 'retainer-sheet'), 'the refresh closed the sheet');
    assert.equal(u.value(amount()[0]), '9100', 'the refresh erased the draft');
    await u.press('Discard changes');
    assert.equal(u.value(amount()[0]), '7000', 'discarding shows the stored terms as they are now');
  } finally { await m.unmount(); restore(); }
});

test('the strip is PP06’s four tiles, each saying its basis', () => {
  const labels = [...PP06.matchAll(/\['([^']+)', '[^']*', '[^']*'\]/g)].map((x) => x[1])
    .filter((l) => ['Current recurring revenue', 'Active retainers', 'Renewal value next 30d', 'Utilization risk'].includes(l));
  assert.deepEqual(labels, ['Current recurring revenue', 'Active retainers', 'Renewal value next 30d', 'Utilization risk']);
  const items = [
    row(1, 'A', { pct: 118, days: 10, amount: 550000 }),
    row(2, 'B', { pct: 82, days: 21, amount: null }),
    row(3, 'C', { pct: null }),
  ];
  const t = retainerStrip({ ...body(items), mrr_cents: 550000 }, items);
  assert.deepEqual(t.map((x) => x.label), labels);
  assert.equal(t[0].value, '$5,500');
  assert.match(t[0].note, /quarterly ÷ 3/);
  assert.equal(t[1].value, '3');
  // Two renewing, one priced: the unpriced one is named, not added as $0.
  assert.equal(t[2].value, '$5,500 / mo');
  assert.equal(t[2].note, '2 retainers · 1 with no amount not in it');
  assert.equal(t[3].value, '1');
  // Nothing recorded is Not recorded, never 0.
  const none = retainerStrip({ items: [row(4, 'D', { pct: null })], active_count: 1, mrr_cents: null }, [row(4, 'D', { pct: null })]);
  assert.equal(none[0].state, 'unrecorded');
  assert.equal(none[3].state, 'unrecorded');
  assert.equal(none[2].state, 'none');
});
