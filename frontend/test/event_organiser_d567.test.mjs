import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import EventManagePage, { EventReadState } from '../src/pages/events/EventManagePage.jsx';
import MemberRegistrationPanel from '../src/components/events/MemberRegistrationPanel.jsx';
import { pageRows, recorded, registrationTab } from '../src/pages/events/eventOrganiserModel.js';
test('D567: recorded zero remains zero, absent facts explain why', () => {
  assert.equal(recorded(0, 'missing'), '0');
  assert.equal(recorded(null, 'decision not supplied'), 'Not recorded — decision not supplied');
});
test('D567: pending approval and all five tabs reflect stored registration state', () => {
  assert.deepEqual(['registered', 'confirmed', 'waitlisted', 'declined', 'cancelled'].map(status => registrationTab({ status }, true)), ['Pending', 'Approved', 'Waitlist', 'Declined', 'Cancelled']);
  assert.equal(registrationTab({ status: 'registered' }, false), 'Approved');
});
test('D567: search, sorting and page counts use observed rows and clamp stale pages', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ name: `Member ${i}`, role: 'founder' }));
  const p = pageRows(rows, 'founder', 2);
  assert.deepEqual([pageRows(rows, '', 1).end, pageRows(rows, '', 1).rows.length], [25, 25]);
  assert.equal(pageRows([{ name: 'Earlier', registered_at: '2026-01-01' }, { name: 'Later', registered_at: '2026-02-01' }], '', 1, 'newest').rows[0].name, 'Later');
  assert.deepEqual([p.start, p.end, p.total, p.rows.length], [26, 30, 30, 5]);
  assert.deepEqual(pageRows(rows, 'absent', 99).rows, []);
  assert.equal(pageRows(rows, 'Member 0', 99).current, 1);
  assert.equal(pageRows([{ name: 'Z' }, { name: 'A' }], '', 1, 'name').rows[0].name, 'A');
});
test('D567: read states never render stale children on loading, empty or failure', () => {
  const draw = props => renderToStaticMarkup(React.createElement(EventReadState, props, 'stale count 0'));
  assert.match(draw({ loading: true }), /Loading/);
  assert.match(draw({ error: 'Roster failed' }), /Unreadable — Roster failed/);
  assert.equal(draw({ error: 'Roster failed' }).includes('stale count 0'), false);
  assert.match(draw({ empty: true }), /No records yet/);
  assert.equal(draw({}), 'stale count 0');
});
test('D567: host and member initial screens expose loading rather than invented capacity', () => {
  const manage = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/events/1/manage/registrations'] }, React.createElement(EventManagePage)));
  assert.match(manage, /Loading/);
  assert.equal(manage.includes('0 /'), false);
  const member = renderToStaticMarkup(React.createElement(MemberRegistrationPanel, { eventId: 1 }));
  assert.match(member, /My registration/);
  assert.match(member, /Loading/);
  assert.equal(member.includes('not registered'), false);
});
test('D567: signed-in numeric member detail returns its WorkspaceShell content', async () => {
  const { AuthProvider } = await import('../src/hooks/useAuthSync.jsx');
  const { Routes, Route } = await import('react-router-dom');
  // Execute the real page with Vite's JSX transform and the browser's empty
  // build-time env. Checkout is outside this layout probe (paid routes are tested).
  const { readFileSync, existsSync, statSync } = await import('node:fs');
  const { transformWithOxc } = await import('vite');
  const pageUrl = new URL('../src/pages/events/PublicEventDetailPage.jsx', import.meta.url);
  let source = readFileSync(pageUrl, 'utf8').replace(/import\.meta\.env/g, '({})').replace(/import AxalCheckout[^;]+;/, 'const AxalCheckout = () => null;');
  source = source.replace(/from ['"]([^'"]+)['"]/g, (text, specifier) => {
    if (!specifier.startsWith('.')) return `from '${import.meta.resolve(specifier)}'`;
    let url = new URL(specifier, pageUrl);
    if (!existsSync(url) || !statSync(url).isFile()) for (const ext of ['.jsx', '.js']) { const candidate = new URL(url.href + ext); if (existsSync(candidate)) { url = candidate; break; } }
    return `from '${url.href}'`;
  });
  const transformed = await transformWithOxc(source, pageUrl.pathname, { jsx: { runtime: 'automatic' } });
  const code = transformed.code.replace(/from ['"]react\/jsx-runtime['"]/g, `from '${import.meta.resolve('react/jsx-runtime')}'`);
  const { default: PublicEventDetailPage, renderAgenda } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.match(renderToStaticMarkup(renderAgenda([])), /No agenda items yet/);
  assert.match(renderToStaticMarkup(renderAgenda([{ id: 1, title: 'Fixture agenda' }])), /Not recorded — start time is absent/);
  assert.match(renderToStaticMarkup(renderAgenda([{ id: 1, title: 'Fixture agenda' }])), /Not recorded — speaker is absent/);
  const storage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => key === 'user' ? JSON.stringify({ id: 2, role: 'founder' }) : null };
  try {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/events/1'] }, React.createElement(AuthProvider, null, React.createElement(Routes, null, React.createElement(Route, { path: '/events/:slug', element: React.createElement(PublicEventDetailPage) })))));
    assert.match(html, /My event/);
    assert.match(html, /Your registration and attendee agenda/);
    assert.match(html, /Loading event/);
  } finally { if (storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = storage; }
});
