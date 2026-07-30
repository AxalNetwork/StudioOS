/**
 * Task #5 — Personal Advisor scenario tests.
 *
 * Drives the deterministic state machine + write-router against an
 * in-memory D1 mock for ten persona scenarios. Each scenario asserts
 * the four hard requirements from the spec:
 *
 *   1. Zero repeats — the same question id never surfaces twice.
 *   2. No tier-blocked surfaces — questions whose `tier_required`
 *      isn't satisfied by the persona's tier set are filtered out.
 *   3. No unlock-violation surfaces — questions whose
 *      `unlock_required.{week, milestones}` aren't satisfied are
 *      filtered out.
 *   4. Writes land — every answered question routes to a non-null
 *      saved_to / status='saved' (or 'paywalled' for tier-locked,
 *      'noop' for catch-all extras-bag fields).
 *
 * Implementation notes:
 *   - Uses the SAME `--experimental-strip-types` runner the
 *     state-machine test uses (see scripts/check-statemachine-coverage.mjs)
 *     so the bank registry imports work out of the box.
 *   - Mocks D1 with the minimum surface routeAnswer + writeRouter touch:
 *     SELECT/INSERT/UPDATE on users, founders, projects,
 *     investor_profiles, advisors, partner_profiles,
 *     advisor_answers (for cross-conversation no-repeat),
 *     spinout_lab_milestones (for week gating).
 *   - Bank questions whose route is "merge into advisor_extras_json"
 *     return saved_to.column = 'advisor_extras_json' which we treat
 *     as a successful write.
 *
 * Run via:
 *   node --experimental-strip-types --test cloudflare-worker/test/advisor.scenarios.test.ts
 * (also wired into npm run test:drift via scripts/check-api-drift.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import * as SM from '../src/services/advisor/stateMachine.ts';
import {
  bankFor,
  filterByContext,
  groupByPage,
  groupBySection,
  type Question,
  type Persona,
} from '../src/services/advisor/questionBank.ts';
import { routeAnswer } from '../src/services/advisor/writeRouter.ts';
import { isAdvisorDisabled } from '../src/services/advisor/rollout.ts';
import { gateToolCall, type ToolCallContext } from '../src/services/advisor/guardrails.ts';
import { isToolName } from '../src/services/advisor/tools.ts';

// ---------------------------------------------------------------------------
// In-memory D1 mock — minimal SELECT/INSERT/UPDATE/PRAGMA surface.
// Tracks which (table, key, value) tuples were written so the assertions
// can verify that every answered question landed somewhere.
// ---------------------------------------------------------------------------
interface WriteRow { table: string; column: string; value: unknown; row_id?: number | string }

function makeDb(seed: { user_id: number; user_role: Persona; project_id?: number; founder_id?: number }) {
  const writes: WriteRow[] = [];
  const tables = {
    users: [{
      id: seed.user_id, role: seed.user_role,
      founder_id: seed.founder_id ?? null,
      advisor_id: null,
      investor_subscription_status: null,
      subscription_status: null,
      spinout_lab_active: 0,
      spinout_lab_week: 1,
    } as any],
    projects: seed.project_id ? [{ id: seed.project_id, founder_id: seed.founder_id, name: 'seed', advisor_extras_json: null } as any] : [],
    founders: seed.founder_id ? [{ id: seed.founder_id, name: 'F', email: 'f@e' } as any] : [],
    investor_profiles: [] as any[],
    advisors: [] as any[],
    partner_profiles: [] as any[],
    partner_invitations: [] as any[],
    advisor_answers: [] as any[],
    spinout_lab_milestones: [] as any[],
    field_sources: [] as any[],
    activity_logs: [] as any[],
    advisor_state: [] as any[],
  };

  function prepare(sql: string) {
    const params: any[] = [];
    return {
      bind(...vals: any[]) { params.push(...vals); return this; },
      async first() {
        if (/PRAGMA table_info\(users\)/.test(sql)) return null as any;
        if (/FROM users WHERE id = \?/.test(sql)) {
          const u = tables.users.find((r) => r.id === params[0]);
          return u ? { ...u } as any : null;
        }
        if (/FROM projects WHERE founder_id = \?/.test(sql)) {
          const p = tables.projects.filter((r) => r.founder_id === params[0]).slice(-1)[0];
          return p ? { id: p.id } as any : null;
        }
        if (/FROM projects WHERE id = \?/.test(sql)) {
          const p = tables.projects.find((r) => r.id === params[0]);
          return p ? { advisor_extras_json: p.advisor_extras_json ?? null } as any : null;
        }
        if (/FROM advisors WHERE/.test(sql)) {
          const m = tables.advisors.find((r) => r.user_id === params[0] || r.id === params[0]);
          return m ? { id: m.id } as any : null;
        }
        if (/FROM partner_profiles WHERE user_id = \?/.test(sql)) {
          const p = tables.partner_profiles.find((r) => r.user_id === params[0]);
          return p ? { id: p.id, invitation_id: p.invitation_id } as any : null;
        }
        return null;
      },
      async all() {
        if (/PRAGMA table_info/.test(sql)) {
          // Return all column names so ensureGuardrailColumns no-ops.
          return { results: [
            { name: 'id' }, { name: 'role' }, { name: 'spinout_lab_week' },
            { name: 'advisor_locked' }, { name: 'advisor_shadow_flag' },
            { name: 'advisor_extras_json' },
          ] } as any;
        }
        if (/FROM advisor_answers/.test(sql)) {
          return {
            results: tables.advisor_answers
              .filter((r) => r.user_id === params[0])
              .map((r) => ({ question_id: r.question_id })),
          } as any;
        }
        if (/FROM spinout_lab_milestones/.test(sql)) {
          return { results: tables.spinout_lab_milestones.filter((r) => r.user_id === params[0]) } as any;
        }
        return { results: [] } as any;
      },
      async run() {
        if (/INSERT INTO advisor_answers/.test(sql)) {
          const [, user_id, question_id, , saved_to_table, saved_to_column, saved_to_id, saved_status] = params;
          tables.advisor_answers.push({ user_id, question_id, saved_to_table, saved_to_column, saved_to_id, saved_status });
          return { meta: {} } as any;
        }
        if (/UPDATE users SET role/.test(sql)) {
          tables.users[0].role = params[0];
          writes.push({ table: 'users', column: 'role', value: params[0], row_id: params[1] });
          return { meta: {} } as any;
        }
        if (/UPDATE users SET advisor_extras_json/.test(sql)) {
          writes.push({ table: 'users', column: 'advisor_extras_json', value: params[0], row_id: params[1] });
          return { meta: {} } as any;
        }
        if (/UPDATE users SET spinout_lab_week/.test(sql)) {
          tables.users[0].spinout_lab_week = params[0];
          return { meta: {} } as any;
        }
        if (/UPDATE projects SET advisor_extras_json/.test(sql)) {
          const p = tables.projects.find((r) => r.id === params[1]);
          if (p) { p.advisor_extras_json = params[0]; writes.push({ table: 'projects', column: 'advisor_extras_json', value: params[0], row_id: params[1] }); }
          return { meta: {} } as any;
        }
        if (/UPDATE projects/.test(sql)) {
          // generic project update — last param is id, others are columns.
          const setMatch = sql.match(/SET ([^W]+)WHERE/);
          if (setMatch) {
            const cols = setMatch[1].split(',').map((s) => s.trim().split('=')[0].trim()).filter(Boolean);
            cols.forEach((col, i) => writes.push({ table: 'projects', column: col, value: params[i], row_id: params[params.length - 1] }));
          }
          return { meta: {} } as any;
        }
        if (/INSERT INTO investor_profiles/.test(sql)) {
          if (!tables.investor_profiles.find((r) => r.user_id === params[0])) {
            tables.investor_profiles.push({ user_id: params[0] });
          }
          return { meta: {} } as any;
        }
        if (/UPDATE investor_profiles/.test(sql)) {
          const setMatch = sql.match(/SET ([^W]+)WHERE/);
          if (setMatch) {
            const cols = setMatch[1].split(',').map((s) => s.trim().split('=')[0].trim()).filter((c) => c && !c.startsWith('updated_at'));
            cols.forEach((col, i) => writes.push({ table: 'investor_profiles', column: col, value: params[i], row_id: params[params.length - 1] }));
          }
          return { meta: {} } as any;
        }
        if (/INSERT INTO advisors/.test(sql)) {
          const id = tables.advisors.length + 1;
          tables.advisors.push({ id, user_id: params[1] });
          return { meta: { last_row_id: id } } as any;
        }
        if (/UPDATE advisors/.test(sql)) {
          const setMatch = sql.match(/SET ([^W]+)WHERE/);
          if (setMatch) {
            const cols = setMatch[1].split(',').map((s) => s.trim().split('=')[0].trim()).filter((c) => c && !c.startsWith('updated_at'));
            cols.forEach((col, i) => writes.push({ table: 'advisors', column: col, value: params[i], row_id: params[params.length - 1] }));
          }
          return { meta: {} } as any;
        }
        if (/INSERT INTO partner_invitations/.test(sql)) {
          const id = tables.partner_invitations.length + 1;
          tables.partner_invitations.push({ id, recipient_email: params[0], status: 'advisor_stub' });
          return { meta: { last_row_id: id } } as any;
        }
        if (/INSERT INTO partner_profiles/.test(sql)) {
          const id = tables.partner_profiles.length + 1;
          tables.partner_profiles.push({ id, invitation_id: params[0], user_id: params[1] });
          return { meta: { last_row_id: id } } as any;
        }
        if (/UPDATE partner_profiles/.test(sql)) {
          const setMatch = sql.match(/SET ([^W]+)WHERE/);
          if (setMatch) {
            const cols = setMatch[1].split(',').map((s) => s.trim().split('=')[0].trim()).filter((c) => c && !c.startsWith('updated_at'));
            cols.forEach((col, i) => writes.push({ table: 'partner_profiles', column: col, value: params[i], row_id: params[params.length - 1] }));
          }
          return { meta: {} } as any;
        }
        // Side-effect tables we don't assert on but must accept.
        if (/INSERT INTO advisor_state|INSERT INTO activity_logs|INSERT INTO field_sources|INSERT INTO spinout_lab_milestones|UPDATE users SET/.test(sql)) {
          if (/INSERT INTO spinout_lab_milestones/.test(sql)) {
            tables.spinout_lab_milestones.push({ user_id: params[0], week: params[1], milestone_key: params[2] });
          }
          return { meta: {} } as any;
        }
        return { meta: {} } as any;
      },
    };
  }
  return {
    DB: { prepare, exec: async () => undefined } as any,
    _tables: tables,
    _writes: writes,
  } as any;
}

// ---------------------------------------------------------------------------
// Scenario fixtures — 10 personas, one per spec line.
// ---------------------------------------------------------------------------
interface Scenario {
  name: string;
  persona: Persona;
  user: { id: number; role: Persona; founder_id?: number; project_id?: number };
  gate: { spinoutLabActive: boolean; week: number; completed: Set<string>; tiers: Set<string> };
  /** How many turns to drive. Smaller than the bank length on purpose
   *  — we want a representative slice that also exercises the
   *  filtering, not the entire bank. */
  turns: number;
  focusPage?: string | null;
  /** Per spec: "all writes land in the correct tables". When true, the
   *  scenario must produce ≥1 routeAnswer with status='saved' and a
   *  populated saved_to.{table,column}. */
  expectsSavedWrites: boolean;
}

