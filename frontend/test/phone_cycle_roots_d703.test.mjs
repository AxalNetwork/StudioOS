/**
 * D703 (#1665), PR 1a and PR 1b — each cycle's phone root, One Next Thing:
 * tests 1-5's cases that render `PhoneCycleRoot` directly (PR 1a), the cases
 * of tests 1 and 4 that mount `CycleRoute` below and at 1024px (PR 1b), and
 * PR 1's part of test 14.
 *
 * Fixtures are in #1701's decision 1 shapes: `focus { rule, eyebrow, headline,
 * why, cta: { label, href } | null, then }`, `meter { key, label, count,
 * target, target_reason, display }` and `index [{ key, title, detail, value,
 * href }]`. Every name is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_cycle_roots_d703.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import PhoneCycleRoot from '../src/pages/cycles/PhoneCycleRoot.jsx';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { PHONE_QUERY } from '../src/workspaces/lens.jsx';
import { phoneFocus, phoneIndex, phoneMeter, thenText } from '../src/pages/cycles/validatePhone.js';
import WorkerRail from '../src/ui/WorkerRail.jsx';
import { __resetEadwynPanelForTest, useEadwynPanel } from '../src/ui/eadwynPanel.js';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { __resetRailPrefsSyncForTest } from '../src/ui/railModelChoice.js';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { api } from '../src/lib/api.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { railPrefsApi } from '../src/lib/api/railPrefs.js';

const h = React.createElement;
const Q = '?project_id=3';
const html = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(PhoneCycleRoot, { search: Q, ...props })));
/** The opening tag that carries `data-testid="<id>"`, found by string search (no pattern is built from data). */
const tag = (out, id) => {
  const at = out.indexOf(`data-testid="${id}"`);
  return at < 0 ? '' : out.slice(out.lastIndexOf('<', at), out.indexOf('>', at) + 1);
};
/** From the opening tag that carries `from` up to the one that carries `to`. */
const between = (out, from, to) => {
  const at = out.indexOf(from);
  if (at < 0) return '';
  const start = out.lastIndexOf('<', at);
  const end = to ? out.lastIndexOf('<', out.indexOf(to, at + from.length)) : -1;
  return out.slice(start, end > start ? end : undefined);
};

// ── Fixtures, one per cycle, as #1701 sends them ──────────────────────────

const focus = (cycle, headline, cta, then = null, extra = {}) => ({ rule: 'next', eyebrow: `${cycle} · Next`, headline, why: `Why ${headline}`, cta, then, ...extra });
const row = (key, title, detail, value, href) => ({ key, title, detail, value, href });

const READS = {
  validate: {
    focus: focus('Validate', 'Record the interview with Ada Quill.', { label: 'Record a session', href: `/validate/record${Q}` }, 'Then group two more interviews into a theme.'),
    meter: { key: 'interviews_this_month', label: 'Interviews this month', count: 14, target: 20, target_reason: null, display: '14 of 20' },
    index: [
      row('problem-discovery', 'Problem discovery', '9 pain themes', '', `/validate/problem-discovery${Q}`),
      row('customer-research', 'Customer research', 'Recruiting · 3 booked', '', `/validate/customer-research${Q}`),
      row('ideal-customer-profile', 'Ideal customer profile', '3 segments', '', `/validate/ideal-customer-profile${Q}`),
      row('market-intelligence', 'Market intelligence', 'Total, serviceable, obtainable', null, `/validate/market-intelligence${Q}`),
      row('demand-signals', 'Demand and urgency signals', 'Waitlist against the bar of 40', '', `/validate/demand-signals${Q}`),
      row('experiments', 'Experiments and evidence', 'Hypotheses supported', '3 of 7', `/validate/experiments${Q}`),
      row('verdict', 'Verdict', 'Proceed · 12 Oct', 'Proceed', `/validate/verdict${Q}`),
    ],
    cards: [],
  },
  build: {
    focus: focus('Build', 'Connect the tool Juniper Labs ships with.', { label: 'Connect a tool', href: `/build/connect${Q}` }),
    meter: null,
    index: [
      row('tools', 'Tools', '2 connected', '2', `/build/tools${Q}`),
      row('operating-systems', 'Operating systems', 'Not started', null, `/build/operating-systems${Q}`),
    ],
    cards: [],
  },
  raise: {
    focus: focus('Raise', 'Send the round call to Orchard Ops.', { label: 'Call for Capital', href: `/raise/call${Q}` }, 'Book the partner meeting.'),
    meter: { key: 'raised', label: 'Raised this round', count: 900000, target: 1500000, target_reason: null, display: '$900k of $1.5M' },
    index: [
      row('calls', 'Calls', '1 sent', '1', `/raise/calls${Q}`),
      row('data-room', 'Data room', '12 files', '', `/raise/data-room${Q}`),
    ],
    cards: [],
  },
  grow: {
    focus: focus('Grow', 'Tell customers what changed.', { label: 'Open Product improvement', href: `/grow/product-improvement${Q}` }),
    meter: { key: 'kpis', label: 'KPIs on target', count: 7, target: 9, target_reason: null, display: '7 of 9' },
    index: [
      row('updates', 'Updates', '3 sent', '3', `/grow/updates${Q}`),
      row('product-improvement', 'Product improvement', '4 themes', null, `/grow/product-improvement${Q}`),
    ],
    cards: [],
  },
};
const NAMES = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' };
// Validate's one "Also in" page, Advisory, folded into Team › Advisors (#2341).
const ALSO = { validate: [], build: [], raise: ['Legal & Capital', 'Incorporate', 'Compliance Calendar', 'Co-Founder Agreement'], grow: ['Network Effects', 'Co-marketing', 'Perks'] };

