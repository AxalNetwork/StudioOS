import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  // `StatCard` went with the four tiles it drew: the strip is the artboard's
  // own composition now, and `FitTile` below carries the artboard's note under
  // each figure and can draw an absence as a chip rather than an em dash.
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  Section, Field, SaveNote, UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, moneyCents, dollarsToCents,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, NotRecorded } from '../../../workspaces/canvasKit';

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

/**
 * How strong a fit a PROFILE is (migration 229), in the firm's own words.
 *
 * NOT A SCORE ABOUT ANYBODY. The zone still runs nothing: the worker answers
 * `enforcement: 'none'` and this file does not compute a number against a
 * founder's need. A firm writing "pre-product founders with a deck — weak
 * intent" is writing a sentence about a KIND of client, which is the same act
 * as writing the reason beside it.
 *
 * `Weak intent` IS NOT A DECLINE, and the artboard's instNote is the argument:
 * "the honest answer is 'not yet' — and a match engine that cannot say 'not
 * yet' ends up saying 'no' to the same founder twice." So a weak profile stays
 * a profile and never joins the exclusions below it.
 */
const SIGNALS = [
  ['best_fit', 'Best fit'],
  ['qualified', 'Qualified'],
  ['weak_intent', 'Weak intent'],
];
const SIGNAL_LABEL = Object.fromEntries(SIGNALS);
const SIGNAL_TONE = { best_fit: 'ok', qualified: 'info', weak_intent: 'warn' };

