/**
 * `/raise` — the A4 artboard, element by element.
 *
 * "The highest-stakes page in the product" is the artboard's own description of
 * itself, and the gap between it and the desk was the largest of the four —
 * because THE STATUS CARD WAS ALREADY BACKED AND THE DESK READ NONE OF IT.
 * `GET /api/contacts/raise-round` has returned `progress` since the Round
 * Manager landed: `{wired, signed, soft, committed, pipeline, committed_pct,
 * remaining, oversubscribed}` off `services/roundMath.ts`. That is exactly the
 * artboard's two-segment bar and its "$435k signed / $185k soft-circled"
 * legend. The desk read `raised` alone and drew one flat bar.
 *
 * WHAT ELSE THE ARTBOARD ASKED FOR THAT WAS NOT THERE:
 *
 *   the eyebrow          "Seed · open since Aug 3" — the round's name and how
 *                        long it has been open, both stored, neither shown
 *   three stats          days open, investors in play, projected close
 *   the zone subtitles   "Round planner", "Term sheet · <counterparty>",
 *                        "N artifacts · M investors with access",
 *                        "Nothing live — modelled, not marketed"
 *   viewer counts        the room's access log names who opened which file
 *   four proposal bands  the plain-language read, the clause explanation, the
 *                        gap analysis, and the read of the payment order
 *
 * AND WHAT IT ASKS FOR THAT THIS PRODUCT CANNOT DO, drawn as an absence with
 * its reason rather than filled in (D56/D68):
 *
 *   "2 blockers"         nothing records a blocker against a round
 *   the Screened shield  there is no content review anywhere in this build.
 *                        `sanctions_screenings` is KYC, not content, and
 *                        "Anything investor-facing passes Llama Guard first"
 *                        is a claim about a pipeline that does not exist
 *   the generated cover  no image generation ships
 *   the waterfall        no liquidation preference, participation right or
 *                        exit model is stored for a company anywhere
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Founder Workspaces Canvas.dc.html');
const page = read('frontend/src/pages/founder/FounderRaiseDesk.jsx');
const css = raw('frontend/src/pages/founder/founderRaiseDesk.css');
const worker = raw('cloudflare-worker/src/routes/research.ts');
const roundMath = raw('cloudflare-worker/src/services/roundMath.ts');
const contacts = raw('cloudflare-worker/src/routes/contacts.ts');

/** The A4 artboard, bounded by the two markers either side of it. */
const A4 = CANVAS.slice(
  CANVAS.indexOf('ARTBOARD 4 — RAISE'),
  CANVAS.indexOf('ARTBOARD 5'),
);
assert.ok(A4.includes('Get capital, stay legal'), 'the A4 artboard could not be found in the canvas');
const ANCH_R = CANVAS.match(/anchR: this\.anchorsFor\('R', \[([\s\S]*?)\]\),/)?.[1] || '';
assert.ok(ANCH_R.includes('r-status'), 'A4’s anchor row could not be found in the canvas');
const A4DATA = CANVAS.slice(CANVAS.indexOf('// ---- Raise ----'), CANVAS.indexOf('// ---- Grow ----'));
assert.ok(A4DATA.includes('raiseStats: ['), 'A4’s data block could not be found in the canvas');

const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&')
  .replace(/^\s*(?:--|\/\/|\*)/gm, '')
  .replace(/\s+/g, ' ');

test('the headline and its one-line answer to “why this page” are the artboard’s', () => {
  assert.ok(page.includes('Get capital, stay legal'));
  const line = 'The highest-stakes page in the product. Its model menu leads with quality, because a wrong answer here costs more than tokens.';
  assert.ok(flat(A4).includes(line), 'the artboard’s subtitle changed');
  assert.ok(flat(page).includes(line), 'the desk no longer carries the artboard’s subtitle');
});

