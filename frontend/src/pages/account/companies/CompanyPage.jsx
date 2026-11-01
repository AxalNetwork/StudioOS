import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pill } from '../../../ui';
import { teamsApi } from '../../../lib/api/teams';
import { reportError } from '../../../lib/log';
import { companyTeamPath } from '../../../lib/settingsScope.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT } from '../../team/teamUi.jsx';
import * as portfolio from './portfolioAdapter.js';
import {
  ACTIVE_HERE, BASE_PATH, companyLegalPath, companyPowers, companySettingsPathFor, documentRows, legalFacts, locationRows,
  portfolioProject, projectPagePath, roleWord,
} from './companiesModel';
import { NOT_RECORDED } from '../../../lib/absence.js';
import { CompanyMark, Fact, FactList, Failed, INK, LINK, MUTED, PCard, ProjectMark, Reading, SlugChip, TypeBadge } from './portfolioUi.jsx';
import {
  ArchiveDialog, InviteDialog, LeaveCompanyDialog, MakeActiveDialog, RenameDialog, RestoreDialog, TransferAdminDialog,
} from './LifecycleDialogs';

/**
 * D1413 (#3696, PF2, PF7c, PF7e) — a company's page, at
 * `/account/portfolio/<uid>`. It replaces D1139's company lightbox (owner
 * answer Q3): the lightbox's dialogs (Rename, Make active, Invite people,
 * Transfer primary admin, Archive, Restore, Leave) open from here.
 *
 * READS, each its own block, each failing alone ("Locations could not be
 * read · Try again" while Legal, Team and Projects still draw):
 *   `GET /api/company/:uid`            facts and members (the gate: a company
 *                                      you are not in reads 404, said as
 *                                      "This company is not yours to open")
 *   `GET /api/company/:uid/legal`      Legal information and Locations (D1415, D1593)
 *   `GET /api/company/:uid/documents`  Documents (D1592), Open and Upload
 *   the pane's `GET /api/account/projects`  Projects in this company
 * People appear by name, never by email.
 */

function useBlock(load, tick) {
  const [s, set] = useState({ status: 'loading', value: null });
  useEffect(() => {
    let alive = true;
    set((x) => ({ status: 'loading', value: x.value }));
    Promise.resolve().then(load).then((out) => {
      if (!alive) return;
      set(out && out.available ? { status: 'ready', value: out.value } : { status: out?.notFound ? 'notFound' : 'error', value: null, out });
    });
    return () => { alive = false; };
  }, [load, tick]);
  return s;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DocumentsCard({ uid, read, onRetry, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState('');
  const picker = useRef(null);
  const [kind, setKind] = useState(null);
  if (read.status === 'loading' && !read.value) return <PCard title="Documents" testId="company-documents"><Reading lines={2} /></PCard>;
  if (read.status !== 'ready') return <PCard title="Documents" testId="company-documents"><Failed what="Documents" onRetry={onRetry} testId="company-documents-unread" /></PCard>;
  const rows = documentRows(read.value);
  const canUpload = !!read.value?.can_upload;
  const open = async (doc) => {
    setBusy(doc.uid); setSaid('');
    const out = await portfolio.downloadDocument(uid, doc.uid);
    setBusy(null);
    if (out.available) saveBlob(out.value.blob, out.value.filename); else setSaid('The document could not be opened. Try again.');
  };
  const choose = (k) => { setKind(k); picker.current?.click?.(); };
  const upload = async (file) => {
    if (!file || !kind) return;
    setBusy(kind); setSaid('');
    const out = await portfolio.uploadDocument(uid, { file, kind });
    setBusy(null);
    if (out.available) { setSaid('Uploaded.'); onChanged(); } else setSaid(out.reason && !out.unreadable ? out.reason : 'The document could not be uploaded. Try again.');
  };
  return (
    <PCard title="Documents" testId="company-documents"
      aside={canUpload ? <button type="button" className={BTN_TEXT} onClick={() => choose('other')} data-testid="company-documents-upload">Upload</button> : null}>
      <input ref={picker} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="company-documents-file" />
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.kind} className="flex flex-wrap items-center gap-3 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-800" data-testid={`company-document-${r.kind}`}>
            <span aria-hidden="true" className="inline-flex h-8 w-7 items-center justify-center rounded border border-axal-hairline font-mono text-[9px] text-axal-muted dark:border-gray-700 dark:text-gray-400">PDF</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className={`text-[13.5px] ${INK}`}>{r.label}</b>
              <span className={MUTED}>{r.doc ? (r.doc.meta || r.doc.title) : <Fact fact={{ kind: 'none' }} />}</span>
            </span>
            {r.doc?.hasFile ? <button type="button" className={BTN_TEXT} disabled={busy === r.doc.uid} onClick={() => open(r.doc)}>Open</button> : null}
            {!r.doc && canUpload ? <button type="button" className={BTN_TEXT} disabled={busy === r.kind} onClick={() => choose(r.kind)} data-testid={`company-document-upload-${r.kind}`}>Upload</button> : null}
          </li>
        ))}
      </ul>
      {said ? <p role="status" className={`m-0 mt-2 ${MUTED}`}>{said}</p> : null}
    </PCard>
  );
}

