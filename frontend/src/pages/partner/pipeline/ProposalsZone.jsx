import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading,
  Section, Field, SaveNote, UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, moneyDollars, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Pipeline · Proposals — `/pipeline/proposals`.
 *
 * WHAT THIS ROUTE USED TO RENDER. `EngagementsPage` with `view="proposals"` — a
 * proposals-and-invoices page it shared with `/delivery/board` until that zone
 * got its own. It listed quotes and their status and nothing else: no version
 * history, no loss reason, no lifecycle at all.
 *
 * THE ARTBOARD'S SUBJECT IS THE LIFECYCLE, and it states the case in one line:
 * "a proposal opened four times and not answered is a different object from one
 * never opened, and only the detail page can tell you which you have."
 *
 * THIS BUILD CANNOT TELL THOSE APART, AND THE PAGE SAYS SO RATHER THAN
 * GUESSING. `quotes` has no open, no read receipt, no view count, and no
 * founder-side surface records one — the same absence
 * `engagement_deliverables.opened_at` has, for the same reason: an open is the
 * client's act, not ours to observe. So the two tiles that need it read
 * *Not recorded* with the reason, the two chips that need it are prose, and the
 * `Signal` column reports what this side genuinely knows: sent, silent for N
 * days, or decided. A "never opened" count computed from silence would be a
 * number about our own send wearing a claim about their attention.
 *
 * WHAT THE FIRM DOES OWN IS BUILT. Migration 234 gives a proposal a VERSION
 * TRAIL — v1 through v4, each with what changed and what it cost, append-only
 * because a history that can be rewritten is not one — and a LOSS REASON from a
 * closed taxonomy. The artboard's own note on the second: "reasons are picked
 * from a fixed taxonomy, not typed. Free text would make this chart unreadable
 * within a quarter."
 *
 * A LOSS WITH NO REASON IS COUNTED SEPARATELY, never folded into `Other`. "We
 * did not ask" and "they said something else" are different answers and only
 * one of them belongs in a taxonomy.
 */

const LOSS_LABEL = {
  price: 'Price',
  scope_mismatch: 'Scope mismatch',
  timing: 'Timing',
  other: 'Other',
};
const STATE_TONE = { Won: 'ok', Lost: 'danger', Sent: 'neutral', Withdrawn: 'neutral' };

