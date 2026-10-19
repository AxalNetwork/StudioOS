/**
 * D402 — the rail's model picks are stored per workspace and per task, and the
 * rail reads the current path without a router.
 *
 * D402 also drew an INHERITED, read-only card on every zone below a workspace,
 * worked out by `ui/railInheritance.js`. D698 (#1660) removed both: the AIRail
 * canvas offers the pick on every page, and the rail's note says how far it
 * reaches ("Remembered for {workspace}. Switching changes nothing already
 * accepted."). The assertions on that card and on `railInheritance` went with
 * it; `airail_d698.test.mjs` pins that they are gone. What stays here is what
 * D402 established that still holds: a zone and its root share one stored key,
 * so the card and the run agree, and reading the path never throws. Since
 * D769 PR 2 (#2088) that key is the page's (D768) in the Worker's matrix.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/worker_rail_inherited_d402.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const RAIL = 'frontend/src/ui/WorkerRail.jsx';

// ── The rail ────────────────────────────────────────────────────────────

test('a zone and its root read one stored pick, so the card and the run agree', () => {
  const src = codeOnly(read(RAIL));
  // D769 PR 2 (#2088): the cards are the page's row, read by the shell's page
  // key (D768), the same on a zone as on the root; the pick is stored per page
  // and per open option.
  assert.match(src, /const row = useRailRow\(pageKey, optionKey\);/, 'the cards are not the page\'s row');
  assert.match(src, /railPrefsApi\.setPagePick\(pageKey, id, optionKey\)/, 'the pick is not stored per page');
  assert.match(src, /\{rail\.cards\.map\(\(card\) => \{/, 'a zone does not draw the cards in use');
  // The Worker reads the pick a rail run takes from the same rows the route
  // writes: section = the page key lower-cased, task = the option or 'page'.
  const ai = codeOnly(read('cloudflare-worker/src/routes/ai.ts'));
  assert.match(ai, /const task = option \?\? 'page';/);
  assert.match(ai, /writeRailPreference\(c\.env, Number\(user\.id\), railSectionOf\(row\), task,/);
  const router = codeOnly(read('cloudflare-worker/src/services/aiRouter.ts'));
  assert.match(router, /\.bind\(userId, page\.trim\(\)\.toLowerCase\(\), 'page', option \?\? 'page'\)/,
    'the run reads a different store, so the card and the run can disagree');
});

test('reading the path never throws outside a router', () => {
  const src = codeOnly(read(RAIL));
  assert.doesNotMatch(src, /useLocation\(/, 'useLocation throws outside a router');
  assert.match(src, /useContext\(UNSAFE_LocationContext\)/);
});
