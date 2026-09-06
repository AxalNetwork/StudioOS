import React, { useCallback, useEffect, useState } from 'react';
import { Card, Pill } from '../../ui';
import { api } from '../../lib/api';
import {
  Field, NothingYet, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, inputClass,
} from '../advisor/expertise/kit';
import ZoneActions from '../../workspaces/ZoneActions';

/**
 * Research · Funds — the funds you have researched, and what the research said.
 *
 * FIT AND ACCESS ARE TWO QUESTIONS, and the canvas asks both at once. Its pills
 * read "Warm path", "Right stage", "Wrong stage", "Passed", which look like one
 * column and are not: a fund can write at your stage AND be someone you have a
 * route to, and those are the ones worth the meeting. Migration 216 keeps them
 * apart — `stage_fit`, `path` and `status` — so a founder never has to pick
 * which true thing to record.
 *
 * NOT ASSESSED IS NOT WRONG. `stage_fit` is null until you decide, and a null
 * renders as "Not assessed" rather than as a wrong-stage pill. Rendering the
 * two the same way is how a fund you have not looked at yet ends up filtered
 * out of your own shortlist.
 *
 * A PASS IS WORTH RECORDING ONLY WITH ITS REASON. The canvas row is explicit —
 * "One thesis mismatch, one 'too early — return at $30k MRR'. Both worth
 * revisiting." A pass with no reason is indistinguishable from a fund nobody
 * reached, and three months later you research it again. The zone counts the
 * passes missing one rather than letting them blend in.
 *
 * THE CHEQUE-OVERLAP FIGURE CAN BE ABSENT, and that is not the same as zero.
 * It compares a fund's range against the round you are raising, which lives on
 * the project as `raise_target_usd`. With no target recorded there is no ask to
 * compare against, and the worker returns the count as null with its reason
 * rather than as 0 — which would say no fund writes cheques your size.
 */

const STAGE_LABEL = { right: 'Right stage', wrong: 'Wrong stage' };
const PATH_LABEL = { warm: 'Warm path', cold: 'No route in' };
const FILTERS = [
  ['all', 'All'],
  ['right', 'Right stage'],
  ['warm', 'Warm path'],
  ['passed', 'Passed'],
];

const usd = (cents) => (cents === null || cents === undefined
  ? null
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(Number(cents) / 100));

function cheque(row) {
  const lo = usd(row.cheque_min_cents);
  const hi = usd(row.cheque_max_cents);
  if (lo && hi) return lo === hi ? lo : `${lo}–${hi}`;
  return lo || hi || null;
}

