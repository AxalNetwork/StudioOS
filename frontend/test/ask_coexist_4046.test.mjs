// #4046 Group B1 (owner, 2026-11-02): a module's own Eadwyn button coexists with
// Ask (#3706 §2c answer). Ask covers form fields; the module button keeps its
// own job, and its label says what it does — never a second "Eadwyn" or "Ask"
// label, so each screen shows one Ask.
//
// Run with:
//   node --test frontend/test/ask_coexist_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Each module button: its file, a snippet that locates it, and the label it now carries.
const BUTTONS = [
  ['frontend/src/pages/raise/narrative/StoryTab.jsx', "'Writing…' : 'Draft ▾'"],
  ['frontend/src/pages/raise/narrative/PositioningTab.jsx', "'Proposing…' : 'Propose positioning'"],
  ['frontend/src/pages/raise/narrative/CheckTab.jsx', "'Phrase it'"],
  ['frontend/src/pages/cycles/buildPlanModel.js', "WORD_LABEL = 'Word the plan'"],
  ['frontend/src/pages/cycles/BuildPlan.jsx', "useRailOption(running ? 'draft:build/plan' : null, WORD_LABEL)"],
  ['frontend/src/lib/railOptions/founder.js', "label: 'Word the plan'"],
  ['frontend/src/pages/raise/captable/IssuanceDialogs.jsx', '>Find the terms in the file<'],
  ['frontend/src/pages/raise/caprel/CapRelPipeline.jsx', 'data-testid="caprel-investor-eadwyn">Propose next steps<'],
  ['frontend/src/pages/raise/caprel/CapRelProposals.jsx', '`Propose next steps for ${prospect.name}`'],
  ['frontend/src/pages/email/EmailPage.jsx', 'data-testid="write-with-eadwyn">Draft an email<'],
  ['frontend/src/pages/email/ComposeSheet.jsx', 'title="Draft an email"'],
  ['frontend/src/pages/investor/dealflow/Compare.jsx', "'Drafting…' : 'Draft the note'"],
];

// The labels these buttons carried before #4046, which named Eadwyn or Ask.
const RETIRED = [
  'Ask Eadwyn ▾', 'Eadwyn is writing…', 'Ask Eadwyn to propose positioning', 'Eadwyn is proposing…',
  'Ask Eadwyn to phrase it', 'Word with Eadwyn', 'Let Eadwyn read its terms', 'Ask Eadwyn about ${',
  'Write with Eadwyn', 'Compose with Eadwyn', "'Draft with Eadwyn'",
];

/** A file's code with comment lines dropped, so prose about the history can stay. */
const code = (f) => readFileSync(f, 'utf8').split('\n')
  .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');

test('each module button says what it does', () => {
  for (const [file, label] of BUTTONS) {
    assert.ok(code(file).includes(label), `${file} should carry ${label}`);
  }
});

test('no module button keeps a label that names Eadwyn or Ask', () => {
  const files = [...new Set(BUTTONS.map(([f]) => f))];
  for (const file of files) {
    const src = code(file);
    for (const old of RETIRED) {
      assert.ok(!src.includes(old), `${file} still says "${old}"; a module button names its job, and the one Ask stays the only Ask`);
    }
  }
});

test('the rail matrix carries the renamed option', () => {
  const matrix = readFileSync('cloudflare-worker/src/services/ai/railMatrix.json', 'utf8');
  assert.ok(matrix.includes('"optionLabel": "Word the plan"'), 'regenerate it: node scripts/build-rail-matrix.mjs');
  assert.ok(!matrix.includes('"optionLabel": "Word with Eadwyn"'));
});
