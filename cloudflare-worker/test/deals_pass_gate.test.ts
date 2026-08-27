/**
 * Deal Flow — one door into the terminal stage (task #127).
 *
 * A pass taxonomy is only worth the column it occupies if a pass CANNOT be
 * recorded without a reason. Requiring one on POST /:id/pass achieves nothing
 * while a plain `PUT {status:'rejected'}` reaches the same state silently: the
 * reason becomes optional in practice and the aggregate fills with blanks that
 * look like data.
 *
 * These read the route source, because the failures being guarded — a second
 * write path reappearing, or a stage event recorded AFTER the update that
 * erases the timestamp it measures — both leave a perfectly working happy path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Comments stripped: three assertions in this repo have tripped on prose. */
function stripComments(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const c = input[i], d = input[i + 1];
    if (c === '/' && d === '/') { while (i < input.length && input[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c;
      for (i++; i < input.length; ) {
        if (input[i] === '\\') { out += input.slice(i, i + 2); i += 2; continue; }
        out += input[i];
        const end = input[i] === q; i++;
        if (end) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const src = stripComments(
  readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/deals.ts'), 'utf8'),
);

function handler(sig: string): string {
  const start = src.indexOf(sig);
  assert.notEqual(start, -1, `route ${sig} must exist`);
  const rest = src.slice(start + sig.length);
  const next = rest.search(/\ndeals\.(get|post|put|patch|delete)\(/);
  return rest.slice(0, next === -1 ? rest.length : next);
}

// ---------- one door ----------

test('only the pass route writes the terminal stage', () => {
  // Every UPDATE that sets status must either take it from PIPELINE (advance),
  // from a validated body that has already refused PASSED_STATUS (put), or be
  // the pass route itself.
  const pass = handler("deals.post('/:id/pass'");
  assert.match(pass, /pass_reason\s*=/, 'the pass route must record the reason');
  assert.match(pass, /passed_at\s*=/);
  assert.match(pass, /passed_by_user_id\s*=/);

  // No other handler may name the terminal stage in an UPDATE.
  for (const sig of ["deals.put('/:id'", "deals.post('/:id/advance'", "deals.post('/draft'", "deals.post('/'"]) {
    const body = handler(sig);
    const updates = body.match(/UPDATE deals\s+SET[\s\S]{0,600}?`/g) || [];
    for (const u of updates) {
      assert.doesNotMatch(u, /'rejected'/,
        `${sig} must not write the terminal stage — that is the pass route's job`);
    }
  }
});

test('PUT refuses a pass and says where to go instead', () => {
  const put = handler("deals.put('/:id'");
  assert.match(put, /PASSED_STATUS/, 'PUT must test for the terminal stage');
  assert.match(put, /deals\/:id\/pass/, 'and point the caller at the route that asks for a reason');
  // An unknown status must be a 400 from us, not a CHECK-constraint failure
  // from D1 surfaced to the client as something opaque.
  assert.match(put, /DEAL_STATUSES\.includes/);
});

test('a deal cannot be drafted straight into the terminal stage', () => {
  const draft = handler("deals.post('/draft'");
  assert.match(draft, /PASSED_STATUS/, 'draft must refuse being born passed');
  // The old line allowed it explicitly; make sure it is gone.
  assert.doesNotMatch(draft, /\[\.\.\.PIPELINE,\s*'rejected'\]/,
    "draft must not re-admit 'rejected' to its accepted statuses");
});

test('the reason is validated before anything is read or written', () => {
  const pass = handler("deals.post('/:id/pass'");
  const check = pass.indexOf('isPassReason');
  const db = pass.indexOf('getSQL');
  assert.notEqual(check, -1, 'the pass route must validate the reason');
  assert.ok(check < db,
    'validation must precede the DB — a pass must not be half-applied while the operator is still deciding why');
});

// ---------- ordering ----------

for (const sig of ["deals.post('/:id/advance'", "deals.post('/:id/pass'", "deals.put('/:id'"]) {
  test(`${sig} records the stage event BEFORE overwriting stage_changed_at`, () => {
    // This is the ordering bug that leaves a working happy path: the UPDATE
    // sets stage_changed_at = now, so an event recorded afterwards measures
    // every stage as zero days long and the funnel reports instant diligence.
    const body = handler(sig);
    const rec = body.indexOf('recordStageEvent');
    const upd = body.search(/UPDATE deals\s+SET[\s\S]{0,400}?stage_changed_at = datetime/);
    assert.notEqual(rec, -1, `${sig} must record the transition`);
    assert.notEqual(upd, -1, `${sig} must update stage_changed_at`);
    assert.ok(rec < upd, `${sig} records history after it destroys the timestamp it measures`);
  });
}

test('creating a deal records its first stage entry', () => {
  // Without it the funnel can measure conversion OUT of the first stage but
  // never has a cohort that entered it, so the first column reads 0 forever.
  for (const sig of ["deals.post('/'", "deals.post('/draft'"]) {
    assert.match(handler(sig), /recordStageEvent/, `${sig} must record the arrival`);
  }
});

// ---------- the analytics surface ----------

test('the analytics routes are registered above the id route', () => {
  // Hono matches in order: registered after `/:id`, `/pass-analytics` would be
  // read as a deal id and answer 404 forever.
  const idAt = src.indexOf("deals.get('/:id'");
  for (const literal of ["deals.get('/pass-analytics'", "deals.get('/stage-analytics'"]) {
    const at = src.indexOf(literal);
    assert.notEqual(at, -1, `${literal} must exist`);
    assert.ok(at < idAt, `${literal} must be registered before the id route`);
  }
});

test('an unfiltered pass query does not dump every passed deal', () => {
  // The breakdown is aggregate; the deal list is only returned for a reason
  // the caller named. Defaulting to "all" is a larger disclosure than asked for.
  const body = handler("deals.get('/pass-analytics'");
  assert.match(body, /let matches: any\[\] = \[\];/,
    'the deal list must start empty and be filled only on an explicit reason');
  assert.match(body, /LIMIT 100/, 'and stay bounded');
});

test('stage analytics never answer without saying when recording began', () => {
  const body = handler("deals.get('/stage-analytics'");
  assert.match(body, /recording_started_at/);
  assert.match(body, /unavailable/, 'and refuse outright when there is no history at all');
});
