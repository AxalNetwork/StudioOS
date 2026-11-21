/**
 * D6212 (#6212): Eadwyn's note on the Portfolio Overview and Performance, as two ZoneDraft bands.
 * Each band is mounted with the props its page passes, and walked through loading, Not recorded, Unavailable,
 * Refused and a draft that is kept only on Accept.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_notes_6212.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import ZoneDraft from '../src/workspaces/ZoneDraft.jsx';
import { CHECKING } from '../src/workspaces/draftCheck.js';
import { INVESTOR_RAIL_OPTIONS } from '../src/lib/railOptions/investor.js';

const h = React.createElement;
const read = (f) => readFileSync(resolve('frontend/src', f), 'utf8');

const BANDS = [
  { file: 'pages/investor/InvestorPortfolioPerformance.jsx', surface: 'portfolio/performance', option: 'draft:performance-note', page: 'Investor · Portfolio · Performance' },
  { file: 'pages/investor/InvestorPortfolioCanvas.jsx', surface: 'portfolio/overview', option: 'draft:portfolio-read', page: 'Investor · Portfolio' },
];

/** The ZoneDraft element a page renders, its string props read from the source. */
function bandProps(file, surface) {
  const src = read(file);
  const m = [...src.matchAll(/<ZoneDraft\s+surface="([^"]*)"([\s\S]*?)\/>/g)].find((x) => x[1] === surface)?.slice(1);
  assert.ok(m, `${file} mounts no ZoneDraft for ${surface}`);
  const props = { surface };
  for (const [, k, v] of m[1].matchAll(/(\w+)="([^"]*)"/g)) props[k] = v;
  return props;
}

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const text = (n = container) => txt(n).replace(/\s+/g, ' ').trim();
  const button = (label) => walk(container).find((n) => n.tagName === 'BUTTON' && text(n) === label);
  return {
    by, pr, settle, text, button,
    press(n) { let p; act(() => { p = pr(n).onClick?.({ preventDefault() {} }); }); return p; },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const err = (code, status, message = 'x') => Object.assign(new Error(message), { code, status, data: { detail: code, message } });

for (const band of BANDS) {
  test(`${band.surface}: the page mounts the band with its option, and the option is a rail row`, () => {
    const p = bandProps(band.file, band.surface);
    assert.equal(p.railOption, band.option);
    assert.ok(p.nothingToDraft && p.run && p.accept && p.label);
    assert.match(p.foot, /nothing is sent/);
    assert.doesNotMatch(Object.values(p).join(' '), /recommend|advice/i);
    const row = INVESTOR_RAIL_OPTIONS.find((o) => o.key === band.option);
    assert.equal(row.page, band.page);
    assert.equal(row.source.match, `surface="${band.surface}"`);
    assert.equal(row.kind, 'numbers');
  });

  test(`${band.surface}: loading, Not recorded, Unavailable and Refused`, async () => {
    const orig = { ...api.research };
    const props = bandProps(band.file, band.surface);
    api.research.zoneDrafts = async () => ({ items: [] });
    try {
      // Loading: the run is in flight and the band says it is checking.
      let open;
      api.research.zoneDraftRun = () => new Promise((r) => { open = r; });
      let m = await mount(h(ZoneDraft, props));
      const pending = m.press(m.button(props.run));
      await m.settle();
      assert.equal(m.text(m.by('zone-draft-checking')), CHECKING);
      open({ item: null });
      await act(async () => { await pending; });
      await m.unmount();

      // Not recorded: the Worker found nothing to explain; the band says the page's sentence.
      api.research.zoneDraftRun = async () => { throw err('nothing_to_draft', 409); };
      m = await mount(h(ZoneDraft, props));
      await act(async () => { await m.press(m.button(props.run)); });
      await m.settle();
      assert.equal(m.text(m.by('zone-draft-note')), props.nothingToDraft);
      await m.unmount();

      // Unavailable: the model could not answer.
      api.research.zoneDraftRun = async () => { throw err('draft_unavailable', 503); };
      m = await mount(h(ZoneDraft, props));
      await act(async () => { await m.press(m.button(props.run)); });
      await m.settle();
      assert.equal(m.text(m.by('zone-draft-note')), 'That draft could not be written right now.');
      await m.unmount();

      // Refused: the guard withheld the draft; its words, never the text.
      api.research.zoneDraftRun = async () => { throw err('guard_blocked_output', 503, 'This draft was held back.'); };
      m = await mount(h(ZoneDraft, props));
      await act(async () => { await m.press(m.button(props.run)); });
      await m.settle();
      assert.match(m.text(m.by('zone-draft-note')), /This draft was held back\./);
      assert.ok(!m.button(props.accept), 'nothing to accept');
      await m.unmount();
    } finally { Object.assign(api.research, orig); }
  });

  test(`${band.surface}: a draft is kept only when the member presses Accept`, async () => {
    const orig = { ...api.research };
    const props = bandProps(band.file, band.surface);
    const accepted = [];
    api.research.zoneDrafts = async () => ({ items: [] });
    api.research.zoneDraftRun = async () => ({ item: { uid: 'n1', body: 'NAV rose from $120,000 (Q1 2026) to $200,000 (Q3 2026).', accepted: false, cost_usd: 0 } });
    api.research.zoneDraftAccept = async (uid, body) => { accepted.push({ uid, body }); return { item: { uid, body: 'x', accepted: true } }; };
    const m = await mount(h(ZoneDraft, props));
    try {
      await act(async () => { await m.press(m.button(props.run)); });
      await m.settle();
      assert.ok(m.text().includes('NAV rose from $120,000 (Q1 2026)'));
      assert.deepEqual(accepted, [], 'drafting writes nothing the member has not accepted');
      await act(async () => { await m.press(m.button(props.accept)); });
      await m.settle();
      assert.equal(accepted.length, 1);
      assert.equal(accepted[0].uid, 'n1');
    } finally { await m.unmount(); Object.assign(api.research, orig); }
  });
}
