import React, { useEffect, useRef, useState } from 'react';
import { Lightbox, actionDanger, actionGhost, actionPrimary } from '../../../ui';
import { api } from '../../../lib/api';
import { teamsApi } from '../../../lib/api/teams';
import { companyActionsApi } from '../../../lib/api/companyActions.js';
import { reportError } from '../../../lib/log';
import { LIFECYCLE, isLastPrimaryAdmin, lifecycleRefusal, roleWord, trashUntil } from './companiesModel';
import { NAME_MAX } from './CompaniesDialogs';

/**
 * D1139 (#3019, part 5 of #2422) — the lifecycle dialogs of Account ›
 * Companies and projects, built to the canvas (CMP6–CMP8). Each one says what
 * it changes before it changes it (`LIFECYCLE` in the model holds the words),
 * makes one write through the Worker's own route, and says a refusal inside
 * itself. None is a browser pop-up.
 *
 *   CMP6  Rename, Make active, Invite people (New company is CompaniesDialogs')
 *   CMP7  Transfer primary admin, Archive (and Restore), Leave, and the
 *         refusal for the only primary admin
 *   CMP8  Move a venture, Transfer ownership, Leave a venture, Move to trash,
 *         and Remove a team member
 */

const SUB = 'text-[12.5px] leading-[1.5] text-axal-muted dark:text-gray-400';
const INK = 'm-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100';
const ERR = 'm-0 text-[12.5px] text-axal-destructive dark:text-red-400';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const CHOICE = 'flex items-center gap-2 rounded-[9px] border border-axal-hairline px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:text-gray-100';
const CHIP = 'rounded-full border px-2.5 py-1 text-[11.5px] font-bold';

/**
 * The one shell: the copy's title and sentences, the fields, and Cancel and
 * the act. `run()` makes the write; `onRefusal(e)` may take a refusal over
 * (Leave's), else it is said here in words.
 */
