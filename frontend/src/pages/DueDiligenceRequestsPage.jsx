import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, Link as LinkIcon, Send } from 'lucide-react';
import { api, dd } from '../lib/api';
import { reportError } from '../lib/log';
// Lightbox and Unreadable from their own modules: the `../ui` barrel also exports the rail, and this page draws none.
import Lightbox from '../ui/Lightbox';
import { Unreadable } from '../ui/Honesty';
import { answerBody, dueOf, fileChoices, fmtDay, requestChips, requestWord } from './duediligence/ddReviewModel';

// Build queue #128 — the subject-facing half of the DD request list. This is
// the ONLY diligence surface a subject ever sees: the requests addressed to
// them, nothing about the case itself — no score, no sections, no findings.
// Backed by GET /api/dd/requests/mine + PATCH /api/dd/requests/:id/respond,
// both auth'd by subject-resolution rather than role.
//
// D1252 (#3267, DDL15): each request's due date (D1248), late while it waits;
// chips that filter by state; and an answer with a note, a link, or a file
// picked from the subject's own data room (`project_uid`, the venture the
// request is addressed to; the data-room routes check ownership again).
// Every tap target is at least 44px on a phone (DDL18).

const PILL = {
  requested: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  received: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  reviewed: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
};
const CARD = 'rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-800';
const INPUT = 'w-full rounded-lg border border-axal-hairline bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 sm:min-h-[36px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[13px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60 sm:min-h-[36px] dark:bg-violet-500 dark:hover:bg-violet-400';
const MUTED = 'text-axal-muted dark:text-gray-400';
const todayIso = () => new Date().toISOString().slice(0, 10);

/** The subject's own data room, to pick one file as the answer. */
function FilePicker({ projectUid, readRoom, onPick, onClose }) {
  const [read, setRead] = useState({ status: 'loading', files: [] });
  const [tick, setTick] = useState(0);
  const [choice, setChoice] = useState(null);
  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading', files: [] });
    Promise.resolve().then(() => readRoom(projectUid))
      .then((room) => { if (alive) setRead({ status: 'ready', files: fileChoices(room) }); })
      .catch((e) => { reportError('DueDiligenceRequestsPage:room', e); if (alive) setRead({ status: 'unreadable', files: [] }); });
    return () => { alive = false; };
  }, [projectUid, readRoom, tick]);
  return (
    <Lightbox label="Pick a file from your data room" title="Pick a file from your data room" sub="The team sees this file with your answer. It stays in your data room." phone="sheet" width={480} onClose={onClose} testId="dd-request-files"
      footer={(
        <div className="flex justify-end gap-2 max-sm:*:flex-1">
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={!choice} onClick={() => onPick(read.files.find((f) => f.uid === choice))} data-testid="dd-request-files-use">Use this file</button>
        </div>
      )}>
      <div className="flex flex-col gap-1 px-5 py-4">
        {read.status === 'loading' && <p className={`m-0 text-sm ${MUTED}`} aria-busy="true">Reading your data room…</p>}
        {read.status === 'unreadable' && <Unreadable what="Your data room" claim="This is not a claim that it is empty." onRetry={() => setTick((t) => t + 1)} />}
        {read.status === 'ready' && !read.files.length && <p className={`m-0 text-sm ${MUTED}`} data-testid="dd-request-files-empty">Your data room has no file yet. Upload it there, then pick it here.</p>}
        {read.status === 'ready' && read.files.map((f) => (
          <label key={f.uid} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-gray-100" data-testid={`dd-request-file-${f.uid}`}>
            <input type="radio" name="dd-request-file" checked={choice === f.uid} onChange={() => setChoice(f.uid)} data-testid={`dd-request-file-pick-${f.uid}`} />
            <FileText size={14} className="flex-none text-axal-muted dark:text-gray-400" aria-hidden="true" />{f.name}
          </label>
        ))}
      </div>
    </Lightbox>
  );
}

