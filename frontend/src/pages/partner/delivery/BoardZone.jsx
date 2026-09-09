import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, UnlinkedZone,
  isNoPartnerProfile, moneyDollars,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, Legend, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Delivery · Board — `/delivery/board`.
 *
 * WHAT THIS ROUTE USED TO RENDER. `EngagementsPage` with `view="engagements"` —
 * a proposals-and-invoices page shared with `/pipeline/proposals`, which reads
 * `engagements` and the quote ledger and nothing else. None of the five stores
 * migration 208 built for this bucket reached it: no milestone, no seat, no
 * hour, no blocker, no deliverable. So the zone the Delivery row lands on was
 * the one zone in the bucket that could not see the bucket.
 *
 * THE TWO MODES ARE NOT VARIANTS, and that is the whole artboard: "a project
 * reports milestones, an embedded seat reports hours against a grant the
 * founder can revoke." They are read differently, they are measured
 * differently, and the Progress column carries two different measures rather
 * than one averaged one — a fraction of a scope and a fraction of a week are
 * not the same number.
 *
 * MODE IS DERIVED, NEVER STORED. An engagement that granted a seat IS embedded;
 * one that did not IS a project. `GET /partner-delivery/board` reads it off
 * `engagement_seats`, and a `mode` column would be a second place to say it that
 * could disagree with the seat the first time one was revoked.
 *
 * A REVOKED SEAT STAYS ON THE BOARD, struck through. The artboard is explicit
 * that "a founder closing a seat is a normal event in this bucket, not an error
 * state" — and a board that dropped the row would disagree with the ledger about
 * how many engagements this firm has had.
 *
 * HEALTH IS NULLABLE AND NULL IS DRAWN. `healthFor` returns `null` when nothing
 * has been recorded against an engagement, and this page draws that as absent
 * rather than as green: "silence is not good news" is that helper's own reason
 * for existing, and a strip that read a mostly-empty book as a mostly-healthy
 * one would undo it.
 */

const MODE_LABEL = { project: 'Project', embedded: 'Embedded' };
const HEALTH_LABEL = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' };
const HEALTH_TONE = { on_track: 'ok', at_risk: 'warn', blocked: 'danger' };

/**
 * Which chip a row answers to.
 *
 * `Needs attention` IS THE TWO RATED-BAD STATES, not "anything not green". An
 * unrated engagement is not attention-worthy on this evidence — it is
 * evidence-free, which the strip says separately — and sweeping it in here
 * would turn "we have not looked" into "something is wrong".
 */
export function matchesBoardChip(row, chip) {
  if (chip === 'project') return row.mode === 'project';
  if (chip === 'embedded') return row.mode === 'embedded';
  if (chip === 'attention') return row.health === 'at_risk' || row.health === 'blocked';
  return true;
}

/** The strip tile, in the anatomy the artboards share. */
function BoardTile({ label, value, note, nr = false }) {
  return (
    <div className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </div>
  );
}

export default function PartnerDeliveryBoardZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [view, setView] = useState('all');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.getPartnerDeliveryBoard();
      setState({ loading: false, error: '', data: r || {} });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The engagement board did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const visible = items.filter((row) => matchesBoardChip(row, view));
  const revoked = items.filter((row) => row.seat_revoked_at);

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself.
  const rowActions = partnerZoneActions('delivery/board', { view: { header: ['Client', 'Mode', 'Scope', 'Granted', 'Progress', 'Health', 'Value'], rows: visible, cells: (r) => [r.client, r.mode, r.scope, r.grant, r.mode === 'project' ? `${r.milestones_done}/${r.milestone_count}` : r.hours_this_period, r.health, r.price] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Board" actions={rowActions} />;
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('delivery/board', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={items.length === 0}
        empty={(
          <NothingYet
            title="No engagement is on the board yet"
            body={
              'An accepted proposal becomes an engagement, and an engagement appears '
              + 'here in one of two modes: a project, which reports milestones, or an '
              + 'embedded seat, which reports hours against a scope the founder '
              + 'granted and can revoke.'
            }
          />
        )}
      >
        <div className="space-y-6">
          <ZoneHeading
            title="Every live engagement, in the mode it is actually in"
            blurb={
              'A project reports milestones; an embedded seat reports hours against a '
              + 'grant the founder can revoke. The two are not variants of one row — '
              + 'they are read differently, and this board reads them differently.'
            }
          />

          {/* ══ THE `pd1` STRIP ═══════════════════════════════════════════════
              `Project value · Embedded / month · Need attention · Revoked
              seats`, each counted over the whole board rather than the
              chip-narrowed list. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <BoardTile
              label="Project value"
              value={moneyDollars(d?.project_value ?? 0)}
              note={`${items.filter((r) => r.mode === 'project' && !r.seat_revoked_at).length} scoped engagements`}
            />
            <BoardTile
              label="Embedded / month"
              value={moneyDollars(d?.embedded_monthly ?? 0)}
              note={`${items.filter((r) => r.mode === 'embedded' && !r.seat_revoked_at).length} granted seats`}
            />
            <BoardTile
              label="Need attention"
              value={String(d?.needs_attention ?? 0)}
              note={d?.unrated_count
                ? `${d.unrated_count} more rated on nothing at all`
                : 'rated at risk or blocked'}
            />
            <BoardTile
              label="Revoked seats"
              value={String(d?.revoked_seats ?? 0)}
              note={revoked.length
                ? `${revoked[0].client || 'a client'} · closed ${String(revoked[0].seat_revoked_at).slice(0, 10)}`
                : 'no founder has closed a seat'}
            />
          </div>

          {/* THE ARTBOARD'S LEGEND, three entries rather than the two the
              Research and Network artboards draw. Rendered only where the table
              carries a grant at all: a legend explaining a violet mark nobody
              can see is the same defect as a chip that selects everything. */}
          {items.some((r) => r.grant) && (
            <Legend
              items={[
                { chip: 'From client', tone: 'seam', note: 'founder-sourced object' },
                { chip: 'Granted · scope', grant: true, note: 'scoped, revocable grant to a named operator' },
                ...(revoked.length
                  ? [{ chip: 'Granted · scope', grant: true, revoked: true, note: 'grant revoked by the founder' }]
                  : []),
              ]}
            />
          )}

          <Instrument
            testid="delivery-board"
            title="Live engagements"
            meta="Mode is structural, not a status"
            cols="1fr .8fr 2.1fr 1.2fr .9fr"
            head={['Client', 'Mode', 'Scope', 'Progress', 'Health']}
            rows={visible.map((r) => ({
              key: r.engagement_id,
              rowClass: r.seat_revoked_at ? 'opacity-60' : '',
              cells: [
                r.client ? { text: r.client } : { nr: true },
                { mode: MODE_LABEL[r.mode] },
                {
                  text: r.scope || undefined,
                  ...(r.scope ? {} : { nr: true }),
                  ...(r.grant
                    ? { grant: `Granted · ${r.grant}`, grantRevoked: Boolean(r.seat_revoked_at) }
                    : {}),
                  sub: r.grant_holder ? `held by ${r.grant_holder}` : undefined,
                },
                // TWO MEASURES, NEVER AVERAGED. A project counts milestones; an
                // embedded seat counts hours this period against the retainer's
                // retained hours — and an embedded seat with no retainer has no
                // cap to measure against, which is stated rather than invented.
                r.mode === 'project'
                  ? (r.milestone_count
                    ? { text: `${r.milestones_done} of ${r.milestone_count} milestones` }
                    : { nr: true })
                  : (r.seat_revoked_at
                    ? { nr: true }
                    : (r.hours_cap != null
                      ? { text: `${r.hours_this_period ?? 0} of ${r.hours_cap} h this period` }
                      : { text: `${r.hours_this_period ?? 0} h this period`, sub: 'no retained-hours cap agreed' })),
                r.health
                  ? { pill: HEALTH_LABEL[r.health], pillTone: HEALTH_TONE[r.health] }
                  : (r.seat_revoked_at ? { pill: 'Revoked', pillTone: 'neutral' } : { nr: true }),
              ],
            }))}
            note={'A project row counts milestones; an embedded row counts hours against a granted seat and names what was granted — a scope held by an operator is a different relationship from a file handed over, which is why the grant is a mark on the row rather than a line in a note. A revoked grant is kept visible and struck through: a founder closing a seat is a normal event in this bucket, not an error state. And a row with no health is drawn absent rather than green — nothing has been recorded against it, no milestone, blocker, deliverable or retainer, and silence is not good news.'}
          />

          {items.length > 0 && visible.length === 0 && (
            <p className="text-[12px] text-axal-ink-2">
              No engagement is in this state. {items.length} on the board in total.
            </p>
          )}

          <ZoneDraft
            surface="delivery/board"
            label="Draft · board read"
            accept="Accept draft"
            run="Read the board"
            foot="Traces to engagement rows."
            empty="Which engagements carry risk and why — separating a client-facing problem from a capacity one, because the second is solved by adding people and the first is not."
            nothingToDraft="No engagement is on the board yet, so there is nothing to read."
          />

          <StatedLimit title="What this board does not claim">
            <p>
              <strong>Health is computed, never stored.</strong> It is a read over
              milestones, blockers, deliverables and retained hours, and an
              engagement with none of those is not rated — it shows as absent
              rather than on track. A green board that is really an empty one is
              the one thing this zone must not show you.
            </p>
            <p className="mt-2">
              <strong>Progress is two measures, not one.</strong> A project's is a
              count of milestones; an embedded seat's is hours this period against
              the retainer’s retained hours. Nothing averages them, because a
              fraction of a scope and a fraction of a week are not the same number
              — and a seat with no retainer has no cap, which the row says rather
              than filling one in.
            </p>
            <p className="mt-2">
              <strong>A grant is the founder’s to withdraw.</strong> Nothing here
              revokes a seat or asks for one back; the row records what was granted
              and, once it ends, that it ended.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
