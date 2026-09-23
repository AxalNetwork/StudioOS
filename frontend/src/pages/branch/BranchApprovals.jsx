/**
 * Branch · Approvals — canvas S3, the whole of it (D112 the lane, D130 the board).
 *
 * TWO HALVES THAT ARE DIFFERENT KINDS OF THING, which is why they are two
 * cards and two loads rather than one list. The **board** is the four queues
 * this territory decides, unioned and sorted oldest first. The **To-HQ lane**
 * is what it asked HQ — outbound, decided elsewhere, and its answer comes back
 * as one decision. Folding them together would make either failure blank the
 * other, and would suggest the branch decides its own escalations.
 *
 * THIS PAGE SHIPPED AS HALF OF ITSELF FIRST, and the notice it carried said
 * so. That notice promised the read model as PR 13's work; D130 IS PR 13, so
 * the promise is gone and what remains in the rail's `unavailable` list is the
 * narrower true thing — assignment, history and the AI decision note, each
 * with the reason it does not exist. Narrowing rather than deleting is the
 * D111 pattern, and `frontend/test/branch_approvals_board_d130.test.mjs`
 * refuses the retired sentence.
 *
 * THE BOARD READS; THE CONSOLES DECIDE. It shows four stores it does not own,
 * so each row offers that queue's own console instead of an Approve button.
 * One lane has no console to offer — see `LANE_CONSOLE` — and says so.
 *
 * THE ANSWER IS ONE DECISION, NOT A THREAD, and this page must not suggest
 * otherwise. The canvas says "the answer coming back as a thread with HQ's
 * decision and who made it"; what exists is a single answer with an author and
 * a time. So the drawer renders the decision and no reply box — a reply box
 * that wrote nowhere would be the most expensive kind of lie on this screen,
 * because the person using it would believe they had replied.
 *
 * A SUSPENDED BRANCH CAN STILL RAISE. The frozen banner (D107) names an appeal
 * and the appeal is an escalation, so this form stays live while every other
 * branch write answers 423. Reading the board is likewise never gated: a frozen
 * branch can still see what is waiting, which is what the banner tells it to do.
 *
 * D206 — WHICH KINDS THIS BRANCH MAY RAISE IS THE SERVER'S ANSWER, NOT THIS
 * FILE'S. A white-label has no HQ brand desk, so `content` is a kind its admins
 * could raise and nobody could answer (canvas H30). The lane read carries
 * `kinds_available` and `kinds_hidden`, from the licence copy HQ pushed, and
 * `KindPicker` draws exactly that: the offered kinds as choices, a hidden kind
 * as a stated row with the reason and no control. While the read is loading or
 * has failed, every kind is offered — the route and HQ both refuse a hidden
 * kind anyway, so offering it costs one refusal in words, where hiding a kind
 * this page merely failed to read would take a door away for nothing.
 *
 * D208 — A CONTENT ESCALATION CAN NAME WHAT IT CONCERNS. The lane read carries
 * `concerns`: HQ's templates as pushed here and this branch's own articles,
 * each with a label the worker built from the branch's own row. `ConcernsPicker`
 * offers them for a content raise only, and its option text IS that label —
 * this page never builds one, so there is no second format for a pick and its
 * record to drift between. Naming is optional; a list that is loading, could
 * not be read, or holds nothing draws a sentence and no control. What HQ gets
 * is the name, not a link, and each row here shows the name it was raised with.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZone from './BranchZone';

const UNAVAILABLE = Symbol('unavailable');

/**
 * The four things a branch cannot decide for itself, with the words the
 * subsidiary canvas uses. A fifth is a product decision, not a new option.
 *
 * THE VOCABULARY, NOT THE OFFER (D206). Which of the four a branch may use
 * depends on the kind of licence it runs under, and `kindsOffered` reads that
 * from the server. This list only names and describes them.
 */
