/**
 * D8518 (#8518): the CFO (`cfo` -> Orrin) and General Counsel (`general_counsel` -> Vesta) on two synthetic
 * companies, before `AGENT_ENGINE` is switched on. Each case runs the real `agentRun` (its skill pin, rule book,
 * evidence preflight, readers, tool grants and connection checks, system prompt, hold and usage rows) on the real
 * migrated schema. Only inference is a stub, plus the MCP server's answer; no model, no network.
 *
 * Every assertion is on what the platform did: the tool calls made, the records read, the refusal code, the system
 * prompt's rules and the disclaimer. None is on the model's wording, which is one fixed line.
 *
 *   CFO
 *     1. budget versus actual: only the company's own ledger is read, and only by the two tools the skill declares;
 *     2. a figure not recorded: the ledger holds no spend for a budget line, so the turn carries no actual for it and
 *        the run is told to write "Not recorded"; a runway with no recorded burn is refused before any model call;
 *     3. another company's ledger or cap table is refused by the tool layer, with no call and no model call.
 *   GENERAL COUNSEL
 *     4. a contract question carries the required disclaimer, in the system prompt, and the contract's own text;
 *     5. another company's contract is refused by the reader, before any model call; the prompt is never the guard.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_go_live_cases_8518.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import {
  FILES, HARBOR, HARBOR_MARKERS, KESTREL, KESTREL_CLAUSE, SKILL_UID, SRV_HARBOR, SRV_KESTREL, agentWorld,
} from './_agent_go_live_8518.ts';
import { AGENT_DISCLAIMERS, GENERAL_COUNSEL_DISCLAIMER_KEY } from '../src/services/agents/disclaimers.ts';
import { NO_INVENTED_FIGURE_RULE } from '../src/services/agents/skillEval.ts';
import { readOne } from '../src/services/agents/reads.ts';
import { ROLE_PERSONA } from '../src/services/agents/personas.ts';

after(removeMigratedDatabases);

/** The disclaimer is the owner's wording (#3727); the test follows the constant, and holds it non-empty. */
const DISCLAIMER = AGENT_DISCLAIMERS[GENERAL_COUNSEL_DISCLAIMER_KEY];
const READ_BUDGET = { integration_uid: SRV_KESTREL, tool: 'grow.read', arguments: { month: '2026-10' } };
const READ_SPEND = { integration_uid: SRV_KESTREL, tool: 'mercury.read', arguments: { month: '2026-10' } };
/** A string as it appears inside the JSON the stub recorded. */
const json = (s: string) => JSON.stringify(s).slice(1, -1);
const turn = (f: { prompts: string[] }) => f.prompts.join('\n');
const noHarbor = (text: string) => { for (const m of HARBOR_MARKERS) assert.ok(!text.includes(m), `Harbor's ${m.slice(0, 8)} reached the turn`); };

// ── CFO ─────────────────────────────────────────────────────────────────────

test('CFO 1: budget versus actual reads only the company\'s own ledger, through the two tools the skill declares', async () => {
  const f = agentWorld('cfo', 'budget-vs-actual');
  try {
    assert.equal(ROLE_PERSONA.cfo, 'orrin');
    const r: any = await f.run('Budget versus actual for October?', { toolReads: [READ_BUDGET, READ_SPEND] });
    assert.equal(r.ok, true, JSON.stringify(r));
    // Mutation checked: `customRowFor` not bound to the sponsor, or the stub's server mixed up → a Harbor call or marker.
    assert.deepEqual(f.toolCalls.map((c) => [c.server, c.tool]), [[SRV_KESTREL, 'grow.read'], [SRV_KESTREL, 'mercury.read']]);
    const t = turn(f);
    for (const figure of ['120000', '118500', '26000', '20000']) assert.ok(t.includes(figure), `the ledger's ${figure} is in the turn`);
    noHarbor(t);
    assert.equal(f.modelCalls.length, 1, 'one model call');
    assert.match(t, /You are Orrin/);
    // The run is tagged to the skill that guided it, and recorded as a run reading exactly those tools.
    const ev = JSON.parse((f.w.db.prepare("SELECT detail_json FROM team_agent_events WHERE kind = 'run'").get() as any).detail_json);
    assert.deepEqual(ev.tool_reads.map((x: any) => x.tool), ['grow.read', 'mercury.read']);
    assert.deepEqual([ev.skill.uid, ev.skill.version], [SKILL_UID['budget-vs-actual'], 1]);
    assert.ok(!JSON.stringify(ev).includes('2026-10'), 'the event names the tools, never their arguments');
  } finally { f.w.close(); }
});

