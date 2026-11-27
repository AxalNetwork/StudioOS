/**
 * D8688 (#8688): the role qualification's scenarios, run through the real
 * Worker (`src/index.ts`) on fully migrated local SQLite databases, as five
 * synthetic identities with their intended roles, plus a second synthetic
 * tenant for each. Read by `role_qualification_8688.test.ts` and by the matrix
 * CLI, `scripts/qualification/role-matrix.mjs`.
 *
 * THE WORLDS. Three local databases, none of them D1:
 *   - HQ: tenant A and tenant B (a founder, an investor, an advisor and an
 *     Operating Partner each), a pending-review account, and a synthetic Super
 *     Admin who issues the test territory licences as drafts through the HQ
 *     licence routes;
 *   - branch A and branch B: each a branch deployment (`BRANCH_CODE`) over its
 *     own database, holding HQ's pushed copy of its draft licence
 *     (`assembleLicenceRecord` → `applyLicenceCopy`, the push's two halves),
 *     the licence principal seeded by `seed-branch-principal.mjs`'s
 *     `principalSql`, and one local LP applicant.
 * Every database passes `assertIsolatedTarget` before anything is seeded.
 *
 * NOTHING LEAVES THE PROCESS. No mail, chat or payment binding is configured,
 * every outside `fetch` is refused while a run is in progress, and the run
 * reports how many were attempted. A failed step is recorded, never thrown, so
 * one broken scenario cannot hide the others; the row says what failed in
 * words that name no person, address or token.
 */
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase } from './_storage_schema.ts';
import { assembleLicenceRecord } from '../src/services/licencePush.ts';
import { applyLicenceCopy } from '../src/rpc/branchOps.ts';
import { principalSql } from '../../scripts/seed-branch-principal.mjs';
import {
  assertIsolatedTarget, productionDatabases, syntheticEmail, isPublishable, STEPS,
} from '../../scripts/lib/roleQualification.mjs';

type Db = ReturnType<typeof migratedDatabase>;
type Step = { result: 'pass' | 'fail' | 'missing'; evidence: string };
export type Row = {
  id: string;
  intended_role: string;
  authenticated_role: string;
  workspace: string;
  scope: string;
  source: string;
  preview_only: boolean;
  steps: Record<string, Step>;
  phone_390: { result: 'pass' | 'fail' | 'not run'; evidence: string };
  missing_steps: string[];
  evidence: string[];
};

const ROOT = new URL('../../', import.meta.url);
/** Fixture signing keys, one per deployment; never a service credential. */
const HQ_SECRET = 'd8688-hq-fixture-signing-key-'.repeat(2);
const BRANCH_SECRET: Record<string, string> = {
  qa8688a: 'd8688-branch-a-fixture-signing-key-'.repeat(2),
  qa8688b: 'd8688-branch-b-fixture-signing-key-'.repeat(2),
};
/** The territory fund the local applicants apply to (synthetic). */
const FUND_SLUG = 'qualification-fund-i';
/** HQ's clock for the licence copy: a fixed instant, never the real clock. */
const PUSHED_AT = '2026-11-26T12:00:00.000Z';
const ctx: any = { waitUntil() {}, passThroughOnException() {} };

/** The synthetic people and records. Ids are arbitrary; names say they are made up. */
export const HQ = {
  superAdmin: 900,
  founder: { A: 101, B: 102 }, founderRow: { A: 1101, B: 1102 },
  investor: { A: 201, B: 202 }, lpFundGp: 501,
  advisor: { A: 301, B: 302 },
  partner: { A: 401, B: 402 }, partnerRow: { A: 1401, B: 1402 },
  pending: 601,
  company: { A: 9001, B: 9002 },
  project: { A: 2101, B: 2102 },
  painGroup: { A: 3101, B: 3102 },
  deal: { A: 4101 },
  fund: { lp: 5101, managed: 5102 },
  cohort: { A: 6101, B: 6102 },
  need: { A: 7101 },
} as const;
export const BRANCHES = [
  { code: 'qa8688a', territory: 'XQ', licenceRef: 'QA-8688-A', applicant: 'Applicant A (synthetic)' },
  { code: 'qa8688b', territory: 'XZ', licenceRef: 'QA-8688-B', applicant: 'Applicant B (synthetic)' },
] as const;

class Expectation extends Error {}
function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Expectation(message);
}

/** A step's evidence, or a refusal to publish what it would have said. */
function safe(text: string): string {
  return isPublishable(text) ? text : 'evidence withheld: it carried an address, a link or a token-like value';
}