export default function CompanyPage({
  uid, card = null, projects = null, meId, active, row, switchTo, leave, onChanged, onNew, profile,
}) {
  const [tick, setTick] = useState(0);
  const reread = useCallback(() => setTick((n) => n + 1), []);
  const loadDetail = useCallback(() => portfolio.through(() => teamsApi.getCompany(uid)), [uid]);
  const loadLegal = useCallback(() => portfolio.legal(uid), [uid]);
  const loadDocs = useCallback(() => portfolio.documents(uid), [uid]);
  const detail = useBlock(loadDetail, tick);
  const legal = useBlock(loadLegal, tick);
  const docs = useBlock(loadDocs, tick);
  const [dialog, setDialog] = useState(null);
  const navigate = useNavigate();

  if (detail.status === 'notFound') {
    return (
      <div className="flex flex-col gap-3" data-testid="company-not-yours">
        <Link to={BASE_PATH} className={LINK}>‹ Portfolio</Link>
        <p className={`m-0 text-[14px] font-bold ${INK}`}>This company is not yours to open.</p>
        <Link to={BASE_PATH} className={BTN_SECONDARY}>Back to Portfolio</Link>
      </div>
    );
  }

  const powers = companyPowers(detail.value, meId);
  const name = String(detail.value?.company_name || card?.name || '').trim() || NOT_RECORDED;
  const company = { uid, name };
  // The pane says what changed (`companies-done`); leaving the company returns to Portfolio.
  const done = (msg, { switcher = false, close = false } = {}) => {
    setDialog(null); onChanged(msg, { switcher });
    if (close) navigate(BASE_PATH); else reread();
  };
  const facts = legal.status === 'ready' ? legalFacts(legal.value) : null;
  const path = legal.value?.path || card?.path || null;
  const inside = projects ? (projects.projects || []).filter((p) => p.company_uid === uid).map((p) => portfolioProject(p)) : null;
  const members = Array.isArray(detail.value?.members) ? detail.value.members : [];
  const locations = legal.status === 'ready' ? locationRows(legal.value.locations) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="company-page" data-uid={uid}>
      <Link to={BASE_PATH} className={`w-fit ${LINK}`} data-testid="company-back">‹ Portfolio</Link>
      <header className="flex flex-wrap items-start gap-3">
        <CompanyMark name={name} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${INK}`} data-testid="company-page-name">{name}</h2>
          <span className="flex flex-wrap items-center gap-2">
            <TypeBadge kind="company" />
            {card?.status ? <Pill tone={card.status.tone} data-testid="company-page-status">{card.status.label}</Pill> : null}
            {powers.archived && !card?.status ? <Pill tone="neutral">Archived</Pill> : null}
            <SlugChip path={path} />
            {active ? <Pill tone="info">{ACTIVE_HERE}</Pill> : null}
            {powers.primary ? <Pill tone="neutral">Primary admin</Pill> : null}
          </span>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Link to={companySettingsPathFor(uid)} className={BTN_SECONDARY} data-testid="company-page-settings">Company settings</Link>
          {!powers.archived && profile !== 'explorer' ? <button type="button" className={BTN_PRIMARY} onClick={() => onNew('project', { uid, name })} data-testid="company-page-new-project">New project</button> : null}
        </span>
      </header>

      {powers.archived ? <p className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2 ${MUTED} dark:bg-gray-800`} data-testid="company-archived">This company is archived. The primary admin can restore it.</p> : null}

      {detail.status === 'ready' && powers.member ? (
        <div className="flex flex-wrap gap-2" data-testid="company-actions">
          {active ? <Link className={BTN_SECONDARY} to="/studio" data-testid="company-open-studio">Open Studio</Link> : null}
          {!active && row && !powers.archived ? <button type="button" className={BTN_SECONDARY} onClick={() => setDialog('active')} data-testid="company-make-active">Make active</button> : null}
          {powers.editor && !powers.archived ? <button type="button" className={BTN_TEXT} onClick={() => setDialog('rename')} data-testid="company-rename">Rename</button> : null}
          {powers.editor && !powers.archived ? <button type="button" className={BTN_TEXT} onClick={() => setDialog('invite')} data-testid="company-invite">Invite people</button> : null}
          {powers.primary && !powers.archived ? <button type="button" className={BTN_TEXT} onClick={() => setDialog('transfer')} data-testid="company-transfer">Transfer primary admin</button> : null}
          {powers.primary && !powers.archived ? <button type="button" className={BTN_TEXT} onClick={() => setDialog('archive')} data-testid="company-archive">Archive company</button> : null}
          {powers.primary && powers.archived ? <button type="button" className={BTN_TEXT} onClick={() => setDialog('restore')} data-testid="company-restore">Restore company</button> : null}
          <button type="button" className={BTN_TEXT} onClick={() => setDialog('leave')} data-testid="company-leave">Leave company</button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <PCard title="Legal information" testId="company-legal"
            aside={legal.status === 'ready' ? <Link to={companyLegalPath(uid)} className={LINK} data-testid="company-legal-edit">Edit in Legal</Link> : null}>
            {legal.status === 'loading' && !legal.value ? <Reading />
              : !facts ? <Failed what="Legal information" onRetry={reread} testId="company-legal-unread" />
                : (
                  <FactList testId="company-legal-facts" rows={[
                    ['Legal name', <Fact key="n" fact={facts.legalName} />],
                    ['Entity type', <Fact key="t" fact={facts.entityType} />],
                    ['Jurisdiction', <Fact key="j" fact={facts.jurisdiction} />],
                    ['Registration number', <Fact key="r" fact={facts.registrationNumber} mono />],
                    ['Tax ID', <Fact key="x" fact={facts.taxId} mono />],
                    ['Registered address', <Fact key="a" fact={facts.registeredAddress} />],
                    ['Incorporation date', <Fact key="d" fact={facts.incorporationDate} mono />],
                    ['Officers and directors', <Fact key="o" fact={facts.officers} />],
                  ]} />
                )}
          </PCard>
          <PCard title="Locations" testId="company-locations">
            {legal.status === 'loading' && !legal.value ? <Reading lines={2} />
              : locations == null ? <Failed what="Locations" onRetry={reread} testId="company-locations-unread" />
                : locations.length ? (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {locations.map((l) => <li key={l.uid} className="flex flex-wrap gap-3 text-[13px]"><span className={`w-[150px] ${MUTED}`}>{l.label}</span><span className={INK}>{l.place}</span></li>)}
                  </ul>
                ) : <p className={`m-0 ${MUTED}`} data-testid="company-locations-none">No location recorded.</p>}
          </PCard>
          <DocumentsCard uid={uid} read={docs} onRetry={reread} onChanged={reread} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <PCard title="Team" count={detail.status === 'ready' ? members.length : null} testId="company-team"
            aside={<Link to={companyTeamPath(uid)} className={LINK} data-testid="company-team-link">Team</Link>}>
            {detail.status === 'loading' && !detail.value ? <Reading lines={2} />
              : detail.status !== 'ready' ? <Failed what="The team" onRetry={reread} testId="company-team-unread" />
                : (
                  <>
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {members.slice(0, 4).map((m) => (
                        <li key={m.user_id} className="flex items-center gap-2" data-testid="company-member">
                          <span className={`text-[13px] font-semibold ${INK}`}>{m.name || NOT_RECORDED}{Number(m.user_id) === Number(meId) ? ' · you' : ''}</span>
                          <Pill tone="neutral">{m.is_primary_admin ? 'Primary admin' : roleWord(m.role_in_company)}</Pill>
                        </li>
                      ))}
                    </ul>
                    {members.length > 4 ? <p className={`m-0 mt-2 ${MUTED}`}>{members.length - 4} more · <Link to={companyTeamPath(uid)} className={LINK}>Open Team</Link></p> : null}
                  </>
                )}
          </PCard>
          <PCard title="Projects in this company" testId="company-page-projects"
            aside={!powers.archived && profile !== 'explorer' ? <button type="button" className={BTN_TEXT} onClick={() => onNew('project', { uid, name })}>+ Add project</button> : null}>
            {inside == null ? <Failed what="Its projects" onRetry={() => onChanged('', {})} testId="company-page-projects-unread" />
              : inside.length ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {inside.map((p) => (
                    <li key={p.id} className="flex items-center gap-2" data-testid={`company-page-project-${p.id}`}>
                      <ProjectMark name={p.name} size={24} />
                      <Link to={projectPagePath(p.id)} className={`text-[13px] font-semibold ${INK} hover:underline`}>{p.name}</Link>
                      <span className={MUTED}>{p.stage || ''}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className={`m-0 ${MUTED}`}>No projects yet.</p>}
          </PCard>
        </div>
      </div>

      {dialog === 'rename' ? <RenameDialog company={company} onClose={() => setDialog(null)} onDone={(n) => done(`${name} is now ${n}.`, { switcher: true })} /> : null}
      {dialog === 'active' ? <MakeActiveDialog company={company} row={row} switchTo={switchTo} onClose={() => setDialog(null)} onDone={() => done(`${name} is your active company on this device.`)} /> : null}
      {dialog === 'invite' ? <InviteDialog company={company} onClose={() => setDialog(null)} onDone={(out) => done(`The invitation is saved${out?.email_sent ? ' and sent' : ''}.`)} /> : null}
      {dialog === 'transfer' ? <TransferAdminDialog company={company} people={powers.others} onClose={() => setDialog(null)} onDone={(out) => done(`${out?.to || 'They'} is now a primary admin of ${name}.`)} /> : null}
      {dialog === 'archive' ? <ArchiveDialog company={company} onClose={() => setDialog(null)} onDone={() => done(`${name} is archived.`, { switcher: true })} /> : null}
      {dialog === 'restore' ? <RestoreDialog company={company} onClose={() => setDialog(null)} onDone={() => done(`${name} is restored.`, { switcher: true })} /> : null}
      {dialog === 'leave' ? (
        <LeaveCompanyDialog company={company} leave={async (u) => { try { await leave(u); } catch (e) { reportError('portfolio:leave', e); throw e; } }} onlyPrimary={powers.onlyPrimary}
          onTransfer={powers.primary && !powers.archived ? () => setDialog('transfer') : null}
          onClose={() => setDialog(null)} onDone={() => done(`You left ${name}.`, { switcher: true, close: true })} />
      ) : null}
    </div>
  );
}
