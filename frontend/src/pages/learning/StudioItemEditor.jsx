import React, { useEffect, useRef, useState } from 'react';
import { Pill } from '../../ui';
import { SectionCard } from './LearningStates';
import { ErrorLine, Field, INPUT, PRIMARY, SECONDARY, StatusActions } from './studioParts';
import { itemForm, uploadVideo } from './studioActions';
import {
  IDLE_UPLOAD, VIDEO_ACCEPT, VIDEO_LIMITS_LINE, chooseVideoFile, formAfterUpload, formatBytes, shownItem,
  storedAfterUpload, uploadFailure, uploadPercent,
} from './videoUpload';

const LEVELS = [['', 'Not set'], ['intro', 'Intro'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];

/** Why a new video's file cannot be chosen yet: the upload routes take the item's uid. */
export const UPLOAD_NEEDS_DRAFT = 'Create the draft first, then upload its file.';

/**
 * Create or edit one video or reading, for the Super Admin (D562 stage 2;
 * `POST /api/admin/learning/items`, `PATCH …/items/:uid`, D557; a video's
 * file, D561).
 *
 *   item        the stored item (the list sends every field), or null to create
 *   kind        'video' or 'reading', for a new item
 *   onSave(form), onStatus(action), busy, error, notice
 *   onUploaded(item)  optional: the item as stored after an upload, for the
 *               page's own list; the editor draws it either way
 *
 * A VIDEO IS A LINK OR AN UPLOADED FILE (D561), and each replaces the other:
 *   - an upload attaches the file and clears the link, so the form's link is
 *     cleared with it (`formAfterUpload`), or saving would send the old link
 *     back over the file;
 *   - saving a link replaces an uploaded file;
 *   - saving with the link empty leaves an uploaded file where it is.
 * The file goes up in parts through D561's routes (`uploadVideo`), MP4 or
 * WebM and at most 2 GB, and a file outside those limits is refused before
 * anything is sent. A new video has no uid yet, so its file is uploaded once
 * the draft exists. While a file is on its way, saving and the status actions
 * wait. Publishing a video with neither a link nor a file is the route's
 * refusal (`no_video`), shown in its own words like every other (`error`).
 *
 * The page keys this editor on the item, so opening another one starts from
 * that item's stored fields rather than from the last one's edits.
 */
export default function StudioItemEditor({ item, kind, onSave, onStatus, onUploaded, busy = false, error = '', notice = '' }) {
  const [form, setForm] = useState(() => itemForm(item));
  const [upload, setUpload] = useState(IDLE_UPLOAD);
  // The item as stored after this editor's own upload, until the page hands
  // it a newer item: a save or a status change answers with the stored row.
  const [uploaded, setUploaded] = useState(null);
  const latest = useRef(item);
  const running = useRef(null);
  useEffect(() => { latest.current = item; });
  // Leaving the editor stops an upload: the part on its way finishes, then the upload is closed.
  useEffect(() => () => { if (running.current) running.current.cancelled = true; }, []);

  const current = shownItem(item, uploaded);
  const isVideo = (item?.kind || kind) === 'video';
  const noun = isVideo ? 'video' : 'reading';
  const sending = upload.phase === 'uploading' || upload.phase === 'cancelling';
  const id = (name) => `studio-item-${name}`;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));

  const startUpload = async () => {
    const file = upload.file;
    if (!item?.uid || !file) return;
    const token = { cancelled: false };
    running.current = token;
    try {
      await runVideoUpload({
        uid: item.uid, file, token, latestItem: () => latest.current, setUpload, setUploaded, setForm, onUploaded,
      });
    } finally {
      if (running.current === token) running.current = null;
    }
  };
  const cancelUpload = () => {
    if (running.current) running.current.cancelled = true;
    setUpload(cancelling);
  };

  return (
    <SectionCard title={item ? `Edit ${noun}` : `New ${noun}`} meta={item ? `uid ${item.uid}` : 'created as a draft'} testid="studio-item-editor">
      {item && <div className="mb-4"><StatusActions status={current.status} what={noun} onStatus={onStatus} busy={busy || sending} /></div>}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => { event.preventDefault(); onSave(form); }}
        data-testid="form-studio-item"
      >
        <Field id={id('title')} label="Title" full>
          <input id={id('title')} className={INPUT} value={form.title} onChange={set('title')} data-testid="input-item-title" />
        </Field>
        <Field id={id('summary')} label="Summary" full>
          <textarea id={id('summary')} rows={2} className={INPUT} value={form.summary} onChange={set('summary')} />
        </Field>
        {isVideo ? (
          <>
            <VideoFileField
              id={id('upload')}
              hasUpload={current?.video_source === 'r2'}
              hasLink={Boolean(String(current?.video_url ?? '').trim())}
              upload={upload}
              blocked={item?.uid ? '' : UPLOAD_NEEDS_DRAFT}
              busy={busy}
              onChoose={(file) => setUpload(chooseVideoFile(file))}
              onStart={startUpload}
              onCancel={cancelUpload}
            />
            <Field
              id={id('video')}
              label="Or paste a link"
              hint={`https, from YouTube, Vimeo or Cloudflare Stream.${current?.video_source === 'r2' ? ' Saving a link replaces the uploaded file.' : ''}`}
              full
            >
              <input id={id('video')} type="url" className={INPUT} value={form.video_url} onChange={set('video_url')} placeholder="https://www.youtube.com/watch?v=…" data-testid="input-item-video-url" />
            </Field>
            <Field id={id('transcript')} label="Transcript" hint="Shown under the video. Leave it empty and the page says none is recorded." full>
              <textarea id={id('transcript')} rows={4} className={INPUT} value={form.transcript} onChange={set('transcript')} />
            </Field>
          </>
        ) : (
          <Field id={id('body')} label="Text" hint="Markdown." full>
            <textarea id={id('body')} rows={10} className={INPUT} value={form.body} onChange={set('body')} data-testid="input-item-body" />
          </Field>
        )}
        <Field id={id('length')} label="Length" hint="Minutes, or minutes and seconds as 12:05.">
          <input id={id('length')} className={INPUT} value={form.length} onChange={set('length')} inputMode="numeric" data-testid="input-item-length" />
        </Field>
        <Field id={id('thumbnail')} label="Thumbnail link" hint="https.">
          <input id={id('thumbnail')} type="url" className={INPUT} value={form.thumbnail_url} onChange={set('thumbnail_url')} />
        </Field>
        <Field id={id('topic')} label="Topic">
          <input id={id('topic')} className={INPUT} value={form.topic} onChange={set('topic')} />
        </Field>
        <Field id={id('level')} label="Level">
          <select id={id('level')} className={INPUT} value={form.level} onChange={set('level')}>
            {LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field id={id('visibility')} label="Visibility" hint="Program-only content stays hidden from members until programs are live." full>
          <select id={id('visibility')} className={INPUT} value={form.visibility} onChange={set('visibility')}>
            <option value="open">Open to every member</option>
            <option value="program">Program-only</option>
          </select>
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={PRIMARY} disabled={busy || sending} data-testid="button-item-save">
            {busy ? 'Saving…' : item ? 'Save changes' : 'Create draft'}
          </button>
          {sending && <span className="text-[12px] text-axal-muted dark:text-gray-400">Saving waits for the upload to finish.</span>}
          {notice && <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
        </div>
        <div className="sm:col-span-2"><ErrorLine error={error} /></div>
      </form>
    </SectionCard>
  );
}