export default function FundsZone({ zoneActions }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ name: '', thesis: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.research.funds();
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e?.detail || e?.message || 'The fund list did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      await api.research.fundCreate({ name: form.name, thesis: form.thesis, note: form.note });
      setForm({ name: '', thesis: '', note: '' });
      setSaved('Added.');
      await load();
    } catch (e) {
      setSaved(e?.detail || e?.message || 'That did not save.');
    } finally { setBusy(false); }
  };

  const data = state.data;
  const items = data?.items || [];
  const visible = items.filter((f) => {
    if (filter === 'right') return f.stage_fit === 'right';
    if (filter === 'warm') return f.path === 'warm';
    if (filter === 'passed') return f.status === 'passed';
    return true;
  });

  return (
    <div className="space-y-6">
      {zoneActions && <ZoneActions className="mb-3" items={zoneActions(visible)} />}
      <ZoneHeading
        title="Fund research"
        sub="Investor research and fit scores — every fund you have looked into, and why it is on or off the list."
        right={data ? <Pill tone={data.warm_path_count ? 'ok' : 'neutral'}>{`${data.warm_path_count} with a route in`}</Pill> : null}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Researched" value={data?.researched_count} note="funds on file" />
        <Stat label="Right stage" value={data?.right_stage_count} note="they write where you are" />
        <Stat
          label="Cheque overlap"
          value={data?.cheque_overlap_count}
          note={data?.cheque_overlap_note || 'your ask fits their range'}
        />
        <Stat
          label="Passed"
          value={data?.passed_count}
          note={data?.passed_without_reason
            ? `${data.passed_without_reason} with no reason recorded`
            : 'reasons recorded'}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
              filter === key
                ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                : 'border-axal-hairline text-gray-600 dark:border-gray-700 dark:text-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ZoneBody
        loading={state.loading}
        error={state.error}
        isEmpty={!items.length}
        onRetry={load}
        empty={(
          <NothingYet
            title="No fund is on your list yet"
            body="Add the funds you are researching. What goes in is your own reading — their thesis in their words, whether they write at your stage, and whether you have a route in."
          />
        )}
      >
        <Card padding="lg">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-extrabold tracking-tight">Fund profiles</h3>
            <span className="text-[11px] text-gray-600 dark:text-gray-300">
              Thesis in their own words · what the research says
            </span>
          </div>
          {!visible.length ? (
            <p className="text-[12.5px] text-gray-600 dark:text-gray-300">No fund matches this filter.</p>
          ) : (
            <ul className="divide-y divide-axal-ground dark:divide-gray-800">
              {visible.map((f) => (
                <li key={f.uid} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <strong className="text-[13px]">{f.name}</strong>
                    {f.status === 'passed' && <Pill tone="danger">Passed</Pill>}
                    {f.path && <Pill tone={f.path === 'warm' ? 'ok' : 'neutral'}>{PATH_LABEL[f.path]}</Pill>}
                    <Pill tone={f.stage_fit === 'right' ? 'ok' : f.stage_fit === 'wrong' ? 'warn' : 'neutral'}>
                      {STAGE_LABEL[f.stage_fit] || 'Stage not assessed'}
                    </Pill>
                    <span className="ml-auto text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
                      {cheque(f) || <Unrecorded>Cheque range not recorded</Unrecorded>}
                    </span>
                  </div>
                  {f.thesis && <p className="mt-1 text-[12px] italic leading-relaxed text-gray-600 dark:text-gray-300">“{f.thesis}”</p>}
                  {f.note && <p className="mt-1 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{f.note}</p>}
                  {f.status === 'passed' && (
                    <p className="mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
                      {f.pass_reason
                        ? `Passed: ${f.pass_reason}`
                        : <Unrecorded>Passed with no reason recorded — worth adding one before you rediscover them.</Unrecorded>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </ZoneBody>

      <Card padding="lg">
        <h3 className="text-sm font-extrabold tracking-tight">Add a fund</h3>
        <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={add}>
          <Field label="Fund">
            <input className={inputClass} value={form.name} maxLength={200} required
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Their thesis, in their words">
            <input className={inputClass} value={form.thesis} maxLength={2000}
              onChange={(e) => setForm({ ...form, thesis: e.target.value })} />
          </Field>
          <Field label="What the research says">
            <input className={inputClass} value={form.note} maxLength={2000}
              onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="md:col-span-3">
            <button type="submit" className={buttonClass} disabled={busy || !form.name.trim()}>
              {busy ? 'Adding…' : 'Add fund'}
            </button>
            {saved && <SaveNote>{saved}</SaveNote>}
          </div>
        </form>
      </Card>

      <StatedLimit title="What this page will not do">
        Nothing here scores a fund for you, ranks your list, or drafts an approach. A fit
        score assembled from a thesis paragraph would be a number with no method behind it,
        and the reading that matters — why their last two leads had a design partner in the
        deck — is yours to write.
      </StatedLimit>
    </div>
  );
}

/** A figure the store actually returned, or the reason it is absent. */
function Stat({ label, value, note }) {
  const absent = value === null || value === undefined;
  return (
    <Card padding="md">
      <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-gray-600 dark:text-gray-300">{label}</div>
      <div className="mt-1 text-[18px] font-extrabold tracking-tight tabular-nums">
        {absent ? <Unrecorded>Not recorded</Unrecorded> : value}
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-gray-600 dark:text-gray-300">{note}</div>
    </Card>
  );
}
