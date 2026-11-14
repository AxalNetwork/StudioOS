/** D6292 (#6292): investor access, recorded context links and the real Cases desk driven by its address. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { mountContracts } from './_contracts_dom.mjs';
import DdCasesTab from '../src/pages/duediligence/DdCasesTab.jsx';
import { OverviewTab } from '../src/pages/duediligence/DdCaseWork.jsx';
import { useDiligenceInvolvement, resetDiligenceInvolvement } from '../src/pages/duediligence/useDiligenceInvolvement.js';
import { SIDEBAR_GROUPS, withDiligenceRow } from '../src/sidebarConfig.js';
import { caseContextLinks } from '../src/pages/duediligence/ddCaseModel.js';
import { listQuery, readCasesSearch, writeCasesSearch } from '../src/pages/duediligence/ddListModel.js';
import { ddDeskApi } from '../src/lib/api/ddDesk.js';
const h = React.createElement;
const ME = { id: 21, role: 'investor' };
const ROW = { uid: 'synthetic-case', subject_label: 'Synthetic company', subject_type: 'project', subject_id: 7, status: 'in_review', lead_user_id: 21, lead_name: 'Synthetic lead', template_depth: 'standard', checklist_total: 0, checklist_done: 0, open_flags: 0, requests_waiting: 0, created_at: '2026-01-01' };
const STATE = '?stage=in_review&sort=target&q=alpha&page=2&page_size=25&subject_type=project&risk_band=red&template=deep&decision=none&lead=21&past_target=1&keep=1';
const data = cs => ({ case: { status: 'in_review', risk_score: null, risk_band: null, subject_type: 'project', subject_label: 'Synthetic company', ...cs }, sections: [], checklist: [], flags: [], requests: [], reviewers: [], allowed: {} });
async function desk(url = STATE, load) {
  const original = { cases: ddDeskApi.cases, overview: ddDeskApi.overview };
  const calls = []; const nav = {};
  ddDeskApi.cases = async query => { calls.push(query); return load ? load(query) : { items: [ROW], total: 100 }; };
  ddDeskApi.overview = async () => ({ stages: { available: true }, ages: { available: false }, decisions: { available: false } });
  function Probe() { nav.go = useNavigate(); nav.search = useLocation().search; return null; }
  const m = await mountContracts(h(React.Fragment, null, h(DdCasesTab, { me: ME, now: Date.parse('2026-11-14') }), h(Probe)), '/due-diligence' + url);
  const settle = async () => { for (let i = 0; i < 4; i++) await m.flush(); };
  await settle();
  const byId = id => m.nodes().find(n => m.props(n)?.['data-testid'] === id);
  const props = id => m.props(byId(id));
  const press = async id => { await act(async () => props(id).onClick({ preventDefault() {} })); await settle(); };
  const change = async (id, value) => { await act(async () => props(id).onChange({ target: { value } })); await settle(); };
  return { ...m, calls, nav, byId, props, press, change, settle, async close() { await m.unmount(); Object.assign(ddDeskApi, original); } };
}

test('address parsing validates list controls and writing preserves unrelated parameters', () => {
  const state = readCasesSearch(STATE);
  assert.deepEqual(listQuery(state), { sort: 'target', page: 2, page_size: 25, subject_type: 'project', risk_band: 'red', template: 'deep', decision: 'none', lead: '21', past_target: 1, stage: 'in_review', q: 'alpha' });
  const params = new URLSearchParams(writeCasesSearch(STATE, { ...state, page: 3 }));
  assert.equal(params.get('page'), '3'); assert.equal(params.get('keep'), '1'); assert.equal(params.get('stage'), 'in_review');
  const bad = readCasesSearch('?stage=__proto__&sort=unknown&page=-1&page_size=900&lead=../admin&risk_band=unknown&past_target=0');
  assert.deepEqual(bad, { filters: {}, stage: '', q: '', sort: 'opened', page: 1, pageSize: 10 });
});

test('loading and reloading the shared address reads the same server query', async () => {
  for (let n = 0; n < 2; n++) {
    const m = await desk();
    try {
      assert.deepEqual(m.calls[0], { sort: 'target', page: 2, page_size: 25, subject_type: 'project', risk_band: 'red', template: 'deep', decision: 'none', lead: '21', past_target: 1, stage: 'in_review', q: 'alpha' });
      assert.equal(m.props('dd-stage-in_review')['aria-pressed'], true);
      assert.equal(m.props('dd-sort').value, 'target'); assert.equal(m.props('dd-search').value, 'alpha');
    } finally { await m.close(); }
  }
});

test('controls, debounced search and browser back keep the address and read in agreement', async (t) => {
  const m = await desk();
  try {
    await m.change('dd-sort', 'flags');
    let params = new URLSearchParams(m.nav.search);
    assert.equal(params.get('sort'), 'flags'); assert.equal(params.get('page'), null); assert.equal(params.get('keep'), '1');
    await m.press('dd-stage-not_started');
    assert.equal(m.calls.at(-1).stage, 'not_started');
    await act(async () => m.nav.go(-1)); await m.settle();
    assert.equal(m.props('dd-stage-in_review')['aria-pressed'], true); assert.equal(m.calls.at(-1).sort, 'flags');
    await act(async () => m.nav.go(-1)); await m.settle();
    assert.equal(m.calls.at(-1).page, 2); assert.equal(m.props('dd-sort').value, 'target');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await act(async () => m.props('dd-search').onChange({ target: { value: 'Beta & Co' } }));
    await act(async () => t.mock.timers.tick(249));
    assert.equal(m.calls.at(-1).q, 'alpha', 'the search is not sent before its debounce');
    await act(async () => t.mock.timers.tick(1));
    t.mock.timers.reset();
    await m.settle();
    params = new URLSearchParams(m.nav.search);
    assert.equal(params.get('q'), 'Beta & Co'); assert.equal(m.calls.at(-1).q, 'Beta & Co'); assert.equal(m.calls.at(-1).page, 1);
    await m.press('dd-next');
    assert.equal(new URLSearchParams(m.nav.search).get('page'), '2');
    await act(async () => m.nav.go('/due-diligence?q=Gamma')); await m.settle();
    assert.equal(m.props('dd-search').value, 'Gamma');
    await act(async () => m.nav.go(-1)); await m.settle();
    assert.equal(m.props('dd-search').value, 'Beta & Co');
  } finally { t.mock.timers.reset(); await m.close(); }
});

test('late reads for an old address cannot replace the current list', async () => {
  let release;
  const m = await desk('', query => query.stage === 'in_review' ? new Promise(resolve => { release = resolve; }) : { items: [{ ...ROW, subject_label: 'Current address result' }], total: 1 });
  try {
    await m.press('dd-stage-in_review');
    await m.press('dd-stage-not_started');
    await act(async () => release({ items: [{ ...ROW, subject_label: 'Stale address result' }], total: 1 })); await m.settle();
    assert.match(m.text(), /Current address result/); assert.doesNotMatch(m.text(), /Stale address result/);
  } finally { await m.close(); }
});

test('the empty desk explains the deal Diligence door and links to Deals', async () => {
  const m = await desk('', () => ({ items: [], total: 0 }));
  try { assert.match(m.text(), /Open a case from a deal’s Diligence tab/); assert.equal(m.props('dd-empty-deals').href, '/deals'); }
  finally { await m.close(); }
});

test('case context uses only recorded positive ids and preserves scoped-read boundaries', async () => {
  const cs = { deal_id: 12, subject_id: 7, subject_type: 'project' };
  assert.deepEqual(caseContextLinks(cs), { deal: '/deals/12', company: '/projects/7', dataRoom: '/deals/12/documents' });
  assert.deepEqual(caseContextLinks({ ...cs, scoped: true }), { deal: null, company: null, dataRoom: null });
  for (const value of [null, 0, '../admin', 'javascript:alert(1)', true]) assert.deepEqual(caseContextLinks({ ...cs, deal_id: value, subject_id: value }), { deal: null, company: null, dataRoom: null });
  assert.equal(caseContextLinks({ subject_type: 'founder', subject_id: 7 }).company, null);
  for (const current of [cs, {}, { ...cs, scoped: true }]) {
    const m = await mountContracts(h(OverviewTab, { data: data(current), open() {}, sectionRefs: { current: {} } }), '/due-diligence/synthetic-case');
    try {
      const links = m.nodes().filter(n => m.props(n)?.['data-testid']?.startsWith('dd-context-')).map(n => m.props(n).href);
      if (current === cs) assert.deepEqual(links, ['/deals/12', '/projects/7', '/deals/12/documents']);
      else { assert.deepEqual(links, []); if (!current.scoped) assert.match(m.text(), /DealNot recorded/); }
      assert.ok(links.every(link => !link.startsWith('/admin')));
    } finally { await m.unmount(); }
  }
});

test('eligible investors have a sidebar door without a case-list read; other roles keep their rule', async () => {
  resetDiligenceInvolvement(); let reads = 0; const out = {};
  function Probe({ role, user }) { out.yes = useDiligenceInvolvement(user, role, async () => { reads++; throw new Error('Synthetic unavailable list'); }); return null; }
  for (const role of ['investor', 'advisor', 'partner', 'founder']) {
    const m = await mountContracts(h(Probe, { user: { id: 6292 }, role }));
    try {
      for (let i = 0; i < 3; i++) await m.flush();
      assert.equal(out.yes, role === 'investor');
      const groups = SIDEBAR_GROUPS[role];
      const rows = withDiligenceRow(groups, role, false).flatMap(g => g.items).filter(x => x.to === '/due-diligence');
      assert.equal(rows.length, role === 'investor' ? 1 : 0);
    } finally { await m.unmount(); }
  }
  assert.equal(reads, 2);
});

test('out-of-range pages recover instead of claiming there are no cases', async () => {
  const m = await desk('?page=99', q => ({ items: q.page > 1 ? [] : [ROW], total: 1 }));
  try { await m.settle(); assert.equal(m.calls.at(-1).page, 1); assert.equal(new URLSearchParams(m.nav.search).get('page'), null); assert.match(m.text(), /Synthetic company/); assert.ok(!m.byId('dd-empty')); }
  finally { await m.close(); }
});

test('partners and advisors retain positive involvement and its per-account cache', async () => {
  resetDiligenceInvolvement(); const out = {};
  function Probe({ role, load }) { out.yes = useDiligenceInvolvement({ id: 6293 }, role, load); return null; }
  for (const role of ['partner', 'advisor']) {
    let reads = 0;
    for (let n = 0; n < 2; n++) {
      const load = async () => { reads++; return { items: [ROW], total: 1 }; };
      const m = await mountContracts(h(Probe, { role, load }));
      try { for (let i = 0; i < 3; i++) await m.flush(); assert.equal(out.yes, true); assert.equal(reads, 1); }
      finally { await m.unmount(); }
    }
  }
});
