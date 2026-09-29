/**
 * Admin · Profiling trends — `/admin/profiling-trends` (D358).
 *
 * How the profiling population moves over time, read from
 * GET /api/admin/profiling/trends (routes/admin_profiling.ts): archetype
 * distribution per role per month, displayed-archetype changes per month,
 * skill-axis coverage (self-rated vs evidence), and answers revised per month.
 *
 * COUNTS ONLY. The Worker returns no person — no id, name or timeline — and
 * hides every count under its small-cell minimum (5), with one more cell
 * hidden wherever a total would give the first away. A hidden cell is drawn
 * as "<5", never as 0; a month with no profile at all is drawn as "—".
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, Unreadable } from '../../ui';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

const PERSONA_LABEL = { founder: 'Founders', investor: 'Investors', partner: 'Partners', advisor: 'Advisors', coach: 'Coaches' };
const STATE_LABEL = {
  not_recorded: 'Not recorded',
  self_rated_only: 'Self-rated only',
  some_evidence: 'Some evidence',
  corroborated: 'Corroborated',
  evidence_only: 'Evidence only',
};
const RANGES = [6, 12, 24];

/** What one cell shows: its count, "<min" when hidden, "—" when there is no cell. */
export function cellText(cell, min) {
  if (!cell) return '—';
  if (cell.suppressed || cell.count == null) return `<${min}`;
  return String(cell.count);
}

export function shareText(share) {
  return typeof share === 'number' ? `${Math.round(share * 1000) / 10}%` : '—';
}

const TH = 'px-2 py-1.5 text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-faint';
const TD = 'px-2 py-1.5 text-[12px] tabular-nums text-axal-ink';

function Cell({ cell, min }) {
  const text = cellText(cell, min);
  const hidden = cell && (cell.suppressed || cell.count == null);
  return (
    <td className={TD} title={hidden ? `Fewer than ${min}, hidden so a small group cannot identify a person` : undefined}
      data-suppressed={hidden ? 'true' : undefined}>
      {text}
    </td>
  );
}

function Scroll({ children }) {
  return <div className="-mx-1 overflow-x-auto px-1">{children}</div>;
}

