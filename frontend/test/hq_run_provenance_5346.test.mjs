// #5346 (D4575 update): HQ › AI agents › Runs opens one run's provenance from
// its run detail. Unavailable fields read "Not recorded" with their reason,
// never 0; the record is read only when the panel is opened.
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act } from "react";
import { mountContracts } from "./_contracts_dom.mjs";
import { adminAiAgentsApi as api } from "../src/lib/api/adminAiAgents.js";
import { Runs } from "../src/pages/hq/aiAgents/Operations.jsx";
import { NOT_RECORDED, knownCell, provenanceRows } from "../src/pages/hq/aiAgents/provenanceModel.js";

const h = React.createElement;
const no = (why) => ({ available: false, why });
const yes = (value) => ({ available: true, value });
/** A record as `runProvenance` returns it, with every money figure unavailable. */
const RECORD = {
  run: { uid: "run-0000-0001", attempt: 1, status: "done", step: null, failure: no("no failure recorded"), admitted_at: "2026-11-09 10:00:00", ended_at: no("the run has not ended") },
  task: { uid: "task-0000-0500", scope: "project:20", module: "use-of-funds", option: "draft:x" },
  agent: { uid: "agent-vesta-0001", role_key: "finance", sponsor_user_id: 2, model_configured: "@cf/zai-org/glm-4.7-flash" },
  model_invoked: yes("@cf/zai-org/glm-4.7-flash"),
  skill: no("the usage row records no skill"),
  tool_grants_at_admission: no("not recorded per run: an agent's grants are read live at each call"),
  data_class: no("not recorded per run"),
  idempotency: { run_key: "agent:run-0000-0001", hold_key: "agent:run-0000-0001:run" },
  hold: no("no hold was written for this run"),
  charge_microusd: no("the usage row records no charge"),
  proposal: no("no proposal for this run"),
  reconciliation: "unrecorded",
};
const row = (rows, label) => rows.find((r) => r.label === label);

test("#5346 model: an unavailable field is Not recorded with its reason, never 0; a known 0 stays 0", () => {
  const rows = provenanceRows(RECORD);
  for (const label of ["Charge", "Hold", "Settled", "Skill version", "Tool grants at admission", "Data class", "Proposal", "Decided", "Ended", "Failure"]) {
    assert.equal(row(rows, label).value, NOT_RECORDED, label);
  }
  // Mutation checked: knownCell made to answer "$0.000000" for an unavailable figure → this fails.
  assert.deepEqual(row(rows, "Charge"), { label: "Charge", value: NOT_RECORDED, why: "the usage row records no charge" });
  assert.ok(!rows.some((r) => /^\$?0(\.0+)?$/.test(r.value)), "no unavailable figure reads as 0");
  // A charge that was recorded as 0 is a recorded 0, and says so.
  assert.equal(knownCell(yes(0), (v) => `$${(v / 1e6).toFixed(6)}`).value, "$0.000000");
  // A malformed or missing field is Not recorded too, never a blank.
  assert.equal(knownCell(undefined).value, NOT_RECORDED);
  assert.equal(knownCell({ available: true }).value, NOT_RECORDED);
  assert.match(row(rows, "Reconciliation").value, /^Unrecorded/);
  assert.equal(row(rows, "Model invoked").value, "@cf/zai-org/glm-4.7-flash");
  // A settled hold shows its figures.
  const settled = provenanceRows({ ...RECORD, hold: yes({ status: "settled", held_microusd: 5000, settled_microusd: yes(4200), expired: false }), charge_microusd: yes(4200) });
  assert.equal(row(settled, "Hold").value, "settled, held $0.005000");
  assert.equal(row(settled, "Settled").value, "$0.004200");
  assert.equal(row(settled, "Charge").value, "$0.004200");
});

test("#5346 Runs: the run detail opens the provenance on request, and its unavailable fields read Not recorded", async () => {
  const old = { runs: api.runs, run: api.run, runProvenance: api.runProvenance };
  const asked = [];
  api.runs = async () => ({ runs: [{ uid: "run-0000-0001", at: "2026-11-09 10:00", agent: { name: "Vesta" }, skills: [], team: null, model: null, tokens: null, cost_microusd: null, status: "done" }], next_cursor: null });
  api.run = async () => ({ run: { steps: [], inputs: [], output: null, cost: null, errors: [] } });
  api.runProvenance = async (uid) => { asked.push(uid); return { provenance: RECORD }; };
  const ui = await mountContracts(h(Runs));
  try {
    await ui.flush(); await ui.flush();
    await ui.click("2026-11-09 10:00");
    await ui.flush(); await ui.flush();
    assert.match(ui.text(), /Provenance/);
    assert.deepEqual(asked, [], "nothing is read until the panel is opened");
    const details = ui.nodes().find((n) => n.tagName === "DETAILS");
    await act(async () => { ui.props(details).onToggle({ currentTarget: { open: true } }); });
    await ui.flush(); await ui.flush();
    // Mutation checked: RunDetail no longer drawing RunProvenance → nothing is read and this fails.
    assert.deepEqual(asked, ["run-0000-0001"]);
    const text = ui.text();
    assert.match(text, /ChargeNot recorded \(the usage row records no charge\)/);
    assert.match(text, /Data classNot recorded \(not recorded per run\)/);
    assert.match(text, /Hold keyagent:run-0000-0001:run/);
    assert.doesNotMatch(text, /Charge\$0/);
  } finally {
    await ui.unmount();
    Object.assign(api, old);
  }
});
