// D4154 (#4154) — the Calendar's admin scopes: who sees which scope, that the
// scoped read sends `scope`, that a staff view draws no edit, and that people
// are never shown by email.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calendar_scope_d4154.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import {
  BUILD, NOT_RECORDED, apiScope, byDay, coverageLine, dayCounts, emptyLine, filterRows, scopeOf, scopedRow, scopesFor, viewingChip, withScope,
} from '../src/pages/calendarScope/calendarScopeModel.js';
import { ScopeSwitch } from '../src/pages/calendarScope/CalendarScopeView.jsx';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const VIEW = read('pages/calendarScope/CalendarScopeView.jsx');
const keys = (u) => scopesFor(u).map((s) => s.key);
const BRANCH_ADMIN = { role: 'admin', branch: { code: 'pt', name: 'Studio Lisbon' } };
const SUPER = { role: 'admin', is_super_admin: 1 };

test('CA1: the switcher is hidden for members; Studio for a studio admin; Platform only for the Super Admin', () => {
  for (const role of ['founder', 'investor', 'partner', 'advisor', 'exploring']) assert.deepEqual(keys({ role }), [], role);
  assert.deepEqual(keys({ role: 'admin' }), [], 'a plain HQ admin has no staff scope the route would answer');
  assert.deepEqual(keys(BRANCH_ADMIN), ['mine', 'studio']);
  assert.deepEqual(keys(SUPER), ['mine', 'platform']);
  assert.deepEqual(keys({ ...SUPER, branch: { code: 'pt' } }), ['mine', 'studio'], 'a branch never offers Platform');
  assert.equal(renderToStaticMarkup(h(MemoryRouter, null, h(ScopeSwitch, { scopes: [], scope: 'mine', pathname: '/calendar', search: '' }))), '');
  const sw = renderToStaticMarkup(h(MemoryRouter, null, h(ScopeSwitch, { scopes: scopesFor(SUPER), scope: 'platform', pathname: '/calendar/agenda', search: '?date=2026-10-26' })));
  assert.match(sw, /href="\/calendar\/agenda\?date=2026-10-26&amp;scope=platform"/);
  assert.match(sw, /href="\/calendar\/agenda\?date=2026-10-26"/);
});

test('the scope is the address, and a scope the viewer lacks falls back to Mine', () => {
  const s = scopesFor(BRANCH_ADMIN);
  assert.equal(scopeOf('?scope=studio', s), 'studio');
  assert.equal(scopeOf('?scope=platform', s), 'mine');
  assert.equal(scopeOf('?scope=studio', []), 'mine');
  assert.equal(withScope('?date=x&scope=studio', 'mine'), '?date=x');
  assert.equal(apiScope('platform'), 'all');
  assert.equal(apiScope('studio'), 'studio');
  assert.equal(viewingChip('studio', BRANCH_ADMIN), 'Viewing: Studio · Studio Lisbon');
});

test('listCalendarEvents passes scope, and the page renders the scoped view for ?scope=', () => {
  const api = read('lib/api.js');
  assert.match(api, /if \(opts\.scope && opts\.scope !== 'mine'\) qs\.set\('scope', opts\.scope\);/);
  assert.match(VIEW, /api\.listCalendarEvents\(\{ from: win\.from\.toISOString\(\), to: win\.to\.toISOString\(\), scope: apiScope\(scope\) \}\)/);
  const page = read('pages/CalendarPage.jsx');
  assert.match(page, /if \(scope === 'mine'\) return <PersonalCalendar scopes=\{scopes\} \/>;/);
});

test('a staff view draws no edit: no New, RSVP, reschedule, cancel, push or write call', () => {
  assert.doesNotMatch(codeOnly(VIEW), /NewMenu|CancelDialog|rsvp|reschedul|pushCalendar|method: '(POST|PUT|PATCH|DELETE)'/i);
  const calls = [...VIEW.matchAll(/\bapi\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)], ['listCalendarEvents']);
  assert.match(VIEW, /Read only/);
});

test('CA2 rows: owner by name, company and link "Not recorded" until C1, never an email', () => {
  assert.equal(BUILD.C1.issue, 4196);
  const r = scopedRow({
    id: 'e1', kind: 'compliance_due', title: 'Franchise tax · Delaware', start_at: '2026-10-26T14:00:00Z', all_day: false,
    attendees: [{ name: 'Jordan Reyes', email: null, role: 'founder' }], project_name: 'Atlas Pilot', read_only: true,
  });
  assert.deepEqual([r.type, r.owner, r.company, r.project, r.where, r.openHref], ['Compliance', 'Jordan Reyes', NOT_RECORDED, 'Atlas Pilot', NOT_RECORDED, null]);
  assert.equal(scopedRow({ id: 'x', kind: 'ic_meeting', attendees: [] }).owner, NOT_RECORDED);
  const named = scopedRow({ id: 'y', kind: 'ic_meeting', owner: { name: 'Ada Example' }, company: { name: 'Northwind Labs' }, studio: { code: 'hq' }, open_href: '/companies/n' });
  assert.deepEqual([named.owner, named.company, named.studio, named.openHref], ['Ada Example', 'Northwind Labs', 'HQ-held', '/companies/n']);
  assert.ok(!Object.values(r).some((v) => typeof v === 'string' && v.includes('@')));
  assert.doesNotMatch(VIEW, /\.email\b/);
});

test('filters, the agenda by day and the month counts; an incomplete read never shows a 0 day', () => {
  const rows = [
    scopedRow({ id: 'a', kind: 'ic_meeting', title: 'Weekly sync', start_at: '2026-10-26T09:00:00', attendees: [{ name: 'Ada Example', role: 'founder' }] }),
    scopedRow({ id: 'b', kind: 'compliance_due', title: 'Tax', start_at: '2026-10-26T14:00:00', attendees: [{ name: 'Jordan Reyes', role: 'founder' }] }),
    scopedRow({ id: 'c', kind: 'learning', title: 'Webinar', start_at: '2026-10-27T16:00:00', attendees: [] }),
  ];
  assert.deepEqual(filterRows(rows, { type: 'compliance' }).map((r) => r.id), ['b']);
  assert.deepEqual(filterRows(rows, { person: 'ada' }).map((r) => r.id), ['a']);
  assert.deepEqual(byDay(rows).map((d) => [d.day, d.line]), [['2026-10-26', '2 items'], ['2026-10-27', '1 item']]);
  const from = new Date(2026, 9, 26); const to = new Date(2026, 9, 29);
  assert.deepEqual(dayCounts(rows, from, to, true).map((d) => d.line), ['2 items', '1 item', '0 items']);
  assert.deepEqual(dayCounts(rows, from, to, false).map((d) => d.line), ['2 items', '1 item', NOT_RECORDED]);
});

test('CA5: coverage and the empty scope say whether everyone answered', () => {
  assert.equal(coverageLine({ complete: true, studios: [] }, 'studio', BRANCH_ADMIN), 'Every company in Studio Lisbon answered.');
  assert.match(coverageLine({ complete: false, reason: 'Unreadable: some calendar sources could not be read. Try again.', studios: [{ name: 'Studio Berlin', ok: false }] }, 'platform', SUPER), /Not read: Studio Berlin\./);
  assert.equal(coverageLine(null, 'studio', BRANCH_ADMIN), 'Coverage not reported.');
  assert.equal(emptyLine('studio', BRANCH_ADMIN, true), 'Nothing in Studio Lisbon in this range. Every company answered.');
  assert.match(VIEW, /That is not the same as nothing being booked\./);
});
