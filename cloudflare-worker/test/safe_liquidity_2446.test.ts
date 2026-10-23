// #2446: real Mercury acceptance and deterministic SAFE liquidity, never live bank data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { simulate, validateInputs, type Inputs } from '../src/services/captable.ts';
import * as writers from '../src/services/capTableWrites.ts';
import * as feeds from '../src/services/mercury/raiseFeeds.ts';
import { fixture, call, sync, withFake } from './_mercury_raise_fixture.ts';

const base: Inputs = { founders: [{ name: 'Founder', shares: 1_000_000 }], option_pool_pct: 20 };
const post = (name = 'SAFE', amount = 100_000, cap = 1_000_000) => ({ name, amount, cap, basis: 'post_money' as const });
function result(inputs: Inputs, run = simulate) {
  const r = run(inputs);
  assert.ok(!('errors' in r), JSON.stringify(r));
  return r as any;
}
function paid(w: any, name: string) { return w.rows.find((r: any) => r.holder === name)?.payout; }
function conserved(w: any) {
  assert.ok(w);
  assert.equal(Math.round(w.rows.reduce((n: number, r: any) => n + r.payout, 0) * 100), Math.round(w.exit_value * 100));
  assert.equal(w.totals.total_distributed, w.exit_value);
  assert.ok(w.rows.every((r: any) => Number.isFinite(r.payout) && r.payout >= 0));
  assert.equal(w.rows.some((r: any) => r.type === 'option_pool'), false);
  assert.ok(w.assumptions.some((s: string) => s.includes('Unallocated option pool excluded')));
}
function liquidity(run = simulate) {
  // 10% post-money ownership; a 20% unissued reserve receives nothing.
  let w = result({ ...base, safes: [post()], exit_value: 2_000_000 }, run).waterfall;
  assert.equal(paid(w, 'SAFE'), 200_000); assert.equal(paid(w, 'Founder'), 1_800_000); conserved(w);
  assert.equal(w.totals.preference_paid, 0);
  // Below the cap, take cash once, without sharing the residual.
  w = result({ ...base, safes: [post()], exit_value: 500_000 }, run).waterfall;
  assert.equal(paid(w, 'SAFE'), 100_000); assert.equal(paid(w, 'Founder'), 400_000); conserved(w);
  assert.equal(w.totals.preference_paid, 100_000);
  // Pre-money remains distinct: 100k at 1m buys 1/11, not 10%.
  w = result({ ...base, safes: [{ ...post(), basis: 'pre_money' }], exit_value: 2_200_000 }, run).waterfall;
  assert.equal(paid(w, 'SAFE'), 200_000); assert.equal(paid(w, 'Founder'), 2_000_000); conserved(w);
  // One SAFE cashes out; the other keeps its fixed 10% of residual proceeds.
  w = result({ ...base, safes: [post('Low cap', 100_000, 1_000_000), post('High cap', 200_000, 2_000_000)], exit_value: 1_500_000 }, run).waterfall;
  assert.equal(paid(w, 'Low cap'), 130_000); assert.equal(paid(w, 'High cap'), 200_000); assert.equal(paid(w, 'Founder'), 1_170_000); conserved(w);
  // Several elections: a first cash-out makes another SAFE prefer cash too.
  w = result({ ...base, safes: [post('A', 100_000, 1_000_000), post('B', 500_000, 1_500_000), post('C', 700_000, 3_000_000)], exit_value: 2_000_000 }, run).waterfall;
  assert.equal(paid(w, 'A'), 100_000); assert.equal(paid(w, 'B'), 500_000); assert.equal(paid(w, 'C'), 700_000); assert.equal(paid(w, 'Founder'), 700_000); conserved(w);
  // Insolvent cash-out claims rank equally and cannot exceed the exit.
  for (const safes of [[post('A', 100_000), post('B', 200_000)], [post('B', 200_000), post('A', 100_000)]]) {
    w = result({ ...base, safes, exit_value: 60_000 }, run).waterfall;
    assert.equal(paid(w, 'A'), 20_000); assert.equal(paid(w, 'B'), 40_000); assert.equal(paid(w, 'Founder'), 0); conserved(w);
  }
  // Cent allocation balances even when equal claims cannot divide evenly.
  w = result({ ...base, safes: [post('A', 1), post('B', 1), post('C', 1)], exit_value: 0.01 }, run).waterfall;
  conserved(w);
  w = result({ ...base, safes: [post()], exit_value: 0 }, run).waterfall; conserved(w);
}
function pool(run = simulate) {
  for (const rounds of [[], [{ name: 'Seed', pre_money: 1_000_000, investment: 1_000_000 }]]) {
    const r = result({ ...base, rounds, exit_value: 10_000_000 }, run);
    assert.ok(r.founding.some((h: any) => h.type === 'option_pool'), 'reserve remains in the financing ledger');
    conserved(r.waterfall);
    if (!rounds.length) assert.equal(paid(r.waterfall, 'Founder'), 10_000_000);
    else {
      assert.equal(paid(r.waterfall, 'Founder'), 4_444_444.44);
      assert.equal(paid(r.waterfall, 'Seed Investors'), 5_555_555.56);
    }
  }
}
function limitations(run = simulate, validate = validateInputs) {
  for (const safes of [[{ ...post(), instrument: 'note' as const }], [{ name: 'Discount only', amount: 100_000, discount: 0.2 }], [post('Overcommitted', 1_200_000, 1_000_000)]]) {
    const r = result({ ...base, safes, exit_value: 3_000_000 }, run);
    assert.equal(r.waterfall, null);
    assert.ok(r.warnings.some((s: string) => s.includes('Pre-round exit is not calculated')));
  }
  for (const exit_value of [-1, Infinity, NaN]) assert.ok(validate({ ...base, exit_value }).some(s => /Exit value/.test(s)));
  const inputs = { ...base, safes: [post()], exit_value: 2_000_000 };
  const before = JSON.stringify(inputs); result(inputs, run); assert.equal(JSON.stringify(inputs), before);
}
test('#2446: purchase floor, basis-aware conversion, mixed elections, shortfall and exact cents', () => liquidity());
test('#2446: unissued pool earns no proceeds before or after a priced round', () => pool());
test('#2446: no invented note/uncapped liquidity price, invalid exit or input mutation', () => limitations());

