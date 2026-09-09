/**
 * `/grow` — the A5 artboard, element by element.
 *
 * WHAT THE ARTBOARD ASKED FOR THAT WAS NOT THERE:
 *
 *   the chip order      A5's `anchG` is Focus, Talent, Customers, Partnerships,
 *                       Capital match, Brand, Launch; Customers sat second
 *   three focus stats   leads captured, trial → paid, open roles
 *   the funnel row      five tiles under Customers
 *   applicant counts    "1 role live · 14 applicants". `jobsApi.applications`
 *                       exists, `/grow/talent` already calls it, and this desk
 *                       printed "Applicant total: Not recorded" over it
 *   the launch calendar `/grow/launch` reads `api.listCalendarEvents`; the desk
 *                       summarised the same zone off co-marketing attributions
 *                       alone, so a founder whose launches were on the calendar
 *                       read an empty card
 *   two proposal bands  the outreach sequence and the applicant ranking
 *
 * AND WHAT IT ASKS FOR THAT THIS PRODUCT CANNOT DO (D56/D68):
 *
 *   THE FIFTH STAGE     A5's funnel is Contacted / Replied / Demo / Trial /
 *                       Paid. `crm_status` is new / invited / followed_up /
 *                       promoted, and nothing anywhere records that a customer
 *                       started paying. Four tiles, four stages.
 *   "Trial → paid"      the same absence, stated on the stat rather than
 *                       computed from a state that does not exist
 *   the hero imagery    no image model is wired into this build
 *   the fit scores      no reranker runs, so no score, no reason and no warm
 *                       path is shown beside a prospect
 *   "Move to screen"    nothing writes `job_applications.status`, so the band
 *                       produces a reading and says so
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Founder Workspaces Canvas.dc.html');
const page = read('frontend/src/pages/founder/FounderGrowDesk.jsx');
const css = raw('frontend/src/pages/founder/founderGrowDesk.css');
const worker = raw('cloudflare-worker/src/routes/research.ts');
const progress = raw('cloudflare-worker/src/routes/progress.ts');
const launch = read('frontend/src/pages/founder/FounderGrowLaunch.jsx');

/** The A5 artboard, bounded by the two markers either side of it. */
const A5 = CANVAS.slice(
  CANVAS.indexOf('ARTBOARD 5 — GROW'),
  CANVAS.indexOf('ARTBOARD 6'),
);
assert.ok(A5.includes('Get customers, people, reach'), 'the A5 artboard could not be found in the canvas');
const ANCH_G = CANVAS.match(/anchG: this\.anchorsFor\('G', \[([\s\S]*?)\]\),/)?.[1] || '';
assert.ok(ANCH_G.includes('g-focus'), 'A5’s anchor row could not be found in the canvas');
const A5DATA = CANVAS.slice(CANVAS.indexOf('// ---- Grow ----'), CANVAS.indexOf('// ---- Network ----'));
assert.ok(A5DATA.includes('growStats: ['), 'A5’s data block could not be found in the canvas');

const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&')
  .replace(/^\s*(?:--|\/\/|\*)/gm, '')
  .replace(/\s+/g, ' ');

test('the headline and its one-line answer to “why this page” are the artboard’s', () => {
  assert.ok(page.includes('Get customers, people, reach'));
  const line = 'One metric owns the month. Everything below is a lever on it.';
  assert.ok(flat(A5).includes(line), 'the artboard’s subtitle changed');
  assert.ok(flat(page).includes(line), 'the desk no longer carries the artboard’s subtitle');
});