function recorder() {
  const steps: Record<string, Step> = {};
  return {
    steps,
    async step(name: string, fn: () => Promise<string>) {
      try {
        steps[name] = { result: 'pass', evidence: safe(await fn()) };
      } catch (e) {
        const msg = e instanceof Expectation ? e.message : `unexpected ${(e as Error)?.name ?? 'error'}: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
        steps[name] = { result: 'fail', evidence: safe(msg) };
      }
    },
    missing(name: string, why: string) { steps[name] = { result: 'missing', evidence: safe(why) }; },
  };
}

function accounts(db: Db): string[] {
  return (db.prepare('SELECT email FROM users').all() as Array<{ email: string }>).map((r) => r.email);
}

/** The fail-closed gate, run on each database before it is seeded and again after. Throws, naming each reason. */
export function guard(db: Db, environment: string) {
  const production = productionDatabases(readFileSync(new URL('wrangler.toml', ROOT), 'utf8'));
  assertIsolatedTarget({ environment, database: {}, remote: false, accounts: accounts(db) }, production);
}

type World = { db: Db; env: any; secret: string };

async function tokenFor(w: World, userId: number) {
  return new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30m')
    .sign(new TextEncoder().encode(w.secret));
}

/**
 * One request to world `w`'s Worker as `who`. The session is minted by the deployment that issued it:
 * `w` itself, or `issuer` when the question is whether one deployment's session opens another.
 */
async function call(w: World, who: number | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, issuer: World = w) {
  const read = method === 'GET' || method === 'HEAD';
  const res = await worker.fetch(new Request(`https://unit.test${path}`, {
    method, redirect: 'manual',
    headers: {
      ...(who ? { authorization: `Bearer ${await tokenFor(issuer, who)}` } : {}),
      ...(read ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: read ? undefined : JSON.stringify(body ?? {}),
  // A fresh limiter per request: the qualification is about behaviour, and a limiter would answer 429 first.
  }), { ...w.env, RATE_LIMITS: memKV() }, ctx);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

async function me(w: World, who: number) {
  const r = await call(w, who, 'GET', '/api/auth/me');
  if (r.status !== 200) return `unreadable (${r.status})`;
  const licences = Array.isArray(r.json?.licences) && r.json.licences.length ? ` [${r.json.licences.join(', ')}]` : '';
  return `${r.json?.role ?? 'none'}${licences}`;
}

// ───────────────────────────────────────────────────────────── HQ world

function hqWorld(): World {
  const db = migratedDatabase();
  guard(db, 'development');
  const e = syntheticEmail;
  const u = db.prepare(`INSERT INTO users (id, uid, name, email, role, is_active, email_verified, kyc_status, founder_id, partner_id,
      subscription_tier, subscription_status, investor_tier, investor_subscription_status)
    VALUES (?, ?, ?, ?, ?, 1, 1, 'approved', ?, ?, 'studio', 'active', COALESCE(?, 'free'), COALESCE(?, 'free'))`);
  u.run(HQ.superAdmin, 'u-hq-super', 'HQ operator (synthetic)', e('hq-operator'), 'admin', null, null, null, null);
  u.run(HQ.founder.A, 'u-founder-a', 'Founder A (synthetic)', e('founder-a'), 'founder', HQ.founderRow.A, null, null, null);
  u.run(HQ.founder.B, 'u-founder-b', 'Founder B (synthetic)', e('founder-b'), 'founder', HQ.founderRow.B, null, null, null);
  u.run(HQ.investor.A, 'u-investor-a', 'Investor A (synthetic)', e('investor-a'), 'investor', null, null, 'institutional', 'active');
  u.run(HQ.investor.B, 'u-investor-b', 'Investor B (synthetic)', e('investor-b'), 'investor', null, null, 'institutional', 'active');
  u.run(HQ.lpFundGp, 'u-fund-gp', 'Fund GP (synthetic)', e('fund-gp'), 'investor', null, null, 'institutional', 'active');
  u.run(HQ.advisor.A, 'u-advisor-a', 'Advisor A (synthetic)', e('advisor-a'), 'advisor', null, null, null, null);
  u.run(HQ.advisor.B, 'u-advisor-b', 'Advisor B (synthetic)', e('advisor-b'), 'advisor', null, null, null, null);
  u.run(HQ.partner.A, 'u-partner-a', 'Operating Partner A (synthetic)', e('partner-a'), 'partner', null, HQ.partnerRow.A, null, null);
  u.run(HQ.partner.B, 'u-partner-b', 'Operating Partner B (synthetic)', e('partner-b'), 'partner', null, HQ.partnerRow.B, null, null);
  u.run(HQ.pending, 'u-pending', 'Pending member (synthetic)', e('pending-review'), 'exploring', null, null, null, null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ.superAdmin);

  const f = db.prepare('INSERT INTO founders (id, uid, name, email) VALUES (?, ?, ?, ?)');
  f.run(HQ.founderRow.A, 'f-a', 'Founder A (synthetic)', e('founder-a'));
  f.run(HQ.founderRow.B, 'f-b', 'Founder B (synthetic)', e('founder-b'));
  const link = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES (?, ?, ?, ?, 1)');
  link.run('l-founder-a', HQ.company.A, HQ.founder.A, 'Founder');
  link.run('l-founder-b', HQ.company.B, HQ.founder.B, 'Founder');
  const p = db.prepare(`INSERT INTO projects (id, uid, name, sector, stage, founder_id, company_id, created_at, updated_at)
    VALUES (?, ?, ?, 'Software', 'pre-seed', ?, ?, '2026-11-01 09:00:00', '2026-11-01 09:00:00')`);
  p.run(HQ.project.A, 'p-venture-a', 'Venture A (synthetic)', HQ.founderRow.A, HQ.company.A);
  p.run(HQ.project.B, 'p-venture-b', 'Venture B (synthetic)', HQ.founderRow.B, HQ.company.B);
  // The evidence a feature links to: a pain theme from the venture's own customer interviews.
  const pg = db.prepare(`INSERT INTO pain_groups (id, project_id, title, sort_order, created_by, statement_who, statement_cope, statement_cost)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?)`);
  pg.run(HQ.painGroup.A, HQ.project.A, 'Month-end reconciliation takes days', HQ.founder.A,
    'Finance leads at small agencies', 'Spreadsheets and manual exports', 'Two days a month');
  pg.run(HQ.painGroup.B, HQ.project.B, 'Tenant B theme', HQ.founder.B, 'Tenant B', 'Tenant B', 'Tenant B');

  db.prepare(`INSERT INTO deals (id, uid, project_id, status, target_raise, stage_changed_at)
    VALUES (?, 'd-venture-a', ?, 'active', 750000, '2026-11-01 09:00:00')`).run(HQ.deal.A, HQ.project.A);
  // The starting state of a screen: venture A's founder invited investor A to look at the round.
  db.prepare(`INSERT INTO deal_invitations (deal_id, investor_user_id, message, status, created_at)
    VALUES (?, ?, 'Raising a pre-seed round (synthetic)', 'invited', '2026-11-20 09:00:00')`).run(HQ.deal.A, HQ.investor.A);

  const fund = db.prepare(`INSERT INTO vc_funds (id, name, slug, vintage_year, status, gp_user_id, created_at, updated_at)
    VALUES (?, ?, ?, 2026, 'active', ?, '2026-10-01 09:00:00', '2026-10-01 09:00:00')`);
  fund.run(HQ.fund.lp, 'Qualification Fund I (synthetic)', 'qualification-fund-i', HQ.lpFundGp);
  fund.run(HQ.fund.managed, 'Investor A Managed Fund (synthetic)', 'investor-a-managed', HQ.investor.A);
  db.prepare(`INSERT INTO limited_partners (user_id, fund_id, commitment_amount, invested_amount, status, name, email, lp_type, created_at, updated_at)
    VALUES (?, ?, 25000, 10000, 'active', ?, ?, 'individual', '2026-10-02 09:00:00', '2026-10-02 09:00:00')`)
    .run(HQ.investor.A, HQ.fund.lp, 'Investor A (synthetic)', e('investor-a'));

  const cycle = db.prepare(`INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status)
    VALUES (?, ?, ?, ?, ?, 'active')`);
  cycle.run(HQ.cohort.A, 2026, 12, '2026-12-01T00:00:00Z', '2026-12-31T23:59:59Z');
  cycle.run(HQ.cohort.B, 2027, 1, '2027-01-01T00:00:00Z', '2027-01-31T23:59:59Z');
  // The assignment is the starting state: HQ assigned each advisor one batch.
  const assign = db.prepare(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_by_admin_id, note, is_active)
    VALUES (?, ?, ?, ?, ?, 1)`);
  assign.run('aca-a', HQ.advisor.A, HQ.cohort.A, HQ.superAdmin, 'December batch (synthetic)');
  assign.run('aca-b', HQ.advisor.B, HQ.cohort.B, HQ.superAdmin, 'January batch (synthetic)');

  const partner = db.prepare('INSERT INTO partners (id, uid, name, company, email, specialization, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  partner.run(HQ.partnerRow.A, 'pt-a', 'Operating Partner A (synthetic)', 'Delivery Firm A (synthetic)', e('partner-a'), 'product', 'active');
  partner.run(HQ.partnerRow.B, 'pt-b', 'Operating Partner B (synthetic)', 'Delivery Firm B (synthetic)', e('partner-b'), 'product', 'active');
  db.prepare(`INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description, budget_min, budget_max, timeline, status, created_at, updated_at)
    VALUES (?, 'need-a', ?, ?, 'product', ?, ?, 8000, 15000, '6 weeks', 'open', '2026-11-02 09:00:00', '2026-11-02 09:00:00')`)
    .run(HQ.need.A, HQ.project.A, HQ.founderRow.A, 'Reconciliation prototype (fictional)', 'A clickable prototype of the reconciliation flow for five pilot users.');

  guard(db, 'development');
  return { db, secret: HQ_SECRET, env: { DB: d1Over(db), JWT_SECRET: HQ_SECRET, ENVIRONMENT: 'development', TOKENS: memKV() } };
}

// ───────────────────────────────────────────────────────────── branch worlds

/** The URL vars a branch must name its own host in (`assertBranchAppUrl`). Never contacted: nothing leaves the process. */
function branchUrls(code: string) {
  const own = `https://${code}.axal.vc`;
  return { APP_URL: own, PUBLIC_BASE_URL: own, OAUTH_CALLBACK_BASE_URL: own, PUBLIC_MARKETING_URL: own };
}

function branchWorld(code: string, applicant: string, applicantKey: string): World & { principal: number; applicationId: number } {
  const db = migratedDatabase();
  guard(db, 'development');
  // D.3: the licence principal is the one account a branch starts with, inserted by provisioning.
  db.exec(principalSql(syntheticEmail(`admin-${code}`), `Territory admin ${code} (synthetic)`));
  const principal = Number((db.prepare('SELECT id FROM users WHERE email = ?').get(syntheticEmail(`admin-${code}`)) as any).id);
  const applicantId = Number(db.prepare(`INSERT INTO users (uid, name, email, role, is_active, email_verified)
    VALUES (?, ?, ?, 'investor', 1, 1)`).run(`u-${applicantKey}`, applicant, syntheticEmail(applicantKey)).lastInsertRowid);
  const applicationId = Number(db.prepare(`INSERT INTO lp_applications (user_id, fund_slug, investor_type, target_commitment, accredited, note, status, created_at, updated_at)
    VALUES (?, ?, 'individual', 25000, 1, 'Interested in the territory fund (synthetic)', 'pending', '2026-11-25 09:00:00', '2026-11-25 09:00:00')`)
    .run(applicantId, FUND_SLUG).lastInsertRowid);
  guard(db, 'development');
  const secret = BRANCH_SECRET[code];
  return {
    db, secret, principal, applicationId,
    env: { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development', BRANCH_CODE: code, TOKENS: memKV(), ...branchUrls(code) },
  };
}

// ───────────────────────────────────────────────────────────── scenarios

const notRun = (why: string): Row['phone_390'] => ({ result: 'not run', evidence: why });
const PHONE_PENDING = 'Not run: this mode has no browser. A 390 px browser run is merged with --phone (scripts/qualification/README.md).';

async function admin(hq: World): Promise<Row> {
  const r = recorder();
  const missing: string[] = [];
  const evidence: string[] = [];
  const [a, b] = [branchWorld(BRANCHES[0].code, BRANCHES[0].applicant, 'applicant-a'), branchWorld(BRANCHES[1].code, BRANCHES[1].applicant, 'applicant-b')];
  let authenticated = 'unreadable';
  try {
    // The test territory: a DRAFT licence per branch, issued through HQ's own routes by the synthetic Super Admin.
    for (const [i, br] of BRANCHES.entries()) {
      const made = await call(hq, HQ.superAdmin, 'POST', '/api/admin/licences', {
        licence_ref: br.licenceRef, legal_entity_name: `Territory Holder ${br.code} (synthetic)`, kind: 'subsidiary',
      });
      check(made.status === 201 && made.json?.status === 'draft', `HQ refused the draft licence ${br.licenceRef} (${made.status})`);
      const t = await call(hq, HQ.superAdmin, 'PUT', `/api/admin/licences/${made.json.uid}/territories`, { countries: [br.territory] });
      check(t.status === 200, `HQ refused territory ${br.territory} (${t.status})`);
      const row = hq.db.prepare('SELECT * FROM territory_licences WHERE uid = ?').get(made.json.uid) as Record<string, unknown>;
      const copy = await applyLicenceCopy([a, b][i].env, await assembleLicenceRecord(hq.env, row, PUSHED_AT));
      check(copy.applied !== false, `branch ${br.code} did not take HQ's licence copy`);
    }
    evidence.push('two draft territory licences issued on HQ (user-assigned codes XQ and XZ); each branch holds its pushed copy');
    authenticated = await me(a, a.principal);
  } catch (e) {
    r.missing('start', `territory provisioning failed: ${(e as Error).message}`);
  }

  if (!r.steps.start) await r.step('start', async () => {
    const lic = await call(a, a.principal, 'GET', '/api/licence/mine');
    const licText = JSON.stringify(lic.json ?? {});
    check(lic.status === 200 && licText.includes(BRANCHES[0].territory) && licText.includes('draft'), `the branch's own licence read answered ${lic.status} without its draft territory`);
    const board = await call(a, a.principal, 'GET', '/api/branch/approvals');
    check(board.status === 200, `the approvals board answered ${board.status}`);
    const item = (board.json?.items ?? []).find((i: any) => i.lane === 'lp' && i.id === a.applicationId);
    check(item, 'the local LP applicant is not on the branch board');
    check(item.assignee == null, 'the applicant already had a reviewer before triage');
    return `branch ${BRANCHES[0].code} reads its draft licence for territory ${BRANCHES[0].territory}; its board lists the local LP applicant, unassigned`;
  });
  await r.step('draft', async () => {
    const as = await call(a, a.principal, 'POST', '/api/branch/approvals/assignments', {
      assignee_user_id: a.principal, items: [{ lane: 'lp', item_id: a.applicationId }],
    });
    check(as.status === 200, `assigning the applicant answered ${as.status}`);
    const note = await call(a, a.principal, 'PATCH', `/api/admin/lp-applications/${a.applicationId}`, {
      status: 'in_review', review_note: 'Triage: commitment within the territory range; check accreditation evidence.',
    });
    check(note.status === 200 && note.json?.application?.status === 'in_review', `saving the triage note answered ${note.status}`);
    return 'applicant assigned to the territory admin and moved to In review with a triage note';
  });
  await r.step('reload', async () => {
    const hist = await call(a, a.principal, 'GET', `/api/branch/approvals/history?lane=lp&item_id=${a.applicationId}`);
    check(hist.status === 200, `the assignment history answered ${hist.status}`);
    const list = await call(a, a.principal, 'GET', `/api/admin/lp-applications?status=in_review&fund=${FUND_SLUG}`);
    check(list.status === 200, `the LP console answered ${list.status}`);
    const row = (list.json?.items ?? list.json?.applications ?? []).find((x: any) => Number(x.id) === a.applicationId);
    check(row && /Triage:/.test(String(row.review_note ?? '')), 'after a reload the triage note is not on the application');
    return `after reload: application In review with its note; ${(hist.json?.events ?? hist.json?.items ?? []).length} assignment event(s) recorded`;
  });
  await r.step('next_action', async () => {
    const next = await call(a, a.principal, 'PATCH', `/api/admin/lp-applications/${a.applicationId}`, {
      status: 'needs_follow_up', review_note: 'Follow-up: ask for the accreditation letter.',
    });
    check(next.status === 200 && next.json?.application?.status === 'needs_follow_up', `the follow-up decision answered ${next.status}`);
    return 'next action taken in the queue\'s own console: Needs follow-up (the LP lane notifies nobody)';
  });
  await r.step('scope', async () => {
    const own = await call(a, a.principal, 'GET', '/api/branch/approvals');
    check(!(own.json?.items ?? []).some((i: any) => String(i.who).includes('Applicant B')), 'branch A\'s board shows branch B\'s applicant');
    const across = await call(b, a.principal, 'GET', '/api/branch/approvals', undefined, {}, a);
    check(across.status === 401, `branch A's admin session on branch B answered ${across.status}, not 401`);
    const hqOnly = await call(a, a.principal, 'GET', '/api/admin/licences');
    check(hqOnly.status === 403, `an HQ licence route on the branch answered ${hqOnly.status}, not 403`);
    const onHq = hq.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(syntheticEmail(`admin-${BRANCHES[0].code}`)) as { n: number };
    check(Number(onHq.n) === 0, 'the territory admin exists on HQ');
    return 'board holds only its own applicant; the session is refused on branch B (401) and on HQ licence routes (403); no HQ account';
  });
  missing.push('HQ-side appointment (POST /api/admin/licences/:uid/admins) not exercised: it promotes the account to an HQ admin, whose reads tenancyScope leaves unscoped; the restricted Admin is qualified as a branch principal instead (owner decision, D8688).');
  missing.push('The licence stays a draft: no contract, no signature, no activation, by the issue\'s limits.');
  for (const w of [a, b]) w.db.close();
  return {
    id: 'admin', intended_role: 'Admin', authenticated_role: authenticated,
    workspace: `Branch ${BRANCHES[0].code} (test territory ${BRANCHES[0].territory})`,
    scope: `Branch ${BRANCHES[0].code} only; second tenant: branch ${BRANCHES[1].code}`,
    source: 'actual role, local isolated Worker', preview_only: false,
    steps: r.steps, phone_390: notRun(PHONE_PENDING), missing_steps: missing, evidence,
  };
}

async function founder(hq: World): Promise<Row> {
  const r = recorder();
  const q = `?project=${HQ.project.A}`;
  const co = { 'x-company-id': String(HQ.company.A) };
  let featureId = 0;
  await r.step('start', async () => {
    const ov = await call(hq, HQ.founder.A, 'GET', `/api/cycles/build/overview${q}`, undefined, co);
    check(ov.status === 200, `the Build overview answered ${ov.status}`);
    const mod = await call(hq, HQ.founder.A, 'GET', `/api/cycles/build/modules/solution-design${q}`, undefined, co);
    check(mod.status === 200, `Solution design answered ${mod.status}`);
    return 'Build overview and Solution design open for venture A under company A';
  });
  await r.step('draft', async () => {
    const made = await call(hq, HQ.founder.A, 'POST', `/api/cycles/build/features${q}`, {
      title: 'Auto-match bank lines to invoices', description: 'Draft: from the month-end reconciliation interviews.',
      impact: 'high', effort: 'medium', pain_group_id: HQ.painGroup.A,
    }, co);
    check(made.status === 201 && Number(made.json?.id) > 0, `saving the feature answered ${made.status}`);
    featureId = Number(made.json.id);
    const row = hq.db.prepare('SELECT delivery_status, pain_group_id FROM mvp_features WHERE id = ?').get(featureId) as any;
    check(row?.delivery_status === 'Backlog' && Number(row?.pain_group_id) === HQ.painGroup.A, 'the feature is not a Backlog draft linked to the pain theme');
    return 'feature saved as a Backlog draft linked to the interview pain theme';
  });
  await r.step('reload', async () => {
    const mod = await call(hq, HQ.founder.A, 'GET', `/api/cycles/build/modules/solution-design${q}`, undefined, co);
    check(mod.status === 200, `Solution design answered ${mod.status} on reload`);
    check(JSON.stringify(mod.json ?? {}).includes('Auto-match bank lines to invoices'), 'after a reload the draft feature is not listed');
    const edit = await call(hq, HQ.founder.A, 'PATCH', `/api/cycles/build/features/${featureId}${q}`, {
      description: 'Resumed: scope to the two banks the pilot users hold.',
    }, co);
    check(edit.status === 200, `resuming the draft answered ${edit.status}`);
    return 'after reload the draft is listed under the same company and resumed (description edited)';
  });
  await r.step('next_action', async () => {
    const go = await call(hq, HQ.founder.A, 'PATCH', `/api/cycles/build/features/${featureId}${q}`, { state: 'in_progress', is_must_have: true }, co);
    check(go.status === 200, `moving the feature on answered ${go.status}`);
    const row = hq.db.prepare('SELECT delivery_status, is_must_have FROM mvp_features WHERE id = ?').get(featureId) as any;
    check(row?.delivery_status === 'In Progress' && Number(row?.is_must_have) === 1, 'the feature did not move to In Progress as a must-have');
    return 'next action: feature marked a must-have and moved to In Progress (readiness counts it)';
  });
  await r.step('scope', async () => {
    const other = await call(hq, HQ.founder.A, 'GET', `/api/cycles/build/overview?project=${HQ.project.B}`, undefined, co);
    check(other.status === 403, `venture B's Build overview answered ${other.status} to founder A, not 403`);
    const link = await call(hq, HQ.founder.A, 'POST', `/api/cycles/build/features${q}`, { title: 'Cross-tenant link', pain_group_id: HQ.painGroup.B }, co);
    check(link.status === 404, `linking tenant B's pain theme answered ${link.status}, not 404`);
    const theirs = await call(hq, HQ.founder.B, 'PATCH', `/api/cycles/build/features/${featureId}?project=${HQ.project.B}`, { title: 'Overwritten' });
    check(theirs.status === 404, `founder B editing founder A's feature answered ${theirs.status}, not 404`);
    return 'venture B refused (403); tenant B\'s evidence cannot be linked (404); founder B cannot reach the draft (404)';
  });
  return {
    id: 'founder', intended_role: 'Founder', authenticated_role: await me(hq, HQ.founder.A),
    workspace: 'Company A · Venture A (synthetic)', scope: 'Venture A; second tenant: company B · venture B',
    source: 'actual role, local isolated Worker', preview_only: false,
    steps: r.steps, phone_390: notRun(PHONE_PENDING), missing_steps: [], evidence: [],
  };
}

async function investor(hq: World): Promise<Row> {
  const r = recorder();
  let viaKey = '';
  await r.step('start', async () => {
    const flow = await call(hq, HQ.investor.A, 'GET', '/api/deals/flow');
    check(flow.status === 200, `deal flow answered ${flow.status}`);
    check((flow.json?.items ?? []).length === 0, 'the deal flow was not empty at the start');
    const deal = await call(hq, HQ.investor.A, 'GET', `/api/deals/${HQ.deal.A}`);
    check(deal.status === 200, `the invited deal answered ${deal.status}`);
    const inbox = await call(hq, HQ.investor.A, 'GET', '/api/deals/flow/inbox');
    const item = (inbox.json?.items ?? []).find((i: any) => Number(i.deal_id) === HQ.deal.A);
    check(inbox.status === 200 && item?.key, `New for you answered ${inbox.status} without the invited deal`);
    viaKey = String(item.key);
    return 'deal flow open and empty; the invited deal is New for you and opens';
  });
  await r.step('draft', async () => {
    const add = await call(hq, HQ.investor.A, 'POST', '/api/deals/flow', { deal_id: HQ.deal.A, stage: 'screening', ...(viaKey ? { via_key: viaKey } : {}) });
    check(add.status === 201 && add.json?.stage === 'screening', `adding the deal to Screening answered ${add.status}`);
    const note = await call(hq, HQ.investor.A, 'PATCH', `/api/deals/flow/${HQ.deal.A}`, { note: 'Screening draft: strong pain evidence; check churn in pilots.' });
    check(note.status === 200, `saving the screening note answered ${note.status}`);
    return 'deal added at Screening with a private screening note';
  });
  await r.step('reload', async () => {
    const flow = await call(hq, HQ.investor.A, 'GET', '/api/deals/flow');
    const item = (flow.json?.items ?? []).find((i: any) => Number(i.deal_id) === HQ.deal.A);
    check(item?.stage === 'screening' && /Screening draft/.test(String(item?.note ?? '')), 'after a reload the screening note is not on the deal');
    const funds = await call(hq, HQ.investor.A, 'GET', '/api/funds');
    check(funds.status === 200, `the funds list answered ${funds.status}`);
    const rel = new Map((funds.json?.items ?? []).map((f: any) => [Number(f.id), f]));
    const lp: any = rel.get(HQ.fund.lp), gp: any = rel.get(HQ.fund.managed);
    check(lp?.relationship === 'lp' && lp?.can_manage === false, 'the fund Investor A is an LP in is not marked as an LP position');
    check(gp?.relationship === 'gp', 'the fund Investor A manages is not marked as theirs to manage');
    const portal = await call(hq, HQ.investor.A, 'GET', '/api/funds/lp-portal');
    check(portal.status === 200, `the LP portal answered ${portal.status}`);
    const portalText = JSON.stringify(portal.json ?? {});
    check(portalText.includes('Qualification Fund I') && !portalText.includes('Managed Fund'), 'the LP portal does not hold exactly the LP position');
    return `after reload the note is on the deal; funds list: LP position (manage=${lp?.can_manage}) apart from the managed fund (manage=${gp?.can_manage}); the LP portal holds only the LP position`;
  });
  await r.step('next_action', async () => {
    const move = await call(hq, HQ.investor.A, 'PATCH', `/api/deals/flow/${HQ.deal.A}`, { stage: 'diligence' });
    check(move.status === 200 && move.json?.stage === 'diligence', `moving to Diligence answered ${move.status}`);
    return 'next action: deal moved from Screening to Diligence';
  });
  await r.step('scope', async () => {
    const other = await call(hq, HQ.investor.B, 'GET', '/api/deals/flow');
    check(other.status === 200 && !(other.json?.items ?? []).some((i: any) => Number(i.deal_id) === HQ.deal.A), 'investor B sees investor A\'s flow entry');
    const write = await call(hq, HQ.investor.B, 'PATCH', `/api/deals/flow/${HQ.deal.A}`, { note: 'Overwritten' });
    check(write.status === 404, `investor B writing investor A's note answered ${write.status}, not 404`);
    const funds = await call(hq, HQ.investor.B, 'GET', '/api/funds');
    check(!(funds.json?.items ?? []).length, 'investor B lists a fund they neither hold nor manage');
    const deal = await call(hq, HQ.investor.B, 'GET', `/api/deals/${HQ.deal.A}`);
    check(deal.status === 403, `investor B opening a deal they were not invited to answered ${deal.status}, not 403`);
    const founder = await call(hq, HQ.founder.A, 'GET', '/api/deals/flow');
    check(founder.status === 403, `a founder's deal-flow read answered ${founder.status}, not 403`);
    return 'investor B cannot open the deal (403), read or write A\'s screening (404), and lists no fund; a founder is refused deal flow (403)';
  });
  return {
    id: 'investor', intended_role: 'Investor', authenticated_role: await me(hq, HQ.investor.A),
    workspace: 'Investor A (no firm) · LP in Qualification Fund I · GP of a managed fund', scope: 'Investor A\'s own flow and funds; second tenant: investor B',
    source: 'actual role, local isolated Worker', preview_only: false,
    steps: r.steps, phone_390: notRun(PHONE_PENDING), missing_steps: [], evidence: [],
  };
}

async function advisor(hq: World): Promise<Row> {
  const r = recorder();
  let uid = '';
  let version = 0;
  await r.step('start', async () => {
    const mine = await call(hq, HQ.advisor.A, 'GET', '/api/advisors/me/cohort');
    check(mine.status === 200, `the cohort list answered ${mine.status}`);
    const ids = (mine.json?.items ?? []).map((i: any) => Number(i.cohort_cycle_id));
    check(ids.length === 1 && ids[0] === HQ.cohort.A, 'the advisor does not hold exactly the assigned cohort');
    const g = await call(hq, HQ.advisor.A, 'GET', `/api/advisors/me/cohort/${HQ.cohort.A}/guidance`);
    check(g.status === 200, `the cohort's guidance answered ${g.status}`);
    return 'assigned December cohort opens; no guidance yet';
  });
  await r.step('draft', async () => {
    const made = await call(hq, HQ.advisor.A, 'POST', `/api/advisors/me/cohort/${HQ.cohort.A}/guidance`, {
      draft: true, title: 'Session preparation: pricing clinic', body: 'Agenda draft: anchor pricing, pilot-to-paid, two founder questions.',
    });
    check(made.status === 201 && made.json?.uid, `saving the session draft answered ${made.status}`);
    uid = String(made.json.uid);
    return 'session-preparation note saved as a draft on the cohort';
  });
  await r.step('reload', async () => {
    const g = await call(hq, HQ.advisor.A, 'GET', `/api/advisors/me/cohort/${HQ.cohort.A}/guidance`);
    const item = (g.json?.items ?? []).find((i: any) => i.uid === uid);
    check(item && (item.is_draft === true || Number(item.is_draft) === 1), 'after a reload the draft is not on the cohort');
    version = Number(item.version);
    const edit = await call(hq, HQ.advisor.A, 'PATCH', `/api/advisors/me/guidance/${uid}`, {
      body: 'Agenda: anchor pricing, pilot-to-paid, and the two questions founders sent.', version,
    });
    check(edit.status === 200 && Number(edit.json?.item?.version) === version + 1, `resuming the draft answered ${edit.status}`);
    return `after reload the draft is listed (version ${version}) and resumed to version ${version + 1}`;
  });
  await r.step('next_action', async () => {
    const pub = await call(hq, HQ.advisor.A, 'POST', `/api/advisors/me/guidance/${uid}/publish`, { version: version + 1 });
    check(pub.status === 200, `publishing to the cohort answered ${pub.status}`);
    const row = hq.db.prepare('SELECT is_draft FROM cohort_guidance WHERE uid = ?').get(uid) as any;
    check(Number(row?.is_draft) === 0, 'the guidance is still a draft after publishing');
    return 'next action: guidance published to the cohort in-app (a record change; no delivery)';
  });
  await r.step('scope', async () => {
    const other = await call(hq, HQ.advisor.A, 'GET', `/api/advisors/me/cohort/${HQ.cohort.B}/guidance`);
    check(other.status === 403, `advisor A opening the January cohort answered ${other.status}, not 403`);
    const theirs = await call(hq, HQ.advisor.B, 'PATCH', `/api/advisors/me/guidance/${uid}`, { body: 'Overwritten', version: version + 2 });
    check(theirs.status === 404, `advisor B editing advisor A's guidance answered ${theirs.status}, not 404`);
    const founder = await call(hq, HQ.founder.A, 'GET', '/api/advisors/me/cohort');
    check(founder.status === 200 && !(founder.json?.items ?? []).length, 'a founder lists an advisor cohort');
    return 'the unassigned cohort is refused (403); advisor B cannot reach the note (404); a founder lists no cohort';
  });
  return {
    id: 'advisor', intended_role: 'Advisor', authenticated_role: await me(hq, HQ.advisor.A),
    workspace: 'Advisor A · December cohort (synthetic)', scope: 'Assigned cohort only; second tenant: advisor B · January cohort',
    source: 'actual role, local isolated Worker', preview_only: false,
    steps: r.steps, phone_390: notRun(PHONE_PENDING),
    missing_steps: ['No dedicated session-preparation record exists; the scenario uses a draft of the cohort\'s guidance (D4813), the advisor\'s own private draft for the batch.'],
    evidence: [],
  };
}

async function partner(hq: World): Promise<Row> {
  const r = recorder();
  const evidence: string[] = [];
  let quoteId = 0, engagementId = 0, milestoneId = 0;
  await r.step('start', async () => {
    const leads = await call(hq, HQ.partner.A, 'GET', '/api/partner/pipeline/leads');
    check(leads.status === 200, `Pipeline · Leads answered ${leads.status}`);
    check(JSON.stringify(leads.json ?? {}).includes('Reconciliation prototype'), 'the fictional opportunity is not among the leads');
    const board = await call(hq, HQ.partner.A, 'GET', '/api/partner/delivery/board');
    check(board.status === 200 && Array.isArray(board.json?.items) && board.json.items.length === 0, `Delivery answered ${board.status} with engagements already on it`);
    return 'the fictional opportunity is an open lead; Delivery opens with no engagement';
  });
  await r.step('draft', async () => {
    const d = await call(hq, HQ.partner.A, 'PUT', `/api/partner/pipeline/leads/${HQ.need.A}/draft`, {
      shape: 'fixed_project', price_cents: 1200000, currency: 'USD', scope: 'Qualified: six weeks, clickable prototype, five pilot users.',
    });
    check(d.status === 200 && d.json?.draft?.shape === 'fixed_project', `saving the proposal draft answered ${d.status}`);
    return 'opportunity qualified: proposal draft saved on the lead';
  });
  await r.step('reload', async () => {
    const d = await call(hq, HQ.partner.A, 'GET', `/api/partner/pipeline/leads/${HQ.need.A}/draft`);
    check(d.status === 200 && Number(d.json?.draft?.price_cents) === 1200000, 'after a reload the proposal draft is gone');
    const q = await call(hq, HQ.partner.A, 'POST', `/api/needs/${HQ.need.A}/quotes`, {
      price: 12000, timeline_weeks: 6, deliverables: d.json.draft.scope,
    });
    check(q.status === 200 && Number(q.json?.id) > 0, `sending the proposal answered ${q.status}`);
    quoteId = Number(q.json.id);
    const ok = await call(hq, HQ.founder.A, 'POST', `/api/quotes/${quoteId}/accept`);
    check(ok.status === 200 && ok.json?.status === 'accepted', `the founder's acceptance answered ${ok.status}`);
    const e = hq.db.prepare('SELECT id FROM engagements WHERE quote_id = ?').get(quoteId) as any;
    check(e?.id, 'the accepted proposal opened no engagement');
    engagementId = Number(e.id);
    const start = await call(hq, HQ.partner.A, 'POST', `/api/engagements/${engagementId}/start`);
    check(start.status === 200, `handing to delivery (start) answered ${start.status}`);
    const m = await call(hq, HQ.partner.A, 'POST', `/api/partner/delivery/engagements/${engagementId}/milestones`, {
      title: 'First delivery: clickable prototype', due_date: '2026-12-15',
    });
    check([200, 201].includes(m.status), `adding the first-delivery milestone answered ${m.status}`);
    milestoneId = Number(m.json?.id ?? m.json?.milestone?.id ?? 0);
    const board = await call(hq, HQ.partner.A, 'GET', '/api/partner/delivery/board');
    const listed = (board.json?.items ?? []).find((i: any) => Number(i.engagement_id) === engagementId);
    check(listed?.status === 'in_progress', 'after a reload the engagement is not on Delivery, in progress');
    return 'after reload the draft resumed into a sent proposal; the founder accepted; engagement handed to delivery with a first-delivery milestone and listed on Delivery';
  });
  await r.step('next_action', async () => {
    const ms = await call(hq, HQ.partner.A, 'GET', `/api/partner/delivery/engagements/${engagementId}/milestones`);
    check(ms.status === 200, `the engagement's milestones answered ${ms.status}`);
    const first = (ms.json?.items ?? []).find((x: any) => /First delivery/.test(String(x.title))) ?? null;
    check(first, 'the saved engagement has no first-delivery milestone after reload');
    const id = milestoneId || Number(first.id);
    const done = await call(hq, HQ.partner.A, 'PATCH', `/api/partner/delivery/milestones/${id}`, { status: 'done' });
    check(done.status === 200, `completing the first-delivery milestone answered ${done.status}`);
    return 'saved engagement resumed: first-delivery milestone marked done';
  });
  await r.step('scope', async () => {
    const eng = await call(hq, HQ.partner.B, 'GET', `/api/engagements/${engagementId}`);
    check([403, 404].includes(eng.status), `firm B reading firm A's engagement answered ${eng.status}`);
    const ms = await call(hq, HQ.partner.B, 'GET', `/api/partner/delivery/engagements/${engagementId}/milestones`);
    check(ms.status === 404, `firm B reading firm A's milestones answered ${ms.status}, not 404`);
    const draft = await call(hq, HQ.partner.B, 'GET', `/api/partner/pipeline/leads/${HQ.need.A}/draft`);
    check(!draft.json?.draft, 'firm B reads firm A\'s proposal draft');
    return `firm B: engagement refused (${eng.status}), milestones refused (404), no proposal draft of firm A's`;
  });
  // An observation, not a step: canReadBoard (D757) reads an Operating Partner as studio-wide staff for a venture's
  // boards, so a firm with no engagement on venture A still reads its Build board. Recorded for the owner to confirm.
  const board = await call(hq, HQ.partner.B, 'GET', `/api/cycles/build/overview?project=${HQ.project.A}`);
  evidence.push(`firm B (no engagement) reading venture A's Build overview answered ${board.status}: canReadBoard treats an Operating Partner as studio-wide staff (D757); owner to confirm this holds for outside delivery firms`);
  return {
    id: 'partner', intended_role: 'Operating Partner', authenticated_role: await me(hq, HQ.partner.A),
    workspace: 'Delivery Firm A (synthetic)', scope: 'Firm A\'s pipeline and delivery; second tenant: Delivery Firm B',
    source: 'actual role, local isolated Worker', preview_only: false,
    steps: r.steps, phone_390: notRun(PHONE_PENDING), missing_steps: [], evidence,
  };
}

/** The pending-review control: an Exploring account reads its own state and reaches no role surface. */
async function pendingReview(hq: World): Promise<Row> {
  const r = recorder();
  await r.step('start', async () => {
    const m = await call(hq, HQ.pending, 'GET', '/api/auth/me');
    check(m.status === 200 && m.json?.role === 'exploring', `the member's own read answered ${m.status} (${m.json?.role})`);
    return 'signed in; the account reads its own state as Exploring';
  });
  r.missing('draft', 'An Exploring member saves no role record; nothing to draft before activation.');
  r.missing('reload', 'Not applicable before activation.');
  await r.step('next_action', async () => {
    const flow = await call(hq, HQ.pending, 'GET', '/api/deals/flow');
    check(flow.status === 403, `deal flow answered ${flow.status} to a pending member`);
    const build = await call(hq, HQ.pending, 'GET', `/api/cycles/build/overview?project=${HQ.project.A}`);
    check(build.status === 403, `another venture's Build answered ${build.status} to a pending member`);
    return 'role surfaces refuse a pending member (403); activation is HQ\'s decision behind a signed binding agreement';
  });
  await r.step('scope', async () => {
    const funds = await call(hq, HQ.pending, 'GET', '/api/funds');
    check(!(funds.json?.items ?? []).length, 'a pending member lists funds');
    return 'no fund, deal or venture is visible to the pending member';
  });
  return {
    id: 'pending', intended_role: 'Exploring (pending review, control)', authenticated_role: await me(hq, HQ.pending),
    workspace: 'No workspace until activation', scope: 'Own account only',
    source: 'actual role, local isolated Worker', preview_only: false,
    steps: r.steps, phone_390: notRun(PHONE_PENDING),
    missing_steps: ['Normal activation is not exercised: it needs a signed membership agreement, which the qualification must not forge.'],
    evidence: [],
  };
}

/**
 * Runs every scenario and returns the rows, in the disposition's order, plus how
 * many outside requests were attempted (refused, and expected to be zero).
 */
export async function runQualification(): Promise<{ rows: Row[]; outside_requests: number }> {
  const realFetch = globalThis.fetch;
  let outside = 0;
  globalThis.fetch = (async () => { outside += 1; throw new Error('outside request refused by the role qualification'); }) as typeof fetch;
  const hq = hqWorld();
  try {
    const rows = [await admin(hq), await founder(hq), await investor(hq), await advisor(hq), await partner(hq), await pendingReview(hq)];
    for (const row of rows) for (const s of STEPS) if (!row.steps[s]) row.steps[s] = { result: 'missing', evidence: 'not recorded' };
    return { rows, outside_requests: outside };
  } finally {
    globalThis.fetch = realFetch;
    hq.db.close();
  }
}