async function mercury(feed = feeds, writer = writers) {
  const f = await fixture();
  try {
    await withFake(f, () => sync(f.env));
    assert.equal((await call(f.env, '/api/cycles/raise/holders?project=101', 1, 'POST', { name: 'Founder', group: 'founders', instrument: 'common', shares: 1_000_000 })).status, 201);
    const actor = f.one('SELECT * FROM users WHERE id=1');
    const id = f.one("SELECT id FROM mercury_raise_proposals WHERE kind='safe'").id;
    const accepted = await feed.acceptRaiseProposal(f.env, { integrationId: 41, projectId: 101, id, user: actor, reads: null });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    let inputs = JSON.parse(f.one('SELECT inputs_json FROM cap_table_scenarios WHERE project_id=101').inputs_json);
    assert.deepEqual(inputs.safes.map((s: any) => [s.name,s.amount,s.cap,s.basis]), [['Angel Fixture',25_000,5_000_000,'post_money']]);
    await writer.addHolder(f.env, { projectId: 101, actor, group: 'investors', instrument: 'safe', name: 'Explicit pre', amount_cents: 100_00, cap_cents: 10_000_00, basis: 'pre_money' });
    await writer.addHolder(f.env, { projectId: 101, actor, group: 'investors', instrument: 'safe', name: 'Legacy default', amount_cents: 100_00, cap_cents: 10_000_00 });
    inputs = JSON.parse(f.one('SELECT inputs_json FROM cap_table_scenarios WHERE project_id=101').inputs_json);
    assert.deepEqual(inputs.safes.map((s: any) => s.basis), ['post_money','pre_money',undefined]);
    await assert.rejects(() => writer.addHolder(f.env, { projectId: 101, actor, group: 'investors', instrument: 'safe', name: 'Invalid', amount_cents: 100_00, cap_cents: 10_000_00, basis: 'invalid' as any }), /basis/);
    assert.equal(JSON.parse(f.one('SELECT inputs_json FROM cap_table_scenarios WHERE project_id=101').inputs_json).safes.length, 3);
  } finally { f.db.close(); }
}
test('#2446: Mercury Accept persists post-money, manual basis is retained and legacy default stays pre-money', () => mercury());

