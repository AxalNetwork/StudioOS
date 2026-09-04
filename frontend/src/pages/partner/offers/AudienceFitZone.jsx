import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  StatCard, Section, Field, SaveNote, NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, moneyCents, dollarsToCents,
} from '../kit';

/**
 * Offers · Audience fit — `/offers/audience-fit`.
 *
 * THE WORKING HALF OF THIS ZONE IS WHO THE FIRM IS NOT FOR. A stated budget
 * floor, sectors declined, capabilities honestly absent. That is what lets
 * Pipeline pass a lead with a named reason instead of silence — and a pass with
 * a reason and a pass without one are very different things to receive. Passing
 * quietly costs the founder a week; passing with "we start at $25k, and Kestrel
 * do this well below that" costs them nothing and may still help.
 *
 * SO `statement` IS THE FIELD THAT MATTERS, not the threshold. A rule with a
 * floor and no sentence produces exactly the silence the zone exists to
 * replace, so the count of unstated rules is on the stat strip rather than left
 * for the reader to notice row by row.
 *
 * `referred_to` IS PART OF THE RULE, not a note on it. A rule that cannot carry
 * the alternative cannot produce the sentence above.
 *
 * NOTHING RUNS THESE. No lead is scored, filtered or auto-declined against a
 * rule here, and the worker says so in its own response (`enforcement: 'none'`)
 * rather than leaving the page to imply whatever it likes. The rules are a
 * record a person reads before deciding — which is the honest description of
 * what they are today, and the one the rail's "no lead is passed or pursued
 * except on your click" already promises.
 */

const KINDS = [
  ['budget_floor', 'Budget floor', 'The smallest engagement worth starting.'],
  ['sector_declined', 'Sector declined', 'Work the firm turns down on principle or on fit.'],
  ['capability_absent', 'Capability absent', 'Something the firm does not do, said plainly.'],
  ['best_fit', 'Best fit', 'Who the firm is actually for.'],
];
const KIND_LABEL = Object.fromEntries(KINDS.map(([v, l]) => [v, l]));
const KIND_TONE = {
  best_fit: 'ok', budget_floor: 'info', sector_declined: 'neutral', capability_absent: 'neutral',
};

