import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Pill, Unrecorded,
  StatCard, Section, Field, SaveNote,
  NoPartnerProfile, isNoPartnerProfile,
  inputClass, buttonClass, ghostButtonClass, formatDay,
} from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';

/**
 * Delivery · Status reports — `/delivery/status-reports`.
 *
 * THE RECURRING CLIENT-FACING UPDATE: shipped, next, blocked. The old card said
 * it "would read the deliverables log and the engagement's blockers, neither of
 * which is recorded" — 208 records both, and the draft below is composed from
 * them rather than typed from memory.
 *
 * BLOCKED IS NOT A FIELD, and that is deliberate. The draft reads open blockers
 * at compose time and shows them with their side; nothing copies them into the
 * report row. A prose copy would go stale the moment a blocker cleared, and the
 * side is exactly what a stale copy would lose.
 *
 * A CLIENT-SIDE BLOCKER IS NAMED PLAINLY, WITHOUT BEING LEANED ON. That is a
 * copy decision as much as a data one, and the old card said so. The zone shows
 * the side on every blocker and puts the sentence in front of the author rather
 * than writing the report for them: say it, do not make it the excuse.
 *
 * SENDING IS A PERSON'S ACT, RECORDED — NOT A DELIVERY. Nothing in this product
 * emails a client. "Sent" means somebody sent it, by whatever channel they
 * already use. Saying otherwise would be the page claiming a capability the
 * product does not have.
 *
 * A SENT REPORT IS FROZEN. It is a record of what a client already received;
 * editing it in place would make our record disagree with theirs with no trace
 * of the difference. The worker refuses both the edit and the delete, and this
 * page does not offer either.
 */