// ── The stub DOM, with a founder rail when asked ──────────────────────────

function stubReads() {
  const real = { myAiSpend: api.myAiSpend, aiPricing: api.aiPricing, mine: aiBudgetApi.mine, topUp: aiBudgetApi.topUp, read: railPrefsApi.read };
  const never = () => new Promise(() => {});
  api.myAiSpend = never; api.aiPricing = never; aiBudgetApi.mine = never; aiBudgetApi.topUp = never;
  railPrefsApi.read = () => Promise.resolve({ ok: true, modes: {}, models: {} });
  return () => { Object.assign(api, { myAiSpend: real.myAiSpend, aiPricing: real.aiPricing }); Object.assign(aiBudgetApi, { mine: real.mine, topUp: real.topUp }); railPrefsApi.read = real.read; };
}
function resetStores() { __resetEadwynPanelForTest(); __resetAssistModeForTest(); __resetRailPrefsSyncForTest(); }

function PanelProbe({ out }) { out.panel = useEadwynPanel(); return null; }

/** Mount the root through the stub DOM, inside `CycleRoute`'s founder rail when `shellRole` is given. */
async function mount(props, { shellRole = null } = {}) {
  resetStores();
  const restore = installDocument();
  const unstub = stubReads();
  const out = {};
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const page = h(MemoryRouter, null, h(PhoneCycleRoot, { search: Q, ...props }));
  const tree = shellRole
    ? h(ViewModeContext.Provider, { value: { shellRole } }, h(React.Fragment, null, h(WorkerRail, { workspace: NAMES[props.cycle], role: 'founder' }), h(PanelProbe, { out }), page))
    : page;
  await act(async () => { root.render(tree); });
  await act(async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    out, pr, all, by: (id) => all(id)[0],
    text: () => txt(container).replace(/\s+/g, ' '),
    act: (fn) => act(async () => { await fn(); }),
    async unmount() { await act(async () => root.unmount()); unstub(); restore(); resetStores(); },
  };
}

// ── 1. Roots, all four cycles ─────────────────────────────────────────────