test('the chip row is the artboard’s anchors, in its order', () => {
  const labels = [...ANCH_G.matchAll(/\['([^']+)','[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Focus', 'Talent', 'Customers', 'Partnerships', 'Capital match', 'Brand', 'Launch']);
  const sections = page.match(/const SECTIONS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual([...sections.matchAll(/\['([^']+)', '[^']+'\]/g)].map((m) => m[1]), labels,
    'the chip row is no longer A5’s anchors in A5’s order');
});

test('the cards are the artboard’s cards, in its order', () => {
  const titles = [...A5.matchAll(/class="zt">([^<]+)</g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.deepEqual(titles, ['Customers', 'Talent', 'Brand & landing', 'Capital match', 'Partnerships', 'Launch calendar']);
  const drawn = [...page.matchAll(/<(?:Card|Head)\b[^>]*?title="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(drawn[0], "This month's focus", 'the focus card is no longer first');
  // The artboard's own PAIR puts Customers left of Talent while its ANCHOR row
  // names Talent first; the anchor row is the reading the chips follow and the
  // pair is the reading the cards follow, so the card list is the `zt` list.
  assert.deepEqual([...drawn.slice(1)].sort(), [...titles].sort(),
    'the overview is no longer the artboard’s six cards');
});

test('the focus card carries the artboard’s three stats', () => {
  const stats = [...A5DATA.matchAll(/\{ label:'([^']+)', value:'[^']*' \}/g)].map((m) => m[1]);
  assert.deepEqual(stats, ['Leads captured', 'Trial → paid', 'Open roles']);
  for (const label of stats) {
    assert.ok(page.includes(`label="${label}"`), `the ${label} stat is missing`);
  }
  // Trial → paid is the one with nothing behind it: `crm_status` has no paid
  // state, so the stat says so rather than dividing by a stage that cannot
  // exist.
  assert.match(page, /label="Trial → paid" value="Not recorded" note="No paid state is recorded against a customer"/);
  assert.ok(flat(A5).includes('Everything else this month is subordinate to this number.'));
  assert.ok(flat(page).includes('Everything else this month is subordinate to this number.'));
  // THE LAYOUT RULE, NOT ANY RULE WITH THIS SELECTOR. The narrow-viewport
  // override further down the file carries the same class name, so a check for
  // the bare selector passes on the media query's behalf while the rule that
  // lays the row out is gone — the exact escape `/validate`'s CSS assertions
  // shipped with.
  assert.match(css, /(^|\})\.a5-focus-stats\{display:flex/m, 'the stat row has no layout rule');
});

test('the customer funnel is the four stages the store records, not the artboard’s five', () => {
  const artboard = [...A5DATA.matchAll(/\{ stage:'([^']+)', n:'\d+' \}/g)].map((m) => m[1]);
  assert.deepEqual(artboard, ['Contacted', 'Replied', 'Demo', 'Trial', 'Paid']);
  // The store's own ranking, which is the whole vocabulary a signup can be in.
  const rank = progress.match(/const CRM_STATUS_RANK: Record<string, number> = \{([^}]*)\}/)?.[1] || '';
  const stored = [...rank.matchAll(/(\w+): \d+/g)].map((m) => m[1]);
  assert.deepEqual(stored, ['new', 'invited', 'followed_up', 'promoted']);
  const stages = page.match(/const CRM_STAGES = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual([...stages.matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]), stored,
    'the funnel row no longer draws exactly the stages a signup can be in');
  // AND NONE OF THE ARTBOARD'S INVENTED ONES IS A HEADING.
  for (const fake of ['Demo', 'Trial', 'Paid']) {
    assert.ok(!new RegExp(`'${fake}'\\]`).test(stages), `${fake} is drawn as a stage nothing records`);
  }
  assert.match(page, /Four stages, because four are recorded\./);
  // AND THE MODEL IS TOLD THE SAME FOUR. A band that drafts outreach over this
  // funnel will otherwise place people at a demo or a trial — stages the
  // artboard names and the store cannot hold — and the founder reads a sequence
  // addressed to a state nobody is in.
  const table = worker.slice(worker.indexOf('const DRAFT_SURFACES'));
  const customers = table.slice(table.indexOf("'grow/customers': {"), table.indexOf("'grow/talent': {"));
  const named = customers.match(/Use only the (\w+) stages the record has — ([^.]+)\./)?.[2] || '';
  assert.deepEqual(
    named.split(',').map((s) => s.trim().replace(/^and /, '').replace(/ /g, '_')),
    stored,
    'the outreach instruction no longer names exactly the stages a signup can be in',
  );
  assert.match(customers, /Do not place anyone at a demo, a trial or a paid plan: none of those is recorded\./);
  assert.match(page, /data-testid="chart-grow-funnel"/);
  assert.match(css, /(^|\})\.a5-funnel\{/m);
});

test('the applicant count is read, and an unread one is not a zero', () => {
  assert.match(page, /jobsApi\.applications\(role\.id\)/,
    'the desk no longer reads applicant counts');
  // A FAILED READ IS NOT ZERO APPLICANTS. `|| 0` here would tell a founder
  // nobody applied whenever the read behind it failed — the same shape the
  // Build board shipped with.
  assert.match(page, /count: item\.status === 'fulfilled' \? list\(item\.value, 'applications'\)\.length : null,/);
  assert.match(page, /applicantTotal: known\.length === applicants\.length && applicants\.length\n\s*\? known\.reduce\(\(sum, row\) => sum \+ row\.count, 0\)\n\s*: null,/);
  assert.match(page, /data\.applicantTotal === null \? 'applicant count unavailable'/);
  assert.doesNotMatch(page, /Applicant total: Not recorded/,
    'the card still claims the applicant total is unrecorded');
  // "N roles live" counts LIVE roles, not every stored one.
  assert.match(page, /liveRoles: jobs\.filter\(\(row\) => text\(row\.status\) === 'published' \|\| text\(row\.status\) === 'open'\),/);
});

test('the launch card reads the calendar the page it links to reads', () => {
  assert.match(launch, /api\.listCalendarEvents\(\{ from: from\.toISOString\(\), to: to\.toISOString\(\) \}\)/,
    'the launch page no longer reads the calendar');
  assert.match(page, /events: api\.listCalendarEvents\(calendarWindow\(\)\),/,
    'the desk no longer reads the calendar its launch card summarises');
  // The same window, or the card shows fewer entries than the page behind it.
  assert.match(page, /from\.setFullYear\(from\.getFullYear\(\) - 1\);/);
  assert.match(page, /to\.setFullYear\(to\.getFullYear\(\) \+ 1\);/);
  assert.match(page, /list\(records\.events, 'items', 'events'\)/,
    'the desk reads a response key the calendar route does not send');
  assert.match(page, /function launchLabel\(events\) \{/);
  assert.match(page, /if \(next == null\) return 'No dated entry';/);
});

test('the two proposal bands are mounted, off by default, and allow-listed', () => {
  const bands = [...A5.matchAll(/class="propb">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(bands, ['Proposal · outreach sequence', 'Match · why this one']);
  const mounted = [...page.matchAll(/<ZoneDraft\n\s*surface="([^"]+)"[\s\S]{0,400}?label="([^"]+)"/g)];
  assert.deepEqual(mounted.map((m) => m[1]).sort(), ['grow/customers', 'grow/talent']);
  assert.deepEqual(mounted.map((m) => m[2]).sort(), [...bands].sort(),
    'the desk no longer carries A5’s two bands');
  for (const surface of mounted.map((m) => m[1])) {
    assert.ok(worker.includes(`'${surface}': {`), `${surface} is mounted with no DRAFT_SURFACES entry`);
  }
  assert.match(page, /const \[fillsOn\] = useAssistMode\('Grow'\);/);
  assert.match(page, /const bandOn = fillsOn && Boolean\(projectId\);/);
  assert.equal((page.match(/\{bandOn \? <ZoneDraft/g) || []).length, 2,
    'a Grow band is mounted outside the assist-mode gate');
  assert.equal((page.match(/accent="violet"/g) || []).length, 2,
    'a founder band is drawing in the Partner palette');

  // ── THE TWO ARTBOARD LABELS THAT DO NOT SURVIVE, AND WHY ────────────────
  //
  // `Edit touch 1` would mean editing one touch of three; the draft is a single
  // body, so the shared `Edit first` is what the control actually does.
  assert.ok(!page.includes('Edit touch 1'), 'a control promises to edit one touch of a sequence');
  // `Move to screen` is a write to `job_applications.status`, and no route
  // exposes one. A button that said it and did nothing is the exact defect this
  // suite keeps catching.
  assert.ok(!page.includes('Move to screen'), 'a control promises a write no route performs');
  assert.match(page, /foot="A reading only\. Nothing here moves an application to a screen\."/);
  // `Accept sequence` IS the artboard's label and it survives, because
  // accepting a drafted sequence is exactly what the control does.
  assert.match(page, /accept="Accept sequence"/);
});

test('every Grow draft surface scopes to a project the caller owns', () => {
  const table = worker.slice(worker.indexOf('const DRAFT_SURFACES'));
  for (const surface of ['grow/customers', 'grow/talent']) {
    const body = table.slice(table.indexOf(`'${surface}': {`));
    const gather = body.slice(body.indexOf('gather:'), body.indexOf('\n  },'));
    assert.match(gather, /const pid = await founderProject\(c, userId, scope\);/,
      `${surface} does not resolve its project through the ownership check`);
    assert.match(gather, /if \(pid == null\) return \[\];/);
  }
  // An applicant's EMAIL is not handed to a third-party model: it identifies a
  // real person and adds nothing a ranking can use.
  // To the END of the entry, not a fixed character budget: the reason this
  // gather omits the email is a paragraph inside it, and a slice that stopped
  // short would report the paragraph missing rather than the column present.
  const talentStart = table.indexOf("'grow/talent': {");
  const talent = table.slice(talentStart, table.indexOf('\n};', talentStart));
  assert.doesNotMatch(talent, /SELECT[^`]*\bemail\b/, 'an applicant email is being sent to the model');
  assert.match(talent, /APPLICANT'S EMAIL IS DELIBERATELY NOT HERE/);
  // And the outreach gather carries the founder's own recorded pains, because
  // "opens on a pain their own segment named" is what the band is for.
  const customers = table.slice(table.indexOf("'grow/customers': {"), table.indexOf("'grow/talent': {"));
  assert.match(customers, /FROM pain_groups g WHERE g\.project_id = \?/);
  assert.match(customers, /NO PAIN IS RECORDED for this startup/);
});

test('A5 never turns canvas fixtures into product data or claims', () => {
  assert.doesNotMatch(page, /14 of 25|38 in play|61 leads|37%|Nadia Okonkwo|Verwood|Latitude Seed|Thornbury Capital|Verwood Ventures|Mistral|FLUX|flux-|GPT-OSS|BGE-M3|DeepSeek|Llama|QwQ|Granite|\$14\.20|\$0\.0000528|Generate 4 more|See all 14 ranked/i);
  // The three claims about capability that A5 makes and this build cannot.
  assert.match(page, /Hero imagery is not generated here and cannot be: no image model is wired into this build/);
  assert.match(page, /no reranker runs here, so no fit score, no reason and no warm path is shown/);
  assert.match(page, /Acting on any of these hands off to Raise; this zone only lists\./);
});
