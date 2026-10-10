import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { cycleDef, cycleRouteSource } from './_cycleBands.mjs';

const read = (path) => codeOnly(readFileSync(resolve(process.cwd(), path), 'utf8'));
// The A5 desk is retired (D661, #1474): Grow's landing is the cycle overview,
// whose entry in `CycleRoute.jsx` carries the desk's two AI bands.
const grow = cycleDef(cycleRouteSource(), 'grow');

test('the Grow pages read the founder-side co-marketing route, never a partner-only one', () => {
  // The partner-side co-marketing reads refuse every founder (requirePartnerProfile),
  // so a founder page that calls them shows "sources unavailable" on every load.
  for (const page of ['FounderGrowLaunch', 'FounderGrowPartnerships']) {
    const src = read(`frontend/src/pages/founder/${page}.jsx`);
    assert.doesNotMatch(src, /api\.listMyCoMarketing(Pitches|Attributions)\(/, `${page} calls a partner-only co-marketing read`);
    assert.match(src, /api\.founderCoMarketing\(/, `${page} does not read the founder-side co-marketing route`);
  }
});

test('Grow never turns canvas fixtures into product data or claims', () => {
  // A FIXTURE AND A CONTROL LABEL WERE IN ONE REGEX, AND THEY ARE NOT THE SAME
  // RULE. `Nadia Okonkwo`, `14 of 25` and `Latitude Seed` are the canvas's
  // invented data and must never reach a page — that ban is right and stays
  // whole. `Accept sequence`, `Move to screen` and `Generate 4 more` are the
  // artboard's own BUTTON LABELS, and banning them meant the page could never
  // match the artboard it was being checked against.
  //
  // The rule that replaces the merge: a control label is admitted exactly when
  // the control does what it says. `Accept sequence` is admitted — accepting a
  // drafted outreach sequence is what that button does. The other two are
  // still banned, each for its own reason: `Move to screen` is a write to
  // `job_applications.status` that no route performs, and `Generate 4 more`
  // needs an image model this build does not have.
  assert.doesNotMatch(grow, /14 of 25|38 in play|61 leads|37%|Nadia Okonkwo|Latitude Seed|Thornbury Capital|Verwood Ventures|Mistral|FLUX|GPT-OSS|BGE-M3|DeepSeek|Llama|QwQ|Granite|\$14\.20/i,
    'a canvas fixture has been transcribed onto the page as data');
  assert.doesNotMatch(grow, /Move to screen|Generate 4 more|Edit touch 1|See all 14 ranked/i,
    'a control promises something no route performs');
  assert.match(grow, /accept: 'Accept sequence'/,
    'the artboard’s own accept label is gone from the band that does exactly that');
});