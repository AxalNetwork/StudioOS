// D4477: LR7's recorded filters, safe transcript text and explicit initial playback time.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { readCatalog } from '../src/pages/learning/learningReads.js';
import { ALL_LIMIT } from '../src/pages/learning/learningModel.js';
import { itemHrefAt, parseVideoTime, transcriptHit, VIDEO_LENGTH_OPTIONS, videoCountLabel, videoFilters, videoStartAt, withVideoFilter } from '../src/pages/learning/videoLibraryModel.js';
import VideosLibrary from '../src/pages/learning/VideosLibrary.jsx';
import LearningHome, { HoverPreview, LearningHomeView, LearningPhoneView } from '../src/pages/learning/LearningHome.jsx';
import { ItemPage, ItemView } from '../src/pages/learning/LearningWired.jsx';
import { learningApi } from '../src/lib/api/learning.js';
import { articles } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

const row = { kind: 'video', key: 'video:v1', uid: 'v1', href: '/learning/videos/v1', title: 'Finding customers', seconds: 1120, topic: 'Validate', level: 'Intro', query: 'warm introductions',
  match: { in: 'transcript', snippet: 'Try Warm Introductions before advertising.', at_seconds: 252 } };
const render = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(VideosLibrary, props)));

test('readCatalog forwards recorded filters and preserves transcript query, poster and unknown length', async () => {
  const seen = [];
  const client = { catalog: async (params) => { seen.push(params); return { items: [{ id: 'v1', kind: 'video', title: 'Finding customers', duration_seconds: null, thumbnail_url: '/poster.png', match: row.match }], sources: { video: { status: 'ready', total: 1 } } }; } };
  const result = await readCatalog({ kind: 'video', q: 'warm introductions', topic: 'Validate', level: 'intro', max_minutes: 30, offset: 10 }, client);
  assert.deepEqual(seen[0], { kind: 'video', q: 'warm introductions', topic: 'Validate', level: 'intro', max_minutes: 30, limit: ALL_LIMIT, offset: 10 });
  assert.equal(result.rows[0].seconds, null);
  assert.equal(result.rows[0].poster, '/poster.png');
  assert.equal(result.rows[0].query, 'warm introductions');
  assert.deepEqual(result.rows[0].match, row.match);
  await readCatalog({}, client);
  assert.equal(seen[1].topic, undefined); assert.equal(seen[1].level, undefined); assert.equal(seen[1].max_minutes, undefined);
});

test('length choices and counts do not invent a total', () => {
  assert.deepEqual(VIDEO_LENGTH_OPTIONS, [{ label: 'any', minutes: null }, { label: 'up to 10 min', minutes: 10 }, { label: 'up to 30 min', minutes: 30 }]);
  assert.equal(videoCountLabel(6, 41), '6 of 41 videos');
  assert.equal(videoCountLabel(6, null), '6 videos');
  assert.equal(videoCountLabel(6, undefined), '6 videos');
  assert.equal(videoCountLabel(0, 0), '0 of 0 videos');
});

test('a transcript hit splits literal mixed case text, and preserves a snippet without the query', () => {
  assert.deepEqual(transcriptHit(row), { title: 'Finding customers', seconds: 252, at: '04:12', before: 'Try ', match: 'Warm Introductions', after: ' before advertising.' });
  assert.deepEqual(transcriptHit({ ...row, query: 'absent' }), { title: 'Finding customers', seconds: 252, at: '04:12', before: row.match.snippet, match: '', after: '' });
  assert.equal(transcriptHit({ ...row, match: null }), null);
  const untimed = transcriptHit({ ...row, match: { ...row.match, at_seconds: null } });
  assert.equal(untimed.seconds, null); assert.equal(untimed.at, null);
  assert.equal(transcriptHit({ ...row, query: '[x]', match: { in: 'transcript', snippet: 'Use [X] literally.', at_seconds: 0 } }).match, '[X]');
});

test('time links are encoded, bounded integers and take precedence over saved progress including zero', () => {
  assert.equal(itemHrefAt({ ...row, uid: 'a/b' }, 252), '/learning/videos/a%2Fb?t=252');
  assert.equal(itemHrefAt(row, null), row.href);
  for (const value of ['-1', 'oops', '1121', '1.5', '1e2', '', null]) assert.equal(parseVideoTime(value, 1120), null, String(value));
  assert.equal(parseVideoTime('0', 1120), 0); assert.equal(parseVideoTime('1120', 1120), 1120);
  assert.equal(parseVideoTime('10', null), null);
  assert.equal(parseVideoTime('9007199254740992', 1e20), null);
  assert.equal(videoStartAt('252', 1120, 600), 252);
  assert.equal(videoStartAt('0', 1120, 600), 0);
  assert.equal(videoStartAt('oops', 1120, 600), 600);
});

