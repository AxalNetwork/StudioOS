import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../../ui';
import { spinoutLab } from '../../../lib/api';
import { cohortFounderApi } from '../../../lib/api/advisorCohortFounder.js';
import { NothingYet, Pill, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { FromTheLab, NoBatch, StatedLimit } from './kit';
import { CohortLoading, useCohortRead, useCohortWorkspace } from './CohortWorkspace';
import {
  SCOPES, SCOPE_PARAM, SHOWCASE_LABEL, cohortFigures, completionTable, money, parseScope, programmeView,
} from './outcomesModel';

/**
 * Cohorts · Outcomes — two scopes, never mixed (D4813 board C10, package 4).
 *
 * THIS COHORT is the selected cohort's operational figures, each computed in
 * the Worker from the store that records it (`GET /me/cohort/:id/outcomes`):
 * participants, week completion per week, graduates (D4659's rule, the
 * `spinout_lab_graduates` view) and the mentoring sessions you held. Every
 * figure carries its definition, its source and when it was reported. A
 * figure whose read failed reads Not recorded, never 0; one whose read
 * stopped at its cap reads "n+". Past the enrolled count, every figure counts
 * only founders who share their progress with you.
 *
 * PROGRAMME OUTCOMES is the old page, kept as its own labelled scope: the
 * public, company-level and deliberately anonymous Lab endpoints, which cannot
 * be narrowed to one advisor's cohort. Its totals come from `/spinout-lab/stats`.
 * The graduate list and the live tracker are the public page's capped
 * SELECTIONS: each says so, and neither is ever presented as a total.
 *
 * NO AUTHORISATION IS NEEDED for the programme scope, and that is a
 * consequence worth stating rather than hiding: it reads what any visitor to
 * the marketing page reads.
 */

const STATUS_TONE = { graduated: 'ok', active: 'info' };
const TH = 'px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

/** The cohort scope, from the outcomes read. Exported so a test renders it. */
export function CohortOutcomes({ data, label, currentWeek = null, cohortEnded = false }) {
  const figures = cohortFigures(data, { currentWeek, cohortEnded });
  const table = completionTable(data);
  return (
    <section aria-labelledby="outcomes-cohort-h" data-testid="outcomes-cohort">
      <h2 id="outcomes-cohort-h" className="text-[13px] font-extrabold">{`Outcomes for ${label}`}</h2>
      <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4" data-testid="outcome-figures">
        {figures.map((f) => (
          <Card key={f.key} padding="md" data-metric={f.key}>
            <h3 className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{f.label}</h3>
            <p className={`mt-1 text-[22px] font-extrabold tabular-nums ${f.value === 'Not recorded' ? 'text-[14px] italic text-axal-faint' : ''}`} data-value={f.value}>{f.value}</p>
            {f.sub && <p className="text-[11.5px] text-axal-muted">{f.sub}</p>}
            <dl className="mt-2 text-[11px] leading-snug text-axal-faint">
              <dt className="sr-only">Definition</dt><dd>{f.definition || 'Definition not recorded'}</dd>
              <dt className="sr-only">Source</dt><dd>{`Source: ${f.source || 'not recorded'}`}</dd>
              <dt className="sr-only">Reported</dt><dd>{f.reported}</dd>
            </dl>
          </Card>
        ))}
      </div>

      <Card padding="none" className="mt-3 overflow-x-auto">
        {table == null ? (
          <p role="alert" className="px-4 py-3 text-[12px] text-red-700 dark:text-red-300">Week completion could not be read, so it reads Not recorded rather than zero.</p>
        ) : table.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-axal-muted">No week windows or week records for this cohort yet. That is not zero completion.</p>
        ) : (
          <table className="w-full text-[12.5px]" data-testid="completion-table">
            <caption className="px-3 pt-2.5 text-left text-[11px] text-axal-faint">
              {`Milestone completion by week, ${label}${data?.metrics?.week_completion?.truncated ? ' (the read stopped at its cap; figures are at least these)' : ''}`}
            </caption>
            <thead>
              <tr className="border-b border-axal-hairline dark:border-gray-700">
                {['Week', 'Passed', 'Grace', 'Failed', 'In progress', 'Not assessed', 'Founders'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.week} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">{`Week ${r.week}`}</th>
                  <td className="px-3 py-2 tabular-nums">{r.passed}</td>
                  <td className="px-3 py-2 tabular-nums">{r.grace}</td>
                  <td className="px-3 py-2 tabular-nums">{r.failed}</td>
                  <td className="px-3 py-2 tabular-nums">{r.pending}</td>
                  <td className="px-3 py-2 tabular-nums">{r.not_assessed}</td>
                  <td className="px-3 py-2 tabular-nums">{r.founders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-2 text-[11px] text-axal-faint">
        Programme outcomes are company-level and anonymous across every cohort. They are a separate scope and are never mixed into these numbers.
      </p>
    </section>
  );
}

/** The programme scope, from the public endpoints. Exported so a test renders it. */
export function ProgrammeOutcomes({ stats, cohort, graduates }) {
  const v = programmeView({ stats, cohort, graduates });
  return (
    <section aria-labelledby="outcomes-programme-h" data-testid="outcomes-programme">
      <h2 id="outcomes-programme-h" className="text-[13px] font-extrabold">Programme outcomes · every cohort</h2>
      <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-testid="programme-totals">
        {v.totals.map((t) => (
          <Card key={t.key} padding="md">
            <h3 className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{t.label}</h3>
            <p className="mt-1 text-[20px] font-extrabold tabular-nums">{t.value}</p>
          </Card>
        ))}
      </div>

      {v.active.length > 0 && (
        <Card padding="none" className="mt-3 overflow-x-auto">
          <h3 className="border-b border-axal-hairline px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint dark:border-gray-700">
            {v.activeHeading}
          </h3>
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">{`Companies on the public tracker, ${SHOWCASE_LABEL.toLowerCase()}`}</caption>
            <tbody>
              {v.active.map((c, i) => (
                <tr key={`${c.name}-${i}`} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                  <td className="px-4 py-2.5 font-semibold">{c.name || <Unrecorded />}</td>
                  <td className="px-4 py-2.5 text-axal-muted">{c.sector || <Unrecorded />}</td>
                  <td className="px-4 py-2.5 text-axal-faint">{c.cohort || <Unrecorded />}</td>
                  <td className="px-4 py-2.5 tabular-nums text-axal-faint">{c.week ? `Week ${c.week}` : <Unrecorded />}</td>
                  <td className="px-4 py-2.5"><Pill tone={STATUS_TONE[c.status] || 'neutral'}>{c.status || 'unknown'}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {v.graduates.length > 0 && (
        <Card padding="none" className="mt-3 overflow-x-auto" data-testid="graduate-showcase">
          <h3 className="border-b border-axal-hairline px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint dark:border-gray-700">
            {v.graduatesHeading}
          </h3>
          <p className="px-4 pt-2 text-[11.5px] text-axal-muted">{v.graduatesNote(v.graduates.length)}</p>
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">{`Graduate companies, ${SHOWCASE_LABEL.toLowerCase()}`}</caption>
            <tbody>
              {v.graduates.map((g, i) => (
                <tr key={`${g.uid || g.name}-${i}`} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                  <td className="px-4 py-2.5 font-semibold">{g.name || <Unrecorded />}</td>
                  <td className="px-4 py-2.5 text-axal-muted">{g.sector || <Unrecorded />}</td>
                  <td className="px-4 py-2.5 text-axal-faint">{g.cohort || <Unrecorded />}</td>
                  {/* An unraised or unrecorded round is absent, not $0. */}
                  <td className="px-4 py-2.5 tabular-nums">{money(g.raised) ?? <Unrecorded />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-3"><FromTheLab>read-only — these are the Lab’s own records about its companies</FromTheLab></div>
      <StatedLimit title="This is the program, not your batch">
        The Lab publishes these company-level and deliberately anonymous — no founder ids at
        all — so they cannot be narrowed to the cohort you were assigned. Everything here is
        what any visitor to the public page sees. The two lists are the public page&apos;s
        selections, not totals. Your own cohort is under This cohort.
      </StatedLimit>
    </section>
  );
}

function ProgrammeScope() {
  const [state, setState] = useState({ loading: true, error: '', stats: null, cohort: [], graduates: [] });
  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      // All public. D4661: a read the Worker could not make is a 503, never
      // `[]`, so a rejection here is a failed read with a retry.
      const [cohort, graduates, stats] = await Promise.all([
        spinoutLab.cohort(),
        spinoutLab.graduates(),
        spinoutLab.stats().catch(() => null),
      ]);
      setState({
        loading: false, error: '', stats,
        cohort: Array.isArray(cohort) ? cohort : [],
        graduates: Array.isArray(graduates) ? graduates : [],
      });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The Lab’s outcome record could not be read.', stats: null, cohort: [], graduates: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <ZoneBody loading={state.loading} error={state.error} onRetry={load}
      isEmpty={state.cohort.length === 0 && state.graduates.length === 0 && !state.stats}
      empty={<NothingYet title="No companies recorded" body="The Lab has no active members or graduates on record." />}>
      <ProgrammeOutcomes stats={state.stats} cohort={state.cohort} graduates={state.graduates} />
    </ZoneBody>
  );
}

function CohortScope() {
  const ws = useCohortWorkspace();
  const read = useCohortRead((id) => cohortFounderApi.outcomes(id),
    { fallbackError: 'This cohort’s outcomes could not be read.' });
  const label = ws.label || 'this cohort';
  const ended = Date.parse(ws.current?.cohort?.end_at || '') < Date.now();
  if (ws.preview) {
    return <p className="text-[12px] text-axal-muted">Appears here for an assigned advisor: the cohort&apos;s participants, week completion, graduates and sessions held.</p>;
  }
  return (
    <ZoneBody loading={ws.assignments.loading} error={ws.assignments.error} onRetry={ws.reloadAssignments}
      isEmpty={ws.assignments.items.length === 0} empty={<NoBatch />}>
      {read.loading && <CohortLoading what="outcomes" />}
      <ZoneBody loading={read.loading} error={read.error} onRetry={read.reload} isEmpty={false}>
        {read.data && <CohortOutcomes data={read.data} label={label} currentWeek={ws.weeks.data?.current_week ?? null} cohortEnded={ended} />}
      </ZoneBody>
    </ZoneBody>
  );
}

export default function OutcomesZone() {
  const [params, setParams] = useSearchParams();
  const scope = parseScope(params.get(SCOPE_PARAM));
  const choose = (k) => {
    const next = new URLSearchParams(params);
    if (k === 'cohort') next.delete(SCOPE_PARAM); else next.set(SCOPE_PARAM, k);
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Outcomes"
        blurb="Your cohort's figures from the Lab's records, and the programme's public outcomes as a separate scope. Read-only: the Lab decides every outcome."
      />
      <div role="radiogroup" aria-label="Outcome scope" className="flex flex-wrap gap-1" data-testid="outcome-scope">
        {SCOPES.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={scope === k} onClick={() => choose(k)}
            className={`min-h-[44px] rounded-lg border px-3 text-[12px] font-bold lg:min-h-[34px] ${scope === k
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-300'}`}>
            {l}
          </button>
        ))}
      </div>
      {scope === 'programme' ? <ProgrammeScope /> : <CohortScope />}
    </div>
  );
}
