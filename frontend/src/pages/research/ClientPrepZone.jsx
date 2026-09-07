import React, { useCallback, useEffect, useState } from 'react';
import { Card, Pill } from '../../ui';
import { api } from '../../lib/api';
import { NothingYet, StatedLimit, Unrecorded, ZoneBody, ZoneHeading } from '../advisor/expertise/kit';
import { SeamChip } from '../../workspaces/WorkspaceShell';
import ZoneActions from '../../workspaces/ZoneActions';

/**
 * Research · Client prep — the brief, with both sides in it.
 *
 * THIS ZONE WAS A REFUSAL UNTIL MIGRATION 218, and the refusal was accurate:
 * half a brief existed — the topic and the questions the client wrote when they
 * asked for the session — and the other half was the client's own record, which
 * `canAccessFounderResource` closes to an advisor by rule. Task #55 is the
 * grant that opens it, under the founder's own hand and scope by scope.
 *
 * ONE CLIENT PER BRIEF, chosen explicitly. The canvas is emphatic —
 * "context changes only through the switcher, never implicitly" — so this page
 * lists what is open to you and you pick one. It never guesses, and it never
 * merges two clients into one view.
 *
 * PROVENANCE IS ON EVERY ROW. The canvas puts it plainly: "Cyan is theirs,
 * emerald is mine." A fact the client recorded and a note the advisor wrote are
 * different evidence, and a brief that renders them alike is how an advisor
 * quotes their own assumption back at a client as if the client had said it.
 * Founder-sourced rows carry the seam chip and are read-only here.
 *
 * THE BRIEF SAYS WHAT IT IS MISSING. A grant carries three scopes and a founder
 * may open one and not the others. The worker returns `withheld` naming each
 * scope it did not read, and this page prints it — because a brief that looked
 * complete while missing the half it was not granted is exactly the failure the
 * old card warned about.
 *
 * AND IT DOES NOT INFER. The canvas's own example is the one to keep: the
 * client's ACV reads "Not recorded" rather than being derived from deals they
 * mentioned, "because a number I inferred and then quoted back at them is the
 * fastest way to lose a session's first ten minutes."
 */

const FILTERS = [
  ['all', 'Full brief'],
  ['mine', 'Mine only'],
  ['client', 'Founder-sourced'],
];

