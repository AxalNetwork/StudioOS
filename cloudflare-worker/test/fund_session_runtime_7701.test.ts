/** D7701 (#7701): real migrated scheduled fund sessions, GP/company gates and pre-charge readiness; synthetic records only. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, ADMIN, fakeAgentRun, loopDeps } from './_agent_engine_fixture.ts';
import { FUND, OTHER_GP, OTHER_COMPANY, NO_COMPANY, NOW, TO, SCOPE, SLUG, SKILL_UID, fundWorld, agentOf, withGrowth } from './_skill_fund_fixture.ts';
import { CHECKED_TARGETS, TARGET_KINDS, checkSession, targetReadable } from '../src/services/agents/sessions.ts';
import { load, context, runStep } from '../src/agents/loop.ts';
import { READERS } from '../src/services/agents/reads.ts';
import { pathsFor } from '../src/services/agents/skillInputs.ts';

after(removeMigratedDatabases);
const input = (id = String(FUND)) => ({ skill_id: SKILL_UID, target_kind: 'fund', target_id: id, cadence: 'once', run_at: '2027-03-16T09:00:00Z' });

test('checked fund targets and scheduling accept the institutional GP only in the reader company scope', async () => {
  const f = fundWorld();
  try {
    assert.ok(TARGET_KINDS.includes('fund') && CHECKED_TARGETS.includes('fund'));
    const a = agentOf(f.w);
    const c = await checkSession(f.w.env, a, SCOPE, input(), new Date(NOW));
    assert.ok(c.ok, JSON.stringify(c));
    if (c.ok) assert.deepEqual(c.c.target, { kind: 'fund', id: String(FUND), title: 'Synthetic Fund I' });
    for (const id of [String(OTHER_GP), String(OTHER_COMPANY), '404']) {
      const denied = await checkSession(f.w.env, a, SCOPE, input(id), new Date(NOW));
      assert.equal(!denied.ok && denied.refusal.code, 'target_not_readable');
    }
    for (const id of ['vc_fund:5', '05', '5 OR 1=1', '-5']) {
      assert.equal(await targetReadable(f.w.env, a, SCOPE, { kind: 'fund', id }), null);
    }
    assert.ok(await targetReadable(f.w.env, a, SCOPE, { kind: 'fund', id: String(NO_COMPANY) }), 'same null-company exception as the reader');
    assert.equal(await targetReadable(f.w.env, a, { ...SCOPE, company_id: null }, { kind: 'fund', id: String(FUND) }), null);
    assert.equal(await targetReadable(f.w.env, a, { ...SCOPE, company_id: null }, { kind: 'fund', id: String(NO_COMPANY) }), null);
    f.w.db.prepare("INSERT INTO user_company_links(uid,company_id,user_id) VALUES('fund-company-member',?,?)").run(SCOPE.company_id, SPONSOR);
    assert.ok(await targetReadable(f.w.env, a, { kind: 'company', id: SCOPE.company_id, name: 'Synthetic company' }, { kind: 'fund', id: String(FUND) }));
    f.w.db.prepare("UPDATE users SET investor_tier='professional' WHERE id=?").run(SPONSOR);
    const lower = await checkSession(f.w.env, a, SCOPE, input(), new Date(NOW));
    assert.equal(!lower.ok && lower.refusal.code, 'target_not_readable');
  } finally { f.w.close(); }
  const admin = fundWorld({ sponsor: ADMIN });
  try {
    admin.w.db.prepare('UPDATE vc_funds SET gp_user_id=? WHERE id=?').run(ADMIN, FUND);
    assert.equal(await targetReadable(admin.w.env, agentOf(admin.w), SCOPE, { kind: 'fund', id: String(FUND) }), null);
  } finally { admin.w.close(); }
});

async function scheduled(f: ReturnType<typeof fundWorld>, target: string | null = String(FUND)) {
  const w = f.w;
  w.db.prepare(`INSERT INTO agent_duties(uid,agent_id,kind,title,cadence,hour_utc,minute_utc,zone,run_at,skill_id,skill_version,target_kind,target_id,next_due_at,status,created_by)
    VALUES('fund-session-7701',?,'session','LP letter','once',9,0,'UTC','2027-03-16 09:00:00',1,1,?,?,'2027-03-16 09:00:00','active',?)`).run(AGENT, target ? 'fund' : null, target, SPONSOR);
  w.task(200, AGENT);
  w.db.prepare("UPDATE scope_tasks SET source_kind='duty',source_ref='fund-session-7701' WHERE id=200").run();
  const admission = await w.runtime.admit({ kind: 'project', id: PROJECT }, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
  assert.ok(admission.ok, JSON.stringify(admission));
  if (!admission.ok) throw new Error('synthetic admission refused');
  const calls: any[] = [], selected: unknown[] = [], inner = fakeAgentRun(w);
  const readers = { ...withGrowth, 'fund.performance': async (env: any, c: any) => {
    selected.push(c.fund);
    return READERS['fund.performance'](env, { ...c, page: { to: TO } });
  } };
  const d = { ...loopDeps(w, async (env, i) => { calls.push(i); return inner.fn(env, i); }, readers), now: () => new Date(NOW) };
  assert.ok((await load(d, admission.run.uid)).go);
  assert.ok((await context(d, admission.run.uid)).go);
  return { uid: admission.run.uid, d, calls, selected, inner };
}

test('scheduled LP letter binds the same selected fund in context and readiness before running', async () => {
  const f = fundWorld();
  try {
    const s = await scheduled(f);
    assert.ok((await runStep(s.d, s.uid)).go);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].readiness.slug, SLUG);
    assert.equal(s.calls[0].record, `vc_fund:${FUND}`, 'the proposal/run keeps the same selected fund identity');
    assert.ok(s.calls[0].prompt.includes(`vc_fund:${FUND}`) && s.calls[0].prompt.includes('2026-Q3'));
    assert.ok(s.selected.length >= 2 && s.selected.every(x => x === `vc_fund:${FUND}`), 'context and readiness read one identical selection');
    assert.equal(pathsFor(SLUG)?.scheduled, 'supported');
  } finally { f.w.close(); }
});

for (const loss of ['deleted', 'company moved', 'GP changed', 'tier lost', 'no selection'] as const) {
  test(`scheduled fund ${loss}: readiness refuses before agentRun or any charge`, async () => {
    const f = fundWorld();
    try {
      const s = await scheduled(f, loss === 'no selection' ? null : String(FUND));
      // Losing access after context construction must still be caught immediately before agentRun.
      if (loss === 'deleted') f.w.db.prepare('DELETE FROM vc_funds WHERE id=?').run(FUND);
      if (loss === 'company moved') f.w.db.prepare('UPDATE vc_funds SET company_id=2 WHERE id=?').run(FUND);
      if (loss === 'GP changed') f.w.db.prepare('UPDATE vc_funds SET gp_user_id=101 WHERE id=?').run(FUND);
      if (loss === 'tier lost') f.w.db.prepare("UPDATE users SET investor_tier='professional' WHERE id=?").run(SPONSOR);
      assert.deepEqual(await runStep(s.d, s.uid), { go: false, status: 'refused', refusal: 'skill_not_ready' });
      assert.equal(s.calls.length, 0);
      assert.equal(s.inner.state.charges, 0);
    } finally { f.w.close(); }
  });
}
