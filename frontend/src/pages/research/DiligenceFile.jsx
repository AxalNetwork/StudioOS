import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Pill, Unreadable, Unrecorded, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { StatedLimit } from '../advisor/expertise/kit';
import { day, fileSize, when } from './diligenceRead';

/**
 * `/research/diligence/:grantUid/files/:fileUid` — one document in a room the
 * investor holds a grant on (canvas 96463a46).
 *
 * THE PAGE IS THE FILE'S FACTS AND THE DOWNLOAD, and nothing about what the
 * file says. There is no preview pane, because the product has none and an
 * empty viewer frame would promise one.
 *
 * A DOCUMENT BEHIND AN NDA THE READER HAS NOT SIGNED HAS NO NAME HERE — not in
 * the heading, the crumb or the shell title. The worker's `nda_required`
 * refusal carries the room and nothing about the file, so there is no name on
 * the client to leak.
 *
 * THE DOWNLOAD IS THE DATA ROOM'S OWN ROUTE, which re-checks the grant and the
 * NDA, issues a single-use two-minute link and logs `download`. The history
 * below is that log, the reader's rows only, and each line says a link was
 * issued: whether it was followed is not recorded, so it is not claimed.
 */

const ghostBtn = 'inline-block rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-bold text-axal-ink '
  + 'hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const primaryBtn = 'rounded-lg bg-indigo-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-indigo-700 '
  + 'disabled:cursor-not-allowed disabled:opacity-60';
const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';

