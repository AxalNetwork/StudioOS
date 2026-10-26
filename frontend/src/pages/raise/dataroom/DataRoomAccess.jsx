import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { dataRoomApi } from '../../../lib/api/dataRoom';
import { Lightbox, Unreadable } from '../../../ui';
import DataRoomDialog from './DataRoomDialog.jsx';
import { day } from './dataRoomModel';
import {
  COFOUNDER_LINE, FILTERS, NDA_LINE, NDA_WORD, REVOKE_LINE, STATE_WORD,
  accessRefusal, accessRows, candidateRows, canOpen, eventLine, eventsOf, filterRows, foldersWord, grantBody, grantBodyError,
  isOwner, matrix, ndaOf, ndaUnlocks, shareEffect,
} from './accessModel';

/**
 * D1107 (#2987) — Access (DR6, DR6m), Share (DR7), one investor (DR7i),
 * Revoke (DR7r), the NDA (DR8) and the co-founder's view (DR16b). Every
 * change opens an in-page dialog that says what it changes before it is
 * sent; who can open what is `grantOn`'s, never decided here.
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TH = 'px-3 py-2 text-left text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top text-[12.5px] text-axal-ink dark:text-gray-100';
const MONO = 'font-mono tabular-nums';
const BTN = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const BTN_P = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] border border-axal-violet bg-axal-violet px-3.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:border-violet-500 dark:bg-violet-600';
const SELECT = 'min-h-[32px] rounded-full border border-axal-hairline bg-white px-3 text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const FIELD = 'block w-full rounded-[7px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const NOTE = 'rounded-[10px] border border-axal-lavender-edge bg-axal-lavender px-3 py-2.5 text-[12.5px] font-semibold text-axal-ink dark:border-violet-800 dark:bg-violet-900/30 dark:text-gray-100';
const NDA_TONE = {
  signed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  pending: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  none: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

function NdaPill({ state }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${NDA_TONE[state]}`}>{NDA_WORD[state]}</span>;
}

/** The end date and folders, as Share, Change and a request's acceptance ask them. */
export function GrantFields({ room, value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className={EYEBROW}>Ends on</span>
        <input type="date" className={FIELD} value={value.until} onChange={(e) => set('until', e.target.value)} data-testid="grant-until" />
        <span className={`text-[11.5px] ${MUTED}`}>Leave empty for no end date. Access lasts through the day you choose.</span>
      </label>
      <div className="flex flex-col gap-1.5">
        <span className={EYEBROW}>Folders</span>
        <span className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Folders">
          {[['all', 'All folders'], ['some', 'Choose folders']].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={value.scope === k} onClick={() => set('scope', k)}
              className={`min-h-[30px] rounded-full border px-3 text-[12px] ${value.scope === k ? 'border-axal-violet bg-axal-lavender font-bold text-axal-violet-deep dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300' : `border-axal-hairline font-semibold ${INK} dark:border-gray-700`}`}
              data-testid={`grant-scope-${k}`}>{label}</button>
          ))}
        </span>
        {value.scope === 'some' ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="grant-folders">
            {(room?.folders || []).length ? (room.folders || []).map((f) => (
              <li key={f.uid}>
                <label className={`flex items-center gap-2 text-[12.5px] ${INK}`}>
                  <input type="checkbox" checked={value.chosen.includes(f.uid)} data-testid={`grant-folder-${f.uid}`}
                    onChange={(e) => set('chosen', e.target.checked ? [...value.chosen, f.uid] : value.chosen.filter((u) => u !== f.uid))} />
                  {f.name}
                </label>
              </li>
            )) : <li className={`text-[12px] ${MUTED}`}>The room has no folders yet. A file at the top level is in no folder.</li>}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

const startFields = (g = null) => ({
  until: g?.expires_at ? String(g.expires_at).slice(0, 10) : '',
  scope: g?.folders ? 'some' : 'all',
  chosen: g?.folders ? [...g.folders] : [],
});

/** DR7: Share, picking one of this venture's prospects in Capital relationships. `prefill` is a request's investor. */
export function ShareDialog({ room, projectUid, onClose, onDone, prefill = null }) {
  const [read, setRead] = useState({ status: 'loading', candidates: [] });
  const [q, setQ] = useState(prefill?.email || '');
  const [pick, setPick] = useState(null);
  const [fields, setFields] = useState(startFields());
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', candidates: [] });
    dataRoomApi.shareCandidates(projectUid)
      .then((r) => { if (alive) setRead({ status: 'ready', candidates: r?.candidates || [] }); })
      .catch(() => { if (alive) setRead({ status: 'unreadable', candidates: [] }); });
    return () => { alive = false; };
  }, [projectUid, reload]);
  const rows = candidateRows(read.candidates, room, q);
  const chosen = rows.find((r) => r.uid === pick) || null;
  const error = grantBodyError(fields);
  const effect = shareEffect(room, { folders: fields.scope === 'all' ? null : fields.chosen, committed: Boolean(chosen?.committed) });
  return (
    <DataRoomDialog testId="share-dialog" copy={{ title: 'Share the room', body: `Give one investor access to ${room?.project?.name || 'this venture'}’s room.`, action: 'Share' }}
      disabled={!chosen || Boolean(error)} refusalOf={accessRefusal} onClose={onClose}
      onConfirm={async () => { await dataRoomApi.share(projectUid, { prospect: chosen.uid, ...grantBody(fields) }); onDone(`${chosen.title} can open the room now.`); }}>
      <label className="flex flex-col gap-1.5">
        <span className={EYEBROW}>Who</span>
        <input className={FIELD} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search investors in Capital relationships" data-testid="share-search" />
      </label>
      {read.status === 'loading' ? <p className={`m-0 text-[12px] ${MUTED}`} aria-busy="true">Reading Capital relationships…</p> : null}
      {read.status === 'unreadable' ? <Unreadable what="Capital relationships" claim="This is not a claim that you have no investors." onRetry={() => setReload((n) => n + 1)} /> : null}
      {read.status === 'ready' && !rows.length ? (
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="share-none">{read.candidates.length ? 'No investor in Capital relationships matches.' : 'Capital relationships has no investors yet. Add one there to share the room.'}</p>
      ) : null}
      <ul className="m-0 flex max-h-[240px] list-none flex-col gap-1 overflow-y-auto p-0" data-testid="share-candidates">
        {rows.map((r) => (
          <li key={r.uid}>
            <button type="button" disabled={r.disabled} onClick={() => setPick(r.uid)} aria-pressed={pick === r.uid}
              className={`flex w-full flex-col items-start rounded-[9px] border px-2.5 py-2 text-left disabled:opacity-60 ${pick === r.uid ? 'border-axal-lavender-edge bg-axal-lavender dark:border-violet-800 dark:bg-violet-900/30' : 'border-transparent hover:bg-axal-ground dark:hover:bg-gray-800'}`}
              data-testid={`share-candidate-${r.uid}`}>
              <span className={`text-[13px] font-bold ${INK}`}>{r.title}{r.name ? ` · ${r.name}` : ''}</span>
              <span className={`text-[11.5px] ${MUTED}`}>{r.sub}</span>
            </button>
          </li>
        ))}
      </ul>
      <GrantFields room={room} value={fields} onChange={setFields} />
      {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="share-error">{error}</p> : null}
      <p className={NOTE} data-testid="share-effect">{effect}</p>
      <p className={`m-0 text-[11.5px] ${MUTED}`}>Only someone with a StudioOS account at that address can open the room. Nobody is invited by email.</p>
    </DataRoomDialog>
  );
}

