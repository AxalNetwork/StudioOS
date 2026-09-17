/**
 * HQ · Home (canvas H1) — the page that must not invent a number.
 *
 * The canvas's headline figures are per-subsidiary accounts, month-to-date
 * revenue, queue backlog and seat utilisation. None is computable: no account
 * names the licence it belongs to (UNRESOLVED_ITEMS U1). The page renders
 * what the ledger holds and says "Not recorded" for the rest, and the tenant
 * switcher narrows the loaded payload without asking the server for a scope
 * the server does not have. These pin that shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
const ROUTE = codeOnly(read('cloudflare-worker/src/routes/admin_hq.ts'));
const APP = read('frontend/src/App.jsx');

test('the HQ Home row points at /hq, and /hq is HQ-only', () => {
  const home = (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []).find((r) => r.label === 'Home');
  assert.equal(home?.to, '/hq');
  const line = APP.split('\n').find((l) => l.includes('path="/hq"'));
  assert.ok(line, '/hq must be registered');
  assert.match(line, /hqOnly\(/, 'an admin without the elevation gets the notice, not the overview');
});

test('the page reads one endpoint and never sends a tenant to the server', () => {
  // The switcher narrows client-side. A scoped request here would be the
  // half-applied scope U1 warns about: this page changes, nothing else does.
  const calls = [...PAGE.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)], ['hqOverview']);
  assert.match(read('frontend/src/lib/api.js'), /hqOverview: \(\) => request\('\/admin\/hq\/overview'\)/);
  assert.match(PAGE, /Narrowed to \{selected\.brand_name\} on this page only/);
});

test('every per-subsidiary figure renders Not recorded, and nothing renders an invented zero', () => {
  // The four per-card facts the canvas shows that the store cannot hold.
  //
  // NO REGEX IS BUILT FROM THE LABEL. It used to be, with `·` replaced by `.`
  // — an escape that made the pattern LOOSER rather than safer, and left every
  // character that would actually change it (`( ) [ ] + ? * |`) untouched.
  //
  // It is anchored on the card's `</dt>` rather than on the bare word, which
  // is a second thing the regex got wrong quietly: `Accounts` also names the
  // platform-wide TILE, and a pattern that scanned the whole file was free to
  // satisfy itself on whichever occurrence happened to work. EVERY definition
  // term with this label is checked, so a second card cannot appear with a
  // number in it.
  // D150 — THIS ASSERTION USED TO PIN THE DEFECT, and re-aiming it is the
  // point rather than a side effect. It required `Accounts` and `MTD · backlog`
  // to render `<Unrecorded />` on every card, under a footnote blaming U1 —
  // and U1 is a fact about HQ's OWN database, never the blocker for a branch.
  // A branch is a separate Worker over a separate D1 (D.2), so every account
  // there is that branch's by construction; `branchOverview` counts them, and
  // `/admin/hq/overview` has been SENDING them since D108 while this page read
  // neither `branches` nor `branches_coverage`.
  //
  // So the guard enforcing the refusal was the thing standing in front of the
  // fix. **A guard that pins a refusal has to be re-aimed the day the refusal
  // stops being true** — the third instance in two PRs, after
  // `territory_licences.test.mjs` and `hq_licences_h2h3.test.mjs` in D149.
  //
  // What is pinned now is the property that actually matters: a figure is
  // rendered only from a branch that ANSWERED, and every other state carries a
  // reason instead of a number.
  for (const label of ['Accounts', 'Seats used', 'Backlog']) {
    const term = `>${label}</dt>`;
    let at = PAGE.indexOf(term);
    assert.ok(at > 0, `${label} must be a definition term on the subsidiary card`);
    for (; at !== -1; at = PAGE.indexOf(term, at + 1)) {
      // BOUNDED BY THE NEXT DEFINITION TERM, NOT BY A CHARACTER COUNT. The
      // first draft took a fixed 420 and failed on correct code the moment a
      // cell grew a comment — the same fixed-window trap D147 hit (a 400-char
      // slice reaching into the next route) and D148 fixed by bounding on the
      // next `<Route`. A window that can run past its own cell can also be
      // SATISFIED by the next one, which is the quieter half of the bug.
      const nextDt = PAGE.indexOf('<dt', at + term.length);
      const cell = PAGE.slice(at, nextDt === -1 ? PAGE.indexOf('</dl>', at) : nextDt);
      assert.ok(cell.includes('</dd>'), `${label}: the window must contain its own value cell`);
      // THE GATE ITSELF, NOT THE WORD. The first draft asked only that `live`
      // appear somewhere in the cell — which a mutation replacing the gate with
      // a constant `false` satisfies, because `live?.…` survives in the
      // fallback. That is an assertion that cannot fail on the defect it was
      // written for: a cell hard-wired to refuse is exactly the pre-D150
      // behaviour. What is pinned is that the figure is produced UNDER `live`.
      assert.ok(
        cell.includes('{live &&'),
        `${label} must render its figure under \`live &&\` — a branch that answered, and no other condition`,
      );
      assert.ok(
        cell.includes('<Unrecorded reason='),
        `${label} must carry a REASON when the branch did not answer, never a bare dash`,
      );
      assert.ok(
        !/\|\| 0\b/.test(cell),
        `${label} must never default an absent branch figure to zero`,
      );
    }
  }
  // THE FOOTNOTE IS ASSERTED POSITIVELY, AND THE FIRST DRAFT WAS NOT.
  // It scanned the whole page for "need every account to name its licence" and
  // forbade it — which failed on correct code, because the comment RECORDING
  // why that sentence was removed quotes it. **A lexical scan cannot tell a
  // rule from its violation**: the same mistake D148's banned-word scan for
  // `rank` made against the page's own sentence "never a ranked list", and it
  // is caught here for the second time.
  //
  // So the property is stated as what the footnote must SAY. A page that
  // reverted would fail this, and a page that explains its own history does
  // not.
  assert.match(PAGE, /come from each branch&apos;s own read over its own database/);
  assert.match(PAGE, /stamped with the time it\s+answered/);
  assert.match(PAGE, /a branch that did not answer says so rather than reading as a zero/);
  // A tile renders Not recorded for any null value, so MTD revenue — which
  // has no source at all — is passed as null rather than as a number.
  assert.match(PAGE, /label="MTD revenue" value=\{null\}/);
  assert.match(PAGE, /\{value \?\? <Unrecorded \/>\}/, 'a null tile value must render Not recorded');
  assert.match(PAGE, /utilised: <Unrecorded \/>/);
  // The formatter refuses to default: a missing figure is null, never "0".
  assert.match(PAGE, /const num = \(v\) => \(v === null \|\| v === undefined \|\| !Number\.isFinite\(Number\(v\)\) \? null/);
  // `|| 0` is how a missing field becomes a confident zero. The page has no
  // business defaulting any figure: a figure it has is real, one it lacks is
  // Not recorded.
  assert.doesNotMatch(PAGE, /\|\|\s*0\b/, 'no `|| 0` — absent is not zero');
  assert.doesNotMatch(PAGE, /\?\?\s*0\b/, 'no `?? 0` either');
});

test('a failed request is unreadable, not an empty platform', () => {
  // THE SENTENCE NOW SPANS TWO FILES, so this checks both halves rather
  // than one string. `Unreadable` moved into `ui/Honesty.jsx` — it had been
  // written out locally here and in SecurityPage, and the two copies had
  // already drifted in their closing clause. The shared component owns
  // "<what> could not be read."; the clause that differs per zone is passed
  // as `claim`. Asserting only the prop would pass if the component stopped
  // rendering it, so the component is checked too.
  assert.match(PAGE, /const UNAVAILABLE = Symbol\('unavailable'\)/);
  assert.match(PAGE, /<Unreadable/, 'a failed read no longer renders Unreadable');
  assert.match(PAGE, /claim="This is not a claim that none exist\."/);
  assert.match(
    read('frontend/src/ui/Honesty.jsx'),
    /\{what\} could not be read\. \{claim\}/,
    'the shared Unreadable no longer renders the claim it is handed',
  );
  assert.match(PAGE, /No licences have been issued yet\. The ledger is empty, which is a different fact/);
});

test('the overview endpoint is super-admin only and carries the shared honesty block', () => {
  assert.doesNotMatch(ROUTE, /\brequireAdmin\b/);
  assert.match(ROUTE, /await requireSuperAdmin\(c\)/);
  assert.match(ROUTE, /\.\.\.DERIVED_UNAVAILABLE/, 'the same wording GET /licence/mine sends, not a second phrasing');
  assert.match(read('cloudflare-worker/src/routes/licence.ts'), /export const DERIVED_UNAVAILABLE/);
  // D108 — escalations HAVE a store now (migration 259), so the old
  // `escalations_available: false` pin is re-pointed rather than deleted: the
  // property worth guarding was never "escalations are absent", it was "the
  // payload says which of the two it is". The refusal string must be gone,
  // and the flag must be able to answer true.
  assert.doesNotMatch(
    ROUTE, /No escalation exists on the platform/,
    'the retired refusal must be deleted, not reworded — a stale reason gets cited by the next surface',
  );
  assert.match(ROUTE, /escalations_available: escalations\.available/);
  assert.match(ROUTE, /openEscalations\(env, ESCALATION_LIMIT\)/);
  // An unreadable hq_escalations table is reported as unreadable, never as an
  // empty queue — the same rule the ticket queue below follows.
  assert.match(ROUTE, /available: false,\s*\n\s*reason: 'The hq_escalations table could not be read/);
  // The queue is platform-wide; an unreadable table is reported, not zeroed.
  assert.match(ROUTE, /queue = \{ available: false, reason:/);
});

test('the overview is mounted before the /api/admin catch-all', () => {
  const src = read('cloudflare-worker/src/index.ts');
  const mount = src.indexOf("app.route('/api/admin/hq', adminHq)");
  const catchAll = src.indexOf("app.route('/api/admin', admin)");
  assert.ok(mount > -1 && mount < catchAll);
});

test('the rail names what is not connected instead of implying it is', () => {
  assert.match(PAGE, /role="super_admin"/);
  // D108 — both of these lines are retired. Per-branch accounts and queue
  // depth come from the fan-out now, and escalations have a store, so the
  // rail must no longer name either as unconnected. Asserted as an ABSENCE
  // because that is the regression: a note that still reads plausibly.
  assert.doesNotMatch(PAGE, /No account names its licence yet/);
  assert.doesNotMatch(PAGE, /No subsidiary-to-HQ escalation exists on the platform/);
  // What is still genuinely unsourced stays named, so the rail does not
  // quietly become empty.
  assert.match(PAGE, /\['Revenue per subsidiary', '[^']+'\]/);
  // D150 — THE ROW WAS RENAMED BECAUSE WHAT IS UNAVAILABLE CHANGED. It read
  // "Seat utilisation — needs seat_assignments", and D127 had already decided
  // AGAINST that store: seats used is counted from `users.role` and arrives
  // with each branch's read, which H1's cards now render. What has no store is
  // naming the individual seat, so that is what the row says.
  assert.doesNotMatch(PAGE, /\['Seat utilisation',/);
  assert.match(PAGE, /\['Which seat id a member holds', '[^']+'\]/);
  assert.match(PAGE, /\['Token P&L per subsidiary', '[^']+'\]/);
  // And the other reason that had outlived its blocker: D111 built the call
  // this once said did not exist.
  assert.doesNotMatch(PAGE, /that call is not built/);
});

test('D112 — the escalations list is no longer a queue nobody can clear', () => {
  // WHAT CHANGED IS THE LOOP, NOT THE LIST. Before D112 a branch could push an
  // item up and HQ could read it and do nothing else, so every item stayed in
  // this zone forever. The note is what tells a reader the loop closes, and
  // where — so all three of its properties are pinned, because each can be
  // lost on its own.
  const at = PAGE.indexOf('data-testid="hq-escalations-answer-link"');
  assert.ok(at > 0, 'the escalations zone lost the route to answering one');

  // 1. The destination is a REGISTERED route, not a plausible-looking string.
  //    A note pointing at a 404 is worse than no note: it reads as shipped.
  const link = PAGE.slice(PAGE.lastIndexOf('<Link', at), at);
  const to = /to="([^"]+)"/.exec(link);
  assert.ok(to, 'the answer link has no destination');
  assert.ok(APP.includes(`path="${to[1]}"`), `${to[1]} is not a registered route`);

  // 2. The two facts stay two. D111's promo-ceiling precedent, restated on the
  //    page that invites the action: a decision that was recorded but did not
  //    reach the branch must not read as a decision that never happened, or an
  //    operator enters it twice.
  const note = PAGE.slice(PAGE.lastIndexOf('<p', at), at);
  assert.match(note, /records HQ&rsquo;s decision/, 'the note does not say the decision is recorded');
  assert.match(note, /reported separately/,
    'the note collapses "decided" and "delivered" into one outcome');

  // 3. It is gated on the queue being READABLE. Inviting someone to answer a
  //    list that could not be read points them at nothing.
  assert.match(
    PAGE.slice(Math.max(0, at - 700), at),
    /data\.escalations_available !== false &&/,
    'the answer note renders even when the escalations queue is unreadable',
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 * Two shapes an apex audit caught on 2026-09-03, pinned for every HQ page.
 * ──────────────────────────────────────────────────────────────────────────── */

