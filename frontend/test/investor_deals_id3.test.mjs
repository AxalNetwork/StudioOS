/**
 * Deals · Commit — canvas **ID3**, `/deals/commit`.
 *
 * WHAT THIS FILE GUARDS. The zone shipped as three fields off the deal row —
 * status, total committed, target — under a heading that said "Commit room".
 * The artboard draws a four-up strip, a three-column vote ledger with a
 * rationale per row, the note that carries the finding, and an AI band. So
 * most of what follows checks that the BODY is there, and that the four things
 * the artboard draws which NO STORE HOLDS are stated rather than invented.
 *
 * RECUSAL IS THE TRAP, AND IT IS A GOVERNANCE ONE. The artboard's whole
 * instrument note is about a partner who recused and was therefore excluded
 * from the denominator. `ic_votes.vote` is `yes | no | abstain` and nothing
 * else. An abstention is a vote CAST; a recusal is a declared conflict. A page
 * that renders one as the other puts a false statement about a conflict of
 * interest on a fund's screen, so every surface here — page, worker route and
 * AI instruction — is checked for it separately.
 *
 * THE OPS ROW IS TESTED AS A CLAIM, NOT AS TEXT. `Close vote` used to say "no
 * vote is opened here, so none can be closed", which the route disproves in
 * two lines. The assertions below read `ic.ts` for the transitions rather than
 * matching the new sentence, because a sentence can be rewritten without the
 * behaviour changing and this file is about the opposite mistake.
 *
 * Labels, columns and the instrument head are read OFF THE ARTBOARD rather
 * than retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = read('frontend/src/pages/investor/deals/CommitZone.jsx');
const Z = codeOnly(ZONE);
const IC = read('cloudflare-worker/src/routes/ic.ts');
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const ROUTES = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));
const WORKSPACE = codeOnly(read('frontend/src/pages/investor/InvestorDealsWorkspace.jsx'));
const ACTIONS = read('frontend/src/workspaces/investorZoneActions.js');
const FILTERS = read('frontend/src/workspaces/investorZoneFilters.js');
const API = read('frontend/src/lib/api.js');
const CANVAS = read('design/canvases/integrated/Pages · Investor Deals.dc.html');

/** The ID3 fixture object alone, bounded at both ends. */
function id3() {
  const a = CANVAS.indexOf("id:'id3'");
  assert.ok(a >= 0, 'the ID3 artboard is gone from the canvas');
  const b = CANVAS.indexOf("id:'id4'", a);
  assert.ok(b > a, 'ID4 no longer follows ID3 — this slice would run past the artboard');
  return CANVAS.slice(a, b);
}

/** One route handler from `ic.ts`, bounded by the next registration. */
function handler(start) {
  const a = IC.indexOf(start);
  assert.ok(a >= 0, `${start} is gone from ic.ts`);
  const b = IC.indexOf('\nr.', a + start.length);
  return IC.slice(a, b > a ? b : IC.length);
}

test('the zone draws the artboard’s instrument, column for column', () => {
  const board = id3();
  const head = /head:\[([^\]]*)\]/.exec(board);
  assert.ok(head, 'the ID3 artboard no longer declares an instrument head');
  const columns = head[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(columns, ['Partner', 'Vote', 'Rationale']);

  const at = ZONE.indexOf("head={['Partner'");
  assert.ok(at >= 0, 'the vote ledger’s head is gone');
  assert.deepEqual(
    /head=\{\[([^\]]*)\]\}/.exec(ZONE.slice(at))[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
    columns,
    'the ledger head drifted from the artboard',
  );
  const cols = /cols:'([^']*)'/.exec(board);
  assert.ok(cols, 'the artboard no longer declares a grid');
  assert.ok(ZONE.includes(`"${cols[1]}"`), `the ledger grid is not the artboard's ${cols[1]}`);
  // The artboard's own title for it, so a rename there fails here.
  assert.match(board, /instTitle:'Vote ledger'/);
  assert.match(Z, /title="Vote ledger"/);
});

