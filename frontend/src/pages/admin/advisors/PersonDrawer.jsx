import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminNetworkProfiles } from '../../../lib/api';
import { adminNetworkApi } from '../../../lib/api/network.js';
import { reportError } from '../../../lib/log';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { CardDialog } from './DeckRosterDialogs';
import { cardPayload } from './deckRosterModel';
import {
  DECIDED, NOT_RECORDED, REASON_MAX, UNREADABLE, agoWord, cell, controlsOf, dayWord, deckDraftOf, deckWord, dialogCopy,
  directoryWord, effectsLine, kindWord, laneWord, refusalWord, stageWord, standingCell, take, usd,
} from './peopleModel';

/**
 * D978 (#2764) — one person (AP4): profile, standing, work, terms, deck and
 * history, every section read only and linked to where it is decided, with
 * Pause in network (AP9c) and the advisor directory switch at its foot. A
 * centred lightbox on a desktop; a full-screen page on a phone (AP13c).
 *
 * THREE READS, EACH ITS OWN BLOCK. D973's drawer read (`/people/:ref`) is the
 * person; D976's standing read (`/people/:userId`) is their stage, pause and
 * directory listing; the deck roster (D974) says whether a card is linked to
 * their account. One failing never blanks the others.
 */

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SUB = 'text-[12px] leading-[1.45] text-axal-muted dark:text-gray-400';
const SEC = 'flex flex-col gap-2 border-t border-axal-hairline pt-3.5 dark:border-gray-700';
const H3 = 'm-0 text-[13.5px] font-extrabold tracking-[-.01em] text-axal-ink dark:text-gray-100';
const LINK = 'text-[12px] font-semibold text-axal-violet underline-offset-2 hover:underline dark:text-violet-300';
const PILL = 'inline-flex items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[11.5px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100';
const ERR = 'text-[12.5px] text-axal-destructive dark:text-red-400';

const idle = { status: 'loading', data: null };

function Value({ c }) {
  if (c.state === 'ready') return <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{c.text}</span>;
  return (
    <span className={c.state === 'unreadable' ? ERR : SUB} title={c.reason}>
      {c.text}<span className="sr-only">: {c.reason}</span>
    </span>
  );
}

function Fact({ k, c, testId }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-2 max-sm:grid-cols-1 max-sm:gap-0.5" data-testid={testId}>
      <dt className={EYE}>{k}</dt>
      <dd className="m-0"><Value c={c} /></dd>
    </div>
  );
}

function Standing({ k, c, decided, testId }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2" data-testid={testId}>
      <span className="flex flex-col">
        <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{k}</span>
        {decided ? <Link to={decided.to} className={LINK}>{decided.text}</Link> : null}
      </span>
      <Value c={c} />
    </div>
  );
}

