import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inputsFromDraft, draftFromScenario } from '../src/pages/CapTableVariantsPage.jsx';
const source = readFileSync(new URL('../src/pages/CapTablePage.jsx', import.meta.url), 'utf8');
const variants = readFileSync(new URL('../src/pages/CapTableVariantsPage.jsx', import.meta.url), 'utf8');
function handler(text, start, end, scope) {
  const code = text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
  return new Function(...Object.keys(scope), `${code}; return ${start.includes('selectProject') ? 'selectProject' : start.includes('saveScenario') ? 'saveScenario' : start.includes('loadScenario') ? 'loadScenario' : start.includes('loadCompare') ? 'loadCompare' : 'createVariant'};`)(...Object.values(scope));
}
function setup(read) {
  const state = { inputs: 'untouched', ready: '', errors: null, writes: 0, defaults: 0 };
  const noop = () => {};
  const scope = { scenarios: [], projects: [], projectRead: { current: 0 }, setReadProjectId: v => state.ready=v,
    setSelectedProjectId: noop, setApiError: v => state.errors=v, setCompare: noop, setCompareOpen: noop,
    setCompareError: noop, setSearchParams: noop, setActiveUid: noop, setInputs: v => state.inputs=v,
    setResult: noop, setScenarioName: noop, DEFAULT_INPUTS: { synthetic: true }, runSim: () => state.defaults++,
    api: { getCapTableByProject: read, createCapTableScenario: () => state.writes++ } };
  return { state, scope, select: handler(source, 'async function selectProject', '  async function saveScenario', scope) };
}
for (const error of [Object.assign(new Error('server'), { status: 500 }), new Error('network'), { status: 403 }, { status: 404 }]) {
  test(`failed read ${error.status ?? 'network'} cannot load defaults or save`, async () => {
    const f = setup(async () => { throw error; });
    await f.select(1);
    assert.equal(f.state.ready, ''); assert.equal(f.state.inputs, 'untouched'); assert.equal(f.state.defaults, 0); assert.ok(f.state.errors);
    const save = handler(source, 'async function saveScenario', '  async function loadScenario', { ...f.scope,
      selectedProjectId: '1', readProjectId: f.state.ready });
    await save(); assert.equal(f.state.writes, 0);
    assert.match(source, /onClick=\{saveScenario\} disabled=\{!selectedProjectId \|\| readProjectId !== selectedProjectId\}/);
  });
}
test('only a successful empty read loads defaults; existing scenario loads recorded inputs', async () => {
  const f = setup(async () => ({ scenario: null })); await f.select(1);
  assert.equal(f.state.defaults, 1); assert.equal(f.state.ready, '1');
  const g = setup(async () => ({ scenario: { uid: 'synthetic', inputs: { recorded: true } } })); await g.select(2);
  assert.deepEqual(g.state.inputs, { recorded: true }); assert.equal(g.state.defaults, 0); assert.equal(g.state.ready, '2');
});
test('late prior-project read cannot reopen saving or replace current inputs', async () => {
  let first; const f = setup(id => id === '1' ? new Promise(resolve => first=resolve) : Promise.resolve({ scenario: null }));
  const pending = f.select(1); await f.select(2); first({ scenario: { inputs: { stale: true } } }); await pending;
  assert.equal(f.state.ready, '2'); assert.deepEqual(f.state.inputs, { synthetic: true });
});
test('blank option pool is omitted; explicit zero remains explicit', () => {
  const draft = draftFromScenario({ name: 'Synthetic', inputs: { founders: [], safes: [], rounds: [] } });
  draft.option_pool_pct = '';
  assert.equal('option_pool_pct' in inputsFromDraft(draft).inputs, false);
  draft.option_pool_pct = '0'; assert.equal(inputsFromDraft(draft).inputs.option_pool_pct, 0);
});
test('new variant requires recorded main inputs and copies them without invented holders', async () => {
  let writes=0, error=''; const scope = { read: { kind: 'ready', canonical: null }, setNewError: v=>error=v,
    setCreating: ()=>{}, client: { createCapTableVariant: async ()=>{ writes++; return { uid:'synthetic' }; } }, navigate:()=>{}, variantHref:()=>'' };
  const create = handler(variants, 'const createVariant = async () =>', '\n  const editor', scope);
  await create(); assert.equal(writes,0); assert.equal(error,'Record the cap table first');
  scope.read.canonical = { inputs: { founders: [] } }; scope.read.variants=[];
  scope.client.createCapTableVariant = async (_, body)=>{ assert.deepEqual(body.inputs, { founders: [] }); writes++;return {uid:'synthetic'}; };
  await create(); assert.equal(writes,1);
});

test('saved scenario loads open Save only after a successful current read', async () => {
  const f = setup(async () => null);
  f.scope.api.getCapTableScenario = async () => ({ project_id: 3, inputs: { recorded: true } });
  const load = handler(source, 'async function loadScenario', '  async function delScenario', f.scope);
  await load('synthetic'); assert.equal(f.state.ready, '3'); assert.deepEqual(f.state.inputs, { recorded: true });
  f.scope.api.getCapTableScenario = async () => { throw new Error('network'); };
  await load('synthetic'); assert.equal(f.state.ready, ''); assert.ok(f.state.errors);
});

test('read-only comparison cannot invalidate a successful scenario read', async () => {
  let ready='3'; const generation={current:7};
  const load=handler(source,'async function loadCompare','  function toggleCompare',{
    selectedProjectId:'3',projectRead:generation,setReadProjectId:v=>ready=v,setApiError:()=>{},
    setCompareLoading:()=>{},setCompareError:()=>{},setCompareOpen:()=>{},setCompare:()=>{},
    api:{getCapTableCompare:async()=>({})},
  });
  await load('3',true);assert.equal(ready,'3');assert.equal(generation.current,7);
});