function ReportCard({ report, busy, onEdit, onSend, onDelete, note }) {
  const sent = report.state === 'sent';
  return (
    <div className="rounded-xl border border-axal-hairline p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-extrabold tracking-tight">{report.period}</span>
            <span className="text-[12.5px] text-axal-ink-2">
              {report.founder_name || report.need_title || report.engagement_uid}
            </span>
            {sent
              ? <Pill tone="ok">Sent {formatDay(report.sent_at)}</Pill>
              : <Pill tone="warn">Draft</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!sent && (
            <>
              <button type="button" className={ghostButtonClass} onClick={() => onEdit(report)}>
                Edit
              </button>
              <button
                type="button" className={buttonClass} disabled={busy}
                title="Records that you sent it. Nothing here delivers anything."
                onClick={() => onSend(report)}
              >
                Mark sent
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Shipped</div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-axal-ink-2">
            {report.shipped || <Unrecorded>Nothing written</Unrecorded>}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Next</div>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-axal-ink-2">
            {report.next_up || <Unrecorded>Nothing written</Unrecorded>}
          </p>
        </div>
      </div>

      {sent ? (
        <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
          This is a record of what the client received, so it is not editable and
          not deletable. Write the next period’s report instead.
        </p>
      ) : (
        <div className="mt-3 flex">
          <button
            type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
            disabled={busy} onClick={() => onDelete(report)}
          >
            Discard draft
          </button>
        </div>
      )}
      <SaveNote note={note?.scope === `rep:${report.id}` ? note : null} />
    </div>
  );
}

/**
 * The shape a composed draft always has, so no field below is read off a null.
 * Every list is an array and every scalar is something the JSX can render.
 */
const EMPTY_DRAFT = {
  period: '',
  existing: null,
  shipped_from_log: [],
  next_from_milestones: [],
  blocked: [],
  blocked_note: null,
};

function Composer({ engagements, busy, onSaved, onError, note }) {
  const [engagementId, setEngagementId] = useState('');
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  // SEEDED WITH ITS OWN EMPTY SHAPE, with "has it been composed yet" as a
  // separate flag. Every field below reads `draft.<key>` unconditionally, and
  // React builds those children before anything decides whether to show them —
  // so a null here throws on the first render whatever guards it. That is the
  // bug `_zoneGuards.mjs` rule 2 pins shut, and why the shape is written out
  // rather than each of the six reads being made optional.
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [composed, setComposed] = useState(false);
  const [shipped, setShipped] = useState('');
  const [nextUp, setNextUp] = useState('');
  const [loadError, setLoadError] = useState('');

  const compose = useCallback(async () => {
    if (!engagementId) return;
    setLoadError('');
    try {
      const r = await api.getPartnerReportDraft(engagementId, period);
      // Spread over the empty shape rather than replacing it: a response that
      // omitted a list would otherwise reintroduce the undefined this exists
      // to prevent.
      setDraft({ ...EMPTY_DRAFT, ...(r || {}) });
      setComposed(true);
      setShipped(r?.existing?.shipped || '');
      setNextUp(r?.existing?.next_up || '');
    } catch (e) {
      setDraft(EMPTY_DRAFT);
      setComposed(false);
      setLoadError(e?.message || 'The draft could not be composed.');
    }
  }, [engagementId, period]);

  return (
    <div className="rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Engagement">
          <select className={inputClass} value={engagementId}
            onChange={(e) => { setEngagementId(e.target.value); setComposed(false); }}>
            <option value="">Choose one</option>
            {engagements.map((e) => (
              <option key={e.engagement_id} value={e.engagement_id}>
                {e.founder_name || e.need_title || e.engagement_uid}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period" hint="YYYY-MM">
          <input className={inputClass} value={period} maxLength={7}
            onChange={(e) => { setPeriod(e.target.value); setComposed(false); }} />
        </Field>
        <div className="flex items-end">
          <button type="button" className={ghostButtonClass} disabled={!engagementId} onClick={compose}>
            Compose from the record
          </button>
        </div>
      </div>

      {loadError && (
        <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{loadError}</p>
      )}

      {composed && (
        <div className="mt-4 space-y-4">
          {draft.existing?.state === 'sent' && (
            <p className="text-[12.5px] font-semibold text-amber-700 dark:text-amber-400">
              A report for {draft.period} was already sent. It cannot be edited —
              choose another period.
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Shipped in {draft.period}
              </div>
              {draft.shipped_from_log.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-ink-3">
                  Nothing in the deliverables log carries a send date in this period.
                </p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-ink-2">
                  {draft.shipped_from_log.map((x, i) => (
                    <li key={`${x.title}-${i}`}>
                      {x.title}{x.version ? ` (${x.version})` : ''}
                      {!x.opened && <span className="text-axal-ink-3"> · not opened</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Next, from open milestones
              </div>
              {draft.next_from_milestones.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-ink-3">No open milestone.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-ink-2">
                  {draft.next_from_milestones.map((m, i) => (
                    <li key={`${m.title}-${i}`}>
                      {m.title}{m.due_at ? ` · due ${m.due_at}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                Blocked
              </div>
              {draft.blocked.length === 0 ? (
                <p className="mt-1 text-[12px] text-axal-ink-3">Nothing open.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-axal-ink-2">
                  {draft.blocked.map((b, i) => (
                    <li key={`${b.summary}-${i}`}>
                      <Pill tone={b.side === 'client' ? 'info' : 'warn'}>
                        {b.side === 'client' ? 'Client' : 'Ours'}
                      </Pill>{' '}
                      {b.summary}
                      {b.days_open != null && <span className="text-axal-ink-3"> · {b.days_open}d</span>}
                    </li>
                  ))}
                </ul>
              )}
              {/* Read live, never copied into the report — so it cannot go
                  stale, and the side cannot be lost on the way. */}
              {draft.blocked_note && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
                  {draft.blocked_note}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3">
            <Field label="Shipped" hint="Yours to write. The log above is what the record says was sent.">
              <textarea className={inputClass} rows={3} value={shipped} maxLength={4000}
                onChange={(e) => setShipped(e.target.value)} />
            </Field>
            <Field label="Next" hint="Yours to write. The milestones above are what is open.">
              <textarea className={inputClass} rows={3} value={nextUp} maxLength={4000}
                onChange={(e) => setNextUp(e.target.value)} />
            </Field>
          </div>

          <button
            type="button" className={buttonClass}
            disabled={busy || draft.existing?.state === 'sent' || (!shipped.trim() && !nextUp.trim())}
            onClick={async () => {
              try {
                await api.savePartnerStatusReport(engagementId, draft.period, {
                  shipped, next_up: nextUp,
                });
                await onSaved();
              } catch (e) { onError(e); }
            }}
          >
            Save draft
          </button>
          <SaveNote note={note?.scope === 'compose' ? note : null} />
        </div>
      )}
    </div>
  );
}

export default function PartnerStatusReportsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null, engagements: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const [r, h] = await Promise.all([
        api.listPartnerStatusReports(),
        api.getPartnerDeliveryHealth(),
      ]);
      setState({
        loading: false,
        error: '',
        data: r || {},
        engagements: Array.isArray(h?.items) ? h.items : [],
      });
    } catch (e) {
      setState({
        loading: false,
        error: e?.message || 'The status reports did not load.',
        data: null, engagements: null,
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

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Status reports" />
        <NoPartnerProfile />
      </>
    );
  }

  return (
    <ZoneBody
      actions={partnerZoneActions('delivery/status-reports', { view: { header: ['Period', 'Founder', 'Shipped', 'Next up'], rows: items, cells: (r) => [r.period, r.founder_name, r.shipped, r.next_up] } })}
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0 && !composing}
      empty={(
        <NothingYet
          title="No report written yet"
          body={
            'A report is composed from what this engagement already carries — '
            + 'what was shipped in the period, what is open, and what is blocked '
            + 'with whose side it is on. You write the words; the record supplies '
            + 'the facts.'
          }
          action={engagements.length > 0
            ? <button type="button" className={buttonClass} onClick={() => setComposing(true)}>Compose one</button>
            : <Link to="/pipeline/proposals" className="text-[12.5px] font-semibold text-amber-700 underline">Open proposals</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="The recurring client update"
          blurb={
            'Shipped, next, blocked — composed from the engagement’s own record '
            + 'and sent by a person. A client-side blocker is named plainly here '
            + 'rather than being turned into an excuse or left out.'
          }
          action={engagements.length > 0 && (
            <button type="button" className={ghostButtonClass} onClick={() => setComposing((v) => !v)}>
              {composing ? 'Close' : 'Compose a report'}
            </button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="Reports" value={items.length} hint="across every engagement" />
          <StatCard label="Drafts" value={d?.draft_count ?? 0} hint="written, not sent" />
          <StatCard label="Sent" value={d?.sent_count ?? 0} hint="by a person, recorded here" />
        </div>

        {d?.delivery_note && (
          <p className="text-[12.5px] leading-relaxed text-axal-ink-2">{d.delivery_note}</p>
        )}

        {composing && (
          <Composer
            engagements={engagements}
            busy={busy}
            note={note}
            onSaved={async () => {
              setNote({ ok: true, text: 'Draft saved.', scope: 'compose' });
              await load();
            }}
            onError={(e) => setNote({
              ok: false, text: e?.message || 'That did not save.', scope: 'compose',
            })}
          />
        )}

        <Section title="Reports">
          <div className="space-y-3">
            {items.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                busy={busy}
                note={note}
                onEdit={() => setComposing(true)}
                onSend={(rep) => run(
                  () => api.sendPartnerStatusReport(rep.id),
                  'Marked sent.', `rep:${rep.id}`,
                )}
                onDelete={(rep) => run(
                  () => api.deletePartnerStatusReport(rep.id),
                  'Draft discarded.', `rep:${rep.id}`,
                )}
              />
            ))}
          </div>
        </Section>

        <StatedLimit title="What “sent” means here">
          <p>
            <strong>It means a person sent it.</strong> Nothing in this product
            emails a client, notifies one, or shows them a report — so marking one
            sent records your act, by whatever channel you already use. A page
            that implied delivery would be claiming a capability the product does
            not have.
          </p>
          <p className="mt-2">
            <strong>A sent report cannot be edited or deleted.</strong> It is a
            record of what a client already received; changing it would make our
            record disagree with theirs with no trace of the difference. Write the
            next period instead.
          </p>
          <p className="mt-2">
            <strong>Blocked is read live, never stored in the report.</strong> The
            draft shows the engagement’s open blockers with their side at the
            moment you compose. A prose copy would go stale the instant one
            cleared — and the side, which is what lets you name a client-side
            blocker plainly rather than swallowing it, is exactly what a stale
            copy loses.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
