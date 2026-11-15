import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSectionIncident, normalizeSectionIncident } from '../src/services/sectionIncidentRules.ts';

const trusted = {
  source: 'server_operation', audience: 'founder', section: 'validate',
  outcome: 'confirmed_impact', occurrences: 2,
};

test('fixed rules route all eight audiences for trusted sources', () => {
  for (const [audience, section, source] of [
    ['superadmin', 'revenue', 'subsystem'],
    ['admin', 'approvals', 'verified_profile'],
    ['founder', 'validate', 'server_operation'],
    ['investor', 'axal-vc-fund', 'verified_profile'],
    ['partner', 'delivery', 'server_operation'],
    ['advisor', 'practice', 'verified_profile'],
    ['explorer', 'email', 'server_operation'],
    ['all', 'billing', 'subsystem'],
  ]) {
    const decision = decideSectionIncident({ ...trusted, audience, section, source });
    assert.equal(decision.action, 'episode');
    assert.equal(decision.event.slug, `axalvc-${audience}-${section}`);
    assert.equal(decision.event.unmapped, false);
  }
});

test('unmapped trusted scopes go to internal triage at their original severity', () => {
  const impact = decideSectionIncident({ ...trusted, audience: 'founder', section: 'security' });
  assert.equal(impact.action, 'episode');
  assert.equal(impact.event.slug, 'axalvc-superadmin-platform');
  assert.equal(impact.event.unmapped, true);
  const low = decideSectionIncident({ ...trusted, audience: undefined, outcome: 'failure' });
  assert.equal(low.action, 'count_only');
  assert.equal(low.event.slug, 'axalvc-superadmin-platform');
});

test('a browser-only record cannot dispatch and a conflicting hint cannot choose the destination', () => {
  const hint = { source: 'browser', audience: 'admin', section: 'approvals', outcome: 'confirmed_impact', occurrences: 40 };
  assert.deepEqual(decideSectionIncident(hint, 40), { action: 'drop' });
  assert.deepEqual(decideSectionIncident(null, 40), { action: 'drop' });
  const mixed = { ...trusted, browserHint: hint, payload: { url: 'redacted' } };
  assert.deepEqual(decideSectionIncident(mixed, hint.occurrences), {
    action: 'episode', stage: 'impact',
    event: { source: 'server_operation', slug: 'axalvc-founder-validate', unmapped: false,
      outcome: 'confirmed_impact', occurrences: 2, browserOccurrences: 40 },
  });
});

test('expected outcomes and low-volume failures stay in the digest despite browser volume', () => {
  for (const outcome of ['expected_4xx', 'failure']) {
    const decision = decideSectionIncident({ ...trusted, occurrences: 1, outcome }, Number.MAX_SAFE_INTEGER);
    assert.equal(decision.action, 'count_only');
    assert.equal(decision.event.browserOccurrences, outcome === 'failure' ? 1_000_000 : 0);
  }
  const recovered = decideSectionIncident({ ...trusted, outcome: 'recovery' });
  assert.equal(recovered.action, 'episode');
  assert.equal(recovered.stage, 'recovery');
  assert.deepEqual(decideSectionIncident({ ...trusted, outcome: 'ok' }), { action: 'drop' });
  assert.equal(normalizeSectionIncident({ ...trusted, occurrences: Infinity }), null);
});