function RuleForm({ initial, onSubmit, onCancel, busy, submitLabel }) {
  const [kind, setKind] = useState(initial?.kind || 'best_fit');
  const [floor, setFloor] = useState(
    initial?.floor_cents != null ? String(initial.floor_cents / 100) : '',
  );
  const [value, setValue] = useState(initial?.value || '');
  const [statement, setStatement] = useState(initial?.statement || '');
  const [referredTo, setReferredTo] = useState(initial?.referred_to || '');
  const [floorError, setFloorError] = useState('');

  const isFloor = kind === 'budget_floor';

  function submit() {
    const parsed = dollarsToCents(floor);
    if (isFloor && parsed.error) { setFloorError(parsed.error); return; }
    if (isFloor && parsed.cents === null) { setFloorError('A budget floor needs an amount'); return; }
    setFloorError('');
    onSubmit({
      kind,
      floor_cents: isFloor ? parsed.cents : null,
      value: isFloor ? (value.trim() || null) : value.trim(),
      statement: statement.trim() || null,
      referred_to: referredTo.trim() || null,
    });
  }

  return (
    <div className="rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Kind">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {isFloor ? (
          <Field label="Floor" hint={floorError || 'The smallest engagement worth starting.'}>
            <input className={inputClass} value={floor} inputMode="decimal" placeholder="e.g. 25000"
              onChange={(e) => setFloor(e.target.value)} />
          </Field>
        ) : (
          <Field label="What it is about" hint="A sector, a capability, or the shape of client this fits.">
            <input className={inputClass} value={value} maxLength={200}
              onChange={(e) => setValue(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="mt-3 grid gap-3">
        <Field
          label="The sentence a pass quotes"
          hint="This is the field that matters. Without it, a pass is silence — which is what this zone exists to replace."
        >
          <textarea className={inputClass} rows={2} value={statement} maxLength={1000}
            onChange={(e) => setStatement(e.target.value)} />
        </Field>
        <Field
          label="Who to send them to instead"
          hint="Optional, and the difference between a pass that wastes a week and one that does not."
        >
          <input className={inputClass} value={referredTo} maxLength={300}
            onChange={(e) => setReferredTo(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={submit}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={ghostButtonClass} onClick={onCancel}>Cancel</button>
        )}
      </div>
    </div>
  );
}

function RuleRow({ rule, onSave, onDelete, busy, note }) {
  const [edit, setEdit] = useState(false);

  return (
    <div className="border-t border-axal-hairline py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={KIND_TONE[rule.kind] || 'neutral'}>{KIND_LABEL[rule.kind] || rule.kind}</Pill>
            <span className="text-[13px] font-extrabold tracking-tight">
              {rule.kind === 'budget_floor'
                ? (rule.floor_cents != null ? moneyCents(rule.floor_cents) : <Unrecorded>No amount</Unrecorded>)
                : (rule.value || <Unrecorded>Unnamed</Unrecorded>)}
            </span>
            {!rule.is_active && <Pill tone="neutral">Not in use</Pill>}
          </div>
          {rule.statement ? (
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
              {rule.statement}
            </p>
          ) : (
            /* Not an em-dash. A rule with no sentence is a rule that produces
               silence when it fires, and silence is the failure this zone was
               written to end — so it is called out rather than left blank. */
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-400">
              No sentence written. A pass citing this rule would have nothing to say.
            </p>
          )}
          {rule.referred_to && (
            <p className="mt-1 text-[12px] text-axal-ink-3">
              Refer instead to <span className="font-semibold text-axal-ink-2">{rule.referred_to}</span>
            </p>
          )}
        </div>
        <button type="button" className={ghostButtonClass} onClick={() => setEdit((v) => !v)}>
          {edit ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {edit && (
        <div className="mt-3">
          <RuleForm
            initial={rule}
            busy={busy}
            submitLabel="Save rule"
            onCancel={() => setEdit(false)}
            onSubmit={async (data) => { await onSave(rule, data); setEdit(false); }}
          />
          <div className="mt-2 flex">
            <button
              type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
              disabled={busy} onClick={() => onDelete(rule)}
            >
              Delete rule
            </button>
          </div>
          <SaveNote note={note?.scope === `rule:${rule.id}` ? note : null} />
        </div>
      )}
    </div>
  );
}

export default function PartnerAudienceFitZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.listPartnerFitRules();
      setState({ loading: false, error: '', data: r || {} });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The fit rules did not load.', data: null });
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
  const declines = items.filter(
    (r) => r.is_active && r.kind !== 'best_fit',
  );
  const floor = items.find((r) => r.is_active && r.kind === 'budget_floor') || null;

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Audience fit" />
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
          title="No fit rule is recorded yet"
          body={
            'Until one is, a lead you pass on is passed in silence — the founder '
            + 'learns nothing and neither does anyone else. A rule is a reason '
            + 'you can hand over: what you start at, what you decline, what you '
            + 'do not do, and who to send them to instead.'
          }
          action={(
            <button type="button" className={buttonClass} onClick={() => setAdding(true)}>
              Write the first rule
            </button>
          )}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="Who the firm is for, and who it is not"
          blurb={
            'The second half is the working one. These are the sentences a pass '
            + 'quotes, so a founder hears a reason rather than nothing.'
          }
          action={(
            <button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add a rule'}
            </button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Budget floor"
            value={floor?.floor_cents != null ? moneyCents(floor.floor_cents) : '—'}
            hint={floor ? 'the smallest engagement worth starting' : 'none recorded'}
          />
          <StatCard label="Rules" value={items.length} hint={`${items.filter((r) => r.is_active).length} in use`} />
          <StatCard label="Declines" value={declines.length} hint="sectors and capabilities ruled out" />
          <StatCard
            label="Without a sentence"
            value={d?.unstated_count ?? 0}
            hint={d?.unstated_count ? 'a pass citing these says nothing' : 'every rule can be quoted'}
          />
        </div>

        {(d?.unstated_count ?? 0) > 0 && (
          <p className="text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-400">
            {d.unstated_count} rule{d.unstated_count === 1 ? '' : 's'} carr
            {d.unstated_count === 1 ? 'ies' : 'y'} no sentence. A rule without one
            still describes the firm, but it cannot be quoted — so a pass citing
            it lands as the silence this zone exists to replace.
          </p>
        )}

        {adding && (
          <div>
            <RuleForm
              busy={busy}
              submitLabel="Add rule"
              onCancel={() => setAdding(false)}
              onSubmit={async (data) => {
                await run(() => api.createPartnerFitRule(data), 'Rule added.', 'new');
                setAdding(false);
              }}
            />
            <SaveNote note={note?.scope === 'new' ? note : null} />
          </div>
        )}

        <Section title="Rules">
          <div>
            {items.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                busy={busy}
                note={note}
                onSave={(r, data) => run(
                  () => api.updatePartnerFitRule(r.id, data),
                  'Saved.', `rule:${r.id}`,
                )}
                onDelete={(r) => run(
                  () => api.deletePartnerFitRule(r.id),
                  'Rule deleted.', `rule:${r.id}`,
                )}
              />
            ))}
          </div>
        </Section>

        <StatedLimit title="What this zone does not do">
          <p>
            <strong>Nothing runs these rules.</strong>{' '}
            {d?.enforcement_note
              || 'They are a record a person reads before passing on a lead. Nothing scores, filters or auto-declines against them.'}{' '}
            A lead below your floor still appears on{' '}
            <Link to="/pipeline/leads" className="text-amber-700 underline">Leads</Link>{' '}
            and it is still your click that passes on it — which is what the
            workspace rail promises, and this zone does not quietly break.
          </p>
          <p className="mt-2">
            <strong>No fit score.</strong> The canvas puts a percentage beside
            each lead. Scoring a founder’s need against these rules would need
            the need to carry a budget and a sector in a comparable shape, and
            `founder_needs` carries free-text budget bounds and a single category
            that does not line up with the sectors a firm would name. A number
            over those inputs would be a guess wearing a decimal point.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
