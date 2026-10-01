import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Pill, Unreadable, Unrecorded, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { StatedLimit } from '../advisor/expertise/kit';
import { activityLine, day, fileSize, roomFileState, when } from './diligenceRead';

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
 *
 * A GRANT THAT IS NOT YOURS AND ONE THAT DOES NOT EXIST ANSWER THE SAME WAY
 * (`room_not_found`), and so does this page: "This room is not open to you."
 * Any other failure is Unreadable, with a retry, never an empty room.
 */

const ghostBtn = 'inline-block rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[12px] font-bold '
  + 'text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50';
const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const th = 'text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint';

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

export default function DiligenceRoom({ role = 'investor' }) {
  const { grantUid } = useParams();
  const [room, setRoom] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | unreadable

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.research.diligenceRoom(grantUid);
      setRoom(r);
      setState('ready');
    } catch (e) {
      setRoom(null);
      // D278 — branch on the code, never on the sentence.
      setState(e?.code === 'room_not_found' ? 'missing' : 'unreadable');
    }
  }, [grantUid]);
  useEffect(() => { load(); }, [load]);

  const fileState = roomFileState(room);
  // Read only inside the ready branch, where the worker always sends the count.
  const withheld = room ? room.withheld_behind_nda : null;
  const base = `/research/diligence/${encodeURIComponent(grantUid)}`;

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
            ['Deal stage', 'A grant and a deal are separate records with no key between them.'],
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
                <a href="#open-to-you" className={ghostBtn}>Open the room →</a>
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

            <Card>
              <div className={eyebrow}>Scope</div>
              <div className="mt-2.5 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[12px]">
                  <thead>
                    <tr>
                      {['Company', 'Open to you', 'In the room', 'Behind an NDA', 'You last opened'].map((h) => (
                        <th key={h} className={`${th} pb-2`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-axal-hairline dark:border-gray-800">
                      <td className="py-2.5 font-bold text-axal-ink dark:text-gray-100">{room.project.name}</td>
                      <td className="py-2.5 font-mono">{room.file_open}</td>
                      <td className="py-2.5 font-mono">{room.file_total}</td>
                      <td className={`py-2.5 font-mono ${withheld > 0 ? 'text-amber-800 dark:text-amber-300' : ''}`}>{withheld}</td>
                      <td className="py-2.5 text-axal-muted">{room.last_opened_at ? day(room.last_opened_at) : <Unrecorded />}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card id="open-to-you" data-testid="room-open-files">
              <div className="flex items-baseline justify-between gap-3">
                <span className={eyebrow}>Open to you</span>
                <span className="text-[11px] text-axal-muted">{`${room.file_open} of ${room.file_total}`}</span>
              </div>
              {fileState === 'open' && (
                <>
                  <div className="mt-2.5 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-[12px]">
                      <thead>
                        <tr>
                          <th className={`${th} pb-2`}>File</th>
                          <th className={`${th} pb-2`}>Size</th>
                          <th className={`${th} pb-2`}>You last downloaded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {room.files.map((f) => (
                          <tr key={f.uid} className="border-t border-axal-hairline dark:border-gray-800">
                            <td className="py-2.5">
                              <Link
                                to={`${base}/files/${encodeURIComponent(f.uid)}`}
                                className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
                              >
                                {f.name}
                              </Link>
                              {f.visibility === 'nda' ? <Pill tone="warn" className="ml-2">NDA · signed</Pill> : null}
                            </td>
                            <td className="py-2.5 text-[11px] text-axal-muted">{fileSize(f.size_bytes) ?? <Unrecorded />}</td>
                            <td className="py-2.5 text-[11px] text-axal-muted">
                              {f.last_downloaded_at ? when(f.last_downloaded_at) : <Unrecorded />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
              <div className="mt-1.5"><Unrecorded reason={room.deal_stage_note} /></div>
              <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{room.deal_stage_note}</p>
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
                      <li key={`${a.created_at}-${i}`} className="flex flex-wrap items-baseline gap-2.5 text-[12px]">
                        <span className="w-[130px] shrink-0 text-[11px] text-axal-muted">{when(a.created_at)}</span>
                        <Pill tone="neutral">{line.verb}</Pill>
                        {line.what ? <span className="text-axal-ink dark:text-gray-100">{line.what}</span> : null}
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

            <ZoneDraft
              surface="research/diligence"
              scopeKey={room.grant.uid}
              scoped
              accent="indigo"
              label="Room · what is thin"
              run="Draft"
              accept="Accept"
              empty="A short memo on what this room holds and what is thin, drafted from the counts and file names above. Nothing behind the NDA is named to it."
              nothingToDraft="This room is not open to you, so there is nothing to draft over."
              foot="Accept writes your memo. It does not email the founder or request files."
            />
          </>
        )}

        <StatedLimit title="What this page will not do">
          Nothing here asks a founder to open a room, or to stage more of one. The grant is theirs to
          make and theirs to revoke. A request button that wrote nowhere would be worse than the
          conversation it replaced.
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
