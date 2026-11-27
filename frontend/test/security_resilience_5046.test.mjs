/**
 * #5046 — HQ Security › Resilience reads at a glance: the failed restore drill
 * leads, backup evidence is fresh and humanised with its exact bytes beside it,
 * failover is Unsupported (never "Not recorded"), its implementation detail is
 * behind a disclosure, and only links the record supports are drawn.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import {
  BACKUP_RUNS_HREF, FAILOVER_ITEM, drillRunHref, exactBytes, exportAge, failoverOf, heartbeatState, otherNotRecorded,
} from '../src/pages/hq/security/resilienceModel.js';
import ResilienceWorkspace, { FailoverCard } from '../src/pages/hq/security/ResilienceWorkspace.jsx';
import { SecurityConsole } from '../src/pages/hq/SecurityPage.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

// The server's own wording (admin_security.ts DR_NOT_RECORDED).
const FAILOVER = { what: 'Failover test', reason: 'No standby exists to fail over to: HQ runs on one Worker and one D1 database, and no failover exercise is run or written anywhere.' };
const OTHER = { what: 'Off-site copy count', reason: 'Synthetic second absence.' };
const FAILED = { available: true, state: 'last_run_failed', at: '2026-11-01T12:42:00Z', age_days: 8, fresh: true, stale_after_days: 35,
  step: 'restore', exit_code: 2, run_id: '19123456789' };
const HB = (over = {}) => ({ available: true, fresh: true, age_hours: 3.4, stale_after_hours: 26, at: '2026-11-08T08:54:00Z',
  recovery_point: '2026-11-08T08:54:00Z', size_bytes: 290_880_712, source: 'gha', key: 'd1/2026-11-08.sql.gz', ...over });
const BLOCK = (over = {}) => ({ backup: HB(), kv: HB({ source: 'cron' }), drill: FAILED, not_recorded: [FAILOVER, OTHER], ...over });

test('#5046 model: humanised size keeps its exact bytes, age is read, never guessed', () => {
  assert.equal(exactBytes(290_880_712), '290,880,712 bytes');
  assert.equal(exactBytes(0), null); assert.equal(exactBytes('290'), null);
  assert.equal(exportAge(HB()), '3 hours ago');
  assert.equal(exportAge(HB({ age_hours: 1 })), '1 hour ago');
  assert.equal(exportAge(HB({ age_hours: 0.2 })), 'less than an hour ago');
  assert.equal(exportAge(HB({ age_hours: undefined })), null);
  assert.equal(exportAge({ available: false }), null);
  assert.equal(heartbeatState(HB()).label, 'Fresh · 3 hours ago');
  assert.equal(heartbeatState(HB({ fresh: false, age_hours: 50.7 })).label, 'Stale · 50 hours ago');
});

test('#5046 model: a drill run is linked only when the record names one', () => {
  assert.equal(drillRunHref(FAILED), 'https://github.com/AxalNetwork/StudioOS/actions/runs/19123456789');
  assert.equal(drillRunHref({ ...FAILED, run_id: 42 }), 'https://github.com/AxalNetwork/StudioOS/actions/runs/42');
  for (const bad of [undefined, null, '', 'abc', '1/../2', -1, 1.5]) assert.equal(drillRunHref({ ...FAILED, run_id: bad }), null, String(bad));
  assert.equal(drillRunHref({ available: false, run_id: '1' }), null);
});

test('#5046 model: failover is Unsupported with the server reason as detail; the other absences stay listed', () => {
  const f = failoverOf(BLOCK());
  assert.deepEqual([f.state, f.label], ['unsupported', 'Not supported']);
  assert.match(f.line, /No standby environment is configured/);
  assert.equal(f.detail, FAILOVER.reason);
  // Even without the server's item, the capability is still absent: Unsupported, with no invented detail.
  assert.deepEqual([failoverOf({ not_recorded: [] }).state, failoverOf({}).detail], ['unsupported', null]);
  assert.deepEqual(otherNotRecorded(BLOCK()), [OTHER]);
  assert.equal(FAILOVER_ITEM, FAILOVER.what);
});

test('#5046 render: drill leads, then backup and KV, then failover; failure is a word and a shape, not colour alone', () => {
  const out = html(h(ResilienceWorkspace, { block: BLOCK() }));
  const at = (id) => out.indexOf(`data-testid="${id}"`);
  assert.ok(at('res-drill') < at('res-backup') && at('res-backup') < at('res-failover'), 'order: drill, backup, failover');
  assert.match(out, /data-testid="res-drill" data-state="failed"/);
  const t = renderedText(out);
  assert.match(t, /Failed/); // the badge's word, not only a red border
  assert.match(t, /Restore drill failed at the restore step/);
  assert.match(t, /290\.9 MB \(290,880,712 bytes\)/);
  assert.match(t, /3 hours ago/);
  assert.match(out, /data-testid="res-failover" data-state="unsupported"/);
  assert.match(t, /Not supported/);
  assert.match(t, /No standby environment is configured/);
  assert.doesNotMatch(renderedText(html(h(FailoverCard, { block: BLOCK() }))), /Not recorded/);
  // The implementation paragraph is behind "Technical details", not in the scan path.
  assert.match(out, /<details[^>]*data-testid="res-failover-detail"><summary[^>]*>Technical details<\/summary>/);
  // Only links the record supports: the drill run named by the record, the runbook, the export job.
  assert.match(out, /href="https:\/\/github.com\/AxalNetwork\/StudioOS\/actions\/runs\/19123456789"[^>]*data-testid="res-drill-run"/);
  assert.ok(out.includes(`href="${BACKUP_RUNS_HREF}"`));
  assert.doesNotMatch(html(h(ResilienceWorkspace, { block: BLOCK({ drill: { ...FAILED, run_id: undefined } }) })), /res-drill-run/);
});

test('#5046 page: the old caption is gone and failover is no longer listed as "Not recorded" behind the disclosure', () => {
  const page = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/admin/security?tab=resilience'] },
    h(SecurityConsole, { tab: 'resilience', data: { backup_dr: BLOCK() }, load: () => {}, feed: null, filter: 'all', setFilter: () => {},
      loadFeed: () => {}, sessionList: null, loadSessions: () => {}, onSessionAct: async () => ({}) })));
  assert.doesNotMatch(page, /two facts, each its own state/);
  const listed = /data-testid="hq-dr-not-recorded"[\s\S]*?<\/ul>/.exec(page)?.[0] ?? '';
  assert.match(listed, /Off-site copy count/, 'the other absences are still listed');
  assert.doesNotMatch(listed, /Failover test/, 'failover is drawn as Unsupported above, not "Not recorded" here');
  assert.match(page, /data-testid="res-failover" data-state="unsupported"/);
});