/** "Cancel upload" pressed: the upload stops before its next part (the token), and the field says so. */
export const cancelling = (s) => (s.phase === 'uploading' ? { ...s, phase: 'cancelling' } : s);

/**
 * One upload, from "Upload" to its outcome, as the editor's state. The
 * progress is merged in part by part (and a cancel already asked for stays
 * asked for); then either the item as stored is drawn, the form's link is
 * cleared and the page is told (`onUploaded`), or the field says why the
 * upload stopped, in the words it stopped with. Exported so the sequence can
 * be read without a browser.
 *
 *   token        { cancelled }, set by "Cancel upload" and by leaving the editor
 *   latestItem() the item the page hands the editor now
 */
export async function runVideoUpload({ uid, file, token, latestItem, setUpload, setUploaded, setForm, onUploaded }) {
  setUpload({ phase: 'uploading', file, sent: 0, total: file.size, part: 0, parts: null, step: 'start' });
  try {
    const done = await uploadVideo({
      uid,
      file,
      onProgress: (p) => setUpload((s) => (s.phase === 'uploading' || s.phase === 'cancelling' ? { ...s, ...p } : s)),
      isCancelled: () => token.cancelled,
    });
    const from = latestItem();
    const row = storedAfterUpload(from, done);
    setUploaded({ from, row });
    setForm(formAfterUpload);
    setUpload({ phase: 'done', file, attached: done.attached });
    onUploaded?.(row);
  } catch (err) {
    setUpload(uploadFailure(err, file));
  }
}

