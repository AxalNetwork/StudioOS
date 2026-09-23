/**
 * D202 — H17's three consoles on HQ · Platform (Monitoring, Broadcast,
 * Feature flags), and the switch registry behind the third.
 *
 * WHAT IS RENDERED. The Broadcast console, the switch list and the four P5
 * stat builders are pure over their props, so their states are RENDERED here
 * rather than matched as source text — a branch can keep its words and stop
 * drawing, and only the output notices (D200's rule, one page over). The page
 * itself loads in effects, which renderToStaticMarkup never runs, so the
 * order of its zones and its rail are read as source.
 *
 * WHAT IS READ. The switch registry's WIRING. Each switch must be answered by
 * the predicate the code that obeys it calls — imported, called, and still
 * called by that code — because the predicates disagree about what "on"
 * means, and a console with a parser of its own would contradict the very
 * thing it reports. The worker test drives each predicate with the values
 * they disagree on; this file holds the imports and the call sites in place.
 *
 * Pinned elsewhere and not repeated: the page has no handler and no form
 * (hq_content_platform_h6), the Flags and Overrides stats read the operator
 * store through one builder each (the same file; their states are rendered
 * in hq_platform_switches_d203), and the zone slices bounded by these titles
 * (hq_licences_h2h3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  BroadcastConsole, SwitchList, SWITCH_TONE, CHANNEL_STATE, UNAVAILABLE,
  workersStat, triggersStat, dlqStat, incidentsStat, perMinute, liveChip,
} from '../src/pages/hq/PlatformPage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/hq/PlatformPage.jsx');
const P = codeOnly(PAGE);
const SWITCHES = raw('cloudflare-worker/src/services/platformSwitches.ts');
const S = codeOnly(SWITCHES);
const ROUTE = codeOnly(raw('cloudflare-worker/src/routes/admin_platform.ts'));
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const html = (node) => renderToStaticMarkup(node);
const count = (hay, needle) => hay.split(needle).length - 1;

/** H17 alone, bounded at both ends. Unescaped — the canvas is HTML. */
function h17() {
  const a = CANVAS.indexOf('<section class="ab" id="h17">');
  assert.ok(a >= 0, 'the H17 artboard could not be found in the canvas');
  const b = CANVAS.indexOf('<section class="ab" id="h18">', a);
  assert.ok(b > a, 'H18 no longer follows H17 — this slice would run past the artboard');
  return CANVAS.slice(a, b).replaceAll('&amp;', '&');
}

/** H17's data model — P5's four stats — bounded at both ends. */
function p5Model() {
  const a = CANVAS.indexOf('// ── H17 · P5 Monitoring ──');
  const b = CANVAS.indexOf('// ── H17 · P6 Broadcast ──', a);
  assert.ok(a >= 0 && b > a, "H17's P5 data model could not be found");
  return CANVAS.slice(a, b);
}

// ────────────────────────────────────────────────────── the three zones ──

test('the page draws H17 as three zones, in the order the artboard draws them', () => {
  const board = h17();
  let last = -1;
  for (const panel of ['P5 · Monitoring', 'P6 · Broadcast', 'P7 · Feature flags']) {
    const at = board.indexOf(panel);
    assert.ok(at > last, `the artboard no longer draws "${panel}" after the panel before it`);
    last = at;
  }
  let prev = -1;
  for (const title of ['Monitoring', 'Broadcast', 'Feature flags']) {
    const at = P.indexOf(`<Zone title="${title}"`);
    assert.ok(at > 0, `the page has no ${title} zone`);
    assert.equal(P.indexOf(`<Zone title="${title}"`, at + 1), -1, `the page draws a second ${title} zone`);
    assert.ok(at > prev, `the ${title} zone is out of the artboard's order`);
    prev = at;
  }
  // P6's subtitle is the canvas's own sentence, carried over.
  assert.ok(board.includes('Platform channels, not a branch megaphone'));
  assert.ok(P.includes('sub="platform channels, not a branch megaphone"'),
    'the Broadcast zone lost the subtitle that says whose channels these are');
});

