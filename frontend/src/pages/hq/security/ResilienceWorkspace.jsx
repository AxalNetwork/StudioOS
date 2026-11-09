import React, { useState } from 'react';
import { Unreadable } from '../../../ui';
import StatusBadge from './StatusBadge.jsx';
import {
  DRILL_RUNS_HREF, RUNBOOK_HREF, drillFacts, drillHeadline, heartbeatState, pipeline, sizeOf, whenOf,
} from './resilienceModel.js';

/**
 * D4803 (#4803, canvas SE09 Resilience, SE11e phone, SE10e/SE10i states) —
 * the Resilience workspace: "Backups exist; restore drills prove they can be
 * used."
 *
 *   triage       the restore drill leads, failed or not, with its state from
 *                the shared vocabulary and the step it stopped at
 *   evidence     the drill's facts (step, exit code, reason, duration, backup,
 *                recovery point, targets, record, next run) and the raw record
 *                behind a disclosure; the D1 export and the KV snapshot each
 *                as their own card, never a green light inferred from the other
 *   limits       KV has no restore drill (Unsupported); the drill record keeps
 *                only its latest run (Not instrumented)
 *   explanation  the previous zone's full detail, behind "How this is measured"
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground sm:min-h-[34px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const MARK = { done: '✓', failed: '✕', skipped: '–', unknown: '·' };
const MARK_TEXT = { done: 'done', failed: 'failed', skipped: 'not reached', unknown: 'not recorded' };

function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[170px_minmax(0,1fr)]">
      {rows.map(([k, v, mono]) => (
        <React.Fragment key={k}>
          <dt className="font-semibold text-axal-muted dark:text-gray-400">{k}</dt>
          <dd className={`min-w-0 break-words text-axal-ink dark:text-gray-100 ${mono ? 'font-mono text-[12px]' : ''}`}>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function DrillCard({ drill }) {
  const [raw, setRaw] = useState(false);
  const head = drillHeadline(drill);
  const steps = pipeline(drill);
  const facts = drillFacts(drill);
  const failed = head.state === 'failed';
  return (
    <section
      aria-labelledby="res-drill-h"
      className={`${CARD} flex flex-col gap-3 ${failed ? 'border-red-300 dark:border-red-900' : ''}`}
      data-testid="res-drill"
      data-state={head.state}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <StatusBadge state={head.state} />
          <h2 id="res-drill-h" className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-white">{head.title}</h2>
          {head.line && <p className="text-[12.5px] text-axal-muted dark:text-gray-300" data-testid="res-drill-line">{head.line}</p>}
        </div>
        <a href={RUNBOOK_HREF} target="_blank" rel="noreferrer" className={BTN} data-testid="res-runbook">Open runbook</a>
      </div>
      {drill?.available === true && drill.state !== 'never_run' && (
        <ol className="flex flex-wrap gap-2" aria-label="Drill steps" data-testid="res-pipeline">
          {steps.map((s) => (
            <li
              key={s.key}
              data-mark={s.mark}
              className={`rounded-md border px-2 py-1 text-[12px] font-semibold ${
                s.mark === 'failed' ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200'
                  : s.mark === 'done' ? 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'
                    : 'border-dashed border-axal-hairline text-axal-faint dark:border-gray-700 dark:text-gray-400'
              }`}
            >
              <span aria-hidden="true">{MARK[s.mark]} </span>{s.label}<span className="sr-only">: {MARK_TEXT[s.mark]}</span>
            </li>
          ))}
        </ol>
      )}
      {facts.length > 0 && <Facts rows={facts} />}
      {drill?.available === true && drill.at && (
        <div>
          <button type="button" className={BTN} aria-expanded={raw} aria-controls="res-drill-raw" onClick={() => setRaw((v) => !v)} data-testid="res-drill-raw-toggle">
            Raw drill record {raw ? '▴' : '▾'}
          </button>
          {raw && (
            <pre id="res-drill-raw" className="mt-2 max-h-72 overflow-auto rounded-lg border border-axal-hairline bg-axal-ground p-3 font-mono text-[11px] dark:border-gray-700 dark:bg-gray-950" data-testid="res-drill-raw">
              {JSON.stringify(drill, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

export function BackupCard({ hb }) {
  const s = heartbeatState(hb, 'D1 export');
  const rows = hb?.available
    ? [
      ['Latest D1 export', `${whenOf(hb.recovery_point) || 'Not recorded'}`],
      ['Size', sizeOf(hb.size_bytes) || 'Not recorded'],
      ['Runner', hb.source === 'gha' ? 'Scheduled export job (GitHub Actions)' : hb.source],
      ['Object', hb.key || 'Not recorded'],
      ['Freshness limit', `${hb.stale_after_hours} hours`],
    ]
    : [];
  return (
    <section aria-labelledby="res-backup-h" className={`${CARD} flex flex-col gap-2`} data-testid="res-backup" data-state={s.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="res-backup-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Backup evidence</h2>
        <StatusBadge state={s.state} label={s.label} />
      </div>
      {s.line && <p className="text-[12px] text-axal-muted dark:text-gray-300">{s.line}</p>}
      {rows.length > 0 && <Facts rows={rows} />}
      <p className="text-[12px] text-axal-faint dark:text-gray-400">A present export is evidence of a <b>backup</b>, not of a <b>restore</b>.</p>
    </section>
  );
}

export function KvCard({ hb }) {
  const s = heartbeatState(hb, 'KV snapshot');
  return (
    <section aria-labelledby="res-kv-h" className={`${CARD} flex flex-col gap-2`} data-testid="res-kv" data-state={s.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="res-kv-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">KV snapshots</h2>
        <StatusBadge state={s.state} label={s.label} />
      </div>
      {s.line && <p className="text-[12px] text-axal-muted dark:text-gray-300">{s.line}</p>}
      <Facts rows={[
        ...(hb?.available ? [['Latest', whenOf(hb.at) || 'Not recorded'], ['Runner', hb.source]] : []),
        ['Namespaces written', 'Not instrumented: the snapshot heartbeat does not count namespaces'],
        ['Restore drill', <StatusBadge key="u" state="unsupported" label="No drill for KV" />],
      ]} />
    </section>
  );
}

/**
 * The workspace. `block` is `/overview`'s `backup_dr`; `unreadable` when the
 * overview itself could not be read; `children` is the previous zone's full
 * detail, kept behind "How this is measured".
 */