export default function DiligenceFile({ role = 'investor' }) {
  const { grantUid, fileUid } = useParams();
  const [data, setData] = useState(null);
  const [roomRef, setRoomRef] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | gated | missing_file | missing_room | unreadable
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await api.research.diligenceFile(grantUid, fileUid);
      setData(r);
      setRoomRef(r.room);
      setState('ready');
    } catch (e) {
      setData(null);
      // D278 — the code decides the state; the refusal's `room` is the only
      // thing a gated or missing document's answer carries.
      setRoomRef(e?.data?.room || null);
      setState(e?.code === 'nda_required' ? 'gated'
        : e?.code === 'file_not_found' ? 'missing_file'
          : e?.code === 'room_not_found' ? 'missing_room'
            : 'unreadable');
    }
  }, [grantUid, fileUid]);
  useEffect(() => { load(); }, [load]);

  const download = async () => {
    if (!data || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.dataRoomDownload(data.room.project_uid, data.file.uid);
      if (res?.url) window.open(res.url, '_blank', 'noopener,noreferrer');
      await load();
    } catch (e) {
      setNotice(e?.message || 'That download link could not be issued.');
    } finally {
      setBusy(false);
    }
  };

  const roomHref = `/research/diligence/${encodeURIComponent(grantUid)}`;
  const file = data?.file || null;
  const size = file ? fileSize(file.size_bytes) : null;
  const projectName = roomRef?.project_name || null;
  // Never the file's name unless the worker sent one.
  const title = file ? file.name : (projectName ? `${projectName} · document` : 'Document');

  return (
    <WorkspaceShell
      role={role}
      title={title}
      activeSlug="diligence"
      rail={(
        <WorkerRail
          workspace="Research"
          role="investor"
          stance="This page shows a document's facts, not its contents"
          note="The download is a single-use link issued to you alone. The founder sees that you opened it."
          coverage={[file ? `${file.name}${size ? ` · ${size}` : ''}` : 'One document in a room you hold a grant on']}
          unavailable={[
            ['Preview', 'The product has no document viewer, so there is no preview pane.'],
            ['Watermark', 'Downloads are not watermarked. What protects the file is the single-use link.'],
          ]}
        />
      )}
    >
      <div data-testid="diligence-file" className="space-y-3">
        <Link to={roomHref} className="text-[12px] font-semibold text-indigo-700 underline dark:text-indigo-300">
          {`‹ ${projectName || 'Back to the room'}`}
        </Link>

        {state === 'loading' && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] text-axal-muted">Loading this document.</p>
          </Card>
        )}

        {state === 'unreadable' && (
          <Card variant="dashed" padding="lg">
            <Unreadable what="This document" claim="Nothing is shown rather than a file with no facts." onRetry={load} />
          </Card>
        )}

        {state === 'gated' && (
          <div
            data-testid="file-behind-nda"
            className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30"
          >
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-amber-800 dark:text-amber-300">Behind an NDA</div>
            <h1 className="mt-1.5 text-[15px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">
              This document is behind an NDA. It is counted on the room page and not named here.
            </h1>
            <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
              {`Sign an NDA with ${projectName || 'this company'} and it appears in the room with the rest. `}
              Until then there is no name, no size, and no preview to show — the count on the room page
              is the whole of what this grant permits you to know.
            </p>
            <Link to={roomHref} className={`${ghostBtn} mt-3`}>‹ Back to the room</Link>
          </div>
        )}

        {state === 'missing_file' && (
          <Card padding="lg">
            <h1 className="text-[15px] font-extrabold tracking-tight">This document is not in the room.</h1>
            <p className="mt-1.5 text-[12.5px] text-axal-muted">The founder may have removed it.</p>
            <Link to={roomHref} className={`${ghostBtn} mt-3`}>‹ Back to the room</Link>
          </Card>
        )}

        {state === 'missing_room' && (
          <Card padding="lg">
            <h1 className="text-[15px] font-extrabold tracking-tight">This room is not open to you.</h1>
            <p className="mt-1.5 text-[12.5px] text-axal-muted">
              A grant is active or it is nothing — revoked and expired rooms do not appear in Diligence.
            </p>
            <Link to="/research/diligence" className={`${ghostBtn} mt-3`}>‹ Back to Diligence</Link>
          </Card>
        )}

        {state === 'ready' && file && (
          <>
            <Card>
              <div className={eyebrow}>Document</div>
              <h1 className="mt-1.5 break-words text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{file.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted">
                <span>{size ?? <Unrecorded />}</span>
                <span>·</span>
                <span>{file.content_type || <Unrecorded />}</span>
                <Pill tone={file.visibility === 'nda' ? 'warn' : 'neutral'}>
                  {file.visibility === 'nda' ? 'NDA · signed' : 'Open to invited'}
                </Pill>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className={primaryBtn} onClick={download} disabled={busy}>
                  {busy ? 'Issuing link…' : 'Download'}
                </button>
                <span className="text-[11.5px] text-axal-muted">
                  Single-use link, expires after two minutes. Not watermarked. The founder sees that you opened it.
                </span>
              </div>
              {notice ? <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300">{notice}</p> : null}
            </Card>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card>
                <div className={eyebrow}>Size</div>
                <div className="mt-1.5 font-mono text-[18px] font-bold">{size ?? <Unrecorded />}</div>
                <p className="mt-1 text-[11.5px] text-axal-muted">{file.content_type || 'type not recorded'}</p>
              </Card>
              <Card>
                <div className={eyebrow}>Last downloaded by you</div>
                <div className="mt-1.5 font-mono text-[15px] font-bold">
                  {data.last_downloaded_at ? day(data.last_downloaded_at) : <Unrecorded />}
                </div>
                <p className="mt-1 text-[11.5px] text-axal-muted">
                  {data.downloads.length
                    ? `${data.downloads.length} ${data.downloads.length === 1 ? 'link' : 'links'} issued`
                    : 'you have not downloaded it'}
                </p>
              </Card>
              <Card>
                <div className={eyebrow}>Room</div>
                <Link to={roomHref} className="mt-1.5 block text-[15px] font-bold text-indigo-700 hover:underline dark:text-indigo-300">
                  {data.room.project_name}
                </Link>
                <p className="mt-1 text-[11.5px] text-axal-muted">back to the grant and its counts</p>
              </Card>
            </div>

            <Card data-testid="file-downloads">
              <div className="flex items-baseline justify-between gap-3">
                <span className={eyebrow}>Your downloads of this file</span>
                <span className="text-[11px] text-axal-muted">this document only, not the room</span>
              </div>
              {data.downloads.length ? (
                <ul className="mt-2.5 space-y-1.5">
                  {data.downloads.map((d, i) => (
                    <li key={`${d}-${i}`} className="flex flex-wrap items-baseline gap-2.5 text-[12px]">
                      <span className="w-[130px] shrink-0 text-[11px] text-axal-muted">{when(d)}</span>
                      <Pill tone="neutral">download</Pill>
                      <span className="text-axal-muted">link issued to you</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 text-[12px]">
                  <Unrecorded /> <span className="ml-1 text-axal-muted">You have not downloaded this file</span>
                </p>
              )}
              <p className="mt-2.5 text-[11px] text-axal-muted">{data.download_note}</p>
            </Card>
          </>
        )}

        <StatedLimit title="What this page will not do">
          This page does not OCR, summarise, or attach the file to a deal. There is no preview here
          because the product has none — a download is a single-use link, and what the document says is
          between you and the file.
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