test("P5's four stats are the artboard's four, and the two renamed say why in their notes", () => {
  const drawn = [...p5Model().matchAll(/\{ k:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(drawn, ['Workers healthy', 'Cron jobs OK', 'DLQ depth', 'Incidents (7d)'],
    'the artboard changed its P5 stats — re-read them before re-pinning this test');

  const open = P.indexOf('data-testid="hq-monitoring-stats"');
  assert.ok(open > 0, 'the Monitoring zone lost its stat grid');
  const grid = P.slice(open, P.indexOf('</div>', open));
  // Canvas → page. "Workers healthy" becomes "Branch Workers healthy" because
  // HQ is not a row in the registry and is not counted; "Cron jobs OK" becomes
  // "Cron triggers firing" because what is counted is the six DECLARED
  // triggers D201 reads, not jobs. The incident window comes from the payload.
  const labels = ['label="Branch Workers healthy"', 'label="Cron triggers firing"', 'label="DLQ depth"',
    'Incidents (${incidents.window_days}d)'];
  let prev = -1;
  for (const l of labels) {
    const at = grid.indexOf(l);
    assert.ok(at > prev, `the stat grid lost ${l}, or it moved out of the artboard's order`);
    prev = at;
  }
  assert.equal(count(grid, '<Stat'), 4, 'the Monitoring grid is not exactly four stats');
});

// ─────────────────────────────────────────────────────────── the stats ──

test('a branch Worker is healthy only when it answers AND reports a working database', () => {
  const dep = (live_state, live) => ({ code: 'x', live_state, live });
  const mixed = workersStat({ deployments: [
    dep('ok', { db_ok: true }),
    dep('ok', { db_ok: false }), // replied, to say its database is failing
    dep('ok', undefined),        // replied without a database read: not vouched for
    dep('unreadable'),
    dep('not_deployed'),         // no binding, so never asked: not in the denominator
  ] });
  assert.equal(mixed.value, '1 / 4', 'a branch was counted healthy on its reply alone');
  assert.match(mixed.note, /HQ is not counted here/);
  assert.match(mixed.tone, /amber/, 'an unhealthy branch does not colour the stat');

  const all = workersStat({ deployments: [dep('ok', { db_ok: true }), dep('ok', { db_ok: true })] });
  assert.equal(all.value, '2 / 2');
  assert.equal(all.tone, undefined);

  const none = workersStat({ deployments: [] });
  assert.equal(none.value, 'No branch', 'an empty registry drew as a fraction');
  assert.match(none.note, /HQ is not counted here/);
  assert.equal(workersStat({ deployments: [dep('not_deployed')] }).value, 'None asked');

  for (const [state, why] of [
    [{ registry_available: false, registry_reason: 'The registry table is missing' }, 'an unreadable registry'],
    [UNAVAILABLE, 'a failed deployments read'],
  ]) {
    const s = workersStat(state);
    assert.equal(s.note, 'not a count of zero', `${why} drew as a number`);
    assert.match(html(s.value), />Unreadable</);
  }
  assert.equal(workersStat(null).value, '…');
});

test('a branch that answers with its database failing is not drawn as answering', () => {
  const [label, tone] = liveChip({ live_state: 'ok', live: { db_ok: false } });
  assert.equal(label, 'database failing', 'a failing database drew as "answering"');
  assert.match(tone, /amber/);
  assert.doesNotMatch(tone, /green/);
  assert.equal(liveChip({ live_state: 'ok', live: { db_ok: true } })[0], 'answering');
  assert.equal(liveChip({ live_state: 'not_deployed' })[0], 'no binding yet');
  assert.equal(liveChip({ live_state: 'unreadable' })[0], 'unreadable');
  // And the row says why, from the branch's own detail.
  assert.ok(P.includes("d.live_state === 'ok' && d.live?.db_ok === false && ("),
    'the failing-database row lost its explanation');
  assert.ok(P.includes('data-testid={`hq-deployment-db-${d.code}`}'));
});

test('the cron stat counts the declared triggers on schedule, and says so when it cannot', () => {
  const trig = (state) => ({ state });
  const s = triggersStat({}, { available: true, triggers: ['ok', 'ok', 'ok', 'ok', 'ok', 'stale'].map(trig) });
  assert.equal(s.value, '5 / 6');
  assert.equal(s.note, 'declared triggers on schedule', 'the cron stat no longer says what it counts');
  assert.match(s.tone, /amber/);
  const u = triggersStat({}, { available: false, reason: 'The scheduled-run history could not be read.' });
  assert.equal(u.note, 'not a count of zero');
  assert.equal(triggersStat(UNAVAILABLE, null).note, 'not a count of zero');
  assert.equal(triggersStat(null, null).value, '…');
});

test('an unreadable backlog or incident count draws as unreadable, never as 0', () => {
  for (const [fn, block] of [
    [dlqStat, { available: false, reason: 'The D1 dead-letter table (dead_letter_queue) could not be read' }],
    [incidentsStat, { available: false, reason: 'The status-page incident table could not be read' }],
  ]) {
    const s = fn({}, block);
    assert.equal(s.note, 'not a count of zero', `${fn.name} drew an unreadable block as a number`);
    const out = html(s.value);
    assert.match(out, />Unreadable</);
    assert.ok(out.includes(`title="${block.reason}"`), `${fn.name} dropped the reason the server sent`);
    assert.equal(fn(UNAVAILABLE, null).note, 'not a count of zero');
    assert.equal(fn(null, null).value, '…');
  }
  // A measured zero IS a zero, drawn plainly.
  const empty = dlqStat({}, { available: true, legacy: 0, mirror: 0, total: 0 });
  assert.equal(empty.value, '0');
  assert.equal(empty.tone, undefined);
  const backlog = dlqStat({}, { available: true, legacy: 1, mirror: 2, total: 3 });
  assert.equal(backlog.value, '3');
  assert.match(backlog.tone, /red/);
  assert.match(backlog.note, /1 from the D1 queue · 2 from Cloudflare Queues/,
    'the backlog does not say which queue holds it');
  const none = incidentsStat({}, { available: true, window_days: 7, count: 0, basis: 'b' });
  assert.equal(none.value, '0');
  assert.equal(none.tone, undefined);
  // The page says what a zero can and cannot mean, from the payload.
  assert.ok(P.includes('{incidents.basis}'), 'the incident count lost the sentence that qualifies it');
});

test('request rate is the count over the window the read covered, and is labelled an average', () => {
  const n = (v) => Number(String(v).replace(',', '.'));
  assert.equal(perMinute(14400, 1440), '10');
  assert.equal(n(perMinute(1200, 1440)), 0.83);
  assert.equal(perMinute(0, 1440), '0');
  assert.equal(perMinute(100, 0), null, 'a zero window produced a rate');
  assert.equal(perMinute(100, undefined), null, 'a missing window produced a rate');
  assert.equal(perMinute(undefined, 1440), null, 'a missing count produced a rate');
  // The page divides by the window the payload echoed, never one it assumes.
  assert.ok(P.includes('perMinute(t.hits, traffic.window_minutes)'),
    'the rate is no longer divided by the window the read covered');
  assert.ok(P.includes('req/min avg'), 'the rate is not labelled an average');
  assert.match(PAGE, /not a live rate/);
  // HQ's own backlog is HQ's row's; a branch row never borrows it.
  assert.ok(P.includes("t.branch === 'hq'\n                            ? hqDlqCell(data, dlq)"),
    "HQ's dead-letter depth is not confined to HQ's row");
  assert.ok(P.includes('<Unrecorded reason="No branch reports its dead-letter backlog to HQ.">not recorded</Unrecorded>'));
});

// ─────────────────────────────────────────────────────────── broadcast ──

const REASON = 'Member counts are not recorded: the platform never asks Telegram how many people are in a channel.';
const CHANNELS = [
  { id: 1, label: 'Founders', audience: 'founder', enabled: true, chat_bound: true, state: 'ready',
    sent_count: 2, last_sent_at: '2026-09-21 11:30:00', last_test_at: null, last_error: null,
    // Never sent by the route — here to prove the component would not draw it
    // even if it were.
    chat_id: '-1001234567890' },
  { id: 2, label: 'LPs', audience: 'investor', enabled: true, chat_bound: false, state: 'unbound',
    sent_count: 0, last_sent_at: null, last_test_at: null, last_error: null },
  { id: 3, label: 'Old', audience: 'partner', enabled: false, chat_bound: true, state: 'disabled',
    sent_count: 1, last_sent_at: '2026-08-01 09:00:00', last_test_at: null, last_error: null },
];
const tg = (over = {}) => ({
  available: true, token_configured: true, channels: CHANNELS,
  members_available: false, members_reason: REASON, ...over,
});
const X_OFF = { available: true, client_configured: false, accounts: 0, enabled_accounts: 0 };

test('each channel draws its own state and what it has sent, and never its chat id', () => {
  const out = render(BroadcastConsole, { telegram: tg(), xStatus: X_OFF });
  for (const label of ['Ready', 'No chat bound', 'Disabled']) {
    assert.ok(out.includes(`>${label}<`), `a channel state is missing: ${label}`);
  }
  assert.ok(out.includes('2 sent · last 2026-09-21 11:30'));
  assert.ok(out.includes('nothing sent yet'), 'a channel that never sent drew a count');
  assert.ok(!out.includes('-1001234567890'), 'a chat id was drawn');
  assert.ok(out.includes(REASON), 'the member-count refusal is not said');
  // A member FIGURE — "1,204 members" is what the artboard draws. The word
  // alone is fine: the refusal and its test id both carry it.
  assert.doesNotMatch(out, /\d[\d,.]*\s*members/i, 'a member figure was drawn');
  assert.ok(out.includes('data-testid="hq-telegram-disabled-note"'),
    'a disabled channel is on the list and the note about what disabled means is not');
  assert.ok(!render(BroadcastConsole, { telegram: tg({ channels: CHANNELS.slice(0, 2) }), xStatus: X_OFF })
    .includes('hq-telegram-disabled-note'), 'the disabled note appears with no disabled channel');
  assert.ok(!P.includes('chat_id'), 'the page reads a chat id');
});

test('a missing bot token is said once for the deployment, never once per channel', () => {
  const none = render(BroadcastConsole, { telegram: tg({ token_configured: false }), xStatus: X_OFF });
  assert.equal(count(none, 'data-testid="hq-telegram-no-token"'), 1);
  assert.ok(!render(BroadcastConsole, { telegram: tg(), xStatus: X_OFF }).includes('hq-telegram-no-token'));
  // The token is a deployment fact: it stands even when the channel table
  // could not be read.
  const unread = render(BroadcastConsole, {
    telegram: { available: false, token_configured: false, reason: 'The Telegram channel table could not be read.' },
    xStatus: X_OFF,
  });
  assert.equal(count(unread, 'data-testid="hq-telegram-no-token"'), 1);
  assert.ok(unread.includes('The Telegram channel table could not be read.'));
  assert.ok(!unread.includes('hq-broadcast-channels'), 'an unreadable table drew a channel list');
  assert.ok(!unread.includes('empty list'), 'an unreadable table was called empty');
});

test('no channel is an empty list, and says it is not an unreadable one', () => {
  const out = render(BroadcastConsole, { telegram: tg({ channels: [] }), xStatus: X_OFF });
  assert.ok(out.includes('That is an empty list, not an unreadable one.'));
});

test('X is listed whether or not it is set up, and an unreadable count is not 0', () => {
  const off = render(BroadcastConsole, { telegram: tg(), xStatus: X_OFF });
  assert.ok(off.includes('>Not provisioned<'), 'an unconfigured X is not drawn as the decision it is');
  assert.ok(/border-dashed[^"]*"[^>]*data-testid="hq-broadcast-x"/.test(off),
    'an unconfigured X is not dashed');
  const on = render(BroadcastConsole, {
    telegram: tg(), xStatus: { available: true, client_configured: true, accounts: 2, enabled_accounts: 1 },
  });
  assert.ok(on.includes('>OAuth configured<'));
  assert.ok(on.includes('2 accounts · 1 enabled'));
  const unread = render(BroadcastConsole, {
    telegram: tg(), xStatus: { available: false, client_configured: true, reason: 'The X account table could not be read.' },
  });
  assert.ok(unread.includes('accounts unreadable'));
  assert.ok(!/0 accounts/.test(unread), 'an unreadable account table drew as zero accounts');
});

test('the summary loading and the summary failing are two states, neither a list', () => {
  assert.ok(render(BroadcastConsole, { loading: true }).includes('Reading the channels…'));
  const failed = render(BroadcastConsole, { unreadable: true });
  assert.ok(failed.includes('The platform summary could not be read.'));
  assert.ok(!failed.includes('hq-broadcast'), 'a failed summary drew channels');
});

test('the Feature flags zone does not say the summary failed while it is still being read', () => {
  // Inline in the page, so it is read as source — bounded to its own zone.
  const open = P.indexOf('<Zone title="Feature flags"');
  const close = P.indexOf('</Zone>', open);
  assert.ok(open > 0 && close > open, 'the Feature flags zone could not be bounded');
  const zone = P.slice(open, close);
  const loading = zone.indexOf('data === null');
  const failed = zone.indexOf("'The platform summary could not be read.'");
  assert.ok(loading > 0, 'the zone has no loading state of its own');
  assert.ok(zone.includes('Reading the platform summary…'), 'the loading state says nothing');
  assert.ok(failed > loading,
    'the failed-read sentence is reachable before the loading state is ruled out');
});

test("the page's channel states are exactly the states the route can return", () => {
  const expr = /state: !enabled \? '(\w+)' : !chatBound \? '(\w+)' : '(\w+)'/.exec(ROUTE);
  assert.ok(expr, "the route's channel-state expression changed shape — re-read it");
  assert.deepEqual([...expr.slice(1)].sort(), Object.keys(CHANNEL_STATE).sort(),
    'the page has a tone for a channel state the route never returns, or lacks one it does');
  // An unknown state draws as itself, in amber — never as Ready.
  const odd = render(BroadcastConsole, { telegram: tg({ channels: [{ ...CHANNELS[1], state: 'muted' }] }), xStatus: X_OFF });
  assert.ok(odd.includes('>muted<'));
  assert.ok(!odd.includes('>Ready<'));
});

// ─────────────────────────────────────────────────────────── the flags ──

test("the switch tones are exactly the registry's states, and an unknown one draws as unreadable", () => {
  const decl = /export const SWITCH_STATES = \[([^\]]*)\] as const;/.exec(SWITCHES);
  assert.ok(decl, 'SWITCH_STATES is no longer declared as a literal list — re-read it');
  const states = [...decl[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(SWITCH_TONE).sort(), [...states].sort(),
    'the page and the registry disagree about the switch states');

  const one = (state) => render(SwitchList, { switches: { available: true, items: [
    { key: 'k', label: 'A switch', state, set_by: 'deploy', effect: 'What is true while it is on.' },
  ] } });
  for (const s of states) {
    assert.ok(one(s).includes(`uppercase ${SWITCH_TONE[s]}"`), `the ${s} state does not carry its own tone`);
  }
  const unknown = one('half');
  assert.ok(unknown.includes(`uppercase ${SWITCH_TONE.unreadable}"`),
    'an unknown state borrowed a tone that vouches for it');
  assert.ok(P.includes('SWITCH_TONE[sw.state] || SWITCH_TONE.unreadable'));
});

test('each switch says what sets it, what "on" does, and why — and nothing on the list can be pressed', () => {
  const out = render(SwitchList, { switches: { available: true, items: [
    { key: 'ai_budget_trip', label: 'AI budget trip', state: 'unreadable', set_by: 'runtime',
      effect: 'Every AI call on the platform is refused.', reason: 'The spend store did not answer.' },
    { key: 'session_charging', label: 'Session charging', state: 'on', set_by: 'deploy',
      effect: 'Priced sessions are charged through Stripe.', detail: 'Stripe test mode' },
  ] } });
  assert.ok(out.includes('set at runtime') && out.includes('set at deploy'));
  assert.ok(out.includes('Every AI call on the platform is refused.'));
  assert.ok(out.includes('The spend store did not answer.'));
  assert.ok(out.includes('Stripe test mode'));
  assert.ok(!/<button|<form|<input|<select/.test(out), 'the switch list grew a control');

  const absent = render(SwitchList, { switches: { available: false, reason: 'The platform switches could not be read.' } });
  assert.ok(absent.includes('The platform switches could not be read.'));
  assert.ok(!absent.includes('hq-platform-switches'), 'an unreadable registry drew a list');
});

/**
 * Each switch, the predicate its console entry must call, where that predicate
 * lives, and the code that OBEYS the switch through the same predicate. If a
 * console entry stops importing its reader's predicate, or the reader stops
 * calling it, the console and the platform can disagree — which is the one
 * thing the list exists to rule out.
 */
const WIRING = [
  // D203 — the Eadwyn kill has two halves now, the deploy variables and HQ's
  // `eadwyn_off` row, and the property this row exists for is unchanged: the
  // console and the routes that refuse ask ONE predicate. It moved from the
  // deploy half alone to the combined one, because asking only the deploy half
  // would show Eadwyn on while every request was refused by the store's kill.
  ['advisorKillState', './advisor/rollout', 'cloudflare-worker/src/routes/advisor.ts'],
  ['rerankDisabled', './advisor/rerank', 'cloudflare-worker/src/services/advisor/rerank.ts'],
  ['settlementMode', './advisorMoney', 'cloudflare-worker/src/services/advisorConnect.ts'],
  ['stripeTaxEnabled', '../util/stripeTax', 'cloudflare-worker/src/routes/billing.ts'],
  ['cfQueueEnabled', './queue', 'cloudflare-worker/src/services/queue.ts'],
  ['isLive', './market_intel/registry', 'cloudflare-worker/src/services/market_intel/aggregator.ts'],
  ['isFlagged', './dueDiligence', 'cloudflare-worker/src/services/dueDiligence.ts'],
];

const calls = (src, name) => count(src, `${name}(`) - count(src, `function ${name}(`);
// The names each `import { … } from '<from>';` statement binds, read as
// literal text. No pattern is built from the name or the path: what the check
// means is "this module imports exactly this name, unaliased, from exactly this
// path", which is a string comparison. A regex assembled from data compared it
// as a pattern instead, and `\bname\b` also accepted `name as other` — an
// import whose local binding is not the name `calls()` then counts.
const importedNames = (src, from) => {
  const names = [];
  const tail = `} from '${from}';`;
  for (let at = src.indexOf(tail); at >= 0; at = src.indexOf(tail, at + tail.length)) {
    const open = src.lastIndexOf('import {', at);
    if (open < 0) continue;
    const list = src.slice(open + 'import {'.length, at);
    if (list.includes(';')) continue; // that brace opened a different statement
    for (const spec of list.split(',')) if (spec.trim()) names.push(spec.trim());
  }
  return names;
};
const importsFrom = (src, name, from) => importedNames(src, from).includes(name);

test("each switch is read through the predicate the code that obeys it calls", () => {
  for (const [name, from, obeyer] of WIRING) {
    assert.ok(importsFrom(S, name, from), `platformSwitches no longer imports ${name} from ${from}`);
    assert.ok(calls(S, name) >= 1, `platformSwitches imports ${name} and never calls it`);
    assert.ok(calls(codeOnly(raw(obeyer)), name) >= 1,
      `${obeyer} no longer obeys the switch through ${name}, so the console reads a rule nothing enforces`);
  }
  // The AI trip: the router's gate and the console's report must read the key
  // through ONE function, or they can disagree about what "tripped" means.
  const ROUTER = codeOnly(raw('cloudflare-worker/src/services/aiRouter.ts'));
  assert.ok(importsFrom(S, 'aiOrgKillSwitchState', './aiRouter'));
  assert.ok(calls(S, 'aiOrgKillSwitchState') >= 1);
  const body = (fn) => {
    const at = ROUTER.indexOf(fn);
    assert.ok(at >= 0, `aiRouter no longer defines ${fn}`);
    return ROUTER.slice(at, ROUTER.indexOf('\n}\n', at));
  };
  assert.ok(body('async function killSwitchOn(').includes('killSwitchState(store)'),
    "the router's gate stopped reading the trip through killSwitchState");
  assert.ok(body('export async function aiOrgKillSwitchState(').includes('killSwitchState(store)'),
    "the console's reading stopped going through killSwitchState");
  assert.ok(calls(ROUTER, 'killSwitchOn') >= 1, 'nothing gates on the trip any more');
});

test('the registry parses no variable of its own', () => {
  // The whole point of calling each reader's predicate is that the registry
  // never interprets a variable itself; any of these shapes would be a second
  // parser that can disagree with the first.
  assert.doesNotMatch(S, /\benv\.[A-Z_]/, 'platformSwitches reads a variable directly');
  assert.doesNotMatch(S, /\(env as /, 'platformSwitches casts env to read a variable');
  // Raw-value comparisons only: `settlement === 'live'` compares a predicate's
  // RESULT, which is exactly what the registry is meant to do.
  assert.doesNotMatch(S, /===\s*'(1|true|yes)'/, 'platformSwitches compares a raw value');
  assert.doesNotMatch(S, /toLowerCase|toUpperCase|\/\^\(1\|/, 'platformSwitches normalises a raw value');
  assert.doesNotMatch(S, /MI_FLAG_|DD_FLAG_/, 'platformSwitches builds a variable name');
  // The same holds for the two broadcast facts the route reports.
  assert.doesNotMatch(ROUTE, /env\.TELEGRAM_BOT_TOKEN|env\.X_CLIENT_/, 'the route reads a broadcast secret directly');
  assert.ok(importsFrom(ROUTE, 'telegramTokenConfigured', '../services/telegramClient'));
  assert.ok(importsFrom(ROUTE, 'xClientConfigured', '../services/xClient'));
  assert.ok(calls(codeOnly(raw('cloudflare-worker/src/services/telegramClient.ts')), 'telegramTokenConfigured') >= 1,
    'the Telegram sender no longer refuses through the predicate the console reports');
  assert.ok(calls(codeOnly(raw('cloudflare-worker/src/routes/admin_x.ts')), 'xClientConfigured') >= 2,
    "admin_x's status and its OAuth start no longer share the console's rule");
});

// ────────────────────────────────────────────────────────────── the rail ──

test('the rail reads back only what answered, and names what has no store', () => {
  for (const [line, block] of [
    ['dlq?.available ?', 'dead letters'], ['incidents?.available', 'incidents'],
    ['telegram?.available', 'Telegram'], ['switches?.available', 'switches'],
  ]) {
    assert.ok(P.includes(line), `the rail reads the ${block} back without asking whether it answered`);
  }
  for (const row of [
    // D203 retired "No operator flag store exists" — migration 283 is one. What
    // stays absent is staging a switch below a whole deployment, and reaching
    // a branch with one HQ throws.
    "['Staged switches', 'A switch is on or off for a whole deployment; none can be staged to one territory or a share of accounts.']",
    "['Branch reach', 'A switch HQ throws stops Eadwyn on HQ\\'s own deployment; pushing one to the branches is not built.']",
    "['Channel member counts', 'Never asked of Telegram, so not recorded.']",
    "['Dead letters per branch', 'No branch reports its backlog to HQ; the figure here is HQ\\'s own.']",
  ]) {
    assert.ok(P.includes(row), `the rail lost the stated absence: ${row.slice(2, 30)}`);
  }
  assert.match(P, /throws no switch and rolls nothing back/, 'the rail no longer says it changes nothing');
});
