import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  StatCard, Section, Field, SaveNote, NotComputable, NoPartnerProfile,
  isNoPartnerProfile, inputClass, buttonClass, ghostButtonClass, moneyDollars,
} from '../kit';

/**
 * Offers · Visibility — `/offers/visibility`.
 *
 * THE ZONE'S ARGUMENT, AND WHY THE STORE IS SHAPED FOR IT. Volume is not the
 * ranking. A directory listing with thousands of views and no engagements reads
 * worse than a referral with two leads and one — which is only sayable if each
 * engagement NAMES the surface it came from. `engagements` has no such column
 * and never did, so this zone's old card was true. Migration 209 added
 * `partner_surfaces` and `engagement_sources`, and the second is a JOIN rather
 * than a model: an engagement nobody attributed is counted against no surface
 * at all.
 *
 * THAT GAP IS SHOWN RATHER THAN DISTRIBUTED. The unattributed count sits beside
 * the table with its own sentence. Spreading those rows proportionally across
 * the named surfaces would make the widest column the least true, which is
 * exactly the failure the store was designed to avoid.
 *
 * TWO COLUMNS THE CANVAS ASKS FOR AND THIS ZONE WILL NOT DRAW:
 *
 *   VIEWS. A view count needs an impression pipeline, not a table. Nothing in
 *   the product records one, so the column says "Not recorded" with the reason
 *   rather than showing a number nobody measured.
 *
 *   LEADS PER SURFACE. Engagements per surface is real. Leads per surface has
 *   no store — a lead is a `founder_needs` row nobody owns, and nothing records
 *   which surface a founder arrived through. A ratio with an absent denominator
 *   is fabricated rather than partial, so it is stated as absent.
 */

const KINDS = [
  ['directory', 'Directory'],
  ['referral', 'Referral'],
  ['outbound', 'Outbound'],
  ['content', 'Content'],
  ['event', 'Event'],
  ['other', 'Other'],
];
const KIND_LABEL = Object.fromEntries(KINDS);

function SurfaceRow({ row, onSave, onDelete, busy, note }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(row);
  useEffect(() => { setDraft(row); }, [row]);

  return (
    <div className="border-t border-axal-hairline py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-extrabold tracking-tight">{row.name}</span>
            <Pill tone={row.is_active ? 'info' : 'neutral'}>{KIND_LABEL[row.kind] || row.kind}</Pill>
            {!row.is_active && <Pill tone="neutral">Retired</Pill>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-axal-ink-2">
            <span className="tabular-nums">
              <strong className="text-axal-ink-1">{row.engagement_count}</strong>{' '}
              engagement{row.engagement_count === 1 ? '' : 's'}
            </span>
            <span className="tabular-nums">{moneyDollars(row.won_value)} won</span>
            <span className="inline-flex items-center gap-1.5">
              Views: <NotComputable why={row.views_note}>Not recorded</NotComputable>
            </span>
          </div>
        </div>
        <button type="button" className={ghostButtonClass} onClick={() => setEdit((v) => !v)}>
          {edit ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {edit && (
        <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Name">
              <input className={inputClass} value={draft.name || ''} maxLength={160}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Kind">
              <select className={inputClass} value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Still in use" hint="Retiring keeps the surface and everything it produced.">
              <select className={inputClass} value={draft.is_active ? 'yes' : 'no'}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.value === 'yes' })}>
                <option value="yes">Yes</option>
                <option value="no">No — retired</option>
              </select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy}
              onClick={async () => { await onSave(row, draft); setEdit(false); }}>Save</button>
            <button
              type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
              disabled={busy}
              title="Removes the surface and the attributions pointing at it. Retiring is usually the right move instead."
              onClick={() => onDelete(row)}
            >
              Delete
            </button>
          </div>
          <SaveNote note={note?.scope === `surface:${row.id}` ? note : null} />
        </div>
      )}
    </div>
  );
}