for (const cycle of Object.keys(READS)) {
  test(`1: the ${NAMES[cycle]} root draws One Next Thing, then "Everything else in ${NAMES[cycle]}" as sent`, () => {
    const raw = READS[cycle];
    const out = html({ cycle, raw });
    const text = renderedText(out);
    assert.ok(tag(out, 'phone-root').includes(`data-cycle="${cycle}"`));
    assert.ok(text.includes(`${NAMES[cycle]} · Next`), 'the eyebrow');
    assert.match(out, /<h2 id="phone-focus-title" class="[^"]*text-\[29px\][^"]*font-black[^"]*leading-\[1\.15\][^"]*tracking-\[-\.032em\][^"]*\[text-wrap:balance\]/);
    assert.ok(text.includes(raw.focus.headline) && text.includes(raw.focus.why));
    // The meter where the read sends one, and none where it does not.
    if (raw.meter) {
      assert.ok(out.includes(`data-testid="phone-meter-value">${raw.meter.display}<`), 'the display, exactly');
      const pct = Math.round((100 * raw.meter.count) / raw.meter.target);
      assert.ok(out.includes(`aria-valuenow="${pct}"`) && out.includes('role="progressbar"'));
      assert.match(out, /<div class="[^"]*\bh-\[7px\][^"]*"[^>]*role="progressbar"/, 'a 7px bar');
    } else {
      assert.doesNotMatch(out, /data-testid="phone-meter"/);
    }
    const cta = tag(out, 'phone-focus-cta');
    assert.match(cta, /min-h-\[52px\]/);
    assert.match(cta, /rounded-\[14px\]/);
    assert.ok(cta.includes(`href="${raw.focus.cta.href}"`), 'the focus href');
    // The Worker's rows, in the order sent, a null value as the chip.
    const index = between(out, 'data-testid="phone-index"', 'data-testid="phone-also-in"');
    assert.ok(renderedText(index).startsWith(`Everything else in ${NAMES[cycle]}`));
    const keys = [...index.matchAll(/data-testid="phone-index-([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(keys, raw.index.map((r) => r.key));
    assert.equal((renderedText(index).match(/Not recorded/g) || []).length, raw.index.filter((r) => r.value == null).length);
    for (const r of raw.index) assert.ok(tag(out, `phone-index-${r.key}`).includes(`href="${r.href}"`), r.key);
    // "Also in <Cycle>", only where the map lists pages.
    const also = between(out, 'data-testid="phone-also-in"');
    if (ALSO[cycle].length) {
      assert.ok(renderedText(also).startsWith(`Also in ${NAMES[cycle]}`));
      for (const label of ALSO[cycle]) assert.ok(renderedText(also).includes(label), label);
    } else {
      assert.equal(also, '', `${cycle} has no "Also in" pages`);
    }
    // Nothing of the desktop overview.
    assert.doesNotMatch(out, /data-testid="(cycle-overview|cycle-figures|cycle-cards)"|data-testid="also-in-/);
  });
}

test('1: Validate\'s, Build\'s and Raise\'s action CTAs open through openAction on a plain tap; Grow\'s is a plain link', async () => {
  for (const cycle of ['validate', 'build', 'raise', 'grow']) {
    const calls = [];
    const m = await mount({ cycle, raw: READS[cycle], openAction: () => calls.push(cycle) });
    try {
      const cta = m.by('phone-focus-cta');
      let prevented = false;
      const event = { button: 0, preventDefault() { prevented = true; } };
      await m.act(() => m.pr(cta).onClick?.(event));
      if (cycle === 'grow') {
        assert.deepEqual(calls, [], 'Grow never opens Share an update from the root: the router follows the link');
      } else {
        assert.deepEqual(calls, [cycle], `${cycle}: openAction`);
        assert.equal(prevented, true);
        // A modified tap is the browser's: no openAction.
        await m.act(() => m.pr(cta).onClick({ button: 0, metaKey: true, preventDefault() {} }));
        assert.deepEqual(calls, [cycle]);
      }
    } finally { await m.unmount(); }
  }
  // An action route the root does not own is a plain link even with openAction.
  const calls = [];
  const m = await mount({ cycle: 'validate', raw: { ...READS.validate, focus: { ...READS.validate.focus, cta: { label: 'Open Experiments', href: `/validate/experiments${Q}` } } }, openAction: () => calls.push(1) });
  try {
    await m.act(() => m.pr(m.by('phone-focus-cta')).onClick({ button: 0, preventDefault() {} }));
    assert.deepEqual(calls, []);
  } finally { await m.unmount(); }
});

test('1 and 4: a founder gets one 40px "Open Eadwyn for this page" button labelled "<Cycle> · Overview"; an admin shell gets none', async () => {
  for (const cycle of ['validate', 'raise']) {
    const m = await mount({ cycle, raw: READS[cycle] }, { shellRole: 'founder' });
    try {
      const buttons = m.all('button-eadwyn-open');
      assert.equal(buttons.length, 1, `${cycle}: one page button`);
      assert.equal(m.pr(buttons[0])['aria-label'], 'Open Eadwyn for this page');
      assert.match(m.pr(buttons[0]).className, /\bead-open\b/, '#1660\'s 40px button');
      await m.act(() => m.pr(buttons[0]).onClick());
      assert.equal(m.out.panel.open, true);
      assert.equal(m.out.panel.label, `${NAMES[cycle]} · Overview`);
    } finally { await m.unmount(); }
    const admin = await mount({ cycle, raw: READS[cycle] }, { shellRole: 'admin' });
    try { assert.equal(admin.all('button-eadwyn-open').length, 0, `${cycle}: an admin shell`); } finally { await admin.unmount(); }
  }
  // With no focus, the one button sits beside the index label.
  const m = await mount({ cycle: 'build', raw: { ...READS.build, focus: null, cards: [] } }, { shellRole: 'founder' });
  try {
    assert.equal(m.all('phone-focus').length, 0);
    assert.equal(m.all('button-eadwyn-open').length, 1);
  } finally { await m.unmount(); }
});

// ── 2. Then, once ─────────────────────────────────────────────────────────

test('2: "Then" appears once, with a leading "Then " stripped and the first letter upper-cased', () => {
  const out = html({ cycle: 'validate', raw: READS.validate });
  const then = renderedText(between(out, 'data-testid="phone-focus-then"', 'data-testid="phone-index"'));
  assert.match(then, /^Then\s*Group two more interviews into a theme\.$/);
  const text = renderedText(out);
  assert.doesNotMatch(text, /Then\s+Then|Then:/);
  assert.equal((out.match(/>Then</g) || []).length, 1, 'one "Then" label');
  assert.equal(thenText('Then: book the partner meeting.'), 'Book the partner meeting.');
  assert.equal(thenText('book the partner meeting.'), 'Book the partner meeting.');
  assert.equal(thenText('Thenceforth hold.'), 'Thenceforth hold.', 'only the word "Then"');
  assert.equal(thenText(''), null);
  assert.match(renderedText(html({ cycle: 'raise', raw: READS.raise })), /Then\s*Book the partner meeting\./);
  assert.doesNotMatch(html({ cycle: 'build', raw: READS.build }), /phone-focus-then/, 'no then, no row');
});

// ── 3. Fallbacks ──────────────────────────────────────────────────────────

test('3: a null focus falls back to Validate\'s rule 1, else the first card\'s next under "<Cycle> · Next"', () => {
  const v = html({ cycle: 'validate', raw: { focus: null, cards: [{ slug: 'customer-research', name: 'Customer research', state: 'empty' }], index: null } });
  assert.ok(renderedText(v).includes('Record your first conversation.'));
  assert.match(tag(v, 'phone-focus-cta'), /href="\/validate\/record\?project_id=3"/);
  assert.doesNotMatch(v, /data-testid="phone-meter"/, 'no meter under the first-conversation focus');
  const r = html({ cycle: 'raise', raw: { focus: null, meter: null, index: null, cards: [
    { slug: 'capital-relationships', name: 'Capital relationships', state: 'ok', next: { text: 'Follow up with Orchard Ops', href: `/raise/capital-relationships${Q}` } },
  ] } });
  assert.ok(renderedText(r).includes('Raise · Next'));
  assert.ok(renderedText(r).includes('Follow up with Orchard Ops.'));
  assert.doesNotMatch(renderedText(r), /Record your first conversation/, 'rule 1 is Validate\'s');
  // Rule 1 never fires for another cycle.
  assert.equal(phoneFocus({ focus: null, cards: [{ slug: 'customer-research', state: 'empty' }] }, Q, 'build'), null);
});

test('3: a null index is one "Unreadable" row per card in the read, and a hidden module stays hidden', () => {
  const cards = [
    { slug: 'problem-discovery', name: 'Problem discovery', caption: 'Pain themes' },
    { slug: 'customer-research', name: 'Customer research', caption: 'Interviews' },
  ];
  const rows = phoneIndex({ index: null, cards }, Q, 'validate');
  assert.deepEqual(rows, [
    { key: 'problem-discovery', title: 'Problem discovery', detail: 'Pain themes', value: 'Unreadable', href: `/validate/problem-discovery${Q}` },
    { key: 'customer-research', title: 'Customer research', detail: 'Interviews', value: 'Unreadable', href: `/validate/customer-research${Q}` },
  ]);
  const out = html({ cycle: 'validate', raw: { focus: null, index: null, cards } });
  assert.equal((renderedText(out).match(/Unreadable/g) || []).length, 2);
  assert.doesNotMatch(out, /phone-index-verdict/, 'no card, no row');
  assert.deepEqual(phoneIndex({ index: null, cards: [{ slug: 'tools', name: 'Tools' }] }, Q, 'build').map((x) => x.href), [`/build/tools${Q}`]);
});

test('3: the meter draws the Worker\'s display exactly; Validate alone falls back, and no value reads 0 unsent', () => {
  const out = html({ cycle: 'raise', raw: READS.raise });
  assert.match(out, /data-testid="phone-meter-value">\$900k of \$1\.5M</);
  assert.match(html({ cycle: 'validate', raw: { focus: READS.validate.focus, figures: [{ key: 'interviews_this_month', value: 14 }], cards: [] } }),
    /data-testid="phone-meter-value">14(<!-- -->)? <span[^>]*>· No target set<\/span>/);
  // A Worker reason with no target, as sent.
  assert.match(html({ cycle: 'grow', raw: { ...READS.grow, meter: { ...READS.grow.meter, target: null, display: '7', target_reason: 'No KPI targets set' } } }),
    /data-testid="phone-meter-value">7(<!-- -->)? <span[^>]*>· No KPI targets set<\/span>/);
  // Another cycle with no display reads Not recorded, never a figure of its own.
  const noDisplay = html({ cycle: 'raise', raw: { ...READS.raise, meter: { key: 'raised', label: 'Raised this round', count: 900000, target: null, target_reason: null, display: null } } });
  assert.match(between(noDisplay, 'data-testid="phone-meter-value"', '</span></span>'), /Not recorded/);
  assert.doesNotMatch(renderedText(noDisplay), /900000|900k/, 'the browser never formats money');
  assert.equal(phoneMeter({ meter: null }, 'build'), null);
  const empty = renderedText(html({ cycle: 'grow', raw: { ...READS.grow, meter: { key: 'kpis', label: 'KPIs on target', count: null, target: null, target_reason: null, display: null } } }));
  assert.doesNotMatch(empty, /\b0 of\b|>0</);
});

// ── 4. Gates on the root ──────────────────────────────────────────────────

test('4: a partner-shaped Validate read with six rows draws six, no Verdict; an off-site href is not linked', () => {
  const partner = { ...READS.validate, index: READS.validate.index.filter((r) => r.key !== 'verdict') };
  const out = html({ cycle: 'validate', raw: partner });
  assert.equal([...out.matchAll(/data-testid="phone-index-/g)].length, 6);
  assert.doesNotMatch(out, /Verdict/);
  const offsite = { ...READS.build, focus: { ...READS.build.focus, cta: { label: 'Go', href: 'https://evil.example/x' } },
    index: [row('tools', 'Tools', '2 connected', '2', '//evil.example/tools')] };
  const o = html({ cycle: 'build', raw: offsite });
  assert.doesNotMatch(o, /evil\.example/);
  assert.doesNotMatch(tag(o, 'phone-index-tools'), /href=/, 'a plain row');
  // The venture is carried as the Worker wrote it.
  assert.match(tag(html({ cycle: 'raise', raw: READS.raise }), 'phone-index-calls'), /href="\/raise\/calls\?project_id=3"/);
});

// ── 5. Validate's target ──────────────────────────────────────────────────

test('5: "Set a target" on the root: a zero is never sent, the refusal in the Worker\'s words, a save re-reads; no other cycle draws it', async () => {
  for (const cycle of ['build', 'raise', 'grow']) assert.doesNotMatch(html({ cycle, raw: READS[cycle], projectId: 3 }), /phone-target|Set a target/);
  const calls = [];
  let changed = 0;
  let refuse = null;
  const api2 = { setInterviewsTarget: async (pid, v) => { calls.push([pid, v]); if (refuse) throw new Error(refuse); return { ok: true }; } };
  const raw = { ...READS.validate, meter: { ...READS.validate.meter, target: null, display: '14', target_reason: 'No target set' } };
  const m = await mount({ cycle: 'validate', raw, projectId: 3, api: api2, onChanged: () => { changed += 1; } });
  try {
    assert.ok(m.text().includes('Set a target'));
    await m.act(() => m.pr(m.by('phone-target-open')).onClick());
    await m.act(() => m.pr(m.by('phone-target-input')).onChange({ target: { value: '0' } }));
    await m.act(() => m.pr(m.by('phone-target-form')).onSubmit({ preventDefault() {} }));
    assert.deepEqual(calls, []);
    assert.ok(m.text().includes('Enter a whole number of interviews a month, above zero.'));
    refuse = 'The target is a whole number of interviews a month, above zero';
    await m.act(() => m.pr(m.by('phone-target-input')).onChange({ target: { value: '25' } }));
    await m.act(() => m.pr(m.by('phone-target-form')).onSubmit({ preventDefault() {} }));
    assert.ok(m.text().includes(refuse));
    assert.equal(changed, 0);
    refuse = null;
    await m.act(() => m.pr(m.by('phone-target-form')).onSubmit({ preventDefault() {} }));
    assert.deepEqual(calls.at(-1), [3, 25]);
    assert.equal(changed, 1);
    assert.equal(m.by('phone-target-form'), undefined);
  } finally { await m.unmount(); }
});

// ── Loading and unreadable ────────────────────────────────────────────────

test('the root while loading is busy placeholders; an unreadable overview says so, with its retry', () => {
  assert.match(tag(html({ cycle: 'grow', status: 'loading' }), 'phone-root'), /aria-busy="true"/);
  const out = html({ cycle: 'grow', status: 'unreadable', onRetry: () => {} });
  assert.ok(renderedText(out).includes('This is not a claim that nothing is recorded.'));
  assert.doesNotMatch(out, /phone-focus|phone-index/);
});

// ── 14. One breakpoint (PR 1a's part) ─────────────────────────────────────

test('14: the root has no md: rule and reads no width of its own; every light class has its dark pair', () => {
  const src = readFileSync('frontend/src/pages/cycles/PhoneCycleRoot.jsx', 'utf8');
  assert.doesNotMatch(src, /\bmd:/);
  assert.doesNotMatch(src, /matchMedia|innerWidth/);
  for (const light of ['text-gray-900', 'text-gray-600', 'bg-violet-700', 'text-violet-700', 'border-[#f0eff3]', 'bg-[#ececf1]']) {
    for (const line of src.split('\n').filter((l) => l.includes(`${light} `) || l.includes(`${light}"`))) {
      assert.match(line, /dark:/, `${light} without a dark: pair: ${line.trim().slice(0, 80)}`);
    }
  }
});

// ── PR 1b: CycleRoute picks the page (tests 1 and 4 on the route) ─────────

/** `CycleRoute` at `/<cycle>?project_id=3`, the overview read stubbed with `READS[cycle]`, at phone width or not. */
async function mountRoute(cycle, { phone, shellRole = null, read = READS[cycle] } = {}) {
  resetStores();
  const restore = installDocument();
  const unstub = stubReads();
  const media = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({ matches: phone && query === PHONE_QUERY, media: query, addEventListener() {}, removeEventListener() {} });
  const fetchBefore = globalThis.fetch;
  const reads = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    reads.push(path);
    const body = path.includes(`/cycles/${cycle}/overview`) ? read : {};
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const page = h(MemoryRouter, { initialEntries: [`/${cycle}${Q}`] }, h(Routes, null, h(Route, { path: `/${cycle}`, element: h(CycleRoute, { cycle }) })));
  await act(async () => { root.render(shellRole ? h(ViewModeContext.Provider, { value: { shellRole } }, page) : page); });
  await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const ids = () => walk(container).map((n) => pr(n)['data-testid']).filter(Boolean);
  return {
    reads, ids, all: (id) => ids().filter((x) => x === id),
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = fetchBefore; globalThis.matchMedia = media; unstub(); restore(); resetStores(); },
  };
}
const ALSO_IN_ID = { validate: 'also-in-validate', build: 'also-in-build', raise: 'also-in-raise', grow: 'also-in-grow' };

for (const cycle of Object.keys(READS)) {
  test(`1 (route): below 1024px /${cycle} draws the ${NAMES[cycle]} root alone; at 1024px the overview and "Also in", and no root`, async () => {
    const phone = await mountRoute(cycle, { phone: true });
    try {
      const ids = phone.ids();
      assert.equal(phone.all('phone-root').length, 1, 'the root, once');
      assert.ok(ids.includes('phone-focus-cta') && ids.includes('phone-index'), 'drawn from the overview read');
      for (const desktop of ['cycle-overview', 'cycle-figures', 'cycle-cards', ALSO_IN_ID[cycle]]) {
        assert.ok(!ids.includes(desktop), `${desktop} is not drawn below 1024px`);
      }
      assert.equal(phone.reads.filter((r) => r.includes(`/cycles/${cycle}/overview`)).length, 1, 'one overview read');
    } finally { await phone.unmount(); }
    const desk = await mountRoute(cycle, { phone: false });
    try {
      const ids = desk.ids();
      assert.ok(ids.includes('cycle-overview'), 'the desktop overview');
      assert.equal(ids.includes(ALSO_IN_ID[cycle]), ALSO[cycle].length > 0, '"Also in", where the map lists pages');
      assert.ok(!ids.includes('phone-root') && !ids.includes('phone-focus'), 'no root at 1024px');
    } finally { await desk.unmount(); }
  });
}

test('4 (route): through CycleRoute a founder gets exactly one "Open Eadwyn for this page" button on the root; an admin shell gets none', async () => {
  for (const cycle of ['validate', 'grow']) {
    const founder = await mountRoute(cycle, { phone: true, shellRole: 'founder' });
    try { assert.equal(founder.all('button-eadwyn-open').length, 1, `${cycle}: one`); } finally { await founder.unmount(); }
    const admin = await mountRoute(cycle, { phone: true, shellRole: 'admin' });
    try { assert.equal(admin.all('button-eadwyn-open').length, 0, `${cycle}: none`); } finally { await admin.unmount(); }
  }
  // A partner-shaped Validate read: the route draws the Worker's six rows, and adds no Verdict.
  const partner = await mountRoute('validate', { phone: true, read: { ...READS.validate, index: READS.validate.index.filter((r) => r.key !== 'verdict') } });
  try {
    assert.equal(partner.ids().filter((x) => x.startsWith('phone-index-')).length, 6);
    assert.ok(!partner.ids().includes('phone-index-verdict'));
  } finally { await partner.unmount(); }
});

test('14 (PR 1): ValidatePhoneFocus is gone; the route\'s phone branch reads usePhoneWidth(); the overview header and pages/cycles read no width of their own', () => {
  assert.throws(() => readFileSync('frontend/src/pages/cycles/ValidatePhoneFocus.jsx', 'utf8'), /ENOENT/);
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.doesNotMatch(route, /ValidatePhoneFocus/);
  assert.match(route, /const phone = usePhoneWidth\(\);/);
  assert.match(route, /body = phone \? \(\n\s+<PhoneCycleRoot /, 'the root replaces the overview below 1024px');
  const overview = readFileSync('frontend/src/pages/cycles/CycleOverview.jsx', 'utf8');
  const header = overview.slice(overview.indexOf('export function CycleHeader'), overview.indexOf('export default function'));
  assert.ok(header.length > 0);
  assert.doesNotMatch(header, /\bmd:/, 'the header switches at lg, with the route');
  assert.match(header, /hidden flex-wrap gap-1\.5 lg:flex/);
  assert.match(header, /px-3\.5 lg:hidden/);
  for (const f of ['CycleRoute.jsx', 'CycleOverview.jsx', 'PhoneCycleRoot.jsx', 'validatePhone.js']) {
    assert.doesNotMatch(readFileSync(`frontend/src/pages/cycles/${f}`, 'utf8'), /matchMedia|innerWidth/, f);
  }
  // Validate's client-built rows are gone with the object they read.
  assert.doesNotMatch(readFileSync('frontend/src/pages/cycles/validatePhone.js', 'utf8'), /validateRows|index\.booked|usdShort/);
});