function Block({ title, children, testId, meta }) {
  return (
    <section className={SEC} data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={H3}>{title}</h3>
        {meta ? <span className={SUB}>{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** A block whose whole read failed or is not recorded, said in its section. */
function Whole({ b, children }) {
  if (b && b.available && b.recorded) return children(b.value);
  const c = cell(b);
  return <p className={`m-0 ${c.state === 'unreadable' ? ERR : SUB}`}>{c.text}. {c.reason}</p>;
}

/** Pause, Resume, Hide and Show: one dialog each, saying what it changes before anything is written. */
function ActDialog({ act, person, onClose, onDone }) {
  const copy = dialogCopy(act, person);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const ready = !copy.reason || reason.trim().length > 0;
  const run = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try {
      const uid = String(person.user_id);
      let reply;
      if (act === 'pause') reply = await adminNetworkApi.pause(uid, reason.trim());
      else if (act === 'resume') reply = await adminNetworkApi.resume(uid, reason.trim());
      else reply = await adminNetworkApi.setListed(uid, act === 'show');
      onDone(act === 'pause' ? effectsLine(reply?.effects)
        : act === 'resume' ? 'Resumed.'
          : act === 'hide' ? 'Hidden from the advisor directory.' : (reply?.listed === false ? 'Shown again, but still hidden while paused.' : 'Shown in the advisor directory.'));
    } catch (e) {
      setRefusal(refusalWord(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} testId={`person-${act}-dialog`} width={560}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={actionPrimary} onClick={run} disabled={busy || !ready} data-testid={`person-${act}-confirm`}>{busy ? copy.busy : copy.button}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">{copy.body}</p>
        {copy.reason ? (
          <label className="flex flex-col gap-1">
            <span className={EYE}>Reason · required</span>
            <textarea value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Write a reason…" data-testid={`person-${act}-reason`}
              className="rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
            <span className={SUB}>Kept with the {act === 'pause' ? 'pause' : 'resume'} in the network’s record.</span>
          </label>
        ) : null}
        {refusal ? <p role="alert" className={`m-0 ${ERR}`} data-testid={`person-${act}-refusal`}>{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

/** The person's three reads. Each settles alone. */
function usePersonReads(ref) {
  const [main, setMain] = useState(idle);
  const [standing, setStanding] = useState(idle);
  const [deck, setDeck] = useState(idle);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setMain(idle); setStanding(idle); setDeck(idle);
    adminNetworkApi.person(ref).then(
      (data) => {
        if (!live) return;
        setMain({ status: 'ready', data });
        const p = data?.person;
        if (!p || p.kind === 'deck_only' || p.user_id == null) {
          setStanding({ status: 'none', data: null });
          setDeck({ status: 'none', data: null });
          return;
        }
        adminNetworkApi.person(String(p.user_id)).then(
          (s) => { if (live) setStanding({ status: 'ready', data: s }); },
          (e) => { reportError('advisors-partners:standing', e); if (live) setStanding({ status: 'error', data: null, reason: e?.message }); },
        );
        Promise.all([adminNetworkProfiles.list({ limit: 500 }), adminNetworkProfiles.list({ state: 'archived', limit: 500 })]).then(
          ([open, archived]) => {
            if (!live) return;
            const rows = [...(open?.profiles || []), ...(archived?.profiles || [])];
            setDeck({ status: 'ready', data: rows.find((r) => Number(r?.linked_user?.id) === Number(p.user_id)) || null });
          },
          (e) => { reportError('advisors-partners:deck-link', e); if (live) setDeck({ status: 'error', data: null }); },
        );
      },
      (e) => { reportError('advisors-partners:person', e); if (live) setMain({ status: e?.status === 404 ? 'missing' : 'error', data: null, reason: e?.message }); },
    );
    return () => { live = false; };
  }, [ref, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { main, standing, deck, reload };
}

const stateWord = (row) => (row.archived_at ? 'archived' : row.state === 'shown' || row.is_active ? 'shown on the deck' : 'hidden from the deck');

export default function PersonDrawer({ personRef, onClose, onChanged, now }) {
  const { main, standing, deck, reload } = usePersonReads(personRef);
  const [asking, setAsking] = useState(null);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState('');
  const p = main.data?.person;
  const s = standing.status === 'ready' ? standing.data : null;
  const controls = controlsOf(p, s);
  const title = p?.name || (main.status === 'loading' ? 'Reading…' : 'Person');

  const after = (line) => { setAsking(null); setDone(line); reload(); onChanged?.(); };

  const saveCard = async ({ form }) => {
    const reply = await adminNetworkProfiles.create(cardPayload(form));
    return { row: reply?.profile || reply };
  };

  const pills = p ? (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="person-pills">
      <span className={PILL}>{kindWord(p.kind)}</span>
      {s?.stage ? <span className={PILL} data-testid="person-stage">{stageWord(s.stage)}</span> : null}
      {p.user_id != null ? <Link to={DECIDED.account.to} className={LINK}>{DECIDED.account.text} ›</Link> : null}
    </span>
  ) : null;

  const footer = p ? (
    <div className="flex flex-wrap justify-end gap-2" data-testid="person-foot">
      {controls.pause ? <button type="button" className={actionGhost} onClick={() => setAsking(controls.pause)} data-testid={`person-${controls.pause}`}>{controls.pause === 'pause' ? 'Pause in network' : 'Resume in network'}</button> : null}
      {controls.directory ? <button type="button" className={actionGhost} onClick={() => setAsking(controls.directory)} data-testid={`person-${controls.directory}`}>{controls.directory === 'hide' ? 'Hide from advisor directory' : 'Show in advisor directory'}</button> : null}
      <button type="button" className={actionGhost} onClick={onClose} data-testid="person-close">Close</button>
    </div>
  ) : null;

  return (
    <>
      <Lightbox label={title} eyebrow="Person" title={title} sub={p ? cell(p.headline).state === 'ready' ? cell(p.headline).text : null : null}
        onClose={onClose} width={760} size="tall" pageBelow="lg" testId="person-drawer" footer={footer}>
        <div className="flex flex-col gap-3.5" data-testid="person-body">
          {main.status === 'loading' ? <p className={SUB}>Reading…</p> : null}
          {main.status === 'missing' ? <p className={SUB} data-testid="person-missing">No one in the network has this reference. They may have been removed.</p> : null}
          {main.status === 'error' ? (
            <div role="alert" className="flex flex-col gap-2" data-testid="person-unreadable">
              <span className={ERR}>{UNREADABLE}. This person could not be read. {main.reason || ''}</span>
              <button type="button" className={actionGhost} onClick={reload}>Try again</button>
            </div>
          ) : null}
          {p ? (
            <>
              {pills}
              {done ? <p role="status" className="m-0 rounded-[9px] bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="person-done">{done}</p> : null}

              <Block title="Profile" testId="person-profile">
                <Whole b={main.data.profile}>
                  {(v) => (
                    <dl className="m-0 flex flex-col gap-1.5">
                      <Fact k="Bio" c={v.bio ? { state: 'ready', text: v.bio } : { state: 'unrecorded', text: NOT_RECORDED, reason: 'No bio is recorded.' }} />
                      <Fact k="Expertise" c={cell(p.skills, (l) => (l.length ? l.join(' · ') : 'None listed'))} />
                      <Fact k="Sectors" c={cell(p.sectors, (l) => (l.length ? l.join(' · ') : 'None listed'))} />
                      <Fact k="Stages" c={cell(v.stages, (l) => (l.length ? l.join(' · ') : 'None listed'))} />
                      <Fact k="Languages" c={cell(v.languages, (l) => (l.length ? l.join(' · ') : 'None listed'))} />
                      <Fact k="Country and timezone" c={cell(v.country, (cty) => (take(v.timezone) ? `${cty} · ${take(v.timezone)}` : cty))} />
                      <Fact k="Availability note" c={cell(v.availability_note)} />
                      <Fact k="Weekly hours" c={cell(v.weekly_hours)} />
                      <Fact k="LinkedIn" c={cell(v.linkedin_url)} />
                    </dl>
                  )}
                </Whole>
              </Block>

              <Block title="Standing" testId="person-standing" meta="Read only. Each is decided where it links.">
                <Standing k="Profile check" c={cell(p.profile_check)} decided={DECIDED.profile} testId="person-standing-profile" />
                <Standing k="KYC" c={cell(p.kyc)} decided={DECIDED.kyc} testId="person-standing-kyc" />
                <Standing k="Lab host" c={cell(p.lab_host, (l) => (l.length ? `${l[l.length - 1].status}`.replace(/^./, (x) => x.toUpperCase()) : 'Not a Lab host'))} decided={DECIDED.host} testId="person-standing-host" />
                {p.kind === 'advisor' ? (
                  <Standing k="Public advisor directory" testId="person-standing-directory"
                    c={standing.status === 'loading' ? { state: 'ready', text: 'Reading…' }
                      : standing.status === 'error' ? { state: 'unreadable', text: UNREADABLE, reason: 'Their standing could not be read. Try again.' }
                        : s?.directory && typeof s.directory.listed === 'boolean' ? { state: 'ready', text: directoryWord(s.directory, s.pause?.paused) }
                          : { state: 'unrecorded', text: NOT_RECORDED, reason: p.advisor_id == null ? 'No advisor profile, so no directory listing.' : 'No listing is recorded.' }} />
                ) : null}
                {s?.pause?.paused ? (
                  <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="person-paused">
                    Paused{dayWord(s.pause.paused_at) ? ` since ${dayWord(s.pause.paused_at)}` : ''}. Reason: {s.pause.reason || NOT_RECORDED}
                  </p>
                ) : null}
                {standing.status === 'error' ? (
                  <p role="alert" className={`m-0 ${ERR}`} data-testid="person-standing-unreadable">
                    {UNREADABLE}. Their stage, pause and directory listing could not be read, so Pause and Hide wait. <button type="button" className={LINK} onClick={reload}>Try again</button>
                  </p>
                ) : null}
              </Block>

              <Block title="Work" testId="person-work">
                <Fact k="Cohort assignments" testId="person-work-cohorts"
                  c={cell(main.data.work?.cohort_assignments, (l) => (l.length ? l.map((a) => `Cohort ${a.cohort_id}${dayWord(a.assigned_at) ? ` · since ${dayWord(a.assigned_at)}` : ''}`).join('; ') : 'None'))} />
                <Link to={DECIDED.cohorts.to} className={LINK}>{DECIDED.cohorts.text}</Link>
                <Fact k="Open office-hour slots, next 14 days" c={cell(main.data.work?.open_slots_14d, (n) => String(n))} testId="person-work-slots" />
                <Fact k="Sessions, 90 days" testId="person-work-sessions"
                  c={cell(main.data.work?.sessions_90d, (v) => `${v.completed} completed · ${v.booked} booked · ${v.cancelled} cancelled · ${v.no_show} no-show`)} />
                {p.kind === 'operating_partner' ? (
                  <Fact k="Firm sessions, 90 days" testId="person-work-firm-sessions"
                    c={cell(main.data.work?.firm_sessions_90d, (v) => `${v.completed} completed · ${v.booked} booked · ${v.cancelled} cancelled · ${v.no_show} no-show (the firm’s)`)} />
                ) : null}
                <Fact k="Engagements with founders" testId="person-work-engagements"
                  c={cell(main.data.work?.engagements, (l) => l.map((x) => `${laneWord(x.lane)} ${x.count}`).join(' · '))} />
                <span className={SUB}>Client names stay the advisor’s.</span>
              </Block>

              <Block title="Terms" testId="person-terms">
                <Fact k="Hourly rate" c={cell(main.data.terms?.hourly_rate, (r) => `${usd(r.amount_cents)} an hour`)} testId="person-terms-rate" />
                <Fact k="Active deals" testId="person-terms-deals"
                  c={cell(main.data.terms?.active_deals, (l) => (l.length ? l.map((d) => `${String(d.type || 'Deal').replace(/_/g, ' ')}${dayWord(d.ends_at) ? ` · ends ${dayWord(d.ends_at)}` : ''}`).join('; ') : 'No active deal'))} />
                <Fact k="Payout account" testId="person-terms-payout"
                  c={s ? standingCell(s.payout, (v) => (v.ready ? 'Ready' : v.on_file ? `On file · ${String(v.state || '').replace(/_/g, ' ') || 'not ready'}` : 'Not on file'))
                    : standing.status === 'error' ? { state: 'unreadable', text: UNREADABLE, reason: 'Their standing could not be read.' } : cell(main.data.terms?.payout_readiness)} />
                <Fact k="Studio agreement on file" testId="person-terms-agreement"
                  c={s ? standingCell(s.agreement, (v) => (v.on_file ? `Signed${dayWord(v.signed_at) ? ` ${dayWord(v.signed_at)}` : ''}` : 'Not on file'))
                    : standing.status === 'error' ? { state: 'unreadable', text: UNREADABLE, reason: 'Their standing could not be read.' } : cell(main.data.terms?.studio_agreement)} />
              </Block>

              <Block title="Deck" testId="person-deck">
                {p.kind === 'deck_only' ? (
                  <>
                    <Value c={cell(p.deck, deckWord)} />
                    <Link to={DECIDED.deck.to} className={LINK}>{DECIDED.deck.text}</Link>
                  </>
                ) : deck.status === 'loading' ? <span className={SUB}>Reading…</span>
                  : deck.status === 'error' ? <span className={ERR}>{UNREADABLE}. The deck roster could not be read, so whether they have a card is unknown.</span>
                    : deck.data ? (
                      <>
                        <span className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="person-deck-card">A deck card is linked to their account, {stateWord(deck.data)}.</span>
                        <Link to={DECIDED.deck.to} className={LINK}>{DECIDED.deck.text}</Link>
                      </>
                    ) : (
                      <>
                        <span className={SUB} data-testid="person-deck-none">No deck card is linked to their account.</span>
                        <button type="button" className={`${actionGhost} self-start`} onClick={() => setAdding(true)} data-testid="person-deck-add">Add to deck roster</button>
                        <span className={SUB}>The deck card opens filled in, hidden from the deck until you show it.</span>
                      </>
                    )}
              </Block>

              <Block title="History" testId="person-history">
                <Whole b={main.data.history}>{() => null}</Whole>
                {s?.pause?.last_resumed_at ? (
                  <span className="text-[12.5px] text-axal-ink dark:text-gray-100">Last resumed {dayWord(s.pause.last_resumed_at) || agoWord(s.pause.last_resumed_at, now)}. Reason: {s.pause.last_resume_reason || NOT_RECORDED}</span>
                ) : null}
              </Block>
            </>
          ) : null}
        </div>
      </Lightbox>
      {asking && p ? <ActDialog act={asking} person={p} onClose={() => setAsking(null)} onDone={after} /> : null}
      {adding && p ? (
        <CardDialog row={deckDraftOf(p)} onClose={() => setAdding(false)} save={saveCard}
          onSaved={() => { setAdding(false); setDone('Added to the deck roster, hidden until you show it on Deck roster.'); reload(); onChanged?.(); }} />
      ) : null}
    </>
  );
}
