import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, NothingYet, Pill, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, ghostButtonClass, inputClass,
} from '../expertise/kit';
import {
  STATE_LABEL, STATE_TONE, medianLabel, nudgeBody, nudgeTargets, seamLine, sentLine,
  shortMoment, versionCountLabel, versionTag,
} from './deliveryTrail';
import { formatDateTime } from '../advisory/kit';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';

/**
 * Practice · Delivery — canvas PR3, `/practice/delivery`.
 *
 * WHAT REPLACED WHAT, AND WHAT SURVIVED IT. This route mounted the legacy
 * five-tab Advisory workspace, whose Delivery tab was a post-session REVIEW
 * loop — sessions held, whether a review was filed, and the advisor's own
 * review form — with a disclaimer saying document deliverables were not tracked.
 * The disclaimer was true and the artboard is about the thing it named: every
 * work product, every version, and whether anyone opened it.
 *
 * THE REVIEW LOOP IS STILL HERE, at the bottom, and that is a deliberate
 * departure from the artboard rather than an oversight. `ROUTE_MAP` records that
 * it moved to Delivery when `/office-hours` was retired, as "its one capability
 * that lived nowhere else". Deleting a working feature because a new artboard
 * does not draw it is the failure this whole series exists to avoid; PR4 may
 * relocate it once the Sessions artboard has been read.
 *
 * THE OPEN RECEIPT IS NOT THIS PAGE'S TO WRITE. Three of the four tiles report
 * whether a client read something, and migration 208's header — inherited by
 * 239 — states the rule: only the founder side can truthfully say a thing was
 * read. So no control here marks anything opened, and the founder's own surface
 * stamps it. D72.
 *
 * NO AI BAND, and this is the one artboard instrument deliberately not built.
 * The canvas draws a consent-gated batch summariser whose own foot note says the
 * gate working *is* the feature — and its premise is false at the first clause:
 * nothing in this product records that an advisory session was recorded,
 * captures consent to record one, or holds a transcript of one. The zone states
 * the five missing pieces instead of drawing a control over none of them.
 */

