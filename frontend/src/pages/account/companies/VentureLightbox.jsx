import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable, actionGhost, actionPrimary } from '../../../ui';
import { api } from '../../../lib/api';
import { NOT_RECORDED } from '../../../lib/absence.js';
import { day, seatWord, ventureTeam } from './companiesModel';
import {
  ActionDialog, LeaveVentureDialog, MoveVentureDialog, RemoveMemberDialog, TransferVentureDialog, TrashDialog,
} from './LifecycleDialogs';

/**
 * D1139 (#3019) — the venture lightbox (CMP4, and CMP4b once the Lab lock is
 * past), opened from a venture's row.
 *
 * The facts are the row's (`GET /api/account/projects`); the team, the
 * caller's seat, the pending invitations and the Lab lock are
 * `GET /api/projects/:id/members`'s. The lock is the Worker's own sentence
 * (`gate_reason`), shown in place of the invitations. The owner gets Move,
 * Transfer ownership, Remove and Move to trash; anyone else seated gets
 * Leave venture. Each opens its dialog over this one.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex w-fit items-center rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-400';
const BLOCK = 'flex flex-col gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800';
const LOCK = 'm-0 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const SMALL = 'inline-flex min-h-[32px] items-center rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

export default function VentureLightbox({ venture, companies, meId, onClose, onChanged }) {
  const [tick, setTick] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null });
  const load = useCallback(() => api.listProjectMembers(venture.id), [venture.id]);
  useEffect(() => {
    let alive = true;
    setRead((x) => ({ status: 'loading', data: x.data }));
    Promise.resolve().then(load)
      .then((data) => { if (alive) setRead({ status: 'ready', data }); })
      .catch(() => { if (alive) setRead({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [load, tick]);
  const reread = () => setTick((n) => n + 1);
  const [dialog, setDialog] = useState(null);

  const team = ventureTeam(read.data, meId);
  // The row's seat is the account read's; the members read decides once it is in.
  const owner = read.status === 'ready' ? team.owner : venture.owner;
  const me = team.members.find((m) => m.you) || null;
  const done = (msg, { close = false } = {}) => {
    setDialog(null); onChanged(msg);
    if (close) onClose(); else reread();
  };

  const foot = owner ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`text-[12px] ${MUTED}`}>Move to trash shows to the owner only.</span>
      <span className="flex flex-wrap gap-2">
        <button type="button" className={SMALL} onClick={() => setDialog('transfer')} disabled={read.status !== 'ready'} data-testid="venture-transfer">Transfer ownership</button>
        <button type="button" className={SMALL} onClick={() => setDialog('trash')} data-testid="venture-trash">Move to trash</button>
      </span>
    </div>
  ) : read.status === 'ready' && me ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`text-[12px] ${MUTED}`}>Leave venture shows to team members who are not the owner.</span>
      <button type="button" className={SMALL} onClick={() => setDialog('leave')} data-testid="venture-leave">Leave venture</button>
    </div>
  ) : null;

  return (
    <>
      <Lightbox label={venture.name} eyebrow="Venture" title={venture.name} onClose={onClose} width={720} testId="venture-lightbox" footer={foot}
        sub={venture.company ? `In ${venture.company}` : 'Not in a company: it shows under every company you belong to.'}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link className={actionPrimary} to={`/projects/${venture.id}`} data-testid="venture-open">Open venture</Link>
            {owner ? <button type="button" className={actionGhost} onClick={() => setDialog('move')} data-testid="venture-move">Move</button> : null}
            <span className={PILL}>Your seat: {venture.seat}</span>
          </div>

          <dl className="m-0 grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)]" data-testid="venture-facts">
            <dt className={EYE}>Stage</dt><dd className={`m-0 text-[12.5px] ${INK}`}>{venture.stage}</dd>
            <dt className={EYE}>Spin-Out Lab</dt><dd className={`m-0 text-[12.5px] ${INK}`}>{venture.week ? `Lab ${venture.week} of 4` : 'Not in the Lab'}</dd>
            <dt className={EYE}>Cycles</dt><dd className={`m-0 text-[12.5px] ${INK}`}>{venture.cycles}</dd>
          </dl>

          {read.status === 'error' ? (
            <div data-testid="venture-unreadable"><Unreadable what="This venture’s team" claim="That is not the same as having none." onRetry={reread} /></div>
          ) : read.status !== 'ready' ? <p className={`m-0 text-[13px] ${MUTED}`} data-testid="venture-loading">Reading…</p> : (
            <>
              <section className={BLOCK} data-testid="venture-team">
                <h3 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>Team · {team.members.length}</h3>
                {team.members.map((m) => (
                  <div key={m.userId} className="flex flex-wrap items-center justify-between gap-2" data-testid="venture-member">
                    <span className="min-w-0"><b className={`block text-[13.5px] ${INK}`}>{m.name}{m.you ? ' · you' : ''}</b><span className={`text-[12px] ${MUTED}`}>{m.line}</span></span>
                    {team.manage && !m.you && m.role !== 'owner' ? (
                      <button type="button" className={SMALL} onClick={() => setDialog({ remove: m })} data-testid={`venture-remove-${m.userId}`}>Remove</button>
                    ) : null}
                  </div>
                ))}
                <p className={`m-0 text-[12px] ${MUTED}`}>Only the owner can remove someone from the team.</p>
              </section>

              {team.manage ? (
                <section className={BLOCK} data-testid="venture-invitations">
                  <h3 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>Invitations</h3>
                  {team.lock ? <p className={LOCK} role="note" data-testid="venture-lab-lock">{team.lock}</p> : (
                    <>
                      {team.invitations.length ? team.invitations.map((i) => (
                        <div key={i.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="venture-invitation">
                          <span className={`text-[12.5px] ${INK}`}><b>{i.invitee_email || NOT_RECORDED}</b> <span className={MUTED}>· {seatWord(i.role)}{i.created_at ? ` · sent ${day(i.created_at)}` : ''}{i.expires_at ? ` · expires ${day(i.expires_at, { year: false })}` : ''}</span></span>
                          <button type="button" className={SMALL} onClick={() => setDialog({ revoke: i })} data-testid={`venture-revoke-${i.id}`}>Revoke</button>
                        </div>
                      )) : <p className={`m-0 text-[12.5px] ${MUTED}`}>No invitation is waiting.</p>}
                      <Link className={LINK} to={`/projects/${venture.id}`} data-testid="venture-invite">Invite a co-founder or advisor ›</Link>
                    </>
                  )}
                </section>
              ) : null}
            </>
          )}
        </div>
      </Lightbox>

      {dialog === 'move' ? (
        <MoveVentureDialog venture={venture} companies={companies} onClose={() => setDialog(null)}
          onDone={(out) => done(`${venture.name} is now ${out?.to === 'Not in a company' || !out?.to ? 'in no company' : `in ${out.to}`}.`, { close: true })} />
      ) : null}
      {dialog === 'transfer' ? (
        <TransferVentureDialog venture={venture} cofounders={team.cofounders} onClose={() => setDialog(null)}
          onDone={(out) => done(`${out?.to || 'The co-founder'} now owns ${venture.name}. You stay on as Co-founder.`)} />
      ) : null}
      {dialog === 'trash' ? <TrashDialog venture={venture} onClose={() => setDialog(null)} onDone={() => done(`${venture.name} is in the trash.`, { close: true })} /> : null}
      {dialog === 'leave' ? <LeaveVentureDialog venture={venture} me={me} onClose={() => setDialog(null)} onDone={() => done(`You left ${venture.name}.`, { close: true })} /> : null}
      {dialog?.remove ? (
        <RemoveMemberDialog venture={venture} member={dialog.remove} onClose={() => setDialog(null)} onDone={() => done(`${dialog.remove.name} is off the team.`)} />
      ) : null}
      {dialog?.revoke ? (
        <ActionDialog testId="revoke-dialog"
          copy={{ title: `Revoke the invitation to ${dialog.revoke.invitee_email || 'this address'}?`, body: ['The link stops working. You can invite them again.'], button: 'Revoke', cancel: 'Cancel', danger: true }}
          run={() => api.revokeProjectInvitation(venture.id, dialog.revoke.id)} onClose={() => setDialog(null)} onDone={() => done('The invitation is revoked.')} />
      ) : null}
    </>
  );
}
