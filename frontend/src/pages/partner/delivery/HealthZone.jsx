import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill, Unrecorded,
  // `StatCard` went with the four tiles it drew: the strip is the artboard's
  // own now, and one of its tiles has to draw an absence rather than a number.
  Section, Field, SaveNote, NotComputable, SeamRead,
  UnlinkedZone, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, Instrument, Legend, NotRecorded } from '../../../workspaces/canvasKit';

/**
 * Delivery · Health — `/delivery/health`.
 *
 * NOTHING RECORDED MEANS NOT RATED. Never "on track". That is the one rule this
 * zone is built around, and it is the rule the old no-store card named: "a
 * health pill computed from status alone would rate every live engagement
 * identically and call it a judgement". An engagement with no milestone, no
 * blocker, no deliverable and no retainer gets `health: null` from the worker
 * and renders as *Not rated* with the reason. Silence is not good news, and a
 * green strip over an empty book is the most confident wrong answer this
 * product could give.
 *
 * The unrated count sits on the stat strip for the same reason. A reader
 * looking at "6 on track" needs to know whether the other nine are at risk or
 * simply empty.
 *
 * UTILISATION IS A READ, NOT A SECOND CALCULATION. The figure carries a
 * "Read · Pipeline · Retainers" chip and comes from the worker helper that
 * zone also calls. The canvas is explicit about why: "two pages disagreeing
 * about the same client's utilisation is worse than either number". The chip
 * is how a reader can tell which page owns it.
 *
 * HEALTH IS COMPUTED IN THE WORKER over five tables and stored nowhere. A
 * stored score would be a second source of truth for something five tables
 * already say, and the first time one of them moved the two would disagree.
 * The zone renders the pill and the reasons the worker used — a judgement that
 * cannot be explained is not one a person should act on.
 *
 * THREE OF THE ARTBOARD'S ELEMENTS ARE NOT FACTS ABOUT THE WORK, and none of
 * the five stores could hold them: an OWNER (who at the firm runs it), a SCOPE
 * ASSESSMENT (a blocker is something stopping the work; drift is the work
 * quietly becoming a different job) and a SATISFACTION score. Migration 232
 * holds all three, and each is absent until somebody states it — `scope_state`
 * in particular is never defaulted to "within", because an engagement nobody
 * has assessed has not been cleared of drift.
 *
 * A SCORE NEVER APPEARS WITHOUT ITS SOURCE. 208:160 made `opened_at` the
 * client's to set, on the grounds that a partner-side write would be the firm
 * reporting a metric about itself. Satisfaction is nearly that, and provenance
 * is the difference: a number typed by the person who wants the renewal, shown
 * on the renewal-risk page as the client's opinion, is exactly that failure.
 * 232's CHECK makes a score impossible without a stated source and every row
 * prints it — a remark somebody heard, not a metric this product measured.
 *
 * THE FIRM-WIDE AVERAGE STAYS REFUSED while any live engagement is unscored.
 * That is the artboard's own rule and its own reason: averaging the rest would
 * present a few opinions as a fact about all of them.
 */

const HEALTH_TONE = { on_track: 'ok', at_risk: 'warn', blocked: 'danger' };
const HEALTH_LABEL = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' };

