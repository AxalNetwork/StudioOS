/**
 * D511 item 3 (#992, the owner's C): graduation closes the Spin-Out Lab tools.
 *
 * The tool routes already refuse a graduate (graduation clears
 * `spinout_lab_active`, and every Lab tool page but three is guarded on it),
 * yet the workspace's `featureUnlocked` told a graduate they had every tool
 * (D381, "Filed, not fixed"). Now a graduate sees the tools closed, says why,
 * and keeps only the certificate; an active member and an admin preview are
 * unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Workspace, { TOOL_INFO, GRADUATE_TOOLS_CLOSED } from '../src/pages/SpinoutLabWorkspace.jsx';

const html = (state, extra = {}) =>
  renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Workspace, { state, ...extra })));

/** The markup of one tool card on the timeline, from its testid to the next card's. */
function card(markup, key) {
  const at = markup.indexOf(`data-testid="workspace-tool-${key}"`);
  assert.ok(at >= 0, `no card for ${key}`);
  const next = markup.indexOf('data-testid="workspace-tool-', at + 1);
  return markup.slice(at, next < 0 ? undefined : next);
}

const GRADUATE = { is_incorporated: true, week: 4, milestones: [{ key: 'incorporation_completed' }], unlocked_features: Object.keys(TOOL_INFO) };
const ACTIVE = { is_incorporated: false, week: 4, milestones: [], unlocked_features: Object.keys(TOOL_INFO) };

test('a graduate is told the Lab tools closed, and every tool but the certificate is closed', () => {
  const m = html(GRADUATE);
  assert.ok(m.includes('data-testid="workspace-graduate-tools-closed"'));
  assert.ok(m.includes(GRADUATE_TOOLS_CLOSED));
  const kept = Object.keys(TOOL_INFO).filter((k) => TOOL_INFO[k].keptAfterGraduation);
  assert.deepEqual(kept, ['certificate'], 'only the certificate survives graduation');
  const startup = card(m, 'projects');
  assert.ok(startup.includes('Closed at graduation'), 'the startup record tool still reads as open to a graduate');
  assert.ok(!startup.includes('>Active<'));
  const cert = card(m, 'certificate');
  assert.ok(cert.includes('>Active<'), 'a graduate lost their own certificate');
});

test('an active member and an admin preview keep their tools; neither is told they closed', () => {
  const active = html(ACTIVE);
  assert.ok(!active.includes('workspace-graduate-tools-closed'));
  assert.ok(!active.includes('Closed at graduation'));
  assert.ok(card(active, 'projects').includes('>Active<'));
  const preview = html(GRADUATE, { previewAllUnlocked: true });
  assert.ok(!preview.includes('Closed at graduation'), 'the admin preview lost the tools');
});
