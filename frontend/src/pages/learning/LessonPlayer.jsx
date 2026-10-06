import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Check, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Card, Pill, Unrecorded } from '../../ui';
import { LearningEmpty, LearningUnreadable, SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, durationLabel, lessonKindLabel } from './learningModel';

/**
 * One lesson, or one standalone video or reading: the media, a transcript
 * panel, previous and next, and "Mark complete" (D562; data D557, an uploaded
 * file's stream D561).
 *
 * Props, in the routes' shapes:
 *   status      'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   lesson      { uid, title, kind } from the course, or null for a standalone item
 *   item        `GET /api/learning/items/:uid`'s item: { uid, kind, title, body,
 *               duration_seconds, thumbnail_url, transcript, video_source, video_url,
 *               video_stream_url }
 *   video       how it plays (`videoPlayback`): { src, embed: true } in the
 *               platform's iframe, { src, embed: false } in the browser's own
 *               player (an uploaded file, from its gated stream route), or
 *               { reason, href } for a video this page cannot play
 *   transcript  the item's transcript text, or null when none is recorded
 *   moduleTitle, position ("5 of 12"), prev and next { title, href } or null
 *   completed   the member's own progress on it
 *   onMarkComplete, marking, markError
 *
 * "Mark complete" is disabled until a page passes the handler: a button that
 * looked live and saved nothing would be the dead control D17 refuses.
 */
export default function LessonPlayer({
  status, lesson, item, video, transcript = null, moduleTitle, position, prev, next,
  completed = false, onMarkComplete, marking = false, markError = '', reason = NOT_LIVE.catalogue, onRetry,
}) {
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the lesson',
    claim: 'This is not a claim that the lesson is empty.',
    isEmpty: !lesson && !item,
    empty: { title: 'No such lesson', body: 'This lesson does not exist, or it is not published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  if (block) return <SectionCard title="Lesson" testid="lesson-player">{block}</SectionCard>;

  const kind = lesson?.kind || item?.kind;
  const length = durationLabel(item?.duration_seconds);
  const text = String(transcript ?? '').trim();
  return (
    <div className="space-y-4" data-testid="lesson-player">
      <Card padding="none" className="overflow-hidden">
        {kind === 'video' ? <VideoArea video={video} item={item} length={length} /> : <ReadingArea body={item?.body} />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-axal-hairline px-4 py-3 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-axal-faint dark:text-gray-500">
              <Pill tone="info">{lessonKindLabel(kind)}</Pill>
              {moduleTitle && <span>{moduleTitle}</span>}
              {position && <span className="tabular-nums">· lesson {position}</span>}
              {length && <span className="tabular-nums">· {length}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lesson && <StepLink step={prev} dir="prev" />}
            {lesson && <StepLink step={next} dir="next" />}
            {completed ? (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="text-lesson-completed">
                <Check size={14} aria-hidden="true" /> Completed
              </span>
            ) : (
              <button
                type="button"
                onClick={onMarkComplete}
                disabled={!onMarkComplete || marking}
                title={onMarkComplete ? undefined : 'Progress cannot be saved here.'}
                className="rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-mark-complete"
              >
                {marking ? 'Saving…' : 'Mark complete'}
              </button>
            )}
          </div>
        </div>
        {markError && (
          <p className="border-t border-axal-hairline px-4 py-2 text-[12px] text-red-700 dark:border-gray-800 dark:text-red-300" role="alert" data-testid="text-mark-error">
            {markError}
          </p>
        )}
      </Card>
      {kind === 'video' && (
        <SectionCard title="Transcript" testid="lesson-transcript">
          {text ? (
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-gray-300" data-testid="lesson-transcript-text">{text}</p>
          ) : (
            <p className="text-[12.5px] text-axal-muted dark:text-gray-400">
              <Unrecorded reason="No transcript is recorded for this video." /> · No transcript is recorded for this video.
            </p>
          )}
        </SectionCard>
      )}
    </div>
  );
}

function VideoArea({ video, item, length }) {
  if (!video?.src) {
    const why = video?.reason || 'This video has no playable source yet.';
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-axal-ground px-6 text-center text-[12.5px] text-axal-muted dark:bg-gray-950 dark:text-gray-400" data-testid="lesson-video-absent">
        <span><Unrecorded reason={why} /> · {why}</span>
        {video?.href && (
          <a href={video.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-axal-violet-deep underline dark:text-violet-300" data-testid="link-video-elsewhere">
            Open the video <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }
  if (video.embed) {
    return (
      <iframe
        src={video.src}
        title={item?.title || 'Lesson video'}
        className="aspect-video w-full border-0 bg-black"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        data-testid="lesson-video-embed"
      />
    );
  }
  // Keyed by its file, so a failure shown for one video never stands in for the next.
  return (
    <StreamPlayer
      key={video.src}
      src={video.src}
      poster={item?.thumbnail_url || undefined}
      label={`${item?.title || 'Lesson video'}${length ? `, ${length}` : ''}`}
    />
  );
}

/**
 * An uploaded file in the browser's own player (D561). `src` is the item's
 * gated stream route: the session cookie authenticates it and it answers
 * Range, so the player fetches the metadata first and seeks without loading
 * the whole file. A load that fails (the route refused it, the file is gone,
 * the connection dropped) is "Unreadable", never a black box that never
 * starts, and Retry loads it again.
 */
function StreamPlayer({ src, poster, label }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return <VideoUnreadable onRetry={() => { setFailed(false); setAttempt((n) => n + 1); }} />;
  return (
    <video
      key={attempt}
      controls
      playsInline
      preload="metadata"
      src={src}
      poster={poster}
      onError={() => setFailed(true)}
      className="aspect-video w-full bg-black"
      aria-label={label}
      data-testid="lesson-video"
    />
  );
}

/** The player's place when its file could not be loaded: a failed read, not an absent video. */
export function VideoUnreadable({ onRetry }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center bg-axal-ground px-6 dark:bg-gray-950" data-testid="lesson-video-unreadable">
      <LearningUnreadable what="The video" claim="This is not a claim that the video is gone." onRetry={onRetry} />
    </div>
  );
}

function ReadingArea({ body }) {
  const text = String(body ?? '').trim();
  if (!text) {
    return (
      <div className="p-4">
        <LearningEmpty title="No text yet" body="This reading has no text published yet." />
      </div>
    );
  }
  return (
    <article className="prose prose-sm max-w-none p-5 dark:prose-invert" data-testid="lesson-reading">
      <ReactMarkdown>{text}</ReactMarkdown>
    </article>
  );
}

function StepLink({ step, dir }) {
  const label = dir === 'prev' ? 'Previous' : 'Next';
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  const cls = 'inline-flex items-center gap-1 rounded-axal-sm border border-axal-hairline px-2.5 py-1.5 text-[12.5px] font-medium dark:border-gray-700';
  if (!step?.href) {
    return <span className={`${cls} text-axal-faint dark:text-gray-600`} aria-disabled="true">{dir === 'prev' && <Icon size={13} aria-hidden="true" />}{label}{dir === 'next' && <Icon size={13} aria-hidden="true" />}</span>;
  }
  return (
    <Link to={step.href} className={`${cls} text-axal-ink hover:border-axal-violet/40 dark:text-gray-200`} title={step.title || undefined} data-testid={`link-lesson-${dir}`}>
      {dir === 'prev' && <Icon size={13} aria-hidden="true" />}{label}{dir === 'next' && <Icon size={13} aria-hidden="true" />}
    </Link>
  );
}
