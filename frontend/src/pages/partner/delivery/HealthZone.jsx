import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill, Unrecorded,
  StatCard, Section, Field, SaveNote, NotComputable, SeamRead,
  NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';

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
 */

const HEALTH_TONE = { on_track: 'ok', at_risk: 'warn', blocked: 'danger' };
const HEALTH_LABEL = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' };

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

function HealthRow({ row, busy, onChanged, onError, note }) {
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
          <SaveNote note={note?.scope === `eng:${row.engagement_id}` ? note : null} />
        </div>
      )}
    </div>
  );
}

export default function PartnerHealthZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.getPartnerDeliveryHealth();
      setState({ loading: false, error: '', data: r || {} });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The delivery record did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const counts = items.reduce((acc, r) => {
    acc[r.health || 'unrated'] = (acc[r.health || 'unrated'] || 0) + 1;
    return acc;
  }, {});

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Health" />
        <NoPartnerProfile />
      </>
    );
  }

  return (
    <ZoneBody
      actions={partnerZoneActions('delivery/health', { view: { header: ['Engagement', 'Founder', 'Utilisation %', 'Milestones', 'Deliverables sent', 'Open blockers'], rows: items, cells: (r) => [r.need_title, r.founder_name, r.utilisation_pct, r.milestone_count, r.deliverables_sent, r.open_blockers?.length ?? 0] } })}
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
          title="Health across the book"
          blurb={
            'Read across five stores at once. An engagement with nothing '
            + 'recorded is not rated rather than rated healthy — silence is not '
            + 'good news, and this page will not pretend otherwise.'
          }
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Blocked" value={counts.blocked || 0} hint="something is open against it" />
          <StatCard label="At risk" value={counts.at_risk || 0} hint="overdue, unopened or off scope" />
          <StatCard label="On track" value={counts.on_track || 0} hint="nothing overdue or blocked" />
          <StatCard
            label="Not rated"
            value={counts.unrated || 0}
            hint={counts.unrated ? 'nothing recorded to judge' : 'every engagement has a signal'}
          />
        </div>

        {d?.unrated_note && (
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.unrated_note}</p>
        )}

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
                  busy={busy}
                  note={note}
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
            <strong>No “client has gone quiet” signal.</strong> The canvas asks
            for one. Nothing in this product records contact with a client — no
            message log, no last-touched date — so a quiet client and an active
            one look identical here. The nearest true thing is a deliverable sent
            and not opened, which is shown, and even that reads as “we do not
            know” rather than “they ignored it”, because{' '}
            <Link to="/delivery/deliverables" className="text-amber-700 underline">nothing records an open</Link>.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
