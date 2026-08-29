/**
 * Help Center "Still stuck?" — the one live element the canvas asks for
 * (Wave 3).
 *
 * The canvas's contact block carries a status line. `GET /api/public/status`
 * has been live and rendered by /status; the docs footer was a static sentence.
 * Someone reading the docs *because* a feature is misbehaving should not have
 * to go hunting to learn the platform is degraded.
 *
 * The roll-up rule is shared rather than copied. Two inline `every()` chains
 * would eventually disagree in front of a user during the exact incident they
 * are reading about — and the obvious inline version has a bug this file pins:
 * `[].every()` is `true`, so an empty probe list reports a confident
 * "Operational" on no evidence at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { overallStatus } from '../src/lib/statusOverall.js';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('an empty or missing probe list is unknown, never operational', () => {
  assert.equal(overallStatus([]), 'unknown');
  assert.equal(overallStatus(undefined), 'unknown');
  assert.equal(overallStatus(null), 'unknown');
  assert.equal(overallStatus('nonsense'), 'unknown');
});

test('the roll-up ranks down over degraded over operational', () => {
  const op = { status: 'operational' };
  assert.equal(overallStatus([op, op]), 'operational');
  assert.equal(overallStatus([op, { status: 'degraded' }]), 'degraded');
  assert.equal(overallStatus([op, { status: 'down' }]), 'down');
  // A single outage outranks any number of degradations.
  assert.equal(overallStatus([{ status: 'degraded' }, { status: 'down' }]), 'down');
  // An unrecognised status is not silently treated as healthy.
  assert.equal(overallStatus([op, { status: 'wat' }]), 'degraded');
  assert.equal(overallStatus([op, null]), 'degraded');
});

test('both surfaces read the shared rule, not their own copy', () => {
  for (const f of ['frontend/src/pages/StatusPage.jsx', 'frontend/src/pages/docs/DocsLayout.jsx']) {
    const s = read(f);
    assert.match(s, /overallStatus\(/, `${f} must use the shared roll-up`);
    assert.ok(!/services\.every\(/.test(s), `${f} still has its own copy of the rule`);
  }
});

test('the docs block renders no status line until the probe answers', () => {
  const s = read('frontend/src/pages/docs/DocsLayout.jsx');
  const i = s.indexOf('function StillStuck');
  const body = s.slice(i, s.indexOf('export default function DocsLayout'));
  assert.match(body, /useState\(null\)/, 'the initial state must be absent, not a guess');
  assert.match(body, /\{line && \(/, 'the line renders only for a known state');
  // 'unknown' has no entry in the label map, so a failed or empty probe shows
  // nothing rather than a colour.
  const map = s.slice(s.indexOf('const STATUS_LINE'), i);
  assert.ok(!map.includes('unknown:'), 'unknown must have no label to render');
  for (const k of ['operational', 'degraded', 'down']) {
    assert.ok(map.includes(`${k}:`), `${k} must have a label`);
  }
});

test('the status page can now reach its own unknown pill', () => {
  // STATUS_PILL.unknown was defined and unreachable, because the inline rule
  // could only ever return the other three.
  const s = read('frontend/src/pages/StatusPage.jsx');
  assert.match(s, /unknown:\s*\{ label: 'Unknown'/);
  assert.match(s, /const overall = overallStatus\(services\)/);
});

test('the contact routes the block offers still exist', () => {
  const s = read('frontend/src/pages/docs/DocsLayout.jsx');
  assert.match(s, /mailto:support@axal\.vc/);
  assert.match(s, /<Link to="\/status"/);
  // The route must actually be mounted, or the link is a dead end.
  assert.match(read('frontend/src/App.jsx'), /path="\/status"/);
});