function RequestCard({ req, today, onRespond, readRoom }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(req.response_note || '');
  const [url, setUrl] = useState(req.response_url || '');
  const [file, setFile] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A subject may amend an answer until the team marks it reviewed.
  const actionable = req.state !== 'reviewed';
  const due = dueOf(req, today);
  const files = Array.isArray(req.file_names) ? req.file_names : [];

  const submit = async (e) => {
    e?.preventDefault?.();
    const out = answerBody({ note, url, fileUid: file?.uid });
    if (out.error) { setError(out.error); return; }
    setBusy(true); setError('');
    try { await onRespond(out.body); setOpen(false); setFile(null); }
    catch (err) { setError(err?.message || 'The answer could not be sent.'); }
    finally { setBusy(false); }
  };

  return (
    <div className={CARD} data-testid={`dd-request-${req.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="text-[14.5px] font-bold text-gray-900 dark:text-gray-100">{req.title}</div>
          {req.details && <div className={`mt-1 text-[13px] leading-relaxed ${MUTED}`}>{req.details}</div>}
        </div>
        <div className={`flex flex-wrap items-center gap-3 text-[12.5px] ${MUTED}`}>
          <span>Asked <span className="font-mono">{fmtDay(req.created_at) || 'on a date not recorded'}</span></span>
          <span className={due.late ? 'font-semibold text-amber-800 dark:text-amber-200' : ''} data-testid={`dd-request-due-${req.id}`}>{due.text}{due.late ? ` · ${due.late}` : ''}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${PILL[req.state] || PILL.requested}`}>{requestWord(req.state)}</span>
        </div>
      </div>

      {(req.response_note || req.response_url || files.length > 0) && (
        <div className={`mt-2 rounded bg-gray-50 p-2 text-xs dark:bg-gray-900/40 ${MUTED}`} data-testid={`dd-request-answer-${req.id}`}>
          <CheckCircle2 size={11} className="mr-1 inline text-emerald-600 dark:text-emerald-400" />
          You answered{req.responded_at ? ` on ${fmtDay(req.responded_at)}` : ''}
          {req.response_url && (
            <a href={req.response_url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 break-all text-violet-700 hover:underline dark:text-violet-300">
              <LinkIcon size={10} /> {req.response_url}
            </a>
          )}
          {files.length > 0 && <span className="ml-1">· {files.length === 1 ? 'File' : 'Files'}: {files.join(', ')}</span>}
        </div>
      )}

      {actionable && !open && (
        <button type="button" onClick={() => setOpen(true)} className={`mt-3 ${PRIMARY} max-sm:w-full`} data-testid={`dd-request-open-${req.id}`}>
          <Send size={12} /> {req.state === 'received' ? 'Amend your answer' : 'Answer'}
        </button>
      )}
      {actionable && open && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-[10px] border border-axal-hairline bg-[#faf9fc] p-3.5 dark:border-gray-700 dark:bg-gray-900/40" data-testid={`dd-request-form-${req.id}`}>
          <label className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Your answer
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} className={`${INPUT} mt-1`} data-testid={`dd-request-note-${req.id}`} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">Link <span className={`font-normal ${MUTED}`}>· optional</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="Paste a link" className={`${INPUT} mt-1`} data-testid={`dd-request-url-${req.id}`} />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">File <span className={`font-normal ${MUTED}`}>· optional</span></span>
              {req.project_uid ? (
                file ? (
                  <span className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-900 dark:text-gray-100" data-testid={`dd-request-picked-${req.id}`}>
                    <FileText size={14} aria-hidden="true" />{file.name}
                    <button type="button" className="ml-auto text-[12.5px] font-semibold text-violet-700 dark:text-violet-300" onClick={() => setFile(null)}>Remove</button>
                  </span>
                ) : <button type="button" className={`${BTN} w-full`} onClick={() => setPicking(true)} data-testid={`dd-request-pick-${req.id}`}><FileText size={14} aria-hidden="true" />Pick a file from your data room</button>
              ) : <span className={`text-[12px] ${MUTED}`} data-testid={`dd-request-no-room-${req.id}`}>A data-room file answers a request made of a startup. Paste a link instead.</span>}
            </div>
          </div>
          {error && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid={`dd-request-error-${req.id}`}>{error}</p>}
          <div className="flex justify-end gap-2 max-sm:*:flex-1">
            <button type="button" onClick={() => { setOpen(false); setError(''); }} className={BTN}>Cancel</button>
            <button type="submit" disabled={busy} className={PRIMARY} data-testid={`dd-request-send-${req.id}`}>{busy ? 'Sending…' : 'Send answer'}</button>
          </div>
        </form>
      )}
      {picking && <FilePicker projectUid={req.project_uid} readRoom={readRoom} onClose={() => setPicking(false)} onPick={(f) => { setFile(f || null); setPicking(false); }} />}
    </div>
  );
}

