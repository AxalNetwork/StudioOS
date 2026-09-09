import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
test('A4 Raise desk uses selected-project source records and preserves the pitch workspace', () => {
  const desk = read('frontend/src/pages/founder/FounderRaiseDesk.jsx');
  const workspace = read('frontend/src/pages/PitchWorkspacePage.jsx');
  const editor = read('frontend/src/pages/PitchDeckPage.jsx');
  assert.match(desk, /Get capital, stay legal/);
  for (const call of ['api\\.raiseRound\\(projectId\\)', 'api\\.raiseProspects\\(projectId\\)', 'api\\.listDocuments\\(projectId\\)', 'api\\.dataRoom\\(project\\.uid\\)', 'api\\.deckListVersions\\(projectId\\)']) assert.match(desk, new RegExp(call));
  // WAS `assert.match(desk, /mode=workspace/)`, ON A READING THAT NO LONGER
  // HOLDS. The point of that line was that the seeded handoff to the pitch
  // workspace survived — but `?mode=workspace` is read by `App.jsx` and renders
  // the shared `FounderWorkspaceTabs` INSTEAD of `/raise/pitch`, so the Pitch
  // card's own link went past the page it summarises. The seeding is what
  // mattered and it is unchanged: the workspace still reads
  // `founderRaiseSeed`, and it is still reachable — from the sidebar and from
  // the pitch page itself, which is where a workspace belongs.
  //
  // What this now requires is the rule the desk was missing: every card links
  // to its own `/raise/*` page.
  assert.doesNotMatch(desk, /mode=workspace/,
    'a Raise card is routing through the shared workspace instead of to its own page');
  // Each card's own DeskLink, matched by its test id, so a card cannot pass on
  // a path that appears somewhere else in the file.
  for (const [testid, path] of [
    ['link-open-round-status', '/raise/status'],
    ['link-open-capital', '/raise/capital'],
    ['link-open-legal', '/raise/legal'],
    ['link-open-data-room', '/raise/data-room'],
    ['link-open-pitch-workspace', '/raise/pitch'],
    ['link-open-liquidity', '/raise/liquidity'],
  ]) {
    const link = desk.match(new RegExp(`testid="${testid}"\\s+to=\\{([^}]*)\\}`));
    assert.ok(link, `the ${testid} link is gone from the Raise desk`);
    assert.ok(link[1].includes(path), `${testid} points at ${link[1]}, not ${path}`);
  }
  assert.doesNotMatch(desk, /to="\/liquidity"/,
    '`/liquidity` is a workspace mount; `/raise/liquidity` is this bucket’s own page');
  assert.match(workspace, /location\.state\?\.founderRaiseSeed/);
  assert.match(workspace, /initialProjects=\{raiseSeed\?\.projects\}/);
  assert.match(editor, /Number\(searchParams\.get\('project_id'\)\)/);
  assert.match(editor, /if \(!initialProjects\.length\)/,
    'a seeded Raise handoff must not immediately duplicate the project-list request');
  assert.match(desk, /No dilution calculation is shown/);
  assert.match(desk, /Clause analysis and term-sheet warnings: Not recorded/);
  assert.match(desk, /No project-linked exit model or secondary is recorded/);
  assert.doesNotMatch(desk, /Kestrel|DeepSeek|Llama|FLUX|QwQ|Granite|\$620,000|\$1\.5M|\$435k|\$185k|Oct 14|22 days|9 investors|full ratchet|anti-dilution|2x participating|Slack|cohort retention|\$14\.20/i);
});

test('a per-share price is not rendered by the whole-dollar formatter', () => {
  // Found by rendering FR3's new 409A panel: a real fair market value of $0.31
  // printed as "$0", because `money()` carries maximumFractionDigits: 0. It is
  // the right formatter for a cap, a SAFE and a payout and the wrong one for a
  // share price — and this particular share price is what an option strike is
  // set from, so a figure rounded away is not a rounded figure, it is a
  // different one. `perShare()` exists to keep them apart.
  const capital = read('frontend/src/pages/founder/FounderRaiseCapital.jsx');
  assert.match(capital, /const perShare = /, 'the per-share formatter is gone');
  assert.match(capital, /minimumFractionDigits: 2, maximumFractionDigits: 4/);
  assert.match(capital, /fair_market_value != null \? perShare\(/,
    'the 409A fair market value is back on the whole-dollar formatter');
  assert.doesNotMatch(capital, /fair_market_value != null \? money\(/);
});
