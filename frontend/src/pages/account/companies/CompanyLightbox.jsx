import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox, Unreadable, actionGhost, actionPrimary } from '../../../ui';
import { api } from '../../../lib/api';
import { NOT_RECORDED } from '../../../lib/absence.js';
import {
  ACTIVE_HERE, companyPowers, companySettingsPathFor, day, memberLine, projectGroups, sentInvitationLine, stageWord,
} from './companiesModel';
import {
  ArchiveDialog, InviteDialog, LeaveCompanyDialog, MakeActiveDialog, RenameDialog, RestoreDialog, TransferAdminDialog,
} from './LifecycleDialogs';

/**
 * D1139 (#3019) — the company lightbox (CMP2), at `/account/companies/<uid>`.
 *
 * Reads `GET /api/company/:uid` (facts and members) and, for an editor, its
 * invitations; the ventures come from the page's own `GET /api/account/projects`.
 * Each read fails alone and says so. Its buttons follow the caller's place in
 * the company, as the Worker decides it:
 *   - an editor (primary admin, Owner, Admin or Founder): Rename, Invite people;
 *   - the primary admin: Transfer primary admin, Archive (Restore once archived);
 *   - any member: Make active (when it is not), Leave.
 * Every one opens its dialog over this one.
 */

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const VIOLET = `${PILL} border-violet-300 bg-axal-lavender text-axal-violet dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-300`;
const NEUTRAL = `${PILL} border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400`;
const BLOCK = 'flex flex-col gap-2 border-t border-axal-hairline pt-3 dark:border-gray-800';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const SMALL = 'inline-flex min-h-[32px] items-center rounded-[9px] border border-axal-hairline bg-white px-2.5 text-[12px] font-bold text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

