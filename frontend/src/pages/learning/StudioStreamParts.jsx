/**
 * The studio's video on Cloudflare Stream (#4177, L2 of #3726, on L1's routes
 * in `routes/learning_stream.ts`, D4176): the video file field in every state
 * (boards lr14, lr14b, lr20e), and under it the thumbnail picker, the captions
 * and the chapters editor (lr15). `StudioItemEditor` mounts `StreamStudio` for
 * a stored video item.
 *
 * NOTHING IS DRAWN BEFORE THE ROUTES ANSWER. `StreamStudio` reads
 * `GET …/items/:uid/stream` first, and until it answers the field says it is
 * reading and offers no control. A 503 `stream_unavailable` (Stream not on)
 * draws D561's R2 field instead, through `renderOff`; any other failure is
 * unreadable, never "no video". The chapters are read once the Stream read
 * has answered, from the item read, which sends them.
 *
 * Each part below `StreamStudio` is drawn from props, so every state reads on
 * its own. The words and rules are `videoUpload.js`'s; the calls are
 * `studioActions.js`'s. A refusal is shown in the route's own words.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Plus, Upload, X } from 'lucide-react';
import { Pill } from '../../ui';
import { LearningUnreadable } from './LearningStates';
import { ConfirmRow, ErrorLine, INPUT, PRIMARY, SECONDARY } from './studioParts';
import {
  deleteCaptions, generateCaptions, readItemChapters, readStreamStatus, saveChapters, setStreamThumbnail,
  uploadCaptionFile, uploadToStream,
} from './studioActions';
import {
  CAPTION_LANGUAGES, CHAPTERS_HINT, CHAPTER_LIMIT, STREAM_ACCEPT, STREAM_IDLE, STREAM_LIMITS_LINE, STREAM_UPLOAD,
  THUMB_STEPS, UPLOAD_CANCELLED, captionRows, chapterProblem, chapterRows, currentStreamVideo, formatClock, frameUrl,
  nextChapter, readyLine, streamField, streamFileProblem, streamPollMs, thumbLabel,
} from './videoUpload';

const TAP = 'max-sm:min-h-11';
const CARD = 'rounded-axal-md border border-axal-hairline p-3 dark:border-gray-800';
const HEAD = 'text-[13px] font-semibold text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';

/** The words the field says while the Stream read has not answered. */
export const STREAM_READING = 'Reading the video’s Stream state…';

/** A file button: the label is the control, the input inside it is hidden. */
function FilePick({ id, label, accept, onPick, disabled, className = SECONDARY, testid }) {
  return (
    <label htmlFor={id} className={`${className} ${TAP} cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50`} data-testid={testid}>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => { const f = event.target.files?.[0] || null; event.target.value = ''; if (f) onPick?.(f); }}
      />
      {label}
    </label>
  );
}

/**
 * The video file field (lr14 / lr14b / lr20e), from `streamField(...)`:
 *
 *   field      { kind, file, percent, protocol, video, message, cancelled }
 *   fileName   the file this editor last sent, for the ready row (the read does not send a name)
 *   onChoose(file), onCancel(), onRetry()   onRetry reads the Stream state again
 */