export default function DueDiligenceRequestsPage({ load = dd.myRequests, respond = dd.respondRequest, readRoom = api.dataRoom, today = todayIso() }) {
  const [read, setRead] = useState({ status: 'loading', items: [] });
  const [filter, setFilter] = useState(null);
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    try {
      const r = await load();
      setRead({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [] });
    } catch (e) {
      reportError('DueDiligenceRequestsPage:list', e);
      setRead({ status: 'unreadable', items: [] });
    }
  }, [load]);
  useEffect(() => { reload(); }, [reload]);

  const items = read.items;
  const chips = requestChips(items);
  const shown = filter ? items.filter((r) => r.state === filter) : items;

  return (
    <div className="max-w-3xl" data-testid="dd-requests-page">
      <h1 className="m-0 text-2xl font-extrabold tracking-[-.02em] text-gray-900 dark:text-gray-100">Diligence requests</h1>
      <p className={`mb-4 mt-1.5 max-w-[640px] text-[13px] leading-relaxed ${MUTED}`}>
        The investment team needs these to complete its review. You see only what they asked, never the review itself.
      </p>

      {read.status === 'ready' && items.length > 0 && (
        <div className="mb-3.5 flex flex-wrap gap-[7px]" role="group" aria-label="Show" data-testid="dd-requests-chips">
          {chips.map((c) => (
            <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => setFilter(filter === c.key ? null : c.key)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-bold sm:min-h-[34px] ${filter === c.key
                ? 'border-violet-600 bg-violet-50 text-gray-900 dark:border-violet-400 dark:bg-violet-950/40 dark:text-gray-100'
                : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`} data-testid={`dd-requests-chip-${c.key}`}>
              {c.label} <span className="font-mono">{c.n}</span>
            </button>
          ))}
        </div>
      )}

      {notice && <p role="status" className="mb-3 text-[13px] text-emerald-800 dark:text-emerald-300" data-testid="dd-requests-notice">{notice}</p>}
      {read.status === 'loading' && <div className={`py-10 text-center text-sm ${MUTED}`} aria-busy="true">Reading your requests…</div>}
      {read.status === 'unreadable' && <div className={CARD} data-testid="dd-requests-unreadable"><Unreadable what="Your requests" claim="This is not a claim that you have none." onRetry={reload} /></div>}
      {read.status === 'ready' && items.length === 0 && (
        <div className={`${CARD} p-10 text-center text-sm ${MUTED}`} data-testid="dd-requests-empty">
          No open requests. When an investor or partner running diligence needs something from you, it appears here and you are told.
        </div>
      )}

      <div className="space-y-2.5">
        {shown.map((r) => (
          <RequestCard key={r.id} req={r} today={today} readRoom={readRoom}
            onRespond={async (body) => {
              await respond(r.id, body);
              setNotice('Your answer is sent. The team sees it on the case.');
              await reload();
            }} />
        ))}
      </div>
    </div>
  );
}
