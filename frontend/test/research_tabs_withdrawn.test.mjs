/**
 * The Research row is /market-intel and nothing else (documentation/architecture/DECISIONS.md D12).
 *
 * Four tabs under `/advisor/research/*` — companies, AI research, news,
 * documents — rendered a 54KB fixture with zero API calls. They are withdrawn
 * on D9's reasoning: the material needs a PitchBook/Crunchbase-class source and
 * a licence before a single row of it is real.
 *
 * The guard exists because withdrawal is the kind of change that gets quietly
 * undone. A future reader sees an empty Research group, or a nav row pointing
 * at nothing, and "restores" it — landing back on fabricated data. Worse, the
 * two backends D9 named (`news.ts`, `assistant.ts`) DO exist and ARE mounted,
 * so anyone re-checking by grepping router names reaches D9's wrong conclusion
 * again. That is the trap this file is here to spring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const WITHDRAWN = ['companies', 'ai', 'news', 'documents'];

test('no route serves a withdrawn Research tab', () => {
  const app = read('frontend/src/App.jsx');
  for (const tab of WITHDRAWN) {
    assert.doesNotMatch(
      app, new RegExp(`path="/advisor/research/${tab}"`),
      `/advisor/research/${tab} was withdrawn — it has no backend (D12)`,
    );
  }
});

test('the section root and the market tab still redirect to the live surface', () => {
  // The SECTION survives — /market-intel is real. Only the four tabs went.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/advisor\/research" element=\{<Navigate to="\/market-intel"/);
  assert.match(app, /path="\/advisor\/research\/market" element=\{<Navigate to="\/market-intel"/);
});

test('the withdrawn tabs are not redirected to /market-intel either', () => {
  // Deliberate: /market-intel has no company, document or news data. Pointing
  // "Companies" at it trades a blank surface for a misleading one.
  const app = read('frontend/src/App.jsx');
  for (const tab of WITHDRAWN) {
    assert.doesNotMatch(app, new RegExp(`/advisor/research/${tab}"[^\\n]*Navigate`));
  }
});

test('no nav row links a withdrawn tab', () => {
  const nav = read('frontend/src/sidebarConfig.js');
  assert.doesNotMatch(nav, /advisor\/research/,
    'twenty nav rows across five role navs were removed with the tabs');
});

test('every surviving Research group still offers Market', () => {
  // An empty group is a worse outcome than a removed one — it reads as a
  // rendering bug. Admin's group was dropped for exactly this reason.
  const nav = read('frontend/src/sidebarConfig.js');
  const groups = [...nav.matchAll(/\{ key: 'research', label: 'Research', items: \[([\s\S]*?)\]\}/g)];
  assert.ok(groups.length >= 4, `expected the surviving Research groups, found ${groups.length}`);
  for (const g of groups) {
    assert.match(g[1], /market-intel/, 'a Research group with no Market row is empty');
    assert.doesNotMatch(g[1], /advisor\/research/);
  }
});

test('the pages and the fixture are gone, not orphaned', () => {
  for (const p of [
    'frontend/src/pages/advisor/research/AdvisorResearchWorkspace.jsx',
    'frontend/src/pages/advisor/research/CompaniesPage.jsx',
    'frontend/src/pages/advisor/research/NewsPage.jsx',
    'frontend/src/pages/advisor/research/AIResearchPage.jsx',
    'frontend/src/pages/advisor/research/DocumentsPage.jsx',
    'frontend/src/pages/advisor/research/kit.jsx',
    'frontend/src/data/advisor/research.js',
  ]) {
    assert.equal(existsSync(resolve(root, p)), false, `${p} must be deleted, not left unreferenced`);
  }
  // And nothing still imports the workspace.
  assert.doesNotMatch(read('frontend/src/App.jsx'), /AdvisorResearchWorkspace/);
});

test('the Advisory tabs are deliberately still here', () => {
  // D12 scoped these OUT and this test asserted the FIXTURE had to stay until
  // #124 unblocked. D31 corrected that: D12 named partner_office_hours.ts as
  // the only possible home without checking `advisors.ts`, which carries the
  // whole advisor side (profile, slots, bookings, transitions, reviews). The
  // tabs are now wired there and the fixture is deleted.
  //
  // The intent survives and is what is asserted: these tabs are NOT the
  // withdrawn Research tabs and must not be deleted as "the same thing". The
  // mechanism changed because "still here" no longer requires a fixture.
  assert.equal(existsSync(resolve(root, 'frontend/src/data/advisor/advisory.js')), false,
    'the Advisory fixture is deleted — the tabs read advisors.ts now (documentation/architecture/DECISIONS.md D31)');
  assert.match(read('frontend/src/App.jsx'), /path="\/advisor\/advisory\/opportunities"/);
  for (const p of [
    'frontend/src/pages/advisor/advisory/OpportunitiesPage.jsx',
    'frontend/src/pages/advisor/advisory/ClientsPage.jsx',
    'frontend/src/pages/advisor/advisory/EngagementsPage.jsx',
    'frontend/src/pages/advisor/advisory/DeliveryPage.jsx',
    'frontend/src/pages/advisor/advisory/ContractsPage.jsx',
  ]) {
    assert.equal(existsSync(resolve(root, p)), true, `${p} must not be withdrawn`);
  }
});

test('#124 stays frozen — wiring the Advisory tabs did not touch /office-hours', () => {
  // D31's boundary, made checkable. The two were conflated by the shared word
  // "advisory": /advisor/advisory/* reads advisors.ts, while the Advisory
  // Practice canvas (#124) is /office-hours against partner_office_hours.ts and
  // is on the do-not-touch list.
  for (const p of [
    'frontend/src/pages/advisor/advisory/OpportunitiesPage.jsx',
    'frontend/src/pages/advisor/advisory/ClientsPage.jsx',
    'frontend/src/pages/advisor/advisory/EngagementsPage.jsx',
    'frontend/src/pages/advisor/advisory/DeliveryPage.jsx',
    'frontend/src/pages/advisor/advisory/ContractsPage.jsx',
  ]) {
    const s = read(p);
    assert.ok(!/office-hours/.test(s), `${p} reaches into /office-hours — #124 is frozen`);
    assert.ok(!/partner-portal\/office/.test(s), `${p} calls a partner office-hours endpoint`);
  }
  assert.match(read('documentation/architecture/DECISIONS.md'), /### D31\./, 'D31 must record why D12 was corrected');
});

test('D9 carries the correction, so the wrong table is not re-read as fact', () => {
  // news.ts and assistant.ts are real and mounted — anyone re-verifying by
  // grepping router names lands on D9's original conclusion again.
  const d = read('documentation/architecture/DECISIONS.md');
  assert.match(d, /This table was itself wrong for two rows/);
  assert.match(d, /### D12\./);
});

test('the decisions summary counts the decisions that are actually there', () => {
  // This used to assert the literal words "All twelve decisions are now
  // resolved", and adding two more decisions broke it. That is the failure
  // mode a hardcoded total always has: the cheapest repair is to bump the
  // number, which is indistinguishable from the count being right, so the
  // assertion stops meaning anything. Derive it instead.
  const d = read('documentation/architecture/DECISIONS.md');
  const partOne = d.slice(0, d.indexOf('## Part 2'));
  const numbered = [...partOne.matchAll(/^### D(\d+)\./gm)].map((m) => Number(m[1]));
  assert.ok(numbered.length > 0, 'Part 1 must carry numbered decisions');

  // No gaps and no repeats — a duplicate D-number is how two decisions end up
  // being cited by the same name from different files.
  assert.deepEqual(numbered, [...numbered].sort((a, b) => a - b), 'decisions run in order');
  assert.equal(new Set(numbered).size, numbered.length, 'no duplicate D-numbers');
  assert.deepEqual(numbered, Array.from({ length: numbered.length }, (_, i) => i + 1),
    'decisions are numbered 1..N with no gaps');

  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
    'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven',
    'twenty-eight', 'twenty-nine', 'thirty', 'thirty-one', 'thirty-two',
    'thirty-three', 'thirty-four', 'thirty-five'];
  const word = WORDS[numbered.length];
  assert.ok(word, `add ${numbered.length} to WORDS in this test`);
  assert.match(partOne, new RegExp(`All ${word} decisions are now resolved`),
    `the summary must say "All ${word}" — Part 1 carries ${numbered.length} decisions`);
});
