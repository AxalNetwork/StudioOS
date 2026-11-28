/**
 * D8688 (#8688), part 2 — the role qualification's 390 px browser pass.
 *
 * Each row signs in as the role itself (never an HQ preview), on the built SPA
 * and the real Worker of `server.ts`, at 390 × 844, and walks the issue's four
 * captures on the role's own screen:
 *   start  → the screen shows the seeded starting state;
 *   draft  → the draft is saved (in the browser where the screen offers it,
 *            otherwise through the role's own session with the API run's
 *            request) and the screen shows it;
 *   reload → after a full reload the screen still shows it;
 *   next   → the role's next action is a visible, enabled control that fits
 *            the 390 px width, and is taken where it is a local record change.
 * On every screen the page must not scroll sideways at 390 px.
 *
 * The result is written in the `--phone` format of
 * `scripts/qualification/role-matrix.mjs` (row ids admin, founder, investor,
 * advisor, partner, pending). Evidence is one sentence the matrix may publish:
 * a failing row names the step and check that failed, never a selector
 * message, address, link or token.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSENT_VERSION } from '../../src/lib/cookieConsent.js';
import { isPublishable } from '../../../scripts/lib/roleQualification.mjs';

const OUT = process.env.ROLE_QUALIFICATION_PHONE
  || fileURLToPath(new URL('./test-results/role-phone-390.json', import.meta.url));
const WIDTH = 390;

// One worker runs the rows in order; a failed row does not skip the next, so every row gets a result.
test.describe.configure({ mode: 'default' });

let m = null;

test.beforeAll(async ({ request }) => {
  m = await (await request.get('/__qualification/manifest')).json();
});

/**
 * Merges one row's result into the file. A failed row restarts Playwright's
 * worker, which would lose an in-memory map, so each row writes as it ends;
 * the config deletes the file once, when a run starts.
 */
function record(id, result) {
  let all = {};
  try { all = JSON.parse(readFileSync(OUT, 'utf8')); } catch { all = {}; }
  all[id] = isPublishable(result.evidence) ? result : { result: result.result, evidence: 'evidence withheld: it carried an address, a link or a token-like value' };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n');
}

/** Signs the page in as `role` on its deployment, keeps the cookie banner decided, and aborts anything off 127.0.0.1. */
async function signIn(page, role) {
  const s = m.sessions[role];
  if (!s?.user) throw new Step('start', 'the session did not authenticate');
  await page.addInitScript(({ token, user, consentVersion }) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('axal_cookie_consent_v1', JSON.stringify({ version: consentVersion, decided: true, updatedAt: '2026-11-26T00:00:00Z', categories: { essential: true } }));
    } catch { /* storage off: the row fails on its first screen */ }
  }, { token: s.token, user: s.user, consentVersion: CONSENT_VERSION });
  await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort('blockedbyclient'));
  return s;
}

/** A failed check, named by the step and a sentence the matrix may publish. */
/** The step the running row last reached, so a failure outside a named check still says where it stopped. */
let reached = 'start';

class Step extends Error {
  constructor(step, what) { super(`${step}: ${what}`); this.step = step; this.what = what; }
}

/** Runs one check of a step; any failure becomes a Step naming it. */
async function check(step, what, fn) {
  reached = step;
  try { await fn(); } catch (e) {
    if (e instanceof Step) throw e;
    throw new Step(step, what);
  }
}

/** The page does not scroll sideways at 390 px. */
async function fits(page, step, where) {
  reached = step;
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (scroll > inner) throw new Step(step, `${where} scrolls sideways at ${WIDTH} px (${scroll} px wide)`);
}

/** A control the role acts with: visible, enabled and wholly inside the 390 px width. */
async function reachable(locator, step, what) {
  await check(step, `${what} is not visible`, () => expect(locator).toBeVisible());
  await check(step, `${what} is disabled`, () => expect(locator).toBeEnabled());
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box || box.x < 0 || box.x + box.width > WIDTH + 0.5) throw new Step(step, `${what} does not fit the ${WIDTH} px width`);
  return box;
}

