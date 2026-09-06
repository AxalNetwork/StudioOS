import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill } from '../../ui';
import { api } from '../../lib/api';
import { NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading } from '../advisor/expertise/kit';
import ZoneActions from '../../workspaces/ZoneActions';

/**
 * Research · Diligence — the rooms you have been let into, and how far.
 *
 * NO NEW STORE, AND THAT IS THE FINDING. This zone's card used to defer to the
 * live `/due-diligence` tooling and call the overlap "a routing decision that
 * has not been made". Reading the canvas (Pages · Investor Research, IR2) against
 * the schema settles it: the artboard heads this table
 * `['Company','Scope','State','Deal stage','Founder activity']` over a "Rooms
 * granted" count, and all of that already exists — `data_room_grants` is the
 * grant, `data_room_files.visibility` is the scope the founder staged, and
 * `data_room_access_log` is the activity. It needed assembling, not a migration.
 *
 * SCOPE IS WHAT THEY STAGED, NOT WHAT YOU ASKED FOR, and the two numbers are
 * shown separately rather than as a percentage. The canvas's own reading is the
 * reason: a room that reads 6 of 11 is telling you the IP folder has survived
 * two asks. What is absent from a room is diligence information too, and a
 * ratio hides which rooms are thin.
 *
 * DEAL STAGE IS ON THE CANVAS AND IS NOT HERE. A grant is between a founder and
 * an investor; a deal is a separate record that may or may not exist for the
 * same company, and there is no key between them. Joining on a company name
 * would attach a stage to the wrong room, so the column is absent and says why.
 */

const day = (v) => {
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? String(v) : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function DiligenceZone({ zoneActions }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.research.diligence();
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e?.detail || e?.message || 'Room access did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const items = data?.items || [];

  return (
    <div className="space-y-6">
      {zoneActions && <ZoneActions className="mb-3" items={zoneActions(items)} />}
      <ZoneHeading
        title="Diligence pulls"
        sub="The rooms founders have opened to you, and how much of each they actually staged."
        right={data ? <Pill tone={data.granted_count ? 'ok' : 'neutral'}>{`${data.granted_count} rooms granted`}</Pill> : null}
      />

      <ZoneBody
        loading={state.loading}
        error={state.error}
        isEmpty={!items.length}
        onRetry={load}
        empty={(
          <NothingYet
            title="No founder has opened a room to you"
            body="A data room is opened by the founder, to a named investor. Nothing here requests one — an empty list means none is open, not that a request is pending."
          />
        )}
      >
        <Card padding="lg">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-extrabold tracking-tight">Room access</h3>
            <span className="text-[11px] text-gray-600 dark:text-gray-300">
              Scope is what they staged, not what was asked
            </span>
          </div>
          <ul className="divide-y divide-axal-ground dark:divide-gray-800">
            {items.map((r) => (
              <li key={r.grant_uid} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong className="text-[13px]">{r.project_name}</strong>
                  <span className="text-[12px] tabular-nums text-gray-700 dark:text-gray-300">
                    {`${r.file_open} of ${r.file_total} open to you`}
                  </span>
                  {r.withheld_behind_nda > 0 && (
                    <Pill tone="warn">{`${r.withheld_behind_nda} behind an NDA`}</Pill>
                  )}
                  <span className="ml-auto text-[11px] text-gray-600 dark:text-gray-300">
                    {r.last_opened_at
                      ? `You last opened it ${day(r.last_opened_at)}`
                      : <Unrecorded>You have not opened this room</Unrecorded>}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
                  {r.withheld_behind_nda > 0
                    ? 'A count, never the names. What is behind the NDA is not listed until one is active between you.'
                    : 'Everything in this room is open to you.'}
                  {r.expires_at ? ` Access expires ${day(r.expires_at)}.` : ''}
                </p>
                <p className="mt-1 text-[11px]">
                  <Link to="/raise/data-room" className="text-indigo-700 underline dark:text-indigo-300">Open the room →</Link>
                </p>
              </li>
            ))}
          </ul>
          {data?.deal_stage_note && (
            <p className="mt-3 border-t border-axal-ground pt-3 text-[11px] leading-relaxed text-gray-600 dark:border-gray-800 dark:text-gray-300">
              {data.deal_stage_note}
            </p>
          )}
        </Card>
      </ZoneBody>

      <StatedLimit title="What this page will not do">
        Nothing here asks a founder to open a room, or to stage more of one. The grant is
        theirs to make and theirs to revoke, and a request button that wrote nowhere would
        be worse than the conversation it replaced.
      </StatedLimit>
    </div>
  );
}