/** DR8: the founder sends the three-way NDA. The signing link comes back for the founder only. */
function NdaDialog({ room, projectUid, grant, onClose, onDone }) {
  const unlocks = ndaUnlocks(room, grant);
  return (
    <DataRoomDialog testId="nda-dialog" copy={{ title: 'Send the NDA', body: NDA_LINE, action: 'Send for signature' }} refusalOf={accessRefusal} onClose={onClose}
      onConfirm={async () => { const r = await dataRoomApi.sendNda(projectUid, grant.uid); onDone('The NDA is out for signature.', r?.signing_url || null); }}>
      <p className="m-0 text-[12.5px] font-semibold">Signers: you for {room?.project?.name || 'the venture'} · {grant.investor_name || grant.investor_email} · Axal VC</p>
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="nda-unlocks">
        {unlocks.length ? `Once signed, they can also open ${unlocks.length} NDA ${unlocks.length === 1 ? 'file' : 'files'}.` : 'No NDA file in the room would open for them yet.'}
      </p>
    </DataRoomDialog>
  );
}

/** DR7i: one investor's grant, what they open now, the NDA and their events. */
function InvestorLightbox({ room, grant, owner, onClose, onAct }) {
  const nda = ndaOf(grant);
  const unlocks = ndaUnlocks(room, grant);
  const events = eventsOf(room, grant);
  const total = (room?.files || []).length;
  return (
    <Lightbox label={grant.investor_name || 'Investor'} eyebrow="Investor · grant" title={grant.investor_name || grant.investor_email} onClose={onClose} width={600} testId="investor-lightbox"
      footer={owner ? (
        <div className="flex flex-wrap justify-between gap-2">
          <button type="button" className={`${BTN} border-red-300 text-red-700 dark:border-red-800 dark:text-red-300`} onClick={() => onAct('revoke', grant)} data-testid="investor-revoke">Revoke access</button>
          <button type="button" className={BTN} onClick={() => onAct('change', grant)} data-testid="investor-change">Change</button>
        </div>
      ) : null}>
      <div className="flex flex-col gap-4 px-5 py-4">
        <dl className="m-0 grid grid-cols-2 gap-3 text-[12.5px]">
          {[['Granted', `${day(grant.created_at)}${grant.granted_by_name ? ` · by ${grant.granted_by_name}` : ''}`], ['Ends', grant.expires_at ? day(grant.expires_at) : 'No end date'],
            ['Folders', foldersWord(room, grant)], ['Committed', `${grant.committed ? 'Yes' : 'No'} · from Capital relationships`]].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5"><dt className={EYEBROW}>{k}</dt><dd className={`m-0 font-semibold ${INK}`}>{v}</dd></div>
          ))}
        </dl>
        <section className="flex flex-col gap-1.5 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="investor-nda">
          <span className={EYEBROW}>NDA</span>
          <div className="flex flex-wrap items-center gap-2"><NdaPill state={nda} />
            {owner && nda === 'none' ? <button type="button" className={BTN} onClick={() => onAct('nda', grant)} data-testid="investor-send-nda">Send the NDA</button> : null}
          </div>
        </section>
        <section className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="investor-opens">
          <span className={EYEBROW}>What they can open now</span>
          <span className={`text-[13px] font-bold ${MONO} ${INK}`}>{canOpen(room, grant)} of {total} files</span>
          {unlocks.length ? <span className={`text-[12px] ${MUTED}`}>{unlocks.length} more open once the NDA is signed.</span> : null}
        </section>
        <section className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="investor-events">
          <span className={EYEBROW}>Their events · of the room’s last fifty</span>
          {events.length ? events.map((a, i) => (
            <div key={i} className="flex justify-between gap-3 text-[12.5px]"><span className={INK}>{eventLine(a)}</span><span className={`${MONO} ${MUTED}`}>{day(a.created_at)}</span></div>
          )) : <span className={`text-[12px] ${MUTED}`}>None among the last fifty events. Activity has the full log.</span>}
        </section>
      </div>
    </Lightbox>
  );
}