// Load 10 persona scenarios from JSON fixture (per spec step #1:
// "Add JSON scenario fixtures for the 10 personas listed").
interface ScenarioJSON {
  name: string;
  persona: Persona;
  user: { id: number; role: Persona; founder_id?: number; project_id?: number };
  gate: { spinoutLabActive: boolean; week: number; completed: string[]; tiers: string[] };
  turns: number;
  focusPage?: string | null;
  expects_saved_writes: boolean;
}
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_JSON: ScenarioJSON[] = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/advisor-scenarios.json'), 'utf8'),
);
const SCENARIOS: Scenario[] = SCENARIOS_JSON.map((s) => ({
  name: s.name,
  persona: s.persona,
  user: s.user,
  gate: {
    spinoutLabActive: s.gate.spinoutLabActive,
    week: s.gate.week,
    completed: new Set(s.gate.completed),
    tiers: new Set(s.gate.tiers),
  },
  turns: s.turns,
  focusPage: s.focusPage ?? undefined,
  expectsSavedWrites: s.expects_saved_writes,
}));

// ---------------------------------------------------------------------------
// Per-scenario assertions.
// ---------------------------------------------------------------------------
async function runScenario(
  s: Scenario,
  env: any,
  userObj: any,
  writeResults: Array<{ id: string; status: string; saved_to?: { table: string; column: string } }>,
) {
  // Build the visible bank exactly as routes/advisor.ts does.
  const personaBank = bankFor(s.persona, { spinoutLabActive: s.gate.spinoutLabActive });
  const filtered = filterByContext(personaBank, {
    persona: s.persona,
    week: s.gate.week,
    tiers: s.gate.tiers,
    completedMilestones: s.gate.completed,
  });
  const visible = filtered.visible;
  assert.ok(visible.length > 0, `${s.name}: visible bank must be non-empty`);

  const seenIds = new Set<string>();
  const answered = new Set<string>();
  const recentlyAsked = new Map<string, number>();
  let now = 1_700_000_000_000;

  for (let turn = 0; turn < s.turns; turn++) {
    const result = SM.pickNext(visible, answered, {
      focusPage: s.focusPage ?? null,
      week: s.gate.week,
      completedMilestones: s.gate.completed,
      recentlyAsked,
      now,
    });
    const next = result.next;
    if (!next) break; // bank exhausted under the current filter
    // (1) zero repeats
    assert.ok(!seenIds.has(next.id), `${s.name}: question repeated → ${next.id}`);
    seenIds.add(next.id);
    // (2) no tier-blocked surfaces
    if (next.tier_required) {
      assert.ok(s.gate.tiers.has(next.tier_required), `${s.name}: tier-blocked surfaced → ${next.id} requires ${next.tier_required}`);
    }
    // (3) no unlock-violation surfaces
    if (next.unlock_required) {
      const u = next.unlock_required;
      if (u.week) assert.ok(s.gate.week >= u.week, `${s.name}: week-locked surfaced → ${next.id} needs week ${u.week}`);
      if (u.milestones) {
        for (const m of u.milestones) {
          assert.ok(s.gate.completed.has(m), `${s.name}: milestone-locked surfaced → ${next.id} needs ${m}`);
        }
      }
    }
    // (4) persona match
    assert.equal(next.persona === s.persona || next.persona === 'unknown', true,
      `${s.name}: persona mismatch ${next.persona} vs ${s.persona} on ${next.id}`);

    // Drive the REAL write path through routeAnswer against the
    // in-memory D1 mock. Code-review fix: the scheduler-only test
    // didn't prove writes land in the correct domain tables; this
    // closes that gap.
    const value = synthAnswer(next);
    const evidence = next.requires_evidence ? 'eval-harness:test-evidence' : null;
    const wr = await routeAnswer(env, userObj, next.id, value, evidence);
    writeResults.push({ id: next.id, status: wr.status, saved_to: wr.saved_to });
    // (5) writes land — every answered question must return a
    //     non-failed status. `saved` is the happy path; `noop` is
    //     allowed for catch-all extras-bag fields; `paywalled`
    //     surfaces only when the persona's tier_required isn't met
    //     (already guarded above). `needs_evidence`/`invalid` shouldn't
    //     fire because we synthesise valid values + evidence.
    assert.notEqual(wr.status, 'failed',
      `${s.name}: routeAnswer failed for ${next.id}: ${wr.error}`);
    assert.ok(['saved', 'noop', 'paywalled', 'skipped'].includes(wr.status),
      `${s.name}: unexpected write status ${wr.status} for ${next.id}`);
    answered.add(next.id);
    recentlyAsked.set(next.id, now);
    now += 60_000; // +1 minute between turns
  }

  // Final gate — at least 50% of the visible bank should be reachable
  // within `turns` cycles (sanity check: if a filter was wrong we'd
  // see far fewer surfaces).
  assert.ok(seenIds.size >= Math.min(s.turns, Math.ceil(visible.length / 2)),
    `${s.name}: only saw ${seenIds.size} of ${visible.length} visible questions`);

  // (6) writes-land-in-correct-tables — every scenario flagged
  //     `expects_saved_writes` must produce ≥1 routeAnswer with
  //     status='saved' and a populated saved_to.{table,column}. AND
  //     every saved write must land in a table allowed for that
  //     persona — a founder answer must NOT end up in `advisors` or
  //     `partner_profiles`, an investor answer must NOT end up in
  //     `projects`, etc. This is the "correct tables" half of the spec
  //     contract that the previous version of this assertion missed.
  const ALLOWED_TABLES_PER_PERSONA: Record<Persona, Set<string>> = {
    founder: new Set([
      'projects', 'founders', 'founder_profiles', 'discovery_interviews',
      'roadmap_okrs', 'cap_table_entries', 'compliance_items',
      'spinout_lab_milestones', 'project_extras', 'founder_extras',
      'advisor_extras_json',
    ]),
    investor: new Set([
      'investor_profiles', 'users', 'investor_extras',
      'advisor_extras_json',
    ]),
    partner: new Set([
      'partner_profiles', 'users', 'partner_extras',
      'advisor_extras_json',
    ]),
    advisor: new Set([
      'advisors', 'advisor_profiles', 'users', 'advisor_extras',
      'advisor_extras_json',
    ]),
    unknown: new Set(['advisor_extras_json']),
  };
  const savedWrites = writeResults.filter((w) => w.status === 'saved' && w.saved_to);
  if (s.expectsSavedWrites) {
    assert.ok(savedWrites.length > 0,
      `${s.name}: expected ≥1 saved write to a domain table, got ${JSON.stringify(writeResults.slice(0, 5))}`);
    const allowed = ALLOWED_TABLES_PER_PERSONA[s.persona];
    for (const w of savedWrites) {
      assert.ok(w.saved_to!.table && w.saved_to!.column,
        `${s.name}: saved write missing table/column: ${JSON.stringify(w)}`);
      assert.ok(allowed.has(w.saved_to!.table),
        `${s.name}: write for q=${w.id} landed in disallowed table "${w.saved_to!.table}" ` +
        `(allowed for ${s.persona}: ${[...allowed].join(', ')})`);
    }
  }

  // (7) progress widget buckets — replicate the /progress per-page +
  //     per-section computation locally (same helpers the route uses)
  //     and assert the answered count fans out into the right buckets.
  const savedSet = new Set(savedWrites.map((w) => w.id));
  const byPage = groupByPage(visible).map((g) => ({
    page: g.page,
    total: g.ids.length,
    answered: g.ids.filter((id) => savedSet.has(id)).length,
  }));
  const bySection = groupBySection(visible).map((g) => ({
    section: g.section,
    total: g.ids.length,
    answered: g.ids.filter((id) => savedSet.has(id)).length,
  }));
  const pageAnswered = byPage.reduce((sum, b) => sum + b.answered, 0);
  const sectionAnswered = bySection.reduce((sum, b) => sum + b.answered, 0);
  // Bucket totals must agree with the saved set.
  assert.equal(pageAnswered, savedSet.size,
    `${s.name}: per-page bucket sum ${pageAnswered} != saved ${savedSet.size}`);
  assert.equal(sectionAnswered, savedSet.size,
    `${s.name}: per-section bucket sum ${sectionAnswered} != saved ${savedSet.size}`);
  // No bucket can over-count its own total.
  for (const b of byPage)    assert.ok(b.answered <= b.total, `${s.name}: page ${b.page} over-counted`);
  for (const b of bySection) assert.ok(b.answered <= b.total, `${s.name}: section ${b.section} over-counted`);
}

