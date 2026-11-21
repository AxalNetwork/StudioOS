/**
 * THE PROGRAMME BRIEF's live values (D141), after D6966.
 *
 * D6966 (#6966) retired the four printed pages this file rendered: `/spinout-lab/brief` is now
 * the Spin-Out Lab's presentation (PGS01–PGS03), its PDF a committed file, and its availability
 * panel the one reader of `GET /api/spinout-lab/brief`. What the panel draws in each state —
 * filled, closed, unavailable, a blank field and loading, never an unresolved binding and never
 * a 0 — is `program_presentations_6966.test.mjs`. What stays here is the part of D141 that is
 * still the page's: the route names the zone the page formats in, and the SPA's cohort window
 * and the Worker's are one rule.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_brief_d141.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { resolveOpenCohort } from '../src/lib/spinoutLab.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/SpinoutLabBriefPage.jsx'));
const ROUTE = read('cloudflare-worker/src/routes/spinout_lab.ts');

// ── The two cohort-window computations must agree ───────────────────────────

test('the SPA and the worker resolve the SAME application window', async () => {
  // THE DEFECT THIS EXISTS TO CATCH, and it is now reachable rather than
  // theoretical. `resolveOpenCohort` (lib/spinoutLab.js) is what the marketing
  // hero and the Lab intro quote; `resolveApplicationTarget`
  // (services/cohortApplications.ts) is what this brief's route answers with.
  // They are two independent implementations of one rule — seven days before
  // the 1st, 23:59:59 Delaware — living in two languages, and the day they
  // disagree two pages on the same site quote different deadlines for the same
  // cohort. Measured today they agree on every probe; this keeps that true.
  const { resolveApplicationTarget } = await import('../../cloudflare-worker/src/services/cohortApplications.ts');

  const probes = [];
  for (let m = 0; m < 12; m++) {
    // Mid-month, the last instant before a close, the instant after it, and a
    // DST boundary month — the four places a wall-clock rule can slip.
    probes.push(Date.UTC(2026, m, 15, 12));
    probes.push(Date.UTC(2026, m, 23, 23, 0));
    probes.push(Date.UTC(2026, m, 24, 12));
    probes.push(Date.UTC(2027, m, 1, 0, 30));
  }

  const disagreements = [];
  for (const now of probes) {
    const w = resolveApplicationTarget(now);
    const s = resolveOpenCohort(now);
    if (!w.ok) continue; // the worker reports no open window; the SPA has no such state
    if (w.year !== s.year || w.month !== s.month
      || w.window.closeMs !== s.closeMs || w.window.startMs !== s.startMs) {
      disagreements.push({
        now: new Date(now).toISOString(),
        worker: { y: w.year, m: w.month, close: w.window.closeMs, start: w.window.startMs },
        spa: { y: s.year, m: s.month, close: s.closeMs, start: s.startMs },
      });
    }
  }
  assert.deepEqual(disagreements, [],
    'the brief’s deadline and the marketing page’s deadline are computed by two implementations that no longer agree');
});

test('the route sends the zone, and only the six', () => {
  // The page renders every instant in the zone the ROUTE names rather than one
  // it assumes, so the route must keep sending it.
  assert.ok(/zone:\s*COHORT_TZ/.test(ROUTE),
    'the brief route stopped naming the zone its deadlines are enforced in');
  assert.ok(PAGE.includes('const zone = d.zone || null;'),
    'the page stopped reading the zone from the payload and is assuming one');
});
