// D4298 (#4298, D4289 P9) — Admin › Programs › Influencers (IN11): the
// Applications queue with its answers drawer, the Influencers table with its
// row actions and the flagged sign-ups, Offers, Payouts and Settings. How it
// runs and Activity are part 1's playbook and activity reads (ProgramPage).
//
// Money is the Super Admin's (O-MONEY A): every money cell draws what the
// Worker sent, so an admin reads "HQ reads", never a zero. Every row action
// asks for a reason, as the Worker does; admit names a tier instead.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../../ui/Lightbox';
import { actionGhost, actionPrimary } from '../../../ui';
import { adminInfluencersApi } from '../../../lib/api/adminInfluencers';
import {
  BlockFailed, Card, Chip, DIALOG_BODY, DialogButtons, FIELD_LABEL, Field, INPUT, LINK, Pill, SUB, Skeleton, TD, TH,
} from './parts';
import {
  ADMIT_TIERS, APPLICATION_WORD, BONUSES_LINK, FLAG_WORD, HQ_READS, NOT_RECORDED, PAYOUTS_LINK, PROMOS_LINK, REASON_MAX,
  STATUS_WORD, TIER_LABEL, TIER_ORDER, audienceOf, changeBody, channelsOf, countWord, dayWord, decisionBody, defaultCells,
  defaultsBody, moneyLines, offerRow, reasonError, regionsOf, rowActions, topicsOf,
} from './influencersModel';

