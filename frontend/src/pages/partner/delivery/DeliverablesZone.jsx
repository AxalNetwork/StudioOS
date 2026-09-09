import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill,
  // `StatCard` went with the four tiles it drew: the strip is the artboard's
  // own composition now, and `ShipTile` below can draw an absence as a chip
  // rather than as an em dash a reader mistakes for zero.
  Section, Field, SaveNote, NotComputable,
  UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Delivery · Deliverables — `/delivery/deliverables`.
 *
 * THE ZONE'S POINT, AND THE THING IT CANNOT DO. A deliverable sent and never
 * opened is the firm's most expensive state: invoiced, unreviewed, and blocking
 * the next milestone. That is what this log is for.
 *
 * But `opened_at` and `signed_off_at` are the CLIENT'S TO SET — migration
 * 208:160 is explicit that only the founder side can truthfully say a thing was
 * read, and a partner-side write to either would be the firm reporting a metric
 * about itself. No route accepts them and no control here offers them.
 *
 * SO ON THIS BUILD EVERY SENT DELIVERABLE READS *UNOPENED*, FOREVER. That is a
 * real consequence and it goes on the page rather than being hidden: the count
 * is true, the median time-to-open is refused outright, and the copy says the
 * unopened state means "we do not know" rather than "the client ignored it".
 * Rendering it the other way would turn a missing client-side surface into an
 * accusation about clients.
 *
 * WHAT WOULD FIX IT is a founder-side surface that records an open — not a
 * column here. Until that exists, this zone is a log of what was sent, which is
 * genuinely useful and is exactly what it claims to be.
 */

function OpenedState({ row }) {
  if (!row.sent_at) return <span className="text-axal-ink-3">Not sent yet</span>;
  if (row.signed_off_at) return <Pill tone="ok">Signed off {formatDay(row.signed_off_at)}</Pill>;
  if (row.opened_at) return <Pill tone="info">Opened {formatDay(row.opened_at)}</Pill>;
  // NOT a red "ignored" pill. The absence is ours, not the client's.
  return (
    <NotComputable why="Nothing in this product records an open — the client sets that, and there is no surface for them to set it on yet.">
      Unopened
    </NotComputable>
  );
}

function DeliverableRow({ row, busy, onSave, onDelete, note }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(row);
  useEffect(() => { setDraft(row); }, [row]);

  return (
    <div className="border-t border-axal-hairline py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-extrabold tracking-tight">{row.title}</span>
            {row.version && <Pill tone="neutral">{row.version}</Pill>}
            <OpenedState row={row} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11.5px] text-axal-ink-3">
            <span>{row.founder_name || row.need_title || row.engagement_uid}</span>
            {row.sent_at
              ? <span>sent {formatDay(row.sent_at)}{row.days_since_sent != null && ` · ${row.days_since_sent}d ago`}</span>
              : <span>not sent</span>}
            {row.link_url && (
              <a href={row.link_url} target="_blank" rel="noreferrer" className="text-amber-700 underline">
                Open link
              </a>
            )}
          </div>
        </div>
        <button type="button" className={ghostButtonClass} onClick={() => setEdit((v) => !v)}>
          {edit ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {edit && (
        <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Title">
              <input className={inputClass} value={draft.title || ''} maxLength={200}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Version" hint="Optional — v2, final, rev C.">
              <input className={inputClass} value={draft.version || ''} maxLength={60}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
            </Field>
            <Field label="Link">
              <input className={inputClass} value={draft.link_url || ''} maxLength={600}
                onChange={(e) => setDraft({ ...draft, link_url: e.target.value })} />
            </Field>
            <Field label="Sent on" hint="Empty means not sent. Clearing it un-sends the record.">
              <input className={inputClass} value={draft.sent_at || ''} maxLength={40} placeholder="2026-09-04"
                onChange={(e) => setDraft({ ...draft, sent_at: e.target.value })} />
            </Field>
          </div>
          {/*
            NO "mark opened" CONTROL, and its absence is the feature. Only the
            client can say a thing was read; a button here would let the firm
            record a metric about itself and would make every opened count in
            the product worthless.
          */}
          <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-3">
            There is no control here for “opened” or “signed off”. Those are the
            client’s to set, and this product has no surface where they can —
            so every sent item reads unopened, and that reflects us rather than
            them.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy}
              onClick={async () => { await onSave(row, draft); setEdit(false); }}>Save</button>
            <button type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
              disabled={busy} onClick={() => onDelete(row)}>Delete</button>
          </div>
          <SaveNote note={note?.scope === `dl:${row.id}` ? note : null} />
        </div>
      )}
    </div>
  );
}