export function ActionDialog({ copy, testId, run, onClose, onDone, ready = true, onRefusal, children }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(true); setRefusal('');
    try { const out = await run(); lock.current = false; onDone(out); } catch (e) {
      reportError(`companies:${testId}`, e);
      if (!(onRefusal && onRefusal(e))) setRefusal(lifecycleRefusal(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label={copy.title} title={copy.title} onClose={close} width={520} testId={testId}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={actionGhost} onClick={close} disabled={busy} data-testid={`${testId}-cancel`}>{copy.cancel || 'Cancel'}</button>
          <button type="button" className={copy.danger ? actionDanger : actionPrimary} onClick={go} disabled={busy || !ready} data-testid={`${testId}-confirm`}>{busy ? 'Saving…' : copy.button}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5" data-testid={`${testId}-says`}>
          {copy.body.map((line) => <p key={line} className={INK}>{line}</p>)}
        </div>
        {children}
        {copy.foot ? <p className={`m-0 ${SUB}`}>{copy.foot}</p> : null}
        {refusal ? <p role="alert" className={ERR} data-testid={`${testId}-refusal`}>{refusal}</p> : null}
      </div>
    </Lightbox>
  );
}

const Label = ({ children }) => <span className={EYE}>{children}</span>;

/** A list of people or places to pick one from. */
function Pick({ name, options, value, onChange, testId, empty }) {
  if (!options.length) return <p className={`m-0 ${SUB}`} data-testid={`${testId}-none`}>{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <label key={o.value} className={CHOICE}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} data-testid={`${testId}-${o.value}`} />
          <span className="min-w-0"><b className="block">{o.label}</b>{o.sub ? <span className={SUB}>{o.sub}</span> : null}</span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- CMP6

export function RenameDialog({ company, onClose, onDone }) {
  const [name, setName] = useState(company.name);
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && trimmed.length <= NAME_MAX && trimmed !== company.name;
  return (
    <ActionDialog copy={LIFECYCLE.rename(company.name)} testId="rename-dialog" ready={ready}
      run={() => api.updateCompany(company.uid, { company_name: trimmed })} onClose={onClose} onDone={() => onDone(trimmed)}>
      <label className="flex flex-col gap-1">
        <Label>Name</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} className={FIELD} data-testid="rename-name" />
        <span className={SUB}>{trimmed.length} / {NAME_MAX} characters</span>
      </label>
    </ActionDialog>
  );
}

/** `switchTo` is the switcher's own (`useCompanySwitch`): it writes this device's active company. */
export function MakeActiveDialog({ company, row, switchTo, onClose, onDone }) {
  return (
    <ActionDialog copy={LIFECYCLE.makeActive(company.name)} testId="make-active-dialog"
      run={async () => { switchTo(row); }} onClose={onClose} onDone={onDone} />
  );
}

const AUTHORITIES = ['VIEW', 'WORK', 'FLAG', 'SPONSOR', 'VOTE'];
const COMPANY_ROLES = ['Member', 'Admin'];

export function InviteDialog({ company, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Member');
  const [title, setTitle] = useState('');
  const [authority, setAuthority] = useState('');
  const [titles, setTitles] = useState(null);
  const [sent, setSent] = useState(null);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => teamsApi.teamVocabulary())
      .then((v) => { if (alive) setTitles([...(v?.ladder || []).map((r) => r.title), ...(v?.functions || []).map((f) => f.name)].filter(Boolean)); })
      .catch(() => { if (alive) setTitles(false); });
    return () => { alive = false; };
  }, []);
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  if (sent) {
    // The email did not leave: the link is shown once, here, to send by hand.
    const link = `${globalThis.location?.origin || ''}${sent.accept_path}`;
    const copy = async () => {
      try { await navigator.clipboard.writeText(link); setCopied('Copied.'); } catch { setCopied('Select the link and copy it.'); }
    };
    return (
      <Lightbox label="The email did not send" title="The email did not send" onClose={() => onDone(sent)} width={520} testId="invite-fallback"
        footer={<div className="flex justify-end"><button type="button" className={actionPrimary} onClick={() => onDone(sent)} data-testid="invite-fallback-done">Done</button></div>}>
        <div className="flex flex-col gap-2">
          <p className={INK}>The invitation to {sent.email} is saved. The email did not send. Copy this link and send it yourself:</p>
          <input readOnly value={link} className={FIELD} data-testid="invite-fallback-link" />
          <button type="button" className={actionGhost} onClick={copy} data-testid="invite-fallback-copy">Copy</button>
          {copied ? <p role="status" className={`m-0 ${SUB}`}>{copied}</p> : null}
        </div>
      </Lightbox>
    );
  }

  return (
    <ActionDialog copy={LIFECYCLE.invite(company.name)} testId="invite-dialog" ready={ready}
      run={() => teamsApi.inviteCompanyMember(company.uid, { email: email.trim(), role_in_company: role, title: title || null, authority: authority || null })}
      onClose={onClose}
      onDone={(out) => { if (out && out.email_sent === false && out.accept_path) setSent({ ...out, email: email.trim() }); else onDone(out); }}>
      <label className="flex flex-col gap-1">
        <Label>Email</Label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} data-testid="invite-email" />
      </label>
      <label className="flex flex-col gap-1">
        <Label>Role</Label>
        <select value={role} onChange={(e) => setRole(e.target.value)} className={FIELD} data-testid="invite-role">
          {COMPANY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <Label>Title · optional</Label>
        {titles === false ? <span className={SUB} data-testid="invite-titles-unread">The titles could not be read. Send without one, or try again later.</span> : (
          <select value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} disabled={!titles} data-testid="invite-title">
            <option value="">{titles ? 'No title' : 'Reading…'}</option>
            {(titles || []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </label>
      <div className="flex flex-col gap-1">
        <Label>Authority · optional</Label>
        <div className="flex flex-wrap gap-1.5" data-testid="invite-authority">
          {AUTHORITIES.map((a) => (
            <button key={a} type="button" aria-pressed={authority === a} onClick={() => setAuthority(authority === a ? '' : a)}
              className={`${CHIP} ${authority === a ? 'border-violet-300 bg-axal-lavender text-axal-violet dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}
              data-testid={`invite-authority-${a}`}>{roleWord(a.toLowerCase())}</button>
          ))}
        </div>
      </div>
    </ActionDialog>
  );
}

// ---------------------------------------------------------------- CMP7

export function TransferAdminDialog({ company, people, onClose, onDone }) {
  const [to, setTo] = useState(null);
  const [keep, setKeep] = useState(false);
  const pick = people.find((p) => Number(p.user_id) === Number(to));
  const copy = LIFECYCLE.transferAdmin(company.name, pick?.name);
  return (
    <ActionDialog copy={copy} testId="transfer-admin-dialog" ready={!!pick}
      run={() => companyActionsApi.transferAdmin(company.uid, { user_id: Number(to), demote: !keep })} onClose={onClose}
      onDone={(out) => onDone({ ...out, to: pick?.name })}>
      <Pick name="transfer-admin" testId="transfer-admin-people" value={to} onChange={setTo}
        empty={`There is nobody else in ${company.name} to take it. Invite someone first.`}
        options={people.map((p) => ({ value: p.user_id, label: p.name || 'Not recorded', sub: p.is_primary_admin ? 'Primary admin' : roleWord(p.role_in_company) }))} />
      <label className="flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} data-testid="transfer-admin-keep" />
        Keep me as a primary admin too
      </label>
      <p className={`m-0 ${SUB}`} data-testid="transfer-admin-after">
        {keep ? 'You both stay primary admins.' : 'You stay a member with your role; you are no longer a primary admin.'}
      </p>
    </ActionDialog>
  );
}

export function ArchiveDialog({ company, onClose, onDone }) {
  return <ActionDialog copy={LIFECYCLE.archive(company.name)} testId="archive-dialog" run={() => companyActionsApi.archive(company.uid)} onClose={onClose} onDone={onDone} />;
}

export function RestoreDialog({ company, onClose, onDone }) {
  const copy = { title: `Restore ${company.name}?`, body: ['It comes back to the switcher for every member, with its ventures, deals and files.'], button: 'Restore', cancel: 'Cancel' };
  return <ActionDialog copy={copy} testId="restore-dialog" run={() => companyActionsApi.restore(company.uid)} onClose={onClose} onDone={onDone} />;
}

/**
 * Leave a company. The only primary admin is refused by the Worker
 * (`last_primary_admin`); the dialog then says why and offers the transfer.
 * `onlyPrimary` opens on the refusal straight away when the page already
 * knows; the Worker's answer decides either way.
 */
export function LeaveCompanyDialog({ company, leave, onlyPrimary = false, onTransfer, onClose, onDone }) {
  const [refused, setRefused] = useState(onlyPrimary);
  if (refused) {
    return (
      <ActionDialog copy={LIFECYCLE.leaveRefused(company.name)} testId="leave-refused-dialog" ready={!!onTransfer}
        run={async () => {}} onClose={onClose} onDone={() => onTransfer()} />
    );
  }
  return (
    <ActionDialog copy={LIFECYCLE.leave(company.name)} testId="leave-dialog" run={() => leave(company.uid)}
      onRefusal={(e) => { if (!isLastPrimaryAdmin(e)) return false; setRefused(true); return true; }}
      onClose={onClose} onDone={onDone} />
  );
}

// ---------------------------------------------------------------- CMP8

/** Move a venture to one of the owner's companies, or out of its company. */
export function MoveVentureDialog({ venture, companies, onClose, onDone }) {
  const [to, setTo] = useState(null);
  const options = [
    ...companies.filter((c) => c.id != null && c.uid !== venture.companyUid).map((c) => ({ value: String(c.id), label: c.name })),
    ...(venture.companyUid ? [{ value: 'none', label: 'Not in a company', sub: 'It shows under every company you belong to.' }] : []),
  ];
  return (
    <ActionDialog copy={LIFECYCLE.move(venture.name, !venture.companyUid)} testId="move-dialog" ready={to != null}
      run={() => companyActionsApi.moveProject(venture.id, { company_id: to === 'none' ? null : Number(to) })}
      onClose={onClose} onDone={(out) => onDone({ ...out, to: options.find((o) => o.value === to)?.label })}>
      <Pick name="move" testId="move-companies" value={to} onChange={setTo} options={options}
        empty="You belong to no other company to move it to." />
    </ActionDialog>
  );
}

export function TransferVentureDialog({ venture, cofounders, onClose, onDone }) {
  const [to, setTo] = useState(null);
  const pick = cofounders.find((m) => Number(m.userId) === Number(to));
  return (
    <ActionDialog copy={LIFECYCLE.transferVenture(venture.name, pick?.name)} testId="transfer-venture-dialog" ready={!!pick}
      run={() => companyActionsApi.transferProject(venture.id, { user_id: Number(to) })} onClose={onClose}
      onDone={(out) => onDone({ ...out, to: pick?.name })}>
      <Pick name="transfer-venture" testId="transfer-venture-people" value={to} onChange={setTo}
        empty="Only a co-founder can take the venture over, and it has none yet."
        options={cofounders.map((m) => ({ value: m.userId, label: m.name, sub: m.line }))} />
    </ActionDialog>
  );
}

export function LeaveVentureDialog({ venture, me, onClose, onDone }) {
  return (
    <ActionDialog copy={LIFECYCLE.leaveVenture(venture.name, me?.seat)} testId="leave-venture-dialog"
      run={() => teamsApi.removeProjectMember(venture.id, me.userId)} onClose={onClose} onDone={onDone} />
  );
}

export function TrashDialog({ venture, now = new Date(), onClose, onDone }) {
  return (
    <ActionDialog copy={LIFECYCLE.trash(venture.name, trashUntil(now))} testId="trash-dialog"
      run={() => api.deleteProject(venture.id)} onClose={onClose} onDone={onDone} />
  );
}

export function RemoveMemberDialog({ venture, member, onClose, onDone }) {
  return (
    <ActionDialog copy={LIFECYCLE.removeMember(member.name, venture.name)} testId="remove-member-dialog"
      run={() => teamsApi.removeProjectMember(venture.id, member.userId)} onClose={onClose} onDone={onDone} />
  );
}
