import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../ui';
import { api } from '../../lib/api';
import {
  Field, NothingYet, SaveNote, StatedLimit, ZoneBody, ZoneHeading, buttonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { Instrument, NotRecorded } from '../../workspaces/canvasKit';

/**
 * Research · Market — what comparable engagements go for, and how old that is.
 *
 * WHAT THIS REPLACED, AND WHY IT WAS NOT A RETROFIT. `/research/markets` mounted
 * `SignalsPage` — the `market_intel_rows` sector feed, 197k rows and ingesting
 * daily. The `pr3` artboard is about a different object: comparable RANGES for
 * the firm's own service lines, each attachable to a proposal so a client can
 * see the reasoning behind a quoted number. Its table is `Reading · Comparable
 * range · Run date · Age · Proposal attachment`. A sector signal is not a price,
 * and no amount of layout makes one into the other; the feed keeps its own
 * route at `/signals`, linked below, and is not retired.
 *
 * AGE IS A GATE, NOT A LABEL — the artboard says so in its own subtitle and it
 * is the whole composition. A reading past ninety days is BLOCKED from
 * attachment rather than marked stale, because "a client shown a range from May,
 * presented as current reasoning behind a September quote, is a worse outcome
 * than a proposal with no market figure at all". One at sixty-one days is
 * ageing and still attachable, with its age on the row so the person attaching
 * it decides knowingly.
 *
 * `STALE_AT` AND `AGE_AT` ARE THIS ARTBOARD'S OWN NUMBERS, transcribed and not
 * chosen: ninety and thirty, where `Pages · Advisor Research` says a hundred and
 * twenty. They lived in `SignalsPage`'s `MARKETS_STRIP` and moved here with the
 * zone.
 *
 * A READING IS ENTERED, NEVER GENERATED. There is no comparables database in
 * this product, so a `Re-run stale` that called a model would invent a market
 * figure in the exact voice a researched one uses — the failure D9/D12 withdrew
 * four tabs for, with a currency symbol in front of it. It reopens the form,
 * pre-filled with the service line that needs re-reading. Migration 223's
 * schema refuses a range without its comparable count and its run date, on the
 * same grounds `research_benchmarks` refuses a peer figure without its source
 * and sample size.
 */

// The artboard's own windows. Age is computed from `ran_at` and from nothing
// else: `updated_at` moves when a row is touched, which would make every
// reading look current the moment anyone edited one.
export const STALE_AT = 90;
export const AGE_AT = 30;

const usd = (cents) => `$${Math.round((cents ?? 0) / 100).toLocaleString('en-US')}`;
const daysSince = (iso) => {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? Math.floor((Date.now() - at) / 86400000) : null;
};

/**
 * A reading's age band, or null when it has never been run.
 *
 * NULL IS ITS OWN ANSWER and never falls into `Stale`. A service line nobody has
 * priced the market for has not gone out of date — there is nothing to have
 * aged — and sorting it into the stale bucket would tell a firm to re-run a
 * reading it has never run once.
 */
export function ageBand(days) {
  if (days === null) return null;
  if (days > STALE_AT) return 'stale';
  if (days > AGE_AT) return 'ageing';
  return 'current';
}

const BAND_PILL = { current: ['Current', 'ok'], ageing: ['Ageing', 'warn'], stale: ['Stale', 'danger'] };

/** The four chips, as predicates over the assembled rows. */
const NARROW = {
  current: (r) => r.band === 'current' || r.band === 'ageing',
  stale: (r) => r.band === 'stale',
  attached: (r) => r.attached,
};

export default function MarketZone({ zoneActions, zoneFilters, role = 'partner' }) {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [attachments, setAttachments] = useState([]);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const r = await api.research.marketReadings();
      setState({ loading: false, error: '', items: r?.items || [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your readings could not be read.', items: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let live = true;
    api.research.attachments('reading')
      .then((r) => { if (live) setAttachments(r?.items || []); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const attachedKeys = useMemo(() => new Set(attachments.map((a) => a.ref_key)), [attachments]);

  const rows = useMemo(() => state.items.map((r) => {
    const days = daysSince(r.ran_at);
    return {
      ...r,
      days,
      band: ageBand(days),
      attached: r.uid ? attachedKeys.has(r.uid) : false,
    };
  }), [state.items, attachedKeys]);

  const visible = NARROW[filter] ? rows.filter(NARROW[filter]) : rows;
  const choose = (key) => setFilter((current) => (current === key ? 'all' : key));

  // COUNTED OVER EVERY READING, NEVER OVER THE CHIP-NARROWED LIST. A tile that
  // changes because you clicked a chip is not reporting what it claims to.
  const attachable = rows.filter((r) => r.band === 'current' || r.band === 'ageing');
  const stale = rows.filter((r) => r.band === 'stale');
  const widest = attachable.reduce((best, r) => (
    (r.range_high_cents - r.range_low_cents) > ((best?.range_high_cents ?? 0) - (best?.range_low_cents ?? 0)) ? r : best
  ), null);
  const neverRun = rows.filter((r) => r.band === null);

  const openForm = (row) => setForm({
    offering_uid: row?.offering_uid || '',
    metric: row?.metric || '',
    low: '', high: '', n: '', ran_at: new Date().toISOString().slice(0, 10),
  });

  const save = async (e) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setNote(null);
    try {
      await api.research.marketReadingCreate({
        offering_uid: form.offering_uid || undefined,
        metric: form.metric,
        range_low_cents: Math.round(Number(form.low) * 100),
        range_high_cents: Math.round(Number(form.high) * 100),
        comparable_count: Number(form.n),
        ran_at: form.ran_at,
      });
      setForm(null);
      setNote({ ok: true, text: 'Recorded. It is attachable from today.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That reading could not be saved.' });
    } finally { setBusy(false); }
  };

  const handlers = {
    // Re-reading is work a person does; this opens the form on the first thing
    // that needs it rather than pretending to run anything.
    reRunStale: {
      onClick: () => openForm(stale[0] || neverRun[0]),
      disabled: stale.length === 0 && neverRun.length === 0,
      title: stale.length === 0 && neverRun.length === 0
        ? 'every service line has a current reading'
        : `record a fresh reading for ${(stale[0] || neverRun[0])?.metric}`,
    },
    attachToProposal: {
      onClick: () => { window.location.assign('/quotes'); },
      disabled: attachable.length === 0,
      title: attachable.length === 0
        ? 'nothing is inside the attachment window'
        : 'attach a current reading to one of your proposals',
    },
  };

  return (
    <div className="space-y-4">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({ value: filter, onChange: choose }) : []}
          actions={zoneActions(visible, handlers)}
        />
      )}
      <ZoneHeading
        title="Sector & pricing context"
        blurb="Comparable ranges with run dates and attachment state. A reading past ninety days is blocked from a proposal rather than merely marked."
      />

      {/* THE ARTBOARD'S FOUR TILES. Three count rows; the fourth is the
          reader's-data case (D68) — a service line the firm has never priced
          the market for is a fact about their own record, and the most
          actionable line on the page. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Attachable now" value={state.loading ? undefined : attachable.length} note={`within ${STALE_AT} days`} />
        <Tile label="Stale" value={state.loading ? undefined : stale.length} note="blocked until re-run" />
        <Tile
          label="Widest range"
          value={widest ? `${usd(widest.range_low_cents)}–${usd(widest.range_high_cents)}` : undefined}
          nr={!state.loading && !widest}
          note={widest ? `${widest.metric}, ${widest.comparable_count} comparables` : 'no reading is inside the window'}
        />
        <Tile
          label="Never run"
          value={state.loading ? undefined : neverRun.length}
          note={neverRun.length ? `${neverRun[0].metric} and others have no reading` : 'every service line has one'}
        />
      </div>

      <ZoneBody
        loading={state.loading}
        error={state.error}
        onRetry={load}
        isEmpty={!state.loading && !state.error && rows.length === 0}
        empty={(
          <NothingYet
            title="No service line to price yet"
            body="A reading is a comparable range for something you sell, so it needs a service line to be about. Add one to your catalog and it appears here waiting for its first reading."
            action={(
              <p className="text-[12px]">
                <Link to="/offers/catalog" className="text-axal-violet underline">Open your catalog →</Link>
              </p>
            )}
          />
        )}
      >
        <Instrument
          testid="market-readings"
          title="Readings"
          meta="Age is a gate on attachment, not a label"
          cols="1.9fr 1.3fr 1.2fr 1.3fr 1.3fr"
          head={['Reading', 'Comparable range', 'Run date', 'Age', 'Proposal attachment']}
          rows={visible.map((r) => ({
            key: r.uid || r.offering_uid || r.metric,
            rowClass: r.band === 'stale'
              ? 'bg-red-50/40 dark:bg-red-950/20'
              : (r.band === null ? 'bg-gray-50/60 dark:bg-gray-900/40' : ''),
            cells: [
              { text: r.metric },
              r.range_low_cents == null
                ? { nr: true }
                : { text: `${usd(r.range_low_cents)} – ${usd(r.range_high_cents)}` },
              r.ran_at
                ? { text: r.ran_at, sub: `${r.comparable_count} comparable${r.comparable_count === 1 ? '' : 's'}` }
                : { nr: true },
              r.days === null
                ? { nr: true }
                : {
                  text: `${r.days} d old`,
                  ...(r.band === 'stale'
                    ? { stale: 'Blocked from proposals' }
                    : { pill: BAND_PILL[r.band][0], pillTone: BAND_PILL[r.band][1] }),
                },
              // THE COLUMN THE WHOLE ARTBOARD IS FOR. Three outcomes, not two:
              // attachable, blocked, and nothing to attach — and the third is
              // not a weaker version of the second.
              r.days === null
                ? { text: 'Nothing to attach' }
                : (r.band === 'stale'
                  ? { text: 'Re-run before attaching' }
                  : { text: r.attached ? 'Attached' : 'Attachable', ...(r.attached ? { pill: 'Attached', pillTone: 'ok' } : {}) }),
            ],
          }))}
          note={`A reading past ${STALE_AT} days is blocked from attachment rather than labelled: a client shown a range from four months ago, presented as the current reasoning behind today's quote, is a worse outcome than a proposal carrying no market figure at all. One past ${AGE_AT} days is ageing and still attachable, with its age on the row so whoever attaches it decides knowingly. A service line with no reading has not gone out of date — there is nothing to have aged — which is why it reads "Not recorded" and not "Stale".`}
        />

        {!visible.length && rows.length > 0 && (
          <p className="text-[12px] text-gray-600 dark:text-gray-300">
            {filter === 'stale'
              ? 'Nothing is past the attachment window.'
              : (filter === 'attached'
                ? 'No reading is attached to a proposal yet.'
                : 'No reading matches this view.')}
          </p>
        )}

        {form && (
          <Card padding="lg">
            <form onSubmit={save}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Field label="Reading" hint="The service line this prices.">
                  <input className={inputClass} value={form.metric} readOnly={!!form.offering_uid}
                    onChange={(e) => setForm({ ...form, metric: e.target.value })} />
                </Field>
                <Field label="Low (USD)">
                  <input className={inputClass} inputMode="numeric" value={form.low}
                    onChange={(e) => setForm({ ...form, low: e.target.value })} />
                </Field>
                <Field label="High (USD)">
                  <input className={inputClass} inputMode="numeric" value={form.high}
                    onChange={(e) => setForm({ ...form, high: e.target.value })} />
                </Field>
                <Field label="Comparables" hint="How many engagements the range came from.">
                  <input className={inputClass} inputMode="numeric" value={form.n}
                    onChange={(e) => setForm({ ...form, n: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="submit" className={buttonClass} disabled={busy}>
                  {busy ? 'Recording…' : 'Record this reading'}
                </button>
                <button type="button" className="text-[11px] text-gray-500 underline" onClick={() => setForm(null)}>
                  Cancel
                </button>
              </div>
              <SaveNote note={note} />
            </form>
          </Card>
        )}

        {!form && (
          <p className="text-[12px]">
            <button type="button" className="text-axal-violet underline" onClick={() => openForm(null)}>
              Record a reading →
            </button>
          </p>
        )}

        <ZoneDraft
          surface="research/market"
          label="Reading · demand movement"
          accept="Accept reading"
          run="Draft the reading"
          foot="Run dates carried into any attachment."
          empty="Reads across your current readings and says which way the ranges have moved and on how thin a base — and names the ones to re-run before the next proposal cites them."
          nothingToDraft="Record a reading first — there is nothing to read across yet."
        />
      </ZoneBody>

      <StatedLimit title="Where these numbers come from">
        <p>
          A reading is what you found, recorded by you. There is no comparables database behind
          this page, and there is not going to be one that this product invents: a range
          generated by a model would read exactly like a researched one, with a currency symbol
          in front of it.
        </p>
        <p>
          So a range is refused without the number of comparables it came from and the date you
          ran it. Both appear on the row, and both travel with it onto any proposal.
        </p>
        <p>
          Sector signals — who is hiring, who filed, where demand is moving — are a different
          feed and live on{' '}
          <Link to="/signals" className="text-axal-violet underline">Signals</Link>. This page is
          about prices.
        </p>
      </StatedLimit>
    </div>
  );
}

/**
 * A strip tile. `Stat` prints an em-dash for a null, which reads as a value;
 * `nr` draws the artboard's own `Not recorded` chip instead.
 */
function Tile({ label, value, note, nr = false }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300">{label}</div>
      <div className="mt-1.5">
        {nr ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
            {value === undefined ? '—' : value}
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{note}</div>
    </Card>
  );
}
