import React, { useState } from 'react';
import { SectionCard } from './LearningStates';
import { ErrorLine, Field, INPUT, PRIMARY, StatusActions } from './studioParts';
import { itemForm } from './studioActions';

const LEVELS = [['', 'Not set'], ['intro', 'Intro'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];

/**
 * Create or edit one video or reading, for the Super Admin (D562 stage 2;
 * `POST /api/admin/learning/items`, `PATCH …/items/:uid`, D557).
 *
 *   item     the stored item (the list sends every field), or null to create
 *   kind     'video' or 'reading', for a new item
 *   onSave(form), onStatus(action), busy, error, notice
 *
 * A VIDEO IS A LINK. The route takes https links from YouTube, Vimeo and
 * Cloudflare Stream and refuses an upload (`video_upload_not_built`), so the
 * upload control is drawn disabled, with its line, until #1162 builds the
 * path. What the route refuses is shown in the route's own words (`error`).
 *
 * The page keys this editor on the item, so opening another one starts from
 * that item's stored fields rather than from the last one's edits.
 */
export default function StudioItemEditor({ item, kind, onSave, onStatus, busy = false, error = '', notice = '' }) {
  const [form, setForm] = useState(() => itemForm(item));
  const isVideo = (item?.kind || kind) === 'video';
  const noun = isVideo ? 'video' : 'reading';
  const id = (name) => `studio-item-${name}`;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  return (
    <SectionCard title={item ? `Edit ${noun}` : `New ${noun}`} meta={item ? `uid ${item.uid}` : 'created as a draft'} testid="studio-item-editor">
      {item && <div className="mb-4"><StatusActions status={item.status} what={noun} onStatus={onStatus} busy={busy} /></div>}
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
            <Field id={id('video')} label="Video link" hint="https, from YouTube, Vimeo or Cloudflare Stream." full>
              <input id={id('video')} type="url" className={INPUT} value={form.video_url} onChange={set('video_url')} placeholder="https://www.youtube.com/watch?v=…" data-testid="input-item-video-url" />
            </Field>
            <Field id={id('upload')} label="Or upload a file" full>
              <input id={id('upload')} type="file" accept="video/mp4,video/webm" disabled className="block text-[12.5px] text-axal-faint dark:text-gray-500" data-testid="input-item-upload" />
              <p className="mt-1 text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="studio-upload-not-live">
                Uploading a video file is not live yet. Paste a link instead.
              </p>
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
          <button type="submit" className={PRIMARY} disabled={busy} data-testid="button-item-save">
            {busy ? 'Saving…' : item ? 'Save changes' : 'Create draft'}
          </button>
          {notice && <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
        </div>
        <div className="sm:col-span-2"><ErrorLine error={error} /></div>
      </form>
    </SectionCard>
  );
}
