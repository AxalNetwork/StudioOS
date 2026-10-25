import React, { useCallback, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { capTableAccessApi } from '../../../lib/api/capTableAccess';
import { actionGhost } from '../../../ui';
import { INK, LINK, MONO, MUTED, EYEBROW, ReadState, Section, TD, Table, useRead } from './CapTableTool';
import CapTableDialog, { useWrite } from './CapTableDialog';
import {
  ATTESTATION, ATTESTED, COFOUNDER_NOTE, DEFAULT_ACCESS, LEVELS, LINK_HOURS, LINK_LEVELS, LINK_VIEWS,
  grantRows, levelLabel, levelRows, linkBody, linkProblems, linkRows, logRows,
} from './capTableAccess';

/**
 * D1026 (#2863) — Access (CT13): who sees what, the levels, the share links
 * and the access log, on D1019's reads. The owner changes a level, revokes a
 * grant, makes and revokes a link, each in a dialog; a co-founder reads it all
 * and changes nothing (CT16a), because the grants read says `can_change`.
 */

const readGrants = (id) => capTableAccessApi.grants(id);
const readLinks = (id) => capTableAccessApi.links(id);
const readModel = (id) => api.getCapTableCompare(id);
const INPUT = 'w-full rounded-[8px] border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** The holders the saved model names, so a grant names one the views can find. */
function modelHolders(read) {
  const r = read?.canonical?.result;
  const rounds = Array.isArray(r?.rounds) ? r.rounds : [];
  const ledger = rounds.length ? rounds[rounds.length - 1]?.ledger : r?.founding;
  const names = (Array.isArray(ledger) ? ledger : []).filter((h) => h?.type !== 'option_pool').map((h) => String(h?.holder || '').trim()).filter(Boolean);
  return [...new Set(names)];
}

function LevelDialog({ projectId, row, holders, scope, onClose, onDone }) {
  const [level, setLevel] = useState(row?.level || '');
  const [holder, setHolder] = useState(row?.holder || '');
  const w = useWrite(onDone);
  const naming = !row;
  const target = row?.userUid ? { user_uid: row.userUid } : { holder_ref: row?.holder || holder };
  const ready = LEVELS.includes(level) && (!naming || holder) && level !== row?.level;
  const who = row?.who || holder || 'this holder';
  return (
    <CapTableDialog title={naming ? 'Share with a holder' : `Change what ${who} sees`} testId="captable-level-dialog"
      sub={`${who} sees the level you choose from their next open. Your co-founders see the change in the log.`}
      action="Save level" disabled={!ready} write={w} onClose={onClose}
      onAction={() => w.run(() => capTableAccessApi.grant(projectId, { ...target, level }))}>
      {naming ? (
        <label className="flex flex-col gap-1.5">
          <span className={EYEBROW}>Holder</span>
          {holders.length
            ? <select className={INPUT} value={holder} onChange={(e) => setHolder(e.target.value)} data-testid="captable-level-holder">
                <option value="">Choose a holder in your model</option>
                {holders.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            : <span className={`text-[12.5px] ${MUTED}`} data-testid="captable-level-no-holders">Your saved model names no holder yet, so there is nobody to share with by name.</span>}
        </label>
      ) : null}
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="captable-level-choices">
        {levelRows(scope).map((l) => (
          <label key={l.id} className="flex items-start gap-2.5 rounded-[8px] border border-axal-hairline px-3 py-2 dark:border-gray-700">
            <input type="radio" name="level" value={l.id} checked={level === l.id} onChange={() => setLevel(l.id)} data-testid={`captable-level-${l.id}`} />
            <span className="flex flex-col"><span className="font-bold">{l.label}</span><span className={`text-[12px] ${MUTED}`}>{l.sees}</span></span>
          </label>
        ))}
      </fieldset>
    </CapTableDialog>
  );
}

function RevokeDialog({ title, sub, onClose, onDone, write: doWrite, testId }) {
  const w = useWrite(onDone);
  return <CapTableDialog title={title} sub={sub} action="Revoke" tone="danger" write={w} onClose={onClose} onAction={() => w.run(doWrite)} testId={testId} />;
}

function NewLinkDialog({ projectId, scope, onClose, onDone }) {
  const [f, setF] = useState({ level: 'investor', label: '', hours: LINK_HOURS.default, views: LINK_VIEWS.default, agreed: false });
  const [made, setMade] = useState(null);
  const w = useWrite((out) => { setMade(out); onDone?.(); });
  const problems = linkProblems(f);
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  if (made) {
    return (
      <CapTableDialog title="Link created" sub="Copy it now. It is shown once and never listed again." write={w} onClose={onClose} testId="captable-link-made">
        <code className={`break-all rounded-[8px] bg-axal-ground px-2.5 py-2 text-[12px] ${INK} dark:bg-gray-800`} data-testid="captable-link-url">{`${origin}${made.share_path}`}</code>
        <span className={`text-[12px] ${MUTED}`}>{levelLabel(made.level)} level · {made.view_limit} views.</span>
      </CapTableDialog>
    );
  }
  return (
    <CapTableDialog title="New link" sub="Choose what the audience sees before the link exists." action="Create link" disabled={problems.length > 0}
      write={w} onClose={onClose} testId="captable-link-dialog" onAction={() => w.run(() => capTableAccessApi.createLink(projectId, linkBody(f)))}>
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0" data-testid="captable-link-levels">
        {LINK_LEVELS.map((l) => (
          <label key={l} className="flex items-center gap-1.5 rounded-full border border-axal-hairline px-3 py-1 dark:border-gray-700">
            <input type="radio" name="link-level" checked={f.level === l} onChange={() => setF((o) => ({ ...o, level: l }))} data-testid={`captable-link-level-${l}`} /> {levelLabel(l)}
          </label>
        ))}
      </fieldset>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-link-sees"><span className="font-bold">They see:</span> {scope?.[f.level]?.sees || levelLabel(f.level)}</p>
      <label className="flex flex-col gap-1.5"><span className={EYEBROW}>Label</span><input className={INPUT} value={f.label} onChange={set('label')} maxLength={120} data-testid="captable-link-label" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1.5"><span className={EYEBROW}>Expires in (hours)</span><input className={INPUT} type="number" min={LINK_HOURS.min} max={LINK_HOURS.max} value={f.hours} onChange={set('hours')} data-testid="captable-link-hours" /></label>
        <label className="flex flex-col gap-1.5"><span className={EYEBROW}>View limit</span><input className={INPUT} type="number" min={LINK_VIEWS.min} max={LINK_VIEWS.max} value={f.views} onChange={set('views')} data-testid="captable-link-views" /></label>
      </div>
      {ATTESTED.has(f.level) ? (
        <label className="flex items-start gap-2"><input type="checkbox" checked={f.agreed} onChange={set('agreed')} data-testid="captable-link-agreed" /> <span>{ATTESTATION}</span></label>
      ) : null}
      {problems.length ? <ul className={`m-0 list-disc pl-5 text-[12px] ${MUTED}`} data-testid="captable-link-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
    </CapTableDialog>
  );
}

function AccessLog({ projectId, reload, retry }) {
  const [pages, setPages] = useState([]);
  const load = useCallback((id) => capTableAccessApi.log(id), []);
  const first = useRead(load, projectId, reload);
  const [more, setMore] = useState({ busy: false, error: '' });
  const all = [...(first.status === 'ready' ? logRows(first.data) : []), ...pages.flatMap((p) => logRows(p))];
  const next = pages.length ? pages[pages.length - 1]?.next_before : first.data?.next_before;
  const loadMore = async () => {
    setMore({ busy: true, error: '' });
    try { const p = await capTableAccessApi.log(projectId, next); setPages((x) => [...x, p]); setMore({ busy: false, error: '' }); } catch (e) { setMore({ busy: false, error: e?.message || 'More of the log could not be read.' }); }
  };
  return (
    <Section title="Access log" testId="captable-access-log">
      <ReadState read={first} what="The access log" claim="This is not a claim that nobody opened it." onRetry={retry} testId="captable-access-log">
        {all.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-access-log-none">Nobody has opened the cap table or a link yet.</p> : (
          <Table testId="captable-access-log-table" cols={[{ key: 'w', label: 'When' }, { key: 'p', label: 'Who' }, { key: 'x', label: 'What' }]}
            rows={all.map((r) => (
              <tr key={r.id} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-access-log-row">
                <td className={`${TD} ${MONO}`}>{r.when}</td><td className={TD}>{r.who}</td><td className={TD}>{r.what}</td>
              </tr>
            ))} />
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className={`text-[11.5px] ${MUTED}`}>Who opened the cap table or a link, and when. No IP address is kept.</span>
          {next ? <button type="button" className={actionGhost} onClick={loadMore} disabled={more.busy} data-testid="captable-access-log-more">{more.busy ? 'Reading…' : 'Show older'}</button> : null}
        </div>
        {more.error ? <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300">{more.error}</p> : null}
      </ReadState>
    </Section>
  );
}

export default function AccessTab({ projectId, reload: outer, retry: outerRetry }) {
  const [local, setLocal] = useState(0);
  const reload = `${outer}:${local}`;
  const refresh = useCallback(() => { setLocal((n) => n + 1); }, []);
  const retry = useCallback(() => { outerRetry?.(); refresh(); }, [outerRetry, refresh]);
  const grants = useRead(readGrants, projectId, reload);
  const links = useRead(readLinks, projectId, reload);
  const model = useRead(readModel, projectId, reload);
  const [dialog, setDialog] = useState(null);
  const canChange = grants.status === 'ready' && grants.data?.can_change === true;
  const scope = grants.status === 'ready' ? grants.data?.levels : null;
  const rows = grants.status === 'ready' ? grantRows(grants.data) : [];
  const linkList = links.status === 'ready' ? linkRows(links.data) : [];
  const holders = useMemo(() => (model.status === 'ready' ? modelHolders(model.data) : []), [model]);
  const done = () => { setDialog(null); refresh(); };
  return (
    <div className="flex flex-col gap-3.5" data-testid="captable-access">
      {grants.status === 'ready' && !canChange
        ? <p className={`m-0 rounded-[10px] border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] ${INK} dark:border-gray-700 dark:bg-gray-800`} data-testid="captable-access-readonly">{COFOUNDER_NOTE}</p>
        : null}
      <Section title="Who sees what" testId="captable-who"
        aside={canChange ? <button type="button" className={actionGhost} onClick={() => setDialog({ kind: 'grant' })} data-testid="captable-grant-new">Share with a holder</button> : null}>
        <ReadState read={grants} what="Who sees your cap table" claim="This is not a claim that nobody does." onRetry={retry} testId="captable-who">
          {rows.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-who-none">Nobody has been granted a level yet.</p> : (
            <Table testId="captable-who-table"
              cols={[{ key: 'p', label: 'Person or firm' }, { key: 'r', label: 'Relationship' }, { key: 'l', label: 'Level' }, { key: 'g', label: 'Granted by' }, { key: 's', label: 'Since' }, { key: 'v', label: 'Last viewed' }, { key: 'x', label: '' }]}
              rows={rows.map((g) => (
                <tr key={g.id} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-who-row">
                  <td className={`${TD} font-bold`}>{g.who}</td>
                  <td className={TD}>{g.role}</td>
                  <td className={TD}>
                    <span className="flex flex-col gap-0.5">
                      {canChange
                        ? <button type="button" className={`${LINK} w-fit text-left`} onClick={() => setDialog({ kind: 'level', row: g })} data-testid="captable-who-level">{g.levelLabel}</button>
                        : <span className="font-bold" data-testid="captable-who-level-text">{g.levelLabel}</span>}
                      {g.rights ? <span className={`text-[11.5px] ${MUTED}`} data-testid="captable-who-rights">{g.rights}</span> : null}
                    </span>
                  </td>
                  <td className={TD}>{g.grantedBy}</td>
                  <td className={`${TD} ${MONO}`}>{g.since}</td>
                  <td className={`${TD} ${MONO}`}>{g.lastViewed}</td>
                  <td className={TD}>{canChange ? <button type="button" className={LINK} onClick={() => setDialog({ kind: 'revoke', row: g })} data-testid="captable-who-revoke">Revoke</button> : null}</td>
                </tr>
              ))} />
          )}
          <p className={`m-0 mt-2 text-[11.5px] ${MUTED}`} data-testid="captable-who-defaults">{DEFAULT_ACCESS}</p>
        </ReadState>
      </Section>
      <Section title="Levels" testId="captable-levels">
        <dl className="m-0 flex flex-col gap-1.5">
          {levelRows(scope).map((l) => (
            <div key={l.id} className="flex flex-col" data-testid="captable-level-row"><dt className={`text-[13px] font-bold ${INK}`}>{l.label}</dt><dd className={`m-0 text-[12px] ${MUTED}`}>{l.sees}</dd></div>
          ))}
        </dl>
      </Section>
      <Section title="Share links" testId="captable-links"
        aside={canChange ? <button type="button" className={actionGhost} onClick={() => setDialog({ kind: 'link' })} data-testid="captable-link-new">New link</button> : null}>
        <ReadState read={links} what="Your share links" claim="This is not a claim that none exist." onRetry={retry} testId="captable-links">
          {linkList.length === 0 ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="captable-links-none">No share link yet.</p> : (
            <Table testId="captable-links-table"
              cols={[{ key: 'l', label: 'Label' }, { key: 'v', label: 'Level' }, { key: 'e', label: 'Expires' }, { key: 'n', label: 'Views' }, { key: 'w', label: 'Last viewed' }, { key: 'x', label: '' }]}
              rows={linkList.map((l) => (
                <tr key={l.id} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid="captable-link-row">
                  <td className={`${TD} font-bold`}>{l.label}</td><td className={TD}>{l.level}</td>
                  <td className={`${TD} ${MONO}`}>{l.expires}</td><td className={`${TD} ${MONO}`}>{l.views}</td><td className={`${TD} ${MONO}`}>{l.lastViewed}</td>
                  <td className={TD}>{canChange && l.live ? <button type="button" className={LINK} onClick={() => setDialog({ kind: 'unlink', row: l })} data-testid="captable-link-revoke">Revoke</button> : null}</td>
                </tr>
              ))} />
          )}
        </ReadState>
      </Section>
      <AccessLog projectId={projectId} reload={reload} retry={retry} />
      {dialog?.kind === 'grant' || dialog?.kind === 'level'
        ? <LevelDialog projectId={projectId} row={dialog.row} holders={holders} scope={scope} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'revoke'
        ? <RevokeDialog title={`Stop sharing with ${dialog.row.who}?`} sub={`${dialog.row.who} stops seeing the cap table from their next open. The grant stays on file.`}
            write={() => capTableAccessApi.revokeGrant(projectId, dialog.row.id)} onClose={() => setDialog(null)} onDone={done} testId="captable-revoke-dialog" /> : null}
      {dialog?.kind === 'unlink'
        ? <RevokeDialog title={`Revoke “${dialog.row.label}”?`} sub="Anyone holding the link sees nothing from now on. Its views stay in the log."
            write={() => capTableAccessApi.revokeLink(projectId, dialog.row.id)} onClose={() => setDialog(null)} onDone={done} testId="captable-unlink-dialog" /> : null}
      {dialog?.kind === 'link' ? <NewLinkDialog projectId={projectId} scope={scope} onClose={() => setDialog(null)} onDone={refresh} /> : null}
    </div>
  );
}