test('filter updates retain unrelated URL state and earlier entries for browser history', () => {
  const original = new URLSearchParams('tab=all&project_id=12');
  const topic = withVideoFilter(original, 'topic', 'Validate');
  const level = withVideoFilter(topic, 'level', 'intro');
  const max = withVideoFilter(level, 'max', '30');
  assert.equal(original.toString(), 'tab=all&project_id=12');
  assert.deepEqual(videoFilters(max), { topic: 'Validate', level: 'intro', max: '30' });
  assert.equal(max.get('tab'), 'videos'); assert.equal(max.get('project_id'), '12');
  assert.deepEqual(videoFilters(withVideoFilter(max, 'max', '')), { topic: 'Validate', level: 'intro', max: '' });
  assert.equal(topic.has('level'), false);
});

test('LR7 renders recorded filters, escaped marked text, timed links, posters and unknown length', () => {
  const markup = render({ state: { status: 'ready', rows: [row, { ...row, key: 'video:v2', uid: 'v2', title: 'Untimed video', seconds: null, poster: '/poster.png', match: null }], sources: { video: { status: 'ready', total: 2 } } }, total: 41, filters: { topic: 'Validate', level: 'intro', max: '30' } });
  assert.match(markup, /2 of 41 videos/); assert.match(markup, /<mark[^>]*>Warm Introductions<\/mark>/);
  assert.equal((markup.match(/href="\/learning\/videos\/v1\?t=252"/g) || []).length, 2);
  assert.match(markup, /Open at 04:12/); assert.match(markup, /Length not recorded/); assert.doesNotMatch(markup, />0:00</);
  assert.match(markup, /18:40/);
  assert.match(markup, /src="\/poster.png"/); assert.match(markup, /<article[^>]*tabindex="0"/);
  assert.match(markup, /grid-cols-1[^\"]*lg:grid-cols-3/); assert.match(markup, /min-h-11/); assert.match(markup, /dark:bg-violet-950/);
  for (const literal of ['<script>', '<SCRIPT>', '<ScRiPt>', '<ScRiPt data-example="literal">']) {
    const unsafe = render({ state: { status: 'ready', rows: [{ ...row, query: literal, match: { ...row.match, snippet: `Try ${literal} now` } }], sources: {} } });
    assert.match(unsafe, /&lt;script(?:&gt;|\s)/i);
    assert.doesNotMatch(unsafe, /<script\b/i);
  }
  const untimed = render({ state: { status: 'ready', rows: [{ ...row, match: { ...row.match, at_seconds: null } }], sources: {} } });
  assert.match(untimed, /Time not recorded/); assert.doesNotMatch(untimed, /Open at/);
});

test('the max-minutes refusal is the route sentence, never raw exception text', async () => {
  const result = await readCatalog({ max_minutes: '-1' }, { catalog: async () => { throw Object.assign(new Error('private failure detail'), { code: 'bad_max_minutes' }); } });
  const markup = render({ state: { status: 'ready', ...result } });
  assert.match(markup, /max_minutes is a whole number of minutes from 1 to 1440\./);
  assert.doesNotMatch(markup, /private failure detail|0 videos/);
  const failed = render({ state: { status: 'unreadable' } });
  assert.doesNotMatch(failed, /0 videos|No videos match/);
});

test('the item view gives a valid time precedence over resume and retains resume for an invalid time', () => {
  const state = { status: 'ready', item: { uid: 'v1', kind: 'video', duration_seconds: 1120 }, progress: { position_seconds: 600 } };
  assert.equal(ItemView({ state, initialTime: '252' }).props.resumeFrom, 252);
  assert.equal(ItemView({ state, initialTime: '0' }).props.resumeFrom, 0);
  assert.equal(ItemView({ state, initialTime: '1121' }).props.resumeFrom, 600);
});

function stubLearning() {
  const before = { ...learningApi };
  const calls = [];
  learningApi.catalog = async params => {
    calls.push(params);
    return { items: [{ id: 'v1', kind: 'video', title: row.title, topic: 'Validate', level: 'intro', duration_seconds: 1120, match: row.match }], sources: { video: { status: 'ready', total: params.topic ? 1 : 41 } } };
  };
  learningApi.me = async () => ({ in_progress: [], completed: [] });
  learningApi.myStats = async () => ({});
  learningApi.programs = learningApi.myEnrolledPrograms = async () => ({ programs: [] });
  learningApi.webinars = async () => ({ webinars: [] });
  learningApi.item = async () => ({ item: { uid: 'v1', kind: 'video', title: row.title, duration_seconds: 1120, video_source: 'r2', video_stream_url: '/api/learning/items/v1/video' }, progress: { position_seconds: 600 } });
  return { calls, restore() { Object.assign(learningApi, before); } };
}

test('mounted Videos filters send the selection, push URL history, and restore the earlier choice on Back', async () => {
  const stub = stubLearning();
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let search;
  function Probe() {
    search = useLocation().search;
    const navigate = useNavigate();
    return React.createElement('button', { onClick: () => navigate(-1) }, 'Back');
  }
  let ui;
  try {
    ui = await mountContracts(React.createElement(React.Fragment, null, React.createElement(Probe), React.createElement(LearningHome, { gated: false })), '/learning?tab=videos&q=warm+introductions', { id: 1, role: 'founder' });
    await ui.flush();
    const searchInput = ui.nodes().find(n => ui.props(n)?.['data-testid'] === 'input-learning-search');
    assert.equal(Boolean(searchInput), true);
    let searchParent = searchInput.parentNode;
    while (searchParent && ui.props(searchParent)?.['data-testid'] !== 'video-filters') searchParent = searchParent.parentNode;
    assert.equal(Boolean(searchParent), true, 'search belongs to the LR7 filter row');
    await ui.fill('Topic', 'Validate'); await ui.flush();
    await ui.fill('Level', 'intro'); await ui.flush();
    await ui.fill('Length', '30'); await ui.flush();
    assert.equal(new URLSearchParams(search).get('max'), '30');
    assert.ok(stub.calls.some(p => p.kind === 'video' && p.topic === 'Validate' && p.level === 'intro' && p.max_minutes === '30'));
    assert.match(ui.text(), /1 of 41 videos/);
    await ui.click('Back'); await ui.flush();
    assert.equal(new URLSearchParams(search).has('max'), false);
    assert.equal(new URLSearchParams(search).get('level'), 'intro');
    assert.equal(stub.calls.at(-1).max_minutes, undefined);
    const selects = ui.nodes().filter(n => n.tagName === 'SELECT');
    assert.equal(ui.props(selects[2]).value, '');
  } finally { await ui?.unmount(); stub.restore(); globalThis.matchMedia = oldMedia; }
});

test('the mounted item reads t from the URL and applies it on initial metadata only', async () => {
  const stub = stubLearning();
  let ui;
  try {
    ui = await mountContracts(React.createElement(ItemPage, { uid: 'v1' }), '/learning/videos/v1?t=252', { id: 1, role: 'founder' });
    await ui.flush();
    const video = ui.nodes().find(n => n.tagName === 'VIDEO');
    assert.equal(Boolean(video), true);
    const target = { currentTime: 0 };
    await act(async () => ui.props(video).onLoadedMetadata({ currentTarget: target }));
    assert.equal(target.currentTime, 252);
    target.currentTime = 300;
    await act(async () => ui.props(video).onLoadedMetadata({ currentTarget: target }));
    assert.equal(target.currentTime, 300, 'metadata does not repeatedly reset the chosen position');
  } finally { await ui?.unmount(); stub.restore(); }
});

test('the library preview waits 400ms, ignores touch, names playback and stays hidden after a late hover read', async () => {
  const handlers = {};
  let reads = 0, finish;
  const read = () => { reads += 1; return new Promise(resolve => { finish = resolve; }); };
  const ref = node => { if (node) { for (const child of node.childNodes) Object.defineProperty(child, 'parentElement', { configurable: true, get() { return this.parentNode; } }); node.addEventListener = (name, handler) => { handlers[name] = handler; }; node.removeEventListener = name => { delete handlers[name]; }; } };
  const ui = await mountContracts(React.createElement('article', { ref }, React.createElement(HoverPreview, { uid: 'v1', read, library: true })));
  const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  try {
    await act(async () => handlers.pointerenter({ pointerType: 'touch' })); await wait(420);
    assert.equal(reads, 0);
    await act(async () => handlers.pointerenter({ pointerType: 'mouse' })); await wait(100);
    assert.equal(reads, 0);
    await wait(320); assert.equal(reads, 1);
    await act(async () => { handlers.pointerleave(); finish('/preview.png'); }); await ui.flush();
    assert.doesNotMatch(ui.text(), /Preview playing/);
    await act(async () => handlers.pointerenter({ pointerType: 'mouse' })); await wait(420);
    await act(async () => finish('/preview.png')); await ui.flush();
    assert.match(ui.text(), /Preview playing/);
    await act(async () => handlers.pointerleave());
    assert.doesNotMatch(ui.text(), /Preview playing/);
  } finally { await ui.unmount(); }
});

test('switching from a later Articles page through Videos filters and back restarts Articles at page one', async () => {
  const stub = stubLearning();
  const previous = articles.list;
  const articleCalls = [];
  articles.list = async params => { articleCalls.push(params); return { items: [{ id: 1, slug: 'synthetic', title: 'Synthetic article' }], total: 90 }; };
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let ui;
  try {
    ui = await mountContracts(React.createElement(LearningHome, { gated: false }), '/learning?tab=articles', { id: 1, role: 'founder' });
    await ui.flush();
    await ui.click('Older'); await ui.flush();
    assert.ok(articleCalls.at(-1).offset > 0);
    await ui.click('Videos'); await ui.flush();
    await ui.fill('Topic', 'Validate'); await ui.flush();
    await ui.click('Articles'); await ui.flush();
    assert.equal(articleCalls.at(-1).offset, 0);
  } finally { await ui?.unmount(); stub.restore(); articles.list = previous; globalThis.matchMedia = oldMedia; }
});


test('merged Learning home keeps Videos isolated and renders one phone tab bar',()=>{
  const state={status:'ready',rows:[row],sources:{video:{status:'ready',total:1}}};
  const wrapped=element=>renderToStaticMarkup(React.createElement(MemoryRouter,null,element));
  const desktop=wrapped(React.createElement(LearningHomeView,{gated:false,tab:'videos',catalog:state}));
  assert.match(desktop,/data-view="videos-library"/);
  assert.doesNotMatch(desktop,/data-testid="section-continue"|data-testid="section-webinars"/);
  const phone=wrapped(React.createElement(LearningPhoneView,{gated:false,tab:'videos'},React.createElement(VideosLibrary,{state})));
  assert.match(phone,/data-view="videos-library"/);
  assert.equal((phone.match(/role="tablist"/g)||[]).length,1);
  assert.doesNotMatch(phone,/data-testid="learning-phone-primary"|data-testid="learning-phone-programs"|data-testid="learning-phone-webinars"/);
});

test('mounted phone Videos uses one tab bar and omits the home action sections',async()=>{
  const stub=stubLearning(),oldMedia=globalThis.matchMedia;let ui;
  globalThis.matchMedia=q=>({matches:q.includes('max-width'),media:q,addEventListener(){},removeEventListener(){}});
  try{
    ui=await mountContracts(React.createElement(LearningHome,{gated:false}),'/learning?tab=videos',{id:1,role:'founder'});
    await ui.flush();
    assert.equal(ui.nodes().filter(n=>ui.props(n)?.role==='tablist').length,1);
    assert.ok(ui.nodes().some(n=>ui.props(n)?.['data-testid']==='video-filters'));
    assert.equal(ui.nodes().filter(n=>['learning-phone-primary','learning-phone-programs','learning-phone-webinars'].includes(ui.props(n)?.['data-testid'])).length,0);
  }finally{await ui?.unmount();stub.restore();globalThis.matchMedia=oldMedia;}
});

test('Back and Forward to video filters restart at the first page without a stale-offset request',async()=>{
  const stub=stubLearning(),oldMedia=globalThis.matchMedia;let ui;
  learningApi.catalog=async params=>{stub.calls.push(params);return {items:[{id:'v1',kind:'video',title:row.title}],sources:{video:{status:'ready',total:41}}};};
  globalThis.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){}});
  function History(){const navigate=useNavigate();return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>navigate(-1)},'Back'),React.createElement('button',{onClick:()=>navigate(1)},'Forward'));}
  const readsSince=n=>stub.calls.slice(n).filter(p=>p.kind==='video'&&p.offset!==undefined);
  try{
    ui=await mountContracts(React.createElement(React.Fragment,null,React.createElement(History),React.createElement(LearningHome,{gated:false})),'/learning?tab=videos',{id:1,role:'founder'});
    await ui.flush();await ui.fill('Topic','Validate');await ui.flush();await ui.click('Next');await ui.flush();
    assert.equal(readsSince(0).at(-1).offset,ALL_LIMIT);
    let start=stub.calls.length;await ui.click('Back');await ui.flush();
    assert.ok(readsSince(start).length>0);assert.ok(readsSince(start).every(p=>p.offset===0&&!p.topic),'Back must not read the old page of the restored filter');
    start=stub.calls.length;await ui.click('Forward');await ui.flush();
    assert.ok(readsSince(start).length>0);assert.ok(readsSince(start).every(p=>p.offset===0&&p.topic==='Validate'),'Forward must not revive the old page');
  }finally{await ui?.unmount();stub.restore();globalThis.matchMedia=oldMedia;}
});
