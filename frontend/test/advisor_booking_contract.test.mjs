/**
 * The frontend reads the slot and booking shapes the worker actually emits.
 *
 * WHY THIS FILE EXISTS. Native booking did not work — for anyone, on any
 * surface, since it shipped. `AdvisorsPage` filtered slots on
 * `s.status === 'open' && s.remaining > 0` and `slotDto` emits neither key, so
 * every advisor's availability rendered empty and the only path to a booking
 * was a Calendly link. `/office-hours` had four more of the same, including
 * Confirm/Decline gated on `'requested'` — a status the worker has never
 * written, so an advisor could not accept a booking there at all.
 *
 * None of that was catchable by any existing check: every key is a valid
 * JavaScript property access on an object that simply lacks it, so the build
 * passes, the types pass, and the page renders "Invalid Date" in production.
 * The only durable defence is to derive the allowed key set FROM THE WORKER
 * and fail on a read outside it — which is what this does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const worker = read('cloudflare-worker/src/routes/advisors.ts');

/** The keys a DTO builder actually returns, read out of the worker itself. */
function dtoKeys(fnName) {
  const start = worker.indexOf(`function ${fnName}(`);
  assert.ok(start > -1, `${fnName} must exist in routes/advisors.ts`);
  const body = worker.slice(start, worker.indexOf('\n}', start));
  // Keys are not one per line — `starts_at: s.starts_at, ends_at: s.ends_at`
  // shares one — and some are shorthand (`taken,`). Match a name that follows
  // a separator and is followed by `:` or `,`, so `s.starts_at` on the value
  // side is never mistaken for a key.
  return new Set([...body.matchAll(/(?:^|[\s,{])([a-z_]+)\s*[:,]/gm)].map((m) => m[1]));
}

test('slotDto still emits the keys the frontend reads, and not the ones it used to', () => {
  const keys = dtoKeys('slotDto');
  for (const k of ['starts_at', 'ends_at', 'capacity', 'taken', 'available', 'is_cancelled']) {
    assert.ok(keys.has(k), `slotDto must emit ${k} — the shared adapter reads it`);
  }
  // The five that were read and never emitted. If one is ever ADDED, this
  // test should be revisited deliberately rather than the adapters quietly
  // rotting around it.
  for (const k of ['start_at', 'duration_min', 'location_kind', 'status', 'remaining']) {
    assert.ok(!keys.has(k), `slotDto now emits ${k} — the adapter in advisory/kit.jsx should be simplified`);
  }
});

test('a booking is born pending, and nothing in the worker writes "requested"', () => {
  // This is the whole of the Confirm/Decline bug, in two assertions.
  assert.match(worker, /VALUES \(\?, \?, \?, \?, \?, \?, 'pending', \?, \?\)/,
    'the only INSERT into advisor_bookings writes pending');
  assert.match(worker, /allowed: \['pending'\], nextStatus: 'confirmed'/,
    'and confirm accepts pending');
  const requestedAsStatus = [...worker.matchAll(/'requested'/g)];
  assert.equal(requestedAsStatus.length, 0,
    'no booking is ever `requested`; a UI gating on it renders nothing');
});

/**
 * Every `.jsx` under the advisor surfaces plus the founder-facing directory.
 * Scanned as code only — a prose apostrophe inside a comment has shredded this
 * kind of parse twice in this repository.
 */
function surfaces() {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(resolve(process.cwd(), rel))) {
      const p = `${rel}/${name}`;
      if (statSync(resolve(process.cwd(), p)).isDirectory()) walk(p);
      else if (name.endsWith('.jsx')) out.push(p);
    }
  };
  walk('frontend/src/pages/advisor');
  out.push('frontend/src/pages/AdvisorsPage.jsx');
  return out;
}

test('a legacy key is never read without the key the worker actually emits', () => {
  // THE RULE, stated precisely because a blanket ban would be wrong. Several
  // of these names are real on OTHER sources — `/api/calendar` events carry a
  // genuine `start_at`, and the FastAPI dev backend speaks the old dialect
  // throughout. Reading one is only a defect when the CORRECT spelling is
  // absent from the same expression, because then there is no path to a value.
  //
  // Two have no correct counterpart at all and are therefore always wrong:
  // `duration_min` must be derived from the window, and `remaining` from
  // capacity minus taken.
  const KIT = 'frontend/src/pages/advisor/advisory/kit.jsx';
  const PAIRED = [
    [/\.\s*start_at\b/, /starts_at/, 'start_at without starts_at — slotDto emits starts_at'],
    [/\.\s*location_kind\b/, /meeting_url/, 'location_kind without meeting_url'],
    [/\.\s*scheduled_start\b/, /slot_starts_at/, 'scheduled_start without slot_starts_at'],
    [/'requested'/, /'pending'|AWAITING_DECISION/, "'requested' without 'pending' — the worker only writes pending"],
  ];
  const ALWAYS = [
    [/\.\s*duration_min\b/, 'duration_min — no DTO returns it; derive it with slotMinutes()'],
    [/\.\s*remaining\b/, 'remaining — slotDto emits available'],
  ];
  // A STATED BLIND SPOT, rather than an over-broad rule. `/api/calendar`
  // events carry a genuine `start_at` and are a different contract entirely,
  // so only lines that are reading a SLOT or a BOOKING are checked. That means
  // a slot read through a variable named neither is not covered; say so rather
  // than imply the scan is total.
  const aboutSlotOrBooking = (line) => /\b(slot|slots|booking|bookings|b|s)\s*\.|slot_|booking_/.test(line);
  for (const f of surfaces()) {
    // The adapters are the one place allowed to know both dialects, because
    // reconciling them is their entire job.
    if (f === KIT) continue;
    // Line numbers are into the COMMENT-STRIPPED text, not the file — say so
    // in the message so nobody hunts the wrong line.
    for (const [i, line] of codeOnly(read(f)).split('\n').entries()) {
      if (!aboutSlotOrBooking(line)) continue;
      const at = `${f} (stripped line ${i + 1})`;
      for (const [bad, why] of ALWAYS) {
        assert.ok(!bad.test(line), `${at} reads ${why}`);
      }
      for (const [bad, ok, why] of PAIRED) {
        if (bad.test(line)) assert.ok(ok.test(line), `${at} reads ${why}`);
      }
    }
  }
});

test('the two callers that were broken now go through the shared adapter', () => {
  for (const f of [
    'frontend/src/pages/AdvisorsPage.jsx',
    'frontend/src/pages/advisor/advisory/OpportunitiesPage.jsx',
  ]) {
    assert.match(codeOnly(read(f)), /from '\.\/kit'|from '\.\/advisor\/advisory\/kit'/,
      `${f} must read the shared slot/booking adapters`);
  }
  // And nothing re-privatises them: the private copies in OpportunitiesPage
  // are exactly why every other caller stayed broken.
  const opps = codeOnly(read('frontend/src/pages/advisor/advisory/OpportunitiesPage.jsx'));
  assert.doesNotMatch(opps, /const slotStart = /, 'the private adapters must not come back');
});

test('a failed availability read is not rendered as an empty schedule', () => {
  const page = codeOnly(read('frontend/src/pages/AdvisorsPage.jsx'));
  // `.catch(() => setSlots([]))` rendered "No open slots — check back later",
  // a positive claim about an advisor's calendar that the page never read.
  assert.doesNotMatch(page, /catch\(\(\) => setSlots\(\[\]\)\)/);
  assert.doesNotMatch(page, /catch\(\(\) => setBookings\(\[\]\)\)/);
  assert.match(page, /setSlotsError/, 'a failed read must have somewhere to go');
});
