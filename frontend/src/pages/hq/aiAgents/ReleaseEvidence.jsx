/**
 * D4537 (#4537, step 3) — a From Axal skill's release evidence: whether the current draft can be published and why
 * (the server's `freshness`, the same decision the publish gate refuses on), what changed since the last approval,
 * what the evidence is made of, and the manifest each published version was released on. Read only.
 */
import React from 'react';
import { Card } from '../../../ui';
import { changeRows, evaluationLine, evidenceRows, readiness, versionRecord } from './releaseModel';

const H3 = 'text-[14px] font-bold text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const DT = 'text-[12px] font-semibold text-axal-ink dark:text-gray-200';
const DD = 'text-[12.5px] text-axal-muted dark:text-gray-400 font-mono';
const TONE = {
  ready: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  blocked: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  unknown: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};

function Rows({ rows, testid }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1" data-testid={testid}>
      {rows.map(([k, v]) => <React.Fragment key={k}><dt className={DT}>{k}</dt><dd className={DD}>{v}</dd></React.Fragment>)}
    </dl>
  );
}

export function ReleaseEvidence({ freshness, versions }) {
  const r = readiness(freshness);
  const changes = changeRows(freshness?.review);
  const evidence = evidenceRows(freshness?.evidence);
  const spent = freshness?.review?.released_version;
  return (
    <Card className="space-y-3 px-4 py-4" data-testid="hq-skill-release">
      <h3 className={H3}>Release evidence</h3>
      <div role="status" className={`rounded-lg border px-3 py-2 text-[13px] ${TONE[r.state]}`} data-testid="release-readiness" data-state={r.state}>
        <strong>{r.label}</strong>
        {r.reasons.length ? <ul className="mt-1 list-disc pl-5">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul> : null}
      </div>
      <p className={MUTED} data-testid="release-evaluation">Evaluation on the current evidence: {evaluationLine(freshness?.evaluation)}</p>
      {spent ? <p className={MUTED} data-testid="release-spent">The approval on this evidence already released v{spent}, so publishing again needs a new review.</p> : null}
      <section className="space-y-1">
        <h4 className={DT}>Since the last approval</h4>
        {changes ? <Rows rows={changes.map((c) => [c.label, c.text])} testid="release-changes" /> : <p className={MUTED} data-testid="release-changes-none">This skill has never been approved.</p>}
      </section>
      <section className="space-y-1">
        <h4 className={DT}>What the current evidence is made of</h4>
        {evidence ? <Rows rows={evidence} testid="release-evidence-rows" /> : <p className={MUTED}>Not recorded</p>}
      </section>
      <section className="space-y-2">
        <h4 className={DT}>Published versions</h4>
        {!versions?.length ? <p className={MUTED}>No version has been published.</p> : (
          <ol className="space-y-2" data-testid="release-versions">
            {[...versions].sort((a, b) => b.version - a.version).map((v) => {
              const rec = versionRecord(v);
              return (
                <li key={v.version} className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid="release-version" data-recorded={rec.recorded ? 'yes' : 'no'}>
                  <p className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{rec.head}</p>
                  {rec.lines.map((l) => <p key={l} className={MUTED}>{l}</p>)}
                  {rec.audited ? <p className="text-[12.5px] text-amber-800 dark:text-amber-300">{rec.audited}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </Card>
  );
}
