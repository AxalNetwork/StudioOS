/**
 * Advisor Expertise canvas integration — profile completeness meter, service
 * stats, and proof attestation counts match Pages___Advisor_Expertise.dc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const profile = readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise/ProfileZone.jsx'), 'utf8');
const services = readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise/ServicesZone.jsx'), 'utf8');
const proof = readFileSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise/ProofZone.jsx'), 'utf8');

test('Profile zone computes completeness from fields', () => {
  assert.match(profile, /profileCompleteness/);
  assert.match(profile, /Profile completeness/);
  assert.match(profile, /Missing · /);
});

test('Services zone shows canvas stats strip', () => {
  assert.match(services, /priced\.length/);
  assert.match(services, /unpriced\.length/);
  assert.match(services, /bookedCents/);
  assert.match(services, /unitsSold/);
});

test('Proof zone shows attested vs self-stated counts', () => {
  assert.match(proof, /attested\.length/);
  assert.match(proof, /selfStated\.length/);
  assert.match(proof, /awaiting\.length/);
});

test('no canvas sidebar is imported', () => {
  for (const src of [profile, services, proof]) {
    assert.doesNotMatch(src, /className="[^"]*\bside\b/);
  }
});