const KINDS = [
  ['moderation', 'Moderation', 'A case you want HQ to take rather than decide here.'],
  ['content', 'Content for brand approval', 'A localised or original piece that needs HQ sign-off.'],
  ['seat_increase', 'Seat increase', 'Seats are set by HQ, so this is a request to make.'],
  ['other', 'Other', 'Anything the three above do not cover.'],
];
const KIND_VALUES = KINDS.map(([value]) => value);
const KIND_LABEL = Object.fromEntries(KINDS.map(([value, label]) => [value, label]));

const PILL = 'shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em]';

/**
 * Which kinds the raise form offers, read off the lane payload (D206).
 *
 * THE SERVER DECIDES WHEN IT HAS ANSWERED; OTHERWISE EVERYTHING IS OFFERED.
 * `lane` is null while loading and a Symbol when the read failed, and in both
 * cases — and against a payload that predates the kind fields — all four kinds
 * come back, because the route refuses a hidden kind before calling HQ and HQ
 * refuses it again. A kind this page could not read is not a kind it may take
 * away.
 *
 * Only kinds this file can name are drawn: a kind a newer server sends that
 * `KINDS` does not know would otherwise render as an unlabelled choice.
 */
export function kindsOffered(lane) {
  const payload = lane && typeof lane === 'object' ? lane : null;
  if (!payload || !Array.isArray(payload.kinds_available)) {
    return { available: [...KIND_VALUES], hidden: [], known: false, basis: null };
  }
  const hidden = (Array.isArray(payload.kinds_hidden) ? payload.kinds_hidden : [])
    .filter((h) => h && KIND_VALUES.includes(h.kind))
    .map((h) => ({
      kind: h.kind,
      reason: String(h.reason || '').trim()
        || 'HQ does not take this kind of escalation from this branch.',
    }));
  const hiddenKinds = new Set(hidden.map((h) => h.kind));
  const offered = new Set(payload.kinds_available);
  return {
    available: KIND_VALUES.filter((k) => offered.has(k) && !hiddenKinds.has(k)),
    hidden,
    known: payload.licence_kind_known === true,
    basis: typeof payload.kind_basis === 'string' && payload.kind_basis.trim()
      ? payload.kind_basis
      : null,
  };
}

/**
 * The kind the form sends: the one picked, while it is still offered.
 *
 * DERIVED, NOT RESET IN AN EFFECT. A kind picked while the lane was loading —
 * when every kind is offered — can turn out to be hidden once the read
 * arrives, and the form must then send an offered one rather than a choice it
 * no longer draws. `other` first, because it is the form's own default and
 * the one kind that covers anything; `null` only if nothing is offered, which
 * disables the submit rather than sending a kind the route would refuse.
 */
export function chosenKind(offered, picked) {
  if (offered.available.includes(picked)) return picked;
  if (offered.available.includes('other')) return 'other';
  return offered.available[0] || null;
}

/**
 * D208 — the two sources a content escalation can name an item from, in the
 * order the worker lists them, with the words the drawer uses for each.
 */
const CONCERN_SOURCES = [
  ['template', 'HQ templates', 'no HQ templates'],
  ['article', 'Articles on this branch', 'no articles'],
];
const CONCERN_HEADING = Object.fromEntries(CONCERN_SOURCES.map(([type, heading]) => [type, heading]));
const CONCERNS_UNSENT =
  'This branch did not send the items a content escalation can name, so none can be picked here. '
  + 'The escalation can still be raised without one.';

/** A pick is held under its type and id together: a slug and a number can collide. */
const concernKey = (it) => `${it.type}:${it.id}`;

/**
 * What the drawer can offer to name, read off the lane payload (D208).
 *
 * FIVE STATES, AND ONLY `ready` HAS A CONTROL. `loading`, `unreadable`,
 * `unavailable` and `empty` each come with a sentence instead, because a list
 * this page could not read, or one with nothing in it, is not something to
 * choose from. Naming is optional, so no state stops the raise.
 *
 * THE LABEL IS THE WORKER'S. Each item carries the text built from the branch's
 * own row by the same function that builds the value the route stores, and
 * this file renders it as it came. An item with no label is dropped rather than
 * drawn as a blank choice.
 */