function AttributionRow({ row, surfaces, onSet, onClear, busy }) {
  return (
    <tr className="border-t border-axal-hairline align-top">
      <td className="py-2 pr-3">
        <div className="font-semibold">{row.need_title || <Unrecorded>Untitled</Unrecorded>}</div>
        <div className="text-[11px] text-axal-ink-3">
          {row.founder_name || row.engagement_uid} · {row.status}
        </div>
      </td>
      <td className="py-2 pr-3 tabular-nums">{row.price != null ? moneyDollars(row.price) : <Unrecorded />}</td>
      <td className="py-2 pr-3">
        <select
          className={inputClass}
          value={row.surface_id ?? ''}
          disabled={busy || surfaces.length === 0}
          onChange={(e) => (e.target.value ? onSet(row, Number(e.target.value)) : onClear(row))}
        >
          {/* Empty is a REAL choice, not a prompt: an engagement whose source
              nobody knows must be recordable as exactly that. */}
          <option value="">Not attributed</option>
          {surfaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
    </tr>
  );
}

export default function PartnerVisibilityZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null, attribution: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newSurface, setNewSurface] = useState({ name: '', kind: 'directory' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [v, a] = await Promise.all([
        api.getPartnerVisibility(),
        api.listPartnerAttribution(),
      ]);
      setState({
        loading: false,
        error: '',
        data: v || {},
        attribution: Array.isArray(a?.items) ? a.items : [],
      });
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || 'The surface record did not load.',
        data: null,
        attribution: null,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (fn, ok, scope) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: ok, scope });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e?.message || 'That did not save.', scope });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const attribution = state.attribution || [];
  const active = items.filter((s) => s.is_active);

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Visibility" />
        <NoPartnerProfile />
      </>
    );
  }

  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0}
      empty={(
        <NothingYet
          title="No surface is recorded yet"
          body={
            'A surface is anywhere the firm appears and work can come from — a '
            + 'directory listing, a referral partner, an event, a piece of '
            + 'writing. Record one and every engagement can then name where it '
            + 'came from, which is the only way this zone can compare them.'
          }
          action={(
            <button type="button" className={buttonClass} onClick={() => setAdding(true)}>
              Add a surface
            </button>
          )}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="Where the firm appears, and what each produced"
          blurb={
            'Ranked by engagements rather than by reach. A listing with a large '
            + 'audience and no work is below a referral with one — that ordering '
            + 'is the point of the zone.'
          }
          action={(
            <button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add a surface'}
            </button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Surfaces" value={items.length} hint={`${active.length} still in use`} />
          <StatCard
            label="Engagements"
            value={d?.engagement_total ?? 0}
            hint={d?.unattributed_count ? `${d.unattributed_count} name no surface` : 'all attributed'}
          />
          <StatCard label="Views" value="—" hint="not recorded — see below" />
          <StatCard label="Leads per surface" value="—" hint="no store — see below" />
        </div>

        {d?.unattributed_note && (
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
            {d.unattributed_note}{' '}
            <span className="text-axal-ink-3">
              They are not shared out across the surfaces below — a count that
              guessed would make the largest row the least true.
            </span>
          </p>
        )}

        {adding && (
          <div className="rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Name" hint="What a person would call it — “Axal directory”, “Acme referral”.">
                <input className={inputClass} value={newSurface.name} maxLength={160}
                  onChange={(e) => setNewSurface({ ...newSurface, name: e.target.value })} />
              </Field>
              <Field label="Kind">
                <select className={inputClass} value={newSurface.kind}
                  onChange={(e) => setNewSurface({ ...newSurface, kind: e.target.value })}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <div className="flex items-end">
                <button
                  type="button" className={buttonClass}
                  disabled={busy || !newSurface.name.trim()}
                  onClick={async () => {
                    await run(() => api.createPartnerSurface(newSurface), 'Surface added.', 'new');
                    setNewSurface({ name: '', kind: 'directory' });
                    setAdding(false);
                  }}
                >
                  Add surface
                </button>
              </div>
            </div>
            <SaveNote note={note?.scope === 'new' ? note : null} />
          </div>
        )}

        <Section title="Surfaces">
          <div>
            {items.map((row) => (
              <SurfaceRow
                key={row.id}
                row={row}
                busy={busy}
                note={note}
                onSave={(r, draft) => run(
                  () => api.updatePartnerSurface(r.id, {
                    name: draft.name, kind: draft.kind, is_active: draft.is_active,
                  }),
                  'Saved.', `surface:${r.id}`,
                )}
                onDelete={(r) => run(
                  () => api.deletePartnerSurface(r.id),
                  'Surface deleted.', `surface:${r.id}`,
                )}
              />
            ))}
          </div>
        </Section>

        <Section title="Where each engagement came from">
          {attribution.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
              No engagement yet. Win work and it appears here to be attributed —
              until it is, it counts toward no surface.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                  <tr>
                    <th className="pb-1 pr-3">Engagement</th>
                    <th className="pb-1 pr-3">Value</th>
                    <th className="pb-1 pr-3">Came from</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.map((row) => (
                    <AttributionRow
                      key={row.engagement_id}
                      row={row}
                      surfaces={active}
                      busy={busy}
                      onSet={(r, surfaceId) => run(
                        () => api.setPartnerEngagementSource(r.engagement_id, { surface_id: surfaceId }),
                        'Attributed.', `attr:${r.engagement_id}`,
                      )}
                      onClear={(r) => run(
                        () => api.clearPartnerEngagementSource(r.engagement_id),
                        'Attribution cleared.', `attr:${r.engagement_id}`,
                      )}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Scoped by a PREFIXED key, not a bare id. A surface id and an
              engagement id are both small integers drawn from different
              sequences, so `scope === row.id` would eventually show a surface's
              "Saved." under an unrelated engagement row — a message about a
              write that did not happen there. */}
          <SaveNote note={String(note?.scope || '').startsWith('attr:') ? note : null} />
        </Section>

        <StatedLimit title="What this zone does not claim">
          <p>
            <strong>No view count.</strong> {items[0]?.views_note
              || 'No impression is recorded anywhere in the product, so a view count would be invented rather than measured.'}{' '}
            The column stays on the page as a stated absence rather than being
            removed, because a reader who came for reach deserves to be told it
            is not measured rather than left to assume it is zero.
          </p>
          <p className="mt-2">
            <strong>No leads-per-surface ratio.</strong> {d?.lead_ratio_note
              || 'Leads per surface is not recorded anywhere, so the ratio has an absent denominator.'}
          </p>
          <p className="mt-2">
            <strong>Attribution is what somebody recorded.</strong> Nothing infers
            a source, so a surface that produced work nobody attributed reads as
            producing none. The unattributed count above is how large that gap
            currently is — and it is shown rather than shared out, so no row is
            credited with work it may not have produced.
          </p>
        </StatedLimit>

        <p className="text-[12px] text-axal-ink-3">
          Passing on a lead with a named reason lives on{' '}
          <Link to="/offers/audience-fit" className="text-amber-700 underline">Audience fit</Link>.
        </p>
      </div>
    </ZoneBody>
  );
}
