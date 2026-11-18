import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import OfferPages from '../../../ui/OfferPages.jsx';
import {
  ZoneBody, NothingYet, ZoneHeading, Unrecorded, Pill,
  Section, Field, NotComputable, NotMeasured, NoPartnerProfile,
  isNoPartnerProfile, inputClass, buttonClass, ghostButtonClass, moneyDollars,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { FOOT, TREND_WHY, captionOf, missingSource, sourceRows } from './visibilityModel';
import { useGuardedWrite, scopedNote, zoneNote, WriteNote } from './useGuardedWrite';

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
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-axal-muted">
            <span className="tabular-nums">
              <strong className="text-axal-ink">{row.engagement_count}</strong>{' '}
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
        <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700">
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
              onClick={() => onSave(row, draft, () => setEdit(false))}>Save</button>
            <button
              type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
              disabled={busy}
              title="Removes the surface and the attributions pointing at it. Retiring is usually the right move instead."
              onClick={() => onDelete(row)}
            >
              Delete
            </button>
          </div>
          <WriteNote note={scopedNote(note, `surface:${row.id}`)} busy={busy} />
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
        <div className="text-[11px] text-axal-faint">
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
  const [adding, setAdding] = useState(false);
  const [newSurface, setNewSurface] = useState({ name: '', kind: 'directory' });
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [v, a] = await Promise.all([
        api.getPartnerVisibility(),
        api.listPartnerAttribution(page),
      ]);
      setState({
        loading: false,
        error: '',
        data: v || {},
        attribution: Array.isArray(a?.items) ? a.items : [],
        attributionPage: a,
      });
      return true;
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || 'The surface record did not load.',
        data: null,
        attribution: null,
      });
      return false;
    }
  }, [page]);
  useEffect(() => { load(); }, [load]);

  // #4688: one write mechanism. A failed write keeps its form and offers Retry;
  // cleanup runs only once the write persisted; a refresh that fails after a
  // persisted write says so and offers only a reload of the read.
  const { busy, note, save, reload, clearNote } = useGuardedWrite(load);
  const run = useCallback(
    (write, saved, scope, onSaved) => save(write, { saved, scope, onSaved }),
    [save],
  );
  const toggleAdding = (open) => { clearNote(); setAdding(open); };

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const attribution = state.attribution || [];
  const active = items.filter((s) => s.is_active);
  // #4843 (D4843): the OF-05 table, its caption and the missing-source action.
  const rows = sourceRows(items);
  const caption = captionOf(d);
  const missing = missingSource(d, items);

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

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  const rowActions = partnerZoneActions('offers/visibility', { view: { header: ['Service', 'Kind', 'Price', 'Active', 'Engagements', 'Won value'], rows: visible, cells: (r) => [r.name, r.kind, r.price, r.is_active, r.engagement_count, r.won_value] } });

  // NOT AN EARLY RETURN ANY MORE. This was
  //   `if (isNoPartnerProfile(state.error)) return <UnlinkedZone … />;`
  // which drew a card INSTEAD of the zone — on twelve zones, so an admin
  // reading this workspace saw twelve copies of one card and never a page.
  // `ZoneBody` takes the line as a `notice` above its states, and the zone
  // renders underneath in its own empty state, which is also the state that
  // says what this zone holds. The gate itself is untouched: the read still
  // 400s, so `isEmpty` is forced rather than inferred from rows that never
  // arrived, and `error` is cleared so the shared "This did not load" card —
  // the exact confusion `isNoPartnerProfile` exists to prevent — cannot fire.
  const unlinked = isNoPartnerProfile(state.error);

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
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store.
          An action states what the zone DOES and an export over nothing
          loaded renders disabled and says so; a filter chip is a claim about
          ROWS, and a selectable `Published` over a store this account cannot
          read is the "an empty set reads as an answer" failure
          `zoneFilterBuilder.js` exists to prevent, reached from a new
          direction. `profile_zone_actions.test.mjs` asserts both halves. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : partnerZoneFilters('offers/visibility', { value: view })}
        actions={rowActions}
      />
      {/* THE EDITOR IS NOT A CHILD OF `ZoneBody` (#4688). `ZoneBody` draws only
          its empty state while there are no rows, so a form placed among its
          children was never mounted for the very partner who needed it: the
          first-record button set `adding` and nothing appeared. Here it is
          mounted by `adding` alone, so it exists for an empty store, during a
          refresh, and beside an unreadable list. */}
      {adding && (
        <div className="mb-6 rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700" data-testid="surface-editor">
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
                onClick={() => run(
                  () => api.createPartnerSurface(newSurface), 'Surface added.', 'new',
                  () => { setNewSurface({ name: '', kind: 'directory' }); setAdding(false); },
                )}
              >
                Add surface
              </button>
            </div>
          </div>
          <WriteNote note={scopedNote(note, 'new')} busy={busy} />
        </div>
      )}
      <WriteNote note={zoneNote(note)} busy={busy} onReload={reload} />
      <ZoneBody
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={reload}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || (items.length === 0)}
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
              <button type="button" className={buttonClass} onClick={() => toggleAdding(true)}>
                Add a surface
              </button>
            )}
          />
        )}
      >
        <div className="space-y-6">
          {/* #4843 (D4843, board OF-05): the zone answers one question, with one primary action. */}
          <ZoneHeading
            title="Where does our work come from?"
            blurb="Engagements and won value by the surface that brought them in."
            action={(
              <button type="button" className={adding ? ghostButtonClass : buttonClass} onClick={() => toggleAdding(!adding)} data-testid="visibility-add">
                {adding ? 'Cancel' : '+ Add surface'}
              </button>
            )}
          />

          {/* Missing attribution is an action, not an explanation. */}
          {missing && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30" data-testid="visibility-missing">
              <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-amber-200 text-[12px] font-extrabold text-amber-900 dark:bg-amber-900 dark:text-amber-100">!</span>
              <div className="min-w-0 flex-1 text-[13px] text-axal-ink dark:text-gray-100">
                <b className="block">{missing.title}</b>
                <span className="text-[12.5px] text-axal-muted dark:text-gray-400">{missing.line}</span>
              </div>
              {missing.canFix && (
                <a href="#visibility-attribution" className={`${ghostButtonClass} max-sm:min-h-[44px]`} data-testid="visibility-review">Review attribution</a>
              )}
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="visibility-sources">
            {caption && <p className="m-0 px-3 pt-2.5 text-[11px] font-bold uppercase tracking-[.08em] text-axal-faint" data-testid="visibility-caption">{caption}</p>}
            {/* A desk reads a table; a phone reads the same rows as labelled cards (OF-09). */}
            <table className="hidden w-full text-left text-[13px] sm:table">
              <thead className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-faint">
                <tr>
                  {['Source', 'Kind', 'Engagements', 'Won', 'Views', 'Trend'].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2 ${i === 2 || i === 3 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-axal-hairline align-middle dark:border-gray-800" data-testid={`visibility-row-${r.id}`}>
                    <td className="px-3 py-2"><b>{r.name}</b>{r.retired && <span className="ml-2"><Pill tone="neutral">Retired</Pill></span>}</td>
                    <td className="px-3 py-2">{r.kind}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.engagements}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.won == null ? <NotMeasured label="Not recorded" /> : moneyDollars(r.won)}</td>
                    <td className="px-3 py-2"><NotMeasured why={r.viewsWhy} testId={`visibility-views-${r.id}`} /></td>
                    <td className="px-3 py-2"><NotMeasured label="Not recorded" why={TREND_WHY} testId={`visibility-trend-${r.id}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="m-0 flex list-none flex-col p-0 sm:hidden" data-testid="visibility-cards">
              {rows.map((r) => (
                <li key={r.id} className="border-t border-axal-hairline px-3 py-3 first:border-t-0 dark:border-gray-800">
                  <div className="flex items-baseline justify-between gap-2"><b className="text-[14px]">{r.name}</b><span className="text-[12px] text-axal-muted dark:text-gray-400">{r.kind}</span></div>
                  <dl className="m-0 mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                    <dt className="text-axal-muted dark:text-gray-400">Engagements</dt><dd className="m-0 text-right tabular-nums">{r.engagements}</dd>
                    <dt className="text-axal-muted dark:text-gray-400">Won</dt><dd className="m-0 text-right tabular-nums">{r.won == null ? 'Not recorded' : moneyDollars(r.won)}</dd>
                    <dt className="text-axal-muted dark:text-gray-400">Views</dt><dd className="m-0 text-right"><NotMeasured why={r.viewsWhy} /></dd>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
          <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="visibility-foot">{FOOT}</p>

          <Section title="Where each engagement came from">
            <div id="visibility-attribution" className="scroll-mt-24" data-testid="visibility-attribution">
              {attribution.length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-axal-muted">
                  No engagement yet. Win work and it appears here to be attributed;
                  until it is, it counts toward no surface.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
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
            </div>
            {/* Scoped by a PREFIXED key, not a bare id. A surface id and an
                engagement id are both small integers drawn from different
                sequences, so `scope === row.id` would eventually show a surface's
                "Saved." under an unrelated engagement row — a message about a
                write that did not happen there. */}
            <WriteNote note={String(note?.scope || '').startsWith('attr:') && !note.refreshFailed ? note : null} busy={busy} />
            <OfferPages label="Attribution" result={state.attributionPage} busy={busy || state.loading} onPage={setPage} />
          </Section>

          <Section title="Manage surfaces">
            <div>
              {visible.map((row) => (
                <SurfaceRow
                  key={row.id}
                  row={row}
                  busy={busy}
                  note={note}
                  onSave={(r, draft, onSaved) => run(
                    () => api.updatePartnerSurface(r.id, {
                      name: draft.name, kind: draft.kind, is_active: draft.is_active,
                    }),
                    'Saved.', `surface:${r.id}`, onSaved,
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
            railOption="draft:attribution-read"
            label="Draft · attribution read"
            accept="Accept read"
            run="Read the attribution"
            foot="Engagement counts traced to Delivery rows."
            empty="Which surfaces are converting and which are volume without intent, counted from engagements that name their source. Where a surface has no view counter the read says so instead of modelling one."
            nothingToDraft="No surface is recorded yet, so there is nothing to compare."
          />

          <p className="text-[12px] text-axal-faint">
            Passing on a lead with a named reason lives on{' '}
            <Link to="/offers/audience-fit" className="text-amber-700 underline">Audience fit</Link>.
          </p>
        </div>
      </ZoneBody>
    </>
  );
}
