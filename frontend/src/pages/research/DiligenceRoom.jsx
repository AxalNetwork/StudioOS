import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Pill, Unreadable, Unrecorded, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { useRailPage } from '../../ui/railCrumbs';
import { railOptionFor } from '../../lib/railOptions';
import useRecordCrumb from '../admin/useRecordCrumb';
import { StatedLimit } from '../advisor/expertise/kit';
import { activityLine, day, folderNameOf, memoExport, roomFileState, roomNdaState, stagedSinceLastVisit, when } from './diligenceRead';
import SharedRoomFiles from '../deal/SharedRoomFiles.jsx';
import { roomListing } from '../deal/dealWorkModel.js';
import { tabHref } from '../dealPageModel';
import { SharedEvidence } from '../cycles/evidence/InvestorEvidence';
import { createRecordGate } from './recordGate.js';
import RoomDeals from './RoomDeals';
import { AddToLibrarySheet, RoomFileLibrary, RoomLibraryNote, useRoomLibrary } from './RoomLibrary';

/**
 * `/research/diligence/:grantUid` — one data room, read by the investor who
 * holds the grant (canvas b6a5f992, "Room access").
 *
 * THIS PAGE IS THE ROOM. It replaced the investor drawer that used to open over
 * `/raise/data-room` (D311), so the files the investor may open are listed here
 * and each one links to its own page, where the download is. Opening this page
 * is logged as `open_room` by the worker, exactly as the drawer's read was: the
 * founder sees it.
 *
 * WHAT IS BEHIND AN NDA IS A COUNT. The worker never sends those names, so
 * there is nothing here to hide — no placeholder row, no greyed-out filename.
 * #6270: nor a folder whose every file is withheld — a folder with no file
 * listed here is not drawn, so a group heading or a folder count never stands
 * for a withheld file either.
 *
 * #6270 (canvas IRV-03): the files are the deal tab's own room component
 * (`SharedRoomFiles`, DE10 #5907), grouped by folder, searched through the
 * shared `DataRoomSearch` (hits only from the listing), each with its staged
 * date and a New pill when it was staged after the visit before this one.
 *
 * A GRANT THAT IS NOT YOURS AND ONE THAT DOES NOT EXIST ANSWER THE SAME WAY
 * (`room_not_found`), and so does this page: "This room is not open to you."
 * Any other failure is Unreadable, with a retry, never an empty room.
 */

const ghostBtn = 'inline-block rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[12px] font-bold '
  + 'text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50';
const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