// Synthesise a plausible answer for each question type so routeAnswer
// passes its inline schema validators (numeric fields, evidence gates).
function synthAnswer(q: Question): string {
  // Numeric high-risk fields — match the NUMERIC_FIELDS map in writeRouter.
  if (q.id === 'founder.financials.runway_months')    return '12';
  if (q.id === 'founder.financials.monthly_burn_usd') return '50000';
  if (q.id === 'founder.financials.mrr_usd')          return '8000';
  if (q.id === 'founder.capital.raise_target_usd')    return '1500000';
  // Generic numeric heuristic: id contains "_usd" or "_months" or "_count".
  if (/_usd$|_months$|_count$|_pct$/i.test(q.id)) return '10';
  // Email-shaped fields.
  if (/email/i.test(q.id)) return 'eval@example.com';
  // URL-shaped fields.
  if (/_url$|website|deck/i.test(q.id)) return 'https://example.com';
  // Default: a short prose answer that satisfies the catch-all string columns.
  return 'eval-harness synthetic answer';
}

for (const s of SCENARIOS) {
  test(`scenario: ${s.name}`, async () => {
    const env = makeDb({
      user_id: s.user.id,
      user_role: s.persona,
      project_id: s.user.project_id,
      founder_id: s.user.founder_id,
    });
    const userObj = {
      id: s.user.id,
      role: s.persona,
      email: `u${s.user.id}@eval`,
      name: 'eval',
      founder_id: s.user.founder_id ?? null,
    } as any;
    const writeResults: Array<{ id: string; status: string; saved_to?: { table: string; column: string } }> = [];
    await runScenario(s, env, userObj, writeResults);
  });
}