export function StreamVideoField({ id, field, fileName = '', busy = false, onChoose, onCancel, onRetry }) {
  const { kind } = field;
  const pick = (label, cls) => (
    <FilePick id={`${id}-file`} label={label} accept={STREAM_ACCEPT} onPick={onChoose} disabled={busy} className={cls} testid="button-stream-pick" />
  );
  let body;
  if (kind === 'reading') {
    body = <p className={MUTED} role="status" data-testid="stream-reading">{STREAM_READING}</p>;
  } else if (kind === 'unreadable') {
    body = <LearningUnreadable what="The video's Stream state" claim="This is not a claim that the video has no file." onRetry={onRetry} />;
  } else if (kind === 'uploading' || kind === 'cancelling') {
    body = (
      <div className="flex flex-wrap items-center gap-3" data-testid="stream-uploading">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[12.5px] text-axal-ink dark:text-gray-200">
            <span className="truncate">{field.file?.name || 'The chosen file'} · {kind === 'cancelling' ? 'cancelling' : 'uploading'}</span>
            <span className="tabular-nums" data-testid="stream-upload-percent">{field.percent}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800"
            role="progressbar" aria-label={`${field.percent}% uploaded`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={field.percent}
          >
            <div className="h-full rounded-full bg-axal-violet" style={{ width: `${field.percent}%` }} />
          </div>
          <p className="text-[11.5px] text-axal-faint dark:text-gray-500">
            Keep this page open until the upload finishes.{field.protocol === 'tus' ? ' Over 200 MB, so it goes up resumably.' : ''}
          </p>
        </div>
        <button type="button" className={`${SECONDARY} ${TAP}`} onClick={onCancel} disabled={kind === 'cancelling'} data-testid="button-stream-cancel">
          Cancel upload
        </button>
      </div>
    );
  } else if (kind === 'processing') {
    body = (
      <div className="flex flex-wrap items-center gap-2" data-testid="stream-processing">
        <Loader2 size={15} className="animate-spin text-axal-violet dark:text-violet-300" aria-hidden="true" />
        <span className="text-[12.5px] text-axal-ink dark:text-gray-200" role="status">Stream is processing this video</span>
        <Pill tone="info">Processing</Pill>
        <span className="text-[11.5px] text-axal-faint dark:text-gray-500">Checked again every {STREAM_UPLOAD.pollMs / 1000} s.</span>
      </div>
    );
  } else if (kind === 'ready') {
    body = (
      <div className="flex flex-wrap items-center gap-2" data-testid="stream-ready">
        <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
        <span className="text-[12.5px] text-axal-ink dark:text-gray-200">{fileName || 'The video on Stream'}</span>
        <Pill tone="ok">{readyLine(field.video)}</Pill>
        {pick('Replace', `${SECONDARY} border-transparent`)}
      </div>
    );
  } else if (kind === 'failed') {
    body = (
      <div className="flex flex-wrap items-center gap-2" data-testid="stream-failed">
        <AlertTriangle size={15} className="text-red-600 dark:text-red-300" aria-hidden="true" />
        <span className="min-w-0 flex-1"><ErrorLine error={field.message} testid="stream-upload-error" /></span>
        {pick('Try again')}
      </div>
    );
  } else {
    body = (
      <label
        htmlFor={`${id}-drop`}
        className="flex cursor-pointer flex-wrap items-center gap-2 rounded-axal-md border border-dashed border-axal-hairline px-3 py-4 text-[12.5px] text-axal-muted hover:border-axal-violet/40 dark:border-gray-700 dark:text-gray-400"
        data-testid="stream-idle"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); const f = event.dataTransfer?.files?.[0]; if (f && !busy) onChoose?.(f); }}
      >
        <Upload size={15} aria-hidden="true" />
        <span>Drop a video here, or <span className="font-semibold text-axal-violet-deep underline dark:text-violet-300">browse</span> · {STREAM_LIMITS_LINE}</span>
        <input id={`${id}-drop`} type="file" accept={STREAM_ACCEPT} className="sr-only" disabled={busy} onChange={(event) => { const f = event.target.files?.[0] || null; event.target.value = ''; if (f) onChoose?.(f); }} data-testid="input-stream-file" />
      </label>
    );
  }
  return (
    <div className="sm:col-span-2" data-testid="stream-video-field">
      <p className="mb-1 block text-[12px] font-semibold text-axal-ink dark:text-gray-200">Video file</p>
      <div className={CARD}>{body}</div>
      {field.cancelled && kind !== 'uploading' && (
        <p className={`mt-1 ${MUTED}`} role="status" data-testid="stream-cancelled">Cancelled. Nothing was uploaded to Stream.</p>
      )}
    </div>
  );
}

/**
 * The thumbnail picker (lr15): a slider over the video, the frame at that
 * point when the poster address is known, and "Use this frame".
 *
 *   video      the ready video ({ duration_seconds, thumbnail_pct })
 *   posterUrl  the member read's signed poster, or null
 *   value      the slider's share, 0..1
 */
