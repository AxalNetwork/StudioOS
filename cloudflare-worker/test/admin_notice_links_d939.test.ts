/** D939: the two existing admin notification publishers use live Lab tabs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tabOf } from '../../frontend/src/pages/admin/lab/labModel.js';

test('application notices link Applications and week-outcome notices link Cohorts, with old sent links kept', () => {
  const apps = readFileSync('cloudflare-worker/src/services/cohortApplications.ts', 'utf8');
  const timing = readFileSync('cloudflare-worker/src/services/cohortTiming.ts', 'utf8');
  const appPublisher = apps.slice(apps.indexOf('async function notifyAdminsOnce('), apps.indexOf('// Cycle + assignment plumbing'));
  const weekPublisher = timing.slice(timing.indexOf('async function notifyAdmins('), timing.indexOf('// Deadline evaluation'));
  assert.match(appPublisher, /link: '\/admin\/programs\/spinout-lab\/applications'/);
  assert.match(weekPublisher, /link: '\/admin\/programs\/spinout-lab\/cohorts'/);
  assert.doesNotMatch(appPublisher + weekPublisher, /link: '\/admin\/spinout-lab'/);
  // The publishers use one link for both existing channels; no channel change.
  assert.match(weekPublisher, /channels: \['in_app', 'email'\]/);
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  for (const [publisher, tab] of [[appPublisher, 'applications'], [weekPublisher, 'cohorts']]) {
    const link = publisher.match(/link: '([^']+)'/)?.[1];
    assert.ok(link, `missing ${tab} notice link`);
    assert.ok(app.includes(`path="${link}"`), `${link} has no exact App route`);
    assert.equal(tabOf(link), tab, `${link} opens the wrong Lab tab`);
  }
});