// ---------------------------------------------------------------------------
// Kill-switch tests. Task #7 retired the staged-rollout machinery
// (allowlist + percentage + new-signups-after cutoff); only the
// explicit ADVISOR_V2_DISABLED / ADVISOR_DISABLED env flags remain.
// ---------------------------------------------------------------------------
test('kill switch: ADVISOR_V2_DISABLED=1 disables the advisor', () => {
  assert.equal(isAdvisorDisabled({ ADVISOR_V2_DISABLED: '1' } as any), true);
  assert.equal(isAdvisorDisabled({ ADVISOR_V2_DISABLED: 'true' } as any), true);
});

test('kill switch: ADVISOR_DISABLED=1 disables the advisor (legacy alias)', () => {
  assert.equal(isAdvisorDisabled({ ADVISOR_DISABLED: '1' } as any), true);
  assert.equal(isAdvisorDisabled({ ADVISOR_DISABLED: 'true' } as any), true);
});

test('kill switch: both flags absent or "0" leaves the advisor enabled', () => {
  assert.equal(isAdvisorDisabled({} as any), false);
  assert.equal(isAdvisorDisabled({ ADVISOR_V2_DISABLED: '0', ADVISOR_DISABLED: '0' } as any), false);
  assert.equal(isAdvisorDisabled({ ADVISOR_V2_DISABLED: 'false' } as any), false);
});