/** What the item plays now, as the canvas's "Source" row: a file, a link, or neither yet. */
function SourceLine({ hasUpload, hasLink }) {
  const [tone, label, line] = hasUpload
    ? ['ok', 'Uploaded file', 'This video plays its uploaded file.']
    : hasLink
      ? ['info', 'Link', 'This video plays its link. Uploading a file replaces the link.']
      : ['warn', 'No video yet', 'Upload a file or save a link: a video with neither cannot be published.'];
  return (
    <p className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="studio-video-source">
      <Pill tone={tone}>{label}</Pill>
      <span>{line}</span>
    </p>
  );
}

/**
 * The video's file (D561): what the item plays now, the route's limits, the
 * file input, and an upload's progress or outcome. Drawn from props, so each
 * state of an upload reads on its own.
 *
 *   hasUpload, hasLink   what the item as stored plays
 *   upload               the field's state (`videoUpload.js`): { phase, file,
 *                        sent, total, part, parts, step, message, attached }
 *   blocked              why no file can be chosen now (a video not yet created), or ''
 *   busy                 the editor is saving
 *   onChoose(file), onStart(), onCancel()
 *
 * The progress moves part by part: the client's PUT reports no bytes until a
 * part has gone, so the line names the part on its way as well as the bytes
 * already sent. A refusal, the route's or this page's, is shown as it came.
 */
export function VideoFileField({ id, hasUpload, hasLink, upload, blocked = '', busy = false, onChoose, onStart, onCancel }) {
  const { phase, file } = upload;
  const sending = phase === 'uploading' || phase === 'cancelling';
  const canStart = Boolean(file) && !blocked && ['ready', 'failed', 'cancelled'].includes(phase);
  const percent = uploadPercent(upload);
  return (
    <Field id={id} label="Video file" full>
      <SourceLine hasUpload={hasUpload} hasLink={hasLink} />
      <input
        id={id}
        type="file"
        accept={VIDEO_ACCEPT}
        disabled={Boolean(blocked) || sending || busy}
        onChange={(event) => onChoose?.(event.target.files?.[0] || null)}
        aria-describedby={`${id}-limits`}
        className="block w-full text-[12.5px] text-axal-ink disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200"
        data-testid="input-item-upload"
      />
      <p id={`${id}-limits`} className="mt-1 text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="studio-upload-limits">
        {blocked ? `${blocked} ${VIDEO_LIMITS_LINE}` : VIDEO_LIMITS_LINE}
      </p>
      {file && (phase === 'ready' || phase === 'failed' || phase === 'cancelled' || sending) && (
        <p className="mt-2 text-[12.5px] text-axal-ink dark:text-gray-200" data-testid="studio-upload-file">
          {file.name || 'The chosen file'} · {formatBytes(file.size)}
        </p>
      )}
      {sending && (
        <div className="mt-2 space-y-1.5" data-testid="studio-upload-progress">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full rounded-full bg-axal-violet" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-[12px] text-axal-muted dark:text-gray-400" role="status">
            {phase === 'cancelling'
              ? 'Cancelling: the part on its way finishes, then the upload is closed.'
              : upload.step === 'complete'
                ? 'Attaching the file: the server checks its size and type.'
                : upload.parts
                  ? `Sending part ${Math.min((upload.part || 0) + 1, upload.parts)} of ${upload.parts} · ${formatBytes(upload.sent)} of ${formatBytes(upload.total)} sent (${percent}%)`
                  : 'Starting the upload…'}
          </p>
          <p className="text-[11.5px] text-axal-faint dark:text-gray-500">Keep this page open until the upload finishes.</p>
        </div>
      )}
      {(phase === 'refused' || phase === 'failed') && <div className="mt-2"><ErrorLine error={upload.message} testid="studio-upload-error" /></div>}
      {phase === 'cancelled' && (
        <p className="mt-2 text-[12.5px] text-axal-muted dark:text-gray-400" role="status" data-testid="studio-upload-cancelled">
          Cancelled. The upload was closed, and nothing was attached.
        </p>
      )}
      {phase === 'done' && hasUpload && (
        <p className="mt-2 text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status" data-testid="studio-upload-done">
          Uploaded and attached: {file?.name || 'the file'}, {formatBytes(upload.attached?.size_bytes ?? file?.size)}.
        </p>
      )}
      {(canStart || sending) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canStart && (
            <button type="button" className={PRIMARY} onClick={onStart} disabled={busy} data-testid="button-upload-start">
              {phase === 'ready' ? 'Upload' : 'Try again'}
            </button>
          )}
          {sending && (
            <button type="button" className={SECONDARY} onClick={onCancel} disabled={phase === 'cancelling' || upload.step === 'complete'} data-testid="button-upload-cancel">
              Cancel upload
            </button>
          )}
        </div>
      )}
    </Field>
  );
}
