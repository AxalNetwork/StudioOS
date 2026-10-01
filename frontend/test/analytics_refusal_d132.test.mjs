/**
 * D132 — a refusal is not a failure, and the Analytics tab is where the
 * difference became visible.
 *
 * WHAT CHANGED UNDERNEATH. `/monitoring/analytics/audit`, `/audit/export.csv`
 * and `/exports/recent` all read `admin_audit_log a LEFT JOIN users u ON
 * u.id = a.admin_user_id` — other admins' activity, by name and email. D132
 * raised all three to the super admin, because one super admin supervises many
 * subsidiary admins and a subsidiary admin supervises nobody's record but
 * their own territory's.
 *
 * WHY THAT NEEDED A PAGE CHANGE AND NOT ONLY A GATE. Every admin who is not
 * the holder now gets a 403 on those three, and `RetryCard` would have
 * rendered it as `Couldn't load recent exports (403)` — red border, red
 * ground, alert triangle, Retry button. That says three untrue things at once:
 * that something broke, that it might be transient, and that pressing a button
 * could help. None of them is true of a policy. So a 403 renders through
 * `Refusal`: neutral, the server's own sentence, and no retry.
 *
 * THE ASSERTIONS ARE RENDERED, NOT SCANNED, because what a component PRODUCES
 * is the claim — a source scan for the word `Refusal` would pass on a
 * component that returned null. Both are exported for exactly that reason, on
 * the `MarkHistory` precedent (`investor_portfolio_ip1.test.mjs`): they are
 * pure and prop-driven, so they need no fetch stub and no effect to run.
 *
 * AND BOTH DIRECTIONS, because a `RetryCard` that had simply LOST its failure
 * state would satisfy every 403 assertion here. The 500 case is the control.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/analytics_refusal_d132.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { Refusal, RetryCard } from '../src/pages/AnalyticsTab.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const TAB = codeOnly(read('frontend/src/pages/AnalyticsTab.jsx'));
const MON = read('cloudflare-worker/src/routes/monitoring_analytics.ts');

const SENTENCE = 'Super admin required';
/** `Refusal`'s own words when the server sent none. Read from the page below. */
const FALLBACK = 'This is not yours to read.';

test('a 403 renders as a stated refusal: the reason, no alarm, no retry', () => {
  const html = renderToStaticMarkup(
    React.createElement(RetryCard, {
      tab: 'recent exports', status: 403, message: SENTENCE, onRetry: () => {},
    }),
  );
  assert.ok(html.includes(SENTENCE), 'the server\'s own reason must reach the reader');
  assert.ok(!/Retry/.test(html),
    'a refusal offered a Retry button — there is no door there to try again');
  assert.ok(!/Couldn't load|Couldn&#x27;t load/.test(html),
    'a deliberate refusal was described as a failure to load');
  assert.ok(!/bg-red-|text-red-|border-red-/.test(html),
    'a policy decision was painted in the failure palette');
});

test('every other status keeps the failure card, retry and all', () => {
  // The control. Without it, a `RetryCard` that stopped rendering its failure
  // state entirely would pass all four assertions above.
  const html = renderToStaticMarkup(
    React.createElement(RetryCard, {
      tab: 'recent exports', status: 500, message: 'D1 timed out', onRetry: () => {},
    }),
  );
  assert.ok(/Couldn't load recent exports \(500\)|Couldn&#x27;t load recent exports \(500\)/.test(html),
    'a real failure stopped saying what failed');
  assert.ok(html.includes('D1 timed out'));
  assert.ok(/Retry/.test(html), 'a retryable failure lost its retry');
  assert.ok(/bg-red-50/.test(html), 'a real failure stopped looking like one');
});

test('Refusal says something even when the server sent no sentence', () => {
  // A 403 with an empty body must not render an empty grey box. Whatever else
  // is unknown, "this is not yours to read" is true.
  //
  // ASSERT THE SENTENCE, DO NOT STRIP THE TAGS. The first version of this read
  // `html.replace(/<[^>]*>/g, '').trim().length > 0` — incomplete HTML tag
  // filtering, which CodeQL rates high and is right to: `<[^>]*>` does not
  // survive a `>` inside an attribute value. It was also the weaker claim, since
  // any leftover text would satisfy it. Naming the fallback is both safer and
  // stricter, and it needs no regex at all.
  const html = renderToStaticMarkup(React.createElement(Refusal, { message: '' }));
  assert.ok(html.includes(FALLBACK),
    'a refusal with no server message rendered nothing the reader can act on');
});

test('the plan-change history routes its own 403 through the same component', () => {
  // `PlanAuditHistory` does not use `RetryCard` — it renders two inline red
  // lines of its own, for the list and for the CSV export. Both had to learn
  // the status, or the page would state the refusal in one place and cry
  // failure in two others about the same rule.
  assert.match(TAB, /const \[errStatus, setErrStatus\] = useState\(null\)/,
    'PlanAuditHistory never captured the status, so it cannot tell 403 from 500');
  assert.match(TAB, /const \[exportErrStatus, setExportErrStatus\] = useState\(null\)/,
    'the CSV export never captured the status');
  // NO REGEX IS BUILT FROM DATA. The flag is compared as the literal text it is
  // and the window is bounded to its own fork, so a NEIGHBOURING 403 branch
  // cannot satisfy it — the same correction #576 made when a guard assembled a
  // pattern out of a loop variable.
  for (const [name, flag] of [['the list', 'errStatus'], ['the CSV export', 'exportErrStatus']]) {
    const at = TAB.indexOf(`${flag} === 403`);
    assert.ok(at > 0, `${name} has no 403 fork at all`);
    assert.ok(TAB.slice(at, at + 120).includes('<Refusal '),
      `${name}'s 403 does not reach Refusal`);
  }
});

test('all three cross-admin reads are super-admin gated, and none was left behind', () => {
  // The page change only makes sense if the gate is actually there, and the
  // gate is only worth having if it covers every route that runs the join.
  // `/audit/export.csv` is the one D132's plan missed: same join, served as a
  // 10,000-row download. Asserting the JOIN rather than a route list is what
  // makes a FOURTH such route fail this test instead of slipping past it.
  const joinSites = MON.split('\n')
    .map((l, i) => [l, i])
    .filter(([l]) => /admin_audit_log a LEFT JOIN users u/.test(l));
  assert.ok(joinSites.length >= 3,
    'the cross-admin join moved or was renamed — re-point this guard rather than deleting it');

  for (const path of ['/audit/export.csv', '/audit', '/exports/recent']) {
    const at = MON.indexOf(`r.get('${path}'`);
    assert.ok(at > 0, `${path} is not mounted here any more`);
    const head = MON.slice(at, at + 900);
    assert.ok(/requireSuperAdmin\(c\)/.test(head),
      `${path} reads other admins' activity and is not super-admin gated`);
    // Bounded to this handler so a NEIGHBOURING route's gate cannot satisfy it.
    assert.ok(!/await requireAdmin\(c\)/.test(head.slice(0, head.indexOf('requireSuperAdmin'))),
      `${path} still runs requireAdmin before its super-admin gate`);
  }
});
