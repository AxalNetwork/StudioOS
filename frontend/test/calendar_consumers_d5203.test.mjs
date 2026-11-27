// D5203 (#5203): a page that is not the calendar reads only the calendar kinds it draws.
//   · every `listCalendarEvents(` outside the calendar page and the staff scope passes `kinds:`;
//   · the Grow launch read is 90 days either side (the Worker refuses more than 180), not two years;
//   · the Studio homes ask for the kinds their coverage already depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const FULL_READERS = new Set(['pages/CalendarPage.jsx', 'pages/calendarScope/CalendarScopeView.jsx']);

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

/** The call's argument text, up to its own closing parenthesis. */
function argsAt(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

test('every calendar read outside the calendar page and the staff scope names its kinds', () => {
  const calls = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(SRC.length);
    if (rel === 'lib/api.js') continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/listCalendarEvents\(/g)) calls.push({ rel, args: argsAt(text, m.index + m[0].length) });
  }
  assert.ok(calls.length >= 5, 'the scan found the consumers');
  for (const { rel, args } of calls) {
    if (FULL_READERS.has(rel)) continue;
    assert.match(args, /kinds:/, `${rel} reads every calendar source: pass kinds`);
  }
});

test('the Grow launch read is 90 days either side and only the launch kinds', () => {
  const page = readFileSync(join(SRC, 'pages/founder/FounderGrowLaunch.jsx'), 'utf8');
  assert.match(page, /const LAUNCH_WINDOW_DAYS = 90;/);
  assert.match(page, /new Date\(now - LAUNCH_WINDOW_DAYS \* DAY_MS\)/);
  assert.match(page, /new Date\(now \+ LAUNCH_WINDOW_DAYS \* DAY_MS\)/);
  assert.doesNotMatch(page, /setFullYear/, 'no year-wide window');
  assert.match(page, /kinds: LAUNCH_KINDS\.join\(','\)/);
});

test('the Studio homes ask for the kinds their coverage depends on', () => {
  const advisor = readFileSync(join(SRC, 'pages/advisor/AdvisorStudioHome.jsx'), 'utf8');
  assert.match(advisor, /api\.listCalendarEvents\(\{ kinds: ADVISOR_AGENDA_KINDS\.join\(','\) \}\)/);
  const investor = readFileSync(join(SRC, 'pages/investor/useInvestorSources.js'), 'utf8');
  assert.match(investor, /client\.listCalendarEvents\(\{ kinds: INVESTOR_AGENDA_KINDS\.join\(','\) \}\)/);
});
