import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { mountContracts } from "./_contracts_dom.mjs";
import { adminAiAgentsApi as api } from "../src/lib/api/adminAiAgents.js";
import {
  Overview,
  Runs,
  Policies,
  Audit,
  Spend,
} from "../src/pages/hq/aiAgents/Operations.jsx";
import { skillRow } from "../src/pages/hq/aiAgents/aiAgentsModel.js";
const h = React.createElement;
const settle = async (ui) => {
  await ui.flush();
  await ui.flush();
};
test("HQ Overview reads recorded counts and preserves unknown values", async () => {
  const old = api.overview;
  api.overview = async () => ({
    agents_active: 7,
    teams: 0,
    skills_published: { axal: 3, companies: null },
    runs: { week: 0 },
    spend_month: { spent_microusd: null },
    proposals_accepted_pct: null,
    runs_failed_pct: 0,
    needs_attention: [{ kind: "cap", label: "Paused agents", items: [] }],
    spend_by_area_30d: [],
  });
  const ui = await mountContracts(h(Overview));
  try {
    await settle(ui);
    assert.match(ui.text(), /Agents active7/);
    assert.match(ui.text(), /Not recorded/);
    assert.doesNotMatch(ui.text(), /Not switched on yet/);
  } finally {
    await ui.unmount();
    api.overview = old;
  }
});
test("run read failures are retryable and never presented as an empty log", async () => {
  const old = api.runs;
  let fails = true;
  api.runs = async () => {
    if (fails) throw Error("private diagnostic");
    return { runs: [], next_cursor: null };
  };
  const ui = await mountContracts(h(Runs));
  try {
    await settle(ui);
    assert.match(ui.text(), /Could not be read/);
    assert.doesNotMatch(ui.text(), /private diagnostic|No entries/);
    fails = false;
    await ui.click("Try again");
    await settle(ui);
    assert.match(ui.text(), /No entries recorded/);
  } finally {
    await ui.unmount();
    api.runs = old;
  }
});
test("HQ skill rows use lifecycle data rather than missing team-card fields", () => {
  const row = skillRow({
    uid: "s",
    name: "Skill",
    area: { slug: "build", label: "Build" },
    level: "expert",
    agents: 0,
    golden: { pass: 9, total: 10 },
    last_eval: "2026-11-05",
  });
  assert.equal(row.agents, "0");
  assert.equal(row.golden, "9 / 10");
  assert.equal(row.lastEval, "2026-11-05");
});
test("policy read never pauses agents on mount", async () => {
  const old = api.policy,
    pause = api.pauseAll;
  let writes = 0;
  api.policy = async () => ({
    policy: {
      area_models: {},
      locks: [],
      read_tools: [],
      paused: { on: false },
    },
    guardrails: [],
  });
  api.pauseAll = async () => {
    writes++;
  };
  const ui = await mountContracts(h(Policies));
  try {
    await settle(ui);
    assert.match(ui.text(), /Platform AI policy/);
    assert.equal(writes, 0);
  } finally {
    await ui.unmount();
    api.policy = old;
    api.pauseAll = pause;
  }
});

test('audit and spend render recorded admin responses', async () => {
 const audit = api.audit, spend = api.spend;
 api.audit = async () => ({rows: [{id:1,at:'2026-11-05',admin:{name:'Operator'},action:'pause',subject:'Platform',reason:'Maintenance',before:{on:false},after:{on:true}}]});
 api.spend = async () => ({spent_microusd:2500000,budget_microusd:null,projected_microusd:3000000,lines:[],teams_at_cap:[]});
 try {
  const a=await mountContracts(h(Audit));try {await settle(a);assert.match(a.text(), /Operator/);assert.match(a.text(), /Maintenance/);}finally {await a.unmount();}
  const s=await mountContracts(h(Spend));try {await settle(s);assert.match(s.text(), /Spent: \$2.50/);assert.match(s.text(), /Budget: Not recorded/);}finally {await s.unmount();}
 } finally {api.audit=audit;api.spend=spend;}
});
test('pause requires the typed confirmation and sends the operator reason', async () => {
 const policy=api.policy,pause=api.pauseAll;const calls=[];
 api.policy=async()=>({policy:{area_models:{},locks:[],read_tools:[],paused:{on:false}},guardrails:[]});
 api.pauseAll=async(...args)=>{calls.push(args);};
 const ui=await mountContracts(h(Policies));try {
 await settle(ui);await ui.fill('Reason', 'Scheduled maintenance');
 await assert.rejects(ui.click('Pause all AI agents'), /Disabled button/);
 await ui.fill('Type PAUSE', 'PAUSE');await ui.click('Pause all AI agents');await settle(ui);
 assert.deepEqual(calls,[['Scheduled maintenance','PAUSE']]);
 }finally {await ui.unmount();api.policy=policy;api.pauseAll=pause;}
});