/** The strip tile, in the anatomy the artboards share. */
function FitTile({ label, value, note, nr = false }) {
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

function RuleForm({ initial, onSubmit, onCancel, busy, submitLabel }) {
  const [kind, setKind] = useState(initial?.kind || 'best_fit');
  const [floor, setFloor] = useState(
    initial?.floor_cents != null ? String(initial.floor_cents / 100) : '',
  );
  const [value, setValue] = useState(initial?.value || '');
  const [statement, setStatement] = useState(initial?.statement || '');
  const [referredTo, setReferredTo] = useState(initial?.referred_to || '');
  const [signal, setSignal] = useState(initial?.signal || '');
  const [floorError, setFloorError] = useState('');

  const isFloor = kind === 'budget_floor';
  // A strength belongs to a PROFILE. An exclusion has no strength — a declined
  // sector is declined — and the route refuses one sent on any other kind, so
  // the control is not drawn where it would be rejected.
  const isProfile = kind === 'best_fit';

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
      signal: isProfile ? (signal || null) : null,
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
        {isProfile && (
          <Field
            label="How strong a fit"
            hint="Your own judgement about this kind of client. Weak intent means “not yet”, which is not a decline."
          >
            <select className={inputClass} value={signal} onChange={(e) => setSignal(e.target.value)}>
              <option value="">Not graded</option>
              {SIGNALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
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
            {rule.signal && (
              <Pill tone={SIGNAL_TONE[rule.signal] || 'neutral'}>{SIGNAL_LABEL[rule.signal]}</Pill>
            )}
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

/**
 * `Pass reasons`, the artboard's second op.
 *
 * ITS REASON WAS WRONG ABOUT ITS OWN STORE. It read "a pass reason is not a
 * stored field on a fit rule" — and `statement` is exactly that field: the form
 * labels it "The sentence a pass quotes" and the docblock at the top of this
 * file calls it the field that matters. Every exclusion the firm has written
 * already carries the sentence, and `referred_to` carries the alternative.
 *
 * SO THIS COMPOSES RATHER THAN GENERATES. Nothing here writes a reason; it
 * assembles the ones the firm wrote into the text a person would paste, and a
 * rule with no sentence says so instead of getting one invented for it.
 */
function PassReasons({ rules, onClose }) {
  const [copied, setCopied] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Pass reasons</h3>
          <button type="button" className={ghostButtonClass} onClick={onClose}>Close</button>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-ink-2">
          The sentence each exclusion would be passed with, assembled from what you wrote.
          Nothing sends these — a pass is still yours to make and yours to word.
        </p>
        {rules.length === 0 ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-axal-ink-2">
            No exclusion is written yet, so a pass has nothing to quote. That is the silence
            this zone exists to replace.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {rules.map((r) => {
              const subject = r.kind === 'budget_floor'
                ? (r.floor_cents != null ? moneyCents(r.floor_cents) : 'the floor')
                : r.value;
              const text = r.statement
                ? `${r.statement}${r.referred_to ? ` We would point you to ${r.referred_to}.` : ''}`
                : null;
              return (
                <div key={r.id} className="rounded-md border border-axal-hairline p-3 dark:border-gray-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={KIND_TONE[r.kind] || 'neutral'}>{KIND_LABEL[r.kind] || r.kind}</Pill>
                    <span className="text-[12.5px] font-semibold">{subject}</span>
                  </div>
                  {text ? (
                    <>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-axal-ink-2">{text}</p>
                      <button
                        type="button" className={`${ghostButtonClass} mt-2`}
                        onClick={() => {
                          navigator.clipboard?.writeText(text)
                            .then(() => { setCopied(r.id); setTimeout(() => setCopied(''), 1500); })
                            .catch(() => {});
                        }}
                      >
                        {copied === r.id ? 'Copied' : 'Copy'}
                      </button>
                    </>
                  ) : (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-400">
                      No sentence written. A pass citing this rule would have nothing to say — which
                      is the one thing this zone asks you not to send.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PartnerAudienceFitZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [adding, setAdding] = useState(false);
  const [showingPasses, setShowingPasses] = useState(false);
  const [view, setView] = useState('all');

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
  const floor = items.find((r) => r.is_active && r.kind === 'budget_floor') || null;
  // The artboard's `Fit profiles` table is who the firm IS for; its `Who we are
  // not for` card below is the other three kinds. One split, two compositions.
  const profiles = items.filter((r) => r.kind === 'best_fit');
  // ALL THREE STRENGTH CHIPS SELECT ON THE STORED `signal` (migration 229), and
  // they select over the PROFILES rather than over every rule: a chip that
  // returned a declined sector under `Weak` would be answering a different
  // question from the one it asks.
  const visible = view === 'all' ? items : profiles.filter((r) => r.signal === view);

  // ══ THE ARTBOARD'S FOUR TILES ════════════════════════════════════════════
  // `Best fit · Budget floor · Sectors declined · Capabilities absent`, counted
  // over the whole record rather than the chip-narrowed list.
  const bestFit = profiles.filter((r) => r.signal === 'best_fit');
  const sectors = items.filter((r) => r.is_active && r.kind === 'sector_declined');
  const absent = items.filter((r) => r.is_active && r.kind === 'capability_absent');
  // The artboard's anti-persona card, grouped the way it groups: one card per
  // exclusion KIND, with this firm's own values joined into it.
  const ANTI = [
    {
      k: 'Budget floor',
      v: floor?.floor_cents != null ? `Under ${moneyCents(floor.floor_cents)}` : null,
      d: floor?.statement || null,
      rules: floor ? [floor] : [],
    },
    {
      k: 'Sectors declined',
      v: sectors.map((r) => r.value).filter(Boolean).join(', ') || null,
      d: sectors.find((r) => r.statement)?.statement || null,
      rules: sectors,
    },
    {
      k: 'Capability absent',
      v: absent.map((r) => r.value).filter(Boolean).join(', ') || null,
      d: absent.find((r) => r.statement)?.statement || null,
      rules: absent,
    },
  ];

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  const handlers = {
    passReasons: () => { setNote(null); setShowingPasses(true); },
  };
  const rowActions = partnerZoneActions('offers/audience-fit', { handlers, view: { header: ['Profile or exclusion', 'Kind', 'Signal', 'Why', 'Referred to', 'In use'], rows: visible, cells: (r) => [r.kind === 'budget_floor' && r.floor_cents != null ? moneyCents(r.floor_cents) : r.value, r.kind, r.signal, r.statement, r.referred_to, r.is_active] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Audience fit" actions={rowActions} />;
  }

  return (
    <>
      {/* Hoisted out of `ZoneBody`, and the export takes `visible`: a file that
          did not match the chip on screen would be its own small untruth. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('offers/audience-fit', { value: view, onChange: setView })}
        actions={rowActions}
      />
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

          {/* ══ THE `po5` STRIP ═════════════════════════════════════════════
              `Best fit · Budget floor · Sectors declined · Capabilities
              absent`. `Budget floor` reads absent rather than an em dash when
              no floor is written: a firm with no floor and a firm whose floor
              is zero are different, and an em dash reads as the second. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <FitTile
              label="Best fit"
              value={String(bestFit.length)}
              note={`of ${profiles.length} profile${profiles.length === 1 ? '' : 's'} written`}
            />
            <FitTile
              label="Budget floor"
              nr={floor?.floor_cents == null}
              value={floor?.floor_cents != null ? moneyCents(floor.floor_cents) : ''}
              note={floor?.referred_to ? `below it, referred to ${floor.referred_to}` : 'below it, referred out by name'}
            />
            <FitTile label="Sectors declined" value={String(sectors.length)} note="turned down on principle or on fit" />
            <FitTile label="Capabilities absent" value={String(absent.length)} note="stated, not stretched" />
          </div>

          {/* THE ARTBOARD'S LINKAGE NOTE, minus a number it has no store for.
              Its own reads "… produced four explained passes last quarter" —
              that is its sample, and nothing in this product logs a pass, so
              the sentence says what the rules are FOR and stops where the
              record stops. */}
          <div className="rounded-[10px] border border-cyan-200 bg-cyan-50/50 p-3 text-[11.5px] leading-relaxed text-gray-700 dark:border-cyan-900 dark:bg-cyan-950/20 dark:text-gray-300">
            <strong className="text-cyan-700 dark:text-cyan-300">Reads through to Pipeline:</strong>{' '}
            Pipeline · Leads quotes these sentences to pass a lead with a named reason — “under floor,
            referred to Ostara Studio” rather than silence. Nothing counts how often: no pass is
            logged anywhere, so the number of explained passes is not a figure this page can show.
          </div>

          <Instrument
            testid="fit-profiles"
            title="Fit profiles"
            meta="Signals feed lead scoring"
            cols="1.9fr 1fr 2.4fr"
            head={['Profile', 'Signal', 'Why']}
            rows={profiles.map((r) => ({
              key: r.id,
              cells: [
                {
                  text: r.value || undefined,
                  sub: r.referred_to ? `Refer instead to ${r.referred_to}` : undefined,
                  ...(r.value ? {} : { nr: true }),
                  ...(r.is_active ? {} : { gate: 'Not in use' }),
                },
                r.signal
                  ? { pill: SIGNAL_LABEL[r.signal], pillTone: SIGNAL_TONE[r.signal] }
                  : { nr: true },
                // A profile with no sentence is the zone's own failure case, so
                // it is named rather than left blank — the same call the row
                // below the table makes in amber.
                r.statement ? { text: r.statement } : { nr: true },
              ],
            }))}
            note={'A profile graded weak intent is not a decline, and keeping the two apart is what this table is for: the honest answer to a pre-product founder is “not yet”, and a match engine that cannot say “not yet” ends up saying “no” to the same founder twice. The meta line above is the artboard\u2019s and it describes an intention rather than this product: nothing scores a lead against these rows, the worker says so in its own response, and your click is still what passes on anybody. A profile with no sentence reads absent in Why because a pass citing it would have nothing to quote \u2014 which is the silence this whole zone exists to replace.'}
          />

          {/* ══ THE ARTBOARD'S `Who we are not for` CARD ════════════════════
              First-class, in fuchsia, three across — its own note calls it
              "first-class — a pass needs a reason, not a shrug", and that is
              the zone's argument rather than decoration. A kind the firm has
              written nothing under says so; it is not dropped, because an
              exclusion nobody has stated is the reason a pass lands silent. */}
          <div className="rounded-[10px] border border-fuchsia-200 bg-fuchsia-50/40 p-4 dark:border-fuchsia-900 dark:bg-fuchsia-950/20">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-sm font-extrabold tracking-tight text-fuchsia-800 dark:text-fuchsia-300">
                Who we are not for
              </span>
              <span className="text-[11px] text-gray-600 dark:text-gray-400">
                First-class — a pass needs a reason, not a shrug
              </span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {ANTI.map((an) => (
                <div key={an.k} className="rounded-[9px] border border-fuchsia-200 bg-white p-3 dark:border-fuchsia-900 dark:bg-gray-900">
                  <Eyebrow className="!text-fuchsia-800 dark:!text-fuchsia-300">{an.k}</Eyebrow>
                  <div className="mt-1.5 text-[12px] font-bold text-axal-ink dark:text-gray-100">
                    {an.v || <NotRecorded>Nothing stated</NotRecorded>}
                  </div>
                  <div className="mt-1 text-[10.5px] leading-relaxed text-gray-600 dark:text-gray-400">
                    {an.d || 'No sentence written, so a pass citing this would have nothing to say.'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <ZoneDraft
            surface="offers/audience-fit"
            label="Draft · pass reasons"
            accept="Accept drafts"
            run="Draft the passes"
            foot="Reasons read from the fit rules."
            empty="A short pass note per stated exclusion — the reason, and where you named one, the firm better suited."
            nothingToDraft="No exclusion is written yet, so there is no reason to draft from."
          />

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
            {/* A narrowed view that finds nothing says which view it is: a bare
                empty list under a selected chip reads as "you have written no
                rules", which is the silence this zone exists to replace. */}
            {items.length > 0 && visible.length === 0 && (
              <p className="mb-3 text-[12px] text-axal-ink-2">
                No profile is graded {SIGNAL_LABEL[view]?.toLowerCase() || view}.{' '}
                {items.length} rule{items.length === 1 ? '' : 's'} recorded in total,{' '}
                {profiles.length} of them profiles.
              </p>
            )}
            <div>
              {visible.map((rule) => (
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

          {/* NO FIT SCORE, AND NO PARAGRAPH ABOUT ITS ABSENCE. The canvas
                puts a percentage beside each lead. Scoring a founder’s need
                against these rules would need the need to carry a budget and a
                sector in a comparable shape, and `founder_needs` carries
                free-text budget bounds and a single category that does not line
                up with the sectors a firm would name — a number over those
                inputs would be a guess wearing a decimal point. Not drawing it
                was right; explaining the canvas underneath was not. */}
          {showingPasses && (
            <PassReasons rules={items.filter((r) => r.is_active && r.kind !== 'best_fit')}
              onClose={() => setShowingPasses(false)} />
          )}

          <StatedLimit title="What these rules do, and do not">
            <p>
              <strong>Nothing runs these rules.</strong>{' '}
              {d?.enforcement_note
                || 'They are a record a person reads before passing on a lead. Nothing scores, filters or auto-declines against them.'}{' '}
              A lead below your floor still appears on{' '}
              <Link to="/pipeline/leads" className="text-amber-700 underline">Leads</Link>{' '}
              and it is still your click that passes on it — which is what the
              workspace rail promises, and this zone does not quietly break.
            </p>
          </StatedLimit>
        </div>
      </ZoneBody>
    </>
  );
}