function Matrix({ room, phone }) {
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('all');
  const m = useMemo(() => matrix(room, { q, folder }), [room, q, folder]);
  return (
    <div className="flex flex-col gap-2" data-testid="access-matrix">
      <div className="flex flex-wrap gap-2">
        <input className={`${FIELD} max-w-[260px]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" data-testid="matrix-search" />
        <select className={SELECT} value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder" data-testid="matrix-folder">
          <option value="all">Folder: any</option><option value="top">Top level</option>
          {(room?.folders || []).map((f) => <option key={f.uid} value={f.uid}>{f.name}</option>)}
        </select>
      </div>
      {!m.investors.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="matrix-none">No grant is in force, so no investor can open a file.</p> : (
        <div className="overflow-x-auto">
          <table className={`w-full border-collapse ${phone ? 'min-w-[640px]' : ''}`}>
            <thead><tr className="border-b border-axal-hairline dark:border-gray-800"><th className={TH}>File</th>{m.investors.map((i) => <th key={i.uid} className={TH}>{i.who}</th>)}{m.more > 0 ? <th className={TH} data-testid="matrix-more">+{m.more} more</th> : null}</tr></thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid={`matrix-row-${r.uid}`}>
                  <td className={TD}><span className="font-bold">{r.name}</span><span className={`block text-[11.5px] ${MUTED}`}>{r.folder}</span></td>
                  {r.cells.map((c, i) => (
                    <td key={i} className={TD} data-testid={`matrix-cell-${r.uid}-${m.investors[i].uid}`}>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${c.open ? NDA_TONE.signed : NDA_TONE.none}`}>{c.open ? '✓ ' : ''}{c.why}</span>
                    </td>
                  ))}
                  {m.more > 0 ? <td className={TD} /> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={`m-0 text-[11.5px] ${MUTED}`}>Each cell shows the first rule that shuts the investor out: the grant, its folders, the file’s tier, its end date, then the NDA.</p>
    </div>
  );
}