/** The strip tile, in the anatomy the artboards share. */
function HealthTile({ label, value, note, nr = false }) {
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

/**
 * The three facts nothing derives, written by the firm (migration 232).
 *
 * ONE FORM RATHER THAN THREE, because they are one sentence a firm writes about
 * a client — who runs it, has it drifted, what did they say — and the route
 * takes them together. Every key is sent explicitly so an omitted one cannot
 * silently clear another; the route treats an absent key as untouched, and this
 * form always knows all three.
 */
function StatedFacts({ row, roster, busy, onSave, note }) {
  const [draft, setDraft] = useState({
    owner_user_id: row.owner_user_id ? String(row.owner_user_id) : '',
    scope_state: row.scope_state || '',
    scope_note: row.scope_note || '',
    satisfaction: row.satisfaction == null ? '' : String(row.satisfaction),
    satisfaction_source: row.satisfaction_source || '',
  });
  useEffect(() => {
    setDraft({
      owner_user_id: row.owner_user_id ? String(row.owner_user_id) : '',
      scope_state: row.scope_state || '',
      scope_note: row.scope_note || '',
      satisfaction: row.satisfaction == null ? '' : String(row.satisfaction),
      satisfaction_source: row.satisfaction_source || '',
    });
  }, [row]);

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Owner" hint="Who at this firm runs it. Your own people only.">
          <select className={inputClass} value={draft.owner_user_id}
            onChange={(e) => setDraft({ ...draft, owner_user_id: e.target.value })}>
            <option value="">Unassigned</option>
            {roster.map((p) => (
              <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>
            ))}
          </select>
        </Field>
        <Field label="Scope" hint="Left unset means nobody has assessed it — which is not the same as in scope.">
          <select className={inputClass} value={draft.scope_state}
            onChange={(e) => setDraft({ ...draft, scope_state: e.target.value })}>
            <option value="">Not assessed</option>
            <option value="within">Within scope</option>
            <option value="drift">Scope drift</option>
          </select>
        </Field>
        <Field label="What drifted" hint="In your words — “requests beyond SOW §2”.">
          <input className={inputClass} value={draft.scope_note} maxLength={600}
            onChange={(e) => setDraft({ ...draft, scope_note: e.target.value })} />
        </Field>
        <Field label="Satisfaction" hint="1–5, as the client said it. Empty clears.">
          <input className={inputClass} value={draft.satisfaction} inputMode="decimal" placeholder="e.g. 4.2"
            onChange={(e) => setDraft({ ...draft, satisfaction: e.target.value })} />
        </Field>
        <Field
          label="Where they said it"
          hint="Required beside a score. A number with no source is the firm scoring itself on the page that decides a renewal."
        >
          <input className={inputClass} value={draft.satisfaction_source} maxLength={300}
            placeholder="quarterly review call, 14 Aug"
            onChange={(e) => setDraft({ ...draft, satisfaction_source: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <button
            type="button" className={buttonClass} disabled={busy}
            onClick={() => onSave({
              owner_user_id: draft.owner_user_id ? Number(draft.owner_user_id) : null,
              scope_state: draft.scope_state || null,
              scope_note: draft.scope_note,
              satisfaction: draft.satisfaction.trim() === '' ? null : Number(draft.satisfaction),
              satisfaction_source: draft.satisfaction_source,
            })}
          >
            Save
          </button>
        </div>
      </div>
      <SaveNote note={note} />
    </div>
  );
}

function HealthPill({ health }) {
  if (!health) return <Pill tone="neutral">Not rated</Pill>;
  return <Pill tone={HEALTH_TONE[health] || 'neutral'} dot>{HEALTH_LABEL[health] || health}</Pill>;
}

function Utilisation({ row }) {
  if (row.utilisation_pct === null || row.utilisation_pct === undefined) {
    return <NotComputable why={row.utilisation_note}>No utilisation</NotComputable>;
  }
  return (
    <span className="inline-flex items-baseline">
      <span className="text-[12.5px] font-semibold tabular-nums">{row.utilisation_pct}%</span>
      <span className="ml-1 text-[11px] text-axal-ink-3 tabular-nums">
        ({row.hours_used}h of {row.retained_hours}h)
      </span>
      <SeamRead>Pipeline · Retainers</SeamRead>
    </span>
  );
}

function MilestoneEditor({ engagementId, busy, onChanged, onError }) {
  // `rows` is SEEDED WITH `[]`, and "have we read it yet" is a separate flag.
  // Holding a list as null and dereferencing it is the crash `_zoneGuards.mjs`
  // rule 2 exists for — React builds children before ZoneBody decides whether
  // to show them — and the three states this needs (loading / failed / read and
  // empty) are exactly the three `ZoneBody` itself keeps apart.
  const [rows, setRows] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ title: '', due_at: '' });

  const load = useCallback(async () => {
    try {
      const r = await api.listPartnerMilestones(engagementId);
      setRows(Array.isArray(r?.items) ? r.items : []);
      setError('');
      setReady(true);
    } catch (e) {
      setRows([]);
      setReady(false);
      setError(e?.message || 'The milestones did not load.');
    }
  }, [engagementId]);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return <p className="text-[12px] text-red-700 dark:text-red-300">{error}</p>;
  }
  if (!ready) return <p className="text-[12px] text-axal-ink-3">Loading…</p>;

  return (
    <div>
      {rows.length === 0 && (
        <p className="text-[12px] leading-relaxed text-axal-ink-3">
          No milestone recorded. Without one, nothing here can be overdue — which
          is why this engagement may be unrated rather than healthy.
        </p>
      )}
      {rows.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-1.5 first:border-t-0 text-[12.5px]">
          <span className={m.completed_at ? 'text-axal-ink-3 line-through' : 'font-semibold'}>{m.title}</span>
          <span className="text-[11px] text-axal-ink-3">
            {m.due_at ? `due ${m.due_at}` : 'no due date'}
            {m.days_overdue > 0 && !m.completed_at && (
              <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">
                {m.days_overdue}d overdue
              </span>
            )}
          </span>
          <button
            type="button" className={`${ghostButtonClass} ml-auto`} disabled={busy}
            onClick={async () => {
              try {
                await api.updatePartnerMilestone(m.id, {
                  completed_at: m.completed_at ? null : new Date().toISOString(),
                });
                await load(); onChanged();
              } catch (e) { onError(e); }
            }}
          >
            {m.completed_at ? 'Reopen' : 'Complete'}
          </button>
          <button
            type="button" className={`${ghostButtonClass} text-red-700 dark:text-red-300`} disabled={busy}
            onClick={async () => {
              try { await api.deletePartnerMilestone(m.id); await load(); onChanged(); }
              catch (e) { onError(e); }
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <Field label="New milestone">
          <input className={inputClass} value={draft.title} maxLength={200}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="Due" hint="YYYY-MM-DD">
          <input className={inputClass} value={draft.due_at} maxLength={40} placeholder="2026-10-15"
            onChange={(e) => setDraft({ ...draft, due_at: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <button
            type="button" className={buttonClass} disabled={busy || !draft.title.trim()}
            onClick={async () => {
              try {
                await api.createPartnerMilestone(engagementId, draft);
                setDraft({ title: '', due_at: '' });
                await load(); onChanged();
              } catch (e) { onError(e); }
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockerEditor({ engagementId, busy, onChanged, onError }) {
  // Seeded with `[]` for the reason above: a list held as null is a crash
  // waiting for the first render, whatever the guard above it says.
  const [rows, setRows] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ summary: '', side: 'ours' });

  const load = useCallback(async () => {
    try {
      const r = await api.listPartnerBlockers(engagementId);
      setRows(Array.isArray(r?.items) ? r.items : []);
      setError('');
      setReady(true);
    } catch (e) {
      setRows([]);
      setReady(false);
      setError(e?.message || 'The blockers did not load.');
    }
  }, [engagementId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-[12px] text-red-700 dark:text-red-300">{error}</p>;
  if (!ready) return <p className="text-[12px] text-axal-ink-3">Loading…</p>;

  return (
    <div>
      {rows.length === 0 && (
        <p className="text-[12px] leading-relaxed text-axal-ink-3">Nothing blocked.</p>
      )}
      {rows.map((b) => (
        <div key={b.id} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-1.5 first:border-t-0 text-[12.5px]">
          {/* The side is shown, always. A blocker list with no side makes every
              delay the firm's — and a report drafted from it would inherit
              that. */}
          <Pill tone={b.side === 'client' ? 'info' : 'warn'}>
            {b.side === 'client' ? 'Client side' : 'Our side'}
          </Pill>
          <span className={b.cleared_at ? 'text-axal-ink-3 line-through' : ''}>{b.summary}</span>
          {b.days_open != null && (
            <span className="text-[11px] text-axal-ink-3">{b.days_open}d open</span>
          )}
          <button
            type="button" className={`${ghostButtonClass} ml-auto`} disabled={busy}
            onClick={async () => {
              try {
                await api.updatePartnerBlocker(b.id, {
                  cleared_at: b.cleared_at ? null : new Date().toISOString(),
                });
                await load(); onChanged();
              } catch (e) { onError(e); }
            }}
          >
            {b.cleared_at ? 'Reopen' : 'Clear'}
          </button>
        </div>
      ))}
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <Field label="New blocker">
          <input className={inputClass} value={draft.summary} maxLength={600}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        </Field>
        <Field label="Whose side" hint="Naming a client-side blocker is not an excuse — it is the fact.">
          <select className={inputClass} value={draft.side}
            onChange={(e) => setDraft({ ...draft, side: e.target.value })}>
            <option value="ours">Ours</option>
            <option value="client">Client</option>
          </select>
        </Field>
        <div className="flex items-end">
          <button
            type="button" className={buttonClass} disabled={busy || !draft.summary.trim()}
            onClick={async () => {
              try {
                await api.createPartnerBlocker(engagementId, draft);
                setDraft({ summary: '', side: 'ours' });
                await load(); onChanged();
              } catch (e) { onError(e); }
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthRow({ row, roster, busy, onChanged, onError, onSaveFacts, note }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-axal-hairline p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <HealthPill health={row.health} />
            <span className="text-sm font-extrabold tracking-tight">
              {row.founder_name || row.need_title || <Unrecorded>Unnamed client</Unrecorded>}
            </span>
            {row.shape === 'embedded_seat' && <Pill tone="neutral">Embedded seat</Pill>}
          </div>
          <div className="mt-0.5 text-[11.5px] text-axal-ink-3">
            {row.engagement_uid} · {row.status}
            {row.need_title && row.founder_name && <> · {row.need_title}</>}
          </div>
        </div>
        <button type="button" className={ghostButtonClass} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Record'}
        </button>
      </div>

      {/* The reasons the worker used, always shown. A judgement a reader cannot
          explain is not one they should act on — and where health is null this
          is where the "nothing recorded" sentence lands. */}
      <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
        {row.health_note || (row.health_reasons || []).join(' · ')}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Milestones</div>
          <div className="mt-0.5 text-[12.5px] tabular-nums">
            {row.milestone_count === 0
              ? <Unrecorded>None recorded</Unrecorded>
              : <>{row.milestone_count} · {row.overdue_count} overdue</>}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Blockers</div>
          <div className="mt-0.5 text-[12.5px]">
            {row.open_blockers.length === 0
              ? <span className="text-axal-ink-2">None open</span>
              : row.open_blockers.map((b, i) => (
                <span key={`${b.side}-${i}`} className="mr-1.5">
                  <Pill tone={b.side === 'client' ? 'info' : 'warn'}>
                    {b.side === 'client' ? 'Client' : 'Ours'}
                  </Pill>
                </span>
              ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Sent, unopened</div>
          <div className="mt-0.5 text-[12.5px] tabular-nums">
            {row.deliverables_sent === 0
              ? <Unrecorded>Nothing sent</Unrecorded>
              : <>{row.deliverables_unopened} of {row.deliverables_sent}</>}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Utilisation</div>
          <div className="mt-0.5"><Utilisation row={row} /></div>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-4 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Milestones</div>
            <div className="mt-1">
              <MilestoneEditor engagementId={row.engagement_id} busy={busy}
                onChanged={onChanged} onError={onError} />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Blockers</div>
            <div className="mt-1">
              <BlockerEditor engagementId={row.engagement_id} busy={busy}
                onChanged={onChanged} onError={onError} />
            </div>
          </div>
          {/* THE THREE FACTS NOTHING DERIVES. Owner, scope assessment and the
              client's score are none of them readable from milestones,
              blockers, deliverables, seats or the retainer record — each is a
              sentence somebody at the firm states, and this is where they
              state it. */}
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
              What this firm says about it
            </div>
            <div className="mt-1">
              <StatedFacts
                row={row}
                roster={roster}
                busy={busy}
                note={note?.scope === `facts:${row.engagement_id}` ? note : null}
                onSave={(data) => onSaveFacts(row, data)}
              />
            </div>
          </div>
          <SaveNote note={note?.scope === `eng:${row.engagement_id}` ? note : null} />
        </div>
      )}
    </div>
  );
}

export default function PartnerHealthZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null, people: null });
  const [view, setView] = useState('at_risk');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      // The roster is what the owner picker offers, and it is the firm's own
      // people only — an owner naming anybody else would be as false as a seat
      // register naming them.
      const [r, ppl] = await Promise.all([
        api.getPartnerDeliveryHealth(),
        api.listPartnerPeople().catch(() => ({ items: [] })),
      ]);
      setState({
        loading: false, error: '', data: r || {},
        people: Array.isArray(ppl?.items) ? ppl.items : [],
      });
    } catch (e) {
      setState({
        loading: false, error: e?.message || 'The delivery record did not load.',
        data: null, people: null,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const roster = state.people || [];
  const counts = items.reduce((acc, r) => {
    acc[r.health || 'unrated'] = (acc[r.health || 'unrated'] || 0) + 1;
    return acc;
  }, {});
  // The artboard's `At risk` tile names them rather than only counting them:
  // "Verwood, Thornfield" is a page a reader can act on, "2" is not.
  const atRiskNames = items
    .filter((r) => r.health === 'at_risk' || r.health === 'blocked')
    .map((r) => r.founder_name || r.need_title)
    .filter(Boolean)
    .join(', ');

  // Hoisted so the gate branch below and the live row draw the SAME row.
  // With nothing loaded the export renders disabled and says so itself,
  // which is what makes a header row over an unreadable store honest.
  // ══ THE `pd5` CHIP ROW ═══════════════════════════════════════════════════
  // `At risk` IS THE DEFAULT because the artboard selects it, and it is the two
  // RATED-bad states rather than "anything not green": an engagement with
  // nothing recorded is unrated, not at risk, and the read says so separately.
  //
  // `Renewing soon` IS THIRTY DAYS, and the date is `partner_retainers
  // .renews_at` — stored and indexed by migration 208, and returned by the
  // health read so this chip has something to select on.
  //
  // `By owner` WAS PROSE UNTIL MIGRATION 232. Its reason was true and precise:
  // "nothing records who at the firm owns an engagement; the firm owner
  // migration 224 added belongs to a book contact, which is a person the firm
  // knows rather than work it is running." 232 records the second thing, so the
  // chip becomes a real ordering — UNASSIGNED FIRST, because an engagement
  // nobody owns is the one this grouping exists to surface, and hiding it under
  // a "no owner" heading at the bottom would defeat the point.
  const soon = new Date();
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonIso = soon.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const visible = (() => {
    if (view === 'at_risk') return items.filter((r) => r.health === 'at_risk' || r.health === 'blocked');
    if (view === 'renewing') {
      return items.filter((r) => r.renews_at
        && String(r.renews_at).slice(0, 10) >= todayIso
        && String(r.renews_at).slice(0, 10) <= soonIso);
    }
    if (view === 'owner') {
      return items.slice().sort((a, b) => {
        const an = a.owner_name || '';
        const bn = b.owner_name || '';
        if (!an !== !bn) return an ? 1 : -1;
        return an.localeCompare(bn) || String(a.founder_name || '').localeCompare(String(b.founder_name || ''));
      });
    }
    if (view === 'all') return items;
    return items;
  })();

  const rowActions = partnerZoneActions('delivery/health', { view: { header: ['Engagement', 'Founder', 'Health', 'Utilisation %', 'Milestones', 'Deliverables sent', 'Open blockers', 'Renews'], rows: visible, cells: (r) => [r.need_title, r.founder_name, r.health, r.utilisation_pct, r.milestone_count, r.deliverables_sent, r.open_blockers?.length ?? 0, r.renews_at] } });

  if (isNoPartnerProfile(state.error)) {
    return <UnlinkedZone title="Health" actions={rowActions} />;
  }

  return (
    <>
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={partnerZoneFilters('delivery/health', { value: view, onChange: setView })}
        actions={rowActions}
      />
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0}
      empty={(
        <NothingYet
          title="No engagement to rate yet"
          body={
            'Health is read across milestones, blockers, deliverables and the '
            + 'retainer record. Win a quote and the engagement appears here — '
            + 'unrated until one of those carries something, because nothing '
            + 'recorded is not the same as nothing wrong.'
          }
          action={<Link to="/pipeline/proposals" className="text-[12.5px] font-semibold text-amber-700 underline">Open proposals</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="Engagement health"
          blurb={
            'The renewal early-warning page: scope drift, utilisation, '
            + 'satisfaction, blockage. Utilisation here is a read of the retainer '
            + 'record on Pipeline · Retainers — the same number, not a second one '
            + 'computed from a different source.'
          }
        />

        {/* ══ THE `pd5` STRIP ═══════════════════════════════════════════════
            `At risk · Scope drift · Lowest utilisation · Firm satisfaction
            avg`, each over the whole book rather than the chip-narrowed list. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <HealthTile
            label="At risk"
            value={String(d?.at_risk_count ?? 0)}
            note={atRiskNames || `${counts.unrated || 0} more rated on nothing at all`}
          />
          <HealthTile
            label="Scope drift"
            value={String(d?.drift_count ?? 0)}
            note={d?.scope_unassessed_count
              ? `${d.scope_unassessed_count} not assessed either way`
              : 'every engagement assessed'}
          />
          {/* LOWEST, NOT AVERAGE. The renewal risk is the one client not using
              what they pay for, and an average hides them behind four who are. */}
          <HealthTile
            label="Lowest utilisation"
            value={`${d?.lowest_utilisation_pct ?? 0}%`}
            nr={d?.lowest_utilisation_pct == null}
            note={d?.lowest_utilisation_client
              ? `${d.lowest_utilisation_client} · read from retainer record`
              : 'no retainer records hours yet'}
          />
          {/* REFUSED WHILE ANY LIVE ENGAGEMENT IS UNSCORED. Averaging the rest
              would present a few opinions as a fact about all of them. */}
          <HealthTile
            label="Firm satisfaction avg"
            value={d?.satisfaction_avg == null ? '' : `${d.satisfaction_avg} / 5`}
            nr={d?.satisfaction_avg == null}
            note={d?.satisfaction_note
              || `every engagement scored · ${d?.satisfaction_scored_count ?? 0} of ${d?.satisfaction_scored_count ?? 0}`}
          />
        </div>

        {d?.unrated_note && (
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.unrated_note}</p>
        )}

        {/* THE ARTBOARD'S LEGEND, two entries — drawn only where the table
            carries the marks it explains. A legend over rows that are all one
            kind explains a distinction the reader cannot see. */}
        {(items.some((r) => r.utilisation_pct != null) || items.some((r) => r.seat_scope)) && (
          <Legend
            items={[
              ...(items.some((r) => r.utilisation_pct != null)
                ? [{ chip: 'Read · Pipeline', tone: 'seam', note: 'utilisation read from the retainer record, not recomputed' }]
                : []),
              ...(items.some((r) => r.seat_scope)
                ? [{ chip: 'Granted · scope', grant: true, note: 'scoped, revocable operator grant' }]
                : []),
            ]}
          />
        )}

        <Instrument
          testid="renewal-watch"
          title="Renewal watch"
          meta="Utilisation is a read, not a second record"
          cols="1fr .8fr 1.5fr 1.5fr .9fr .9fr"
          head={['Client', 'Mode', 'Scope state', 'Utilisation', 'Satisfaction', 'Health']}
          rows={visible.map((r) => {
            const clientBlocked = (r.open_blockers || []).some((b) => b.side === 'client');
            return {
              key: r.engagement_id,
              rowClass: r.health === 'at_risk' || r.health === 'blocked'
                ? 'bg-red-50/40 dark:bg-red-950/10' : '',
              cells: [
                r.founder_name ? { text: r.founder_name, sub: r.owner_name ? `owner ${r.owner_name}` : 'unassigned' } : { nr: true },
                { mode: r.seat_scope ? 'Embedded' : 'Project' },
                // THREE STATES AND A FOURTH THAT IS NO STATE. Not-assessed is
                // absent rather than "within scope": an engagement nobody has
                // looked at has not been cleared of drift.
                r.scope_state === 'drift'
                  ? { text: 'Scope drift', pill: 'Drift', pillTone: 'danger', sub: r.scope_note || undefined }
                  : (clientBlocked
                    ? { text: 'Client-side block', pill: 'Blocked', pillTone: 'warn' }
                    : (r.scope_state === 'within' ? { text: 'Within scope' } : { nr: true })),
                // SEAM-MARKED BECAUSE IT IS A READ. Two pages disagreeing about
                // one client's utilisation is worse than either number.
                r.utilisation_pct == null
                  ? { nr: true }
                  : { text: `${r.utilisation_pct}%`, seam: 'Read · Pipeline · Retainers', sub: `${r.hours_used}h of ${r.retained_hours}h` },
                // A SCORE ALWAYS SHOWS ITS SOURCE. It is a remark somebody
                // heard, not a metric this product measured.
                r.satisfaction == null
                  ? { nr: true }
                  : { text: `${r.satisfaction.toFixed(1)} / 5`, sub: r.satisfaction_source || undefined },
                r.health
                  ? { pill: HEALTH_LABEL[r.health], pillTone: HEALTH_TONE[r.health] }
                  : { nr: true },
              ],
            };
          })}
          note={'Utilisation is seam-marked because it is read from the retainer record on Pipeline · Retainers rather than recalculated here: two pages disagreeing about the same client’s utilisation is worse than either number, and the lowest one — a client not using what they pay for — is the near-term renewal risk this page exists to surface. Scope state is absent rather than “within scope” where nobody has assessed it, because an engagement no one has looked at has not been cleared of drift. A satisfaction score is shown with where it was said, every time, and the firm-wide average stays refused while any live engagement has none: averaging the rest would present a few opinions as a fact about all of them.'}
        />

        {items.length > 0 && visible.length === 0 && (
          <p className="text-[12px] text-axal-ink-2">
            No engagement is in this state. {items.length} in the book in total.
          </p>
        )}

        <ZoneDraft
          surface="delivery/health"
          label="Draft · renewal risk read"
          accept="Accept read"
          run="Read the book"
          foot="Utilisation traced to Pipeline · Retainers."
          empty="Per engagement: drift against the SOW, utilisation against the retainer record, and where satisfaction is absent rather than low — because the two call for different conversations, and only one of them is a renewal one."
          nothingToDraft="No engagement is in the book, so there is nothing to read."
        />

        <Section title="Engagements">
          <div className="space-y-3">
            {items
              .slice()
              // At-risk first, then blocked, then the rest — the row that needs
              // attention should not be below three that do not.
              .sort((a, b) => {
                const rank = { blocked: 0, at_risk: 1, on_track: 3 };
                return (rank[a.health] ?? 2) - (rank[b.health] ?? 2);
              })
              .map((row) => (
                <HealthRow
                  key={row.engagement_id}
                  row={row}
                  roster={roster}
                  busy={busy}
                  note={note}
                  onSaveFacts={async (r, data) => {
                    setBusy(true);
                    setNote(null);
                    try {
                      await api.savePartnerEngagementHealth(r.engagement_id, data);
                      setNote({ ok: true, text: 'Saved.', scope: `facts:${r.engagement_id}` });
                      await load();
                    } catch (e) {
                      setNote({
                        ok: false,
                        text: e?.message || 'That did not save.',
                        scope: `facts:${r.engagement_id}`,
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  onChanged={async () => {
                    setBusy(true);
                    setNote({ ok: true, text: 'Saved.', scope: `eng:${row.engagement_id}` });
                    await load();
                    setBusy(false);
                  }}
                  onError={(e) => setNote({
                    ok: false,
                    text: e?.message || 'That did not save.',
                    scope: `eng:${row.engagement_id}`,
                  })}
                />
              ))}
          </div>
        </Section>

        <StatedLimit title="How this rating is made, and what it cannot see">
          <p>
            <strong>Nothing recorded is never “on track”.</strong> An engagement
            with no milestone, blocker, deliverable or retainer is not rated at
            all, and the count above says how many those are. A pill computed
            from status alone would rate every live engagement identically and
            call it a judgement.
          </p>
          <p className="mt-2">
            <strong>Utilisation is read, not recomputed.</strong> The figure and
            its chip come from the same worker helper Pipeline · Retainers uses.
            Two pages disagreeing about one client’s utilisation would be worse
            than either number, so there is one calculation and this page is not
            it.
          </p>
          <p className="mt-2">
            <strong>A satisfaction score is a remark, not a measurement.</strong>{' '}
            Nothing here asks a client anything. A score is what somebody at this
            firm heard and wrote down, so it cannot be saved without saying where
            it was said — a number typed by the person who wants the renewal,
            shown on the page that decides one, is the firm scoring itself. The
            firm-wide average stays absent while any live engagement has no
            score, because averaging the rest would present a few opinions as a
            fact about all of them.
          </p>
          <p className="mt-2">
            <strong>Scope is assessed or it is absent — never “within” by
            default.</strong> An engagement nobody has looked at has not been
            cleared of drift, and the strip counts how many those are rather
            than folding them into the clean side.
          </p>
          {/* NO “CLIENT HAS GONE QUIET” SIGNAL, AND NO PARAGRAPH ABOUT IT.
              The canvas asks for one. Nothing in this product records contact
              with a client — no message log, no last-touched date — so a quiet
              client and an active one look identical here. The nearest true
              thing is a deliverable sent and not opened, which IS shown, on
              Delivery · Deliverables, and reads there as "we do not know"
              rather than "they ignored it". The rating rules above stay on the
              page because they explain a pill the reader can see; this
              explained a pill that is not drawn. */}
        </StatedLimit>
      </div>
    </ZoneBody>
    </>
  );
}