export function concernsOffered(lane) {
  const base = {
    items: [], groups: [], gaps: [], none: [], truncated: false, cap: null, note: null, reason: null,
  };
  if (lane === null || lane === undefined) return { ...base, state: 'loading' };
  if (typeof lane !== 'object') return { ...base, state: 'unreadable' };
  const block = lane.concerns;
  if (!block || typeof block !== 'object' || !Array.isArray(block.items) || !Array.isArray(block.sources)) {
    return { ...base, state: 'unavailable', reason: CONCERNS_UNSENT };
  }
  if (block.available !== true) {
    return { ...base, state: 'unavailable', reason: String(block.reason || '').trim() || CONCERNS_UNSENT };
  }
  const items = block.items.filter((it) => it
    && CONCERN_HEADING[it.type]
    && (typeof it.id === 'string' || typeof it.id === 'number') && String(it.id) !== ''
    && typeof it.label === 'string' && it.label.trim() !== '');
  const readable = (type) => block.sources.some((s) => s && s.type === type && s.available === true);
  return {
    ...base,
    state: items.length > 0 ? 'ready' : 'empty',
    items,
    groups: CONCERN_SOURCES
      .map(([type, heading]) => ({ type, heading, items: items.filter((it) => it.type === type) }))
      .filter((g) => g.items.length > 0),
    gaps: block.sources
      .filter((s) => s && CONCERN_HEADING[s.type] && s.available === false)
      .map((s) => ({
        type: s.type,
        heading: CONCERN_HEADING[s.type],
        reason: String(s.reason || '').trim() || 'This source could not be read.',
      })),
    none: CONCERN_SOURCES
      .filter(([type]) => readable(type) && !items.some((it) => it.type === type))
      .map(([, , noun]) => noun),
    truncated: block.truncated === true,
    cap: Number.isInteger(block.cap) ? block.cap : null,
    note: typeof block.note === 'string' && block.note.trim() ? block.note : null,
  };
}

/**
 * The `concerns` a raise sends (D208): the picked item, for a content
 * escalation only, and only while the list still offers it.
 *
 * DERIVED AT SEND TIME, LIKE `chosenKind`. A pick outlives a change of kind in
 * state — an admin can pick an item, then switch to Other, and the picker is
 * gone while the pick is still held — and the route refuses `concerns` on any
 * kind but content. So what is sent is worked out from what is on screen, not
 * from what was once chosen.
 */
export function concernToSend(chosen, offered, key) {
  if (chosen !== 'content' || !key || offered.state !== 'ready') return undefined;
  const hit = offered.items.find((it) => concernKey(it) === key);
  return hit ? { type: hit.type, id: hit.id } : undefined;
}

/**
 * The content raise's optional "which item" choice (D208).
 *
 * A SELECT WHOSE OPTION TEXT IS THE WORKER'S LABEL, grouped by source, with a
 * first option for "nothing in particular" — a content question about no one
 * item is still a legitimate question. Every other state is a sentence with no
 * control, and a source that could not be read says so beside the list rather
 * than vanishing from it.
 */