/** DR8's strip: the NDA by investor, and what it unlocks, named for the founder only. */
function NdaStrip({ room, owner, onAct }) {
  const grants = (room?.grants || []).filter((g) => g.status === 'active');
  if (!grants.length) return null;
  const ndaFiles = (room?.files || []).filter((f) => f.visibility === 'nda');
  return (
    <section className={`${CARD} flex flex-col gap-2 px-4 py-3`} data-testid="nda-strip">
      <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>NDA by investor</h3>
      {grants.map((g) => (
        <div key={g.uid} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-2 dark:border-gray-800" data-testid={`nda-row-${g.uid}`}>
          <span className={`text-[13px] font-bold ${INK}`}>{g.investor_name || g.investor_email}</span>
          <span className="flex items-center gap-2"><NdaPill state={ndaOf(g)} />
            {owner && ndaOf(g) === 'none' ? <button type="button" className={BTN} onClick={() => onAct('nda', g)} data-testid={`nda-send-${g.uid}`}>Send the NDA</button> : null}
          </span>
        </div>
      ))}
      <div className="border-t border-axal-hairline pt-2 dark:border-gray-800" data-testid="nda-files">
        <span className={EYEBROW}>What the NDA unlocks · named for you only</span>
        <p className={`m-0 text-[12px] ${MUTED}`}>{ndaFiles.length ? `${ndaFiles.length} NDA ${ndaFiles.length === 1 ? 'file' : 'files'}. Investors without an NDA see a count, never the names.` : 'No file in the room needs the NDA.'}</p>
        {ndaFiles.slice(0, 8).map((f) => <p key={f.uid} className={`m-0 text-[12.5px] font-semibold ${INK}`}>▤ {f.name}</p>)}
      </div>
    </section>
  );
}