export default function ClientPrepZone({ zoneActions, role = 'advisor' }) {
  const [inbox, setInbox] = useState({ loading: true, error: null, items: [] });
  const [chosen, setChosen] = useState(null);
  const [brief, setBrief] = useState({ loading: false, error: null, data: null });
  const [filter, setFilter] = useState('all');

  const loadInbox = useCallback(async () => {
    setInbox((s) => ({ ...s, loading: true }));
    try {
      const res = await api.advisorClientsSharedWithMe();
      const items = res?.items || [];
      setInbox({ loading: false, error: null, items });
      setChosen((c) => c || items[0]?.project_uid || null);
    } catch (e) {
      setInbox({ loading: false, error: e?.detail || e?.message || 'The client list did not load.', items: [] });
    }
  }, []);
  useEffect(() => { loadInbox(); }, [loadInbox]);

  useEffect(() => {
    if (!chosen) { setBrief({ loading: false, error: null, data: null }); return undefined; }
    let alive = true;
    setBrief({ loading: true, error: null, data: null });
    api.advisorClientBrief(chosen)
      .then((data) => { if (alive) setBrief({ loading: false, error: null, data }); })
      .catch((e) => {
        if (alive) setBrief({ loading: false, error: e?.detail || e?.message || 'That brief did not load.', data: null });
      });
    return () => { alive = false; };
  }, [chosen]);

  const data = brief.data;
  const rows = buildRows(data);
  const visible = rows.filter((r) => (filter === 'all' ? true : r.source === filter));
  const clientRows = rows.filter((r) => r.source === 'client').length;
  const active = inbox.items.find((i) => i.project_uid === chosen);

  return (
    <div className="space-y-6">
      {zoneActions && <ZoneActions className="mb-3" items={zoneActions(visible)} />}
      <ZoneHeading
        title={active ? `Session brief — ${active.project_name}` : 'Client prep'}
        sub="One client per brief. Founder-sourced rows are read-only."
        right={data ? <Pill tone={clientRows ? 'ok' : 'neutral'}>{`${clientRows} founder-sourced`}</Pill> : null}
      />

      <ZoneBody
        loading={inbox.loading}
        error={inbox.error}
        isEmpty={!inbox.items.length}
        onRetry={loadInbox}
        empty={(
          <NothingYet
            title="No client has opened their record to you"
            body={role === 'partner'
              ? 'A client brief is assembled from a record the founder opens to a named reader. Nothing here requests one — an empty list means none is open, not that a request is pending.'
              : 'A founder opens their record to you by name, and chooses how much of it. Until one does, the half of a brief you already hold is on Practice · Sessions: what the client wrote when they asked for the session.'}
          />
        )}
      >
        {/* The switcher. Context changes here and nowhere implicitly. */}
        {inbox.items.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {inbox.items.map((i) => (
              <button
                key={i.project_uid}
                type="button"
                onClick={() => setChosen(i.project_uid)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  chosen === i.project_uid
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-axal-hairline text-gray-600 dark:border-gray-700 dark:text-gray-300'
                }`}
              >
                {i.project_name}
              </button>
            ))}
          </div>
        )}

        {brief.loading && <p className="text-[12.5px] text-gray-600 dark:text-gray-300">Assembling the brief…</p>}
        {brief.error && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
              {brief.error} Nothing is shown rather than an empty brief, because an empty brief
              would say this client has told you nothing — and that is not something this page
              can currently know.
            </p>
          </Card>
        )}

        {data && (
          <>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                    filter === key
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-axal-hairline text-gray-600 dark:border-gray-700 dark:text-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <Card padding="lg">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-extrabold tracking-tight">The brief</h3>
                <span className="text-[11px] text-gray-600 dark:text-gray-300">
                  A seam chip marks what came from the client
                </span>
              </div>
              {!visible.length ? (
                <p className="text-[12.5px] text-gray-600 dark:text-gray-300">Nothing matches this filter.</p>
              ) : (
                <ul className="divide-y divide-axal-ground dark:divide-gray-800">
                  {visible.map((r, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-2 py-2.5">
                      <span className="min-w-[130px] text-[11px] font-extrabold uppercase tracking-[.07em] text-gray-600 dark:text-gray-300">
                        {r.section}
                      </span>
                      <span className="flex-1 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
                        {r.value ?? <Unrecorded>Not recorded</Unrecorded>}
                      </span>
                      {r.source === 'client' && <SeamChip>From the client</SeamChip>}
                    </li>
                  ))}
                </ul>
              )}
              {data.withheld_note && (
                <p className="mt-3 border-t border-axal-ground pt-3 text-[11px] leading-relaxed text-gray-600 dark:border-gray-800 dark:text-gray-300">
                  {data.withheld_note}
                </p>
              )}
            </Card>

            {data.shared_documents?.length > 0 && (
              <Card padding="lg">
                <h3 className="text-sm font-extrabold tracking-tight">Documents the client sent you</h3>
                <ul className="mt-2 divide-y divide-axal-ground dark:divide-gray-800">
                  {data.shared_documents.map((d) => (
                    <li key={d.uid} className="flex flex-wrap items-baseline gap-2 py-2 text-[12.5px]">
                      <span>{d.title}</span>
                      <Pill tone={d.index_state === 'indexed' ? 'ok' : 'neutral'}>
                        {d.index_state === 'indexed' ? 'Answerable in Ask' : 'Not answerable'}
                      </Pill>
                      <SeamChip>From the client</SeamChip>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </ZoneBody>

      <StatedLimit title="What this brief will not do">
        It quotes what the client recorded; it never rewrites it, and it never derives a figure
        they did not state. Their current ACV reads “Not recorded” rather than being inferred
        from deals they mentioned — a number you inferred and then quoted back at them is the
        fastest way to lose a session’s first ten minutes.
      </StatedLimit>
    </div>
  );
}

/**
 * The brief's rows, each carrying where it came from.
 *
 * Only what the payload actually contains. A scope the founder did not open
 * produces no rows at all rather than a row reading "not available", because
 * the reason belongs in one place — `withheld_note` — and not repeated per
 * line where it would read as a data gap rather than a grant boundary.
 */
function buildRows(data) {
  if (!data) return [];
  const out = [];
  if (data.client) {
    out.push({ section: 'Client', value: data.client.name, source: 'client' });
    out.push({ section: 'Sector', value: data.client.sector, source: 'client' });
    out.push({ section: 'Stage', value: data.client.stage, source: 'client' });
  }
  if (data.room) {
    out.push({
      section: 'Data room',
      value: `${data.room.open} file${data.room.open === 1 ? '' : 's'} open to you`
        + (data.room.withheld_behind_nda
          ? ` · ${data.room.withheld_behind_nda} behind an NDA, as a count and never the names`
          : ''),
      source: 'client',
    });
  }
  for (const s of data.other_sessions || []) {
    out.push({
      section: 'Their other sessions',
      value: [s.topic, s.status].filter(Boolean).join(' · '),
      source: 'client',
    });
  }
  return out;
}