function Tile({ k, v, sub, warn }) {
  return (
    <Card className={warn ? 'border-amber-200 dark:border-amber-900' : ''}>
      <div className={eyebrow}>{k}</div>
      {v === null
        ? <div className="mt-2"><Unrecorded /></div>
        : (
          <div className={`mt-1.5 font-mono text-[20px] font-bold tracking-tight ${
            warn ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-gray-100'}`}
          >
            {v}
          </div>
        )}
      <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

const ndaTone = { on_file: 'text-emerald-700 dark:text-emerald-300', out_for_signature: 'text-amber-800 dark:text-amber-300', none: 'text-axal-ink dark:text-gray-100' };

/**
 * #6270: where the NDA with this founder stands, and where to review and sign it. The room read
 * carries no envelope, so the link is the deal's Data room tab, where Sign NDA and the envelope
 * live (DE10) — drawn only when a deal on this company is one you may open.
 */
function RoomNda({ nda, withheld, deals }) {
  const st = roomNdaState(nda);
  const deal = (Array.isArray(deals) ? deals : []).find((d) => d && d.id != null) || null;
  const needsSigning = st && st.status !== 'on_file' && (withheld > 0 || st.status === 'out_for_signature');
  return (
    <Card data-testid="room-nda">
      <div className={eyebrow}>NDA with this founder</div>
      {st ? (
        <>
          <div className={`mt-1.5 text-[15px] font-extrabold ${ndaTone[st.status]}`} data-testid="room-nda-state">{st.label}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{st.line}</p>
        </>
      ) : <div className="mt-2"><Unrecorded /></div>}
      {needsSigning && deal ? (
        <Link to={tabHref(deal.id, 'documents')} className={`${ghostBtn} mt-2.5`} data-testid="room-nda-sign">Review and sign</Link>
      ) : null}
      {needsSigning && !deal ? (
        <p className="mt-2 text-[11.5px] text-axal-muted" data-testid="room-nda-no-link">
          An NDA is signed from a deal’s Data room tab, and no deal on this company is open to you.
        </p>
      ) : null}
    </Card>
  );
}

/** #6270 (IRV-03C): Copy and Export, on an accepted memo only. Export hands over a plain-text file. */
function MemoCopyExport({ item, company }) {
  const [said, setSaid] = useState('');
  const out = memoExport({ company, body: item.body, acceptedAt: item.accepted_at });
  const copy = async () => {
    try { await navigator.clipboard.writeText(out.text); setSaid('Copied.'); }
    catch { setSaid('This browser did not allow copying. Use Export instead.'); }
  };
  const save = () => {
    try {
      const url = URL.createObjectURL(new Blob([out.text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = out.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setSaid(`Exported as ${out.filename}.`);
    } catch { setSaid('The memo could not be exported here. Use Copy instead.'); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="room-memo-actions">
      <button type="button" className={memoBtn} onClick={copy} data-testid="room-memo-copy">Copy</button>
      <button type="button" className={memoBtn} onClick={save} data-testid="room-memo-export">Export</button>
      {said ? <span role="status" className="text-[10.5px] text-gray-700 dark:text-gray-300">{said}</span> : null}
    </span>
  );
}
const memoBtn = 'inline-flex items-center rounded-[7px] border border-gray-200 bg-white px-[11px] py-1.5 text-[11px] font-bold text-gray-700 '
  + 'hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-600';

/** This room, as the profiles' option inventories name it (`lib/railOptions`). */
const ZONE_FILE = 'pages/research/DiligenceRoom.jsx';

export default function DiligenceRoom({ role = 'investor' }) {
  const { grantUid } = useParams();
  const [room, setRoom] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | unreadable

  // D4607: a read that answers after the route has moved on, or after the
  // page has left, is dropped with its result, its error and its loading state.
  const gate = useRef(null);
  if (!gate.current) gate.current = createRecordGate();
  useEffect(() => () => gate.current.invalidate(), []);

  const load = useCallback(async () => {
    const fresh = gate.current.begin();
    setState('loading');
    setRoom(null);
    try {
      const r = await api.research.diligenceRoom(grantUid);
      if (!fresh()) return;
      setRoom(r);
      setState('ready');
    } catch (e) {
      if (!fresh()) return;
      setRoom(null);
      // D278 — branch on the code, never on the sentence.
      setState(e?.code === 'room_not_found' ? 'missing' : 'unreadable');
    }
  }, [grantUid]);
  useEffect(() => { load(); }, [load]);
  // D772 (#2098): the room is the rail's record, and its band names the profile's key for it.
  useRecordCrumb(room?.project?.name || null, 'diligence-room', grantUid);
  const railPage = useRailPage()?.page ?? null;

  // D6913 (RS-13): which open files are in the caller's Library, and whether the founder allows it.
  const library = useRoomLibrary(room?.project?.uid || null);
  const [adding, setAdding] = useState(null);
  const fileState = roomFileState(room);
  // Read only inside the ready branch, where the worker always sends the count.
  const withheld = room ? room.withheld_behind_nda : null;
  const base = `/research/diligence/${encodeURIComponent(grantUid)}`;
  const navigate = useNavigate();
  // #6270: the listing the room component draws — the read's own files, and only folders that hold one.
  const listing = useMemo(() => {
    if (!room) return null;
    const l = roomListing(room);
    return { ...l, folders: l.folders.filter((f) => f.count > 0) };
  }, [room]);
  const rawByUid = useMemo(() => new Map((room?.files || []).map((f) => [f.uid, f])), [room]);
  const newCount = (room?.files || []).filter((f) => stagedSinceLastVisit(f.created_at, room.last_opened_at) === true).length;
  const fileHref = (uid) => `${base}/files/${encodeURIComponent(uid)}`;

  return (
    <WorkspaceShell
      role={role}
      title={room?.project?.name || 'Room access'}
      activeSlug="diligence"
      rail={(
        <WorkerRail
          workspace="Research"
          role="investor"
          stance="This page shows what the founder staged, not what was asked for"
          note="Opening this page is logged as opening the room, and the founder sees it. Files behind an NDA are counted and never named."
          coverage={[room
            ? `${room.project.name}: ${room.file_open} of ${room.file_total} open to you`
            : 'One data room you hold a grant on']}
          unavailable={[
            ['Requesting files', 'The grant is the founder’s to make and to widen. Nothing here asks for more.'],
          ]}
        />
      )}
    >
      <div data-testid="diligence-room" className="space-y-3">
        <Link to="/research/diligence" className="text-[12px] font-semibold text-indigo-700 underline dark:text-indigo-300">
          ‹ Diligence
        </Link>

        {state === 'loading' && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] text-axal-muted">Loading this room.</p>
          </Card>
        )}

        {state === 'unreadable' && (
          <Card variant="dashed" padding="lg">
            <Unreadable
              what="This room"
              claim="Nothing is shown rather than an empty room, which would say the founder staged nothing."
              onRetry={load}
            />
          </Card>
        )}

        {state === 'missing' && (
          <Card padding="lg" data-testid="room-not-open">
            <h1 className="text-[15px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
              This room is not open to you.
            </h1>
            <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
              A grant is active or it is nothing — revoked and expired rooms do not appear in
              Diligence, so there is no state here to request your way out of.
            </p>
            <Link to="/research/diligence" className={`${ghostBtn} mt-3`}>‹ Back to Diligence</Link>
          </Card>
        )}

        {state === 'ready' && room && (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className={eyebrow}>Room access</div>
                  <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
                    {room.project.name}
                  </h1>
                  <p className="mt-1.5 text-[12px] text-axal-muted">
                    {`Granted ${day(room.grant.created_at)}`}
                    {room.grant.expires_at ? ` · Access expires ${day(room.grant.expires_at)}` : ''}
                  </p>
                  <p className="mt-1.5 text-[12px] text-gray-700 dark:text-gray-300">
                    {room.last_opened_at
                      ? `You last opened it ${day(room.last_opened_at)}`
                      : <><Unrecorded /> <span className="ml-1 text-axal-muted">You have not opened this room before</span></>}
                  </p>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile k="Open to you" v={room.file_open} sub={room.nda_signed ? 'NDA signed with this founder' : 'no NDA on file'} />
              <Tile k="In the room" v={room.file_total} sub="everything the founder staged" />
              <Tile
                k="Behind an NDA"
                v={withheld}
                warn={withheld > 0}
                sub={withheld > 0 ? 'a count, never the names' : 'everything in this room is open to you'}
              />
              <Tile k="Last opened" v={room.last_opened_at ? day(room.last_opened_at) : null} sub="by you, before this visit" />
            </div>
            <p className="px-0.5 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
              Scope is what they staged, not what was asked. What is absent from a room is diligence
              information too, so the two numbers stand apart rather than as a percentage.
            </p>

            <RoomNda nda={room.nda} withheld={withheld} deals={room.deals} />

            <Card id="open-to-you" data-testid="room-open-files">
              <div className="flex items-baseline justify-between gap-3">
                <span className={eyebrow}>Open to you</span>
                <span className="text-[11px] text-axal-muted">{`${room.file_open} of ${room.file_total}`}</span>
              </div>
              {fileState === 'open' && (
                <>
                  <p className="mt-1.5 text-[11.5px] text-axal-muted" data-testid="room-new-line">
                    {room.last_opened_at
                      ? `New · staged after your previous visit, ${when(room.last_opened_at)} · ${newCount} ${newCount === 1 ? 'file' : 'files'}`
                      : 'This is your first visit, so no file is marked new.'}
                  </p>
                  <div className="mt-2.5 min-w-0">
                    <SharedRoomFiles
                      key={room.project.uid}
                      projectUid={room.project.uid}
                      listing={listing}
                      rawFiles={room.files}
                      withheld={withheld}
                      grouped
                      addedLabel="Staged "
                      fileLink={(f, { folder }) => ({ to: fileHref(f.uid), state: { folder } })}
                      onOpen={(f) => navigate(fileHref(f.uid), { state: { folder: folderNameOf(listing.folders, f.folder_uid) } })}
                      onDownload={(f) => navigate(fileHref(f.uid))}
                      rowExtra={(f) => {
                        const r = rawByUid.get(f.uid) || {};
                        return (
                          <span className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-axal-muted">
                            {stagedSinceLastVisit(r.created_at, room.last_opened_at) === true ? <Pill tone="info" data-testid="room-file-new">New</Pill> : null}
                            {r.visibility === 'nda' ? <Pill tone="warn">NDA · signed</Pill> : null}
                            <span>{r.last_downloaded_at ? `Link issued ${when(r.last_downloaded_at)}` : 'Not downloaded'}</span>
                            <RoomFileLibrary file={f} read={library.read} onAdd={setAdding} />
                          </span>
                        );
                      }}
                    />
                  </div>
                  <RoomLibraryNote read={library.read} />
                  {adding ? <AddToLibrarySheet file={adding} room={room} onClose={() => setAdding(null)} onAdded={() => library.reload()} /> : null}
                  <p className="mt-3 border-t border-axal-hairline pt-2.5 text-[11px] text-axal-muted dark:border-gray-800">
                    Links are issued to you alone, work once, expire after two minutes. Not watermarked.
                    The founder can see which documents you opened.
                  </p>
                </>
              )}
              {fileState === 'all_withheld' && (
                <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">
                    Every document in this room is behind an NDA.
                  </p>
                  <p className="mt-1 text-[12px] text-gray-700 dark:text-gray-300">
                    Nothing is listed here, by name or as a placeholder — the count above is the whole of
                    what you can know today.
                  </p>
                </div>
              )}
              {fileState === 'empty' && (
                <div className="mt-2.5 rounded-xl border-[1.5px] border-dashed border-axal-hairline p-4 dark:border-gray-700">
                  <p className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Nothing staged in this room yet.</p>
                  <p className="mt-1 text-[12px] text-gray-700 dark:text-gray-300">
                    The grant is live and the room is empty. That is a finding, not an error.
                  </p>
                </div>
              )}
            </Card>

            {withheld > 0 && (
              <div
                data-testid="room-behind-nda"
                className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
              >
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-amber-800 dark:text-amber-300">Behind an NDA</div>
                <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
                  {`${withheld} more ${withheld === 1 ? 'document is' : 'documents are'} behind an NDA. `}
                  Sign one with this company and they appear in the room. They are not listed here by name.
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-axal-hairline bg-axal-ground p-4 dark:border-gray-800 dark:bg-gray-950">
              <div className={eyebrow}>Deal stage</div>
              {/* D6266: the deals on this company you may open; none is said in plain words, not as Not recorded. */}
              <div className="mt-1.5"><RoomDeals deals={room.deals} note={room.deal_stage_note} /></div>
            </div>

            <Card data-testid="room-activity">
              <div className="flex items-baseline justify-between gap-3">
                <span className={eyebrow}>Your activity</span>
                <span className="text-[11px] text-axal-muted">your opens and downloads on this project only</span>
              </div>
              {room.activity.length ? (
                <ul className="mt-2.5 space-y-2">
                  {room.activity.map((a, i) => {
                    const line = activityLine(a);
                    return (
                      <li key={`${a.created_at}-${i}`} className="flex min-w-0 flex-col gap-1 text-[12px] sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-2.5">
                        <span className="shrink-0 text-[11px] text-axal-muted sm:w-[130px]">{when(a.created_at)}</span>
                        <Pill tone="neutral">{line.verb}</Pill>
                        {line.what ? <span className="min-w-0 break-words text-axal-ink dark:text-gray-100">{line.what}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2.5 text-[12px]">
                  <Unrecorded /> <span className="ml-1 text-axal-muted">You have not opened this room before</span>
                </p>
              )}
              <p className="mt-2.5 text-[11px] text-axal-muted">{room.download_note}</p>
            </Card>

            {/* D1268 (#3291): the founder's shared evidence, by the same NDA and sharing rules as the deal page (D1265). */}
            <SharedEvidence projectUid={room.project.uid} company={room.project.name} />

            <ZoneDraft
              surface="research/diligence"
              railOption={railOptionFor(railPage, { file: ZONE_FILE, control: 'research/diligence' })?.key}
              scopeKey={room.grant.uid}
              scoped
              accent="indigo"
              label="Room · what is thin"
              run="Draft"
              accept="Accept"
              empty="A short memo on what this room holds and what is thin, drafted from the counts and file names above. Nothing behind the NDA is named to it."
              nothingToDraft="This room is not open to you, so there is nothing to draft over."
              foot="Accept writes your memo. It does not email the founder or request files."
              acceptedActions={(item) => <MemoCopyExport item={item} company={room.project.name} />}
            />
          </>
        )}

        <StatedLimit title="What this page will not do">
          Nothing here asks a founder to stage more of this room. A room is asked for on its deal:
          open the deal from <Link to="/deals" className="font-bold underline">Deals</Link>, then
          Documents, then Ask for access. The grant stays the founder’s to make and to revoke.
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