export function ConcernsPicker({ offered, value, onChoose }) {
  const ready = offered.state === 'ready';
  const heading = 'Which item is this about? (optional)';
  const sentence = {
    loading: 'Loading the items this branch can name…',
    unreadable: 'The items this branch can name could not be read, so none can be picked. '
      + 'The escalation can still be raised without one.',
    unavailable: offered.reason,
    empty: `Nothing on this branch can be named: ${offered.none.join(' and ') || 'no readable source'}. `
      + 'The escalation is raised without one.',
  }[offered.state];
  return (
    <div data-testid="branch-escalate-concerns">
      {ready
        ? <label htmlFor="branch-escalate-concern" className="block text-[11.5px] font-bold">{heading}</label>
        : <p className="text-[11.5px] font-bold">{heading}</p>}
      {ready ? (
        <select
          id="branch-escalate-concern"
          value={offered.items.some((it) => concernKey(it) === value) ? value : ''}
          onChange={(e) => onChoose(e.target.value)}
          className="mt-1 w-full rounded-xl border border-axal-hairline bg-axal-ground p-2.5 text-[12.5px]"
          data-testid="branch-escalate-concern"
        >
          <option value="">No item — this is about something else</option>
          {offered.groups.map((g) => (
            <optgroup key={g.type} label={g.heading}>
              {g.items.map((it) => (
                <option key={concernKey(it)} value={concernKey(it)}>{it.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <p className="mt-1 text-[11px] leading-relaxed text-axal-muted" data-testid="branch-escalate-concern-state">
          {sentence}
        </p>
      )}
      {ready && offered.truncated && (
        <p className="mt-1 text-[11px] leading-relaxed text-axal-muted" data-testid="branch-escalate-concern-truncated">
          Only the {offered.cap} most recent articles are listed. To name an older one, say which in the subject.
        </p>
      )}
      {offered.gaps.map((g) => (
        <p
          key={g.type}
          className="mt-1 text-[11px] leading-relaxed text-axal-muted"
          data-testid={`branch-escalate-concern-gap-${g.type}`}
        >
          {g.heading}: {g.reason}
        </p>
      ))}
      {ready && offered.note && (
        <p className="mt-1 text-[11px] leading-relaxed text-axal-muted" data-testid="branch-escalate-concern-note">
          {offered.note}
        </p>
      )}
    </div>
  );
}

/**
 * A HIDDEN KIND STEPS DOWN WITH ITS BACKGROUND AND A DASHED EDGE, NEVER WITH
 * OPACITY. Canvas H30's own note: opacity multiplies against the ground and
 * would take the reason below 3:1, and the reason is the one sentence on the
 * row that must be read — it is what tells an admin the kind is not missing by
 * accident. So the row keeps full-strength muted ink on a stepped-down ground.
 */
const HIDDEN_ROW = 'flex items-start justify-between gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-2.5 dark:border-zinc-600 dark:bg-zinc-800/40';
const HIDDEN_PILL = `${PILL} bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200`;

/**
 * The raise form's kind choices (D206).
 *
 * An offered kind is a radio. A hidden kind is a stated row with the server's
 * reason and a "Hidden" pill — and NO input, so there is nothing to select and
 * nothing to submit. Drawing it disabled would be the other available shape,
 * and it is refused on purpose: a greyed radio reads as a kind that is merely
 * unavailable right now, where this one does not exist for this licence.
 *
 * The provenance sentence (`basis`) is drawn only when it explains something
 * on screen: a hidden row, or a copy that does not say which kind of licence
 * this is — in which case every kind is offered and HQ decides.
 */
export function KindPicker({ offered, chosen, onChoose }) {
  const showBasis = Boolean(offered.basis) && (offered.hidden.length > 0 || !offered.known);
  return (
    <div data-testid="branch-escalate-kinds">
      <div className="grid gap-2 sm:grid-cols-2">
        {KINDS.filter(([value]) => offered.available.includes(value)).map(([value, label, blurb]) => (
          <label
            key={value}
            className={`flex cursor-pointer gap-2 rounded-xl border p-2.5 text-left ${
              chosen === value
                ? 'border-slate-700 bg-axal-ground dark:border-slate-300'
                : 'border-axal-hairline'
            }`}
          >
            <input
              type="radio"
              name="escalation-kind"
              value={value}
              checked={chosen === value}
              onChange={() => onChoose(value)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-bold">{label}</span>
              <span className="mt-0.5 block text-[10.5px] text-axal-muted">{blurb}</span>
            </span>
          </label>
        ))}
        {offered.hidden.map((h) => (
          <div
            key={h.kind}
            className={HIDDEN_ROW}
            data-testid={`branch-escalate-hidden-${h.kind}`}
          >
            <span className="min-w-0">
              <span className="block text-[12px] font-bold text-axal-muted">{KIND_LABEL[h.kind]}</span>
              <span className="mt-0.5 block text-[10.5px] text-axal-muted">{h.reason}</span>
            </span>
            <span className={HIDDEN_PILL}>Hidden</span>
          </div>
        ))}
      </div>
      {showBasis && (
        <p className="mt-2 text-[11px] leading-relaxed text-axal-muted" data-testid="branch-escalate-kind-basis">
          {offered.basis}
        </p>
      )}
    </div>
  );
}
/**
 * `undelivered` IS NOT AN ERROR STYLE BY ACCIDENT. It is the one state a person
 * can act on — retry — and the only one where the branch holds a row HQ does
 * not, so it reads differently from both open and answered.
 */
const STATUS_PILL = {
  open: `${PILL} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`,
  answered: `${PILL} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`,
  undelivered: `${PILL} bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300`,
};
/** The SLA band the server derived. Never recomputed here — one definition. */
const SLA_LABEL = { ok: null, due_soon: 'due within 24h', past: 'past SLA' };

/**
 * Where each lane is actually decided (D130).
 *
 * THE BOARD READS; THE CONSOLES DECIDE, so each row offers the console rather
 * than an Approve button that would write to a store this page never touches.
 *
 * SPINOUT MODERATION HAS NO CONSOLE, AND THAT IS A FINDING RATHER THAN AN
 * OMISSION HERE. `/api/admin/spinout-moderation/:userId` exists on the Worker
 * and `api.adminSpinoutModeration` / `adminSpinoutModerationDecide` exist in
 * `lib/api.js` — with **zero callers anywhere in `frontend/src`**. So a
 * moderation case is real work that reaches the backlog count, reaches this
 * board, and has nowhere to be decided. The row says that instead of linking
 * to a route that would 404, which is the failure `sidebarConfig.js` names:
 * a destination that looks shipped and is not.
 */
const LANE_CONSOLE = {
  lp: { to: '/admin/lp-applications', label: 'LP applications console' },
  referrals: { to: '/admin/refer-earn', label: 'Referral review' },
  // The cohort panel is rendered INSIDE the Spin-Out Lab admin page rather
  // than routed on its own — checked, not assumed, because a link to
  // `/admin/cohort` would 404.
  cohort: { to: '/admin/spinout-lab', label: 'Spin-Out Lab admin' },
  moderation: null,
};

/** The two views that are pure predicates over what the server already sent. */
const VIEWS = [
  ['all', 'All queues'],
  ['past', 'Past SLA'],
];

export default function BranchApprovals({ user }) {
  const [lane, setLane] = useState(null);           // null = loading, UNAVAILABLE = failed
  const [board, setBoard] = useState(null);         // D130 — the four local queues
  const [view, setView] = useState('all');
  const [kind, setKind] = useState('other');
  const [concern, setConcern] = useState('');       // D208 — the picked item's key, or none
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const load = useCallback(() => {
    setLane(null);
    api.branchEscalations().then(setLane, (e) => {
      reportError('branch-escalations', e);
      setLane(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  // SEPARATE FROM THE LANE, AND ITS OWN FAILURE. The outbound lane and the four
  // local queues are different reads against different tables; folding them
  // into one loader would make either failure blank the other half of a page
  // whose whole argument is that the two halves are different things.
  const loadBoard = useCallback(() => {
    setBoard(null);
    api.branchApprovals().then(setBoard, (e) => {
      reportError('BranchApprovals:board', e);
      setBoard(UNAVAILABLE);
    });
  }, []);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  // D206 — the kinds the licence offers, and the one the form will send.
  const offered = kindsOffered(lane);
  const chosen = chosenKind(offered, kind);
  // D208 — the items a content raise can name, from the same lane read.
  const concerns = concernsOffered(lane);

  const submit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || sending || !chosen) return;
    setSending(true);
    setSendError('');
    try {
      await api.branchEscalate({ kind: chosen, subject: subject.trim(), detail: detail.trim() || undefined,
        concerns: concernToSend(chosen, concerns, concern) });
      setSubject('');
      setDetail('');
      setConcern('');
      load();
    } catch (err) {
      reportError('branch-escalate', err);
      // THE SENTENCE BEFORE THE CODE. `request()` puts a string `error` into
      // `err.message` — here `kind_not_available` — and keeps the whole body
      // on `err.data`, whose `message` is the reason written for a person.
      setSendError(err?.data?.message || err?.message || 'The escalation could not be raised.');
    } finally {
      setSending(false);
    }
  };

  const ready = lane && lane !== UNAVAILABLE && lane.available;
  const items = ready ? (lane.items || []) : [];

  const boardReady = board && board !== UNAVAILABLE;
  const boardItems = boardReady ? (board.items || []) : [];
  const shown = view === 'past' ? boardItems.filter((it) => it.sla === 'past') : boardItems;
  const pastCount = boardItems.filter((it) => it.sla === 'past').length;

  // WHAT THE RAIL CAN HONESTLY REPORT (D126): what this page loaded. The count
  // of raised escalations and how many still await an answer are both real
  // reads; the four local queues now contribute their own lines rather than
  // nothing, and a failed read still contributes none — `coverageNote` says
  // which. The rail must never read as "nothing raised" or "nothing waiting".
  const coverage = [
    ...(ready
      ? [
        `${items.length} ${items.length === 1 ? 'escalation' : 'escalations'} raised from this branch`,
        `${items.filter((it) => !it.answer).length} awaiting an answer from HQ`,
      ]
      : []),
    ...(boardReady
      ? [
        `${boardItems.length} open across the four local queues`,
        `${pastCount} past the 72-hour SLA`,
      ]
      : []),
  ];

  return (
    <BranchZone
      workspace="Approvals"
      user={user}
      stance="Read-only summary of the board and the outbound lane"
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (lane === UNAVAILABLE && board === UNAVAILABLE
          ? 'Neither the board nor the outbound lane could be read, so there is nothing to read back — this is not a claim that nothing is waiting.'
          : 'Loading this territory\'s approvals…')}
      unavailable={[
        // NARROWED, NOT DELETED (the D111 pattern). The board exists now, so
        // the old line, which promised the read model as future work,
        // became false the moment this shipped. What is still genuinely
        // missing is smaller, and saying the smaller true thing is the point.
        ['Assignment and history', 'Who a queue item is assigned to, and its history timeline, need a store that does not exist. Nothing records either today, so the board shows neither rather than showing them empty.'],
        ['An AI-drafted decision note', 'The canvas draws one with its cost. There is no per-branch AI cost figure — the gateway metadata that would produce one is not wired — so a cost line here would be invented.'],
        ['A reply to HQ', 'An escalation carries one answer with an author and a time. There is no thread, so there is nothing for a reply to be added to.'],
      ]}
    >
    <div className="space-y-4" data-testid="branch-approvals-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Send size={13} /> S3 · Approvals
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">
          To HQ
        </h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          What this territory cannot decide for itself goes to HQ, and HQ&rsquo;s decision comes back
          here. Below it, the four local queues this territory does decide, as one board.
        </p>
      </header>

      <Card className="p-4">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">Raise one</h2>
        <form className="mt-3 space-y-3" onSubmit={submit} data-testid="branch-escalate-form">
          <KindPicker offered={offered} chosen={chosen} onChoose={setKind} />
          {/* D208 — for content only: the one kind whose subject is an item
              this branch holds. Every other kind describes itself in words. */}
          {chosen === 'content' && (
            <ConcernsPicker offered={concerns} value={concern} onChoose={setConcern} />
          )}
          <input
            className="w-full rounded-xl border border-axal-hairline bg-axal-ground p-2.5 text-[12.5px]"
            placeholder="What is this about?"
            value={subject}
            maxLength={300}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="branch-escalate-subject"
          />
          <textarea
            className="w-full rounded-xl border border-axal-hairline bg-axal-ground p-2.5 text-[12.5px]"
            rows={3}
            placeholder="Anything HQ needs in order to decide (optional)"
            value={detail}
            maxLength={4000}
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!subject.trim() || sending || !chosen}
              className="rounded-xl bg-slate-700 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-slate-300 dark:text-slate-900"
            >
              {sending ? 'Raising…' : 'Raise to HQ'}
            </button>
            {/* SAID ON THE FORM, because it is the one thing about this screen
                that is different from every other branch write. */}
            <span className="text-[11px] text-axal-faint">
              This stays available while a licence is suspended — it is the appeal path.
            </span>
          </div>
          {sendError && (
            <p className="text-[12px] text-red-700 dark:text-red-300" data-testid="branch-escalate-error">
              {sendError}
            </p>
          )}
        </form>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">Raised from here</h2>
          {ready && <span className="text-[11.5px] text-axal-faint">as of {lane.as_of}</span>}
        </div>

        {lane === UNAVAILABLE && (
          <Unreadable
            what="The To-HQ lane"
            claim="This is not a claim that nothing was raised."
            onRetry={load}
          />
        )}
        {lane && lane !== UNAVAILABLE && !lane.available && (
          <p className="text-[12.5px] leading-relaxed text-axal-muted">
            <Unrecorded /> — {lane.reason}
          </p>
        )}
        {ready && items.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="branch-lane-empty">
            Nothing has been raised from this territory. The store exists and is empty, which is not
            the same as a lane that cannot be read.
          </p>
        )}

        {items.length > 0 && (
          <ul className="space-y-2" data-testid="branch-escalation-list">
            {items.map((it) => (
              <li
                key={it.id}
                className="rounded-xl border border-axal-hairline bg-axal-ground p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold">{it.subject}</div>
                    <div className="mt-0.5 text-[10.5px] text-axal-faint">
                      {it.kind.replace('_', ' ')} · raised {it.created_at}
                      {it.sla && SLA_LABEL[it.sla] ? ` · ${SLA_LABEL[it.sla]}` : ''}
                    </div>
                    {/* D208 — the item it was raised about, in the words HQ
                        received. "About" is the word HQ Support already uses
                        for this field, so one field has one word. */}
                    {it.subject_ref && (
                      <div className="mt-0.5 text-[10.5px] text-axal-muted" data-testid="branch-escalation-about">
                        About <span className="font-mono">{it.subject_ref}</span>
                      </div>
                    )}
                  </div>
                  <span className={STATUS_PILL[it.status] || STATUS_PILL.open}>{it.status}</span>
                </div>

                {/* NOT DELIVERED IS ITS OWN STATE, with the reason, because the
                    branch holds this row and HQ does not — nothing may count
                    it as an escalation HQ has. */}
                {it.status === 'undelivered' && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-red-700 dark:text-red-300">
                    This has not reached HQ, so it is not on their queue. {it.delivery_error}
                  </p>
                )}

                {/* `bg-white dark:bg-slate-900`, not an `axal-` token: the
                    declared set is ground/hairline/ink/muted/faint and the
                    first draft invented `axal-surface`, which Tailwind v4
                    mints as nothing at all. The token guard caught it. */}
                {it.answer && (
                  <div className="mt-2 rounded-lg border border-axal-hairline bg-white p-2.5 dark:bg-slate-900">
                    <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
                      HQ&rsquo;s decision
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed">{it.answer}</p>
                    <p className="mt-1 text-[10.5px] text-axal-faint">
                      {it.answered_by_name || 'Axal VC HQ'} · {it.answered_at}
                      {it.pushed_at ? ` · received ${it.pushed_at}` : ''}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* THE SHAPE, STATED. A reader who expects a conversation should learn
            here that there is not one, rather than by looking for a reply box
            that does not exist. */}
        {ready && (
          <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="branch-answer-shape">
            {lane.answer_note}
          </p>
        )}
      </Card>

      {/* ── The four local queues, as one board (S3, D130) ── */}
      <Card className="p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14.5px] font-extrabold tracking-tight">The work board</h2>
          {boardReady && (
            <span className="text-[11.5px] text-axal-faint" data-testid="branch-board-summary">
              {boardItems.length} open · {pastCount} past SLA
            </span>
          )}
        </div>
        <p className="mb-3 text-[11.5px] leading-relaxed text-axal-muted">
          Four queues that were four consoles, ordered by what has waited longest. The board reads;
          each decision is still made in that queue&rsquo;s own console.
        </p>

        {board === UNAVAILABLE && (
          <Unreadable
            what="The work board"
            claim="This is not a claim that the queues are empty."
            onRetry={loadBoard}
          />
        )}
        {!board && <p className="text-[12px] text-axal-faint">Loading the queues…</p>}

        {boardReady && (
          <>
            {/* PER-LANE COUNTS, because a lane that answered 0 and a lane that
                could not be read are different facts and must not both render
                as a dash. */}
            <div className="mb-3 flex flex-wrap gap-1.5" data-testid="branch-board-lanes">
              {(board.lanes || []).map((ln) => (
                <span
                  key={ln.key}
                  className="rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-semibold"
                  data-testid={`branch-lane-${ln.key}`}
                >
                  {ln.label}{' '}
                  {ln.count === null
                    ? <Unrecorded reason="This queue could not be read, so its count is unknown rather than zero.">unreadable</Unrecorded>
                    : <span className="tabular-nums text-axal-muted">{ln.count}</span>}
                </span>
              ))}
            </div>

            {board.reason && (
              <p className="mb-3 text-[11.5px] leading-relaxed text-red-700 dark:text-red-300" data-testid="branch-board-gap">
                {board.reason}
              </p>
            )}

            <div className="mb-2 flex gap-1.5" data-testid="branch-board-views">
              {VIEWS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    view === key
                      ? 'bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-900'
                      : 'border border-axal-hairline text-axal-muted'
                  }`}
                >
                  {label}
                  {key === 'past' ? ` (${pastCount})` : ''}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="branch-board-empty">
                {view === 'past'
                  ? 'Nothing is past the 72-hour SLA.'
                  : 'All four queues are empty. They were read and hold nothing, which is not the same as a queue that could not be read.'}
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="branch-board-rows">
                {shown.map((it) => {
                  const console_ = LANE_CONSOLE[it.lane];
                  return (
                    <li
                      key={`${it.lane}:${it.id}`}
                      className={`rounded-xl border p-2.5 ${
                        it.sla === 'past'
                          ? 'border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/5'
                          : it.sla === 'due_soon'
                            ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5'
                            : 'border-axal-hairline'
                      }`}
                      data-sla={it.sla}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[12px] font-bold">{it.who}</span>
                        <span className="text-[10.5px] tabular-nums text-axal-faint">
                          {it.age_hours === null
                            ? <Unrecorded reason="This row's timestamp would not parse, so its age is unknown. It sorts last rather than first — an unknown age must not read as the most urgent thing here.">age unknown</Unrecorded>
                            : `${Math.round(it.age_hours)}h old`}
                          {SLA_LABEL[it.sla] ? ` · ${SLA_LABEL[it.sla]}` : ''}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-2 text-[11px] text-axal-muted">
                        <span>{it.what}</span>
                        {console_ ? (
                          <Link className="underline" to={console_.to}>{console_.label} →</Link>
                        ) : (
                          // THE LINK IS ABSENT BECAUSE THE PAGE IS. Stated on
                          // the row rather than pointed at a route that 404s.
                          <span className="text-axal-faint" data-testid="branch-board-no-console">
                            no console — the decision surface for moderation has not been built
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
    </BranchZone>
  );
}
