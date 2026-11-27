// #4530 — the documented source-file contract must remain compatible with the
// production library reader, draft importer, and golden-case evaluator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCase } from '../src/services/agents/skillLifecycle.ts';
import { checkLibrary, readLibrarySkill } from '../src/services/agents/skillLibrarySeed.ts';

const TAXONOMY = new Set(['cap_board_governance', 'finops_metrics_reporting']);
const SKILL = `---
name: board-meeting-brief
description: Prepares a board meeting brief from recorded data.
roles: [ceo, coo]
tools: [project.read, grow.read, mercury.read]
output: brief
taxonomy: {cap_board_governance: proficient, finops_metrics_reporting: working}
version: 1
---
1. Read the authorized records.
2. Mark missing information as Not recorded.
3. Propose the brief; do not send or change anything.
`;

const CASE = {
  skill: 'board-meeting-brief',
  version: 1,
  note: 'Synthetic fixture only; no production data.',
  input: { records: { 'grow.records': { kpis: ['retention'] } } },
  expect: {
    output: 'brief',
    must_include: ['retention'],
    must_say_not_recorded: ['runway'],
    must_not_include: ['guaranteed'],
  },
};

test('canonical v1 source and golden case pass the same parser and importer checks used by production', () => {
  const parsed = readLibrarySkill(SKILL);
  assert.ok(parsed);
  assert.equal(parsed.slug, 'board-meeting-brief');
  const result = checkLibrary(TAXONOMY, [{ slug: 'board-meeting-brief', skill_md: SKILL, cases: [CASE] }]);
  assert.equal(result[0].ok, true, result[0].ok ? '' : result[0].message);
  assert.equal(checkCase({ name: 'Board meeting missing runway', input: CASE.input, expect: CASE.expect }).ok, true);
});

test('the importer reports malformed source, write capabilities, and taxonomy errors', () => {
  assert.equal(readLibrarySkill(SKILL.replace('name: board-meeting-brief', 'name: board-meeting-brief\nname: duplicate')), null);

  const write = checkLibrary(TAXONOMY, [{
    slug: 'board-meeting-brief',
    skill_md: SKILL.replace('mercury.read]', 'mercury.create_transfer]'),
    cases: [CASE],
  }])[0];
  assert.equal(write.ok, false);
  if (!write.ok) assert.equal(write.code, 'tool_not_read_only');

  const tag = checkLibrary(TAXONOMY, [{
    slug: 'board-meeting-brief',
    skill_md: SKILL.replace('cap_board_governance', 'design'),
    cases: [CASE],
  }])[0];
  assert.equal(tag.ok, false);
  if (!tag.ok) assert.equal(tag.code, 'tag_unknown');
});

test('a golden case cannot pass with missing expectations or synthetic PII', () => {
  const empty = checkCase({ name: 'Empty expectations', input: CASE.input, expect: { output: 'brief' } });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.message, /at least one phrase/i);

  const pii = checkCase({
    name: 'Email is rejected',
    input: { records: { 'grow.records': { contact: 'person@example.test' } } },
    expect: CASE.expect,
  });
  assert.equal(pii.ok, false);
  if (!pii.ok) assert.equal(pii.code, 'case_has_email');
});

test('unsupported source metadata and historical refuse_when are ignored, not mistaken for enforced behavior', () => {
  const withMetadata = SKILL.replace('version: 1', 'version: 1\nprovenance: staged-only');
  assert.ok(readLibrarySkill(withMetadata), 'the current importer accepts then ignores unknown source metadata');

  const historic = checkCase({
    name: 'Historical refusal field',
    input: CASE.input,
    expect: { ...CASE.expect, refuse_when: { reason: 'not evaluated by v1' } },
  });
  assert.equal(historic.ok, true);
  if (historic.ok) assert.equal('refuse_when' in historic.expect, false);
});