test('kill switch: stale ADVISOR_V2_DISABLED=0 cannot override ADVISOR_DISABLED=1', () => {
  // Logical OR (NOT precedence by presence) — an operator's emergency
  // ADVISOR_DISABLED=1 must win over a stale ADVISOR_V2_DISABLED=0 and
  // vice versa.
  assert.equal(isAdvisorDisabled({ ADVISOR_DISABLED: '1', ADVISOR_V2_DISABLED: '0' } as any), true);
  assert.equal(isAdvisorDisabled({ ADVISOR_DISABLED: 'false', ADVISOR_V2_DISABLED: '1' } as any), true);
});

// ---------------------------------------------------------------------------
// L2 tool-gating arg scan (Task #13 regression).
//
// Bug: typing an ordinary prose answer that happened to contain English
// words like "select", "update" or "grant ... to" tripped the SQL-injection
// heuristic and hard-failed the write with `arg pattern: sql`. Two fixes,
// both asserted here:
//   1. Free-text payload fields (`value`, `evidence`) are no longer scanned
//      for SQL/shell/HTML grammar — only structural fields (ids, queries) are.
//   2. The SQL detector is grammar-based (SELECT…FROM, UNION SELECT,
//      DROP TABLE, …), so bare keywords with no companion clause stop
//      false-positiving while real injection in a structural field is still
//      blocked.
// ---------------------------------------------------------------------------
const GATE_ENV = {} as any; // no TOKENS binding -> KV rate/cost checks skipped
function gateCtx(persona: Persona = 'founder'): ToolCallContext {
  return { user: { id: 1 } as any, persona, tiers: new Set<string>(), conversationId: 123 };
}

