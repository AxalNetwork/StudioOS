import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'frontend/src');
const sidebar = readFileSync(resolve(root, 'sidebarConfig.js'), 'utf8');
const app = readFileSync(resolve(root, 'App.jsx'), 'utf8');

test('Calendar and Events are not present as standalone sidebar items', () => {
  assert.doesNotMatch(sidebar, /to:\s*['"]\/calendar['"][^}]*label:\s*['"]Calendar['"]/);
  assert.doesNotMatch(sidebar, /to:\s*['"]\/my\/events['"][^}]*label:\s*['"]Events['"]/);
  assert.doesNotMatch(sidebar, /to:\s*['"]\/articles\/draft['"][^}]*label:\s*['"]Articles['"]/);
});

test('Calendar, Events, and Articles appear in the user dropdown before Support', () => {
  const trustIndex = app.indexOf('to="/trust"');
  const calendarIndex = app.indexOf('to="/calendar"');
  const eventsIndex = app.indexOf('to="/my/events"');
  const articlesIndex = app.indexOf('to="/articles/draft"');
  const supportIndex = app.indexOf('to="/tickets"');

  assert.ok(trustIndex >= 0, 'Trust Center menu item should exist');
  assert.ok(calendarIndex > trustIndex, 'Calendar should follow Trust Center');
  assert.ok(eventsIndex > calendarIndex, 'Events should follow Calendar');
  assert.ok(articlesIndex > eventsIndex, 'Articles should follow Events');
  assert.ok(supportIndex > articlesIndex, 'Support should follow Articles');
});