/** The strip tile, in the anatomy the artboards share. */
function ProposalTile({ label, value, note, nr = false }) {
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

export default function PartnerProposalsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [view, setView] = useState('all');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [openTrail, setOpenTrail] = useState(null);
  const [draft, setDraft] = useState({ change_summary: '', note: '', price: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.listPartnerProposals();
      setState({ loading: false, error: '', data: r || {} });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The proposals did not load.', data: null });
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
  const lossRows = Array.isArray(d?.loss_reasons) ? d.loss_reasons : [];
  const lossMax = Math.max(1, ...lossRows.map((r) => r.count));

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // ══ THE `p2` CHIP ROW ════════════════════════════════════════════════════
  // Three of the five select. `Opened, unanswered` and `Never opened` are prose
  // for the reason the whole zone turns on: nothing records an open, so the two
  // states are one state here and a chip that split them would be inventing the
  // distinction it claims to filter on.
  const visible = (() => {
    if (view === 'won') return items.filter((r) => r.state === 'Won');
    if (view === 'lost') return items.filter((r) => r.state === 'Lost');
    return items;
  })();

  const trail = openTrail ? items.find((r) => r.quote_id === openTrail) : null;

  const rowActions = partnerZoneActions('pipeline/proposals', { view: { header: ['Client', 'Shape', 'Value', 'Version', 'State', 'Loss reason', 'Days since sent'], rows: visible, cells: (r) => [r.client, r.shape, r.price_dollars, r.version, r.state, r.loss_reason, r.days_since_sent] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Proposals" actions={rowActions} />;
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('pipeline/proposals', { value: view, onChange: setView })}
        actions={rowActions}
      />
      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={items.length === 0}
        empty={(
          <NothingYet
            title="No proposal sent yet"
            body={
              'A proposal is a bid on an open need. Accept a lead and quote it, '
              + 'and it appears here with its version history and — once it is '
              + 'decided — the reason it went the way it did.'
            }
            action={<Link to="/pipeline/leads" className="text-[12.5px] font-semibold text-amber-700 underline">Open the leads</Link>}
          />
        )}
      >
        <div className="space-y-6">
          <ZoneHeading
            title="Proposals"
            blurb={
              'Every proposal with its version history and the reason it was won '
              + 'or lost. Whether a client has read one is not recorded anywhere '
              + '— see below — so a quiet proposal and an unread one are one '
              + 'state here rather than two.'
            }
          />

          {/* ══ THE `p2` STRIP ════════════════════════════════════════════════
              `Live proposals · Opened, unanswered · Never opened · Won this
              quarter`. The middle two need a read receipt nothing records. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <ProposalTile
              label="Live proposals"
              value={String(d?.live_count ?? 0)}
              note={`${moneyDollars(d?.live_value_dollars ?? 0)} in play`}
            />
            <ProposalTile
              label="Opened, unanswered"
              nr
              note="nothing records that a client opened one"
            />
            <ProposalTile
              label="Never opened"
              nr
              note="which would be a claim about our silence, not theirs"
            />
            {/* NULL WITH NOTHING DECIDED. A rate over an empty denominator is
                not zero per cent, and Analytics reports this same figure from
                this same rule rather than computing a second one. */}
            <ProposalTile
              label="Won"
              value={`${d?.won_count ?? 0} of ${d?.decided_count ?? 0}`}
              nr={d?.win_rate_pct == null}
              note={d?.win_rate_pct == null
                ? 'nothing decided yet, so there is no rate'
                : `${d.win_rate_pct}% — the rate Analytics reports`}
            />
          </div>

          {d?.read_receipts_note && (
            <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.read_receipts_note}</p>
          )}

          <Instrument
            testid="all-proposals"
            title="All proposals"
            meta="Versions and outcomes · only here"
            cols="1.1fr .8fr .55fr .95fr 1.3fr"
            head={['Client', 'Shape · value', 'Ver', 'State', 'Signal']}
            rows={visible.map((r) => ({
              key: r.quote_id,
              rowClass: r.state === 'Lost' && !r.loss_reason ? 'bg-amber-50/50 dark:bg-amber-950/10' : '',
              cells: [
                r.client ? { text: r.client, sub: r.need_title || undefined } : { nr: true },
                { text: `${r.shape} · ${moneyDollars(r.price_dollars ?? 0)}` },
                {
                  text: `v${r.version}`,
                  node: r.versions.length > 0 ? (
                    <button
                      type="button" className={ghostButtonClass}
                      onClick={() => setOpenTrail(openTrail === r.quote_id ? null : r.quote_id)}
                    >
                      {openTrail === r.quote_id ? 'Hide history' : 'History'}
                    </button>
                  ) : undefined,
                },
                { pill: r.state, pillTone: STATE_TONE[r.state] || 'neutral' },
                // WHAT THIS SIDE KNOWS. Not whether they read it — and a lost
                // proposal with no reason is the row that needs a person, so it
                // says which rather than reading as finished.
                r.state === 'Lost' && !r.loss_reason
                  ? { text: r.signal, pill: 'No reason recorded', pillTone: 'warn' }
                  : { text: r.signal, sub: r.loss_reason ? LOSS_LABEL[r.loss_reason] : undefined },
              ],
            }))}
            note={'The `Signal` column is what this side of the exchange knows: when a proposal went out, how long it has been quiet, and whether it has been decided. It is deliberately not a read receipt. The artboard separates a proposal opened four times and not answered from one never opened — a decision in progress from a delivery failure — and that distinction needs an open, which is the client’s act and which nothing in this product records. Naming a silent proposal "never opened" would turn our own silence into a claim about their attention. A lost proposal with no reason recorded is tinted and marked, because it is the one row here that still needs a person: the taxonomy below can only count what somebody entered.'}
          />

          {items.length > 0 && visible.length === 0 && (
            <p className="text-[12px] text-axal-ink-2">
              No proposal is in this state. {items.length} in total.
            </p>
          )}

          {/* ══ VERSION HISTORY — the artboard's second panel ══════════════════
              Opened from the row rather than pinned to one client, because the
              artboard's `Version history · Verwood` is one firm's example of a
              panel every proposal has. */}
          {trail && (
            <Instrument
              testid="version-history"
              title={`Version history · ${trail.client || trail.need_title || 'proposal'}`}
              meta="What changed, and what it cost"
              cols="1.15fr 1fr 1.4fr"
              head={['Ver', 'What changed', 'Why']}
              rows={trail.versions.map((v) => ({
                key: v.id,
                cells: [
                  { text: `v${v.version}`, sub: formatDay(v.created_at) },
                  {
                    text: v.change_summary,
                    sub: v.price_cents == null ? undefined : moneyDollars(Math.round(v.price_cents / 100)),
                  },
                  v.note ? { text: v.note } : { nr: true },
                ],
              }))}
              note={'A version is appended, never edited: the trail is the record of what this firm conceded and when, and one that could be rewritten would not be worth keeping. The number is assigned here rather than chosen, so two people revising the same proposal cannot both claim v3. `quotes.price` stays the live figure — this is the trail behind it.'}
            />
          )}

          {/* ══ LOSS REASONS — a taxonomy, not prose ══════════════════════════ */}
          <Instrument
            testid="loss-reasons"
            title="Loss reasons"
            meta="Taxonomy, not prose"
            cols="1.15fr 1fr"
            head={['Reason', 'Count']}
            rows={[
              ...lossRows.map((r) => ({
                key: r.reason,
                cells: [
                  { text: LOSS_LABEL[r.reason] || r.reason },
                  {
                    text: String(r.count),
                    barPct: Math.round((r.count / lossMax) * 100),
                    barColor: r.reason === 'price' ? '#b91c1c' : '#d97706',
                  },
                ],
              })),
              // COUNTED, NOT FOLDED INTO `Other`. "We did not ask" is not a
              // taxonomy entry, and hiding it inside one would make the chart
              // look complete while the firm learned nothing.
              ...(d?.losses_unstated
                ? [{
                  key: '__unstated',
                  cells: [
                    { text: 'No reason recorded', sub: 'not a taxonomy entry — nobody entered one' },
                    { text: String(d.losses_unstated) },
                  ],
                }]
                : []),
            ]}
            note={'Reasons are picked from a fixed taxonomy rather than typed, and the artboard gives the reason: free text would make this chart unreadable within a quarter. The set is the one Leads uses for a pass, minus the two that cannot apply to a bid you actually made — you do not lose a deal for being under your own floor, or for a capability you just quoted on. Losses with no reason recorded are a row of their own rather than a share of Other: a chart that folded them in would look complete while the firm learned nothing from it.'}
          />

          <ZoneDraft
            surface="pipeline/proposals"
            label="Draft · win/loss read"
            accept="Accept read"
            run="Read the book"
            foot="Reasons traced to the taxonomy."
            empty="What the decided proposals have in common — which reasons recur, which shapes close, and where a loss reason is missing so the pattern cannot be read at all."
            nothingToDraft="No proposal has been decided yet, so there is no pattern to read."
          />

          <Section title="Record a version, or why one was lost">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Proposal">
                <select className={inputClass} value={openTrail || ''}
                  onChange={(e) => setOpenTrail(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Choose one</option>
                  {items.map((r) => (
                    <option key={r.quote_id} value={r.quote_id}>
                      {r.client || r.need_title} · v{r.version}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="What changed" hint="In your words — “Split into 3 phases, same total”.">
                <input className={inputClass} value={draft.change_summary} maxLength={400}
                  onChange={(e) => setDraft({ ...draft, change_summary: e.target.value })} />
              </Field>
              <Field label="Why" hint="Usually about the client: what they asked for.">
                <input className={inputClass} value={draft.note} maxLength={600}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </Field>
              <Field label="New price" hint="Leave empty where the shape changed and the money did not.">
                <input className={inputClass} value={draft.price} inputMode="decimal" placeholder="e.g. 41000"
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
              </Field>
            </div>
            <button
              type="button" className={`${buttonClass} mt-3`}
              disabled={busy || !openTrail || !draft.change_summary.trim()}
              onClick={async () => {
                await run(
                  () => api.addPartnerProposalVersion(openTrail, {
                    change_summary: draft.change_summary,
                    note: draft.note,
                    // DOLLARS IN THE BOX, CENTS ON THE WIRE. Every new money
                    // column in this bucket is integer cents; the field asks
                    // for the figure a person says out loud.
                    price_cents: draft.price.trim() === ''
                      ? null : Math.round(Number(draft.price) * 100),
                  }),
                  'Version recorded.', 'version',
                );
                setDraft({ change_summary: '', note: '', price: '' });
              }}
            >
              Add the version
            </button>
            <SaveNote note={note?.scope === 'version' ? note : null} />

            {items.some((r) => r.state === 'Lost') && (
              <div className="mt-5 border-t border-axal-hairline pt-4 dark:border-gray-700">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                  Why a proposal was lost
                </div>
                <div className="mt-2 space-y-2">
                  {items.filter((r) => r.state === 'Lost').map((r) => (
                    <div key={r.quote_id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span className="font-semibold">{r.client || r.need_title}</span>
                      <select
                        className={`${inputClass} max-w-[220px]`}
                        value={r.loss_reason || ''}
                        disabled={busy}
                        onChange={(e) => run(
                          () => api.setPartnerProposalOutcome(r.quote_id, {
                            loss_reason: e.target.value || null,
                          }),
                          'Reason recorded.', `loss:${r.quote_id}`,
                        )}
                      >
                        <option value="">Not recorded</option>
                        {Object.entries(LOSS_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <SaveNote note={String(note?.scope || '').startsWith('loss:') ? note : null} />
              </div>
            )}
          </Section>

          <StatedLimit title="What this page cannot see">
            <p>
              <strong>Nothing records that a client opened a proposal.</strong>{' '}
              There is no client-side surface to record it on, so a proposal that
              has gone quiet cannot be told from one that was never read — which
              is exactly the distinction the design asks for, and exactly the one
              this build has to refuse. Calling a silent proposal “never opened”
              would turn our own silence into a claim about their attention.
            </p>
            <p className="mt-2">
              <strong>A version trail is appended, never edited.</strong> It is
              the record of what this firm conceded and when, so nothing here
              rewrites an earlier version and the number is assigned rather than
              chosen. The quote’s own price stays the live figure.
            </p>
            <p className="mt-2">
              <strong>A loss reason comes from the taxonomy or it is absent.</strong>{' '}
              Free text would make the chart unreadable within a quarter, and a
              loss nobody gave a reason for is counted on its own rather than
              folded into <em>Other</em> — a chart that hid them would look
              complete while telling the firm nothing.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