export function TrendsView({ data }) {
  const min = data.min_cell;
  const months = data.months || [];
  const personas = [...new Set((data.distribution || []).map((d) => d.persona))];
  const changePersonas = [...new Set((data.changes || []).map((c) => c.persona))];
  return (
    <div className="grid gap-4" data-testid="profiling-trends">
      <Card className="p-4" data-testid="trends-distribution">
        <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Displayed archetype, by role and month</h2>
        <p className="mt-1 text-[11.5px] text-axal-muted">Each profile’s displayed archetype at the end of the month.</p>
        {personas.length === 0 ? (
          <p className="mt-3 text-[12px] text-axal-muted" data-testid="trends-empty">No profile has been classified yet.</p>
        ) : personas.map((p) => {
          const rows = data.distribution.filter((d) => d.persona === p);
          const byMonth = Object.fromEntries(rows.map((r) => [r.month, r]));
          const archetypes = rows[0].archetypes.map((a) => ({ slug: a.slug, label: a.label }));
          return (
            <div key={p} className="mt-3">
              <h3 className="text-[12px] font-bold text-axal-ink">{PERSONA_LABEL[p] || p}</h3>
              <Scroll>
                <table className="mt-1 min-w-full">
                  <thead><tr><th className={TH}>Archetype</th>{months.map((m) => <th key={m} className={TH}>{m}</th>)}</tr></thead>
                  <tbody>
                    {archetypes.map((a) => (
                      <tr key={a.slug} className="border-t border-axal-hairline">
                        <td className={TD}>{a.label}</td>
                        {months.map((m) => <Cell key={m} min={min} cell={byMonth[m]?.archetypes.find((x) => x.slug === a.slug)} />)}
                      </tr>
                    ))}
                    <tr className="border-t border-axal-hairline font-semibold">
                      <td className={TD}>Profiles</td>
                      {months.map((m) => <Cell key={m} min={min} cell={byMonth[m]?.profiles} />)}
                    </tr>
                  </tbody>
                </table>
              </Scroll>
            </div>
          );
        })}
      </Card>

      <Card className="p-4" data-testid="trends-changes">
        <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Archetype changes, by month</h2>
        <p className="mt-1 text-[11.5px] text-axal-muted">
          Profiles whose displayed archetype changed, after the 14-day hold, and their share of that role’s profiles.
        </p>
        {changePersonas.length === 0 ? (
          <p className="mt-3 text-[12px] text-axal-muted">No displayed archetype has changed in this period.</p>
        ) : (
          <Scroll>
            <table className="mt-2 min-w-full">
              <thead><tr><th className={TH}>Role</th>{months.map((m) => <th key={m} className={TH}>{m}</th>)}</tr></thead>
              <tbody>
                {changePersonas.map((p) => (
                  <tr key={p} className="border-t border-axal-hairline">
                    <td className={TD}>{PERSONA_LABEL[p] || p}</td>
                    {months.map((m) => {
                      const c = data.changes.find((x) => x.persona === p && x.month === m);
                      return (
                        <td key={m} className={TD} data-suppressed={c && c.suppressed ? 'true' : undefined}>
                          {c ? `${cellText(c, min)}${c.share != null ? ` · ${shareText(c.share)}` : ''}` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Card>

      <Card className="p-4" data-testid="trends-skills">
        <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Skills: self-rated and shown on the platform</h2>
        <p className="mt-1 text-[11.5px] text-axal-muted">Each profile’s latest state per radar axis.</p>
        {(data.skills || []).length === 0 ? (
          <p className="mt-3 text-[12px] text-axal-muted">No skill axis has been recorded yet.</p>
        ) : (
          <Scroll>
            <table className="mt-2 min-w-full">
              <thead><tr><th className={TH}>Axis</th>{Object.keys(STATE_LABEL).map((s) => <th key={s} className={TH}>{STATE_LABEL[s]}</th>)}</tr></thead>
              <tbody>
                {data.skills.map((a) => (
                  <tr key={a.axis} className="border-t border-axal-hairline">
                    <td className={TD}>{a.label}</td>
                    {a.states.map((s) => <Cell key={s.state} min={min} cell={s} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Card>

      <Card className="p-4" data-testid="trends-revisions">
        <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Answers revised, by month</h2>
        <p className="mt-1 text-[11.5px] text-axal-muted">Profiling answers replaced by a newer one — a “still true?” re-ask, or a change of mind.</p>
        <Scroll>
          <table className="mt-2 min-w-full">
            <thead><tr>{months.map((m) => <th key={m} className={TH}>{m}</th>)}</tr></thead>
            <tbody><tr>{months.map((m) => <Cell key={m} min={min} cell={(data.revisions || []).find((r) => r.month === m)} />)}</tr></tbody>
          </table>
        </Scroll>
      </Card>
    </div>
  );
}

export default function AdminProfilingTrends() {
  const [months, setMonths] = useState(12);
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    setState({ status: 'loading', data: null });
    api.adminProfilingTrends(months)
      .then((d) => setState({ status: 'ready', data: d }))
      .catch((e) => { reportError('AdminProfilingTrends:read', e); setState({ status: 'unreadable', data: null }); });
  }, [months]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-extrabold tracking-tight text-axal-ink">Profiling trends</h1>
          <p className="mt-1 text-[12.5px] text-axal-muted">
            How archetypes, skills and answers shift as people use the platform. Counts only; groups under 5 are hidden.
          </p>
        </div>
        <label className="text-[12px] text-axal-muted">
          Period{' '}
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}
            className="ml-1 rounded border border-axal-hairline bg-transparent px-2 py-1 text-[12px] text-axal-ink">
            {RANGES.map((r) => <option key={r} value={r}>{r} months</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4">
        {state.status === 'loading' && <p className="text-[12px] text-axal-muted">Loading…</p>}
        {state.status === 'unreadable' && (
          <Unreadable what="Profiling trends" claim="Nothing is shown rather than a guess." onRetry={load} />
        )}
        {state.status === 'ready' && <TrendsView data={state.data} />}
      </div>
    </div>
  );
}