export default function DeliveryZone() {
  // 'all', as on the other two Practice zones: every instrument reads the whole
  // record, and a narrowed default would open the page mid-filter.
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({
    loading: true, error: '', items: [], totals: null,
    sessions: [], reviews: {}, sessionsUnavailable: false,
  });
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', client_name: '', engagement_id: '', summary: '', link_url: '' });
  const [trailFor, setTrailFor] = useState(null);
  const [nudging, setNudging] = useState(false);
  const [engagements, setEngagements] = useState([]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await api.listMyAdvisorDeliverables();
      // THREE SECOND SOURCES, none of which may take the page down with it. The
      // engagements feed the create form's picker, and the sessions and reviews
      // feed the review loop below — an advisor with unreadable sessions still
      // has a delivery record, and "could not be read" is not "you have none".
      const engs = await api.listMyAdvisorEngagements().catch(() => null);
      const held = await api.listMyAdvisorBookings('completed').catch(() => null);
      const sessions = held?.items || [];
      const reviews = {};
      if (held) {
        for (const b of sessions.slice(0, 20)) {
          reviews[b.id] = (await api.listBookingReviews(b.id).catch(() => null))?.items || [];
        }
      }
      setEngagements(engs?.items || []);
      setState({
        loading: false, error: '',
        items: data?.items || [], totals: data?.totals || null,
        sessions, reviews, sessionsUnavailable: held === null,
      });
    } catch (error) {
      setState({
        loading: false,
        error: error?.message || 'The delivery record could not be read.',
        items: [], totals: null, sessions: [], reviews: {}, sessionsUnavailable: true,
      });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { items } = state;
  const totals = state.totals || {};
  // One `Date.now()` per render, so every row on one paint measures its wait
  // against the same instant.
  const now = Date.now();

  /**
   * The chip row, narrowing in the page — the same shape `EngagementsZone` uses,
   * and it belongs here rather than in `deliveryTrail.js` for a reason worth
   * stating. The module holds derivations a guard can import without React;
   * WHICH ROWS A CHIP SHOWS is a contract between this page and
   * `advisorZoneFilters.js`, and `profile_zone_filters.test.mjs` asserts that
   * the page declaring a chip live is the page that names its key. A predicate
   * hidden one import away satisfies the reader and not the guard, and the guard
   * is right: it is what stops a chip being declared live over a page that
   * cannot serve it.
   *
   * `draft` IS THE CANVAS'S OWN INCONSISTENCY, RESOLVED RATHER THAN REPRODUCED.
   * The artboard offers a `Draft` chip and defines a `Draft` pill, but no row in
   * its fixture carries that state — its draft row is `state:'Not started'` with
   * `version:'v2 draft'`. The chip as drawn would return nothing. Migration 239
   * makes the state real: a work product whose latest version has never been
   * sent IS the draft, which is `not_started`. The chip works, and the canvas's
   * two names for one thing collapse into the one the store can answer.
   *
   * `by_client` REORDERS RATHER THAN NARROWS, as it does on Engagements — a chip
   * with that name that dropped rows would be lying about what it did, and an
   * empty result from a filter reads as an answer.
   */
  const visible = useMemo(() => {
    const rows = [...items];
    if (filter === 'by_client') {
      return rows.sort((a, b) => String(a.client_name || '').localeCompare(String(b.client_name || ''))
        || String(a.title || '').localeCompare(String(b.title || '')));
    }
    if (filter === 'unopened') return rows.filter((i) => i.state === 'sent');
    if (filter === 'opened') return rows.filter((i) => i.state === 'opened');
    if (filter === 'draft') return rows.filter((i) => i.state === 'not_started');
    return rows;
  }, [items, filter]);
  const targets = useMemo(() => nudgeTargets(items), [items]);
  // The trail card shows one work product. It defaults to the one with the most
  // versions, because a trail of one row is not a trail.
  const trail = useMemo(() => {
    if (trailFor) return items.find((i) => i.id === trailFor) || null;
    return [...items].sort((a, b) => b.version_count - a.version_count)[0] || null;
  }, [items, trailFor]);

  const act = async (key, fn, failure) => {
    setBusy(key); setNote(null);
    try { await fn(); await load(); }
    catch (error) { setNote({ ok: false, text: error?.message || failure }); }
    finally { setBusy(''); }
  };

  const create = () => act('new', async () => {
    await api.createMyAdvisorDeliverable({
      title: draft.title.trim(),
      client_name: draft.client_name.trim() || null,
      engagement_id: draft.engagement_id || null,
      summary: draft.summary.trim() || null,
      link_url: draft.link_url.trim() || null,
    });
    setAdding(false);
    setDraft({ title: '', client_name: '', engagement_id: '', summary: '', link_url: '' });
  }, 'That work product could not be created.');

  const addVersion = (item) => act(`v-${item.id}`,
    () => api.addMyAdvisorDeliverableVersion(item.id, {}),
    'That version could not be added.');

  const send = (item) => act(`s-${item.id}`,
    () => api.sendMyAdvisorDeliverableVersion(item.id, item.latest_version.version),
    'That version could not be sent.');

  /**
   * The nudge. One thread per unopened work product, over the inbox that
   * already exists — nothing is sent on the advisor's behalf beyond opening it.
   */
  const nudgeUnopened = () => act('nudge', async () => {
    let sent = 0;
    for (const item of targets.reachable) {
      await api.messageStartThread({
        to_email: item.client_user_email,
        subject: item.title,
        subject_type: 'engagement',
        subject_id: item.engagement_id || null,
        body: nudgeBody(item),
      });
      sent += 1;
    }
    setNudging(false);
    setNote({
      ok: true,
      text: `${sent} ${sent === 1 ? 'thread' : 'threads'} opened`
        + `${targets.missed.length ? ` · ${targets.missed.length} not reached, no client account` : ''}.`,
    });
  }, 'The nudge could not be sent.');

  /**
   * The ops row's own handler, hoisted out of the JSX for two reasons.
   *
   * IT OPENS A CONFIRMATION RATHER THAN SENDING. A bulk action that fires on one
   * click is how a client gets two nudges in a minute, so the button below the
   * named recipients is what actually sends.
   *
   * AND PROSE CANNOT LIVE INSIDE THE `advisorZoneActions(…)` CALL.
   * `profile_zone_actions.test.mjs` scans that call's text for identifiers the
   * page never declares — the check that catches `scope: project?.name` on a
   * page with no `project`, a ReferenceError no build step reports — and it
   * cannot tell a word in a comment from a name. A note in there fails a page
   * that is correct, so the note goes here and the call stays code.
   */
  const bulkHandlers = {
    nudgeUnopened: {
      onClick: () => { setNudging(true); setNote(null); },
      disabled: targets.reachable.length === 0,
    },
  };

  const reviewed = state.sessions.filter((b) => (state.reviews[b.id] || []).length > 0);
  const awaiting = state.sessions.filter((b) => (state.reviews[b.id] || []).length === 0);
  const ratings = Object.values(state.reviews).flat().map((r) => Number(r.rating)).filter(Boolean);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      isEmpty={!state.loading && !state.error && items.length === 0}
      onRetry={load}
      empty={<NothingYet
        title="No work product is on file"
        body="This collection fills as you record what you send a client — each version, when it went out, and whether they opened it. It is empty because nothing has been recorded, not because anything was lost."
        action={<button type="button" className={buttonClass} onClick={() => setAdding(true)}>Record a work product</button>}
      />}
    >
      <ZoneToolbar
        className="mb-3"
        role="advisor"
        filters={advisorZoneFilters('practice/delivery', { value: filter, onChange: setFilter })}
        actions={advisorZoneActions('practice/delivery', {
          handlers: bulkHandlers,
          view: {
            header: ['Work product', 'Client', 'Version', 'Versions', 'State', 'Sent', 'Opened'],
            rows: visible,
            cells: (i) => [
              i.title, i.client_name, versionTag(i.latest_version), i.version_count,
              STATE_LABEL[i.state] || i.state,
              i.latest_version?.sent_at, i.latest_version?.opened_at,
            ],
          },
        })}
      />

      <SaveNote note={note} />

      {nudging && (
        <Card padding="md" className="mb-3" data-testid="nudge-pr3">
          <ZoneHeading
            title="Nudge the clients who have not opened"
            blurb="One thread each, in the message inbox you both already have. Nothing else is sent on your behalf."
          />
          {targets.reachable.length === 0
            ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">Nothing is sitting unopened, so there is nobody to nudge.</p>
            : <>
              <ul className="space-y-1.5">{targets.reachable.map((i) => (
                <li key={i.id} className="text-[12px] text-axal-ink-2">
                  <strong className="font-semibold text-axal-ink-1">{i.client_name}</strong>
                  {' · '}{i.title}{' · '}{seamLine(i, now)}
                </li>
              ))}</ul>
              {/* THE ROWS IT WILL NOT REACH, said before anything is sent. A
                  bulk action that skips some of its set quietly is worse than
                  no button — and this is the one case the store's send rule
                  cannot prevent, an engagement unlinked after a send. */}
              {targets.missed.length > 0 && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                  {targets.missed.length} other {targets.missed.length === 1 ? 'work product is' : 'work products are'} unopened
                  and cannot be nudged: {targets.missed.map((i) => i.client_name).join(', ')} {targets.missed.length === 1 ? 'has' : 'have'} no
                  Axal account on the engagement any more, so there is no address to reach.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" className={buttonClass} disabled={busy === 'nudge'} onClick={nudgeUnopened}
                  data-testid="nudge-pr3-send">
                  Open {targets.reachable.length} {targets.reachable.length === 1 ? 'thread' : 'threads'}
                </button>
                <button type="button" className={ghostButtonClass} onClick={() => setNudging(false)}>Cancel</button>
              </div>
            </>}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Work products" value={totals.work_products ?? 0}
          note={totals.clients
            ? `across ${totals.clients} ${totals.clients === 1 ? 'client' : 'clients'}`
            : 'no client has a work product yet'} />
        <Stat label="Unopened" value={totals.unopened ?? 0}
          note={totals.unopened ? 'sent, not read' : 'nothing is waiting to be read'} />
        {/* A REAL MEASUREMENT, unlike Opportunities' median: both `sent_at` and
            `opened_at` are stamps, so this is computed rather than declined.
            Null before the first open, and null renders as nothing — never
            "0 h", which would say a deliverable was read the instant it was
            sent (D56/D68). */}
        <Stat
          label="Median to open"
          value={medianLabel(totals.median_to_open_hours) ?? <Unrecorded>Not recorded</Unrecorded>}
          note={totals.median_to_open_hours == null ? 'nothing has been opened yet' : 'from send to first read'} />
        <Stat label="Never opened" value={totals.never_opened ?? 0}
          note={totals.oldest_never_opened
            ? `${totals.oldest_never_opened.client_name} · ${totals.oldest_never_opened.title}`
            : 'everything sent has been read'} />
      </div>

      <Card padding="md" className="mt-3">
        <ZoneHeading
          title="All work products"
          blurb="Version history and open state — only here. What went out, which version, and whether the client opened it."
          action={<button type="button" className={ghostButtonClass} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : 'New work product'}
          </button>}
        />
        {adding && (
          <div className="mb-3 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title">
                <input className={inputClass} value={draft.title} placeholder="Q2 advisory review"
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label="Engagement" hint="A work product under a contract takes its client from it. Sending requires one whose client has an Axal account — nothing an unlinked client is sent can ever be recorded as opened.">
                <select className={inputClass} value={draft.engagement_id}
                  onChange={(e) => setDraft({ ...draft, engagement_id: e.target.value })}>
                  <option value="">No engagement — type a client below</option>
                  {engagements.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.client_name}{e.founder_user_id ? '' : ' (no account — cannot be sent)'}
                    </option>
                  ))}
                </select>
              </Field>
              {!draft.engagement_id && (
                <Field label="Client" hint="Used when there is no engagement to take the name from.">
                  <input className={inputClass} value={draft.client_name} placeholder="Halverton"
                    onChange={(e) => setDraft({ ...draft, client_name: e.target.value })} />
                </Field>
              )}
              <Field label="What changed" hint="The line the version trail shows against v1.">
                <input className={inputClass} value={draft.summary} placeholder="First pass from the Aug 5 teardown"
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
              </Field>
              <Field label="Link">
                <input className={inputClass} value={draft.link_url} placeholder="https://…"
                  onChange={(e) => setDraft({ ...draft, link_url: e.target.value })} />
              </Field>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
              It opens at <strong>v1, not sent</strong>. Sending is its own step, because that is the
              moment the client can start reading it.
            </p>
            <button type="button" className={`${buttonClass} mt-2`}
              disabled={busy === 'new' || !draft.title.trim() || (!draft.engagement_id && !draft.client_name.trim())}
              onClick={create}>
              Add as v1
            </button>
          </div>
        )}
        {visible.length === 0
          ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">No work product sits under this view.</p>
          : <div className="grid gap-2.5">{visible.map((i) => (
            <Row key={i.id} item={i} now={now} busy={busy} selected={trail?.id === i.id}
              onTrail={() => setTrailFor(i.id)} onVersion={() => addVersion(i)} onSend={() => send(i)} />
          ))}</div>}
        <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
          Open state is the only honest measure of a deliverable, and it is the client&rsquo;s to give:
          nothing on this page marks a work product opened. A version that has sat unread is worth one
          message before the next one ships on top of it.
        </p>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.15fr]">
        <Card padding="md">
          <ZoneHeading
            title="Version trail"
            blurb={trail ? `${trail.client_name} · ${trail.title}` : 'Nothing to trail yet.'}
          />
          {!trail || !trail.versions?.length
            ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
              A trail appears once a work product has a version. Select a row above to trail it.
            </p>
            : <div className="grid gap-2">{trail.versions.map((v) => (
              <div key={v.uid} data-testid={`row-pr3-trail-${v.uid}`}
                className="flex items-start gap-3 rounded-[9px] border border-axal-hairline bg-axal-ground p-2.5 dark:border-gray-700 dark:bg-gray-900/40">
                <span className="w-7 shrink-0 text-[10.5px] font-extrabold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {versionTag(v)}
                </span>
                <div className="min-w-0">
                  <div className="text-[11.5px] font-semibold">
                    {v.summary || <Unrecorded>No change note recorded</Unrecorded>}
                  </div>
                  <div className="mt-0.5 text-[10.5px] tabular-nums text-axal-ink-3">
                    {v.sent_at ? `${shortMoment(v.sent_at)} · sent` : 'Not sent'}
                    {v.opened_at ? ` · opened ${shortMoment(v.opened_at)}` : ''}
                  </div>
                </div>
              </div>
            ))}</div>}
        </Card>

        {/* THE ARTBOARD'S THIRD ZONE IS AN AI BAND, AND THIS IS WHAT SITS THERE
            INSTEAD. Its subtitle is "Consent-gated at the source" and its own
            foot note says the gate working is the feature — over a gate that
            has nothing to gate. */}
        <Card padding="md" variant="sunken">
          <ZoneHeading
            title="Follow-ups from sessions"
            blurb="The artboard drafts one per recorded session, consent-gated. Nothing here can, and the gate is not the reason."
          />
          <p className="text-[12px] leading-relaxed text-axal-ink-2">
            A summary of a session needs a transcript, a transcript needs a recording, and a recording
            needs consent recorded before it is made. <strong>None of those three exists for an advisory
            session.</strong> `advisor_bookings` carries thirteen columns and has been widened once, for
            money. The two stores in this product with the full recording-to-transcript shape belong to
            other people: one is investor deal-diligence and has answered 501 since it was written, the
            other is a founder&rsquo;s own customer-discovery work and is walled off three separate ways.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-axal-ink-2">
            Five pieces would have to be built first — the columns, a consent step taken before the
            session, an audio upload path, transcription, and only then a summary. The artboard&rsquo;s
            own note says the consent gate working <em>is</em> the feature; a batch button over no
            recordings would be the gate switched off and dressed as on.
          </p>
        </Card>
      </div>

      {/* ── The post-session review loop ──────────────────────────────────────
          NOT ON THE ARTBOARD, AND KEPT ANYWAY. It arrived here when
          `/office-hours` was retired as the one capability that lived nowhere
          else, and an artboard that does not draw a working feature is not an
          instruction to delete it. PR4 may move it to Sessions. */}
      <Card padding="md" className="mt-3">
        <ZoneHeading
          title="Sessions you have held"
          blurb="Still here, and not on this artboard: whether each held session has a review, and your own review of them."
        />
        {state.sessionsUnavailable
          ? <p className="text-[12.5px] leading-relaxed text-axal-ink-2">
            Your held sessions could not be read. That is not a claim that you have none.
          </p>
          : <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Sessions held" value={state.sessions.length}
                note={state.sessions.length ? 'marked completed' : 'none marked completed yet'} />
              <Stat label="Reviewed" value={reviewed.length}
                note={`${awaiting.length} without a review`} />
              {/* THE EM-DASH THIS PAGE INHERITED AND DOES NOT KEEP. The legacy
                  tab rendered `'—'` here when no rating existed, which is the
                  absent-as-dash form D56/D68 forbids. */}
              <Stat label="Average rating"
                value={avg == null ? <Unrecorded>Not recorded</Unrecorded> : avg.toFixed(1)}
                note={ratings.length ? `${ratings.length} review${ratings.length === 1 ? '' : 's'}` : 'no review has been filed'} />
            </div>
            {state.sessions.length > 0 && (
              <ul className="mt-3 space-y-2">{state.sessions.slice(0, 10).map((b) => {
                const rs = state.reviews[b.id] || [];
                const mine = rs.find((r) => r.reviewer_role === 'advisor');
                return (
                  <li key={b.id} data-testid={`row-pr3-session-${b.id}`}
                    className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="text-[12.5px] font-extrabold tracking-tight">{b.topic || 'Session'}</strong>
                        <p className="mt-0.5 text-[11px] text-axal-ink-3">
                          {b.founder_name || b.founder_email || `Member #${b.founder_user_id}`}
                          {' · '}{b.slot_starts_at ? formatDateTime(b.slot_starts_at) : <Unrecorded>date not recorded</Unrecorded>}
                        </p>
                      </div>
                      {rs.length === 0
                        ? <Pill tone="warn">No review</Pill>
                        : <span className="flex items-center gap-1 text-[11px] font-semibold">
                          <Star size={11} fill="currentColor" className="text-amber-400" />
                          {Number(rs[0].rating).toFixed(1)}
                          {mine ? <Pill tone="ok">Yours filed</Pill> : <Pill tone="neutral">Theirs only</Pill>}
                        </span>}
                    </div>
                    {/* THE CONTROL, NOT JUST THE COUNT. Porting the tiles and
                        leaving the form behind would have deleted the capability
                        the moment `/advisor/advisory/delivery` became a
                        redirect: a page that says "3 without a review" and
                        cannot file one is the gap it is reporting. */}
                    {!mine && <ReviewForm booking={b} onFiled={load} />}
                  </li>
                );
              })}</ul>
            )}
          </>}
      </Card>

      <StatedLimit title="What this collection cannot say">
        <p>
          <strong>A work product can only be sent to a client with an Axal account.</strong> An
          engagement may name a company that has not joined, and a version sent to one could never be
          recorded as opened — so it would sit unopened for ever and drag the median with it. The
          store refuses the send rather than keeping a figure that quietly means nothing.
        </p>
        <p className="mt-2">
          <strong>Nothing here marks a work product opened.</strong> That is the client&rsquo;s to say,
          and their own surface says it. An open state an advisor could set is not a measurement — it
          is a claim about somebody else&rsquo;s reading.
        </p>
        <p className="mt-2">
          <strong>There is no consent-gated session summary,</strong> and the gap is five pieces deep
          rather than one control short — see the card above. The artboard also shows a time spent
          reading (&ldquo;9 min on retention&rdquo;); a first-open stamp is all a receipt can carry,
          and page-level attention is not recorded anywhere.
        </p>
      </StatedLimit>
    </ZoneBody>
  );
}