export default function ResilienceWorkspace({ block, unreadable, onRetry, children }) {
  return (
    <div className="flex flex-col gap-4" data-testid="resilience-workspace">
      <div className="flex flex-col gap-1">
        <h2 className="text-[18px] font-extrabold tracking-tight text-axal-ink dark:text-white">Resilience</h2>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-300">Backups exist; restore drills prove they can be used.</p>
      </div>
      {unreadable ? (
        <Unreadable what="The backup and drill evidence" claim="This is not a claim that backups are healthy, or that a drill passed." onRetry={onRetry} />
      ) : (
        <>
          <DrillCard drill={block ? block.drill : null} />
          <div className="grid gap-4 md:grid-cols-2">
            <BackupCard hb={block ? block.backup : null} />
            <KvCard hb={block ? block.kv : null} />
          </div>
          <section aria-labelledby="res-history-h" className={`${CARD} flex flex-col gap-2`} data-testid="res-history">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="res-history-h" className="text-[14px] font-extrabold tracking-tight text-axal-ink dark:text-white">Drill history</h2>
              <StatusBadge state="not_instrumented" label="Latest run only" />
            </div>
            <p className="text-[12px] text-axal-muted dark:text-gray-300">
              The drill record keeps only its latest run, so earlier outcomes can&apos;t be listed here. Past runs are in the GitHub Actions log.
            </p>
            <a href={DRILL_RUNS_HREF} target="_blank" rel="noreferrer" className={`${BTN} self-start`}>Open drill workflow runs →</a>
          </section>
        </>
      )}
      {children && (
        <details className={`${CARD} text-[12px]`} data-testid="res-how">
          <summary className="cursor-pointer font-semibold text-axal-ink dark:text-gray-100">How this is measured</summary>
          <div className="mt-3">{children}</div>
        </details>
      )}
    </div>
  );
}
