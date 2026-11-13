// D4162 (#4162, H4 of #4137): the team banner while HQ has paused all AI agents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pausedLine } from '../src/pages/team/platformStatusModel.js';

test('the banner reads only when paused, names the admin, and never says advice or shows a reason', () => {
  assert.equal(pausedLine(null), null);
  assert.equal(pausedLine({ paused: false, since: null, by_name: null }), null);
  const line = pausedLine({ paused: true, since: '2026-11-02 21:30:00', by_name: 'Ada Admin' });
  assert.equal(line, 'Axal has paused all AI agents on the platform since 2026-11-02 21:30 UTC by Ada Admin. Agents start no new work; proposals already made can still be decided.');
  assert.doesNotMatch(line, /advi[cs]e|advisor/i);
  assert.match(pausedLine({ paused: true, since: null, by_name: null }), /^Axal has paused all AI agents on the platform\. /);
});

test('the Team shell draws the banner, and the banner reads the platform status', () => {
  const page = readFileSync(new URL('../src/pages/team/TeamAgentsPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /import PlatformPausedBanner from '\.\/PlatformPausedBanner\.jsx';/);
  assert.match(page, /data-testid="team-page"[^\n]*>\n(?:.*\n)?\s*<PlatformPausedBanner \/>/, 'the first thing on the page');
  const banner = readFileSync(new URL('../src/pages/team/PlatformPausedBanner.jsx', import.meta.url), 'utf8');
  assert.match(banner, /platformStatusApi\.read\(\)/);
  assert.match(banner, /role="status"/);
});
