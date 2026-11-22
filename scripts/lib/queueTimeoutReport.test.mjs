/** D5975: deterministic coverage, per-SHA deduplication and honest latency statistics from archived scorecards. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../queue-timeout-report.mjs';
const row = (id, minutes, patch={}) => ({ headSha: String(id).padStart(40,'0'), requestedAt: '2026-11-01T00:00:00Z', outcome: 'merged',
  lastRequired: minutes === null ? null : { name: 'full', completedAt: new Date(Date.parse('2026-11-01T00:00:00Z')+minutes*60000).toISOString(), waitMinutes: 10, runtimeMinutes: 1 }, ...patch });
const artifact = (rows, patch={}) => ({ window: { start: '2026-11-01T00:00:00Z', end: '2026-11-02T00:00:00Z' }, deadlineMinutes: 90, rows, ...patch });
test('latency percentiles use one SHA once and do not conflate merged with confirmed healthy', () => {
 const r=analyse([artifact([row(1,20),row(2,100),row(3,null,{outcome:'deadline-expired'})]), artifact([row(1,20)])]);
 assert.deepEqual(r.latency,{n:2,p50:20,p95:100,max:100});
 assert.equal(r.candidates,3); assert.equal(r.missingTimings,1);
 assert.deepEqual(r.mergedWithTiming,{n:2,laterThanDeadline:1});
 assert.equal(r.healthyCompletions.value,null);
 assert.deepEqual(r.confirmedExpiryRecords,{observedCandidates:3,expired:1});
 assert.equal(r.lastCheckWait.p50,10); assert.equal(r.lastCheckRuntime.max,1);
});
test('newer observation completes a pending candidate and overlapping windows do not create covered days',()=>{
 const a=artifact([row(1,null)]),b=artifact([row(1,40)],{window:{start:'2026-11-01T12:00:00Z',end:'2026-11-02T12:00:00Z'}});
 const r=analyse([a,b]); assert.equal(r.latency.n,1);assert.equal(r.latency.max,40);assert.equal(r.coverage.coveredDays,1.5);
 const gap=analyse([a,artifact([],{window:{start:'2026-11-03T00:00:00Z',end:'2026-11-04T00:00:00Z'}})]);
 assert.equal(gap.coverage.coveredDays,2);assert.equal(gap.coverage.gapDays,1);
});
test('missing timing/deadline stays unknown, and invalid identity or reversed times refuse',()=>{
 assert.deepEqual(analyse([]).latency,{n:0,p50:null,p95:null,max:null});
 assert.equal(analyse([artifact([row(1,100)],{deadlineMinutes:null})]).mergedWithTiming.laterThanDeadline,null);
 assert.throws(()=>analyse([artifact([row(1,10,{headSha:'bad'})])]),/identity/);
 assert.throws(()=>analyse([artifact([row(1,-1)])]),/predates/);
 assert.throws(()=>analyse([artifact([row(1,10)]),artifact([row(1,10,{requestedAt:'2026-11-01T01:00:00Z'})])]),/Conflicting/);
 assert.throws(()=>analyse([artifact([],{window:{start:'bad',end:'also bad'}})]),/window/);
});
