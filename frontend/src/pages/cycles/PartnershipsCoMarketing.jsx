/**
 * D6118 (#6118, GR-09) — Partnerships' co-marketing, a part of the one Partnerships page.
 *
 * `/grow/partnerships` is the partner-network module page (partners by stage, their
 * revenue and terms). This part draws the venture's co-marketing under the partner
 * table: the pitches its partners proposed and the attribution events that link them
 * to this venture, from the founder-side read `GET /comarketing/founder/by-project/:id`
 * (never the partner-only `/me/pitches`, which refuses every founder).
 *
 * The four filters are the persisted pitch statuses (D613), not contract stages. The
 * section never infers signed value, partner delivery or referrals from a pitch: a
 * figure it has no record of reads "Not recorded", and a read that failed reads
 * "Unreadable" with a retry (#5129). The pitches themselves are written in the
 * co-marketing workspace, one link away.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { NOT_RECORDED, text, titleCase } from '../../lib/absence';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';

export const UNREADABLE = 'Unreadable';
export const CO_MARKETING_WORKSPACE = '/grow/partner-network/co-marketing';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const dateLabel = (value) => {
  if (!value) return NOT_RECORDED;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const linked = (row, projectId) => projectId != null && row != null
  && [row.project_id, row.projectId].some((value) => value != null && String(value) === String(projectId));

// D613: these are the persisted co-marketing pitch statuses, not contract stages.
const VIEW_STATUSES = {
  signed: ['approved', 'published'],
  'in-motion': ['proposed'],
  dormant: ['rejected', 'withdrawn'],
};

/** The four views over the pitches, and how many each holds. */
export function partnershipViews(pitches) {
  const rows = { all: pitches };
  for (const [view, statuses] of Object.entries(VIEW_STATUSES)) {
    rows[view] = pitches.filter((row) => statuses.includes(String(row.status || row.state || '').toLowerCase()));
  }
  return { rows, counts: Object.fromEntries(Object.entries(rows).map(([view, items]) => [view, items.length])) };
}

/** The zone's filters, each labelled with its count. */
export function partnershipFilters(view, onChange, counts) {
  return founderZoneFilters('grow/partnerships', { value: view, onChange }).map((filter) => ({
    ...filter, label: `${filter.label} (${counts[filter.testid.replace('filter-partnerships-', '')]})`,
  }));
}

/**
 * The founder-side read narrowed to this venture: its attributions, and the pitches
 * those attributions name. Pure, so a test can check it without a network.
 */
export function coMarketingFor(read, projectId) {
  const attributions = list(read, 'attributions').filter((row) => linked(row, projectId));
  const ids = new Set(attributions.map((row) => String(row.pitch_id ?? '')).filter(Boolean));
  const pitches = list(read, 'pitches').filter((row) => ids.has(String(row.id)));
  return { pitches, attributions };
}

export default function PartnershipsCoMarketing({ projectId }) {
  const [state, setState] = useState({ status: projectId ? 'loading' : 'none', pitches: [], attributions: [] });
  const [view, setView] = useState('all');

  const load = useCallback(() => {
    if (!projectId) { setState({ status: 'none', pitches: [], attributions: [] }); return () => {}; }
    let alive = true;
    setState((old) => ({ ...old, status: 'loading' }));
    api.founderCoMarketing(projectId)
      .then((read) => { if (alive) setState({ status: 'ready', ...coMarketingFor(read, projectId) }); })
      .catch(() => { if (alive) setState({ status: 'failed', pitches: [], attributions: [] }); });
    return () => { alive = false; };
  }, [projectId]);
  useEffect(() => load(), [load]);

  return (
    <CoMarketingSection projectId={projectId} state={state} view={view} setView={setView} onRetry={load} />
  );
}