test('a recusal renders as itself, declaration beside it, out of the tally', () => {
  // THE STORE, FIRST. D461 grew the vocabulary: `ic_votes.vote` carries no
  // CHECK, so `recused` is enforced at the endpoint — and the declaration is
  // the price of the value, because a recusal with no conflict written down
  // is an unattributed change to the denominator.
  const vote = handler("r.post('/:uid/vote'");
  assert.match(vote, /\['yes', 'no', 'abstain', 'recused'\]\.includes\(vote\)/,
    'the accepted vote vocabulary changed — re-check every recusal claim below');
  assert.match(vote, /if \(vote === 'recused' && !rationale\?\.trim\(\)\)/,
    'the rationale requirement must stay scoped to a recusal and nothing else');
  assert.match(vote, /recusal_requires_declaration/,
    'a recusal without its declaration is no longer refused with a code');

  // The artboard asks for it and the page renders it: the vote pill IS the
  // stored value, with nothing between the column and the screen — the same
  // property as before the build, now covering the fourth value.
  const board = id3();
  assert.match(board, /recused/i, 'the artboard changed and this guard is now checking nothing');
  assert.match(Z, /pill: v\.vote, pillTone: VOTE_TONE\[v\.vote\]/,
    'the vote pill is no longer the stored value verbatim');
  const tone = /const VOTE_TONE = \{([^}]*)\}/.exec(Z);
  assert.ok(tone, 'the vote tone table is gone');
  assert.deepEqual(
    tone[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).sort(),
    ['abstain', 'no', 'recused', 'yes'],
    'the vote tone table no longer matches the column’s vocabulary',
  );
  // The tally excludes the recusal and says so beside it.
  assert.match(Z, /recused \(out of the tally\)/, 'the tally text must name the exclusion');
  // The worker counts it from the record rather than stating a gap.
  const room = handler("r.get('/commit-room'");
  assert.match(room, /recusal: \{\s*available: true/, 'the route stopped reporting the recusal count');
  // And the AI band is still forbidden from inventing one, which is the
  // surface most likely to reach for it: every IC memo it has ever read says
  // "recused". (The instruction is Session 2's file; it changes there.)
  const at = RESEARCH.indexOf("'deals/commit': {");
  assert.ok(at >= 0, 'the surface is not allow-listed, so the band 400s');
  const surface = RESEARCH.slice(at, RESEARCH.indexOf('\n  },', at));
  assert.match(surface, /Never describe any vote as recused and never reduce the denominator/);
});

