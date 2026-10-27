/**
 * D1251 (#3266) — the case tabs that are the deal team's alone: Requests
 * (DDL6), Documents (DDL7), Cross-checks (DDL8), Team (DDL9) and Sign-off
 * (DDL10). A read scoped to a section reviewer never draws them
 * (`ddCaseModel.tabsFor`). Each control is drawn only when `allowed` says so;
 * otherwise one sentence says who does it.
 */
import React, { useEffect, useState } from 'react';
import { dd } from '../../lib/api';
import { ddLifecycleApi } from '../../lib/api/ddLifecycle.js';
import {
  LINK_LINE, MEMO_MAX, MEMO_PARTS, NOT_RECORDED, REQ_STATE_WORD, SOURCE_STATE_WORD, WHO, caseRefusal, conditionFlags, documentLists,
  fmtDay, icState, may, maySection, platformRows, reportRows, reqState, requestActions, requestTiles, sectionRow, teamRows, unstaffed,
} from './ddCaseModel.js';
import { dueOf } from './ddReviewModel.js';
import { Block, DecisionStrip, Severity, Table, Td, Tile, CaseUnreadable, Who } from './DdCaseWork.jsx';
import { Note, btnCls, dangerCls, fieldCls, inputCls, muted, primaryCls } from './DdUi.jsx';

const today = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ *
 * Requests (DDL6)
 * ------------------------------------------------------------------ */

const ACTION_LABEL = { review: 'Mark reviewed', remind: 'Send a reminder', due: 'Change due date', withdraw: 'Withdraw…' };