/** One API request as the signed-in role, on its own deployment. */
async function as(page, s, method, path, body, headers = {}) {
  const res = await page.request.fetch(`${s.origin}${path}`, {
    method, headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { data: JSON.stringify(body) } : {}),
  });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

/** Runs a row, recording pass with its evidence or fail with the step that stopped it. */
function row(id, title, fn) {
  test(title, async ({ page, request }) => {
    const outsideBefore = Number((await (await request.get('/__qualification/manifest')).json()).outside_requests);
    let result;
    reached = 'start';
    try {
      result = { result: 'pass', evidence: await fn(page) };
    } catch (e) {
      result = { result: 'fail', evidence: e instanceof Step ? `failed at ${e.message}` : `failed at ${reached}: the browser could not complete an action there` };
      record(id, result);
      throw e;
    }
    // The Worker refuses every outside request and counts it; a row that caused one fails.
    const outside = Number((await (await request.get('/__qualification/manifest')).json()).outside_requests) - outsideBefore;
    if (outside) result = { result: 'fail', evidence: `${result.evidence}; failed: the Worker attempted ${outside} outside request(s)` };
    record(id, result);
    expect(outside, 'the row made the Worker attempt an outside request').toBe(0);
  });
}

row('admin', 'Admin · test territory XQ · triage a local applicant at 390 px', async (page) => {
  const s = await signIn(page, 'admin');
  const appId = m.branch.application_id;
  await page.goto(`${s.origin}/branch/approvals`);
  await check('start', 'the branch board does not list the local applicant', () => expect(page.getByText('Applicant A (synthetic)').filter({ visible: true }).first()).toBeVisible());
  await check('start', 'the applicant already shows a reviewer', () => expect(page.getByText('No reviewer is assigned').filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'start', 'the branch board');

  // The draft: the API run's two requests, as the branch admin — assign to yourself, then the triage note.
  const assigned = await as(page, s, 'POST', '/api/branch/approvals/assignments', { assignee_user_id: s.user.id, items: [{ lane: 'lp', item_id: appId }] });
  const noted = await as(page, s, 'PATCH', `/api/admin/lp-applications/${appId}`, { status: 'in_review', review_note: 'Triage: commitment within the territory range; check accreditation evidence.' });
  if (assigned.status !== 200 || noted.status !== 200) throw new Step('draft', 'the assignment or the triage note was refused');

  const openQueue = async (step) => {
    await page.goto(`${s.origin}/admin/lp-applications`);
    const fund = page.locator('select').filter({ has: page.locator('option[value="qualification-fund-i"]') }).first();
    await check(step, 'the LP applications console did not load its fund list', () => expect(fund).toBeVisible());
    await fund.selectOption('qualification-fund-i');
    await check(step, 'the console does not list the applicant', () => expect(page.getByText('Applicant A (synthetic)').filter({ visible: true }).first()).toBeVisible());
  };
  await openQueue('draft');
  await check('draft', 'the triage note is not on the application', () => expect(page.getByText(/Triage: commitment within the territory range/).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'draft', 'the LP applications console');

  await page.reload();
  await openQueue('reload');
  await check('reload', 'after a reload the note is gone', () => expect(page.getByText(/Triage: commitment within the territory range/).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'reload', 'the LP applications console');

  const followUp = page.getByTestId('lpapps-action-needs_follow_up');
  const box = await reachable(followUp, 'next_action', 'Request follow-up');
  await followUp.click();
  await check('next_action', 'the follow-up decision was not recorded', () => expect(page.getByText(/Recorded/).filter({ visible: true }).first()).toBeVisible());
  await page.reload();
  await openQueue('next_action');
  const after = await as(page, s, 'GET', '/api/admin/lp-applications?fund=qualification-fund-i');
  const stored = (after.json?.applications ?? after.json?.items ?? []).find((a) => Number(a.id) === appId);
  if (stored?.status !== 'needs_follow_up') throw new Step('next_action', 'the application is not Needs follow-up after the tap');
  await fits(page, 'next_action', 'the LP applications console');
  return `branch board lists the local applicant unassigned; the console shows it In review with its triage note before and after a reload; Request follow-up (${Math.round(box.height)} px tall) fits the width and records Needs follow-up; no sideways scroll`;
});

row('founder', 'Founder · venture A · an evidence-linked feature at 390 px', async (page) => {
  const s = await signIn(page, 'founder');
  const path = `/build/solution-design?project=${m.ids.project.A}`;
  const title = 'Auto-match bank lines to invoices';
  await page.goto(path);
  await check('start', 'Solution design does not open on its empty state', () => expect(page.getByText('Add your first feature').filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'start', 'Solution design');

  // The draft: the API run's request under company A, a Backlog feature linked to the interview pain theme.
  const made = await as(page, s, 'POST', `/api/cycles/build/features?project=${m.ids.project.A}`, {
    title, description: 'Draft: from the month-end reconciliation interviews.',
    impact: 'high', effort: 'medium', pain_group_id: m.ids.painGroup.A,
  }, { 'x-company-id': String(m.ids.company.A) });
  if (made.status !== 201) throw new Step('draft', 'the feature was refused');
  await page.goto(path);
  await check('draft', 'the draft feature is not listed', () => expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible());
  await check('draft', 'the feature does not show its pain theme', () => expect(page.getByText(/Month-end reconciliation takes days/).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'draft', 'Solution design');

  await page.reload();
  await check('reload', 'after a reload the draft feature is gone', () => expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'reload', 'Solution design');

  // Resume it: the row opens the feature, whose actions carry the next step.
  await page.getByText(title).first().click();
  await check('next_action', 'the feature does not open with its evidence', () => expect(page.getByText(/Answers Month-end reconciliation takes days/).filter({ visible: true }).first()).toBeVisible());
  const mustHave = page.getByRole('button', { name: /Mark as must-have/ }).first();
  const box = await reachable(mustHave, 'next_action', 'Mark as must-have');
  await fits(page, 'next_action', 'the feature');
  await mustHave.click();
  // The feature's "Appears in" names the MVP with Must-have once the tap is stored; a reload reads it back.
  const onMvp = page.getByRole('button', { name: /Prototype \/ MVP\s*Must-have/ });
  await check('next_action', 'the tap did not mark the feature a must-have', () => expect(onMvp).toBeVisible());
  await page.reload();
  await check('next_action', 'after a reload the feature is not a must-have', () => expect(onMvp).toBeVisible());
  return `Solution design opens empty; the evidence-linked feature is listed with its pain theme before and after a reload; the feature opens and Mark as must-have (${Math.round(box.height)} px tall) fits the width and is recorded; no sideways scroll`;
});

row('investor', 'Investor A · screen a deal; LP position apart from the managed fund at 390 px', async (page) => {
  const s = await signIn(page, 'investor');
  await page.goto('/deals');
  await check('start', 'Deal flow does not show the invited deal as new', () => expect(page.getByText('1 new').filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'start', 'Deal flow');

  // The draft: the API run's two requests — add the invited deal at Screening, then the private note.
  const inbox = await as(page, s, 'GET', '/api/deals/flow/inbox');
  const item = (inbox.json?.items ?? []).find((i) => Number(i.deal_id) === m.ids.deal.A);
  const added = await as(page, s, 'POST', '/api/deals/flow', { deal_id: m.ids.deal.A, stage: 'screening', ...(item?.key ? { via_key: item.key } : {}) });
  const noted = await as(page, s, 'PATCH', `/api/deals/flow/${m.ids.deal.A}`, { note: 'Screening draft: strong pain evidence; check churn in pilots.' });
  if (added.status !== 201 || noted.status !== 200) throw new Step('draft', 'the deal or its screening note was refused');
  await page.goto('/deals');
  await check('draft', 'Deal flow does not count the deal at Screening', () => expect(page.getByRole('button', { name: /Screening 1/ }).first()).toBeVisible());
  await fits(page, 'draft', 'Deal flow');

  await page.goto('/deals/screening');
  await page.reload();
  await check('reload', 'after a reload Screening does not hold the deal', () => expect(page.getByRole('link', { name: 'Venture A (synthetic)' }).first()).toBeVisible());
  await fits(page, 'reload', 'Screening');
  // The two fund destinations: the managed fund's back office, and the LP's own workspace holding only the LP position.
  await page.goto('/funds');
  await check('reload', 'Funds does not open the managed fund as the investor\'s own', () => expect(page.getByText('Investor A Managed Fund (synthetic)').filter({ visible: true }).first()).toBeVisible());
  await check('reload', 'Funds does not say it is the GP back office', () => expect(page.getByText('Run my fund').filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'reload', 'Funds');
  await page.goto('/lp-portal');
  await check('reload', 'the LP workspace does not show the LP commitment', () => expect(page.getByText(/You are a committed LP/).filter({ visible: true }).first()).toBeVisible());
  await check('reload', 'the LP workspace shows the managed fund', () => expect(page.getByText('Investor A Managed Fund (synthetic)')).toHaveCount(0));
  await fits(page, 'reload', 'the LP workspace');

  await page.goto('/deals/screening');
  const move = page.getByRole('button', { name: 'Move to diligence' }).first();
  const box = await reachable(move, 'next_action', 'Move to diligence');
  await move.click();
  // The move asks once, and says the founder is not notified: a local record change.
  const dialog = page.getByRole('dialog', { name: /to diligence/ });
  await check('next_action', 'the move did not ask for confirmation', () => expect(dialog).toBeVisible());
  await check('next_action', 'the confirmation does not say the founder is not notified', () => expect(dialog).toContainText('The founder is not notified'));
  const confirm = dialog.getByRole('button', { name: 'Move to diligence' });
  await reachable(confirm, 'next_action', 'the confirmation\'s Move to diligence');
  await confirm.click();
  const stage = async () => {
    const r = await as(page, s, 'GET', '/api/deals/flow');
    return (r.json?.items ?? []).find((i) => Number(i.deal_id) === m.ids.deal.A)?.stage ?? null;
  };
  await check('next_action', 'the tap did not move the deal to Diligence', () => expect.poll(stage, { timeout: 15_000 }).toBe('diligence'));
  await fits(page, 'next_action', 'Screening');
  return `Deal flow shows the invited deal as new, then counts it at Screening; after a reload Screening holds it; Funds opens the managed fund as Run my fund while the LP workspace shows only the LP commitment; Move to diligence (${Math.round(box.height)} px tall) fits the width and is recorded; no sideways scroll`;
});

row('advisor', 'Advisor A · December cohort · session preparation at 390 px', async (page) => {
  const s = await signIn(page, 'advisor');
  const path = `/cohorts/guidance?cohort=${m.ids.cohort.A}`;
  const title = 'Session preparation: pricing clinic';
  await page.goto(path);
  await check('start', 'the assigned cohort\'s Guidance does not open', () => expect(page.getByRole('button', { name: 'New guidance' }).first()).toBeVisible());
  await check('start', 'Guidance already holds the session note', () => expect(page.getByText(title)).toHaveCount(0));
  await fits(page, 'start', 'Guidance');

  // The draft: the API run's request, a private draft of the cohort's guidance (no session-preparation record exists).
  const made = await as(page, s, 'POST', `/api/advisors/me/cohort/${m.ids.cohort.A}/guidance`, {
    draft: true, title, body: 'Agenda draft: anchor pricing, pilot-to-paid, two founder questions.',
  });
  if (made.status !== 201) throw new Step('draft', 'the session-preparation draft was refused');
  await page.goto(path);
  await check('draft', 'the draft is not listed', () => expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'draft', 'Guidance');

  await page.reload();
  await check('reload', 'after a reload the draft is gone', () => expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'reload', 'Guidance');

  const publish = page.getByRole('button', { name: 'Publish', exact: true }).first();
  const box = await reachable(publish, 'next_action', 'Publish');
  await publish.click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Publish/ });
  if (await confirm.count()) await confirm.first().click();
  const published = async () => {
    const r = await as(page, s, 'GET', `/api/advisors/me/cohort/${m.ids.cohort.A}/guidance`);
    const it = (r.json?.items ?? []).find((i) => i.uid === made.json?.uid);
    return it ? (it.is_draft === false || Number(it.is_draft) === 0) : null;
  };
  await check('next_action', 'the tap did not publish the guidance', () => expect.poll(published, { timeout: 15_000 }).toBe(true));
  await fits(page, 'next_action', 'Guidance');
  return `the assigned cohort's Guidance opens with no note; the session-preparation draft is listed before and after a reload; Publish (${Math.round(box.height)} px tall) fits the width and publishes it in-app; no sideways scroll`;
});

row('partner', 'Operating Partner A · qualify a fictional opportunity at 390 px', async (page) => {
  const s = await signIn(page, 'partner');
  const scope = 'Qualified: six weeks, clickable prototype, five pilot users.';
  await page.goto('/pipeline/leads');
  await check('start', 'the fictional opportunity is not an open lead', () => expect(page.getByText(/Reconciliation prototype \(fictional\)/).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'start', 'Pipeline · Leads');

  // The draft, in the browser: Draft proposal opens the lead's sheet; Write a draft, fill it, Save draft.
  const openDraft = async (step) => {
    const open = page.getByTestId('lead-draft-proposal').first();
    await reachable(open, step, 'Draft proposal');
    await open.click();
    await check(step, 'the opportunity sheet did not open its draft block', () => expect(page.getByTestId('lead-proposal-draft')).toBeVisible());
  };
  await openDraft('draft');
  await check('draft', 'the lead already holds a draft', () => expect(page.getByTestId('lead-draft-none')).toBeVisible());
  await page.getByTestId('lead-draft-new').click();
  await page.getByTestId('lead-draft-shape').selectOption('fixed_project');
  await page.getByTestId('lead-draft-price').fill('12000');
  await page.getByTestId('lead-draft-currency').fill('USD');
  await page.getByTestId('lead-draft-scope').fill(scope);
  const save = page.getByTestId('lead-draft-save');
  await reachable(save, 'draft', 'Save draft');
  await save.click();
  await check('draft', 'the saved draft is not shown', () => expect(page.getByTestId('lead-draft')).toContainText(scope));
  await fits(page, 'draft', 'the opportunity sheet');

  await page.reload();
  await openDraft('reload');
  await check('reload', 'after a reload the draft is gone', () => expect(page.getByTestId('lead-draft')).toContainText(scope));
  await check('reload', 'the draft does not say it was not sent', () => expect(page.getByTestId('lead-draft-label')).toHaveText(/not sent/));
  await fits(page, 'reload', 'the opportunity sheet');

  // The hand-off has no Leads control (bidding is on Proposals, #2338): the API run's requests send the
  // proposal, the synthetic founder accepts it, delivery starts and the first-delivery milestone is added.
  const founder = m.sessions.founder;
  const sent = await as(page, s, 'POST', `/api/needs/${m.ids.need.A}/quotes`, { price: 12000, timeline_weeks: 6, deliverables: scope });
  const accepted = sent.json?.id ? await as(page, founder, 'POST', `/api/quotes/${sent.json.id}/accept`) : { status: 0, json: null };
  const engagementId = Number(accepted.json?.engagement_id ?? accepted.json?.engagement?.id ?? 0);
  const board = await as(page, s, 'GET', '/api/partner/delivery/board');
  const engagement = Number(engagementId || (board.json?.items ?? [])[0]?.engagement_id || 0);
  const started = engagement ? await as(page, s, 'POST', `/api/engagements/${engagement}/start`) : { status: 0 };
  const milestone = engagement ? await as(page, s, 'POST', `/api/partner/delivery/engagements/${engagement}/milestones`, { title: 'First delivery: clickable prototype', due_date: '2026-12-15' }) : { status: 0 };
  if (sent.status !== 200 || accepted.status !== 200 || started.status !== 200 || ![200, 201].includes(milestone.status)) {
    throw new Step('next_action', 'the proposal, acceptance, start or milestone was refused');
  }
  await page.goto('/delivery');
  const openEngagement = page.getByRole('button', { name: 'Open engagement' }).first();
  await reachable(openEngagement, 'next_action', 'Open engagement');
  await fits(page, 'next_action', 'Delivery');
  await openEngagement.click();
  await check('next_action', 'the engagement sheet does not show the first-delivery milestone', () => expect(page.getByText('0 / 1 milestones').filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'next_action', 'the engagement sheet');
  // Resume the saved engagement where its milestones are kept, and complete the first delivery.
  await page.goto('/delivery/health');
  // Health opens on At risk; an on-track engagement is under All.
  await page.getByRole('button', { name: 'All', exact: true }).first().click();
  const record = page.getByRole('button', { name: 'Record', exact: true }).first();
  await reachable(record, 'next_action', 'the engagement\'s Record');
  await record.click();
  await check('next_action', 'Delivery · Health does not list the first-delivery milestone', () => expect(page.getByText('First delivery: clickable prototype').filter({ visible: true }).first()).toBeVisible());
  const complete = page.getByRole('button', { name: 'Complete', exact: true }).first();
  const box = await reachable(complete, 'next_action', 'Complete');
  await complete.click();
  const completed = async () => {
    const r = await as(page, s, 'GET', `/api/partner/delivery/engagements/${engagement}/milestones`);
    const it = (r.json?.items ?? []).find((x) => /First delivery/.test(String(x.title)));
    return Boolean(it?.completed_at) || it?.status === 'done';
  };
  await check('next_action', 'the tap did not complete the milestone', () => expect.poll(completed, { timeout: 15_000 }).toBe(true));
  await fits(page, 'next_action', 'Delivery · Health');
  return `the fictional opportunity is an open lead; its proposal draft is written and saved in the opportunity sheet, and reads back after a reload as not sent; after the API hand-off the engagement is on Delivery and Complete (${Math.round(box.height)} px tall) fits the width and completes the first-delivery milestone; no sideways scroll`;
});

row('pending', 'Pending review (control) at 390 px', async (page) => {
  await signIn(page, 'pending');
  await page.goto('/');
  await check('start', 'the member does not land on its Exploring state', () => expect(page.getByText(/reviewing your profile/).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'start', 'Exploring');
  // A role surface is not reachable before activation: each sends the member back to its Exploring state.
  for (const path of ['/deals', '/pipeline/leads', `/build/solution-design?project=${m.ids.project.A}`]) {
    await page.goto(path);
    await check('next_action', 'a role surface opened for a pending member', () => expect(page).toHaveURL(/\/exploring$/));
  }
  await check('next_action', 'the Exploring state is not shown after a role surface', () => expect(page.getByText(/reviewing your profile/).filter({ visible: true }).first()).toBeVisible());
  await fits(page, 'next_action', 'Exploring');
  return 'the member lands on Exploring (team reviewing the profile); Deal flow, Pipeline and Build each return it to Exploring; nothing to draft before activation; no sideways scroll';
});
