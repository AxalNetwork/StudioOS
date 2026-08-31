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
  assert.match(desk, /mode=workspace/);
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