export function RequestsTab({ data, open }) {
  const requests = data.requests || [];
  const writes = may(data, 'requests') && data.case.status !== 'archived';
  const sectionTitle = (id) => (data.sections || []).find((s) => Number(s.id) === Number(id))?.title || 'Case-wide';
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-requests">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{requestTiles(requests, today()).map((t) => <Tile key={t.key} tile={t} />)}</div>
      <Block title="Requests to the subject" testId="dd-requests"
        action={writes ? <button type="button" className={primaryCls} onClick={() => open('compose')} data-testid="dd-compose-open">Compose request</button> : <Who text={data.case.status === 'archived' ? WHO.archived : WHO.requests} testId="dd-who-requests" />}>
        {!requests.length ? <p className={`m-0 text-[13px] ${muted}`}>No request has been sent on this case.</p> : (
          <Table head={['Request', 'Section', 'State', 'Due', 'Files', 'Reminders', '']}>
            {requests.map((r) => {
              const due = dueOf(r, today());
              const acts = writes ? requestActions(r) : [];
              return (
                <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`dd-request-${r.id}`}>
                  <Td><span className="font-semibold">{r.title}</span>{r.created_by_name ? <span className={`block text-[12px] ${muted}`}>Sent by {r.created_by_name} · {fmtDay(r.created_at) || NOT_RECORDED}</span> : null}</Td>
                  <Td>{sectionTitle(r.section_id)}</Td>
                  <Td>{REQ_STATE_WORD[reqState(r)] || NOT_RECORDED}</Td>
                  <Td>{due.text}{due.late ? <span className="block text-[12px] font-semibold text-amber-800 dark:text-amber-200">{due.late}</span> : null}</Td>
                  <Td>{Array.isArray(r.files) ? (r.files.length || 'None') : NOT_RECORDED}</Td>
                  <Td>{r.reminders ? (r.reminders.count ? `${r.reminders.count} · last ${fmtDay(r.reminders.last_at) || NOT_RECORDED}` : 'None') : NOT_RECORDED}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {acts.map((a) => (
                        <button key={a} type="button" className={`${btnCls} h-8 px-2 text-[12px]`} onClick={() => open(`req-${a}`, { req: r })} data-testid={`dd-request-${r.id}-${a}`}>{ACTION_LABEL[a]}</button>
                      ))}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Block>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Documents (DDL7)
 * ------------------------------------------------------------------ */

function OpenLink({ uid, kind, id, name }) {
  const [refused, setRefused] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true); setRefused(null);
    try { const r = await dd.documentLink(uid, kind, id); if (r?.url) window.open(r.url, '_blank', 'noopener,noreferrer'); }
    catch (e) { setRefused(caseRefusal(e, 'The file could not be opened.')); }
    finally { setBusy(false); }
  };
  return (
    <span className="flex flex-col">
      <button type="button" className="w-fit text-left font-semibold text-violet-700 underline dark:text-violet-300" onClick={go} aria-label={`Open ${name}`}>{busy ? 'Opening…' : 'Open'}</button>
      {refused ? <span role="alert" className="text-[12px] text-red-700 dark:text-red-300">{refused}</span> : null}
    </span>
  );
}

export function DocumentsTab({ uid, data, onRetry }) {
  const lists = documentLists(data);
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-documents">
      <Note>{LINK_LINE}</Note>
      <Block title="From the subject" testId="dd-docs-subject">
        {lists.unreadable ? <CaseUnreadable what="The files the subject sent could not be read." onRetry={onRetry} testId="dd-docs-unreadable" />
          : !lists.fromSubject.length ? <p className={`m-0 text-[13px] ${muted}`}>The subject has sent no file yet.</p> : (
            <Table head={['File', 'Request', 'Section', 'Sent', 'Size', '']}>
              {lists.fromSubject.map((f) => (
                <tr key={f.id} className="border-t border-axal-hairline dark:border-gray-800">
                  <Td className="font-semibold">{f.name}</Td><Td>{f.request}</Td><Td>{f.section}</Td><Td>{f.at}</Td><Td>{f.size}</Td>
                  <Td><OpenLink uid={uid} kind="request_file" id={f.id} name={f.name} /></Td>
                </tr>
              ))}
            </Table>
          )}
      </Block>
      <Block title="Evidence on checklist items" testId="dd-docs-evidence">
        {lists.evidence == null ? <CaseUnreadable what="The evidence on items could not be read." onRetry={onRetry} />
          : !lists.evidence.length ? <p className={`m-0 text-[13px] ${muted}`}>No evidence is attached to an item yet.</p> : (
            <Table head={['Evidence', 'Item', 'Section', 'Added by', 'Added', 'Size', '']}>
              {lists.evidence.map((e) => (
                <tr key={e.key} className="border-t border-axal-hairline dark:border-gray-800">
                  <Td className="font-semibold">{e.name}</Td><Td>{e.item}</Td><Td>{e.section}</Td><Td>{e.by}</Td><Td>{e.at}</Td><Td>{e.size}</Td>
                  <Td>{e.kind === 'file' && e.attachmentId ? <OpenLink uid={uid} kind="attachment" id={e.attachmentId} name={e.name} />
                    : e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-violet-700 underline dark:text-violet-300">Visit link</a> : null}</Td>
                </tr>
              ))}
            </Table>
          )}
      </Block>
      <Block title="Reviewer NDAs" testId="dd-docs-ndas">
        {!lists.ndas.length ? <p className={`m-0 text-[13px] ${muted}`}>No NDA is on file.</p> : (
          <Table head={['File', 'Section', 'Uploaded', 'Size', '']}>
            {lists.ndas.map((a) => (
              <tr key={a.id} className="border-t border-axal-hairline dark:border-gray-800">
                <Td className="font-semibold">{a.name}</Td><Td>{a.section}</Td><Td>{a.at}</Td><Td>{a.size}</Td>
                <Td><OpenLink uid={uid} kind="attachment" id={a.id} name={a.name} /></Td>
              </tr>
            ))}
          </Table>
        )}
        {lists.missing.map((m) => <p key={m} className="m-0 mt-2 text-[12.5px] font-semibold text-amber-800 dark:text-amber-200">{m}</p>)}
      </Block>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cross-checks (DDL8)
 * ------------------------------------------------------------------ */

export function CrossChecksTab({ data, open, scanning }) {
  const pc = platformRows(data.case.platform_checks);
  const sources = data.sources || [];
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-cross-checks">
      <Block title="External sources" testId="dd-sources"
        action={may(data, 'scan') ? <button type="button" className={primaryCls} onClick={() => open('scan')} data-testid="dd-scan-open">{scanning ? 'Scan running…' : 'Run external scan'}</button> : <Who text={WHO.scan} testId="dd-who-scan" />}>
        {!sources.length ? <p className={`m-0 text-[13px] ${muted}`}>No scan has run on this case.</p> : (
          <Table head={['Source', 'State', 'Records', 'Flags raised', 'Finished']}>
            {sources.map((s) => (
              <tr key={s.id} className="border-t border-axal-hairline dark:border-gray-800">
                <Td className="font-mono text-[12px]">{s.connector}</Td>
                <Td>{SOURCE_STATE_WORD[s.status] || NOT_RECORDED}{s.status === 'error' && s.error_message ? <span className={`block text-[12px] ${muted}`}>{s.error_message}</span> : null}</Td>
                <Td>{s.status === 'ok' ? Number(s.records_count).toLocaleString('en-US') : '—'}</Td>
                <Td>{s.status === 'ok' ? Number(s.findings_emitted).toLocaleString('en-US') : '—'}</Td>
                <Td>{fmtDay(s.completed_at) || '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Block>
      <Block title="Platform checks" testId="dd-platform">
        {pc.state === 'none' ? <p className={`m-0 text-[13px] ${muted}`}>This subject has no platform check.</p>
          : pc.state === 'unavailable' ? <p className="m-0 text-[13px]">Unreadable. {pc.reason || 'The platform checks could not be read.'}</p> : (
            <ul className="m-0 list-none space-y-1.5 p-0">
              {pc.rows.map((r) => (
                <li key={r.key} className="flex flex-wrap gap-x-3 text-[13px]" data-testid={`dd-platform-${r.key}`}>
                  <span className="font-semibold">{r.label}</span>
                  {r.state === 'unreadable' ? <span>Unreadable. {r.reason || ''}</span> : (
                    <>
                      <span>{r.word}</span>
                      {r.reason ? <span className={muted}>{r.reason}</span> : null}
                      {r.at ? <span className={muted}>{r.at}</span> : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
      </Block>
      <Note>What the team takes on trust is written in the memo, on Sign-off.</Note>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Team (DDL9)
 * ------------------------------------------------------------------ */

export function TeamTab({ data, open }) {
  const cs = data.case;
  const rows = teamRows(data);
  const team = may(data, 'team');
  const assign = may(data, 'assign') && cs.status !== 'archived';
  const empty = unstaffed(data);
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-team">
      <Block title="Case lead" testId="dd-lead"
        action={may(data, 'update') ? <button type="button" className={btnCls} onClick={() => open('lead')} data-testid="dd-lead-open">Change lead</button> : <Who text={cs.status === 'archived' ? WHO.archived : WHO.update} testId="dd-who-lead" />}>
        <p className="m-0 text-[14px] font-semibold" data-testid="dd-lead-name">{cs.lead_name || NOT_RECORDED}</p>
        <p className={`m-0 text-[12.5px] ${muted}`}>Records the decision and sends the case to IC.</p>
      </Block>
      <Block title="Reviewers and observers" testId="dd-team"
        action={assign ? <button type="button" className={primaryCls} onClick={() => open('assign')} data-testid="dd-assign-open">Assign</button> : <Who text={cs.status === 'archived' ? WHO.archived : WHO.assign} testId="dd-who-assign" />}>
        {!rows.length ? <p className={`m-0 text-[13px] ${muted}`}>Nobody is assigned to a section yet.</p> : (
          <Table head={['Person', 'Section', 'Role', 'Invited', 'Accepted', 'NDA', 'Conflicts', 'Verdict', '']}>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`dd-team-${r.key}`}>
                <Td className="font-semibold">{r.name}</Td><Td>{r.section}</Td><Td>{r.role}</Td><Td>{r.invited}</Td><Td>{r.accepted}</Td>
                <Td>{r.nda}</Td><Td>{r.conflicts}{r.conflictsNote ? <span className={`block text-[12px] ${muted}`}>{r.conflictsNote}</span> : null}</Td><Td>{r.verdict}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {assign ? <button type="button" className={`${btnCls} h-8 px-2 text-[12px]`} onClick={() => open('resend', { row: r })} data-testid={`dd-team-${r.key}-resend`}>Resend invitation</button> : null}
                    {team ? <button type="button" className={`${btnCls} h-8 px-2 text-[12px]`} onClick={() => open('remove', { row: r })} data-testid={`dd-team-${r.key}-remove`}>Remove</button> : null}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {!team && rows.length ? <Who text={cs.status === 'archived' ? WHO.archived : WHO.team} testId="dd-who-team" /> : null}
        {empty.map((s) => <p key={s.id} className="m-0 mt-2 text-[12.5px] font-semibold text-amber-800 dark:text-amber-200">No one reviews {s.title}.</p>)}
      </Block>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sign-off (DDL10)
 * ------------------------------------------------------------------ */

function Memo({ uid, data, open, version }) {
  const [state, setState] = useState({ memo: null, failed: false, read: false });
  const [draft, setDraft] = useState({});
  const [saved, setSaved] = useState(null);
  const writes = may(data, 'decide');
  const load = () => {
    setState({ memo: null, failed: false, read: false });
    ddLifecycleApi.memo(uid).then((r) => { setState({ memo: r?.memo || null, failed: false, read: true }); setDraft(Object.fromEntries(MEMO_PARTS.map((p) => [p.key, r?.memo?.[p.key] || '']))); })
      .catch(() => setState({ memo: null, failed: true, read: false }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (may(data, 'memo_read')) load(); }, [uid, version]);
  if (!may(data, 'memo_read')) return <Who text={WHO.memo} />;
  if (state.failed) return <CaseUnreadable what="The memo could not be read." onRetry={load} testId="dd-memo-unreadable" />;
  if (!state.read) return <p className={`m-0 text-[13px] ${muted}`}>Reading the memo…</p>;
  const save = () => {
    const long = MEMO_PARTS.find((p) => String(draft[p.key] || '').length > MEMO_MAX);
    if (long) { setSaved({ error: `${long.label} is at most ${MEMO_MAX.toLocaleString('en-US')} characters.` }); return; }
    setSaved(null);
    open('memo', { draft });
  };
  return (
    <div className="flex flex-col gap-3" data-testid="dd-memo">
      {MEMO_PARTS.map((p) => (
        <label key={p.key} className="block">
          <span className={fieldCls}>{p.label}</span>
          {writes ? <textarea rows={3} className={inputCls} value={draft[p.key] || ''} onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))} data-testid={`dd-memo-${p.key}`} />
            : <p className="m-0 whitespace-pre-wrap text-[13px]">{state.memo?.[p.key] || NOT_RECORDED}</p>}
        </label>
      ))}
      {state.memo?.updated_at ? <p className={`m-0 text-[12px] ${muted}`}>Last saved {fmtDay(state.memo.updated_at)}{state.memo.updated_by_name ? ` by ${state.memo.updated_by_name}` : ''}.</p> : null}
      {writes ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnCls} onClick={save} data-testid="dd-memo-save">Save memo</button>
          {saved?.error ? <span role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{saved.error}</span> : null}
        </div>
      ) : <Who text={data.case.status === 'archived' ? WHO.archived : WHO.memo} testId="dd-who-memo" />}
    </div>
  );
}

function Reports({ uid, data, open, version }) {
  const [state, setState] = useState({ items: null, failed: false });
  const [refused, setRefused] = useState(null);
  const load = () => {
    setState({ items: null, failed: false });
    ddLifecycleApi.reports(uid).then((r) => setState({ items: r?.items || [], failed: false })).catch(() => setState({ items: null, failed: true }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (may(data, 'report')) load(); }, [uid, version]);
  if (!may(data, 'report')) return <Who text={WHO.report} testId="dd-who-report" />;
  const again = async (id) => {
    setRefused(null);
    try { const r = await ddLifecycleApi.downloadReport(uid, id); if (r?.download_url) window.open(r.download_url, '_blank', 'noopener,noreferrer'); }
    catch (e) { setRefused(caseRefusal(e, 'The report could not be downloaded.')); }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="dd-reports">
      <div><button type="button" className={btnCls} onClick={() => open('report')} data-testid="dd-report-open">Generate report</button></div>
      {state.failed ? <CaseUnreadable what="The reports could not be read." onRetry={load} />
        : state.items == null ? <p className={`m-0 text-[13px] ${muted}`}>Reading the reports…</p>
          : !state.items.length ? <p className={`m-0 text-[13px] ${muted}`}>No report has been generated.</p> : (
            <Table head={['Generated', 'By', 'Format', 'Risk then', '']}>
              {reportRows(state.items).map((r) => (
                <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-800">
                  <Td>{r.at}</Td><Td>{r.by}</Td><Td>{r.format}</Td><Td>{r.band}</Td>
                  <Td>{r.stored ? <button type="button" className="font-semibold text-violet-700 underline dark:text-violet-300" onClick={() => again(r.id)}>Download again</button> : <span className={muted}>Not stored</span>}</Td>
                </tr>
              ))}
            </Table>
          )}
      {refused ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{refused}</p> : null}
    </div>
  );
}

export function SignOffTab({ uid, data, open, version }) {
  const cs = data.case;
  const ic = icState(cs, data);
  const conditions = conditionFlags(data.flags);
  return (
    <div className="flex flex-col gap-4" data-testid="dd-case-sign-off">
      <Block title="Section sign-offs" testId="dd-signoffs">
        <Table head={['Section', 'Verdict', 'Signed off', '']}>
          {(data.sections || []).map((s) => {
            const row = sectionRow(s, data);
            const verdict = maySection(data, 'verdict', s.id) && cs.status !== 'archived';
            return (
              <tr key={s.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`dd-signoff-row-${s.id}`}>
                <Td className="font-semibold">{row.title}{row.blocking ? <span className={`block text-[11.5px] ${muted}`}>Blocking</span> : null}</Td>
                <Td>{row.verdict}</Td>
                <Td>{row.signedOff.text}{row.signedOff.at ? ` · ${row.signedOff.at}` : ''}{row.signedOff.sub ? <span className={`block text-[12px] ${muted}`}>{row.signedOff.sub}</span> : null}</Td>
                <Td>{verdict ? <button type="button" className={`${btnCls} h-8 px-2 text-[12px]`} onClick={() => open('verdict', { section: s })} data-testid={`dd-signoff-verdict-${s.id}`}>{row.hasVerdict ? 'Change verdict' : 'Record verdict'}</button> : null}</Td>
              </tr>
            );
          })}
        </Table>
      </Block>
      <Block title="Memo" testId="dd-memo-block"><Memo uid={uid} data={data} open={open} version={version} /></Block>
      <DecisionStrip data={data} onDecide={() => open('decide')} />
      {conditions.length ? (
        <Block title="Conditions to close" testId="dd-conditions">
          <ul className="m-0 list-none space-y-1 p-0">{conditions.map((f) => <li key={`${f.kind}-${f.id}`} className="flex gap-2 text-[13px]"><Severity s={f.severity} />{f.title}</li>)}</ul>
        </Block>
      ) : null}
      <Block title="Investment committee" testId="dd-ic"
        action={ic.state === 'ready' ? <button type="button" className={primaryCls} onClick={() => open('ic')} data-testid="dd-ic-open">Send to IC</button> : null}>
        <p className="m-0 text-[13px]" data-testid="dd-ic-state">{ic.text}</p>
      </Block>
      <Block title="Reports" testId="dd-reports-block"
        action={may(data, 'notify_founder') ? <button type="button" className={btnCls} onClick={() => open('notify')} data-testid="dd-notify-open">Notify founder</button> : null}>
        <Reports uid={uid} data={data} open={open} version={version} />
        {!may(data, 'notify_founder') && (cs.subject_type === 'project' || cs.subject_type === 'founder') ? <Who text={WHO.notify_founder} testId="dd-who-notify" /> : null}
      </Block>
      <Block title="Scope and archive" testId="dd-scope">
        <div className="flex flex-wrap items-center gap-2">
          {may(data, 'widen') ? <button type="button" className={btnCls} onClick={() => open('widen')} data-testid="dd-widen-open">Widen scope</button> : <Who text={cs.status === 'archived' ? WHO.archived : WHO.widen} testId="dd-who-widen" />}
          {may(data, 'update') ? <button type="button" className={`${dangerCls}`} onClick={() => open('archive')} data-testid="dd-archive-open">Archive case</button> : null}
        </div>
      </Block>
    </div>
  );
}