test('every HQ rail passes [title, detail] pairs, the shape WorkerRail destructures', () => {
  // ui/WorkerRail.jsx: `unavailable.map(([title, detail]) => …)`. A bare
  // string destructures to its first two characters and renders as "A" / "c".
  const dir = 'frontend/src/pages/hq';
  const pages = readdirSync(dir).filter((f) => f.endsWith('.jsx'));
  assert.ok(pages.length > 0);
  for (const f of pages) {
    const src = codeOnly(read(`${dir}/${f}`));
    const m = /unavailable=\{\[([\s\S]*?)\]\}/.exec(src);
    if (!m) continue;
    const entries = m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    assert.ok(entries.length > 0, `${f}: the rail lists what is unavailable`);
    for (const e of entries) {
      assert.ok(e.startsWith('['), `${f}: rail entry is a [title, detail] pair, not a string: ${e.slice(0, 50)}`);
    }
  }
});

test('the Suspended tile never reads as fine while the overview is unreadable', () => {
  // 'none' is a fact about the ledger. When the read failed, the tile says
  // so, in the neutral tone, instead of a green 'none'.
  const src = codeOnly(read('frontend/src/pages/hq/HqHomePage.jsx'));
  const tile = src.slice(src.indexOf('label="Suspended"'), src.indexOf('label="Suspended"') + 700);
  assert.match(tile, /note=\{!ready \? 'unreadable' :/, 'the note names the unreadable read first');
  assert.match(tile, /tone=\{!ready \? 'text-axal-ink' :/, 'and takes no colour from a count it does not have');
});