export function StreamThumbnail({ id, video, posterUrl, value, busy, error, notice, onChange, onUse }) {
  const frame = frameUrl(posterUrl, value, video?.duration_seconds);
  const label = thumbLabel(value, video?.duration_seconds);
  return (
    <section className={CARD} data-testid="stream-thumbnail" aria-labelledby={`${id}-head`}>
      <h3 id={`${id}-head`} className={HEAD}>Thumbnail</h3>
      <p className={MUTED}>Pick a frame as the poster.</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        {frame
          ? <img src={frame} alt={`The frame at ${label}`} className="h-24 w-40 flex-none rounded-axal-sm bg-axal-ground object-cover dark:bg-gray-800" data-testid="stream-thumbnail-frame" />
          : <div className="flex h-24 w-40 flex-none items-center justify-center rounded-axal-sm bg-axal-ground px-2 text-center text-[11px] text-axal-faint dark:bg-gray-800 dark:text-gray-500">No frame preview: the poster address is not available.</div>}
        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            id={id}
            type="range"
            min={0}
            max={THUMB_STEPS}
            value={Math.round((Number(value) || 0) * THUMB_STEPS)}
            onChange={(event) => onChange?.(Number(event.target.value) / THUMB_STEPS)}
            aria-label="Poster time"
            aria-valuetext={label}
            className="w-full accent-axal-violet"
            disabled={busy}
            data-testid="input-stream-thumbnail"
          />
          <div className="flex justify-between text-[11px] tabular-nums text-axal-faint dark:text-gray-500">
            <span>00:00</span>
            <span className="font-semibold text-axal-violet-deep dark:text-violet-300" data-testid="stream-thumbnail-at">{label}</span>
            <span>{formatClock(video?.duration_seconds) || 'Not recorded'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`${SECONDARY} ${TAP}`} onClick={() => onUse?.(value)} disabled={busy} data-testid="button-stream-thumbnail">Use this frame</button>
            {notice && <span className="text-[12px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
          </div>
          <ErrorLine error={error} testid="stream-thumbnail-error" />
        </div>
      </div>
    </section>
  );
}

/**
 * The captions (lr15): Generate ▾ by language, Upload VTT, and each row's
 * source and state, with Delete (asked first).
 *
 *   video   the ready video, whose `captions` the Stream read sends
 */
export function StreamCaptions({ id, video, busy, error, onGenerate, onUpload, onDelete }) {
  const [menu, setMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [language, setLanguage] = useState('en');
  const [confirm, setConfirm] = useState(null);
  const rows = captionRows(video);
  return (
    <section className={CARD} data-testid="stream-captions" aria-labelledby={`${id}-head`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-head`} className={`${HEAD} mr-auto`}>Captions</h3>
        <div className="relative">
          <button type="button" className={`${SECONDARY} ${TAP}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} disabled={busy} data-testid="button-captions-generate">
            Generate ▾
          </button>
          {menu && (
            <ul role="menu" aria-label="Generate captions in" className="absolute right-0 z-10 mt-1 max-h-64 w-44 overflow-auto rounded-axal-md border border-axal-hairline bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid="captions-generate-menu">
              {CAPTION_LANGUAGES.map(([tag, name]) => (
                <li key={tag} role="none">
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[12.5px] text-axal-ink hover:bg-axal-ground dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => { setMenu(false); onGenerate?.(tag); }}>
                    {name} <span className="tabular-nums text-axal-faint dark:text-gray-500">{tag}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className={`${SECONDARY} ${TAP}`} aria-expanded={uploading} onClick={() => setUploading((u) => !u)} disabled={busy} data-testid="button-captions-upload">Upload VTT</button>
      </div>
      {uploading && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="captions-upload-row">
          <label htmlFor={`${id}-lang`} className={MUTED}>Language</label>
          <select id={`${id}-lang`} className={`${INPUT} w-auto`} value={language} onChange={(event) => setLanguage(event.target.value)}>
            {CAPTION_LANGUAGES.map(([tag, name]) => <option key={tag} value={tag}>{name}</option>)}
          </select>
          <FilePick id={`${id}-vtt`} label="Choose a .vtt file" accept=".vtt,text/vtt" disabled={busy} onPick={(file) => onUpload?.(language, file)} testid="input-captions-vtt" />
        </div>
      )}
      {rows.length === 0 ? (
        <p className={`mt-2 ${MUTED}`} data-testid="captions-none">No captions yet. Generate them, or upload a WebVTT file.</p>
      ) : (
        <div role="table" aria-label="Captions" className="mt-2 divide-y divide-axal-hairline dark:divide-gray-800" data-testid="captions-rows">
          {rows.map((r) => (
            <div key={r.language} role="row" className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]" data-testid={`caption-row-${r.language}`}>
              <span role="cell" className="min-w-0 flex-1 text-axal-ink dark:text-gray-200">
                {r.name} <span className="tabular-nums text-axal-faint dark:text-gray-500">{r.language}</span>
                <span className="ml-2 text-axal-muted dark:text-gray-400">{r.source}</span>
              </span>
              <span role="cell"><Pill tone={r.tone}>{r.state}</Pill></span>
              <span role="cell">
                <button type="button" className="text-[12px] font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-300" onClick={() => setConfirm(r)} disabled={busy} data-testid={`button-caption-delete-${r.language}`}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {confirm && (
        <div className="mt-2">
          <ConfirmRow
            text={`Delete the ${confirm.name} captions? Members lose them at once.`}
            action="Delete"
            busy={busy}
            onConfirm={() => { const r = confirm; setConfirm(null); onDelete?.(r.language); }}
            onCancel={() => setConfirm(null)}
            testid="captions-confirm-delete"
          />
        </div>
      )}
      <div className="mt-2"><ErrorLine error={error} testid="captions-error" /></div>
    </section>
  );
}

/**
 * The chapters editor (lr15): Add, a start time and a title per row, remove,
 * and Save. Start times must increase; at most 100. The first problem is
 * named under the rows, and Save waits until there is none.
 *
 *   state   'loading' | 'unreadable' | 'ready'
 *   rows    [{ start: '03:40', title }]
 */
export function StreamChapters({ id, state, rows, busy, error, notice, onChange, onAdd, onRemove, onSave, onRetry }) {
  if (state === 'loading') return <section className={CARD} data-testid="stream-chapters"><p className={MUTED} role="status">Reading the chapters…</p></section>;
  if (state === 'unreadable') {
    return (
      <section className={CARD} data-testid="stream-chapters">
        <LearningUnreadable what="The chapters" claim="This is not a claim that the video has none." onRetry={onRetry} />
      </section>
    );
  }
  const list = rows || [];
  const problem = chapterProblem(list);
  const full = list.length >= STREAM_UPLOAD.maxChapters;
  return (
    <section className={CARD} data-testid="stream-chapters" aria-labelledby={`${id}-head`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h3 id={`${id}-head`} className={HEAD}>Chapters</h3>
          <p className={MUTED}>{CHAPTERS_HINT}</p>
        </div>
        <button type="button" className={`${SECONDARY} ${TAP}`} onClick={onAdd} disabled={busy || full} data-testid="button-chapter-add">
          <Plus size={13} aria-hidden="true" />Add
        </button>
      </div>
      {list.length === 0 ? (
        <p className={`mt-2 ${MUTED}`} data-testid="chapters-none">No chapters. Add one, or leave the video without chapters.</p>
      ) : (
        <ol className="mt-2 space-y-1.5" aria-label="Chapters" data-testid="chapters-rows">
          {list.map((c, i) => (
            <li key={i} className="flex items-center gap-2" data-testid={`chapter-row-${i}`}>
              <input
                aria-label={`Chapter ${i + 1} start`}
                className={`${INPUT} w-24 tabular-nums text-[12px] ${problem?.index === i ? 'border-red-400 dark:border-red-700' : ''}`}
                value={c.start}
                onChange={(event) => onChange?.(i, { ...c, start: event.target.value })}
                aria-invalid={problem?.index === i ? true : undefined}
                inputMode="numeric"
                placeholder="03:40"
              />
              <input aria-label={`Chapter ${i + 1} title`} className={`${INPUT} min-w-0 flex-1`} value={c.title} maxLength={STREAM_UPLOAD.chapterTitleMax} onChange={(event) => onChange?.(i, { ...c, title: event.target.value })} />
              <button type="button" className={`${SECONDARY} ${TAP} px-2`} onClick={() => onRemove?.(i)} aria-label={`Remove chapter ${i + 1}`} disabled={busy}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {full && <p className={`mt-2 ${MUTED}`} data-testid="chapters-full">{CHAPTER_LIMIT}</p>}
      {problem && <p className="mt-2 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="chapters-problem">{problem.index < list.length ? `Chapter ${problem.index + 1}: ` : ''}{problem.message}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={`${PRIMARY} ${TAP}`} onClick={onSave} disabled={busy || Boolean(problem)} data-testid="button-chapters-save">Save chapters</button>
        {notice && <span className="text-[12px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
      </div>
      <div className="mt-2"><ErrorLine error={error} testid="chapters-error" /></div>
    </section>
  );
}

/**
 * The Stream half of a stored video item's editor: the reads, the upload, the
 * 10-second poll while a video or a caption is on its way, and the parts
 * above. While Stream is off (503 `stream_unavailable`), `renderOff()` draws
 * D561's R2 field in its place.
 *
 *   uid             the stored item's uid
 *   renderOff()     the R2 field
 *   onBusy(bool)    an upload is on its way: the editor's Save and status actions wait
 *   initial, initialChapters   the reads' first states (a test draws a state without a browser);
 *                   with `initial`, nothing is read until a retry or a poll
 */
export default function StreamStudio({ uid, renderOff, onBusy, initial = null, initialChapters = null }) {
  const [read, setRead] = useState(initial || { status: 'loading' });
  const [upload, setUpload] = useState(STREAM_IDLE);
  const [sentName, setSentName] = useState('');
  const [chapters, setChapters] = useState(initialChapters || { status: 'loading', rows: [], poster_url: null });
  const [thumb, setThumb] = useState(null);
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  const [notices, setNotices] = useState({});
  const running = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; running.current?.abort(); }; }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await readStreamStatus(uid);
      if (alive.current) setRead(next);
    } catch (err) {
      if (alive.current) setRead({ status: 'unreadable', message: err?.message || '' });
    }
  }, [uid]);
  const readChapters = useCallback(async () => {
    setChapters((c) => ({ ...c, status: 'loading' }));
    try {
      const got = await readItemChapters(uid);
      if (alive.current) setChapters({ status: 'ready', rows: chapterRows(got.chapters), poster_url: got.poster_url });
    } catch {
      if (alive.current) setChapters((c) => ({ ...c, status: 'unreadable' }));
    }
  }, [uid]);

  useEffect(() => { if (!initial) refresh(); }, [refresh, initial]);
  const answered = read.status === 'ready';
  useEffect(() => { if (answered && !initialChapters) readChapters(); }, [answered, readChapters, initialChapters]);
  const poll = streamPollMs(read);
  useEffect(() => {
    if (!poll) return undefined;
    const t = setTimeout(refresh, poll);
    return () => clearTimeout(t);
  }, [poll, read, refresh]);

  const sending = upload.phase === 'uploading' || upload.phase === 'cancelling';
  useEffect(() => { onBusy?.(sending); }, [sending, onBusy]);

  const choose = async (file) => {
    const problem = streamFileProblem(file);
    if (problem) { setUpload({ phase: 'refused', file, message: problem }); return; }
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    running.current = controller;
    setUpload({ phase: 'uploading', file, sent: 0, total: file.size });
    try {
      await uploadToStream({
        uid, file, signal: controller?.signal,
        onProgress: (p) => alive.current && setUpload((s) => (s.phase === 'uploading' || s.phase === 'cancelling' ? { ...s, ...p } : s)),
      });
      if (!alive.current) return;
      setSentName(file.name || '');
      setUpload({ phase: 'sent', file });
      await refresh();
    } catch (err) {
      if (alive.current) setUpload(err?.code === UPLOAD_CANCELLED ? { phase: 'cancelled', file } : { phase: 'failed', file, message: err?.message || 'The upload could not be finished.' });
    } finally {
      if (running.current === controller) running.current = null;
    }
  };
  const cancel = () => {
    setUpload((s) => (s.phase === 'uploading' ? { ...s, phase: 'cancelling' } : s));
    running.current?.abort();
  };

  /** One action on the ready video: busy while it runs, its refusal in the route's words, then the Stream state read again. */
  const act = async (part, run, done) => {
    setBusy(part);
    setErrors((e) => ({ ...e, [part]: '' }));
    setNotices((n) => ({ ...n, [part]: '' }));
    try {
      const out = await run();
      if (!alive.current) return;
      if (done) setNotices((n) => ({ ...n, [part]: done }));
      return out;
    } catch (err) {
      if (alive.current) setErrors((e) => ({ ...e, [part]: err?.message || 'That did not go through.' }));
      return undefined;
    } finally {
      if (alive.current) setBusy('');
    }
  };

  const field = streamField({ read, upload });
  if (field.kind === 'off') {
    return (
      <>
        <p className={`sm:col-span-2 ${MUTED}`} data-testid="stream-off">{field.message || 'Video on Stream is not switched on yet.'} The file goes to storage as before.</p>
        {renderOff?.()}
      </>
    );
  }
  const video = answered ? currentStreamVideo(read.data) : null;
  const pct = thumb ?? (Number.isFinite(Number(video?.thumbnail_pct)) && video?.thumbnail_pct !== null ? Number(video.thumbnail_pct) : 0);
  const id = (name) => `studio-stream-${name}`;
  return (
    <>
      <StreamVideoField id={id('file')} field={field} fileName={sentName} busy={Boolean(busy)} onChoose={choose} onCancel={cancel} onRetry={refresh} />
      {answered && (
        <div className="grid gap-3 sm:col-span-2 lg:grid-cols-2" data-testid="stream-parts">
          {video && (
            <div className="space-y-3">
              <StreamThumbnail
                id={id('thumb')} video={video} posterUrl={chapters.poster_url} value={pct} busy={busy === 'thumb'}
                error={errors.thumb} notice={notices.thumb} onChange={setThumb}
                onUse={(value) => act('thumb', () => setStreamThumbnail(uid, value), 'Poster set.').then(refresh)}
              />
              <StreamCaptions
                id={id('captions')} video={video} busy={busy === 'captions'} error={errors.captions}
                onGenerate={(lang) => act('captions', () => generateCaptions(uid, lang)).then(refresh)}
                onUpload={(lang, file) => act('captions', () => uploadCaptionFile(uid, lang, file)).then(refresh)}
                onDelete={(lang) => act('captions', () => deleteCaptions(uid, lang)).then(refresh)}
              />
            </div>
          )}
          <StreamChapters
            id={id('chapters')} state={chapters.status} rows={chapters.rows} busy={busy === 'chapters'}
            error={errors.chapters} notice={notices.chapters} onRetry={readChapters}
            onChange={(i, row) => setChapters((c) => ({ ...c, rows: c.rows.map((r, j) => (j === i ? row : r)) }))}
            onAdd={() => setChapters((c) => (c.rows.length >= STREAM_UPLOAD.maxChapters ? c : { ...c, rows: [...c.rows, nextChapter(c.rows)] }))}
            onRemove={(i) => setChapters((c) => ({ ...c, rows: c.rows.filter((_, j) => j !== i) }))}
            onSave={() => act('chapters', () => saveChapters(uid, chapters.rows), 'Chapters saved.')}
          />
        </div>
      )}
    </>
  );
}