test('conditions and minutes are stores now; quorum is the one still stated, not drawn', () => {
  const room = handler("r.get('/commit-room'");
  // The three D461 built report from the record…
  assert.match(room, /recusal: \{\s*available: true/, 'the route stopped serving the recusal count');
  assert.match(room, /conditions: \{\s*available: true/, 'the route stopped serving the conditions');
  // …minutes rides the linked meeting, so its availability is data — what is
  // pinned is the write route and the payload carrying the block.
  assert.match(IC, /r\.patch\('\/meetings\/:uid\/minutes'/, 'the minutes write route is gone');
  assert.match(room, /minutes,/, 'the commit-room payload dropped the minutes block');
  // …and the one that was not built is still stated rather than drawn.
  assert.match(room, /quorum: \{\s*available: false/, 'quorum is served without a store — re-check');
  // The chips are live keys now: a chip narrows the record the page loaded.
  const at = FILTERS.indexOf("'deals/commit': [");
  assert.ok(at >= 0, 'the commit filter row is gone');
  const rowsrc = FILTERS.slice(at, FILTERS.indexOf('],', at));
  for (const canvas of ['This deal', 'All decisions', 'Conditions', 'Minutes']) {
    assert.match(rowsrc, new RegExp(`canvas: '${canvas}', key:`), `${canvas} narrows nothing`);
  }
  // And the artboard's four labels are all four of them, in its order.
  const fil = /filters: fil\(\[([^\]]*)\]/.exec(id3());
  assert.ok(fil, 'the artboard no longer declares its filter row');
  assert.deepEqual(
    fil[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
    [...rowsrc.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]),
    'the commit filter row drifted from the artboard',
  );
  assert.match(ZONE, /<StatedLimit/, 'the limits block is gone');
});

test('a vote IS opened and closed, so the ops row says the narrower true thing', () => {
  // THE BEHAVIOUR, from the route rather than from the sentence. This is the
  // ID3 finding: the old reason claimed neither transition existed.
  const vote = handler("r.post('/:uid/vote'");
  assert.match(vote, /UPDATE ic_decisions SET status='voting'/,
    'the first vote no longer opens the decision — re-check the ops row');
  const put = handler("r.put('/:uid'");
  assert.match(put, /status = 'decided'/, 'setting a decision no longer closes the vote');
  assert.match(put, /decidedAt = decidedAt \|\| nowIso\(\)/, 'closing no longer stamps a time');

  // SO THE ROW IS A HANDLER NOW, not a better-worded refusal. The reason said
  // the capability was served and only a screen was missing; task #195 added
  // the screen, so what this must assert is that the op is PERFORMED and that
  // the page performing it is the one that reads the decision.
  const at = ACTIONS.indexOf("'deals/commit': [");
  const rowsrc = ACTIONS.slice(at, ACTIONS.indexOf('],', at));
  // ON THE REASON STRINGS, NOT ON THE FILE. The table QUOTES the old claim in
  // a comment above the corrected row — deliberately, so the next reader sees
  // what was wrong — and a raw-text search would read that quote as the defect
  // returning. Same trap ID1 hit when its own docblock cited a fixture figure.
  const reasons = [...ACTIONS.matchAll(/unbuilt: '([^']*)'/g)].map((m) => m[1]);
  for (const reason of reasons) {
    assert.doesNotMatch(reason, /no vote is opened here/, 'the false reason is back');
    assert.doesNotMatch(reason, /closing a vote is served by the API/,
      'the op is a handler now, so a reason saying only the screen is missing is stale');
  }
  assert.match(rowsrc, /\{ label: 'Close vote', kind: 'handler', handler: 'closeVote' \}/,
    'Close vote is not the page-performed op it became');

  // AND THE PAGE SUPPLIES IT CONDITIONALLY, which is the half that keeps it
  // honest. `PUT /:uid` admits the decision's author and an admin and refuses a
  // colleague with a 403, so the page must decide before the click rather than
  // let the refusal be the explanation. Three states, each with its own reason:
  // no decision open, already decided, and not the caller's to close.
  const zone = read('frontend/src/pages/investor/deals/CommitZone.jsx');
  assert.match(zone, /handlers: \{ closeVote, addCondition, exportMinutes \}/,
    'the page declares no handler for an op the table names');
  assert.match(zone, /api\.icUpdate\(closing, \{ decision \}\)/, 'nothing records the decision');
  assert.match(zone, /current\.status === 'decided'/,
    'a closed decision can be closed again, and the route would take the second answer');
  assert.match(zone, /Number\(current\.created_by\) === Number\(user\.id\)/,
    'the author check is gone, so the control is offered to colleagues the route refuses');
  // `created_by` has to reach the page for that check to be possible at all.
  assert.match(read('cloudflare-worker/src/routes/ic.ts'), /created_by: d\.created_by \?\? null,/,
    'the commit-room summary stopped carrying created_by, so the author check reads undefined');
  // ONLY THE THREE OUTCOMES THE STORE ADMITS, and read off the array the page
  // maps rather than off the testids — those are built by a template, so the
  // literal `button-close-vote-invest` never appears in the source. Asserting
  // the rendered string would have been checking for something that does not
  // exist until the browser runs.
  assert.match(zone, /\['invest', 'pass', 'defer'\]\.map\(\(decision\)/,
    'the outcome list is not the three the route accepts');
  assert.match(zone, /data-testid=\{`button-close-vote-\$\{decision\}`\}/,
    'the outcome buttons carry no stable testid');
  // A free field would let any string through, and `PUT /:uid` coerces an
  // unrecognised decision to null — closing nothing while looking like a save.
  assert.doesNotMatch(zone, /name="decision"/, 'the outcome became a free field');
  assert.match(ACTIONS, /\{ label: 'Add LP', kind: 'handler', handler: 'addLp' \}/,
    'the row this one was matched to is gone, so the pair no longer reads as one convention');
  // The guard in `profile_zone_actions` forbids a path in an unbuilt reason
  // because nothing checks it. Held here too, so a later edit cannot quietly
  // reintroduce one in this row alone.
  for (const m of rowsrc.matchAll(/unbuilt: '([^']*)'/g)) {
    assert.doesNotMatch(m[1], /(^|\s)\/[a-z]/, `an unbuilt reason carries an unchecked path: "${m[1]}"`);
  }
});

test('the rationale tile checks the artboard’s claim instead of repeating it', () => {
  // The artboard says `Rationale required`. The column is nullable and the
  // vote endpoint accepts a vote without one, so the page must report what was
  // written rather than assert a rule that is not enforced.
  assert.match(id3(), /Rationale required/, 'the artboard changed its claim');
  const vote = handler("r.post('/:uid/vote'");
  // The requirement is scoped to a recusal (its declaration), so a yes, no or
  // abstain still lands without one — which is what the tile reports.
  assert.match(vote, /vote === 'recused' && !rationale\?\.trim\(\)/,
    'the only required rationale is the recusal’s declaration — the tile’s premise changed otherwise');
  const room = handler("r.get('/commit-room'");
  assert.match(room, /enforced: false/, 'the route stopped saying the requirement is unenforced');
  assert.match(Z, /label="Rationales"/);
  assert.match(Z, /a reason is recorded, not required/);
  // Blank-but-present is absent: a rationale of spaces is not a reason. BOTH
  // counters must agree — the running total and the per-decision summary — or
  // the strip and the table disagree about the same votes. A file-wide match
  // passed while one of the two was mutated, which is what this counts for.
  const trims = [...room.matchAll(/String\(v\.rationale \|\| ''\)\.trim\(\)\.length > 0/g)];
  assert.equal(trims.length, 2,
    `expected both rationale counters to reject a blank, found ${trims.length}`);
  // And an absent one renders as unrecorded rather than as an empty cell.
  assert.match(Z, /v\.rationale \? \{ text: v\.rationale \} : \{ nr: true \}/);
});

test('none of the artboard’s fixture partners or figures reaches the page', () => {
  // Read off the canvas rather than retyped, so a renamed fixture is caught.
  const partners = [...CANVAS.matchAll(/\{ p:'([^']+)'/g)].map((m) => m[1]);
  const named = [...CANVAS.matchAll(/name:'([^']+)'/g)].map((m) => m[1]);
  const fixtures = [...new Set([...partners, ...named])];
  for (const who of fixtures) {
    assert.ok(!ZONE.includes(who), `the zone ships the artboard’s sample partner ${who}`);
  }
  // The artboard's own conditional-approval language, which no store supports.
  for (const phrase of ['Approved with conditions', 'IP chain of title', 'quorum met']) {
    assert.ok(!ZONE.includes(phrase), `the zone ships the artboard’s sample text "${phrase}"`);
  }
  // A count welded to a fixture is the same defect as a name.
  assert.doesNotMatch(Z, /\|\|\s*0\b(?!\s*\})/, 'an absent figure falls back to 0 outside a tally');
});

test('the strip counts five recorded things, and the attendee tile is labelled honestly', () => {
  // The artboard's fourth tile is `Conditions` — over a store that exists now
  // (migration 334), so the tile is drawn and counts the OPEN ones: a met or
  // waived condition no longer blocks anything.
  const board = id3();
  assert.match(board, /label:'Conditions'/, 'the artboard changed its fourth tile');
  assert.ok(/label="Conditions"/.test(Z), 'the zone dropped the Conditions tile the store now serves');
  assert.match(Z, /String\(openConditions\.length\)/, 'the Conditions tile must count the open ones');
  for (const label of ['Decisions', 'Votes cast', 'Rationales', 'In the room']) {
    assert.ok(Z.includes(`label="${label}"`), `the strip lost its ${label} tile`);
  }
  // AND THE ROSTER IS NOT A VOTING ENTITLEMENT. `ic_meeting_attendees` is an
  // invitation list; calling it "eligible voters" would invent a governance
  // rule the product does not enforce.
  assert.match(board, /label:'Eligible voters'/, 'the artboard changed its first tile');
  assert.ok(!/Eligible voters/.test(Z), 'the zone claims a voting roster it does not have');
  assert.match(Z, /invited, not entitled to vote/);
  const room = handler("r.get('/commit-room'");
  assert.match(room, /An invitation to the meeting, not an entitlement to vote/);
});

test('one helper owns the scoped read, and both callers go through it', () => {
  // The hole migration 219 closed was a query written without the predicate.
  // A second reader — here, the AI band — writing its own is how that reopens,
  // so `research.ts` must not touch `ic_decisions` directly at all.
  assert.match(IC, /export async function scopedDecisions\(/, 'the shared scoped read is gone');
  assert.match(IC, /const scope = icDecisionScope\(user\);[\s\S]{0,120}scope\.sql/);
  assert.match(codeOnly(RESEARCH), /import \{ scopedDecisions \} from '\.\/ic';/,
    'the shared-helper import is gone or commented out');
  // `codeOnly` for the same reason: the surface's comment EXPLAINS that it must
  // not run its own `SELECT ... FROM ic_decisions`, and the raw text would
  // count that explanation as the violation.
  assert.ok(!/FROM ic_decisions/.test(codeOnly(RESEARCH)),
    'research.ts queries ic_decisions directly instead of through the scoped helper');
  // The commit-room route uses it too rather than carrying a third copy.
  const room = handler("r.get('/commit-room'");
  assert.match(room, /await scopedDecisions\(c\.env, user, 100\)/);
  assert.ok(!/FROM ic_decisions/.test(codeOnly(room)),
    'the commit route carries its own copy of the predicate');
  // And the gather refuses an unprivileged caller before it reads anything.
  const at = RESEARCH.indexOf("'deals/commit': {");
  const surface = RESEARCH.slice(at, RESEARCH.indexOf('\n  },', at));
  assert.match(surface, /role !== 'admin' && role !== 'partner' && role !== 'investor'/,
    'the gather no longer refuses an unprivileged caller');
  const before = surface.indexOf("role !== 'admin'");
  assert.ok(before > 0 && before < surface.indexOf('scopedDecisions'),
    'the role check runs after the read rather than before it');
  // AND IT PASSES THE CALLER'S OWN ROLE, which is the difference between a
  // scoped read and no read at all. `UNSCOPED_ROLES` is `{'admin'}`, so
  // `icDecisionScope` answers an admin actor with ALL_ROWS (`1=1`) — a
  // hard-coded `role: 'admin'` here would put every firm's deliberations into
  // one caller's prompt while every other line in this block still looked
  // right. The shorthand `{ id: userId, role }` is the whole guarantee.
  assert.match(surface, /scopedDecisions\(c\.env, \{ id: userId, role \} as any, 1\)/,
    'the gather no longer passes the caller’s own role to the scope');
  assert.doesNotMatch(surface, /role:\s*'(admin|partner|investor)'/,
    'the gather hard-codes a role, which widens the scope past the caller');
});

test('the zone is mounted on its own route and the workspace no longer draws it', () => {
  assert.match(ROUTES, /commit: lazy\(\(\) => import\('\.\.\/\.\.\/pages\/investor\/deals\/CommitZone'\)\)/);
  assert.match(API, /icCommitRoom: \(\) => request\('\/ic\/commit-room'\)/);
  // Registered ahead of `/:uid`, or the literal is read as a uid and 404s.
  assert.ok(IC.indexOf("r.get('/commit-room'") < IC.indexOf("r.get('/:uid'"),
    'commit-room is registered after /:uid, so it is unreachable');
  assert.ok(IC.indexOf("r.get('/conditions'") < IC.indexOf("r.get('/:uid'"),
    'conditions is registered after /:uid, so the list is read as a uid and 404s');
  // Two files mounting one zone row is two chip rows and two export buttons.
  assert.ok(!WORKSPACE.includes("investorZoneActions('deals/commit'"),
    'the workspace still mounts the commit ops row');
  assert.ok(!WORKSPACE.includes('deals-commit'), 'the workspace still draws the commit panel');
  assert.ok(!WORKSPACE.includes('Total committed to deal'),
    'the three-field panel the artboard replaced is back');
  // The AI band is allow-listed, or it 400s on every run.
  assert.match(Z, /surface="deals\/commit"/, 'the zone dropped the artboard’s AI band');
  assert.match(RESEARCH, /'deals\/commit': \{/, 'the surface is not allow-listed');
});