/** The section itself, from a settled state: what a test renders. */
export function CoMarketingSection({ projectId, state, view = 'all', setView = () => {}, onRetry }) {
  const { status, pitches, attributions } = state;
  const { rows, counts } = useMemo(() => partnershipViews(pitches), [pitches]);
  const visible = rows[view] || rows.all;
  const query = projectId != null ? `?project_id=${encodeURIComponent(projectId)}` : '';
  const workspace = CO_MARKETING_WORKSPACE + query;
  const readable = status === 'ready';
  return (
    <section id="co-marketing" aria-labelledby="co-marketing-title" data-testid="partnerships-co-marketing"
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="co-marketing-title" className="m-0 flex items-center gap-1.5 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">
          <Handshake size={15} aria-hidden="true" /> Co-marketing
        </h2>
        <Link to={workspace} data-testid="link-partnerships-co-marketing"
          className="text-[12.5px] font-semibold text-axal-violet underline-offset-2 hover:underline dark:text-violet-300">Open co-marketing →</Link>
      </div>
      <p className="m-0 text-[12.5px] leading-relaxed text-axal-muted dark:text-gray-400">
        Pitches your partners proposed for this venture, and what each has delivered so far.
      </p>
      {readable && (
        <ZoneToolbar
          filters={partnershipFilters(view, setView, counts)}
          actions={founderZoneActions('grow/partnerships', { query, view: { scope: 'Co-marketing', header: ['Partner', 'Type', 'Status', 'State', 'Created'], rows: visible, cells: (r) => [r.title, r.type, r.status, r.state, r.created_at] } })}
        />
      )}
      {status === 'loading' && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="status-co-marketing-loading">Reading co-marketing…</p>}
      {status === 'none' && <Absent title="No venture selected." body="Co-marketing is read for one venture at a time." />}
      {status === 'failed' && (
        <div role="status" className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-axal-ink dark:text-gray-200" data-testid="status-co-marketing-unreadable">
          <b>{UNREADABLE}.</b><span>The co-marketing read failed; nothing is shown in its place.</span>
          {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"><RefreshCw size={12} aria-hidden="true" /> Retry</button>}
        </div>
      )}
      {readable && (visible.length
        ? <PitchTable rows={visible} attributions={attributions} />
        : <Absent title={pitches.length ? 'No pitch matches this filter.' : 'No co-marketing pitch is recorded for this venture.'}
          body="Partner delivery, signed value and referrals are not inferred from a pitch." />)}
      <p className="m-0 text-[11px] text-axal-muted dark:text-gray-500" data-testid="text-co-marketing-source">
        Source: co-marketing pitches and attributions{readable ? ` · ${attributions.length} attribution event${attributions.length === 1 ? '' : 's'}` : ''}
      </p>
    </section>
  );
}

function PitchTable({ rows, attributions }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-[12.5px]">
        <thead><tr className="text-[11px] uppercase tracking-wide text-axal-muted dark:text-gray-400">
          <th className="py-1.5 pr-3 font-semibold">Partner</th><th className="py-1.5 pr-3 font-semibold">Type</th>
          <th className="py-1.5 pr-3 font-semibold">State</th><th className="py-1.5 font-semibold">Delivered so far</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => {
          const delivered = attributions.filter((item) => String(item.pitch_id) === String(row.id));
          const kinds = [...new Set(delivered.map((item) => text(item.event_kind, 'event')))];
          return (
            <tr key={row.id || row.uid || index} className="border-t border-axal-hairline align-top dark:border-gray-800">
              <td className="py-2 pr-3"><b className="text-axal-ink dark:text-gray-100">{text(row.partner_name || row.partner || row.name || row.title)}</b>
                <small className="block text-axal-muted dark:text-gray-400">Recorded {dateLabel(row.created_at)}</small></td>
              <td className="py-2 pr-3">{text(row.asset_type || row.partnership_type || row.type || row.kind)}</td>
              <td className="py-2 pr-3">{titleCase(row.status || row.state) || NOT_RECORDED}</td>
              <td className="py-2">{delivered.length ? `${delivered.length} attribution event${delivered.length === 1 ? '' : 's'} · ${kinds.join(', ')}` : NOT_RECORDED}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function Absent({ title, body }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-axal-hairline px-3 py-2.5 text-[12.5px] dark:border-gray-800">
      <Handshake size={15} aria-hidden="true" className="mt-0.5 text-axal-muted" />
      <div><b className="text-axal-ink dark:text-gray-100">{title}</b><p className="m-0 text-axal-muted dark:text-gray-400">{body}</p></div>
    </div>
  );
}