function useLoad(load, enabled, tick) {
  const [s, set] = useState({ status: enabled ? 'loading' : 'idle', data: null });
  useEffect(() => {
    if (!enabled) { set({ status: 'idle', data: null }); return undefined; }
    let alive = true;
    set((x) => ({ status: 'loading', data: x.data }));
    Promise.resolve().then(load)
      .then((data) => { if (alive) set({ status: 'ready', data }); })
      .catch(() => { if (alive) set({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [load, enabled, tick]);
  return s;
}

const Fact = ({ label, children, testId }) => (
  <>
    <dt className={EYE}>{label}</dt>
    <dd className={`m-0 text-[12.5px] ${INK}`} data-testid={testId}>{children}</dd>
  </>
);

export default function CompanyLightbox({
  uid, card, projects, meId, active, row, switchTo, leave, onClose, onChanged, onOpenVenture,
}) {
  const [tick, setTick] = useState(0);
  const reread = () => setTick((n) => n + 1);
  const loadDetail = useCallback(() => api.getCompany(uid), [uid]);
  const detail = useLoad(loadDetail, true, tick);
  const powers = companyPowers(detail.data, meId);
  const loadInvites = useCallback(() => api.listCompanyInvitations(uid), [uid]);
  const invites = useLoad(loadInvites, detail.status === 'ready' && powers.editor, tick);
  const [dialog, setDialog] = useState(null);

  const name = String(detail.data?.company_name || card?.name || '').trim() || NOT_RECORDED;
  const company = { uid, name };
  const done = (msg, { switcher = false, close = false } = {}) => {
    setDialog(null); onChanged(msg, { switcher });
    if (close) onClose(); else reread();
  };

  // The ventures in this company, and the caller's own that sit in none.
  const groups = projects ? projectGroups(projects, [{ uid, company_name: name }]) : null;
  const inside = groups ? (groups.find((g) => g.key === `c-${uid}`)?.rows || []) : null;
  const loose = groups ? (groups.find((g) => g.key === 'none')?.rows || []) : null;

  const title = (
    <span className="flex flex-wrap items-center gap-2">
      {name}
      {active ? <span className={VIOLET} data-testid="company-lightbox-active">{ACTIVE_HERE}</span> : null}
      {powers.primary ? <span className={NEUTRAL}>Primary admin</span> : null}
      {powers.archived ? <span className={NEUTRAL} data-testid="company-lightbox-archived">Archived</span> : null}
    </span>
  );

  const foot = detail.status === 'ready' && powers.member ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`text-[12px] ${MUTED}`}>
        {active ? <Link className={LINK} to={companySettingsPathFor(uid)} data-testid="company-full-settings">Full company settings ›</Link> : 'Full company settings open for the active company.'}
        {' '}The profile and team editors keep their own page.
      </span>
      <span className="flex flex-wrap gap-2">
        {powers.primary && !powers.archived ? <button type="button" className={SMALL} onClick={() => setDialog('transfer')} data-testid="company-transfer">Transfer primary admin</button> : null}
        {powers.primary && !powers.archived ? <button type="button" className={SMALL} onClick={() => setDialog('archive')} data-testid="company-archive">Archive company</button> : null}
        {powers.primary && powers.archived ? <button type="button" className={SMALL} onClick={() => setDialog('restore')} data-testid="company-restore">Restore company</button> : null}
        <button type="button" className={SMALL} onClick={() => setDialog('leave')} data-testid="company-leave">Leave company</button>
      </span>
    </div>
  ) : null;

  return (
    <>
      <Lightbox label={name} title={title} eyebrow="Company" onClose={onClose} width={720} testId="company-lightbox" footer={foot}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {active ? <Link className={actionPrimary} to="/studio" data-testid="company-open-studio">Open Studio</Link> : null}
            {!active && row && !powers.archived ? <button type="button" className={actionPrimary} onClick={() => setDialog('active')} data-testid="company-make-active">Make active</button> : null}
            {powers.editor && !powers.archived ? <button type="button" className={actionGhost} onClick={() => setDialog('rename')} data-testid="company-rename">Rename</button> : null}
          </div>

          {detail.status === 'loading' && !detail.data ? <p className={`m-0 text-[13px] ${MUTED}`} data-testid="company-lightbox-loading">Reading…</p> : null}
          {detail.status === 'error' ? (
            <div data-testid="company-lightbox-unreadable"><Unreadable what="This company" claim="Nothing here changed." onRetry={reread} /></div>
          ) : null}

          {detail.status === 'ready' ? (
            <dl className="m-0 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]" data-testid="company-facts">
              <Fact label="Stage">{stageWord(detail.data.stage) || NOT_RECORDED}</Fact>
              <Fact label="Website">{detail.data.website || NOT_RECORDED}</Fact>
              <Fact label="Created">{day(detail.data.created_at) || NOT_RECORDED}</Fact>
              <Fact label="Last opened">{card?.lastOpened || NOT_RECORDED}</Fact>
              <Fact label="Cycles">{card?.cycles || 'Cycles: could not be read'}</Fact>
            </dl>
          ) : null}

          <section className={BLOCK} data-testid="company-ventures-block">
            <h3 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>Ventures in this company</h3>
            {inside == null ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Ventures: could not be read.</p>
              : inside.length ? inside.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="company-venture">
                  <span className="min-w-0"><b className={`block text-[13.5px] ${INK}`}>{v.name}</b>
                    <span className={`text-[12px] ${MUTED}`}>{v.stage}{v.week ? ` · Lab ${v.week} of 4` : ''} · your seat: {v.seat}</span></span>
                  <button type="button" className={SMALL} onClick={() => onOpenVenture(v)} data-testid={`company-venture-open-${v.id}`}>Open</button>
                </div>
              )) : <p className={`m-0 text-[12.5px] ${MUTED}`}>No venture of yours is in this company.</p>}
            {loose && loose.length ? (
              <p className={`m-0 flex flex-wrap items-center justify-between gap-2 text-[12.5px] ${INK}`} data-testid="company-loose">
                Not in a company: {loose.length} venture{loose.length === 1 ? '' : 's'} show{loose.length === 1 ? 's' : ''} under every company until you move {loose.length === 1 ? 'it' : 'them'}.
                <button type="button" className={SMALL} onClick={() => onOpenVenture(loose[0])} data-testid="company-loose-move">Move</button>
              </p>
            ) : null}
          </section>

          {detail.status === 'ready' ? (
            <section className={BLOCK} data-testid="company-members-block">
              <h3 className={`m-0 text-[13.5px] font-extrabold ${INK}`}>Members · {detail.data.members?.length ?? 0}</h3>
              {(detail.data.members || []).map((m) => (
                <span key={m.user_id} className={`text-[12.5px] ${INK}`} data-testid="company-member">
                  <b>{m.name || NOT_RECORDED}{Number(m.user_id) === Number(meId) ? ' · you' : ''}</b> <span className={MUTED}>· {memberLine(m)}</span>
                </span>
              ))}
            </section>
          ) : null}

          {powers.editor ? (
            <section className={BLOCK} data-testid="company-invitations-block">
              <h3 className={`m-0 flex items-center justify-between gap-2 text-[13.5px] font-extrabold ${INK}`}>
                Invitations
                {!powers.archived ? <button type="button" className={SMALL} onClick={() => setDialog('invite')} data-testid="company-invite">Invite people</button> : null}
              </h3>
              {invites.status === 'error' ? <Unreadable what="This company’s invitations" claim="That is not the same as having none." onRetry={reread} />
                : invites.status !== 'ready' ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Reading…</p>
                  : (() => {
                    const pending = (invites.data?.invitations || []).filter((i) => i.status === 'pending');
                    return pending.length ? pending.map((i) => (
                      <span key={i.uid} className={`text-[12.5px] ${INK}`} data-testid="company-invitation"><b>{i.email}</b> <span className={MUTED}>· {sentInvitationLine(i)}</span></span>
                    )) : <p className={`m-0 text-[12.5px] ${MUTED}`}>No invitation is waiting.</p>;
                  })()}
            </section>
          ) : null}
        </div>
      </Lightbox>

      {dialog === 'rename' ? <RenameDialog company={company} onClose={() => setDialog(null)} onDone={(n) => done(`${name} is now ${n}.`, { switcher: true })} /> : null}
      {dialog === 'active' ? (
        <MakeActiveDialog company={company} row={row} switchTo={switchTo} onClose={() => setDialog(null)} onDone={() => done(`${name} is your active company on this device.`)} />
      ) : null}
      {dialog === 'invite' ? <InviteDialog company={company} onClose={() => setDialog(null)} onDone={(out) => done(`The invitation is saved${out?.email_sent ? ' and sent' : ''}.`)} /> : null}
      {dialog === 'transfer' ? (
        <TransferAdminDialog company={company} people={powers.others} onClose={() => setDialog(null)}
          onDone={(out) => done(`${out?.to || 'They'} is now a primary admin of ${name}.`)} />
      ) : null}
      {dialog === 'archive' ? <ArchiveDialog company={company} onClose={() => setDialog(null)} onDone={() => done(`${name} is archived.`, { switcher: true })} /> : null}
      {dialog === 'restore' ? <RestoreDialog company={company} onClose={() => setDialog(null)} onDone={() => done(`${name} is restored.`, { switcher: true })} /> : null}
      {dialog === 'leave' ? (
        <LeaveCompanyDialog company={company} leave={leave} onlyPrimary={powers.onlyPrimary}
          onTransfer={powers.primary && !powers.archived ? () => setDialog('transfer') : null}
          onClose={() => setDialog(null)} onDone={() => done(`You left ${name}.`, { switcher: true, close: true })} />
      ) : null}
    </>
  );
}