/**
 * One work product.
 *
 * The draft row is tinted, which is the artboard's own treatment and the right
 * one: a work product that has never gone out is the row most likely to be
 * forgotten, and it is the only state on this page the advisor can fix alone.
 */
function Row({ item, now, busy, selected, onTrail, onVersion, onSend }) {
  const latest = item.latest_version;
  const seam = seamLine(item, now);
  const draftRow = item.state === 'not_started';
  const sendable = latest && !latest.sent_at;
  return (
    <div data-testid={`row-pr3-${item.id}`}
      className={`rounded-[10px] border p-3 ${draftRow
        ? 'border-red-200 bg-red-50/40 dark:border-red-900/60 dark:bg-red-950/20'
        : 'border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-900/40'} ${selected ? 'ring-1 ring-emerald-500' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[13px] font-extrabold tracking-tight">{item.title}</strong>
            {versionTag(latest) && <Pill tone="neutral">{versionTag(latest)}</Pill>}
          </div>
          <p className="mt-1 text-[11.5px] text-axal-ink-3">{item.client_name}</p>
          {seam && <p className="mt-1 text-[10.5px] tabular-nums leading-relaxed text-cyan-700 dark:text-cyan-300">{seam}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] tabular-nums text-axal-ink-3">{versionCountLabel(item.version_count)}</div>
          <div className="mt-0.5 text-[10.5px] tabular-nums text-axal-ink-3">{sentLine(latest)}</div>
        </div>
        <Pill tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state] || item.state}</Pill>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button type="button" className={ghostButtonClass} onClick={onTrail}
          data-testid={`trail-pr3-${item.id}`}>Trail</button>
        <button type="button" className={ghostButtonClass} disabled={busy === `v-${item.id}`}
          onClick={onVersion} data-testid={`version-pr3-${item.id}`}>Add a version</button>
        {/* No Send once it has gone out: a sent date is a fact, and the worker
            answers 409 rather than overwriting it. */}
        {sendable && (
          <button type="button" className={buttonClass} disabled={busy === `s-${item.id}`}
            onClick={onSend} data-testid={`send-pr3-${item.id}`}>
            Send {versionTag(latest)}
          </button>
        )}
        {item.client_user_email == null && (
          <span className="self-center text-[10.5px] text-amber-700 dark:text-amber-300">
            No client account — this cannot be sent
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <Card padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">{note}</div>
    </Card>
  );
}

/**
 * The advisor's own review of a session they held — ported whole, and the port is
 * the point.
 *
 * IT CAME FROM `/office-hours` TO THE LEGACY DELIVERY TAB when that page was
 * retired, as the one capability living nowhere else, and it reached this page
 * the same way: `/advisor/advisory/delivery` is a redirect now, so the form would
 * have been unreachable the moment PR3 shipped. Carrying only the COUNT across —
 * "N without a review" over no control — would have been the page reporting the
 * gap it had just created.
 *
 * THE WORKER'S TWO REFUSALS ARE SENTENCES, NOT SWALLOWED. It rejects anything but
 * a completed booking (409) and a second review from the same side (UNIQUE on
 * `booking_id` + `reviewer_role`), and a reader who typed a comment is owed the
 * reason rather than a button that did nothing.
 */
function ReviewForm({ booking, onFiled }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.fileAdvisorReview(booking.id, { rating, comment: comment.trim() });
      setOpen(false);
      await onFiled();
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('already reviewed')) setError('You have already reviewed this session.');
      else if (msg.includes('completed')) setError('Only a session marked as held can be reviewed. Mark it held under Engagements first.');
      else setError(err?.message || 'The review could not be filed. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={`${ghostButtonClass} mt-2`} onClick={() => setOpen(true)}>
        Review this session
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-2 rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">Your review of them</div>
      <div className="mt-1.5 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onClick={() => setRating(i)} aria-label={`${i} star${i === 1 ? '' : 's'}`}>
            <Star size={18} fill={i <= rating ? 'currentColor' : 'none'}
              className={i <= rating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'} />
          </button>
        ))}
      </div>
      <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
        placeholder="Were they prepared? Would you take another session?"
        className={`${inputClass} mt-2`} />
      {error && <p className="mt-2 text-[12px] text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Filing…' : 'File review'}</button>
        <button type="button" className={ghostButtonClass} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-ink-3">
        Yours and theirs are separate records. Filing this does not show you theirs, and does not
        prompt them for one.
      </p>
    </form>
  );
}