test('the chip row is the artboard’s anchors, in its order', () => {
  const labels = [...ANCH_R.matchAll(/\['([^']+)','[^']+'\]/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Status', 'Pitch', 'Capital', 'Legal', 'Data room', 'Liquidity']);
  const sections = page.match(/const SECTIONS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.deepEqual([...sections.matchAll(/\['([^']+)', '[^']+'\]/g)].map((m) => m[1]), labels);
});

test('the cards are the artboard’s cards, in its order', () => {
  const titles = [...A4.matchAll(/class="zt">([^<]+)</g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.deepEqual(titles, ['Capital · dilution', 'Legal engine', 'Data room', 'Pitch', 'Liquidity & exits']);
  const drawn = [...page.matchAll(/<Head\b[^>]*?title="([^"]+)"/g)].map((m) => m[1]);
  // Round status is the artboard's first card and has no `zt` — its heading is
  // the `r-status` label. Everything after it is the `zt` list, in its order.
  assert.equal(drawn[0], 'Round status');
  assert.deepEqual(drawn.slice(1), titles, 'the overview is no longer the artboard’s cards in its order');
});

test('the status card reads the funnel the endpoint has always returned', () => {
  // The property, not the presence: `progress` splits committed from
  // soft-circled, and the desk must draw both segments from it. Reading
  // `raised` alone is what produced one flat bar under an artboard with two.
  assert.match(roundMath, /committed = wired \+ signed/, 'the funnel split moved out of roundMath');
  assert.match(contacts, /progress: computeRoundProgress\(allocations, round\?\.target_amount \?\? null\)/,
    'the round endpoint no longer returns the funnel');
  assert.match(page, /progress: records\.round\?\.progress \|\| null,/,
    'the desk no longer reads the funnel off the round response');
  assert.match(page, /<i className="is-committed" style=\{\{ width: `\$\{committed\}%` \}\} \/><i className="is-soft" style=\{\{ width: `\$\{soft\}%` \}\} \/>/,
    'the progress bar is not the artboard’s two segments');
  // BOTH FIGURES, NEVER THE RATIO ALONE — a percentage hides which half of the
  // bar is a signature and which is a conversation.
  assert.match(page, /\{money\(progress\.committed\)\} signed or wired/);
  assert.match(page, /\{money\(progress\.soft\)\} soft-circled/);
  assert.match(css, /(^|\})\.raise-progress i\.is-soft\{/m, 'the soft-circled segment has no style of its own');
  // No target is not a zero-width bar: it is no bar, with the reason.
  assert.match(page, /if \(!progress \|\| !\(Number\(target\) > 0\)\) \{/);
  assert.match(page, /data-testid="text-raise-no-bar"/);
});

test('the status card’s eyebrow and three stats are the artboard’s', () => {
  const stats = [...A4DATA.matchAll(/\{ label:'([^']+)', value:'[^']*' \}/g)].map((m) => m[1]);
  assert.deepEqual(stats, ['Days open', 'Investors in play', 'Projected close']);
  for (const label of stats) {
    assert.ok(new RegExp(`label="${label}"`).test(page), `the ${label} stat is missing`);
  }
  // "open since Aug 3" is the round's own created_at, which nothing read.
  assert.match(page, /function roundLabel\(round\) \{/);
  assert.match(page, /open since \$\{date\(round\.created_at\)\}/);
  assert.match(page, /const daysSince = \(value\) =>/);
  // In play is a stage set, not a headcount: a passed prospect is not in play
  // and neither is one already committed.
  const inPlay = page.match(/const RAISE_STAGES_IN_PLAY = \[([^\]]*)\];/)?.[1] || '';
  assert.deepEqual([...inPlay.matchAll(/'(\w+)'/g)].map((m) => m[1]), ['contacted', 'meeting', 'diligence']);
});

test('what the artboard asks for and nothing records is named, not drawn', () => {
  // Each of these four is a claim the page would otherwise make on no record.
  assert.match(page, /No blocker is recorded against a round, so none is counted\./);
  assert.match(page, /no content review runs anywhere in this build, so no artifact carries a screened mark/);
  assert.match(page, /Cover imagery is not generated here/);
  assert.match(page, /no liquidation preference, participation right or exit model is recorded for this company, so there is no waterfall to draw/);
  // AND THE MARKS THEMSELVES ARE ABSENT, not merely disclaimed.
  assert.doesNotMatch(page, /Screened before share|>Screened<|shield/i,
    'a screened mark is drawn over a review that does not run');
  assert.doesNotMatch(page, /flux-|Generated cover/i);
});

test('the four proposal bands are mounted, off by default, and allow-listed', () => {
  const bands = [...A4.matchAll(/class="propb">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(bands, ['Proposal · plain-language read', 'Clause explained', 'Gap analysis', 'Proposal · plain-language read']);
  // The mounts are read the way `research_ask_session`'s census reads them —
  // off a literal `surface=` on a `<ZoneDraft>` element. A props-object helper
  // would hide all four from that census, which is what catches a band
  // shipping with no allow-list entry and 400ing in silence.
  const mounted = [...page.matchAll(/<ZoneDraft\n\s*surface="([^"]+)"[\s\S]{0,400}?label="([^"]+)"/g)];
  assert.deepEqual(mounted.map((m) => m[1]), ['raise/capital', 'raise/legal', 'raise/data-room', 'raise/liquidity']);
  assert.deepEqual(mounted.map((m) => m[2]), bands, 'the desk no longer carries A4’s four bands, in its order');
  for (const surface of mounted.map((m) => m[1])) {
    assert.ok(worker.includes(`'${surface}': {`), `${surface} is mounted with no DRAFT_SURFACES entry`);
  }
  assert.match(page, /const \[fillsOn\] = useAssistMode\('Raise'\);/);
  assert.match(page, /const bandOn = fillsOn && Boolean\(projectId\);/,
    'a band renders without the assist mode being on, or without a project to scope it to');
  assert.equal((page.match(/\{bandOn \? <ZoneDraft/g) || []).length, 4,
    'a Raise band is mounted outside the assist-mode gate');
  assert.equal((page.match(/accent="violet"/g) || []).length, 4,
    'a founder band is drawing in the Partner palette');
  // The artboard draws the clause read in a red box and every other band in
  // plain body text.
  assert.match(page, /surface="raise\/legal"\n\s*scopeKey=\{scope\}\n\s*accent="violet"\n\s*tone="warn"/);
  assert.equal((page.match(/tone="warn"/g) || []).length, 1, 'the warn tone spread beyond the clause read');
  // "Not legal advice" is the artboard's own footnote and is not optional.
  assert.match(page, /foot="Not legal advice\. Counsel is on the Team page\."/);
});

test('every Raise draft surface scopes to a project the caller owns', () => {
  const table = worker.slice(worker.indexOf('const DRAFT_SURFACES'));
  for (const surface of ['raise/capital', 'raise/legal', 'raise/data-room', 'raise/liquidity']) {
    const body = table.slice(table.indexOf(`'${surface}': {`));
    const gather = body.slice(body.indexOf('gather:'), body.indexOf('\n  },'));
    assert.match(gather, /const pid = await founderProject\(c, userId, scope\);/,
      `${surface} does not resolve its project through the ownership check`);
    assert.match(gather, /if \(pid == null\) return \[\];/,
      `${surface} continues after the ownership check fails`);
  }
  // The liquidity surface hands the model a company with no preference terms.
  // Saying so IS the material: without it a model asked about exits supplies a
  // standard preference stack and describes it as this founder's.
  const liquidity = table.slice(table.indexOf("'raise/liquidity': {"));
  assert.match(liquidity, /NO LIQUIDATION PREFERENCE, PARTICIPATION RIGHT OR EXIT MODEL IS RECORDED/);
  assert.match(liquidity, /No preference multiple, participation right or liquidation term is recorded anywhere here\./);
});

test('A4 never turns canvas fixtures into product data or claims', () => {
  assert.doesNotMatch(page, /Kestrel|DeepSeek|Llama|FLUX|QwQ|Granite|Mistral|\$620,000|\$1\.5M|\$435k|\$185k|Oct 14|22 days|9 investors|full ratchet|anti-dilution|2× participating|2x participating|Slack|Cohort retention|83\(b\)|\$14\.20/i);
  // The dilution figures are the fixture's arithmetic on the fixture's cap
  // table, and none of them belongs on a page.
  assert.doesNotMatch(page, /89\.5%|66\.1%|7\.4 points|16\.0/);
});