test('gate: free-text value with SQL-ish English saves (no arg-pattern block)', async () => {
  const res = await gateToolCall(GATE_ENV, gateCtx(), 'writeAnswer', {
    question_id: 'founder.vision',
    value: 'We will select the best deals, update our roadmap, and grant equity to early advisors.',
  });
  assert.equal(res.ok, true, res.detail);
});

test('gate: free-text value AND evidence are both exempt from the arg scan', async () => {
  const res = await gateToolCall(GATE_ENV, gateCtx(), 'writeAnswer', {
    question_id: 'capital.raise.terms',
    value: 'Raising $2M on a SAFE',
    evidence: 'Per the board deck we grant options and update the cap table; see the data room.',
  });
  assert.equal(res.ok, true, res.detail);
});

test('gate: a bare keyword in a structural field (no grammar) passes', async () => {
  // `exploreDocs.query` IS scanned (not a free-text field); "select" with no
  // FROM clause is no longer treated as SQL.
  const res = await gateToolCall(GATE_ENV, gateCtx(), 'exploreDocs', { query: 'select a good template' });
  assert.equal(res.ok, true, res.detail);
});

// ---------------------------------------------------------------------------
// Regression — Explorer onboarding deadlock. Exploring users (and any user
// whose role maps to no persona) run the advisor as persona 'unknown' until
// the role detector's own answer escapes that state. The writeAnswer gate
// used to reject 'unknown' with persona_mismatch ("writeAnswer not available
// for unknown"), so the detector answer that would unlock them could never
// be written. writeAnswer must accept 'unknown'; privileged tools must not.
// ---------------------------------------------------------------------------
test('gate: writeAnswer is allowed for the unknown (role-detector) persona', async () => {
  const res = await gateToolCall(GATE_ENV, gateCtx('unknown' as Persona), 'writeAnswer', {
    question_id: 'role_detect.primary',
    value: 'I am building a startup',
  });
  assert.equal(res.ok, true, res.detail);
});

