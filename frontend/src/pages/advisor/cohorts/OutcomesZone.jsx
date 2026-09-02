import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../../../ui';
import { spinoutLab } from '../../../lib/api';
import { NothingYet, Pill, Unrecorded, ZoneBody, ZoneHeading } from '../expertise/kit';
import { FromTheLab, StatedLimit } from './kit';

/**
 * Cohorts · Outcomes — how the program's companies ended up.
 *
 * THE CARD THIS REPLACES WAS FALSE ON TWO COUNTS. It said outcomes are the
 * Lab's "and it does not expose them", and that "there is no read path today".
 * `GET /api/spinout-lab/cohort` and `/graduates` are public, unauthenticated,
 * and carry a per-member status. Both claims stopped being true before this
 * bucket was ever written.
 *
 * IT IS THE PROGRAM VIEW, NOT "MY BATCH", AND IT SAYS SO. Those endpoints are
 * company-level and deliberately anonymous — no founder ids at all, by their
 * own header comment — so they cannot be narrowed to one advisor's cohort.
 * Showing the program and labelling it the program is honest; showing it under
 * a heading that implies the reader's own batch would not be. That framing is
 * the entire design of this page.
 *
 * NO AUTHORISATION IS NEEDED HERE, and that is a consequence worth stating
 * rather than hiding: this reads what any visitor to the marketing page reads.
 * It is on the Cohorts bucket because it is the outcome record an advisor
 * wants, not because it is private.
 */

const STATUS_TONE = { graduated: 'ok', active: 'info' };

function money(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function OutcomesZone() {
  const [state, setState] = useState({ loading: true, error: '', cohort: [], graduates: [] });

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      // Both are public and both answer `[]` rather than throwing on a missing
      // table, so a rejection here is a genuine transport failure — which is
      // why it becomes an error rather than an empty program.
      const [cohort, graduates] = await Promise.all([
        spinoutLab.cohort(),
        spinoutLab.graduates(),
      ]);
      setState({
        loading: false,
        error: '',
        cohort: Array.isArray(cohort) ? cohort : [],
        graduates: Array.isArray(graduates) ? graduates : [],
      });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The Lab’s outcome record could not be read.', cohort: [], graduates: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { cohort, graduates } = state;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="How the program's companies ended up"
        blurb="The Lab's own outcome record, across the whole program. Read-only, and written by the Lab — the practice never decides an outcome."
      />

      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={cohort.length === 0 && graduates.length === 0}
        empty={<NothingYet title="No companies recorded" body="The Lab has no active members or graduates on record." />}>
        <>
          {cohort.length > 0 && (
            <Card padding="none" className="overflow-x-auto">
              <div className="border-b border-axal-hairline px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3 dark:border-gray-700">
                In the program now — {cohort.length}
              </div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {cohort.map((c, i) => (
                    <tr key={`${c.name}-${i}`} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                      <td className="px-4 py-2.5 font-semibold">{c.name || <Unrecorded />}</td>
                      <td className="px-4 py-2.5 text-axal-ink-2">{c.sector || <Unrecorded />}</td>
                      <td className="px-4 py-2.5 text-axal-ink-3">{c.cohort || <Unrecorded />}</td>
                      <td className="px-4 py-2.5 tabular-nums text-axal-ink-3">
                        {c.week ? `Week ${c.week}` : <Unrecorded />}
                      </td>
                      <td className="px-4 py-2.5">
                        <Pill tone={STATUS_TONE[c.status] || 'neutral'}>{c.status || 'unknown'}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {graduates.length > 0 && (
            <Card padding="none" className="mt-3 overflow-x-auto">
              <div className="border-b border-axal-hairline px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3 dark:border-gray-700">
                Graduated — {graduates.length}
              </div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {graduates.map((g, i) => (
                    <tr key={`${g.uid || g.name}-${i}`} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                      <td className="px-4 py-2.5 font-semibold">{g.name || <Unrecorded />}</td>
                      <td className="px-4 py-2.5 text-axal-ink-2">{g.sector || <Unrecorded />}</td>
                      <td className="px-4 py-2.5 text-axal-ink-3">{g.cohort || <Unrecorded />}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {/* An unraised or unrecorded round is absent, not $0. */}
                        {money(g.raised) ?? <Unrecorded />}
                      </td>
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
            what any visitor to the public page sees. Your own batch is under Founders.
          </StatedLimit>
        </>
      </ZoneBody>
    </div>
  );
}