/** The strip tile, in the anatomy the artboards share. */
function ShipTile({ label, value, note, nr = false }) {
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

export default function PartnerDeliverablesZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null, engagements: null });
  const [view, setView] = useState('never_opened');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ engagement_id: '', title: '', version: '', link_url: '', sent_at: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      // The engagement list comes from the health read — it is the one endpoint
      // that already returns every engagement this firm holds, and a second
      // list route would be a third place the same set is assembled.
      const [d, h] = await Promise.all([
        api.listPartnerDeliverables(),
        api.getPartnerDeliveryHealth(),
      ]);
      setState({
        loading: false,
        error: '',
        data: d || {},
        engagements: Array.isArray(h?.items) ? h.items : [],
      });
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || 'The deliverables log did not load.',
        data: null,
        engagements: null,
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
  const engagements = state.engagements || [];
  // ══ THE ARTBOARD'S FOUR TILES, COUNTED OVER THE WHOLE LOG ═══════════════
  // Never over `visible`: a figure that changes because a chip was clicked is
  // not reporting what its label claims.
  const unopened = items.filter((r) => r.sent_at && !r.opened_at);
  const signedOff = items.filter((r) => r.signed_off_at);
  const shippedThisMonth = items.filter((r) => r.days_since_sent != null && r.days_since_sent <= 31);
  const clientCount = new Set(items.map((r) => r.founder_name || r.need_title).filter(Boolean)).size;
  const oldestUnopened = useMemo(() => {
    const sent = items.filter((x) => x.is_unopened && x.days_since_sent != null);
    if (!sent.length) return null;
    return sent.reduce((a, b) => (b.days_since_sent > a.days_since_sent ? b : a));
  }, [items]);

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  // ══ THE `pd2` CHIP ROW ═══════════════════════════════════════════════════
  // `Never opened` IS THE DEFAULT because the artboard selects it (`fil([…],
  // 0)`): sent-and-not-opened is the firm's most expensive state, and a log
  // that opens on everything buries it. `By client` is an ORDERING rather than
  // a subset — it groups the same rows instead of removing any.
  const visible = (() => {
    if (view === 'never_opened') return items.filter((r) => r.sent_at && !r.opened_at);
    if (view === 'signed_off') return items.filter((r) => r.signed_off_at);
    if (view === 'by_client') {
      return [...items].sort((a, b) => String(a.founder_name || '').localeCompare(String(b.founder_name || ''))
        || String(a.title || '').localeCompare(String(b.title || '')));
    }
    if (view === 'all') return items;
    return items;
  })();

  // THE ARTBOARD'S OWN ORDER — "unopened first, oldest first within it" — and
  // it is the instrument's meta line, so the page must actually do it rather
  // than trust whatever order the read returned. `By client` is the one chip
  // that replaces this ordering, because that is what the chip IS.
  const ordered = view === 'by_client' ? visible : [...visible].sort((a, b) => {
    const au = a.sent_at && !a.opened_at ? 0 : 1;
    const bu = b.sent_at && !b.opened_at ? 0 : 1;
    return au - bu || (b.days_since_sent ?? -1) - (a.days_since_sent ?? -1);
  });

  const rowActions = partnerZoneActions('delivery/deliverables', { view: { header: ['Client', 'Deliverable', 'Version', 'Sent', 'Age', 'Opened', 'Signed off'], rows: ordered, cells: (r) => [r.founder_name, r.title, r.version, r.sent_at, r.days_since_sent, r.opened_at, r.signed_off_at] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Deliverables" actions={rowActions} />;
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('delivery/deliverables', { value: view, onChange: setView })}
        actions={rowActions}
      />
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0}
      empty={(
        <NothingYet
          title="Nothing logged yet"
          body={
            'This is the record of what the firm shipped and when. Log the first '
            + 'one and the engagement it belongs to starts carrying it — Health '
            + 'reads the same rows to see what has been sent and not opened.'
          }
          action={engagements.length > 0
            ? <button type="button" className={buttonClass} onClick={() => setAdding(true)}>Log a deliverable</button>
            : <Link to="/pipeline/proposals" className="text-[12.5px] font-semibold text-amber-700 underline">Open proposals</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="What was shipped"
          blurb={
            'Every item the firm has sent, with the engagement it belongs to. '
            + 'Whether the client opened it is theirs to record, and nothing in '
            + 'this product lets them yet — so that column says so.'
          }
          action={engagements.length > 0 && (
            <button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Log a deliverable'}
            </button>
          )}
        />

        {/* ══ THE `pd2` STRIP ══════════════════════════════════════════════
            `Never opened · Signed off · Shipped this month · Median days to
            open`. The fourth reads absent, and the artboard says why in its own
            instNote: averaging a handful of opens "would look like a metric".
            Here the reason is stronger still — `opened_at` is the CLIENT'S
            column and no founder-side surface writes it, so the sample is not
            small, it is empty. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ShipTile
            label="Never opened"
            value={String(unopened.length)}
            note={oldestUnopened
              ? `oldest ${oldestUnopened.days_since_sent} days out`
              : 'nothing sent and unopened'}
          />
          <ShipTile
            label="Signed off"
            value={String(signedOff.length)}
            note={signedOff.length ? 'the client marked it accepted' : 'nothing signed off yet'}
          />
          <ShipTile
            label="Shipped this month"
            value={String(shippedThisMonth.length)}
            note={`across ${clientCount} client${clientCount === 1 ? '' : 's'}`}
          />
          <ShipTile
            label="Median days to open"
            nr
            note="no opened_at is written anywhere, so there is no sample to take a median of"
          />
        </div>

        {d?.unopened_note && (
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.unopened_note}</p>
        )}

        {adding && (
          <div className="rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Engagement">
                <select className={inputClass} value={newItem.engagement_id}
                  onChange={(e) => setNewItem({ ...newItem, engagement_id: e.target.value })}>
                  <option value="">Choose one</option>
                  {engagements.map((e) => (
                    <option key={e.engagement_id} value={e.engagement_id}>
                      {e.founder_name || e.need_title || e.engagement_uid}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Title">
                <input className={inputClass} value={newItem.title} maxLength={200}
                  onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} />
              </Field>
              <Field label="Version">
                <input className={inputClass} value={newItem.version} maxLength={60}
                  onChange={(e) => setNewItem({ ...newItem, version: e.target.value })} />
              </Field>
              <Field label="Sent on" hint="Leave empty if it is not out yet.">
                <input className={inputClass} value={newItem.sent_at} maxLength={40} placeholder="2026-09-04"
                  onChange={(e) => setNewItem({ ...newItem, sent_at: e.target.value })} />
              </Field>
            </div>
            <button
              type="button" className={`${buttonClass} mt-3`}
              disabled={busy || !newItem.title.trim() || !newItem.engagement_id}
              onClick={async () => {
                await run(
                  () => api.createPartnerDeliverable(newItem.engagement_id, newItem),
                  'Logged.', 'new',
                );
                setNewItem({ engagement_id: '', title: '', version: '', link_url: '', sent_at: '' });
                setAdding(false);
              }}
            >
              Log it
            </button>
            <SaveNote note={note?.scope === 'new' ? note : null} />
          </div>
        )}

        <Instrument
          testid="shipped-log"
          title="Shipped log"
          meta="Unopened first, oldest first within it"
          cols="1fr 2.1fr .8fr .9fr 1.1fr"
          head={['Client', 'Deliverable', 'Sent', 'Age', 'Acknowledgment']}
          rows={ordered.map((row) => {
            const isUnopened = Boolean(row.sent_at && !row.opened_at);
            return {
              key: row.id,
              rowClass: isUnopened ? 'bg-red-50/40 dark:bg-red-950/10' : '',
              cells: [
                row.founder_name ? { text: row.founder_name } : { nr: true },
                { text: row.title, sub: row.version ? `v${row.version}` : undefined },
                row.sent_at ? { text: formatDay(row.sent_at) } : { nr: true },
                // AGE IS SINCE SENDING, and it is the number the row is sorted
                // by. An unsent draft has no age, which is not the same as an
                // age of zero.
                row.days_since_sent == null
                  ? { nr: true }
                  : { text: `${row.days_since_sent} d ago` },
                // THE ONE COLUMN THIS PRODUCT CANNOT FILL FROM ITS OWN SIDE.
                // `opened_at` and `signed_off_at` are the CLIENT'S to set —
                // migration 208 says so and no route here accepts either — so a
                // sent-and-unopened row says exactly that rather than claiming
                // the client ignored it.
                row.signed_off_at
                  ? { pill: 'Signed off', pillTone: 'ok' }
                  : (row.opened_at
                    ? { pill: 'Opened', pillTone: 'info' }
                    : (row.sent_at
                      ? { pill: 'Never opened', pillTone: 'danger', sub: 'or opened without telling us' }
                      : { pill: 'Not sent', pillTone: 'neutral' })),
              ],
            };
          })}
          note={'The unopened rows lead the page and tint red because work delivered into silence is the firm\u2019s most expensive state: invoiced, unreviewed, and blocking the next milestone — which is also why an engagement with unopened deliverables reads at risk on the board. `Median days to open` is absent rather than averaged, and the reason here is stronger than the artboard\u2019s "too few opened items": `opened_at` is the client\u2019s column, no founder-side surface writes it, and a median over a column nobody writes would be a number about our own silence. `Never opened` means exactly sent-and-not-acknowledged-here, never that the client ignored it.'}
        />

        <ZoneDraft
          surface="delivery/deliverables"
          label="Draft · unopened chase"
          accept="Accept drafts"
          run="Draft the chases"
          foot={`${unopened.length} note${unopened.length === 1 ? '' : 's'}; a human sends each.`}
          empty="A chase note per unopened deliverable — the item, the date it went out, and what the review unblocks, for a person to send from the account that shipped it."
          nothingToDraft="Nothing is sent and unopened, so there is nothing to chase."
        />

        <Section title="Log">
          <div>
            {ordered.map((row) => (
              <DeliverableRow
                key={row.id}
                row={row}
                busy={busy}
                note={note}
                onSave={(r, draft) => run(
                  () => api.updatePartnerDeliverable(r.id, {
                    title: draft.title, version: draft.version,
                    link_url: draft.link_url, sent_at: draft.sent_at || null,
                  }),
                  'Saved.', `dl:${r.id}`,
                )}
                onDelete={(r) => run(
                  () => api.deletePartnerDeliverable(r.id),
                  'Deleted.', `dl:${r.id}`,
                )}
              />
            ))}
          </div>
        </Section>

        <StatedLimit title="What “unopened” means here, and what it does not">
          <p>
            <strong>It means we do not know.</strong>{' '}
            {d?.median_days_to_open_note
              || 'Nothing in this product records an open, so every sent deliverable reads unopened.'}{' '}
            The count above is true and the reason is ours: <code>opened_at</code>{' '}
            is the client’s column to set and there is no surface where they can.
            Reading it as “the client ignored it” would turn a gap in our product
            into an accusation about them.
          </p>
          <p className="mt-2">
            <strong>No control here can mark one opened.</strong> Only the
            founder side can truthfully say a thing was read. A button on this
            page would let the firm record a metric about itself, which would
            make every opened figure in the product worth nothing — the same rule
            that governs consent on{' '}
            <Link to="/offers/proof" className="text-amber-700 underline">Offers · Proof</Link>.
          </p>
          <p className="mt-2">
            <strong>No median, and no chart of one.</strong> A median over a
            column nobody writes is a number about our own silence, not about
            client behaviour. It stays an em-dash until a founder-side surface
            exists.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
    </>
  );
}
