/**
 * D5084 (#5084) — the Ask panel draws Revenue's six tasks as "Suggested for this page" chips. None runs in the
 * panel (each puts its question in the composer), and none is a model-running rail option of the Revenue boards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { panelChips } from '../src/ui/askPanelModel.js';
import { SUPER_ADMIN_ASK_CHIPS, SUPER_ADMIN_RAIL_OPTIONS } from '../src/lib/railOptions/superAdmin.js';

const matrix = JSON.parse(readFileSync(new URL('../../cloudflare-worker/src/services/ai/railMatrix.json', import.meta.url), 'utf8'));
const served = (page) => matrix.options.filter((o) => o.pageKey === page).map((o) => ({ key: o.optionKey, label: o.optionLabel }));

test('D5084: the panel shows the six Revenue tasks, none run in the panel', () => {
  const chips = panelChips(served('Super Admin · Revenue'));
  assert.deepEqual(chips.map((c) => c.label), [
    'Summarise the selected period', 'Explain incomplete sources', 'Show overdue receivables',
    'Review open disputes', 'Compare subsidiary reporting', 'Explain the AI margin',
  ]);
  assert.ok(chips.every((c) => c.run === false), 'a Revenue chip asks; it runs nothing in the panel');
});

test('D5084: the chips are their own list, never rail options, and say nothing the voice rule bans', () => {
  assert.deepEqual(SUPER_ADMIN_RAIL_OPTIONS.filter((o) => o.page.startsWith('Super Admin · Revenue')), []);
  for (const c of SUPER_ADMIN_ASK_CHIPS) {
    assert.ok(c.page.startsWith('Super Admin · Revenue'), c.key);
    assert.deepEqual([c.handler, c.noModel], ['none', true], c.key);
    assert.doesNotMatch(c.label, /\b(advice|advise|advisor|recommend\w*|fiduciar\w*|model|pricing|token)\b/i, c.label);
  }
});
