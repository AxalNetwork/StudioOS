import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Card, Pill } from '../../ui';
import { api } from '../../lib/api';
import {
  Field, NothingYet, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneToolbar from '../../workspaces/ZoneToolbar';

/**
 * Research · Benchmarking — a comparison, and the base it rests on.
 *
 * THIS ZONE EXISTED AS A REFUSAL, and the refusal was right: "A benchmark drawn
 * from three companies and presented without its base is arithmetic wearing a
 * metric's clothes." Migration 217 turns that sentence into a CHECK — a peer
 * figure without both its source and its sample size cannot be written at all,
 * by this form or by any future writer. So the page never has to decide whether
 * to trust a row: a row that exists carries its base.
 *
 * A ROW WITH NO PEER FIGURE IS STILL WELCOME, and is a different thing. It is a
 * metric you are tracking, not a comparison, and the two render differently
 * because they support different claims. Only comparisons are counted as such.
 *
 * THE SMALLEST SAMPLE IS SAID ONCE, AT THE TOP. A reader scanning eight rows
 * will not open each to find that one median came from four funds — and that
 * one row is the one most likely to be quoted. The worker returns the weakest
 * base on the page and the sentence that goes with it.
 *
 * VALUES ARE TEXT ON PURPOSE. The canvas's own rows are TVPI 1.4x, DPI 0.2x,
 * reserve ratio 18%, IRR 24% — multiples, ratios and percentages in one column.
 * Storing them as numbers would either lose the unit or need a second column to
 * carry it, and a benchmark whose unit is implicit is how 1.4 gets read as a
 * percentage.
 */

const EMPTY = { metric: '', our_value: '', peer_value: '', peer_source: '', peer_sample_size: '', peer_as_of: '', reading: '' };
const TILES = [
  ['Metrics', 'metric_count'], ['With a peer set', 'comparison_count'],
  ['No read yet', 'unread_count'], ['Smallest sample', 'smallest_sample_size'],
];

export default function BenchmarkingZone({ zoneActions, zoneFilters, role = 'founder' }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  // `Metrics` is everything and `Peer set` is the rows that carry a comparison.
  // The page already draws the distinction on every row — a benchmark without a
  // peer figure reads `Tracked, not compared` — so the chip narrows to a split
  // the reader can already see.
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const metricInput = useRef(null);
  const formOpen = showForm || !zoneActions || role !== 'investor';
  const openForm = () => {
    if (formOpen) metricInput.current?.focus();
    else setShowForm(true);
  };
  useEffect(() => {
    if (showForm) metricInput.current?.focus();
  }, [showForm]);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.research.benchmarks();
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e?.detail || e?.message || 'The benchmark set did not load.', data: null });
    }
  }, []);
  // D6275: every arrival re-reads the list, keyed to the navigation rather
  // than to the mount, so a benchmark deleted on its own page is gone here
  // even when the zone stayed mounted behind it.
  const location = useLocation();
  const removed = location.state?.removedBenchmark || null;
  useEffect(() => { load(); }, [load, location.key]);

  const add = async (event) => {
    event.preventDefault();
    if (!form.metric.trim() || busy) return;
    setBusy(true);
    try {
      await api.research.benchmarkCreate({
        ...form,
        peer_sample_size: form.peer_sample_size === '' ? null : Number(form.peer_sample_size),
      });
      setForm(EMPTY);
      setSaved('Added.');
      await load();
    } catch (e) {
      setSaved(e?.detail || e?.message || 'That did not save.');
    } finally { setBusy(false); }
  };

  const data = state.loading || state.error ? null : state.data;
  const items = data?.items || [];
  const visible = items.filter((b) => (
    (filter !== 'comparison' || b.is_comparison) && (filter !== 'unread' || !b.reading)
  ));
  if (sort === 'metric') visible.sort((a, b) => a.metric.localeCompare(b.metric));
  // The form asks for a peer figure and its base together, because the route
  // and the schema both refuse them apart.
  const wantsPeer = Boolean(form.peer_value.trim());

  return (
    <div className="space-y-6">
      {zoneActions && (
        <ZoneToolbar
          role={role}
          className="mb-3"
          filters={zoneFilters ? zoneFilters({ value: filter, onChange: setFilter }) : []}
          actions={zoneActions(visible, { newBenchmark: openForm })}
        />
      )}
      <ZoneHeading
        title="Fund & manager benchmarking"
        blurb="What you are measuring, what the peer set says, and how many it was measured over."
      />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES.map(([label, key]) => (
          <div key={key} data-testid={`benchmark-tile-${key}`} className="rounded-xl border border-axal-hairline px-4 py-3 dark:border-gray-700">
            <dt className="text-xs text-axal-muted dark:text-gray-400">{label}</dt>
            <dd className="m-0 mt-1 text-lg font-bold">{data?.[key] ?? 'Not recorded'}</dd>
          </div>
        ))}
      </dl>

      {removed && (
        <p data-testid="benchmark-removed" role="status" className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
          {`Deleted “${removed}” and the constituents named against it.`}
        </p>
      )}

      {data?.sample_note && (
        <Card variant="dashed" padding="lg">
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300">
            Read the base before the number
          </div>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
            {data.sample_note}
          </p>
        </Card>
      )}

      <ZoneBody
        loading={state.loading}
        error={state.error}
        isEmpty={!items.length}
        onRetry={load}
        empty={(
          <NothingYet
            title="No benchmark is recorded yet"
            body="Add a metric you are measuring. A peer figure is optional — but if you enter one, it needs its source and how many it was measured over, because that is what separates a benchmark from a number."
          />
        )}
      >
        <Card padding="lg">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-extrabold tracking-tight">Against the peer set</h3>
            <label className="text-xs text-axal-muted dark:text-gray-400">
              Sort by
              <select className={`ml-2 ${inputClass}`} value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="newest">Newest</option>
                <option value="metric">Metric A to Z</option>
              </select>
            </label>
          </div>
          {!visible.length && <p className="text-sm text-axal-muted dark:text-gray-400">No benchmarks match this view.</p>}
          <ul className="divide-y divide-axal-ground dark:divide-gray-800">
            {visible.map((b) => (
              <li key={b.uid} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  {/* D314 — each benchmark opens on its own page. */}
                  <Link
                    to={`/research/benchmarking/${encodeURIComponent(b.uid)}`}
                    className="text-[13px] font-bold text-indigo-700 hover:underline dark:text-indigo-300"
                  >
                    {b.metric}
                  </Link>
                  <span className="text-[12px] tabular-nums">
                    {b.our_value || <Unrecorded>Ours not recorded</Unrecorded>}
                  </span>
                  {b.is_comparison ? (
                    <>
                      <span className="text-[12px] text-gray-600 dark:text-gray-300">vs</span>
                      <span className="text-[12px] tabular-nums">{b.peer_value}</span>
                      <Pill tone="neutral">{`n=${b.peer_sample_size}`}</Pill>
                    </>
                  ) : (
                    <Pill tone="neutral">Tracked, not compared</Pill>
                  )}
                </div>
                {b.is_comparison && (
                  <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                    {b.peer_source}{b.peer_as_of ? ` · as of ${b.peer_as_of}` : ''}
                  </p>
                )}
                <p className="mt-1 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
                  {b.reading || <Unrecorded>No read written yet — the comparison is shown without one.</Unrecorded>}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </ZoneBody>

      <Card padding="lg" hidden={!formOpen} data-testid="benchmark-add-form">
        <h3 className="text-sm font-extrabold tracking-tight">Add a metric</h3>
        <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={add}>
          <Field label="Metric">
            <input ref={metricInput} className={inputClass} value={form.metric} maxLength={200} required
              onChange={(e) => setForm({ ...form, metric: e.target.value })} />
          </Field>
          <Field label="Ours">
            <input className={inputClass} value={form.our_value} maxLength={100}
              onChange={(e) => setForm({ ...form, our_value: e.target.value })} />
          </Field>
          <Field label="Peer figure (optional)">
            <input className={inputClass} value={form.peer_value} maxLength={100}
              onChange={(e) => setForm({ ...form, peer_value: e.target.value })} />
          </Field>
          <Field label={wantsPeer ? 'Peer source (required)' : 'Peer source'}>
            <input className={inputClass} value={form.peer_source} maxLength={300} required={wantsPeer}
              onChange={(e) => setForm({ ...form, peer_source: e.target.value })} />
          </Field>
          <Field label={wantsPeer ? 'Sample size (required)' : 'Sample size'}>
            <input className={inputClass} type="number" min="1" value={form.peer_sample_size} required={wantsPeer}
              onChange={(e) => setForm({ ...form, peer_sample_size: e.target.value })} />
          </Field>
          <Field label="Measured as of">
            <input className={inputClass} value={form.peer_as_of} maxLength={40} placeholder="2026 Q2"
              onChange={(e) => setForm({ ...form, peer_as_of: e.target.value })} />
          </Field>
          <div className="md:col-span-3">
            <Field label="What the comparison supports">
              <input className={inputClass} value={form.reading} maxLength={2000}
                onChange={(e) => setForm({ ...form, reading: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-3">
            <button type="submit" className={buttonClass} disabled={busy || !form.metric.trim()}>
              {busy ? 'Adding…' : 'Add metric'}
            </button>
            {wantsPeer && (
              <span className="ml-3 text-[11px] text-gray-600 dark:text-gray-300">
                A peer figure needs its source and sample size — the schema refuses the row without them.
              </span>
            )}
            {saved && <SaveNote>{saved}</SaveNote>}
          </div>
        </form>
      </Card>

      <StatedLimit title="Where the peer numbers come from">
        Nowhere but you. This product ships no peer data set and gathers none, so every
        comparison here is one you entered and sourced yourself. That is why the source and
        the sample travel with the figure and why nothing on this page is presented as a
        market rate.
      </StatedLimit>
    </div>
  );
}
