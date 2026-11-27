// #5513 part 2 (D5513-p2): the owner's 2026-11-17 answers. The Demo Day page carries
// no unconsented testimonials, the fund model carries no fixed program track record,
// and the claims record names an owner and a review date for each claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from '../src/lib/spinoutFundModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('#5513: the Demo Day page shows no named testimonials until consent and a source are recorded', () => {
  const page = read('frontend/src/pages/templates/SpinoutDemoDayPage.jsx');
  assert.doesNotMatch(page, /TestimonialBlock|TESTIMONIALS|Past Attendees/);
  for (const name of ['Nadia F.', 'Oliver K.', 'Yasmin T.']) assert.ok(!page.includes(name), name);
});

test('#5513: the fund model exports no fixed program track record', () => {
  assert.equal(model.PROGRAM, undefined);
  const src = read('frontend/src/lib/spinoutFundModel.js');
  assert.doesNotMatch(src, /graduates:\s*37|onTimeIncorpPct|alumniRaisedM/);
});

test('#5513: the claims record is approved, with an owner and review date per claim', () => {
  const record = read('documentation/product/CLAIMS_5513.md');
  assert.doesNotMatch(record, /owner to fill/);
  assert.match(record, /\*\*Status: approved\.\*\*/);
  assert.equal((record.match(/^\| Owner \| The owner \(Axal VC\)/gm) || []).length, 2);
  assert.equal((record.match(/^\| Review date \| The next quarterly review after 2026-11-17 \|$/gm) || []).length, 2);
});
