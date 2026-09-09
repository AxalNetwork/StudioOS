import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  // `StatCard` went with the four tiles it drew: the strip is the artboard's
  // own composition now, and `VisTile` below is the tile that can render `Not
  // recorded` as a chip rather than as an em dash a reader reads as zero.
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  Section, Field, SaveNote, NotComputable, UnlinkedZone,
  isNoPartnerProfile, inputClass, buttonClass, ghostButtonClass, moneyDollars,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

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

  /**
   * `By engagements` is the one label on this artboard with a source, and it is
   * an ORDERING rather than a subset — which is why there is no view state
   * below: a control whose value can never change would look selectable and
   * select nothing.
   *
   * THE PAGE APPLIES IT RATHER THAN INHERITING IT. `GET /partner-offers/
   * surfaces` already ends `ORDER BY COUNT(es.id) DESC, s.name`, so the rows
   * arrive in this order — but the heading below CLAIMS the ordering in prose
   * ("ranked by engagements rather than by reach"), and a claim this file makes
   * should not rest on a clause in a query this file cannot see. Sorting here
   * makes the chip, the heading and the exported file say the same thing for
   * the same reason.
   */
  const ORDERINGS = {
    engagements: (a, b) => (Number(b.engagement_count) || 0) - (Number(a.engagement_count) || 0)
      || String(a.name || '').localeCompare(String(b.name || '')),
  };
  const view = 'engagements';
  const visible = [...items].sort(ORDERINGS[view]);
  // The artboard's `Best converter`, over the whole set rather than the sorted
  // view — they are the same list here, and reading `items` says so.
  const best = items.reduce(
    (top, s2) => (Number(s2.engagement_count) > Number(top?.engagement_count ?? 0) ? s2 : top),
    null,
  );

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  const rowActions = partnerZoneActions('offers/visibility', { view: { header: ['Service', 'Kind', 'Price', 'Active', 'Engagements', 'Won value'], rows: visible, cells: (r) => [r.name, r.kind, r.price, r.is_active, r.engagement_count, r.won_value] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Visibility" actions={rowActions} />;
  }

  return (
    <>
      {/* THE ROW IS HOISTED OUT OF `ZoneBody`, as `RelationshipsZone` does it
          and for the reason written there: `ZoneBody` renders `actions` above
          all four of its states, which is the right guarantee, and this keeps
          it one level up rather than teaching a component a dozen other zones
          mount about filters.

          NO VIEW STATE, AND THAT IS NOT A SHORTCUT. `By engagements` is the
          only label on this artboard with a source, and it is not a subset —
          it is the ordering the server already returns (`ORDER BY
          COUNT(es.id) DESC, s.name`) and the heading below already claims.
          A state whose value can never change would be a control that looks
          selectable and selects nothing. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('offers/visibility', { value: view })}
        actions={rowActions}
      />
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

          {/* ══ THE ARTBOARD'S FOUR TILES, AND THE TWO IT ASKS FOR THAT THIS
              PRODUCT CANNOT ANSWER ══════════════════════════════════════════

              `po3`'s strip is `Leads · Engagements · Best converter · Directory
              views`. Two of those four are real here and two are not, and the
              difference is which side the absence sits on.

              `Engagements` and `Best converter` count rows: `engagement_sources`
              (migration 209) is a join, so every figure is a named row and a
              surface nobody attributed counts toward nothing.

              `Leads` and `Directory views` are the product's own gaps, not this
              firm's. A lead is a `founder_needs` row and nothing records which
              surface a founder arrived through; a view needs an impression
              pipeline, not a table. D56 says a tile with no store behind it is
              not drawn — so these two are `Not recorded` with the reason rather
              than a zero, because a zero on `Leads` would read as "nobody came"
              when it means "nobody counted". */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <VisTile label="Leads" nr note="no store records which surface a founder arrived through" />
            <VisTile
              label="Engagements"
              value={String(d?.engagement_total ?? 0)}
              note={d?.unattributed_count ? `${d.unattributed_count} name no surface` : 'each names its source'}
            />
            {best
              ? <VisTile label="Best converter" value={best.name} note={`${best.engagement_count} engagement${Number(best.engagement_count) === 1 ? '' : 's'} sourced`} />
              : <VisTile label="Best converter" nr note="no engagement names a surface yet" />}
            <VisTile label="Directory views" nr note="no impression pipeline — never estimated" />
          </div>

          {/* THE ARTBOARD'S LINKAGE NOTE, and it is the sentence that makes the
              Engagements column trustworthy: this zone counts named rows rather
              than modelling a total, so nothing appears here that does not
              exist in Delivery. */}
          <div className="rounded-[10px] border border-cyan-200 bg-cyan-50/50 p-3 text-[11.5px] leading-relaxed text-gray-700 dark:border-cyan-900 dark:bg-cyan-950/20 dark:text-gray-300">
            <strong className="text-cyan-700 dark:text-cyan-300">Reads through to Delivery:</strong>{' '}
            Every engagement in Delivery names the surface that sourced it, so this column counts named
            rows rather than modelling a total. Nothing appears here that does not exist there
            {d?.unattributed_count
              ? `, and the ${d.unattributed_count} that name no surface are counted toward none of them.`
              : '.'}
          </div>

          <Instrument
            testid="visibility-surfaces"
            title="Surfaces"
            meta="Sorted by engagements, not views"
            cols="1.6fr .9fr .8fr 1fr 1.1fr"
            head={['Surface', 'Views', 'Leads', 'Engagements', 'Lead → engagement']}
            rows={visible.map((row) => ({
              key: row.id,
              cells: [
                {
                  text: row.name,
                  sub: KIND_LABEL[row.kind] || row.kind,
                  ...(row.is_active ? {} : { pill: 'Retired', pillTone: 'neutral' }),
                },
                // THREE COLUMNS THE ARTBOARD DRAWS AND THIS STORE CANNOT FILL,
                // and the instNote below names each. The artboard itself
                // renders an em dash where a surface has no view counter —
                // "inventing one would make the widest column the least true" —
                // and here that is every row rather than two of them.
                { nr: true },
                { nr: true },
                { text: String(row.engagement_count ?? 0) },
                { nr: true },
              ],
            }))}
            note={'Views and Leads read "Not recorded" on every row, and the ratio between them with them: a view count needs an impression pipeline rather than a table, and nothing in the product records which surface a founder arrived through. The artboard renders an em dash where a surface has no view counter on the grounds that inventing one would make the widest column the least true — here that applies to every row, so the column is stated absent rather than filled. Engagements is real and is the ordering: a listing with a large audience and no work sits below a referral with one, which is the whole point of the zone.'}
          />

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
              {visible.map((row) => (
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

          <ZoneDraft
            surface="offers/visibility"
            label="Draft · attribution read"
            accept="Accept read"
            run="Read the attribution"
            foot="Engagement counts traced to Delivery rows."
            empty="Which surfaces are converting and which are volume without intent, counted from engagements that name their source. Where a surface has no view counter the read says so instead of modelling one."
            nothingToDraft="No surface is recorded yet, so there is nothing to compare."
          />

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
    </>
  );
}

/**
 * The strip tile, in the anatomy the artboards share.
 *
 * `StatCard` is this bucket's older primitive and is still used elsewhere in
 * the file; the strip is the artboard's own composition, so it takes the
 * artboard's own tile — which is also the one that can draw `Not recorded` as a
 * chip rather than as an em dash a reader mistakes for zero.
 */
function VisTile({ label, value, note, nr = false }) {
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