/** A read and its reload, keyed on `tick`: loading, ready or error. */
function useRead(load, deps) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    load().then((data) => { if (live) setRead({ status: 'ready', data }); }, () => { if (live) setRead({ status: 'error', data: null }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [read, reload];
}

const say = (e) => (typeof e?.message === 'string' && e.message.trim() && e.message !== 'Request failed' ? e.message : 'That could not be saved. Nothing changed; try again.');

/** One money cell: a line per currency, or the reason it is not drawn. */
function MoneyCell({ field, testId }) {
  const lines = moneyLines(field);
  return (
    <span className="flex flex-col text-right font-mono text-[12.5px]" data-testid={testId}>
      {lines.map((l) => <span key={l} className={l === HQ_READS || l === NOT_RECORDED ? 'italic text-axal-muted dark:text-gray-400' : ''}>{l}</span>)}
    </span>
  );
}

function StatusPill({ status, testId }) {
  const tone = status === 'active' ? 'green' : status === 'paused' ? 'amber' : 'muted';
  return <Pill tone={tone} testId={testId}>{STATUS_WORD[status] || NOT_RECORDED}</Pill>;
}

/** A reason dialog: what the action does, the reason, and the write. */
function ReasonDialog({ title, sub, action, tone = 'primary', extra = null, check = null, onSubmit, onClose, testId }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(null);
  async function go() {
    const err = reasonError(reason) || (check ? check(reason.trim()) : null);
    if (err) { setRefusal(err); return; }
    setBusy(true); setRefusal(null);
    try { setDone(await onSubmit(reason.trim())); } catch (e) { setRefusal(say(e)); } finally { setBusy(false); }
  }
  return (
    <Lightbox label={title} title={title} sub={sub} onClose={onClose} width={520} testId={testId}>
      <div className={DIALOG_BODY}>
        {extra}
        <Field label="Reason" value={reason} onChange={setReason} max={REASON_MAX} rows={3} sub="The member is told, with this reason. At least 10 characters." testId={`${testId}-reason`} />
        <DialogButtons onClose={onClose} action={action} onAction={go} busy={busy} tone={tone} refusal={refusal} done={done} testId={`${testId}-submit`} />
      </div>
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * Applications (in11a)
 * ------------------------------------------------------------------ */

const APP_FILTERS = [['open', 'Waiting'], ['admitted', 'Admitted'], ['declined', 'Declined'], ['all', 'All']];

export function ApplicationsTab({ onCount }) {
  const [filter, setFilter] = useState('open');
  const [read, reload] = useRead(() => adminInfluencersApi.applications(filter), [filter]);
  const [open, setOpen] = useState(null);
  const apps = read.status === 'ready' ? read.data?.applications || [] : [];
  useEffect(() => { if (read.status === 'ready' && onCount) onCount(read.data?.counts || null); }, [read, onCount]);
  return (
    <Card title="Applications" meta={read.status === 'ready' ? `${apps.length.toLocaleString('en-US')} shown` : null} testId="influencers-applications">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {APP_FILTERS.map(([key, label]) => <Chip key={key} on={filter === key} onClick={() => setFilter(key)} testId={`influencers-applications-filter-${key}`}>{label}</Chip>)}
      </div>
      {read.status === 'loading' ? <Skeleton lines={3} /> : null}
      {read.status === 'error' ? <BlockFailed what="The applications" onRetry={reload} testId="influencers-applications-unreadable" /> : null}
      {read.status === 'ready' && !apps.length ? <p className={`m-0 ${SUB}`} data-testid="influencers-applications-empty">{filter === 'open' ? 'Nothing is waiting.' : 'No application matches.'}</p> : null}
      {apps.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]" data-testid="influencers-applications-table">
            <thead><tr><th className={TH}>Applicant</th><th className={TH}>Channels</th><th className={`${TH} text-right`}>Audience</th><th className={TH}>Sent</th><th className={TH}>State</th><th className={TH} /></tr></thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`influencers-app-${a.uid}`}>
                  <td className={TD}><span className="flex flex-col"><span className="font-bold">{a.applicant?.name || NOT_RECORDED}</span><span className={SUB}>{regionsOf(a)}</span></span></td>
                  <td className={TD}><span className="flex flex-wrap gap-1">{channelsOf(a).map((c) => <Pill key={`${c.kind}-${c.url}`}>{c.kind}</Pill>)}</span></td>
                  <td className={`${TD} text-right font-mono`}>{audienceOf(a)}</td>
                  <td className={TD}>{dayWord(a.created_at)}</td>
                  <td className={TD}><Pill tone={a.status === 'applied' ? 'violet' : 'muted'}>{APPLICATION_WORD[a.status] || a.status}</Pill></td>
                  <td className={TD}><button type="button" className={LINK} onClick={() => setOpen(a)} data-testid={`influencers-app-${a.uid}-open`}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {open ? <AnswersDrawer app={open} onClose={() => setOpen(null)} onDecided={() => { setOpen(null); reload(); }} /> : null}
    </Card>
  );
}

/** The answers drawer (in11a): the answers, Admit at tier, Decline… and Ask for more…. */
export function AnswersDrawer({ app, onClose, onDecided }) {
  const [tier, setTier] = useState(ADMIT_TIERS[0]);
  const [mode, setMode] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const waiting = app.status === 'applied' || app.status === 'more_requested';
  async function decide(kind) {
    const out = decisionBody(kind, { tier, text });
    if (out.error) { setRefusal(out.error); return; }
    setBusy(true); setRefusal(null);
    try { await adminInfluencersApi.decide(app.uid, out.body); onDecided(); } catch (e) { setRefusal(say(e)); } finally { setBusy(false); }
  }
  const a = app.answers || {};
  return (
    <Lightbox label={app.applicant?.name || 'Application'} title={app.applicant?.name || NOT_RECORDED} sub={`Applied ${dayWord(app.created_at)}`} onClose={onClose} width={560} testId="influencers-drawer">
      <div className={DIALOG_BODY}>
        <section className="flex flex-col gap-1"><span className={FIELD_LABEL}>Channels</span>
          {channelsOf(app).map((c) => <span key={`${c.kind}-${c.url}`} className="font-mono text-[12.5px]" data-testid="influencers-drawer-channel">{`${c.url || c.kind} · ${c.audience}`}</span>)}
        </section>
        <section className="flex flex-col gap-1"><span className={FIELD_LABEL}>Regions and topics</span><span className="text-[13px]">{`${regionsOf(app)} · ${topicsOf(app)}`}</span></section>
        <section className="flex flex-col gap-1"><span className={FIELD_LABEL}>Why Axal</span><span className="text-[13px]" data-testid="influencers-drawer-why">{a.why || NOT_RECORDED}</span></section>
        <section className="flex flex-col gap-1"><span className={FIELD_LABEL}>Rules agreed</span>
          <span className="text-[13px]" data-testid="influencers-drawer-consent">{app.consent_version ? `Disclosure · no deal or fund promotion · no self-referral (terms ${app.consent_version})` : NOT_RECORDED}</span>
        </section>
        {app.reason ? <section className="flex flex-col gap-1"><span className={FIELD_LABEL}>{app.status === 'declined' ? 'HQ’s reason' : 'HQ asked'}</span><span className="text-[13px]">{app.reason}</span></section> : null}
        {waiting ? (
          <>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="influencers-drawer-tiers">
              <legend className={FIELD_LABEL}>Admit at tier</legend>
              {ADMIT_TIERS.map((t) => (
                <label key={t} className="flex items-center gap-2 text-[13px]">
                  <input type="radio" name="tier" checked={tier === t} onChange={() => setTier(t)} data-testid={`influencers-drawer-tier-${t}`} />{TIER_LABEL[t]}
                </label>
              ))}
            </fieldset>
            {mode ? (
              <Field label={mode === 'decline' ? 'Why HQ declines (the applicant reads this)' : 'What HQ needs (the applicant reads this)'} value={text} onChange={setText} max={REASON_MAX} rows={3} testId="influencers-drawer-text" />
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={actionGhost} onClick={() => (mode === 'decline' ? decide('decline') : setMode('decline'))} disabled={busy} data-testid="influencers-drawer-decline">{mode === 'decline' ? 'Decline' : 'Decline…'}</button>
              <button type="button" className={actionGhost} onClick={() => (mode === 'more' ? decide('more') : setMode('more'))} disabled={busy} data-testid="influencers-drawer-more">{mode === 'more' ? 'Ask' : 'Ask for more…'}</button>
              <button type="button" className={actionPrimary} onClick={() => decide('admit')} disabled={busy} data-testid="influencers-drawer-admit">Admit</button>
            </div>
            {refusal ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="influencers-drawer-refusal">{refusal}</p> : null}
          </>
        ) : <p className={`m-0 ${SUB}`} data-testid="influencers-drawer-decided">{`Decided ${dayWord(app.decided_at)}.`}</p>}
      </div>
    </Lightbox>
  );
}

/* ------------------------------------------------------------------ *
 * Influencers and flagged sign-ups (in11b, in11d)
 * ------------------------------------------------------------------ */

export function InfluencersTab() {
  const [read, reload] = useRead(() => adminInfluencersApi.list('all'), []);
  const [act, setAct] = useState(null);
  const list = read.status === 'ready' ? read.data?.influencers || [] : [];
  return (
    <div className="flex flex-col gap-3.5">
      <Card title="Influencers" meta={read.status === 'ready' ? `${list.length.toLocaleString('en-US')} people` : null} testId="influencers-table-card">
        {read.status === 'loading' ? <Skeleton lines={3} /> : null}
        {read.status === 'error' ? <BlockFailed what="The influencers" onRetry={reload} testId="influencers-table-unreadable" /> : null}
        {read.status === 'ready' && !list.length ? <p className={`m-0 ${SUB}`} data-testid="influencers-table-empty">No one has been admitted yet.</p> : null}
        {list.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]" data-testid="influencers-table">
              <thead><tr>
                <th className={TH}>Influencer</th><th className={TH}>Tier</th><th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Visits</th><th className={`${TH} text-right`}>Sign-ups</th><th className={`${TH} text-right`}>Paid</th>
                <th className={`${TH} text-right`}>Revenue</th><th className={`${TH} text-right`}>Commission</th><th className={TH} />
              </tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`influencers-row-${m.uid}`}>
                    <td className={TD}><span className="flex flex-col"><span className="font-mono font-bold">{m.handle ? `@${m.handle}` : 'No handle yet'}</span><span className={SUB}>{m.person?.name || NOT_RECORDED}</span></span></td>
                    <td className={TD}>{m.tier_label || TIER_LABEL[m.tier] || NOT_RECORDED}</td>
                    <td className={TD}><StatusPill status={m.status} testId={`influencers-row-${m.uid}-status`} /></td>
                    <td className={`${TD} text-right font-mono`}>{countWord(m.visits)}</td>
                    <td className={`${TD} text-right font-mono`} data-testid={`influencers-row-${m.uid}-signups`}>{countWord(m.signups)}</td>
                    <td className={`${TD} text-right font-mono`}>{countWord(m.paid_members)}</td>
                    <td className={TD}><MoneyCell field={m.revenue} testId={`influencers-row-${m.uid}-revenue`} /></td>
                    <td className={TD}><MoneyCell field={m.commission} testId={`influencers-row-${m.uid}-commission`} /></td>
                    <td className={TD}>
                      <span className="flex flex-col items-end gap-1">
                        {rowActions(m).map((a) => (
                          <button key={a.key} type="button" className={`${LINK} ${a.danger ? 'text-red-700 dark:text-red-300' : ''}`} onClick={() => setAct({ m, action: a })} data-testid={`influencers-row-${m.uid}-${a.key}`}>{a.label}</button>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className={`m-0 ${SUB}`}>Change tier, pause, end or take down a handle from the row. Each asks for a reason, and the member is told.</p>
      </Card>
      <FlagsCard />
      {act ? <ChangeDialog m={act.m} action={act.action} onClose={() => setAct(null)} onChanged={reload} /> : null}
    </div>
  );
}

const ACTION_SUB = {
  tier: 'New terms follow the tier; signed terms keep their own until they are replaced.',
  pause: 'A paused influencer earns nothing and their page shows no offer.',
  resume: 'Their link earns again from now.',
  end: 'Ending is final: the membership and its Investor Pro grant end.',
  takedown: 'The handle stops resolving. The member chooses a new one.',
};

export function ChangeDialog({ m, action, onClose, onChanged }) {
  const [tier, setTier] = useState(TIER_ORDER.find((t) => t !== m.tier) || TIER_ORDER[0]);
  const extra = action.key === 'tier' ? (
    <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>New tier</span>
      <select className={INPUT} value={tier} onChange={(e) => setTier(e.target.value)} data-testid="influencers-change-tier">
        {TIER_ORDER.filter((t) => t !== m.tier).map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
      </select>
    </label>
  ) : null;
  return (
    <ReasonDialog title={`${action.label.replace('…', '')} · ${m.handle ? `@${m.handle}` : m.person?.name || ''}`} sub={ACTION_SUB[action.key]} action={action.label.replace('…', '')}
      tone={action.danger ? 'danger' : 'primary'} extra={extra} onClose={onClose} testId="influencers-change"
      check={(reason) => changeBody(action.key, { tier, reason }).error || null}
      onSubmit={async (reason) => {
        await adminInfluencersApi.change(m.uid, changeBody(action.key, { tier, reason }).body);
        onChanged();
        return 'Saved. The member is told.';
      }} />
  );
}

export function FlagsCard() {
  const [read, reload] = useRead(() => adminInfluencersApi.flags('held'), []);
  const [act, setAct] = useState(null);
  const flags = read.status === 'ready' ? read.data?.flags || [] : [];
  return (
    <Card title="Flagged sign-ups" meta="Held from commission until someone decides." testId="influencers-flags">
      {read.status === 'loading' ? <Skeleton lines={2} /> : null}
      {read.status === 'error' ? <BlockFailed what="The flagged sign-ups" onRetry={reload} testId="influencers-flags-unreadable" /> : null}
      {read.status === 'ready' && !flags.length ? <p className={`m-0 ${SUB}`} data-testid="influencers-flags-empty">Nothing is held.</p> : null}
      {flags.length ? (
        <table className="w-full text-[13px]" data-testid="influencers-flags-table">
          <thead><tr><th className={TH}>Handle</th><th className={TH}>Why it was flagged</th><th className={TH}>When</th><th className={TH} /></tr></thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`influencers-flag-${f.uid}`}>
                <td className={`${TD} font-mono`}>{f.handle ? `@${f.handle}` : NOT_RECORDED}</td>
                <td className={TD}>{FLAG_WORD[f.reason] || f.reason}</td>
                <td className={TD}>{dayWord(f.created_at)}</td>
                <td className={TD}>
                  <span className="flex justify-end gap-2">
                    <button type="button" className={LINK} onClick={() => setAct({ f, decision: 'clear' })} data-testid={`influencers-flag-${f.uid}-keep`}>Keep…</button>
                    <button type="button" className={`${LINK} text-red-700 dark:text-red-300`} onClick={() => setAct({ f, decision: 'uphold' })} data-testid={`influencers-flag-${f.uid}-reverse`}>Reverse…</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {act ? (
        <ReasonDialog title={act.decision === 'clear' ? 'Keep this sign-up' : 'Reverse this sign-up'}
          sub={act.decision === 'clear' ? 'The attribution counts, and commission is earned as usual.' : 'The attribution is refused: no commission is earned on it.'}
          action={act.decision === 'clear' ? 'Keep' : 'Reverse'} tone={act.decision === 'clear' ? 'primary' : 'danger'} testId="influencers-flag-decide" onClose={() => setAct(null)}
          onSubmit={async (reason) => { await adminInfluencersApi.decideFlag(act.f.uid, act.decision, reason); reload(); return 'Saved.'; }} />
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Offers (in11c)
 * ------------------------------------------------------------------ */

export function OffersTab({ superAdmin }) {
  const [read, reload] = useRead(async () => {
    const { influencers = [] } = await adminInfluencersApi.list('all');
    const rows = [];
    for (const m of influencers) {
      try {
        const { offers = [] } = await adminInfluencersApi.offers(m.user_uid);
        for (const o of offers) rows.push({ m, o });
      } catch {
        rows.push({ m, o: null });
      }
    }
    return { influencers, rows };
  }, []);
  const [linking, setLinking] = useState(false);
  const [act, setAct] = useState(null);
  const rows = read.status === 'ready' ? read.data.rows : [];
  return (
    <Card title="Promotion codes by influencer" testId="influencers-offers"
      meta={superAdmin ? null : 'Only the Super Admin links or changes an offer.'}>
      {superAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={actionPrimary} onClick={() => setLinking(true)} disabled={read.status !== 'ready' || !read.data.influencers.length} data-testid="influencers-offers-new">New offer</button>
          <span className={SUB}>Make the code in <Link to={PROMOS_LINK} className={LINK}>Promo codes</Link> first, then link it to its influencer here.</span>
        </div>
      ) : null}
      {read.status === 'loading' ? <Skeleton lines={3} /> : null}
      {read.status === 'error' ? <BlockFailed what="The offers" onRetry={reload} testId="influencers-offers-unreadable" /> : null}
      {read.status === 'ready' && !rows.length ? <p className={`m-0 ${SUB}`} data-testid="influencers-offers-empty">No influencer has an offer yet.</p> : null}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]" data-testid="influencers-offers-table">
            <thead><tr><th className={TH}>Handle</th><th className={TH}>Offer</th><th className={`${TH} text-right`}>Budget</th><th className={`${TH} text-right`}>Uses</th><th className={`${TH} text-right`}>Discount given</th><th className={TH}>Status</th><th className={TH} /></tr></thead>
            <tbody>
              {rows.map(({ m, o }) => {
                if (!o) return <tr key={`${m.uid}-x`} className="border-t border-axal-hairline dark:border-gray-800"><td className={`${TD} font-mono`}>{m.handle ? `@${m.handle}` : m.person?.name}</td><td className={TD} colSpan={6}><span className="italic text-axal-muted">Its offers could not be read.</span></td></tr>;
                const r = offerRow(o);
                return (
                  <tr key={o.uid} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`influencers-offer-${o.uid}`}>
                    <td className={`${TD} font-mono`}>{m.handle ? `@${m.handle}` : m.person?.name || NOT_RECORDED}</td>
                    <td className={TD}><span className="flex flex-col"><span>{r.discount}</span><span className={SUB}>{`${r.code} · ${r.plans}`}</span></span></td>
                    <td className={`${TD} text-right font-mono`}>{r.budget}</td>
                    <td className={`${TD} text-right font-mono`}>{r.uses}</td>
                    <td className={`${TD} text-right font-mono`} data-testid={`influencers-offer-${o.uid}-given`}>{r.given.map((g) => <span key={g} className="block">{g}</span>)}</td>
                    <td className={TD}><StatusPill status={o.status} /></td>
                    <td className={TD}>
                      {superAdmin && o.status !== 'ended' ? (
                        <span className="flex flex-col items-end gap-1">
                          <button type="button" className={LINK} onClick={() => setAct({ m, o, status: o.status === 'paused' ? 'active' : 'paused' })} data-testid={`influencers-offer-${o.uid}-toggle`}>{o.status === 'paused' ? 'Resume…' : 'Pause…'}</button>
                          <button type="button" className={`${LINK} text-red-700 dark:text-red-300`} onClick={() => setAct({ m, o, status: 'ended' })} data-testid={`influencers-offer-${o.uid}-end`}>End…</button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {linking ? <LinkOfferDialog influencers={read.data.influencers} onClose={() => setLinking(false)} onLinked={reload} /> : null}
      {act ? (
        <ReasonDialog title={act.status === 'ended' ? 'End this offer' : act.status === 'paused' ? 'Pause this offer' : 'Resume this offer'}
          sub={act.status === 'ended' ? 'An ended offer cannot be resumed; link the code again as a new offer.' : null}
          action={act.status === 'ended' ? 'End' : act.status === 'paused' ? 'Pause' : 'Resume'} tone={act.status === 'ended' ? 'danger' : 'primary'} testId="influencers-offer-change"
          onClose={() => setAct(null)}
          onSubmit={async (reason) => { await adminInfluencersApi.changeOffer(act.m.user_uid, act.o.uid, { status: act.status, reason }); reload(); return 'Saved.'; }} />
      ) : null}
    </Card>
  );
}

/** Link a Promos code to an influencer (P4's `POST …/offers`): the code, its budget and currency, featured, and the reason. */
export function LinkOfferDialog({ influencers, onClose, onLinked }) {
  const live = influencers.filter((m) => m.status !== 'ended');
  const [who, setWho] = useState(live[0]?.user_uid || '');
  const [promo, setPromo] = useState('');
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [featured, setFeatured] = useState(false);
  const extra = (
    <>
      <label className="flex flex-col gap-1"><span className={FIELD_LABEL}>Influencer</span>
        <select className={INPUT} value={who} onChange={(e) => setWho(e.target.value)} data-testid="influencers-link-who">
          {live.map((m) => <option key={m.user_uid} value={m.user_uid}>{`${m.handle ? `@${m.handle}` : 'No handle'} · ${m.person?.name || NOT_RECORDED}`}</option>)}
        </select>
      </label>
      <Field label="Promotion code id (promo_…)" value={promo} onChange={setPromo} testId="influencers-link-promo" />
      <div className="flex gap-2">
        <Field label="Budget" value={budget} onChange={setBudget} testId="influencers-link-budget" />
        <Field label="Currency" value={currency} onChange={(v) => setCurrency(v.toUpperCase())} testId="influencers-link-currency" />
      </div>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} data-testid="influencers-link-featured" />Feature it on their @handle page</label>
    </>
  );
  return (
    <ReasonDialog title="Link an offer" sub="The code keeps its own rules from Promo codes; the offer adds its owner and a budget." action="Link" extra={extra} onClose={onClose} testId="influencers-link"
      check={() => (Math.round(Number(budget) * 100) > 0 ? null : 'Give the budget as an amount above 0.')}
      onSubmit={async (reason) => {
        await adminInfluencersApi.linkOffer(who, { promo_id: promo.trim(), budget_cents: Math.round(Number(budget) * 100), currency, featured, reason });
        onLinked();
        return 'Linked. It applies at checkout for the members this influencer brings.';
      }} />
  );
}

/* ------------------------------------------------------------------ *
 * Payouts and Settings (in11c)
 * ------------------------------------------------------------------ */

export function PayoutsTab() {
  return (
    <Card title="Payouts" testId="influencers-payouts">
      <p className={`m-0 ${SUB}`}>Influencers are paid through the same Commissions queue as every referrer. A payout needs an identity check, an accepted tax form and a payable balance at the payout minimum; commission is held 30 days first.</p>
      <div className="flex flex-col gap-1.5">
        <Link to={PAYOUTS_LINK} className={LINK} data-testid="influencers-payouts-commissions">Open Commissions on subscription commissions</Link>
        <Link to={BONUSES_LINK} className={LINK} data-testid="influencers-payouts-bonuses">Open Commissions on milestone bonuses</Link>
      </div>
    </Card>
  );
}

export function SettingsTab({ superAdmin }) {
  const [read, reload] = useRead(() => adminInfluencersApi.tierDefaults(), []);
  const [edit, setEdit] = useState(null);
  const tiers = read.status === 'ready' ? read.data?.tiers || [] : [];
  return (
    <Card title="Settings · tier defaults" meta="New terms copy these. Signed terms keep their own." testId="influencers-settings">
      {read.status === 'loading' ? <Skeleton lines={3} /> : null}
      {read.status === 'error' ? <BlockFailed what="The tier defaults" onRetry={reload} testId="influencers-settings-unreadable" /> : null}
      {tiers.length ? (
        <table className="w-full text-[13px]" data-testid="influencers-settings-table">
          <thead><tr><th className={TH}>Tier</th><th className={TH}>Rate</th><th className={TH}>Duration</th><th className={`${TH} text-right`}>Offer budget</th><th className={TH} /></tr></thead>
          <tbody>
            {tiers.map((t) => {
              const c = defaultCells(t);
              return (
                <tr key={t.tier} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`influencers-tier-${t.tier}`}>
                  <td className={TD}>{t.label || TIER_LABEL[t.tier]}</td>
                  <td className={`${TD} font-mono`}>{c.rate}</td>
                  <td className={TD}>{c.duration}</td>
                  <td className={`${TD} text-right font-mono`}>{c.budget}</td>
                  <td className={TD}>{superAdmin ? <button type="button" className={LINK} onClick={() => setEdit(t)} data-testid={`influencers-tier-${t.tier}-edit`}>Edit…</button> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {!superAdmin ? <p className={`m-0 ${SUB}`} data-testid="influencers-settings-readonly">Only the Super Admin changes the tier defaults.</p> : null}
      {edit ? <DefaultsDialog t={edit} onClose={() => setEdit(null)} onSaved={reload} /> : null}
    </Card>
  );
}

export function DefaultsDialog({ t, onClose, onSaved }) {
  const [rate, setRate] = useState(t.percentage_bps == null ? '' : String(t.percentage_bps / 100));
  const [invoices, setInvoices] = useState(t.duration_invoices == null ? '' : String(t.duration_invoices));
  const [budget, setBudget] = useState(t.offer_budget_cents == null ? '' : String(t.offer_budget_cents / 100));
  const [currency, setCurrency] = useState(t.currency || 'USD');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(null);
  async function save() {
    const out = defaultsBody({ rate, invoices, budget, currency });
    if (out.error) { setRefusal(out.error); return; }
    setBusy(true); setRefusal(null);
    try { await adminInfluencersApi.setTierDefault(t.tier, out.body); onSaved(); setDone('Saved. New terms drafts copy these.'); } catch (e) { setRefusal(say(e)); } finally { setBusy(false); }
  }
  return (
    <Lightbox label={`Edit ${t.label}`} title={`Edit defaults · ${t.label}`} sub="Leave a field empty for “Set per agreement” or “Not set”." onClose={onClose} width={520} testId="influencers-defaults">
      <div className={DIALOG_BODY}>
        <Field label="Rate (%)" value={rate} onChange={setRate} testId="influencers-defaults-rate" />
        <Field label="Duration (paid invoices per member)" value={invoices} onChange={setInvoices} testId="influencers-defaults-invoices" />
        <div className="flex gap-2">
          <Field label="Offer budget" value={budget} onChange={setBudget} testId="influencers-defaults-budget" />
          <Field label="Currency" value={currency} onChange={(v) => setCurrency(v.toUpperCase())} testId="influencers-defaults-currency" />
        </div>
        <DialogButtons onClose={onClose} action="Save" onAction={save} busy={busy} refusal={refusal} done={done} testId="influencers-defaults-save" />
      </div>
    </Lightbox>
  );
}
