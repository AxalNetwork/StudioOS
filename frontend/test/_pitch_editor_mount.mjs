/**
 * D1604 (#3716): the Pitch deck editor mounted on stubbed reads, for the v2
 * chrome and selection suites. Every venture, card and figure is synthetic.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { deckImagesApi } from '../src/lib/api/deckImages.js';
import { deckCheckApi } from '../src/lib/api/deckCheck.js';
import { railProposalsApi } from '../src/lib/api/railProposals.js';
import { deckAssistApi } from '../src/lib/api/deckAssist.js';
import { railPrefsApi } from '../src/lib/api/railPrefs.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PitchEditor from '../src/pages/raise/pitch/PitchEditor.jsx';

const h = React.createElement;

/** GET /api/decks/model, in the Worker's shape (a subset of its layouts). */
export const MODEL = {
  grid: { cols: 12, rows: 6 }, max_blocks: 24, notes_max: 4000,
  layouts: [
    { id: 'statement', label: 'Statement', blocks: [{ kind: 'text', grid: { c1: 2, c2: 11, r1: 2, r2: 5 }, style: 'heading' }] },
    { id: 'title', label: 'Title', blocks: [{ kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, style: 'heading' }, { kind: 'text', grid: { c1: 1, c2: 12, r1: 4, r2: 4 }, style: 'paragraph' }] },
  ],
  block_kinds: ['text', 'chart', 'graphic', 'image', 'video', 'audio', 'link', 'metric'],
  chart_types: ['line'], chart_ranges: ['all'], text_styles: ['heading', 'paragraph', 'list'], image_tags: ['photo'],
  video_ratios: ['16:9'], audiences: ['angel', 'seed_fund'], themes: ['brand', 'neutral_light', 'neutral_dark'],
};

/** Card 1: a title, a body and a bound metric, with free ranges left on the Grid. */
export const CARD = {
  title: 'Synthetic traction', layout: 'title', notes: 'Synthetic note',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: 'Synthetic heading' },
    { id: 'b2', kind: 'text', grid: { c1: 1, c2: 7, r1: 2, r2: 6 }, style: 'paragraph', text: 'Synthetic body words' },
    { id: 'b3', kind: 'metric', grid: { c1: 8, c2: 10, r1: 2, r2: 3 }, label: 'MRR', value: '4200', binding: { source_key: 'revenue.mrr', as_of: '2026-10-01', grade: 'Measured' } },
  ],
};
export const DECK = { id: 31, project_id: 7, version: 3, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00', audience: 'seed_fund', theme: null, slides: [CARD, { title: 'Synthetic second', blocks: [] }] };
export const FOUNDER = { id: 2, role: 'founder', founder_id: 20, name: 'Synthetic Founder' };
export const ADMIN = { id: 21, role: 'admin', name: 'Synthetic Admin' };
const SOURCES = { project_id: 7, items: [{ source_key: 'revenue.mrr', label: 'MRR', value: 4200, unit: 'usd', as_of: '2026-10-01', grade: 'Measured', source: 'Connector', state: 'recorded', module: 'Grow › Revenue' }], coverage: { slots: 1, filled: 1, by_grade: {}, not_recorded: 0, unreadable: 0 } };
const VERSIONS = { versions: [{ id: 31, version: 3, is_current: true, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00' }, { id: 30, version: 2, title: 'Synthetic deck', created_at: '2026-10-20 10:00:00' }] };

const groups = { api, deckEditorApi, deckSourcesApi, deckImagesApi, deckCheckApi, railProposalsApi, deckAssistApi, railPrefsApi };

export async function mountEditor({ user = FOUNDER, answers = {} } = {}) {
  const originals = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, { ...v }]));
  const calls = [];
  const stub = (name, fn) => (...a) => { calls.push([name, ...a]); return fn(...a); };
  const reads = {
    getMe: async () => user,
    listProjects: async () => [{ id: 7, name: 'Synthetic Labs' }],
    deckListVersions: async () => VERSIONS,
    deckGet: async () => DECK,
    deckExportList: async () => ({ exports: [] }),
    'editor.model': async () => MODEL,
    'editor.brandKit': async () => ({ kit: null }),
    'editor.chartSeries': async () => ({ series: [], types: [] }),
    'sources.refresh': async () => ({ rows: [] }),
    'sources.list': async () => SOURCES,
    'images.list': async () => ({ images: [] }),
    'check.read': async () => ({ checked: false, claims: [], can_check: false }),
    'check.versions': async () => ({ versions: [] }),
    'proposals.list': async () => ({ proposals: [] }),
    ...answers,
  };
  const prefix = { editor: deckEditorApi, sources: deckSourcesApi, images: deckImagesApi, check: deckCheckApi, proposals: railProposalsApi, assist: deckAssistApi, prefs: railPrefsApi };
  for (const [name, fn] of Object.entries(reads)) {
    const [p, k] = name.includes('.') ? name.split('.') : [null, name];
    (p ? prefix[p] : api)[k] = stub(name, fn);
  }
  const fetchBefore = globalThis.fetch;
  const restore = installDocument();
  globalThis.fetch = async () => Response.json({});
  localStorage.setItem('user', JSON.stringify(user));
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/raise/pitch/edit?project_id=7'] }, h(AuthProvider, null, h(PitchEditor)))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  const ev = (over = {}) => ({ preventDefault() {}, stopPropagation() {}, target: null, ...over });
  return {
    calls, by, settle, pr, walk, container,
    text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    async press(node, over = {}) {
      if (!node) throw new Error('no such node');
      await act(async () => { await pr(node).onClick?.(ev(over)); }); await settle();
    },
    async fire(node, handler, over = {}) {
      if (!node) throw new Error('no such node');
      await act(async () => { await pr(node)[handler]?.(ev(over)); }); await settle();
    },
    async type(node, value) { await act(async () => { pr(node).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async close() {
      await act(async () => root.unmount()); restore(); globalThis.fetch = fetchBefore;
      for (const [k, v] of Object.entries(groups)) Object.assign(v, originals[k]);
    },
  };
}