test('CFO 2: a figure the ledger does not record is "Not recorded", never a number', async () => {
  const f = agentWorld('cfo', 'budget-vs-actual');
  try {
    const r: any = await f.run('What did we spend on legal against budget?', { toolReads: [READ_BUDGET, READ_SPEND] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const t = turn(f);
    // The budget line is there; no spend record for it exists in anything the run was given.
    assert.ok(t.includes('8000'), 'the legal budget line is read');
    const spend = f.toolCalls.find((c) => c.tool === 'mercury.read');
    assert.ok(spend);
    assert.ok(!/legal/i.test(JSON.stringify(spend.arguments)));
    const sent = t.slice(t.indexOf('mercury.read'));
    assert.ok(!/legal[^]{0,40}actual/i.test(sent) && !/\\"actual\\":\s*8000/.test(t), 'no actual for legal is fabricated into the turn');
    // The run is held to the rule, in the skill's own step and in the platform's closing rule.
    // Mutation checked: the closing rule dropped from `skillPrompt` → this fails.
    assert.ok(t.includes(json(NO_INVENTED_FIGURE_RULE)));
    assert.match(t, /Write \\"Not recorded\\" for a line with a budget but no recorded spending/);
  } finally { f.w.close(); }
});

test('CFO 2b: a runway with no recorded burn is refused before the model, so it cannot be given a number', async () => {
  const f = agentWorld('cfo', 'cash-runway-snapshot', { burn: false });
  try {
    const r: any = await f.run('How many months of runway do we have?');
    assert.deepEqual([r.ok, r.status, r.code], [false, 422, 'skill_not_ready'], JSON.stringify(r));
    const burn = r.extra.inputs.find((i: any) => i.read === 'grow.burn');
    assert.ok(burn && burn.status !== 'available', JSON.stringify(r.extra.inputs));
    assert.equal(f.modelCalls.length, 0, 'no model call');
    assert.equal(f.count('SELECT COUNT(*) AS n FROM ai_usage_logs'), 0, 'no usage row');
    assert.ok(!JSON.stringify(r).includes('7654321'), 'statuses only: not even the recorded cash balance');
    // With burn recorded the same question runs, on Kestrel's records only.
    const ok = agentWorld('cfo', 'cash-runway-snapshot');
    try {
      const g: any = await ok.run('How many months of runway do we have?');
      assert.equal(g.ok, true, JSON.stringify(g));
      assert.ok(turn(ok).includes('7654321'));
      noHarbor(turn(ok));
    } finally { ok.w.close(); }
  } finally { f.w.close(); }
});

test('CFO 3: another company\'s ledger and cap table are refused by the tool layer, not the prompt', async () => {
  const f = agentWorld('cfo', 'budget-vs-actual');
  try {
    // Naming Harbor's connection: the agent holds no grant for it.
    const direct: any = await f.run('Budget versus actual?', { toolReads: [{ ...READ_BUDGET, integration_uid: SRV_HARBOR }] });
    assert.deepEqual([direct.ok, direct.status, direct.code], [false, 403, 'tool_not_granted'], JSON.stringify(direct));
    assert.deepEqual(f.toolCalls, [], 'Harbor\'s server was never called');
    assert.equal(f.modelCalls.length, 0);
    assert.equal(f.count('SELECT COUNT(*) AS n FROM ai_usage_logs'), 0);
  } finally { f.w.close(); }
  // Even a grant forged onto the agent's row cannot reach it: the connection must be the sponsor's own.
  const g = agentWorld('cfo', 'budget-vs-actual', { forgedHarborGrant: true });
  try {
    const r: any = await g.run('Budget versus actual?', { toolReads: [{ ...READ_BUDGET, integration_uid: SRV_HARBOR }] });
    // Mutation checked: `customRowFor` without `user_id = ?` → the call is made and Harbor's figures reach the turn.
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.deepEqual(g.toolCalls, [], 'Harbor\'s server was never called');
    assert.equal(g.modelCalls.length, 0);
    noHarbor(turn(g));
  } finally { g.w.close(); }
  // The native readers, for the CFO's sponsor, on Harbor's project: withheld, with none of its figures.
  const h = agentWorld('cfo', 'cash-runway-snapshot');
  try {
    for (const key of ['cap_table.read', 'mercury.balances', 'grow.burn']) {
      const own: any = await readOne(h.w.env, key, h.ctxFor(KESTREL));
      assert.ok(own.data && !own.data.withheld, `${key}: the company's own record is read`);
      const theirs: any = await readOne(h.w.env, key, h.ctxFor(HARBOR));
      // Mutation checked: the reader's own team/Full-access gate dropped → Harbor's holders and figures are returned.
      assert.equal(theirs.data.withheld, true, `${key}: another company's record is withheld`);
      noHarbor(JSON.stringify(theirs));
      assert.deepEqual(Object.keys(theirs.data).sort(), ['reason', 'withheld']);
    }
  } finally { h.w.close(); }
});

// ── General Counsel ─────────────────────────────────────────────────────────

test('GC 4: a contract question carries the required disclaimer and the contract\'s own text', async () => {
  const f = agentWorld('general_counsel', 'contract-clause-extraction');
  try {
    assert.equal(ROLE_PERSONA.general_counsel, 'vesta');
    assert.ok(DISCLAIMER && DISCLAIMER.length > 0, 'a disclaimer is required');
    const r: any = await f.run('What is the liability cap in our services agreement?', { record: `data_room_file:${FILES.kestrelMsa}` });
    assert.equal(r.ok, true, JSON.stringify(r));
    const t = turn(f);
    // Mutation checked: `disclaimerKeyForRole` returns undefined for `general_counsel`, or the prompt line dropped.
    assert.ok(t.includes(json(`Include this exact limit in every output: ${DISCLAIMER}`)), 'the disclaimer is an instruction of the run');
    assert.match(t, /You are Vesta/);
    // The record read is the selected contract, by its identity, and nothing of the other company's.
    assert.ok(t.includes(`data_room_passage:${FILES.kestrelMsa}:1`) && t.includes('KESTREL-CLAUSE-91'), 'the selected contract\'s passage is the evidence');
    assert.ok(!t.includes(FILES.kestrelNda), 'a contract not selected is not read');
    noHarbor(t);
    assert.equal(f.modelCalls.length, 1);
    const ev = JSON.parse((f.w.db.prepare("SELECT detail_json FROM team_agent_events WHERE kind = 'run'").get() as any).detail_json);
    assert.deepEqual([ev.skill.uid, ev.skill.version], [SKILL_UID['contract-clause-extraction'], 1]);
  } finally { f.w.close(); }
  // The disclaimer follows the role, not the contract: the CFO's run on the same shape of question has none.
  const cfo = agentWorld('cfo', 'cash-runway-snapshot');
  try {
    assert.equal(((await cfo.run('Runway?')) as any).ok, true);
    assert.ok(!turn(cfo).includes(DISCLAIMER), 'only the General Counsel carries it');
  } finally { cfo.w.close(); }
});

test('GC 5: another company\'s contract is refused by the reader, before the model; the prompt is never the guard', async () => {
  const f = agentWorld('general_counsel', 'contract-clause-extraction');
  try {
    for (const uid of [FILES.harborMsa, FILES.harborNda]) {
      const r: any = await f.run('What does their agreement say about termination?', { record: `data_room_file:${uid}` });
      // Mutation checked: `f.project_id = ?` dropped from the selected-file query → the passages are read and the run goes ahead.
      assert.deepEqual([r.ok, r.status, r.code], [false, 422, 'skill_not_ready'], JSON.stringify(r));
      assert.ok(r.extra.inputs.some((i: any) => i.read === 'data_room.index' && i.status !== 'available'), JSON.stringify(r.extra.inputs));
      noHarbor(JSON.stringify(r));
    }
    assert.equal(f.modelCalls.length, 0, 'no model call: nothing the model was told could have refused it');
    assert.equal(f.count('SELECT COUNT(*) AS n FROM ai_usage_logs'), 0);
    assert.deepEqual(f.prompts, []);
    // The reader itself, asked for Harbor's room as Kestrel's sponsor, withholds the room, and its index lists none of it.
    // Mutation checked: `roomReaderRole` check dropped → Harbor's index and passages are returned.
    const room: any = await readOne(f.w.env, 'data_room.index', { ...f.ctxFor(HARBOR), document: `data_room_file:${FILES.harborMsa}` });
    assert.equal(room.data.withheld, true);
    noHarbor(JSON.stringify(room));
    const own: any = await readOne(f.w.env, 'data_room.index', { ...f.ctxFor(KESTREL), document: `data_room_file:${FILES.harborMsa}` });
    assert.equal(own.data.document_status, 'not_found', 'Harbor\'s file uid is not found in Kestrel\'s room');
    noHarbor(JSON.stringify(own));
    const index: any = await readOne(f.w.env, 'data_room.index', f.ctxFor(KESTREL));
    assert.deepEqual(index.data.files.map((x: any) => x.ref).sort(), [`data_room_file:${FILES.kestrelMsa}`, `data_room_file:${FILES.kestrelNda}`].sort());
    assert.ok(KESTREL_CLAUSE.length > 0);
  } finally { f.w.close(); }
});
