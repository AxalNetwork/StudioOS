// D4538 part 3 (#4538) — HQ's company-skill moderation queue shows an extension's lineage:
// "Based on <HQ name> v<n>" on an extension, "Base not readable" when the Worker could not read
// the HQ base, and nothing for a standalone skill. Both the queue row and the detail use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASE_UNREADABLE, lineageLine } from '../src/pages/hq/aiAgents/aiAgentsModel.js';

const PAGE = readFileSync(new URL('../src/pages/hq/aiAgents/HqAiAgentsPage.jsx', import.meta.url), 'utf8');
const UID = 'a'.repeat(32);

test('an extension reads "Based on <HQ name> v<n>"', () => {
  assert.equal(lineageLine({ skill_uid: UID, version: 3, name: 'Draft the monthly investor update', base_readable: true }),
    'Based on Draft the monthly investor update v3');
});

test('an unreadable base reads "Base not readable", never a name or nothing', () => {
  assert.equal(BASE_UNREADABLE, 'Base not readable');
  for (const b of [
    { skill_uid: UID, version: 1, name: null, base_readable: false },
    { skill_uid: UID, version: 1, name: 'Stale name', base_readable: false },
    { skill_uid: UID, version: 1, name: '', base_readable: true },
    { skill_uid: UID, version: null, name: 'No version', base_readable: true },
    { skill_uid: UID, version: 1 },
  ]) assert.equal(lineageLine(b), BASE_UNREADABLE, JSON.stringify(b));
});

test('a standalone skill shows no line', () => {
  assert.equal(lineageLine(null), null);
  assert.equal(lineageLine(undefined), null);
});

test('the queue row and the detail both render the line, and the fork reason only on an extension', () => {
  assert.match(PAGE, /function Lineage\(\{ basedOn \}\) \{\n  const line = lineageLine\(basedOn\);\n  return line \? <p className=\{MUTED\} data-testid="ai-agents-company-lineage">\{line\}<\/p> : null;/);
  assert.match(PAGE, /onClick=\{\(\) => open\(s\.uid\)\}>\{s\.name\}<\/button><Lineage basedOn=\{s\.based_on\} \/><\/td>/, 'the queue row');
  assert.match(PAGE, /<Lineage basedOn=\{detail\.skill\.based_on\} \/>/, 'the detail');
  assert.match(PAGE, /\{detail\.skill\.based_on && detail\.skill\.fork_reason \? <p className=\{MUTED\} data-testid="ai-agents-company-fork-reason">/);
});