/** DR6: Access, by investor or as the matrix. The room is the tab's read; a change re-reads it. */
export default function DataRoomAccess({ room, projectUid, reload, phone = false }) {
  const owner = isOwner(room);
  const [view, setView] = useState('list');
  const [f, setF] = useState({ q: '', nda: 'all', committed: 'all', state: 'active' });
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [said, setSaid] = useState(null);
  const rows = useMemo(() => filterRows(accessRows(room), f), [room, f]);
  const all = accessRows(room);
  const grantOf = (uid) => (room?.grants || []).find((g) => g.uid === uid) || null;
  const act = (kind, grant) => { setOpen(null); setDialog({ kind, grant }); };
  const done = (line, link = null) => { setDialog(null); setSaid({ line, link }); reload(); };
  const shares = Array.isArray(room?.report_shares) ? room.report_shares.filter((s) => s.status === 'active') : null;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="dataroom-access">
      {!owner ? <p className={NOTE} data-testid="access-cofounder">{COFOUNDER_LINE}</p> : null}
      {said ? (
        <p role="status" className={`m-0 text-[12.5px] font-semibold ${INK}`} data-testid="access-said">
          {said.line}{said.link ? <> <a className="font-bold text-axal-violet dark:text-violet-300" href={said.link} target="_blank" rel="noopener noreferrer">Sign your part</a></> : null}
        </p>
      ) : null}
      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-hairline px-4 py-3 dark:border-gray-800">
          <h2 className={`m-0 text-[15px] font-extrabold tracking-[-.015em] ${INK}`}>{view === 'list' ? 'By investor' : 'Matrix'}</h2>
          <span className="flex flex-wrap gap-2">
            <span className="inline-flex rounded-[9px] border border-axal-hairline p-0.5 dark:border-gray-700" role="tablist" aria-label="View">
              {['list', 'matrix'].map((v) => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} data-testid={`access-view-${v}`}
                  className={`min-h-[28px] rounded-[7px] px-3 text-[12px] ${view === v ? `bg-axal-ground font-bold ${INK} dark:bg-gray-800` : `font-semibold ${MUTED}`}`}>{v === 'list' ? 'List' : 'Matrix'}</button>
              ))}
            </span>
            {owner ? <button type="button" className={BTN_P} onClick={() => setDialog({ kind: 'share' })} data-testid="access-share">Share</button> : null}
          </span>
        </div>
        <div className="px-4 py-3">
          {view === 'matrix' ? <Matrix room={room} phone={phone} /> : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <input className={`${FIELD} max-w-[240px]`} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search investors" data-testid="access-search" />
                {Object.entries(FILTERS).map(([k, opts]) => (
                  <select key={k} className={SELECT} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={k} data-testid={`access-filter-${k}`}>
                    {opts.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                ))}
              </div>
              {!all.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="dataroom-access-none">The room is not shared with anyone yet.{owner ? ' Share it with an investor from Capital relationships.' : ''}</p>
                : !rows.length ? <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="access-filtered-none">No grant matches these filters.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[880px] border-collapse" data-testid="dataroom-access-table">
                      <thead><tr className="border-b border-axal-hairline dark:border-gray-800">{['Investor', 'Granted', 'Ends', 'Folders', 'NDA', 'Committed', 'Can open', 'Last event'].map((c) => <th key={c} className={TH}>{c}</th>)}</tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.uid} className="cursor-pointer border-b border-axal-hairline last:border-0 hover:bg-axal-ground dark:border-gray-800 dark:hover:bg-gray-800" data-testid="dataroom-grant-row"
                            onClick={() => setOpen(r.uid)}>
                            <td className={TD}><button type="button" className="text-left font-bold" onClick={(e) => { e.stopPropagation(); setOpen(r.uid); }} data-testid={`grant-open-${r.uid}`}>{r.who}</button>
                              {r.email && r.email !== r.who ? <span className={`block text-[11.5px] ${MUTED}`}>{r.email}</span> : null}
                              {r.state !== 'active' ? <span className={`block text-[11.5px] ${MUTED}`}>{STATE_WORD[r.state]}</span> : null}</td>
                            <td className={`${TD} ${MONO}`}>{r.granted}<span className={`block text-[11px] ${MUTED}`}>by {r.by}</span></td>
                            <td className={`${TD} ${MONO}`}>{r.ends}{r.endingSoon ? <span className="block text-[11px] font-bold text-amber-700 dark:text-amber-300">{r.endingSoon}</span> : null}</td>
                            <td className={TD}>{r.folders}</td>
                            <td className={TD}><NdaPill state={r.nda} /></td>
                            <td className={TD}>{r.committed}</td>
                            <td className={`${TD} ${MONO}`}>{r.canOpen}</td>
                            <td className={TD}>{r.last}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              <p className={`m-0 text-[11.5px] ${MUTED}`}>Can open counts what each grant, gate and NDA allows today. Committed comes from Capital relationships.</p>
            </div>
          )}
        </div>
      </section>
      <NdaStrip room={room} owner={owner} onAct={act} />
      <section className={`${CARD} flex flex-col gap-1.5 px-4 py-3`} data-testid="access-report-shares">
        <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>Scoring report shared with</h3>
        <p className={`m-0 text-[12px] ${MUTED}`}>Read only. Managed in Fundraising readiness.</p>
        {shares === null ? <Unreadable what="The report shares" claim="This is not a claim that the report is shared with no one." onRetry={reload} />
          : shares.length ? shares.map((s) => <p key={s.id} className={`m-0 text-[12.5px] font-semibold ${INK}`}>{s.grantee_name || s.grantee_email} <span className={`font-normal ${MUTED}`}>· shared {day(s.created_at)}</span></p>)
            : <p className={`m-0 text-[12.5px] ${MUTED}`}>Not shared with anyone.</p>}
      </section>
      {open && grantOf(open) ? <InvestorLightbox room={room} grant={grantOf(open)} owner={owner} onClose={() => setOpen(null)} onAct={act} /> : null}
      {dialog?.kind === 'share' ? <ShareDialog room={room} projectUid={projectUid} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'nda' ? <NdaDialog room={room} projectUid={projectUid} grant={dialog.grant} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'revoke' ? (
        <DataRoomDialog testId="revoke-dialog" danger copy={{ title: `Revoke ${dialog.grant.investor_name || dialog.grant.investor_email}’s access?`, body: REVOKE_LINE, action: 'Revoke access' }}
          refusalOf={accessRefusal} onClose={() => setDialog(null)}
          onConfirm={async () => { await api.dataRoomRevoke(projectUid, dialog.grant.uid); done(`${dialog.grant.investor_name || dialog.grant.investor_email} can no longer open the room.`); }} />
      ) : null}
      {dialog?.kind === 'change' ? <ChangeDialog room={room} projectUid={projectUid} grant={dialog.grant} onClose={() => setDialog(null)} onDone={done} /> : null}
    </div>
  );
}

const files = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** Change a grant's end date or folders (D1103's PATCH), said before it is sent. */
function ChangeDialog({ room, projectUid, grant, onClose, onDone }) {
  const [fields, setFields] = useState(startFields(grant));
  const error = grantBodyError(fields);
  const next = { ...grant, folders: fields.scope === 'all' ? null : fields.chosen, folders_unreadable: false };
  const before = canOpen(room, grant);
  const after = canOpen(room, next);
  return (
    <DataRoomDialog testId="change-dialog" copy={{ title: `Change ${grant.investor_name || grant.investor_email}’s access`, body: 'The end date and the folders they can open.', action: 'Save' }}
      disabled={Boolean(error)} refusalOf={accessRefusal} onClose={onClose}
      onConfirm={async () => { await dataRoomApi.updateGrant(projectUid, grant.uid, grantBody(fields)); onDone(`${grant.investor_name || grant.investor_email}’s access is changed.`); }}>
      <GrantFields room={room} value={fields} onChange={setFields} />
      {error ? <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="change-error">{error}</p> : null}
      <p className={NOTE} data-testid="change-effect">{before === after ? `They can open ${files(after)}, as now.` : `They can open ${files(after)} after this, ${before} now.`}</p>
    </DataRoomDialog>
  );
}