test('gate: privileged tools stay blocked for the unknown persona', async () => {
  for (const tool of ['scoreDeal', 'draftMemo', 'findInvestor', 'listMyTasks']) {
    const res = await gateToolCall(GATE_ENV, gateCtx('unknown' as Persona), tool, {});
    assert.equal(res.ok, false, `${tool} should be blocked for unknown`);
    assert.equal(res.reason, 'persona_mismatch');
  }
});

test('writeAnswer is NOT in the LLM tool registry (deterministic /answer path only)', () => {
  // The 'unknown' allowlist entry above is safe partly BECAUSE writeAnswer
  // can never be invoked via POST /tool or the chat tool loop — both dispatch
  // through isToolName()/TOOL_REGISTRY, which exclude it. If writeAnswer is
  // ever added to the registry, revisit the unknown-persona allowlist first.
  assert.equal(isToolName('writeAnswer'), false);
});

test('gate: real injection in a scanned structural field is still blocked', async () => {
  const union = await gateToolCall(GATE_ENV, gateCtx(), 'exploreDocs', {
    query: '1 UNION SELECT password FROM users',
  });
  assert.equal(union.ok, false);
  assert.equal(union.reason, 'invalid_args');

  const drop = await gateToolCall(GATE_ENV, gateCtx(), 'writeAnswer', {
    question_id: "x'; DROP TABLE users; --",
    value: 'ok',
  });
  assert.equal(drop.ok, false);
  assert.equal(drop.reason, 'invalid_args');
});

// keep ts-strip-types happy
void makeDb;