const paths = { cap: '../src/services/captable.ts', writer: '../src/services/capTableWrites.ts', feed: '../src/services/mercury/raiseFeeds.ts' };
const originals = Object.fromEntries(Object.entries(paths).map(([k,p]) => [k, readFileSync(new URL(p, import.meta.url),'utf8')]));
let serial = 0;
async function load(path: string, source: string, overrides: Record<string,string> = {}) {
  const file = new URL(path, import.meta.url);
  const js = stripTypeScriptTypes(source).replace(/from ['"]([^'"]+)['"]/g, (_m,spec) => {
    const url = new URL(spec,file);
    const target = overrides[spec] || (spec.startsWith('.') ? [url.href,url.href+'.ts',url.href+'.js'].find(p => statSync(new URL(p),{throwIfNoEntry:false})?.isFile()) : import.meta.resolve(spec));
    return `from '${target}'`;
  });
  const url = 'data:text/javascript;base64,'+Buffer.from(js).toString('base64')+'#2446-'+serial++;
  return { url, module: await import(url) };
}
test('#2446: liquidity, pool and limitation assertions reject mutations and pass restored code', async () => {
  const groups: [Function, string[][]][] = [
    [liquidity, [
      ['pendingSafes, Number(exit), warnings', '[], Number(exit), warnings'],
      ["s.basis === 'post_money' ? total : baseShares", 'baseShares'],
      ['exitValue <= Number(s.cap)', 'true'],
      ['if (!changed) break;', 'break;'],
      ['Math.min(exitValue, cashClaims)', 'cashClaims'],
      ['paid[order[i].i] += 1', 'paid[order[i].i] += 0'],
    ]],
    [pool, [["h.type !== 'option_pool'", 'true'], ['      POOL_EXIT_ASSUMPTION,', '']]],
    [limitations, [["s.instrument === 'note'", 'false'], ["!(Number(s.cap) > 0)", 'false'], ['if (postFraction >= 1)', 'if (false)'], ['Number(inputs.exit_value) < 0', 'false']]],
  ];
  for (const [verify, mutants] of groups) {
    const check = async (source: string) => { const m = (await load(paths.cap, source)).module; verify(m.simulate,m.validateInputs); };
    await check(originals.cap);
    for (const [before,after] of mutants) {
      assert.ok(originals.cap.includes(before),before);
      await assert.rejects(() => check(originals.cap.replace(before,after)),{name:'AssertionError'},before);
      await check(originals.cap);
    }
  }
});
test('#2446: Mercury and writer basis assertions reject dropped basis, then pass restored code', async () => {
  for (const [key,before,after] of [
    ['feed',"instrument: 'safe', basis: 'post_money'","instrument: 'safe'"],
    ['writer','e.basis = a.basis;',"e.basis = 'pre_money';"],
  ]) {
    assert.ok(originals[key].includes(before));
    const m = (await load(paths[key],originals[key].replace(before,after))).module;
    const feed = key === 'feed' ? m : (await load(paths.feed,originals.feed,{'../capTableWrites': (await load(paths.writer,originals.writer.replace(before,after))).url})).module;
    await mercury();
    await assert.rejects(() => mercury(feed,key === 'writer' ? m : writers),{name:'AssertionError'});
    await mercury();
  }
});
